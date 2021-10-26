/*
 * Copyright (c) 2019, 2021, Oracle and/or its affiliates. All rights reserved.
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
import { basename, dirname, join, normalize, delimiter } from 'path';
import { LicenseCheckPanel } from './graalVMLicenseCheck';
import { ConfigurationPickItem, getGVMHome, getConf, getGVMConfig, configureGraalVMHome, getGVMInsts, setGVMInsts, setupProxy, checkGraalVMconfiguration, removeGraalVMconfiguration, getTerminalEnv, setTerminalEnv, getTerminalEnvName } from './graalVMConfiguration';
import { startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { isSDKmanPresent, obtainSDKmanGVMInstallations } from './sdkmanSupport';

const GITHUB_URL: string = 'https://api.github.com';
const GRAALVM_RELEASES_URL: string = GITHUB_URL + '/repos/graalvm/graalvm-ce-builds/releases';
const GRAALVM_DEV_RELEASES_URL: string = GITHUB_URL + '/repos/graalvm/graalvm-ce-dev-builds/releases';
const GDS_URL: string = 'https://oca.opensource.oracle.com/gds/meta-data.json';
const LINUX_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-linux-amd64-\S*/gmi;
const MAC_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-(darwin|macos)-amd64-\S*/gmi;
const WINDOWS_LINK_REGEXP: RegExp = /graalvm-ce-java\S*-windows-amd64-\S*/gmi;
const INSTALL: string = 'Install ';
const OPTIONAL_COMPONENTS: string = 'Optional GraalVM Components';
const GRAALVM_EE_LICENSE: string = 'GraalVM Enterprise Edition License';
const LAST_GRAALVM_PARENTDIR: string = 'lastGraalVMInstallationParentDir';
const INSTALL_GRAALVM: string = 'Install GraalVM';
const SELECT_EXISTING_GRAALVM: string = 'Select Existing GraalVM';
const SELECT_ACTIVE_GRAALVM: string = 'Set Active GraalVM';
const NO_GU_FOUND: string = 'Cannot find runtime \'gu\' within your GraalVM installation.';

const lockedComponentIds: string[] = [];

export function setupGraalVM(warning: boolean = false) {
	findGraalVMs().then(vms => {
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
                const downloadedFile = await dowloadGraalVMRelease(selected.url, selected.location);
                const targetDir = dirname(downloadedFile);
                const name = await extractGraalVM(downloadedFile, targetDir);
                if (name) {
                    fs.unlinkSync(downloadedFile);
                    let graalVMHome = join(targetDir, name);
                    if (process.platform === 'darwin') {
                        graalVMHome = join(graalVMHome, 'Contents', 'Home');
                    }
                    updateGraalVMLocations(graalVMHome);
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

export async function removeGraalVMInstallation(homeFolder?: string) {
    if (!homeFolder) {
        homeFolder = await _selectInstalledGraalVM(true);
    }
    const graalFolder = homeFolder;
    if (!graalFolder) {
        return -1;
    }
    await removeGraalVMconfiguration(graalFolder);
    if (isImplicitGraalVM(graalFolder)) {
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

export async function installGraalVMComponent(component: string | Component | undefined, homeFolder?: string, context?: vscode.ExtensionContext): Promise<void> {
    _callIdGVMHome(component, homeFolder, context, _installGraalVMComponent);
}

export async function uninstallGraalVMComponent(component: string | Component | undefined, homeFolder?: string): Promise<void> {
    _callIdGVMHome(component, homeFolder, undefined, _uninstallGraalVMComponent);
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
            updateGraalVMLocations(graalVMHome);
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

export async function selectActiveGraalVM(graalVMHome?: string, nonInteractive?: boolean): Promise<void> {
    graalVMHome = graalVMHome || await _selectInstalledGraalVM(true);
    if (graalVMHome) {
        const graalVMVersion = await getGraalVMVersion(graalVMHome);
        if (graalVMVersion) {
            await configureGraalVMHome(graalVMHome, nonInteractive);
        }
    }
}

export async function findGraalVMs(): Promise<{name: string, path: string}[]> {
    const paths: string[] = [];
    const comparator = utils.isSamePath();
    addPathToJava(normalize(getGVMHome()), paths, comparator);
    const installations = getGVMInsts().map(inst => normalize(inst));
    installations.forEach(installation => addPathToJava(installation, paths, comparator, true));
    findImplicitGraalVMs(paths, comparator);
    const vms: {name: string, path: string}[] = [];
    for (let i = 0; i < paths.length; i++) {
        const version = await getGraalVMVersion(paths[i]);
        if (version) {
            vms.push({name: version, path: paths[i]});
        }
    }
    return vms;
}

function findImplicitGraalVMs(paths: string[], comparator = utils.isSamePath()) {
    if (getConf('graalvm').get('systemDetect')) {
        addPathsToJavaIn('/opt', paths, comparator);
        if (process.env.GRAALVM_HOME) {
            addPathToJava(normalize(process.env.GRAALVM_HOME), paths, comparator);
        }
        if (process.env.JAVA_HOME) {
            addPathToJava(normalize(process.env.JAVA_HOME), paths, comparator);
        }
        if (process.env.PATH) {
            process.env.PATH.split(delimiter)
                .filter(p => basename(p) === 'bin')
                .forEach(p => addPathToJava(dirname(p), paths, comparator));
        }
        obtainSDKmanGVMInstallations()
            .forEach(p => addPathToJava(normalize(p[0]), paths, comparator));
    }
}

function isImplicitGraalVM(path: string): boolean {
    const paths: string[] = [];
    findImplicitGraalVMs(paths);
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
                        stderr.split('\n').forEach((line, idx) => {
                            switch (idx) {
                                case 0:
                                    const javaInfo: string[] | null = line.match(/version\s+\"(\S+)\"/);
                                    if (javaInfo && javaInfo.length > 1) {
                                        javaVersion = javaInfo[1];
                                    }
                                    break;
                                case 2:
                                    const vmInfo = line.match(/(GraalVM.*)\s+\(/);
                                    if (vmInfo && vmInfo.length > 1) {
                                        graalVMVersion = vmInfo[1];
                                    }
                                    break;
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

export function getInstallConfigurations(): ConfigurationPickItem[] {
    const ret: ConfigurationPickItem[] = [];

    ret.push(new ConfigurationPickItem(
        'Set as default Java',
        '(java.home)',
        _graalVMHome => vscode.extensions.getExtension('redhat.java') !== undefined,
        graalVMHome => getConf('java').get('home') === graalVMHome,
        async graalVMHome => getConf('java').update('home', graalVMHome, true),
        async _graalVMHome => getConf('java').update('home', undefined, true))
    );
    
    let section: string = getTerminalEnvName();
    ret.push(new ConfigurationPickItem(
        'Set as Java for Terminal',
        `(JAVA_HOME in ${section})`,
        _graalVMHome => !isSDKmanPresent(),
        graalVMHome => getTerminalEnv().JAVA_HOME === graalVMHome,
        async graalVMHome => {
            const env: any = getTerminalEnv();
            env.JAVA_HOME = graalVMHome;
            return setTerminalEnv(env);
        },
        async _graalVMHome => {
            const env: any = getTerminalEnv();
            env.JAVA_HOME = undefined;
            return setTerminalEnv(env);
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
            return setTerminalEnv(env);
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
            return setTerminalEnv(env);
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
    const available = await getAvailableComponents(homeFolder);
    const components = available.filter(availableItem => !availableItem.installed);
    if (components.length > 1) {
        const itemText = INSTALL + OPTIONAL_COMPONENTS;
        return utils.ask('Optional GraalVM components are not installed in your GraalVM.', [
            {option: itemText, fnc: () => vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', undefined, homeFolder)}
        ]);
    } else if (components.length === 1) {
        const itemText = INSTALL + components[0].detail;
        return utils.ask(components[0].detail + ' is not installed in your GraalVM.', [
            {option: itemText, fnc: () => vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', components[0].label, homeFolder)}
        ]);
    }
}

async function _selectInstalledGraalVM(explicit: boolean): Promise<string | undefined>{
    const vms: {label: string, detail: string}[] = (await findGraalVMs()).map(item => {
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

async function selectGraalVMRelease(context: vscode.ExtensionContext): Promise<{url: string, location: string, installdir: string} | undefined> {

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
            const license = await get(releaseInfos[state.graalVMVersion.label][state.javaVersion.label].license, /^text\/plain/);
            let email: string | undefined;
            if (license) {
                const licenseLabel = releaseInfos[state.graalVMVersion.label][state.javaVersion.label].licenseLabel;
                email = await LicenseCheckPanel.show(context, licenseLabel, license.split('\n').join('<br>'));
            }
            if (!email) {
                return undefined;
            } 
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
                            } else {
                                token.onCancellationRequested(() => {
                                    reject();
                                    res.destroy();
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
                                });
                            }
                        }
                    }).on('error', e => {
                        reject(e);
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

async function _callIdGVMHome(component: string | Component | undefined, homeFolder: string | undefined, context: vscode.ExtensionContext | undefined, fnc: (id: string | undefined, graalVMHome: string, context: vscode.ExtensionContext | undefined) => Promise<void>): Promise<void>{
    if (component instanceof Component) {
        return fnc(component.componentId, component.installation.home, context);
    } else {
        homeFolder = homeFolder || await _selectInstalledGraalVM(false);
        if (homeFolder) {
            return fnc(component, homeFolder, context);
        }
    }
}

async function _installGraalVMComponent(componentId: string | undefined, graalVMHome: string, context?: vscode.ExtensionContext): Promise<void> {
    if (utils.checkFolderWritePermissions(graalVMHome)) {
        const componentIds: string[] = componentId ? [componentId] : await selectAvailableComponents(graalVMHome).catch((error) => {
            vscode.window.showWarningMessage(error.toString().replace('Error: ', ''));
            return [];
        });
        changeGraalVMComponent(graalVMHome, componentIds, 'install', context);
    }
}

async function _uninstallGraalVMComponent(componentId: string | undefined, graalVMHome: string): Promise<void> {
    if (utils.checkFolderWritePermissions(graalVMHome)) {
        const componentIds: string[] = componentId ? [componentId] : await selectInstalledComponents(graalVMHome).catch((error) => {
            vscode.window.showWarningMessage(error.toString().replace('Error: ', ''));
            return [];
        });
        changeGraalVMComponent(graalVMHome, componentIds.reverse(), 'remove');
    }
}

function lockComponents(graalVMHome: string, componentIds: string[]): string[] {
    return componentIds.filter((element) => {
        const key = graalVMHome + element;
        if (lockedComponentIds.indexOf(key) === -1) {
            lockedComponentIds.push(key);
            return true;
        }
        return false;
    });
}

function unlockComponents(graalVMHome: string, componentIds: string[]): void {
    componentIds.forEach((element) => {
        const idx = lockedComponentIds.indexOf(graalVMHome + element);
        if (idx !== -1) {
            lockedComponentIds.splice(idx, 1);
        }
    });
}

async function changeGraalVMComponent(graalVMHome: string, componentIds: string[], action: string, context?: vscode.ExtensionContext): Promise<void> {
    componentIds = lockComponents(graalVMHome, componentIds);
    if (componentIds.length === 0) {
        return;
    }
    const executablePath = await getGU(graalVMHome);
    let email: string | undefined;
    const eeInfo: any = action === 'install' ? await getEEReleaseInfo(graalVMHome) : undefined;
    if (eeInfo && context) {
        const license = await get(eeInfo.license, /^text\/plain/);
        if (license) {
            email = await LicenseCheckPanel.show(context, eeInfo.licenseLabel, license.split('\n').join('<br>'));
        }
        if (!email) {
            unlockComponents(graalVMHome, componentIds);
            return;
        }
    }
    if (action === 'remove' && graalVMHome === getGVMHome()) {
        await stopLanguageServer();
    }
    const args = eeInfo ? eeInfo.version.split('.')[0] >= 21 ? `--custom-catalog ${eeInfo.catalog} -A --email ${email} ` : `--custom-catalog ${eeInfo.catalog} -A ` : '';
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `${action === 'install' ? 'I' : 'Uni'}nstalling GraalVM Component${componentIds.length > 1 ? 's' : ' ' + componentIds[0]} of: "${await getGraalVMVersion(graalVMHome)}"`,
        cancellable: componentIds.length > 1
    }, async (progress, token) => {
        const incr = 100/componentIds.length;
        for (const id of componentIds) {
            if (token.isCancellationRequested) {
                return;
            }
            if (incr !== 100) {
                progress.report({message: id, increment: incr});
            }
            try {
                await execCancellable(`${executablePath} ${action} ${args}${id}`, token, { cwd: join(graalVMHome, 'bin') });
                await checkGraalVMconfiguration(graalVMHome);
            } catch (error) {
                vscode.window.showWarningMessage(error?.message);
            }
        }
        return;
    }).then(() => {
        vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
        if (graalVMHome === getGVMHome()) {
            if (action === 'remove') {
                startLanguageServer(graalVMHome);
            } else {
                stopLanguageServer().then(() => startLanguageServer(graalVMHome));
            }
        }
        unlockComponents(graalVMHome, componentIds);
    });
}

function execCancellable(cmd: string, token: vscode.CancellationToken, options?: ({ encoding?: string | null | undefined; } & cp.ExecOptions) | null | undefined): Promise<boolean> {
    return new Promise((resolve, reject) => {
        let resolved: boolean = false;
        const child = cp.exec(cmd, options, (error, _stdout, _stderr) => {
            if (error || _stderr) {
                if (!resolved) reject(error ?? new Error(_stderr.toString()));
            } else {
                resolve(true);
            }
        });
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

function makeGUProxy(executable:string, proxy?: string): string {
    if (!proxy || getConf('http').get('proxySupport') !== 'off') {
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
        throw new Error('Cannot get data from server: ' + err.message);
    }).then(urls => {
        const merged: string[] = Array.prototype.concat.apply([], urls);
        if (merged.length === 0) {
            throw new Error(`No GraalVM installable found for platform ${process.platform}`);
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
    return get(GDS_URL, /^application\/json/).catch(err => {
        throw new Error('Cannot get data from server: ' + err.message);
    }).then(rawData => {
        const releases: any = {};
        if (!rawData) {
            return releases;
        }
        const info = JSON.parse(rawData);
        let platform: string = process.platform;
        if (platform === 'win32') {
            platform = 'windows';
        }
        Object.values(info.Releases)
        .filter((releaseInfo: any) => Object.keys(releaseInfo.base).find(base => releaseInfo.base[base].os === platform) !== undefined)
        .forEach((releaseInfo: any) => {
            if (releaseInfo.version && releaseInfo.java && releaseInfo.license && releaseInfo.status === 'new') {
                const releaseVersion = releases[releaseInfo.version] ?? (releases[releaseInfo.version] = {});
                let releaseJavaVersion = releaseVersion[releaseInfo.java];
                if (!releaseJavaVersion) {
                    const arch = utils.getArch();
                    const base: string | undefined = Object.keys(releaseInfo.base)
                        .find(base => releaseInfo.base[base].os === platform && releaseInfo.base[base].arch === arch);
                    if (base) {
                        releaseVersion[releaseInfo.java] = releaseJavaVersion = {};
                        releaseJavaVersion.url = releaseInfo.base[base].url;
                        releaseJavaVersion.license = releaseInfo.license;
                        releaseJavaVersion.licenseLabel = releaseInfo.licenseLabel || GRAALVM_EE_LICENSE;
                    }
                }
            }
        });
        return releases;
    });
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
        let regex: RegExp;
        if (process.platform === 'linux') {
            regex = LINUX_LINK_REGEXP;
        } else if (process.platform === 'darwin') {
            regex = MAC_LINK_REGEXP;
        } else if (process.platform === 'win32') {
            regex = WINDOWS_LINK_REGEXP;
        } else {
            return ret;
        }
        const data: { assets?: { browser_download_url?: string }[] }[] = JSON.parse(rawData);
        data.forEach(release => {
            release.assets?.forEach(asset => {
                if (asset.browser_download_url?.match(regex)) {
                    ret.push(asset.browser_download_url);
                }
            });
        });
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

function updateGraalVMLocations(homeFolder: string) {
    homeFolder = normalize(homeFolder);
    const gr = getGVMConfig();
    const installations = getGVMInsts(gr);
    if (!installations.find(item => item === homeFolder)) {
        getGraalVMVersion(homeFolder).then(version => {
            if (version) {
                installations.push(homeFolder);
                setGVMInsts(gr, installations);
                const graalVMHome = getGVMHome(gr);
                if (!graalVMHome) {
                    configureGraalVMHome(homeFolder);

                } else if (graalVMHome !== homeFolder) {
                    utils.askYesNo(`Set ${version} as active GraalVM?`, () => configureGraalVMHome(homeFolder));
                }
            } else {
                vscode.window.showErrorMessage('Failed to add the selected GraalVM installation');
            }
        });
    }
}

function addPathsToJavaIn(folder: string, paths: string[], comparator = utils.isSamePath()) {
    if (folder && fs.existsSync(folder) && fs.statSync(folder).isDirectory) {
        fs.readdirSync(folder).map(f => join(folder, f)).map(p => {
            if (process.platform === 'darwin') {
                let homePath: string = join(p, 'Contents', 'Home');
                return fs.existsSync(homePath) ? homePath : p;
            }
            return p;
        }).filter(p => fs.statSync(p).isDirectory()).forEach(p => addPathToJava(p, paths, comparator));
    }
}

function addPathToJava(folder: string, paths: string[], comparator = utils.isSamePath(), removeOnEmpty: boolean = false): void {
    const executable: string | undefined = utils.findExecutable('java', folder);
    if (!executable) {
        if (removeOnEmpty) {
            removeGraalVMconfiguration(folder);
        }
        return;
    }
    folder = normalize(join(dirname(fs.realpathSync(executable)), '..'));
    if (!paths.find(comparator(folder))) {
        paths.push(folder);
    }
}

async function selectAvailableComponents(graalVMHome: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        getAvailableComponents(graalVMHome).then(async available => {
            const components = available.filter(availableItem => !availableItem.installed);
            if (components.length > 0) {
                vscode.window.showQuickPick(components, { placeHolder: `Select GraalVM components to install to: "${await getGraalVMVersion(graalVMHome)}"`, canPickMany: true }).then(selected => {
                    if (selected) {
                        resolve(selected.map(component => component.label));
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

async function selectInstalledComponents(graalVMHome: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        getAvailableComponents(graalVMHome).then(async available => {
            const components = available.filter(availableItem => availableItem.installed);
            if (components.length > 0) {
                vscode.window.showQuickPick(components, { placeHolder: `Select GraalVM components to uninstall from: "${await getGraalVMVersion(graalVMHome)}"`, canPickMany: true }).then(selected => {
                    if (selected) {
                        resolve(selected.map(component => component.label));
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

async function getAvailableComponents(graalVMHome: string): Promise<{label: string, detail: string, installed?: boolean}[]> {
    return new Promise<{label: string, detail: string, installed?: boolean}[]>((resolve, reject) => {
        getGU(graalVMHome).then(executablePath => {
            const binGVM = join(graalVMHome, 'bin');
            cp.exec(`${executablePath} list`, { cwd: binGVM }, (error, stdout, _stderr) => {
                if (error || _stderr) {
                    reject(error ?? new Error(_stderr));
                } else {
                    const installed: {label: string, detail: string, installed?: boolean}[] = processsGUOutput(stdout);
                    getEEReleaseInfo(graalVMHome).then(eeInfo => {
                        if (eeInfo) {
                            const args = ['available', '--custom-catalog', `${eeInfo.catalog}`];
                            cp.exec(`${executablePath} ${args.join(' ')}`, { cwd: binGVM }, (error: any, stdout: string, _stderr: any) => {
                                if (error || _stderr) {
                                    notifyConnectionProblem();
                                    reject({error: error ?? new Error(_stderr), list: installed.map(inst => {inst.installed = true; return inst; }) });
                                } else {
                                    const available: {label: string, detail: string, installed?: boolean}[] = processsGUOutput(stdout);
                                    available.forEach(avail => {
                                        const found = installed.find(item => item.label === avail.label);
                                        avail.installed = found ? true : false;
                                    });
                                    resolve(available);
                                }
                            });
                        } else {
                            const args = ['available'];
                            cp.exec(`${executablePath} ${args.join(' ')}`, { cwd: binGVM }, (error: any, stdout: string, _stderr: any) => {
                                if (error || _stderr) {
                                    notifyConnectionProblem();
                                    reject({error: error ?? new Error(_stderr), list: installed.map(inst => {inst.installed = true; return inst; }) });
                                } else {
                                    const available: {label: string, detail: string, installed?: boolean}[] = processsGUOutput(stdout);
                                    available.forEach(avail => {
                                        const found = installed.find(item => item.label === avail.label);
                                        avail.installed = found ? true : false;
                                    });
                                    resolve(available);
                                }
                            });
                        }
                    }).catch(error => {
                        reject({error: error, list: installed.map(inst => {inst.installed = true; return inst; }) });
                    });
                }
            });
        }).catch(err => reject(err));
    });
}

async function notifyConnectionProblem(){
    const select = await vscode.window.showWarningMessage("Could not resolve GraalVM components. Check your connection and verify proxy settings.", 'Setup proxy');
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
                const rawData = await get(GDS_URL, /^application\/json/) ?? '{}';
                return Object.values(JSON.parse(rawData).Releases).find((release: any) => release.version === versionInfo[2] && release.java === javaVersion);
            }
        }
    }
    return undefined;
}

const reg: RegExp = /(\S+( \S)?)+/g;
function processsGUOutput(stdout: string): {label: string, detail: string}[] {
    const components: {label: string, detail: string}[] = [];
    let header: boolean = true;
    let head: string;
    let maxLength: number = 4;
    stdout.split('\n').forEach((line: string) => {
        if (header) {
            if (line.startsWith('-----')) {
                header = false;
                const headMatch: string[] | null = head.match(reg);
                if (headMatch) {
                    maxLength = Math.max(headMatch.length, maxLength);
                }
            } else {
                head = line;
            }
        } else {
            const info: string[] | null = line.match(reg);
            if(info && info.length == maxLength) {
                components.push({ label: info[0], detail: info[2] });
            }
        }
    });
    return components;
}

export class InstallationNodeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> = this._onDidChangeTreeData.event;

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
                components.forEach((comp: { detail: string; label: string; installed?: boolean; }) => {
                    ret.push(new Component(element, comp.detail, comp.label, comp.installed));
                });
                return ret;
            }).catch(out => {
                const ret: vscode.TreeItem[] = [new InstallationFolder(element.home)];
                if (out.list) {
                    out.list.forEach((comp: { detail: string; label: string; installed?: boolean; }) => 
                        ret.push(new Component(element, comp.detail, comp.label, comp.installed)));
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
            return findGraalVMs().then(vms => {
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

export class Component extends vscode.TreeItem {

	constructor(
        public readonly installation: Installation,
        public readonly label: string,
        public readonly componentId: string,
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
