/*
 * Copyright (c) 2019, 2022, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as https from 'https';
import * as cp from 'child_process';
import * as decompress from 'decompress';
import * as utils from './utils';
import * as gdsUtils from './gdsUtils';
import { basename, dirname, join, normalize, delimiter } from 'path';
import { LicenseCheckPanel } from './graalVMLicenseCheck';
import { ConfigurationPickItem, getGVMHome, getConf, getGVMConfig, configureGraalVMHome, getGVMInsts, setGVMInsts, setupProxy, checkGraalVMconfiguration, removeGraalVMconfiguration, getTerminalEnv, setTerminalEnv, getTerminalEnvName, setJavaRuntime } from './graalVMConfiguration';
import { startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { isSDKmanPresent, obtainSDKmanGVMInstallations } from './sdkmanSupport';
import { componentsChanged } from './graalVMVisualVM';
import assert = require('assert');
import { Component } from './types';

const GITHUB_URL: string = 'https://api.github.com';
const GRAALVM_RELEASES_URL: string = GITHUB_URL + '/repos/graalvm/graalvm-ce-builds/releases';
const GRAALVM_DEV_RELEASES_URL: string = GITHUB_URL + '/repos/graalvm/graalvm-ce-dev-builds/releases';
const LINUX_AMD64_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-linux-amd64-\S*.tar.gz$/gmi;
const LINUX_AARCH64_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-linux-aarch64-\S*.tar.gz$/gmi;
const MAC_AMD64_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-(darwin|macos)-amd64-\S*.tar.gz$/gmi;
const MAC_AARCH64_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-(darwin|macos)-aarch64-\S*.tar.gz$/gmi;
const WINDOWS_AMD64_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-windows-amd64-\S*.zip$/gmi;
const INSTALL: string = 'Install ';
const OPTIONAL_COMPONENTS: string = 'Optional GraalVM Components';
const LAST_GRAALVM_PARENTDIR: string = 'lastGraalVMInstallationParentDir';
const INSTALL_GRAALVM: string = 'Install GraalVM';
const SELECT_EXISTING_GRAALVM: string = 'Select Existing GraalVM';
const SELECT_ACTIVE_GRAALVM: string = 'Set Active GraalVM';
const NO_GU_FOUND: string = 'Cannot find runtime \'gu\' within your GraalVM installation.';

const lockedComponentIds: string[] = [];

export function setupGraalVM(context: vscode.ExtensionContext, warning: boolean = false) {
	findGraalVMs(context).then(vms => {
		const items: string[] = vms.length > 0 ? [SELECT_ACTIVE_GRAALVM, INSTALL_GRAALVM] : [SELECT_EXISTING_GRAALVM, INSTALL_GRAALVM];
        const message: (message: string, ...items: string[]) => Thenable<string | undefined> = warning ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
		message('No active GraalVM installation found.', ...items).then(value => {
			switch (value) {
				case SELECT_EXISTING_GRAALVM:
					vscode.commands.executeCommand('extension.graalvm.addExistingGraalVM');
					break;
				case SELECT_ACTIVE_GRAALVM:
					vscode.commands.executeCommand('extension.graalvm.selectGraalVMHome');
					break;
				case INSTALL_GRAALVM:
					vscode.commands.executeCommand('extension.graalvm.installGraalVM');
					break;
			}
		});
	});
}

export async function installGraalVM(context: vscode.ExtensionContext): Promise<void> {
    try {
        const selected = await selectGraalVMRelease(context);
        if (selected) {
            if (utils.checkFolderWritePermissions(selected.location)) {
                const target = normalize(join(selected.location, selected.installdir));
                if (fs.existsSync(target)) {
                    const msg = 'Selected GraalVM already exists in the target folder.';
                    const targetHome = process.platform === 'darwin' ? join(target, 'Contents', 'Home') : target;
                    const registered = getGVMInsts().find(gvm => gvm === targetHome);
                    if (registered) {
                        vscode.window.showWarningMessage(msg);
                    } else {
                        const add = 'Add Existing GraalVM';
                        if (await vscode.window.showWarningMessage(msg, add) === add) {
                            await addExistingGraalVM(context, target);
                        }
                    }
                    return;
                }
                if (selected.url instanceof Function) {
                    selected.url = await selected.url();
                    if (!selected.url) {
                        return;
                    }
                }
                const downloadedFile = await dowloadGraalVMRelease(selected.url, selected.location);
                const targetDir = dirname(downloadedFile);
                const name = await extractGraalVM(downloadedFile, targetDir);
                if (name) {
                    fs.unlinkSync(downloadedFile);
                    let graalVMHome = join(targetDir, name);
                    if (process.platform === 'darwin') {
                        graalVMHome = join(graalVMHome, 'Contents', 'Home');
                    }
                    updateGraalVMLocations(context, graalVMHome);
                    checkForMissingComponents(graalVMHome);
                } else {
                    const msg = 'Failed to extract the downloaded archive. Please extract it manually and use the Add Existing GraalVM action to register the GraalVM.';
                    const reveal = 'Reveal Archive in File Explorer';
                    const cleanup = 'Delete Archive';
                    const choice = await vscode.window.showErrorMessage(msg, reveal, cleanup);
                    if (choice === reveal) {
                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(downloadedFile));
                    } else if (choice === cleanup) {
                        fs.unlinkSync(downloadedFile);
                    }
                }
            }
        }
    } catch (err) {
        vscode.window.showErrorMessage(err?.message);
    }
}

export async function removeGraalVMInstallation(context: vscode.ExtensionContext, homeFolder?: string) {
    if (!homeFolder) {
        homeFolder = await _selectInstalledGraalVM(context, true);
    }
    const graalFolder = homeFolder;
    if (!graalFolder) {
        return -1;
    }
    await removeGraalVMconfiguration(context, graalFolder);
    if (isImplicitGraalVM(context, graalFolder)) {
        vscode.window.showWarningMessage('This GraalVM installation was detected automatically from system environment and cannot be removed. Unselect Settings / Detect system GraalVM installations to disable automatic GraalVM detection.');
        return -1;
    }
    if (utils.checkFolderWritePermissions(graalFolder, true)) {
        return utils.askYesNo(`Do you want to delete GraalVM installation files from: ${graalFolder}`, () => setTimeout(() => {
            try {
                deleteFolder(graalFolder);
            } catch (err) {
                vscode.window.showErrorMessage(err?.message);
            }
        }, 1000));
    }
}

export async function installGraalVMComponent(context: vscode.ExtensionContext, component: string | TreeItemComponent | undefined, homeFolder?: string): Promise<void> {
    _callIdGVMHome(component, homeFolder, context, _installGraalVMComponent);
}

export async function uninstallGraalVMComponent(context: vscode.ExtensionContext, component: string | TreeItemComponent | undefined, homeFolder?: string): Promise<void> {
    _callIdGVMHome(component, homeFolder, context, _uninstallGraalVMComponent);
}

const MACOS_JDK_SUBDIR: string = join('Contents', 'Home');
export async function addExistingGraalVM(context: vscode.ExtensionContext, homeFolder?: string): Promise<void> {
    let uri: vscode.Uri[] | undefined = undefined;
    if (!homeFolder) {
        const lastGraalVMParentDir: string | undefined = context.globalState.get(LAST_GRAALVM_PARENTDIR);
        let defaultDir: vscode.Uri | undefined;
        if (lastGraalVMParentDir) {
            try {
                defaultDir = vscode.Uri.parse(lastGraalVMParentDir, true);
            } catch (e) {
                defaultDir = undefined;
            }
        } else {
            defaultDir = undefined;
        }
        uri = await vscode.window.showOpenDialog({
            defaultUri: defaultDir,
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Add GraalVM',
            title: 'Select GraalVM Directory'
        });
    } else {
        uri = [ vscode.Uri.file(homeFolder) ];
    }
    if (uri && uri.length === 1) {
        let graalVMHome = uri[0].fsPath;
        if (graalVMHome) {
            graalVMHome = process.platform === 'darwin' && !fs.existsSync(join(graalVMHome, "bin", "java")) && !graalVMHome.endsWith(MACOS_JDK_SUBDIR) ? join(graalVMHome, MACOS_JDK_SUBDIR) : graalVMHome;
            updateGraalVMLocations(context, graalVMHome);
            if (!homeFolder) {
                const newGraalVMParentDir = vscode.Uri.file(dirname(uri[0].fsPath)).toString();
                await context.globalState.update(LAST_GRAALVM_PARENTDIR, newGraalVMParentDir);
            }
            if (utils.checkFolderWritePermissions(graalVMHome, true)) {
                checkForMissingComponents(graalVMHome);
            }
        }
    } else {
        throw new Error('No GraalVM Installation selected.');
    }
}

export async function selectActiveGraalVM(context: vscode.ExtensionContext, graalVMHome?: string, nonInteractive?: boolean): Promise<void> {
    graalVMHome = graalVMHome || await _selectInstalledGraalVM(context, true);
    if (graalVMHome) {
        const graalVMVersion = await getGraalVMVersion(graalVMHome);
        if (graalVMVersion) {
            await configureGraalVMHome(context, graalVMHome, nonInteractive);
        }
    }
}

export async function findGraalVMs(context: vscode.ExtensionContext): Promise<{name: string, path: string}[]> {
    const paths: string[] = [];
    const comparator = utils.isSamePath();
    addPathToJava(context, normalize(getGVMHome()), paths, comparator);
    const installations = getGVMInsts().map(inst => normalize(inst));
    installations.forEach(installation => addPathToJava(context, installation, paths, comparator, true));
    findImplicitGraalVMs(context, paths, comparator);
    const vms: {name: string, path: string}[] = [];
    for (let i = 0; i < paths.length; i++) {
        const version = await getGraalVMVersion(paths[i]);
        if (version) {
            vms.push({name: version, path: paths[i]});
        }
    }
    return vms;
}

function findImplicitGraalVMs(context: vscode.ExtensionContext, paths: string[], comparator = utils.isSamePath()) {
    if (getConf('graalvm').get('systemDetect')) {
        addPathsToJavaIn(context, '/opt', paths, comparator);
        if (process.env.GRAALVM_HOME) {
            addPathToJava(context, normalize(process.env.GRAALVM_HOME), paths, comparator);
        }
        if (process.env.JAVA_HOME) {
            addPathToJava(context, normalize(process.env.JAVA_HOME), paths, comparator);
        }
        if (utils.platform() === utils.PLATFORM_OSX) {
            const java_home_exec = '/usr/libexec/java_home';
            if (fs.existsSync(java_home_exec)) {
                const ret = cp.spawnSync(java_home_exec, ['-V'], { encoding: 'utf8' });
                if (ret.stderr) {
                    ret.stderr.split('\n').forEach((line, index) => {
                        if (index > 0) {
                            const idx = line.lastIndexOf('"');
                            if (idx >= 0) {
                                addPathToJava(context, normalize(line.slice(idx + 1).trim()), paths, comparator);
                            }
                        }
                    });
                }
            }
        } else if (process.env.PATH) {
            process.env.PATH.split(delimiter)
                .filter(p => {
                    return basename(p) === 'bin' && dirname(p) !== '/usr/local' && dirname(p) !== '/usr' && dirname(p) !== '/';
                })
                .forEach(p => addPathToJava(context, dirname(p), paths, comparator));
        }
        obtainSDKmanGVMInstallations()
            .forEach(p => addPathToJava(context, normalize(p[0]), paths, comparator));
    }
}

function isImplicitGraalVM(context: vscode.ExtensionContext, path: string): boolean {
    const paths: string[] = [];
    findImplicitGraalVMs(context, paths);
    return paths.includes(path);
}

export async function getGraalVMVersion(homeFolder: string): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        if (homeFolder && fs.existsSync(homeFolder)) {
            const executable: string | undefined = utils.findExecutable('java', homeFolder);
            if (executable) {
                cp.execFile(executable, ['-version'], { encoding: 'utf8' }, (_error, _stdout, stderr) => {
                    if (stderr) {
                        let javaVersion: string | undefined;
                        let graalVMVersion: string | undefined;
                        stderr.split('\n').forEach((line: string) => {
							const javaInfo: string[] | null = line.match(/version\s+"(\S+)"/);
							const vmInfo = line.match(/(GraalVM.*)\s+\(/);
							if (javaInfo && javaInfo.length > 1) {
								javaVersion = javaInfo[1];
							}
							if (vmInfo && vmInfo.length > 1) {
								graalVMVersion = vmInfo[1];
							}
                        });
                        if (javaVersion && graalVMVersion) {
                            if (javaVersion.startsWith('1.')) {
                                javaVersion = javaVersion.slice(2);
                            }
                            let i = javaVersion.indexOf('.');
                            if (i > -1) {
                                javaVersion = javaVersion.slice(0, i);
                            }
                            resolve(`${graalVMVersion}, Java ${javaVersion}`);
                        } else {
                            resolve(undefined);
                        }
                    } else {
                        resolve(undefined);
                    }
                });
            } else {
                resolve(undefined);
            }
        } else {
            resolve(undefined);
        }
    });
}

export function getInstallConfigurations(context: vscode.ExtensionContext): ConfigurationPickItem[] {
    const ret: ConfigurationPickItem[] = [];

    ret.push(new ConfigurationPickItem(
        'Set as default Java',
        '(java.home)',
        _graalVMHome => vscode.extensions.getExtension('redhat.java') !== undefined,
        graalVMHome => getConf('java').get('home') === graalVMHome,
        async graalVMHome => getConf('java').update('home', graalVMHome, true),
        async _graalVMHome => getConf('java').update('home', undefined, true))
    );
    
    ret.push(new ConfigurationPickItem(
        'Set as default Java runtime',
        '(java.configuration.runtimes)',
        _graalVMHome => vscode.extensions.getExtension('redhat.java') !== undefined,
        graalVMHome => {
            const runtimes = getConf('java').get('configuration.runtimes') as object[] || [];
            const runtime: any = runtimes.find((runtime: any) => runtime.path === graalVMHome);
            return runtime?.default;
        },
        async graalVMHome => {
            const version = await getGraalVMVersion(graalVMHome);
            if (version) {
                return await setJavaRuntime(version, graalVMHome, true);
            }
        },
        async graalVMHome => {
            const runtimes = getConf('java').get('configuration.runtimes') as object[] || [];
            const runtime: any = runtimes.find((runtime: any) => runtime.path === graalVMHome);
            if (runtime?.default) {
                delete runtime.default;
                return getConf('java').update('configuration.runtimes', runtimes, true)
            }
        }
    ));

    let section: string = getTerminalEnvName();
    ret.push(new ConfigurationPickItem(
        'Set as Java for Terminal',
        `(JAVA_HOME in ${section})`,
        _graalVMHome => !isSDKmanPresent(),
        graalVMHome => getTerminalEnv().JAVA_HOME === graalVMHome,
        async graalVMHome => {
            const env: any = getTerminalEnv();
            env.JAVA_HOME = graalVMHome;
            return setTerminalEnv(context, env);
        },
        async _graalVMHome => {
            const env: any = getTerminalEnv();
            env.JAVA_HOME = undefined;
            return setTerminalEnv(context, env);
        }
    ));
    
    ret.push(new ConfigurationPickItem(
        'Set as Java for Terminal',
        `(PATH in ${section})`,
        _graalVMHome => !isSDKmanPresent(),
        graalVMHome => {
            const env: any = getTerminalEnv();
            const path = env.PATH as string;
            return path?.startsWith(join(graalVMHome, 'bin'));
        },
        async graalVMHome => {
            const env: any = getTerminalEnv();
            const path = env.PATH as string;
            const graalVMPath = join(graalVMHome, 'bin');
            if (path) {
                const paths = path.split(delimiter);
                const index = paths.indexOf(graalVMPath);
                if (index >= 0) {
                    paths.splice(index, 1);
                    paths.unshift(graalVMPath);
                    env.PATH = paths.join(delimiter);
                } else {
                    env.PATH = `${graalVMPath}${delimiter}${path}`;
                }
            } else {
                env.PATH = `${graalVMPath}${delimiter}${process.env.PATH}`;
            }
            return setTerminalEnv(context, env);
        },
        async graalVMHome => {
            const env: any = getTerminalEnv();
            const path = env.PATH as string;
            const graalVMPath = join(graalVMHome, 'bin');
            if (path) {
                const paths = path.split(delimiter);
                const index = paths.indexOf(graalVMPath);
                if (index >= 0) {
                    paths.splice(index, 1);
                    env.PATH = paths.join(delimiter);
                }
            }
            return setTerminalEnv(context, env);
        }
    ));

    ret.push(new ConfigurationPickItem(
        'Set as Java for Maven',
        '(JAVA_HOME in maven.terminal.customEnv)',
        _graalVMHome => vscode.extensions.getExtension('vscjava.vscode-maven') !== undefined,
        graalVMHome => {
            const envs = getConf('maven').get('terminal.customEnv') as [];
            return envs ? envs.find(env => env["environmentVariable"] === "JAVA_HOME" && env["value"] === graalVMHome) !== undefined : false;
        },
        async graalVMHome => {
            const envs: any[] = getConf('maven').get('terminal.customEnv') as [];
            if (envs) {
                const env: any = envs.find(env => env["environmentVariable"] === "JAVA_HOME");
                if (env) {
                    env.value = graalVMHome;
                } else {
                    envs.push({environmentVariable: "JAVA_HOME", value: graalVMHome});
                }
                return getConf('maven').update('terminal.customEnv', envs, true);
            }
            return getConf('maven').update('terminal.customEnv', [{environmentVariable: "JAVA_HOME", value: graalVMHome}], true);
        },
        async graalVMHome => {
            const envs: any[] = getConf('maven').get('terminal.customEnv') as [];
            if (envs) {
                const env: any = envs.find(env => env["environmentVariable"] === "JAVA_HOME" && env["value"] === graalVMHome);
                if (env) {
                    envs.splice(envs.indexOf(env), 1);
                    return getConf('maven').update('terminal.customEnv', envs, true);                    
                }
            }
            return;
        })
    );
    return ret;
}

export async function checkForMissingComponents(homeFolder: string): Promise<void> {
    if (!utils.checkFolderWritePermissions(homeFolder, true)) {
        return;
    }
    const available: Component[] = await getAvailableComponents(homeFolder);
    const components: Component[] = available.filter(availableItem => !availableItem.installed);
    if (components.length > 1) {
        const itemText = INSTALL + OPTIONAL_COMPONENTS;
        return utils.ask('Optional GraalVM components are not installed in your GraalVM.', [
            {option: itemText, fnc: () => vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', undefined, homeFolder)}
        ]);
    } else if (components.length === 1) {
        const itemText = INSTALL + components[0].name;
        return utils.ask(components[0].name + ' is not installed in your GraalVM.', [
            {option: itemText, fnc: () => vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', components[0].id, homeFolder)}
        ]);
    }
}

async function _selectInstalledGraalVM(context: vscode.ExtensionContext, explicit: boolean): Promise<string | undefined>{
    const vms: {label: string, detail: string}[] = (await findGraalVMs(context)).map(item => {
        return {label: item.name, detail: item.path};
    });
    if (vms.length === 0) {
        vscode.window.showWarningMessage("No GraalVM installation found.");
        return undefined;
    }
    if (!explicit && vms.length === 1 && vms[0].detail === getGVMHome()) {
        return vms[0].detail;
    }
    const selected = await vscode.window.showQuickPick(vms, { matchOnDetail: true, placeHolder: 'Select GraalVM' });
    return selected?.detail;
}

async function selectGraalVMRelease(context: vscode.ExtensionContext): Promise<{url: any, location: string, installdir: string} | undefined> {

    interface State {
		graalVMDistribution: vscode.QuickPickItem;
		graalVMVersion: vscode.QuickPickItem;
		javaVersion: vscode.QuickPickItem;
	}

	async function collectInputs() {
		const state = {} as Partial<State>;
		await utils.MultiStepInput.run(input => pickGraalVMDistribution(input, state));
		return state as State;
	}

	const title = 'Download & Install GraalVM';
    let totalSteps = 3;
    let releaseInfos: any;

	async function pickGraalVMDistribution(input: utils.MultiStepInput, state: Partial<State>) {
		state.graalVMDistribution = await input.showQuickPick({
			title,
			step: 1,
			totalSteps,
			placeholder: 'Pick GraalVM distribution',
			items: [
                { label: 'Community', description: '(Free for all purposes)' },
                { label: 'Enterprise', description: '(Free for evaluation and development)' }
            ],
            activeItem: state.graalVMDistribution,
            postProcess: async item => releaseInfos = await (item.label === 'Enterprise' ? getGraalVMEEReleases() : getGraalVMCEReleases()),
			shouldResume: () => Promise.resolve(false)
        });
		return (input: utils.MultiStepInput) => pickGraalVMVersion(input, state);
	}

    function sortVersion(v1: {label: string}, v2: {label: string}): number {
        const parts1 = v1.label.split('.');
        const parts2 = v2.label.split('.');
        const length = Math.min(parts1.length, parts2.length);
        for (let i = 0; i < length; ++i) {
            const diff = Number.parseInt(parts2[i]) - Number.parseInt(parts1[i]);
            if (diff !== 0) {
                return diff;
            }
        }
        const l = Math.max(parts1.length, parts2.length) - 1;
        if (parts1[l]) {
            const l1 = Number.parseInt(parts1[l]);
            return Number.isSafeInteger(l1) ? -1 : 1;
        } else {
            const l2 = Number.parseInt(parts2[l]);
            return Number.isSafeInteger(l2) ? 1 : -1;
        }
    }

	async function pickGraalVMVersion(input: utils.MultiStepInput, state: Partial<State>) {
		state.graalVMVersion = await input.showQuickPick({
			title,
			step: 2,
			totalSteps,
			placeholder: 'Pick a GraalVM version',
			items: Object.keys(releaseInfos).map(label => ({ label })).sort(sortVersion),
			activeItem: state.graalVMVersion,
			shouldResume: () => Promise.resolve(false)
		});
		return (input: utils.MultiStepInput) => pickJavaVersion(input, state);
	}

	async function pickJavaVersion(input: utils.MultiStepInput, state: Partial<State>) {
		state.javaVersion = await input.showQuickPick({
			title,
			step: 3,
			totalSteps,
			placeholder: 'Pick a Java version',
			items: state.graalVMVersion ? Object.keys(releaseInfos[state.graalVMVersion.label]).map(label => ({ label })) : [],
			activeItem: state.javaVersion,
			shouldResume: () => Promise.resolve(false)
		});
	}

    const state = await collectInputs();

    if (state.graalVMDistribution && state.graalVMVersion && state.javaVersion) {
        let installdir = 'graalvm-';
        if (state.graalVMDistribution.label === 'Enterprise') {
            const artifactId = releaseInfos[state.graalVMVersion.label][state.javaVersion.label].id;
            const licenseId = releaseInfos[state.graalVMVersion.label][state.javaVersion.label].licenseId;
            const implicitlyAccepted = releaseInfos[state.graalVMVersion.label][state.javaVersion.label].isImplicitlyAccepted;
            releaseInfos[state.graalVMVersion.label][state.javaVersion.label].url = (): Promise<string | undefined> => {
                return gdsUtils.getEEArtifactURL(artifactId, licenseId, implicitlyAccepted);
            };
            installdir += 'ee-';
        } else {
            installdir += 'ce-';
        }
        installdir = `${installdir}${state.javaVersion.label.replace('jdk', 'java')}-${state.graalVMVersion.label}`;
        const lastGraalVMParentDir: string | undefined = context.globalState.get(LAST_GRAALVM_PARENTDIR);
        let defaultDir: vscode.Uri | undefined;
        if (lastGraalVMParentDir) {
            try {
                defaultDir = vscode.Uri.parse(lastGraalVMParentDir, true);
            } catch (e) {
                defaultDir = undefined;
            }
        } else {
            defaultDir = undefined;
        }
        const location: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            defaultUri: defaultDir,
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Choose Installation Directory',
            openLabel: 'Install Here'
        });
        if (location && location.length > 0 && utils.checkFolderWritePermissions(location[0].fsPath)) {
            await context.globalState.update(LAST_GRAALVM_PARENTDIR, location[0].toString());
            return { url: releaseInfos[state.graalVMVersion.label][state.javaVersion.label].url, location: location[0].fsPath, installdir: installdir };
        }
    }

    return undefined;
}

async function dowloadGraalVMRelease(releaseURL: string, storagePath: string | undefined): Promise<string> {
    const base: string = basename(releaseURL);
    return vscode.window.withProgress<string>({
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${base} ...`,
        cancellable: true
    }, (progress, token) => {
        return new Promise<string>((resolve, reject) => {
            if (storagePath) {
                const filePath: string = join(storagePath, base);
                const file: fs.WriteStream = fs.createWriteStream(filePath);
                const request = function (url: string) {
                    https.get(url, res => {
                        const { statusCode } = res;
                        if (statusCode === 302) {
                            if (res.headers.location) {
                                request(res.headers.location);
                            }
                        } else {
                            let error;
                            const contentType = res.headers['content-type'] || '';
                            const length = parseInt(res.headers['content-length'] || '0');
                            if (statusCode !== 200) {
                                error = new Error(`Request Failed.\nStatus Code: ${statusCode}`);
                            } else if (!/^application\/(octet-stream|x-gtar|zip)/.test(contentType)) {
                                error = new Error(`Invalid content-type received ${contentType}`);
                            }
                            if (error) {
                                reject(error);
                                res.resume();
                                file.end();
                            } else {
                                token.onCancellationRequested(() => {
                                    reject();
                                    res.destroy();
                                    file.end();
                                    fs.unlinkSync(filePath);
                                });
                                res.pipe(file);
                                if (length) {
                                    const percent = length / 100;
                                    let counter = 0;
                                    let progressCounter = 0;
                                    res.on('data', chunk => {
                                        counter += chunk.length;
                                        let f = Math.floor(counter / percent);
                                        if (f > progressCounter) {
                                            progress.report({ increment: f - progressCounter });
                                            progressCounter = f;
                                        }
                                    });
                                }
                                res.on('end', () => {
                                    resolve(filePath);
                                    // file.end(); // NOTE: called by 'res.pipe(file);'
                                });
                            }
                        }
                    }).on('error', e => {
                        reject(e);
                        file.end();
                    });
                };
                request(releaseURL);
            }
        });
    });
}

async function extractGraalVM(downloadedFile: string, targetDir: string): Promise<string | undefined> {
    return vscode.window.withProgress<string | undefined>({
        location: vscode.ProgressLocation.Notification,
        title: "Installing GraalVM..."
    }, async (_progress, _token) => {
        const files = await decompress(downloadedFile, targetDir).catch(_err => []);
        if (files.length === 0) {
            return undefined;
        }
        const idx = files[0].path.indexOf('/');
        return idx < 0 ? files[0].path : files[0].path.slice(0, idx);
    });
}

async function _callIdGVMHome(component: string | TreeItemComponent | undefined, homeFolder: string | undefined, context: vscode.ExtensionContext, fnc: (id: Component | undefined, graalVMHome: string, context: vscode.ExtensionContext) => Promise<void>): Promise<void>{
    if (component instanceof TreeItemComponent) {
        return fnc(component.component, component.installation.home, context);
    } else if (component != undefined) {
        homeFolder = homeFolder || await _selectInstalledGraalVM(context, false);
        if (homeFolder) {
            return fnc(await findComponent(homeFolder, component), homeFolder, context);
        }
    }
}

async function findComponent(gvmHome: string, componentId: string): Promise<Component | undefined> {
    return (await getAvailableComponents(gvmHome)).find(comp => comp.id == componentId);
}

async function _installGraalVMComponent(component: Component | undefined, graalVMHome: string, context: vscode.ExtensionContext): Promise<void> {
    if (utils.checkFolderWritePermissions(graalVMHome)) {
        const components: Component[] = component ? [component] : await selectAvailableComponents(graalVMHome).catch((error) => {
            vscode.window.showWarningMessage(error.toString().replace('Error: ', ''));
            return [];
        });
        changeGraalVMComponent(graalVMHome, components, 'install', context);
    }
}

async function _uninstallGraalVMComponent(component: Component | undefined, graalVMHome: string, context: vscode.ExtensionContext): Promise<void> {
    if (utils.checkFolderWritePermissions(graalVMHome)) {
        const components: Component[] = component ? [component] : await selectInstalledComponents(graalVMHome).catch((error) => {
            vscode.window.showWarningMessage(error.toString().replace('Error: ', ''));
            return [];
        });
        changeGraalVMComponent(graalVMHome, components.reverse(), 'remove', context);
    }
}

function lockComponents(graalVMHome: string, components: Component[]): Component[] {
    return components.filter((element) => {
        const key = graalVMHome + element.id;
        if (lockedComponentIds.indexOf(key) === -1) {
            lockedComponentIds.push(key);
            return true;
        }
        return false;
    });
}

function unlockComponents(graalVMHome: string, components: Component[]): void {
    components.forEach((component) => {
        const idx = lockedComponentIds.indexOf(graalVMHome + component.id);
        if (idx !== -1) {
            lockedComponentIds.splice(idx, 1);
        }
    });
}

async function changeGraalVMComponent(graalVMHome: string, components: Component[], action: string, context: vscode.ExtensionContext): Promise<void> {
    components = lockComponents(graalVMHome, components);
    if (components.length === 0) {
        return;
    }
    const executablePath = await getGU(graalVMHome);
    let email: string | undefined;
    let dtoken: gdsUtils.Token | undefined;
    const eeInfo: any = action === 'install' ? await getEEReleaseInfo(graalVMHome) : undefined;
    if (eeInfo) {
        if (eeInfo.license) {
            // GraalVM EE <= 22.0
            const license = await get(eeInfo.license, /^text\/plain/);
            if (license) {
                email = await LicenseCheckPanel.show(context, eeInfo.licenseLabel, license.split('\n').join('<br>'));
            }
            if (!email) {
                unlockComponents(graalVMHome, components);
                return;
            }
        } else if (!eeInfo.license) {
            // GraalVM EE >= 22.1
            dtoken = await gdsUtils.getDownloadToken(true);
            // Make sure the download token is defined before invoking GU
            if (!dtoken) {
                unlockComponents(graalVMHome, components);
                return;
            }
        }
    }
    if (action === 'remove' && graalVMHome === getGVMHome()) {
        await stopLanguageServer();
    }
    function resolveEEArgs(eeVersion: string[]) {
        if (dtoken) { // new GDS
            return '-N';
        } else { // original GDS
            if (parseInt(eeVersion[0]) < 21) {
                return '-A';
            } else {
                return `-A --email ${email}`;
            }
        }
    }
    const eeVersion = eeInfo ? eeInfo.version.split('.') : undefined;
    const args = eeVersion ? `${resolveEEArgs(eeVersion)} ` : '';
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${action === 'install' ? 'I' : 'Uni'}nstalling GraalVM Component${components.length > 1 ? 's' : ' ' + components[0].id} of: "${await getGraalVMVersion(graalVMHome)}"`,
        cancellable: components.length > 1
    }, async (progress, token) => {
        const incr = 100/components.length;
        for (const component of components) {
            if (token.isCancellationRequested) {
                return;
            }
            if (incr !== 100) {
                progress.report({message: component.id, increment: incr});
            }
            let guErrorType: string | undefined = undefined;
            const dataListener = dtoken ? function (chunk: any) {
                const guMessage = chunk.toString();
                const errorType = gdsUtils.getGUErrorType(guMessage);
                if (errorType) {
                    guErrorType = errorType;
                }
            } : undefined;
            async function execute() {
                try {
                    await execCancellable(`${executablePath} ${action} ${args}${component.id}`, token, { cwd: join(graalVMHome, 'bin'), env: { [gdsUtils.DOWNLOAD_TOKEN_ENV]: dtoken?.value } }, dataListener);
                    await checkGraalVMconfiguration(context, graalVMHome);
                } catch (error) {
                    if (dtoken && guErrorType && gdsUtils.isHandledGUError(error)) {
                        if (await gdsUtils.handleGUError(dtoken, guErrorType)) {
                            await execute();
                        }
                    } else {
                        let msg = 'Error changing GraalVM component';
                        const errmessage: string | undefined = error?.message?.toString();
                        if (errmessage) {
                            const ERROR_PREFIX = 'Error: ';
                            const errIdx = errmessage.lastIndexOf(ERROR_PREFIX);
                            if (errIdx > -1) {
                                msg += `: ${errmessage.substring(errIdx + ERROR_PREFIX.length)}`;
                            } else {
                                msg += `: ${errmessage}`;
                            }
                        }
                        vscode.window.showErrorMessage(msg);
                    }
                }
            }
            await execute();
        }
        return;
    }).then(() => {
        vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
        const activeGVM = graalVMHome === getGVMHome();
        if (activeGVM) {
            if (action === 'remove') {
                startLanguageServer(graalVMHome);
            } else {
                stopLanguageServer().then(() => startLanguageServer(graalVMHome));
            }
        }
        unlockComponents(graalVMHome, components);
        if (activeGVM) {
            componentsChanged(action);
        }
    });
}

function execCancellable(cmd: string, token: vscode.CancellationToken, options?: ({ encoding?: string | null | undefined; } & cp.ExecOptions) | null | undefined, dataListener?: (chunk: any) => void): Promise<boolean> {
    return new Promise((resolve, reject) => {
        let resolved: boolean = false;
        const child = cp.exec(cmd, options, (error, _stdout, _stderr) => {
            if (error || _stderr) {
                if (!resolved) reject(error ?? new Error(_stderr.toString()));
            } else {
                resolve(true);
            }
        });
        if (dataListener) {
            child.stdout?.on('data', data => { 
                dataListener(data);
            });
        }
        token.onCancellationRequested(() => {
            resolved = true;
            utils.killProcess(child.pid);
            resolve(false);
        });
    });
}

async function getGU(graalVMHome?: string): Promise<string> {
    graalVMHome = graalVMHome || getGVMHome();
    if (graalVMHome) {
        if (! await getGraalVMVersion(graalVMHome)) {
            throw new Error(`Missing GraalVM Installation. ${graalVMHome}`);
        }
    }
    const executablePath = utils.findExecutable('gu', graalVMHome);
    if (executablePath) {
        return makeGUProxy(executablePath, getConf('http').get('proxy'));
    }
    throw new Error(NO_GU_FOUND);
}

async function isGUJSON(guCmd: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        cp.exec(`${guCmd} --help`, (error, stdout, _stderr) => {
            if (error || _stderr) {
                reject(error ?? new Error(_stderr));
            } else {
                resolve(stdout.includes("-J, --json"));
            }
        })
    });
}

function makeGUProxy(executable:string, proxy?: string): string {
    if (!proxy || getConf('http').get('proxySupport') === 'off') {
        return `"${executable}"`;
    }
    if (process.platform === 'win32') {
        let index = proxy.indexOf('://');
        proxy = proxy.slice(index + 3);
        index = proxy.indexOf(':');
        return `"${executable}" --vm.Dhttps.proxyHost=${proxy.slice(0, index)} --vm.Dhttps.proxyPort=${proxy.slice(index + 1)}`;
    } else {
        return `env https_proxy=${proxy} "${executable}"`;
    }
}

async function getGraalVMCEReleases(): Promise<any> {
    return Promise.all([
        getGraalVMReleaseURLs(GRAALVM_RELEASES_URL),
        getGraalVMReleaseURLs(GRAALVM_DEV_RELEASES_URL)
    ]).catch(err => {
        if (err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') {
            notifyConnectionProblem('GraalVM Community releases');
            return [];
        } else {
            throw new Error('Cannot get data from server: ' + err.message);
        }
    }).then(urls => {
        const merged: string[] = Array.prototype.concat.apply([], urls);
        if (merged.length === 0) {
            throw new Error(`No GraalVM Community release found for ${process.platform}/${process.arch}`);
        }
        const releases: any = {};
        merged.forEach(releaseUrl => {
            const version: string[] | null = releaseUrl.match(/\d+\.\d+\.\d+(\.\d)?(-dev)?/);
            if (version && version.length > 0) {
                const graalvmVarsion: string = version[0];
                let releasesVersion = releases[graalvmVarsion];
                let key = Object.keys(releases).find(key => graalvmVarsion.endsWith('-dev') ? key.endsWith('-dev') : graalvmVarsion.slice(0, 2) === key.slice(0, 2));
                if (key) {
                    if (graalvmVarsion > key) {
                        delete releases[key];
                        releases[graalvmVarsion] = releasesVersion = {};
                    }
                } else {
                    releases[graalvmVarsion] = releasesVersion = {};
                }
                if (releasesVersion) {
                    const javaVersion: string[] | null = releaseUrl.match(/(java|jdk)(\d+)/);
                    if (javaVersion && javaVersion.length > 0) {
                        let releasesJavaVersion = releasesVersion[javaVersion[0]];
                        if (!releasesJavaVersion) {
                            releasesVersion[javaVersion[0]] = releasesJavaVersion = {};
                            releasesJavaVersion.url = releaseUrl;
                        }
                    }
                }
            }
        });
        return releases;
    });
}

async function getGraalVMEEReleases(): Promise<any> {
    const releases: any = {};
    try {
        const artifacts = await gdsUtils.getGraalVMEECoreArtifacts();
        for (let artifact of artifacts.items) {
            const id = artifact.id;
            const licenseId = artifact.licenseId;
            const implicitlyAccepted = artifact.implicitlyAccepted;
            const metadata: any = {};
            for (let pair of artifact.metadata) {
                metadata[pair.key] = pair.value;
            }
            const release = metadata.version;
            const java = metadata.java;
            const releaseVersion = releases[release] ?? (releases[release] = {});
            const releaseJavaVersion = releaseVersion[java] ?? (releaseVersion[java] = {});
            releaseJavaVersion.id = id;
            releaseJavaVersion.licenseId = licenseId;
            releaseJavaVersion.implicitlyAccepted = implicitlyAccepted;
        }
    } catch (err) {
        if (err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') {
            notifyConnectionProblem('GraalVM Enterprise releases');
        } else {
            throw new Error('Cannot get data from server: ' + err.message);
        }
    }
    if (Object.keys(releases).length === 0) {
        throw new Error(`No GraalVM Enterprise release found for ${process.platform}/${process.arch}`);
    }
    return releases;
}

async function getGraalVMReleaseURLs(releasesURL: string): Promise<string[]> {
    const USER_AGENT_OPTIONS: https.RequestOptions = {
        headers: {
            'User-Agent': 'vscode-ext',
        }
    };
    return getWithOptions(releasesURL, USER_AGENT_OPTIONS, /^application\/json/).then(rawData => {
        const ret: string[] = [];
        if(!rawData) {
            return ret;
        }
        const arch = utils.getArch();
        let regex: RegExp | undefined = undefined;
        if (process.platform === 'linux') {
            if (arch === utils.ARCH_AMD64) {
                regex = LINUX_AMD64_LINK_REGEXP;
            } else if (arch === utils.ARCH_AARCH64) {
                regex = LINUX_AARCH64_LINK_REGEXP;
            }
        } else if (process.platform === 'darwin') {
            if (arch === utils.ARCH_AMD64) {
                regex = MAC_AMD64_LINK_REGEXP;
            } else if (arch === utils.ARCH_AARCH64) {
                regex = MAC_AARCH64_LINK_REGEXP;
            }
        } else if (process.platform === 'win32') {
            if (arch === utils.ARCH_AMD64) {
                regex = WINDOWS_AMD64_LINK_REGEXP;
            }
        }
        if (regex !== undefined) {
            const data: { assets?: { browser_download_url?: string }[] }[] = JSON.parse(rawData);
            data.forEach(release => {
                release.assets?.forEach(asset => {
                    if (asset.browser_download_url?.match(regex as RegExp)) {
                        ret.push(asset.browser_download_url);
                    }
                });
            });
        }
        return ret;
    });
}

async function get(url: string, contentTypeRegExp: RegExp, file?: fs.WriteStream): Promise<string | undefined> {
    return getWithOptions(url, {}, contentTypeRegExp, file);
}

async function getWithOptions(url: string, options: https.RequestOptions, contentTypeRegExp: RegExp, file?: fs.WriteStream): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
        https.get(url, options, res => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'] || '';
            let error;
            if (statusCode !== 200) {
                error = new Error(`Request Failed.\nStatus Code: ${statusCode}`);
            } else if (!contentTypeRegExp.test(contentType)) {
                error = new Error(`Invalid content-type received ${contentType}`);
            }
            if (error) {
                res.resume();
                reject(error);
            } else if (file) {
                res.pipe(file);
                res.on('end', () => {
                    resolve(undefined);
                });
            } else {
                let rawData: string = '';
                res.on('data', chunk => { rawData += chunk; });
                res.on('end', () => {
                    resolve(rawData);
                });
            }
        }).on('error', e => {
            reject(e);
        }).end();
    });
}

function deleteFolder(folder: string) {
    if (fs.existsSync(folder)) {
        fs.readdirSync(folder).forEach((file, _index) => {
            var curPath: string = join(folder, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolder(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(folder);
    }
}

function updateGraalVMLocations(context: vscode.ExtensionContext, homeFolder: string) {
    homeFolder = normalize(homeFolder);
    const gr = getGVMConfig();
    const installations = getGVMInsts(gr);
    if (!installations.find(item => item === homeFolder)) {
        getGraalVMVersion(homeFolder).then(version => {
            if (version) {
                installations.push(homeFolder);
                setGVMInsts(gr, installations);
                setJavaRuntime(version, homeFolder);
                const graalVMHome = getGVMHome(gr);
                if (!graalVMHome) {
                    configureGraalVMHome(context, homeFolder);
                } else if (graalVMHome !== homeFolder) {
                    utils.askYesNo(`Set ${version} as active GraalVM?`, () => configureGraalVMHome(context, homeFolder));
                }
            } else {
                vscode.window.showErrorMessage('Failed to add the selected GraalVM installation');
            }
        });
    }
}

function addPathsToJavaIn(context: vscode.ExtensionContext, folder: string, paths: string[], comparator = utils.isSamePath()) {
    if (folder && fs.existsSync(folder) && fs.statSync(folder).isDirectory) {
        fs.readdirSync(folder).map(f => join(folder, f)).map(p => {
            if (process.platform === 'darwin') {
                let homePath: string = join(p, 'Contents', 'Home');
                return fs.existsSync(homePath) ? homePath : p;
            }
            return p;
        }).filter(p => fs.statSync(p).isDirectory()).forEach(p => addPathToJava(context, p, paths, comparator));
    }
}

function addPathToJava(context: vscode.ExtensionContext, folder: string, paths: string[], comparator = utils.isSamePath(), removeOnEmpty: boolean = false): void {
    const executable: string | undefined = utils.findExecutable('java', folder);
    if (!executable) {
        if (removeOnEmpty) {
            removeGraalVMconfiguration(context, folder);
        }
        return;
    }
    folder = normalize(join(dirname(fs.realpathSync(executable)), '..'));
    if (!paths.find(comparator(folder))) {
        paths.push(folder);
    }
}

async function selectAvailableComponents(graalVMHome: string): Promise<Component[]> {
    return new Promise<Component[]>((resolve, reject) => {
        getAvailableComponents(graalVMHome).then(async available => {
            const components: Component[] = available.filter(availableItem => !availableItem.installed);
            if (components.length > 0) {
                vscode.window.showQuickPick(toQuickPick(components), { placeHolder: `Select GraalVM components to install to: "${await getGraalVMVersion(graalVMHome)}"`, canPickMany: true }).then(selected => {
                    if (selected) {
                        resolve(selected.filter(component => component.detail !== undefined).map(component => component.component));
                    } else {
                        resolve([]);
                    }
                });
            } else {
                reject(new Error('No GraalVM component to install.'));
            }
        });
    });
}

async function selectInstalledComponents(graalVMHome: string): Promise<Component[]> {
    return new Promise<Component[]>((resolve, reject) => {
        getAvailableComponents(graalVMHome).then(async available => {
            const components = available.filter(availableItem => availableItem.installed);
            if (components.length > 0) {
                vscode.window.showQuickPick(toQuickPick(components), { placeHolder: `Select GraalVM components to uninstall from: "${await getGraalVMVersion(graalVMHome)}"`, canPickMany: true }).then(selected => {
                    if (selected) {
                        resolve(selected.filter(component => component.detail !== undefined).map(component => component.component));
                    } else {
                        resolve([]);
                    }
                });
            } else {
                reject(new Error('No GraalVM component to uninstall.'));
            }
        });
    });
}

function toQuickPick(items: Component[]): (vscode.QuickPickItem & {component: Component})[] {
    return items.map(item => {return {label: item.name, detail: item.id, component: item};});
}

async function getAvailableComponents(graalVMHome: string): Promise<Component[]> {
    return new Promise<Component[]>(async (resolve, reject) => {
        const executablePath = await getGU(graalVMHome);
        const binGVM = join(graalVMHome, 'bin');
        const guListCmd = `${executablePath} list`;
        const isListJson = await isGUJSON(guListCmd);
        cp.exec(`${guListCmd} ` + (isListJson ? '-J' : '-v'), { cwd: binGVM }, async (error, stdout, _stderr) => {
            if (error || _stderr) {
                reject(error ?? new Error(_stderr));
            } else {
                const guAvailCmd = `${executablePath} available`;
                const isAvailJson = await isGUJSON(guAvailCmd);
                const installed: Component[] = processsGUOutput(stdout, isListJson);
                cp.exec(`${guAvailCmd} ` + (isAvailJson ? '-J' : '-v'), { cwd: binGVM }, (error: any, stdout: string, _stderr: any) => {
                    if (error || _stderr) {
                        notifyConnectionProblem('GraalVM components');
                        reject({error: error ?? new Error(_stderr), list: installed.map(inst => {inst.installed = true; return inst; }) });
                    } else {
                        const available: Component[] = processsGUOutput(stdout, isAvailJson);
                        available.forEach(avail => {
                            const found = installed.find(item => item.id === avail.id);
                            avail.installed = found ? true : false;
                        });
                        resolve(available);
                    }
                });
            }
        });
    });
}

async function notifyConnectionProblem(subject: string){
    const select = await vscode.window.showWarningMessage(`Could not resolve ${subject}. Check your connection and verify proxy settings.`, 'Setup proxy');
    if (select === 'Setup proxy') {
        setupProxy();
    }
}

async function getEEReleaseInfo(graalVMHome: string): Promise<any> {
    const version = await getGraalVMVersion(graalVMHome);
    if (version) {
        const versionInfo: string[] | null = version.match(/GraalVM\s+(CE|EE)\s+(\S*), Java (\S*)/);
        if (versionInfo && versionInfo.length >= 4) {
            if (versionInfo[1] === 'EE') {
                const javaVersion = `jdk${versionInfo[3]}`;
                const version = versionInfo[2].split('.');
                const major = parseInt(version[0]);
                if (major > 22 || (major == 22 && parseInt(version[1]) >= 1)) {
                    return {
                        version: versionInfo[2],
                        edition: 'ee',
                        java: javaVersion
                    }
                } else {
                    const rawData = await get(gdsUtils.getGDSUrl(), /^application\/json/) ?? '{}';
                    return Object.values(JSON.parse(rawData).Releases).find((release: any) => release.version === versionInfo[2] && release.java === javaVersion);
                }
            }
        }
    }
    return undefined;
}

function processsGUOutput(stdout: string, isJson: boolean = false): Component[] {
    let components: Component[];
    if (isJson) {
        components = JSON.parse(stdout).components;
    } else {
        components = [];
        let component: any = undefined;
        stdout.split('\n').forEach((line: string) => {
            if (line.startsWith("ID")) {
                if (component !== undefined) {
                    components.push(component);
                }
                component = {};
            } else if (component === undefined) {
                return;
            }
            const index = line.indexOf(':');
            if (index === -1) {
                return;
            }
            component[`${line.slice(0, index).trim().toLowerCase()}`] = line.slice(index + 1).trim();
        });
        if (component !== undefined) {
            components.push(component);
        }
    }
    assert(components.every(component => 'id' in component && 'name' in component), "GU catalog doesn't contain necessary values.");
    return components;
}

export class InstallationNodeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> = this._onDidChangeTreeData.event;

        constructor(public readonly context: vscode.ExtensionContext) {
        }

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
		if (element instanceof Installation) {
            return getAvailableComponents(element.home).then(components => {
                const ret: vscode.TreeItem[] = [new InstallationFolder(element.home)];
                components.forEach((comp: Component) => {
                    ret.push(new TreeItemComponent(element, comp.name, comp.id, comp, comp.installed));
                });
                return ret;
            }).catch(out => {
                const ret: vscode.TreeItem[] = [new InstallationFolder(element.home)];
                if (out.list) {
                    out.list.forEach((comp: Component) => 
                        ret.push(new TreeItemComponent(element, comp.name, comp.id, comp, comp.installed)));
                    ret.push(new ConnectionError('Could not resolve components', out?.error?.message));
                } else {
                    if (out?.message === NO_GU_FOUND && process.platform === 'linux') {
                        ret.push(new NoGU('Components managed by package manager', 'Use the package manager used to install this GraalVM instance to manage its components.'));
                    } else {
                        ret.push(new GUError('Component resolution failed', out?.message));
                    }
                }
                return ret;
            });
		} else {
            const graalVMHome = getGVMHome();
            const writable = utils.checkFolderWritePermissions(graalVMHome, true);
            return findGraalVMs(this.context).then(vms => {
                return vms.map(item => new Installation(item.name, vscode.TreeItemCollapsibleState.Collapsed, item.path, item.path === graalVMHome, writable));
            });
		}
	}
}

export class Installation extends vscode.TreeItem {

	constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly home: string,
        private readonly active: boolean,
        public readonly writable: boolean
	) {
        super(label, collapsibleState);
        if (active) {
            this.description = '(active)';
        }
	}

    iconPath = new vscode.ThemeIcon(this.active ? "vm-active" : "vm");
    contextValue = this.active ? 'graalvmInstallationActive' : 'graalvmInstallation';
}

export class TreeItemComponent extends vscode.TreeItem {

	constructor(
        public readonly installation: Installation,
        public readonly label: string,
        public readonly componentId: string,
        public readonly component: Component,
        private readonly installed?: boolean,
	) {
		super(label);
        if (installed) {
            this.description = '(installed)';
        }
        if (!this.installation.writable) {
            this.tooltip = `Permission denied: no write access to ${this.installation.home}`;
        }
	}

    iconPath = new vscode.ThemeIcon("extensions");
    contextValue = this.installation.writable ? this.installed ? 'graalvmComponentInstalled' : 'graalvmComponent': 'graalvmLocked';
}

class InstallationFolder extends vscode.TreeItem {
    
    iconPath =  new vscode.ThemeIcon("folder-opened");
    contextValue = 'graalvmInstallationFolder';
}

class ConnectionError extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly tooltip?: string,
	) {
        super(label);
    }
    
    iconPath = new vscode.ThemeIcon("error");
    contextValue = 'graalvmConnectionError';
}

class GUError extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly tooltip?: string,
	) {
        super(label);
    }
    
    iconPath = new vscode.ThemeIcon("error");
    contextValue = 'graalvmGUError';
}

class NoGU extends vscode.TreeItem {

    constructor(
        public readonly label: string,
        public readonly tooltip?: string,
	) {
        super(label);
    }
    
    iconPath = new vscode.ThemeIcon("extensions");
    contextValue = 'graalVMNoGU';
}
