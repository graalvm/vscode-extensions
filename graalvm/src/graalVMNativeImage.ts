/*
 * Copyright (c) 2019, 2022, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as https from "https";
import * as sax from "sax";
import * as fs from 'fs';
import { getGVMHome } from "./graalVMConfiguration";
import { getGraalVMVersion } from './graalVMInstall';
import { findExecutable, platform } from './utils';

const URL_SEARCH: string = 'https://search.maven.org/solrsearch/select';
const GID: string = 'org.graalvm.nativeimage';
const AID: string = 'native-image-maven-plugin';
const YES: string = 'Yes';
const NO: string = 'No';

export async function addNativeImageToPOM() {
    let textEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!textEditor || 'pom.xml' !== path.basename(textEditor.document.fileName)) {
        const poms: vscode.Uri[] = await vscode.workspace.findFiles('**/pom.xml', '**/node_modules/**');
        if (!poms || poms.length === 0) {
            vscode.window.showErrorMessage("No pom.xml file found in workspace.");
            return;
        } else if (poms.length === 1) {
            textEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(poms[0].fsPath));
        } else {
            const pickItems: vscode.QuickPickItem[] = poms.map((pomUri: vscode.Uri) => {
                return { label: pomUri.fsPath };
            });
            const selected: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(pickItems, { placeHolder: 'Multiple pom.xml found in workspace. Choose a pom.xml to modify.' });
            if (selected) {
                textEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.label));
            } else {
                return;
            }
        }
    }

    const doc: vscode.TextDocument = textEditor.document;
    if (checkForNativeImage(doc.getText())) {
        vscode.window.showErrorMessage("Native image plugin already present in the selected pom.xml.");
        return;
    }

    const graalVMHome = getGVMHome();
    const fullVersion: string | undefined = await getGraalVMVersion(graalVMHome);
    if (!fullVersion) {
        vscode.window.showErrorMessage("Cannot get the version information of the selected GraalVM.");
        return;
    }
    const version: string[] | null = fullVersion.match(/\d+\.\d+\.\d+(-dev)?/);
    if (!version || version.length === 0) {
        vscode.window.showErrorMessage("Cannot get the version information of the selected GraalVM.");
        return;
    }
    const rawArtefactInfo: Promise<string> = new Promise<string>((resolve, reject) => {
        const url = `${URL_SEARCH}?q=g:${GID}+AND+a:${AID}+AND+v:${version[0]}&wt=json`;
        https.get(url, {headers: {'User-Agent' : 'vscode-graalvm-extension'}}, res => {
            const { statusCode, statusMessage } = res;
            const contentType = res.headers['content-type'] || '';
            let error;
            if (statusCode !== 200) {
                error = `Request Failed for URL: '${url}'. Status: ${statusCode} ${statusMessage}`;
            } else if (!/^application\/json/.test(contentType)) {
                error = `Invalid content-type. Expected application/json but received ${contentType}`;
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

    let artefactAvailable: boolean = false;
    try {
        const artefactInfo: any = JSON.parse(await rawArtefactInfo);
        artefactAvailable = artefactInfo.response.numFound > 0;
    } catch (error) {
        vscode.window.showErrorMessage(error);
    }

    let install: boolean = true;
    if (!artefactAvailable) {
        if (YES !== await vscode.window.showInformationMessage(`Cannot verify that native-image-maven-plugin version ${version[0]} is available on Maven Central. Continue anyway?`, YES, NO)) {
            return;
        }
    }

    if (install) {
        const options: vscode.TextEditorOptions = textEditor.options;
        const indent: string = options.insertSpaces ? " ".repeat(<number>options.tabSize) : "\t";
        const eol: string = doc.eol === vscode.EndOfLine.LF ? "\n" : "\r\n";

        const stack: string[] = [];
        let insertOffset: number | undefined;
        let toInsert: string | undefined;

        const parser = sax.parser(true);
        parser.onopentag = tag => {
            stack.push(tag.name);
        };
        parser.onclosetag = tagName => {
            let top: string | undefined = stack.pop();
            while(top !== tagName) {
                top = stack.pop();
            }
            if (top) {
                switch (top) {
                    case 'plugins':
                        if (!insertOffset && stack.length > 1 && stack[stack.length - 1] === 'build' && stack[stack.length - 2] === 'project') {
                            toInsert = getPlugin(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                    case 'build':
                        if (!insertOffset && stack.length > 0 && stack[stack.length - 1] === 'project') {
                            toInsert = getPlugins(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                    case 'project':
                        if (!insertOffset) {
                            toInsert = getBuild(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                }
            }
        };

        parser.write(doc.getText());

        if (toInsert && insertOffset) {
            const pos: vscode.Position = doc.positionAt(insertOffset);
            const range: vscode.Range = new vscode.Range(pos, pos);
            const textEdit: vscode.TextEdit = new vscode.TextEdit(range, toInsert);
            const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(doc.uri, [textEdit]);
            await vscode.workspace.applyEdit(workspaceEdit);
            doc.save();
            const endPos: vscode.Position = doc.positionAt(insertOffset + toInsert.length);
            textEditor.revealRange(new vscode.Range(pos, endPos));
        }
    }
}

function checkForNativeImage(text: string): boolean {
    let hasNativeImage = false;
    const stack: string[] = [];
    const parser = sax.parser(true);
    parser.onopentag = tag => {
        stack.push(tag.name);
    };
    parser.onclosetag = tagName => {
        let top: string | undefined = stack.pop();
        while(top !== tagName) {
            top = stack.pop();
        }
    };
    parser.ontext = text => {
        if (text === AID && stack.length > 0 && stack[stack.length -1] === 'artifactId' && [stack[stack.length -2] === 'plugin']) {
            hasNativeImage = true;
        }
    };
    parser.write(text);
    return hasNativeImage;
}

function getIndent(doc: vscode.TextDocument, off: number): string {
    const pos: vscode.Position = doc.positionAt(off);
    return doc.getText(new vscode.Range(new vscode.Position(pos.line, 0), pos));
}

function getPlugin(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<plugin>`,
        `${indent}<groupId>${GID}</groupId>`,
        `${indent}<artifactId>${AID}</artifactId>`,
        `${indent}<version>${version}</version>`,
        `${indent}<executions>`,
        `${indent}${indent}<execution>`,
        `${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}</execution>`,
        `${indent}</executions>`,
        `${indent}<configuration>`,
        `${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}</configuration>`,
        `</plugin>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}

function getPlugins(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<plugins>`,
        `${indent}<plugin>`,
        `${indent}${indent}<groupId>${GID}</groupId>`,
        `${indent}${indent}<artifactId>${AID}</artifactId>`,
        `${indent}${indent}<version>${version}</version>`,
        `${indent}${indent}<executions>`,
        `${indent}${indent}${indent}<execution>`,
        `${indent}${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}${indent}</execution>`,
        `${indent}${indent}</executions>`,
        `${indent}${indent}<configuration>`,
        `${indent}${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}</configuration>`,
        `${indent}</plugin>`,
        `</plugins>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}

function getBuild(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<build>`,
        `${indent}<plugins>`,
        `${indent}${indent}<plugin>`,
        `${indent}${indent}${indent}<groupId>${GID}</groupId>`,
        `${indent}${indent}${indent}<artifactId>${AID}</artifactId>`,
        `${indent}${indent}${indent}<version>${version}</version>`,
        `${indent}${indent}${indent}<executions>`,
        `${indent}${indent}${indent}${indent}<execution>`,
        `${indent}${indent}${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}${indent}${indent}</execution>`,
        `${indent}${indent}${indent}</executions>`,
        `${indent}${indent}${indent}<configuration>`,
        `${indent}${indent}${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}${indent}${indent}</configuration>`,
        `${indent}${indent}</plugin>`,
        `${indent}</plugins>`,
        `</build>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}


const NATIVE_IMAGE_TERMINAL = 'Native Image';

// Creates terminal using the currently active GraalVM
export async function openWindowsNITerminal() {
    const env: any = {};
    const graalVMHome = getGVMHome();
    if (!graalVMHome) {
        vscode.window.showErrorMessage('No active GraalVM installation found');
        return;
    }
    const nativeImage = findExecutable('native-image', graalVMHome);
    if (!nativeImage) {
        const gu = findExecutable('gu', graalVMHome);
        if (gu) {
            const command = 'Install Native Image';
            const selected = await vscode.window.showWarningMessage('Native Image component not installed in the active GraalVM installation.', command);
            if (selected === command) {
                await vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', 'native-image', graalVMHome);
                return;
            }
        } else {
            vscode.window.showErrorMessage('Native Image component not installed in the active GraalVM installation.');
            return;
        }
    }
    let terminal: vscode.Terminal | undefined = vscode.window.terminals.find(terminal => terminal.name === NATIVE_IMAGE_TERMINAL);
    if (terminal) {
        terminal.dispose();
    }
    env.JAVA_HOME = graalVMHome;
    env.PATH = `${path.join(graalVMHome, 'bin')}${path.delimiter}${process.env.PATH}`;
    terminal = await createWindowsNITerminal({ name: NATIVE_IMAGE_TERMINAL, env });
    if (terminal) {
        terminal.show();
    }
}

// Creates terminal using the provided env
export async function createWindowsNITerminal(options: vscode.TerminalOptions): Promise<vscode.Terminal | undefined> {
    let configureEnvironment: string | undefined = await configureWindowsEnvironment();
    if (!configureEnvironment) {
        return;
    }
    const terminal = await createTerminal(options, 'Command Prompt');
    terminal.sendText(configureEnvironment);
    return terminal;
}

async function createTerminal(options: vscode.TerminalOptions, profile?: string): Promise<vscode.Terminal> {
    const profileKey = `integrated.defaultProfile.${platform()}`;
    const currentProfile = profile ? vscode.workspace.getConfiguration('terminal').get(profileKey) as string : undefined;
    try {
        if (profile) {
            await vscode.workspace.getConfiguration('terminal').update(profileKey, profile, true);
        }
        return vscode.window.createTerminal(options);
    } finally {
        if (profile) {
            vscode.workspace.getConfiguration('terminal').update(profileKey, currentProfile ? currentProfile : undefined, true);
        }
    }
}

async function configureWindowsEnvironment(): Promise<string | undefined> {
    let configure: string | undefined = vscode.workspace.getConfiguration('native').get('buildtools.config.windows') as string;
    if (!configure || !fs.existsSync(configure)) {
        if (configure) {
            vscode.workspace.getConfiguration('native').update('buildtools.config.windows', undefined, true);
        }
        const choices: string[] = findWindowsTools();
        if (choices.length === 0) {
            configure = await selectCustomWindowsTools();
        } else {
            configure = await selectWindowsTools(choices);
        }
        if (configure) {
            await vscode.workspace.getConfiguration('native').update('buildtools.config.windows', configure, true);
        }
    }
    if (configure && configure.includes(' ')) {
        configure = `"${configure}"`;
    }
    return configure;
}

function findWindowsTools(): string[] {
    const predefinedLocations = [
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community\\Common7\\Tools\\vcvars64.bat',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\Common7\\Tools\\vcvars64.bat',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\Community\\Common7\\Tools\\vcvars64.bat',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2017\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat'
    ];
    const tools = [];
    for (const location of predefinedLocations) {
        if (fs.existsSync(location)) {
            tools.push(location);
        }
    }
    return tools;
}

async function selectWindowsTools(choices: string[]): Promise<string | undefined> {
    const addCustom = 'Select Custom Script...';
    choices.push(addCustom);
    let selected = await vscode.window.showQuickPick(choices, { placeHolder: `Select Build Tools Configuration Script (vcvars64.bat)` })
    if (selected === addCustom) {
        selected = await selectCustomWindowsTools();
    }
    return selected;
}

async function selectCustomWindowsTools(): Promise<string | undefined> {
    const sel = await vscode.window.showOpenDialog({title: 'Select Build Tools Configuration Script (vcvars64.bat)', openLabel: 'Select', canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
    return sel && sel.length === 1 ? sel[0].fsPath : undefined;
}


export async function attachNativeImageAgent(outputDir: string | undefined = undefined): Promise<string> {
    const graalVMHome = getGVMHome();
    if (!graalVMHome) {
        vscode.window.showWarningMessage('No active GraalVM installation found, launching without native-image agent.');
        return '';
    }
    const nativeImage = findExecutable('native-image', graalVMHome);
    if (!nativeImage) {
        vscode.window.showWarningMessage('Native Image component not installed in active GraalVM installation, launching without native-image agent.');
        return '';
    }
    const preconfigured: boolean = outputDir !== undefined;
    if (!preconfigured) {
        outputDir = await selectOutputDir();
    }
    if (outputDir) {
        if (!preconfigured) {
            vscode.window.showInformationMessage(`Configuration will be stored in ${outputDir}`);
        }
        const agent = 'native-image-agent';
        const parameter = 'config-output-dir';
        return `-agentlib:${agent}=${parameter}=${outputDir}`;
    } else {
        vscode.window.showWarningMessage('No configuration output selected, launching without native-image agent.');
        return '';
    }
}

async function selectOutputDir(): Promise<string | undefined> {
    const project = await supportsResourcesRoot() ? new QuickPickTargetDir(path.join('META-INF', 'native-image'), 'Store configuration to project', getProjectConfigDir) : undefined;
    const temp = new QuickPickTargetDir(process.platform === 'win32' ? 'Temp' : '/tmp', 'Store configuration to temporary directory', getTmpConfigDir);
    const custom = new QuickPickTargetDir('Custom directory...', 'Store configuration to custom directory', getCustomConfigDir);
    let choices: QuickPickTargetDir[] = project ? [ project, temp, custom ] : [temp, custom ];
    let ret: string | undefined = undefined;
    await vscode.window.showQuickPick(choices, {
        placeHolder: 'Select native-image configuration output directory',
        ignoreFocusOut: true
    }).then(async e => { if (e) ret = await e.getTarget(); });
    return ret;
}

async function supportsResourcesRoot(): Promise<boolean> {
    const commands: string[] = await vscode.commands.getCommands();
    return commands.includes('java.get.project.source.roots');
}

async function findResourcesRoot(): Promise<string | undefined> {
    const roots = vscode.workspace.workspaceFolders;
    if (roots && roots.length > 0) {
        const project = roots[0].uri.toString();
        const resources: string[] | undefined = await vscode.commands.executeCommand('java.get.project.source.roots', project, 'resources');
        if (resources && resources.length > 0) {
            return vscode.Uri.parse(resources[0]).fsPath;
        }
    }
    return undefined;
}

async function getProjectConfigDir(): Promise<string | undefined> {
    const resources = await findResourcesRoot();
    if (resources) {
        return path.join(resources, 'META-INF', 'native-image');
    }
    return undefined;
}

function getTmpConfigDir(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const tmp = require('os').tmpdir();
        const realtmp = require('fs').realpathSync(tmp);
        resolve(path.join(realtmp, 'native-image'));
    });
}

async function getCustomConfigDir(preselect: string | undefined = undefined): Promise<string | undefined> {
    const preselectUri = preselect ? vscode.Uri.file(preselect) : undefined;
    const location: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: preselectUri,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select Native Image Configuration Output Directory',
        openLabel: 'Select'
    });
    if (location && location.length > 0) {
        return location[0].fsPath;
    }
    return undefined;
}

class QuickPickTargetDir implements vscode.QuickPickItem{
    constructor(
        public readonly label: string,
        public readonly detail: string,
        public readonly getTarget: () => Promise<string | undefined>
    ){}
}

// NOTE: do not persiste the enabled state for now, should always be disabled on VS Code startup
// const PERSISTENT_AGENT_ENABLED: string = 'nativeimage.persistent.agentEnabled';
const PERSISTENT_OUTPUT_DIR: string = 'nativeimage.persistent.outputDir';
const PERSISTENT_CUSTOM_OUTPUT: string = 'nativeimage.persistent.customOutput';
const PERSISTENT_LAST_EXECUTED: string = 'nativeimage.persistent.lastExecuted';

const CONFIGURATION_FILES: string[] = [
    'jni-config.json',
    'predefined-classes-config.json',
    'proxy-config.json',
    'reflect-config.json',
    'resource-config.json',
    'serialization-config.json'
];

let featureSet: number = 0;

let graalVMHome: string | undefined = undefined;

let agentEnabled: number = 0;
let outputDir: number = 0;
let customOutput: string | undefined = undefined;
let lastExecuted: string | undefined = undefined;

let extContext: vscode.ExtensionContext;

// invoked on extension startup
export function initialize(context: vscode.ExtensionContext) {
    extContext = context;
    initializeAgentEnabled(context);
    initializeOutput(context);
    initializeLastExecuted(context);
    initializeGraalVM(getGVMHome());
}

// invoked when active GraalVM changes
export function initializeGraalVM(gvmHome: string) {
    graalVMHome = gvmHome;
    initializeGraalVMAsync();
}

async function initializeGraalVMAsync() {
	const netbeansExt = vscode.extensions.getExtension('asf.apache-netbeans-java');
	const redhatExt = vscode.extensions.getExtension('redhat.java');
    if (netbeansExt || redhatExt) {
        const graalVMVersion: string[] | undefined = graalVMHome ? (await getGraalVMVersion(graalVMHome))?.split(' ') : undefined;
        if (graalVMVersion) {
            let version = graalVMVersion[2].slice(0, graalVMVersion[2].length - 1);
            const dev = version.endsWith('-dev');
            if (dev) {
                version = version.slice(0, version.length - '-dev'.length);
            }
            const numbers: string[] = version.split('.');
            const features = resolveFeatureSet(parseInt(numbers[0]), parseInt(numbers[1]), parseInt(numbers[2]), dev);
            setFeatureSet(features);
        } else {
            setFeatureSet(0);
        }
    } else {
        setFeatureSet(-1);
    }
}

function resolveFeatureSet(_major: number, _minor: number, _update: number, _dev: boolean): number {
    return 1;
}

export async function setFeatureSet(features: number) {
    featureSet = features;
    await vscode.commands.executeCommand('setContext', 'nativeimage.featureSet', featureSet);
    agentNode.updateFeatures();
}

function initializeAgentEnabled(_context: vscode.ExtensionContext) {
    // NOTE: do not persiste the enabled state for now, should always be disabled on VS Code startup
    // const persistentAgentEnabled: string | undefined = context.workspaceState.get(PERSISTENT_AGENT_ENABLED);
    // agentEnabled = persistentAgentEnabled === undefined ? agentEnabled : parseInt(persistentAgentEnabled);
    setAgentEnabled(undefined, agentEnabled);
}

async function setAgentEnabled(_context: vscode.ExtensionContext | undefined, code: number) {
    agentEnabled = code;
    agentEnabledNode.updateSettings();
    // NOTE: do not persiste the enabled state for now, should always be disabled on VS Code startup
    // if (context) {
    //     await context.workspaceState.update(PERSISTENT_AGENT_ENABLED, String(agentEnabled));
    // }
}

function configureAgentEnabled(context: vscode.ExtensionContext) {
    let choices: QuickPickString[] = getAgentEnabledChoices();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select agent state'
    }).then(selection => { if (selection) setAgentEnabled(context, selection.code); });
}

function initializeOutput(context: vscode.ExtensionContext) {
    const persistentOutputDir: string | undefined = context.workspaceState.get(PERSISTENT_OUTPUT_DIR);
    outputDir = persistentOutputDir === undefined ? outputDir : parseInt(persistentOutputDir);
    customOutput = context.workspaceState.get(PERSISTENT_CUSTOM_OUTPUT);
    setOutput(undefined, outputDir, customOutput);
}

async function setOutput(context: vscode.ExtensionContext | undefined, code: number, custom: string | undefined) {
    outputDir = code;
    customOutput = custom;
    configOutputNode.updateSettings();
    if (context) {
        await context.workspaceState.update(PERSISTENT_OUTPUT_DIR, String(outputDir));
        await context.workspaceState.update(PERSISTENT_CUSTOM_OUTPUT, customOutput);
    }
}

function configureOutput(context: vscode.ExtensionContext) {
    let choices: QuickPickString[] = getOutputChoices();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select native-image configuration output directory'
    }).then(async selection => {
        if (selection) {
            const code = selection.code;
            if (code === 2) {
                const output = await getCustomConfigDir(customOutput);
                if (output) {
                    setOutput(context, selection.code, output);
                }
            } else {
                setOutput(context, selection.code, customOutput);
            }
        }
    });
}

function initializeLastExecuted(context: vscode.ExtensionContext) {
    lastExecuted = context.workspaceState.get(PERSISTENT_LAST_EXECUTED);
    setLastExecuted(undefined, lastExecuted);
}

async function setLastExecuted(context: vscode.ExtensionContext | undefined, executed: string | undefined) {
    lastExecuted = executed;
    lastExecutedNode.updateSettings();
    if (context) {
        await context.workspaceState.update(PERSISTENT_LAST_EXECUTED, lastExecuted);
    }
}

export function showDocumentation(...params: any[]) {
    if (params[0][0]) {
        (params[0][0] as Documented).showDocumentation();
    }
}

export function configureSetting(context: vscode.ExtensionContext, ...params: any[]) {
    if (params[0][0]) {
        (params[0][0] as Configurable).configure(context);
    }
}

export function openConfiguration() {
    getConfigurationDestination().then(output => {
        if (output) {
            let found: boolean = false;
            for (var file of CONFIGURATION_FILES) {
                found = openFile(path.join(output, file)) || found;
            }
            if (!found) {
                vscode.window.showWarningMessage(`No native-image configuration available in ${output}.`);
            }
        } else {
            vscode.window.showErrorMessage('Unknown output directory.');
        }
    }).catch(err => {
        vscode.window.showErrorMessage(err.message);
    });
}

function openFile(file: string): boolean {
    if (fs.existsSync(file)) {
        vscode.workspace.openTextDocument(file).then(doc => {
            vscode.window.showTextDocument(doc, { preview: false });
        });
        return true;
    }
    return false;
}

async function getConfigurationDestination(): Promise<string | undefined> {
    switch (outputDir) {
        case 0: {
            const supportsResources = await supportsResourcesRoot();
            const projectDir = supportsResources ? await getProjectConfigDir() : undefined;
            if (!projectDir) {
                throw new Error('Unable to resolve project resources location.');
            }
            return projectDir;
        }
        case 1: {
            const tmpDir = await getTmpConfigDir();
            return tmpDir;
        }
        case 2: {
            return customOutput;
        }
        default: {
            return undefined;
        }
    }
}

function getAgentEnabledChoices(): QuickPickString[] {
    return [
        new QuickPickString('disabled', 'Native Image agent is disabled', 'disabled', 0),
        new QuickPickString('enabled', 'Native Image agent is started with the project process', 'enabled', 1)
    ];
}

function getOutputChoices(): QuickPickString[] {
    return [
        new QuickPickString('Project resources', `Store configuration to project ${getProjectResourcesDestination()}`, 'project resources', 0),
        new QuickPickString('Temporary directory', 'Store configuration to temporary directory', 'temporary directory', 1),
        new QuickPickString('Custom directory...', 'Store configuration to custom directory', '', 2)
    ];
}

function getProjectResourcesDestination() {
    return path.join('resources', 'META-INF', 'native-image');
}

class QuickPickString implements vscode.QuickPickItem {
    constructor(
        public readonly label: string,
        public readonly detail: string | undefined,
        public readonly value: string,
        public readonly code: number
    ) {}
}

class NativeImageNode extends vscode.TreeItem {

    children: vscode.TreeItem[] | undefined;

    constructor(label: string, description: string | undefined, contextValue: string | undefined, children: vscode.TreeItem[] | undefined, expanded: boolean | undefined) {
        super(label);
        this.description = description;
        this.contextValue = contextValue;
        this.children = children;
        if (!children || expanded === undefined) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        } if (expanded === true) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (expanded === false) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
    }

    public getChildren(): vscode.TreeItem[] | undefined {
        return this.children;
    }

}

interface Documented {

    showDocumentation(): void;

}

interface Configurable {

    configure(context: vscode.ExtensionContext): void;

}

class AgentEnabledNode extends NativeImageNode implements Configurable {

    constructor() {
        super('State:', undefined, 'nativeimage.configure',  undefined, undefined);
        this.updateSettings();
    }

    configure(context: vscode.ExtensionContext) {
        configureAgentEnabled(context);
    }

    updateSettings() {
        this.description = getAgentEnabledChoices()[agentEnabled].label;
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const agentEnabledNode = new AgentEnabledNode();

class ConfigOutputNode extends NativeImageNode implements Configurable {

    constructor() {
        super('Output directory:', undefined, 'nativeimage.outputDir',  undefined, undefined);
        this.updateSettings();
    }

    configure(context: vscode.ExtensionContext) {
        configureOutput(context);
    }

    async updateSettings() {
        if (outputDir === 2) {
            this.description = customOutput;
        } else {
            this.description = getOutputChoices()[outputDir].value;
        }
        let destination: string | undefined = undefined;
        try {
            destination = await getConfigurationDestination();
        } catch (err) {
            if (outputDir === 0) {
                // project resources may not be ready when the extension starts
                destination = `project ${getProjectResourcesDestination()}`;
            }
        }
        if (!destination) {
            destination = 'unable to resolve';
        }
        this.tooltip = `${this.label} ${destination}`;
        refreshUI()
    }

}
const configOutputNode = new ConfigOutputNode();

class LastExecutedNode extends NativeImageNode implements Configurable {

    constructor() {
        super('Last executed:', undefined, 'nativeimage.lastConfig',  undefined, undefined);
        this.updateSettings();
    }

    configure(context: vscode.ExtensionContext) {
        configureOutput(context);
    }

    async updateSettings() {
        this.description = lastExecuted ? lastExecuted : 'not executed yet';
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const lastExecutedNode = new LastExecutedNode();

class AgentNode extends NativeImageNode implements Documented {

    constructor() {
        super('Agent', undefined, 'nativeimage.agent', undefined, true);
        this.updateFeatures();
    }

    showDocumentation() {
        vscode.env.openExternal(vscode.Uri.parse('https://www.graalvm.org/reference-manual/native-image/Agent/'));
    }

    updateFeatures() {
        if (featureSet === 0) {
            this.children = [];
        } else {
            this.children = [ agentEnabledNode, configOutputNode, lastExecutedNode ];
        }
        refreshUI();
    }

}
const agentNode = new AgentNode();

export class NativeImageNodeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
	readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (!element) {
            if (featureSet <= 0) {
                return [];
            } else {
                return [ agentNode ];
            }
        } else {
            return (element as NativeImageNode).getChildren();
        }
	}
}
export const nodeProvider = new NativeImageNodeProvider();

function refreshUI() {
    if (nodeProvider) {
        nodeProvider.refresh();
    }
}

export async function initializeConfiguration(): Promise<boolean> {
	const java = await vscode.workspace.findFiles('**/*.java', '**/node_modules/**', 1);
	if (java?.length > 0) {
		const maven = await vscode.workspace.findFiles('pom.xml', '**/node_modules/**', 1);
		if (maven?.length > 0) {
			return true;
		}
		const gradle = await vscode.workspace.findFiles('build.gradle', '**/node_modules/**', 1);
		if (gradle?.length > 0) {
			return true;
		}
	}
	return false;
}

class NativeImageConfigurationProvider implements vscode.DebugConfigurationProvider {

    resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
		return new Promise<vscode.DebugConfiguration>(resolve => {
			resolve(config);
		});
	}

	resolveDebugConfigurationWithSubstitutedVariables?(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        return new Promise<vscode.DebugConfiguration>(async resolve => {
            if (agentEnabled) {
                if (config.noDebug) {
                    try {
                        let target = await getConfigurationDestination();
                        const vmArgs = await attachNativeImageAgent(target ? target : '');
                        if (vmArgs) {
                            if (!config.vmArgs) {
                                config.vmArgs = vmArgs;
                            } else {
                                config.vmArgs = `${config.vmArgs} ${vmArgs}`;
                            }
                            setLastExecuted(extContext, new Date().toLocaleString());
                        }
                    } catch (err) {
                        vscode.window.showErrorMessage(`${err.message} Launching without native-image agent.`);
                    }
                } else {
                    vscode.window.showWarningMessage('Running native-image agent is not supported for Debug session, launching without native-image agent.');
                }
            }
			resolve(config);
		});
	}

}
export const configurationProvider = new NativeImageConfigurationProvider();
