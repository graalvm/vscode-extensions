/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as decompress from 'decompress';
import { getMicronautHome, getMicronautLaunchURL, getJavaHome, MultiStepInput } from "./utils";

const HTTP_PROTOCOL: string = 'http://';
const HTTPS_PROTOCOL: string = 'https://';
const MICRONAUT_LAUNCH_URL: string = 'https://launch.micronaut.io';
const MICRONAUT_SNAPSHOT_URL: string = 'https://snapshot.micronaut.io';
const APPLICATION_TYPES: string = '/application-types';
const SELECT_OPTIONS: string = '/select-options';
const FEATURES: string = '/features';
const VERSIONS: string = '/versions';
const CREATE: string = '/create';
const OPEN_IN_NEW_WINDOW = 'Open in new window';
const OPEN_IN_CURRENT_WINDOW: string = 'Open in current window';
const ADD_TO_CURRENT_WORKSPACE = 'Add to current workspace';
const LAST_PROJECT_PARENTDIR: string = 'lastMicronautProjectParentDir';

let cliMNVersion: {label: string, serviceUrl: string, description: string} | undefined;

export async function creatorInit() {
    cliMNVersion = undefined;
    const micronautHome: string = getMicronautHome();
    if (micronautHome) {
        let mnPath = path.join(micronautHome, 'bin', 'mn');
        if (process.platform === 'win32') {
            mnPath += '.bat';
        }
        if (fs.existsSync(mnPath)) {
            try {
                const info: string[] | null = cp.execFileSync(mnPath, ['--version'], { env: { JAVA_HOME: getJavaHome() } }).toString().match(/.*:\s*(\S*)/);
                if (info && info.length >= 2) {
                    cliMNVersion = { label: info[1], serviceUrl: mnPath, description: '(using local CLI)' };
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Cannot get Micronaut version: ${e}`);
            }
        }
    }
}

export async function createProject(context: vscode.ExtensionContext) {
    const options = await selectCreateOptions(context);
    if (options) {
        let created = false;
        if (options.url.startsWith(HTTP_PROTOCOL) || options.url.startsWith(HTTPS_PROTOCOL)) {
            try {
                const downloadedFile = await downloadProject(options);
                const files = await decompress(downloadedFile, options.target, { strip: 1 });
                fs.unlinkSync(downloadedFile);
                created = files.length > 0;
            } catch (e) {
                fs.rmdirSync(options.target, { recursive: true });
                vscode.window.showErrorMessage(`Cannot create Micronaut project: ${e}`);
            }
        } else {
            try {
                const out = cp.execFileSync(options.url, options.args, { cwd: path.dirname(options.target), env: {JAVA_HOME: getJavaHome() } });
                created = out.toString().indexOf('Application created') >= 0;
            } catch (e) {
                vscode.window.showErrorMessage(`Cannot create Micronaut project: ${e.message}`);
            }
        }
        if (created) {
            if (options.java) {
                const commands: string[] = await vscode.commands.getCommands();
                if (commands.includes('extension.graalvm.selectGraalVMHome')) {
                    await vscode.commands.executeCommand('extension.graalvm.selectGraalVMHome', options.java, true);
                }
            }
            const uri = vscode.Uri.file(options.target);
            if (vscode.workspace.workspaceFolders) {
                const value = await vscode.window.showInformationMessage('New Micronaut project created', OPEN_IN_NEW_WINDOW, ADD_TO_CURRENT_WORKSPACE);
                if (value === OPEN_IN_NEW_WINDOW) {
                    await vscode.commands.executeCommand('vscode.openFolder', uri, true);
                } else if (value === ADD_TO_CURRENT_WORKSPACE) {
                    vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, undefined, { uri });
                }
            } else if (vscode.window.visibleTextEditors.length > 0) {
                const value = await vscode.window.showInformationMessage('New Micronaut project created', OPEN_IN_NEW_WINDOW, OPEN_IN_CURRENT_WINDOW);
                if (value) {
                    await vscode.commands.executeCommand('vscode.openFolder', uri, OPEN_IN_NEW_WINDOW === value);
                }
            } else {
                await vscode.commands.executeCommand('vscode.openFolder', uri, false);
            }
        }
    }
}

async function selectCreateOptions(context: vscode.ExtensionContext): Promise<{url: string, args?: string[], name: string, target: string, buildTool: string, java?: string} | undefined> {

    const commands: string[] = await vscode.commands.getCommands();
    const graalVMs: {name: string, path: string, active: boolean}[] = commands.includes('extension.graalvm.findGraalVMs') ? await vscode.commands.executeCommand('extension.graalvm.findGraalVMs') || [] : [];

    interface State {
		micronautVersion: {label: string, serviceUrl: string};
		applicationType: {label: string, name: string};
        javaVersion: {label: string, value: string, target: string};
        projectName: string;
        basePackage: string;
        language: {label: string, value: string};
        features: {label: string, detail: string, name: string}[];
        buildTool: {label: string, value: string};
        testFramework: {label: string, value: string};
	}

	async function collectInputs(): Promise<State> {
		const state = {} as Partial<State>;
        await MultiStepInput.run(input => pickMicronautVersion(input, state));
		return state as State;
	}

    const title = 'Create Micronaut Project';

    /**
     * Compute total steps based on state/selections made.
     * @param state current state
     * @returns total steps
     */
    function totalSteps(_ : Partial<State>) : number {
        return 9;
    }

	async function pickMicronautVersion(input: MultiStepInput, state: Partial<State>) {
        const selected: any = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: totalSteps(state),
			placeholder: 'Pick Micronaut version',
			items: await getMicronautVersions(),
			activeItems: state.micronautVersion,
			shouldResume: () => Promise.resolve(false)
        });
        state.micronautVersion = selected;
		return (input: MultiStepInput) => pickApplicationType(input, state);
	}

	async function pickApplicationType(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: totalSteps(state),
			placeholder: 'Pick application type',
			items: state.micronautVersion ? await getApplicationTypes(state.micronautVersion) : [],
			activeItems: state.applicationType,
			shouldResume: () => Promise.resolve(false)
        });
        state.applicationType = selected;
		return (input: MultiStepInput) => pickJavaVersion(input, state);
	}

	async function pickJavaVersion(input: MultiStepInput, state: Partial<State>) {
        const items: {label: string, value: string, description?: string}[] = graalVMs.map(item => ({label: item.name, value: item.path, description: item.active ? '(active)' : undefined}));
        items.push({label: 'Other Java', value: '', description: '(manual configuration)'});
		const selected: any = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: totalSteps(state),
			placeholder: graalVMs.length > 0 ? 'Pick project Java' : 'Pick project Java (no GraalVM registered)',
			items,
			activeItems: state.javaVersion,
			shouldResume: () => Promise.resolve(false)
        });
        const version: string[] | null = selected ? selected.label.match(/Java (\d+)/) : null;
        const resolvedVersion = version && version.length > 1 ? version[1] : undefined;
        const supportedVersions = state.micronautVersion ? await getJavaVersions(state.micronautVersion) : [];
        const javaVersion = normalizeJavaVersion(resolvedVersion, supportedVersions);
        state.javaVersion = {
            label: selected.label,
            value: selected.value,
            target: javaVersion
        }
        if (!resolvedVersion) {
            vscode.window.showInformationMessage('Java version not selected. The project will target Java 8. Adjust the setting in the generated project file(s).');
        }
		return (input: MultiStepInput) => projectName(input, state);
	}

	async function projectName(input: MultiStepInput, state: Partial<State>) {
		state.projectName = await input.showInputBox({
			title,
			step: 4,
			totalSteps: totalSteps(state),
			value: state.projectName || 'demo',
			prompt: 'Provide project name',
			validate: () => Promise.resolve(undefined),
			shouldResume: () => Promise.resolve(false)
		});
		return (input: MultiStepInput) => basePackage(input, state);
	}

	async function basePackage(input: MultiStepInput, state: Partial<State>) {
		state.basePackage = await input.showInputBox({
			title,
			step: 5,
			totalSteps: totalSteps(state),
			value: state.basePackage || 'com.example',
			prompt: 'Provide base package',
			validate: () => Promise.resolve(undefined),
			shouldResume: () => Promise.resolve(false)
		});
		return (input: MultiStepInput) => pickLanguage(input, state);
	}

	async function pickLanguage(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 6,
			totalSteps: totalSteps(state),
            placeholder: 'Pick project language',
            items: getLanguages(),
            activeItems: state.language,
			shouldResume: () => Promise.resolve(false)
        });
        state.language = selected;
		return (input: MultiStepInput) => pickFeatures(input, state);
	}

	async function pickFeatures(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 7,
			totalSteps: totalSteps(state),
            placeholder: 'Pick project features',
            items: state.micronautVersion && state.applicationType && state.javaVersion ? await getFeatures(state.micronautVersion, state.applicationType, state.javaVersion) : [],
            activeItems: state.features,
            canSelectMany: true,
			shouldResume: () => Promise.resolve(false)
        });
        state.features = selected;
		return (input: MultiStepInput) => pickBuildTool(input, state);
	}

	async function pickBuildTool(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 8,
			totalSteps: totalSteps(state),
            placeholder: 'Pick build tool',
            items: getBuildTools(),
            activeItems: state.buildTool,
			shouldResume: () => Promise.resolve(false)
        });
        state.buildTool = selected;
		return (input: MultiStepInput) => pickTestFramework(input, state);
	}

	async function pickTestFramework(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 9,
			totalSteps: totalSteps(state),
            placeholder: 'Pick test framework',
            items: getTestFrameworks(),
            activeItems: state.testFramework,
			shouldResume: () => Promise.resolve(false)
        });
        state.testFramework = selected;
	}

    const state = await collectInputs();

    if (state.micronautVersion && state.applicationType && state.projectName && state.basePackage &&
        state.language && state.features && state.buildTool && state.testFramework) {
        const lastProjectParentDir: string | undefined = context.globalState.get(LAST_PROJECT_PARENTDIR);
        let defaultDir: vscode.Uri | undefined;
        if (lastProjectParentDir) {
            try {
                defaultDir = vscode.Uri.parse(lastProjectParentDir, true);
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
            title: 'Choose Project Directory',
            openLabel: 'Create Here'
        });
        if (location && location.length > 0) {
            await context.globalState.update(LAST_PROJECT_PARENTDIR, location[0].toString());
            let appName = state.basePackage;
            if (appName) {
                appName += '.' + state.projectName;
            } else {
                appName = state.projectName;
            }
            if (state.micronautVersion.serviceUrl.startsWith(HTTP_PROTOCOL) || state.micronautVersion.serviceUrl.startsWith(HTTPS_PROTOCOL)) {
                let query = `?javaVersion=JDK_${state.javaVersion.target}`;
                query += `&lang=${state.language.value}`;
                query += `&build=${state.buildTool.value}`;
                query += `&test=${state.testFramework.value}`;
                state.features.forEach((feature: {label: string, detail: string, name: string}) => {
                    query += `&features=${feature.name}`;
                });
                return {
                    url: state.micronautVersion.serviceUrl + CREATE + '/' + state.applicationType.name + '/' + appName + query,
                    name: state.projectName,
                    target: path.join(location[0].fsPath, state.projectName),
                    buildTool: state.buildTool.value,
                    java: state.javaVersion && state.javaVersion.value.length > 0 ? state.javaVersion.value : undefined
                };
            }
            let args = [state.applicationType.name];
            args.push(`--java-version=${state.javaVersion.target}`);
            args.push(`--lang=${state.language.value}`);
            args.push(`--build=${state.buildTool.value}`);
            args.push(`--test=${state.testFramework.value}`);
            if (state.features.length > 0) {
                let value: string = '';
                state.features.forEach((feature: {label: string, detail: string, name: string}) => {
                    value += value ? `,${feature.name}` : feature.name;
                });
                args.push(`--features=${value}`);
            }
            args.push(appName);
            return {
                url: state.micronautVersion.serviceUrl,
                args,
                name: state.projectName,
                target: path.join(location[0].fsPath, state.projectName),
                buildTool: state.buildTool.value,
                java: state.javaVersion && state.javaVersion.value.length > 0 ? state.javaVersion.value : undefined
            };
        }
    }
    return undefined;
}

async function getMicronautVersions(): Promise<{label: string, serviceUrl: string}[]> {
    const micronautLauchURL: string = getMicronautLaunchURL();
    return Promise.all([
        get(MICRONAUT_LAUNCH_URL + VERSIONS).catch(() => undefined).then(data => {
            return data ? { label: JSON.parse(data).versions["micronaut.version"], serviceUrl: MICRONAUT_LAUNCH_URL } : undefined;
        }),
        get(MICRONAUT_SNAPSHOT_URL + VERSIONS).catch(() => undefined).then(data => {
            return data ? { label: JSON.parse(data).versions["micronaut.version"], serviceUrl: MICRONAUT_SNAPSHOT_URL } : undefined;
        }),
        micronautLauchURL ? get(micronautLauchURL + VERSIONS).catch(() => undefined).then(data => {
            return data ? { label: JSON.parse(data).versions["micronaut.version"], serviceUrl: micronautLauchURL, description: '(using configured Micronaut Launch URL)'  } : undefined;
        }) : undefined,
        getMNVersion()
    ]).then((data: any) => {
        return data.filter((item: any) => item !== undefined);
    });
}

async function getApplicationTypes(micronautVersion: {label: string, serviceUrl: string}): Promise<{label: string, name: string}[]> {
    if (micronautVersion.serviceUrl.startsWith(HTTP_PROTOCOL) || micronautVersion.serviceUrl.startsWith(HTTPS_PROTOCOL)) {
        return get(micronautVersion.serviceUrl + APPLICATION_TYPES).then(data => {
            return JSON.parse(data).types.map((type: any) => ({ label: type.title, name: type.name }));
        });
    }
    return getMNApplicationTypes(micronautVersion.serviceUrl);
}

async function getJavaVersions(micronautVersion: {label: string, serviceUrl: string}): Promise<string[]> {
    if (micronautVersion.serviceUrl.startsWith(HTTP_PROTOCOL) || micronautVersion.serviceUrl.startsWith(HTTPS_PROTOCOL)) {
        return get(micronautVersion.serviceUrl + SELECT_OPTIONS).then(data => {
            return JSON.parse(data).jdkVersion.options.map((version: any) => (version.label));
        });
    }
    return []; // Listing supported Java versions not available using CLI
}

function normalizeJavaVersion(version: string | undefined, supportedVersions: string[]): string {
    if (!version) {
        return '8';
    }
    if (!supportedVersions || supportedVersions.length == 0) {
        return version;
    }
    let versionN = parseInt(version);
    for (let supportedVersion of supportedVersions.reverse()) {
        const supportedN = parseInt(supportedVersion);
        if (versionN >= supportedN) {
            return supportedVersion;
        }
    }
    return '8';
}

function getLanguages(): {label: string, value: string}[] {
    return [
        { label: 'Java', value: 'JAVA'},
        { label: 'Kotlin', value: 'KOTLIN'},
        { label: 'Groovy', value: 'GROOVY'}
    ];
}

function getBuildTools() {
    return [
        { label: 'Gradle', value: 'GRADLE'},
        { label: 'Maven', value: 'MAVEN'}
    ];
}

function getTestFrameworks() {
    return [
        { label: 'JUnit', value: 'JUNIT'},
        { label: 'Spock', value: 'SPOCK'},
        { label: 'Kotlintest', value: 'KOTLINTEST'}
    ];
}

async function getFeatures(micronautVersion: {label: string, serviceUrl: string}, applicationType: {label: string, name: string}, javaVersion: {target: string}): Promise<{label: string, detail?: string, name: string}[]> {
    if (micronautVersion.serviceUrl.startsWith(HTTP_PROTOCOL) || micronautVersion.serviceUrl.startsWith(HTTPS_PROTOCOL)) {
        return get(micronautVersion.serviceUrl + APPLICATION_TYPES + '/' + applicationType.name + FEATURES).then(data => {
            return JSON.parse(data).features.map((feature: any) => ({label: `${feature.category}: ${feature.title}`, detail: feature.description, name: feature.name})).sort((f1: any, f2: any) => f1.label < f2.label ? -1 : 1);
        });
    }
    try {
        // will throw an error if javaVersion.target is not supported by the CLI
        const features: {label: string, detail?: string, name: string}[] = getMNFeatures(micronautVersion.serviceUrl, applicationType.name, javaVersion.target);
        return features.sort((f1: any, f2: any) => f1.label < f2.label ? -1 : 1);
    } catch (e) {
        let msg = e.message.toString();
        const err = `Unsupported JDK version: ${javaVersion.target}. Supported values are `;
        const idx = msg.indexOf(err);
        if (idx != 0) {
            // javaVersion.target not supported by the CLI
            // list of the supported versions is part of the error message
            const supportedVersions = msg.substring(idx + err.length + 1, msg.length - 3).split(', ');
            const supportedVersion = normalizeJavaVersion(javaVersion.target, supportedVersions);
            try {
                const features: {label: string, detail?: string, name: string}[] = getMNFeatures(micronautVersion.serviceUrl, applicationType.name, supportedVersion);
                javaVersion.target = supportedVersion; // update the target platform
                return features.sort((f1: any, f2: any) => f1.label < f2.label ? -1 : 1);
            } catch (e) {
                msg = e.message.toString();
            }
        }
        vscode.window.showErrorMessage(`Cannot get Micronaut features: ${msg}`);
        return [];
    }
}

async function get(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const protocol = url.startsWith(HTTP_PROTOCOL) ? http : https;
        protocol.get(url, res => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'] || '';
            let error;
            if (statusCode !== 200) {
                error = `Request Failed.\nStatus Code: ${statusCode}`;
            } else if (!/^application\/json/.test(contentType)) {
                error = `Invalid content-type.\nExpected application/json but received ${contentType}`;
            }
            if (error) {
                res.resume();
                reject(error);
            } else {
                let rawData: string = '';
                res.on('data', chunk => { rawData += chunk; });
                res.on('end', () => {
                    resolve(rawData);
                });
            }
        }).on('error', e => {
            reject(e.message);
        }).end();
    });
}

function getMNVersion(): {label: string, serviceUrl: string, description: string} | undefined {
    return cliMNVersion;
}

function getMNApplicationTypes(mnPath: string): {label: string, name: string}[] {
    const types: {label: string, name: string}[] = [];
    try {
        let header: boolean = true;
        cp.execFileSync(mnPath, ['--help'], { env: { JAVA_HOME: getJavaHome() } }).toString().split('\n').map(line => line.trim()).forEach(line => {
            if (header) {
                if (line.startsWith('Commands:')) {
                    header = false;
                }
            } else {
                const info: string[] | null = line.match(/\s*(\S*)\s*Creates an? (.*)/);
                if (info && info.length >= 3) {
                    types.push({ label: `Micronaut ${info[2]}`, name: info[1] });
                }
            }
        });
    } catch (e) {
        vscode.window.showErrorMessage(`Cannot get Micronaut application types: ${e}`);
    }
    return types;
}

function getMNFeatures(mnPath: string, applicationType: string, javaVersion: string): {label: string, detail?: string, name: string}[] {
    const features: {label: string, detail?: string, name: string}[] = [];
    let header: boolean = true;
    let category: string | undefined;
    cp.execFileSync(mnPath, [applicationType, '--list-features', `--java-version=${javaVersion}`]).toString().split('\n').map(line => line.trim()).forEach(line => {
        if (header) {
            if (line.startsWith('------')) {
                header = false;
            }
        } else {
            if (line.length === 0) {
                category = undefined;
            } else if (category) {
                const info: string[] | null = line.match(/(\S*)\s*(\[PREVIEW\]|\(\*\))?\s*(.*)/);
                if (info && info.length >= 4) {
                    features.push({ label: `${category}: ${info[1]}`, detail: info[3], name: info[1] });
                }
            } else {
                category = line;
            }
        }
    });
    return features;
}

async function downloadProject(options: {url: string, name: string, target: string}): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        fs.mkdirSync(options.target, {recursive: true});
        const filePath: string = path.join(options.target, options.name + '.zip');
        const file: fs.WriteStream = fs.createWriteStream(filePath);
        https.get(options.url, res => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'] || '';
            if (statusCode !== 201) {
                let rawData: string = '';
                res.on('data', chunk => { rawData += chunk; });
                res.on('end', () => {
                    if (/^application\/json/.test(contentType)) {
                        reject(JSON.parse(rawData).message);
                    } else {
                        reject(`Request failed.\nStatus Code: ${statusCode}`);
                    }
                });
                res.on('error', e => {
                    reject(e.message);
                });
            } else if (!/^application\/zip/.test(contentType)) {
                res.resume();
                reject(`Invalid content-type.\nExpected application/zip but received ${contentType}`);
            } else {
                res.pipe(file);
                file.on('close', () => {
                    resolve(filePath);
                });
                res.on('error', e => {
                    reject(e.message);
                });
            }
        }).on('error', e => {
            reject(e.message);
        }).end();
    });
}
