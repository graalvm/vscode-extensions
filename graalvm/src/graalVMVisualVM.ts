/*
 * Copyright (c) 2019, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import { tmpdir } from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as utils from './utils';
import { getGVMHome } from './graalVMConfiguration';
import { setupGraalVM, getGraalVMVersion } from './graalVMInstall';


const DISPLAY_NAME_PREFIX: string = '-Dvisualvm.display.name=';
const DISPLAY_NAME_SUFFIX: string = '%PID';

const PERSISTENT_PRESELECT: string = 'visualvm.persistent.preselect';
const PERSISTENT_WINDOW_TO_FRONT: string = 'visualvm.persistent.windowToFront';
const PERSISTENT_SOURCES_INTEGRATION: string = 'visualvm.persistent.sourcesIntegration';
const PERSISTENT_WHEN_STARTED: string = 'visualvm.persistent.whenStarted';
const PERSISTENT_CPU_SAMPLING_FILTER: string = 'visualvm.persistent.cpuSamplingFilter';
const PERSISTENT_CPU_SAMPLING_RATE: string = 'visualvm.persistent.cpuSamplingRate';
const PERSISTENT_MEMORY_SAMPLING_RATE: string = 'visualvm.persistent.memorySamplingRate';
const PERSISTENT_JFR_SETTINGS: string = 'visualvm.persistent.jfrSettings';

// No project/folder open: projectName === undefined
let projectName: string | undefined;

// Supported features based on the currently active GraalVM installation
// 0 - no active GraalVM set
// 1 - GraalVM 21.1.x and older | supports start VisualVM, open process (timeout may occur), defined tab
// 2 - GraalVM 21.2 and newer   | supports thread/heap dumps, sampler, jfr, go to source, bring to front, customizable search process timeout
let featureSet: number = 0;

// Current active GraalVM installation
let graalVMHome: string | undefined = undefined;

let preselect: string = '2';
let windowToFront: boolean = true;
let sourcesIntegration: boolean = true;

let awaitingProgress: number = 0;
let processName: string | undefined = undefined;
let ID: string | undefined = undefined;
let PID: number | undefined = undefined;

let performWhenStarted: number = 1;

let cpuSamplingFilter: number = 0;
let cpuSamplingRate: number = 2;
let memorySamplingRate: number = 3;

let jfrSettings: number = 0;


// invoked on extension startup
export function initialize(context: vscode.ExtensionContext) {
    initializeProject();
    initializePreselectView(context);
    initializeWindowToFront(context);
    initializeSourcesIntegration(context);
    initializeCpuSamplingFilter(context);
    initializeCpuSamplingRate(context);
    initializeMemorySamplingRate(context);
    initializeJfrSettings(context);
    initializeGraalVM(context, getGVMHome());
}

// invoked when active GraalVM changes
export function initializeGraalVM(context: vscode.ExtensionContext, gvmHome: string) {
    graalVMHome = gvmHome;

    setFeatureSet(0);
    initializeGraalVMAsync(context);
}

async function initializeGraalVMAsync(context: vscode.ExtensionContext) {
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
        initializeWhenStarted(context);
    } else {
        setFeatureSet(0);
    }
}

function resolveFeatureSet(major: number, minor: number, _update: number, _dev: boolean): number {
    if (major < 21) {
        return 1;
    }
    if (major === 21 && minor < 2) {
        return 1;
    }
    return 2;
}

async function setFeatureSet(features: number) {
    featureSet = features;
    await vscode.commands.executeCommand('setContext', 'visualvm.featureSet', featureSet);
    processNode.updateFeatures();
}

async function initializeProject() {
    projectName = vscode.workspace.name;
    await vscode.commands.executeCommand('setContext', 'visualvm.projectOpen', projectName !== undefined);
}

export async function startVisualVM() {
    if (!PID || checkProcessIsRunning(PID)) {
        let command = await getLaunchCommand(true);
        if (command) {
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

function initializePreselectView(context: vscode.ExtensionContext) {
    const persistentPreselect: string | undefined = context.globalState.get(PERSISTENT_PRESELECT);
    preselectView(undefined, persistentPreselect === undefined ? preselect : persistentPreselect);
}

export async function preselectView(context: vscode.ExtensionContext | undefined, view: string) {
    preselect = view;
    await vscode.commands.executeCommand('setContext', 'visualvm.preselectView', preselect);
    if (context) {
        await context.globalState.update(PERSISTENT_PRESELECT, preselect);
    }
}

function initializeWindowToFront(context: vscode.ExtensionContext) {
    const persistentWindowToFront: string | undefined = context.globalState.get(PERSISTENT_WINDOW_TO_FRONT);
    setWindowToFront(undefined, persistentWindowToFront === undefined ? windowToFront : Boolean(persistentWindowToFront === 'true'));
}

export function toggleWindowToFront(context: vscode.ExtensionContext) {
    setWindowToFront(context, !windowToFront);
}

async function setWindowToFront(context: vscode.ExtensionContext | undefined, toFront: boolean) {
    windowToFront = toFront;
    await vscode.commands.executeCommand('setContext', 'visualvm.windowToFront', windowToFront);
    if (context) {
        await context.globalState.update(PERSISTENT_WINDOW_TO_FRONT, String(windowToFront));
    }
}

function initializeSourcesIntegration(context: vscode.ExtensionContext) {
    const persistentSourcesIntegration: string | undefined = context.globalState.get(PERSISTENT_SOURCES_INTEGRATION);
    setSourcesIntegration(undefined, persistentSourcesIntegration === undefined ? sourcesIntegration : Boolean(persistentSourcesIntegration === 'true'));
}

export function toggleSourcesIntegration(context: vscode.ExtensionContext) {
    setSourcesIntegration(context, !sourcesIntegration);
}

async function setSourcesIntegration(context: vscode.ExtensionContext | undefined, integrateWithSources: boolean) {
    sourcesIntegration = integrateWithSources;
    await vscode.commands.executeCommand('setContext', 'visualvm.sourcesIntegration', sourcesIntegration);
    if (context) {
        await context.globalState.update(PERSISTENT_SOURCES_INTEGRATION, String(sourcesIntegration));
    }
}

function initializeWhenStarted(context: vscode.ExtensionContext) {
    const persistentPerformWhenStarted: string | undefined = context.globalState.get(PERSISTENT_WHEN_STARTED);
    performWhenStarted = persistentPerformWhenStarted === undefined ? performWhenStarted : parseInt(persistentPerformWhenStarted);
    setWhenStarted(undefined, performWhenStarted);
}

async function setWhenStarted(context: vscode.ExtensionContext | undefined, code: number) {
    if (featureSet < 2) {
        code = Math.min(code, 1);
    }
    performWhenStarted = code;
    whenStartedNode.updateAction();
    if (context) {
        await context.globalState.update(PERSISTENT_WHEN_STARTED, String(code));
    }
}

function configureWhenStarted(context: vscode.ExtensionContext) {
    let choices: QuickPickAction[] = getWhenStartedChoices();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select action when process is started (use "Launch VisualVM & Java 8+ Application" configuration)'
    }).then(selection => { if (selection) setWhenStarted(context, selection.code); });
}

function initializeCpuSamplingFilter(context: vscode.ExtensionContext) {
    const persistentCpuSamplingFilter: string | undefined = context.globalState.get(PERSISTENT_CPU_SAMPLING_FILTER);
    cpuSamplingFilter = persistentCpuSamplingFilter === undefined ? cpuSamplingFilter : parseInt(persistentCpuSamplingFilter);
    setCpuSamplingFilter(undefined, cpuSamplingFilter);
}

async function setCpuSamplingFilter(context: vscode.ExtensionContext | undefined, code: number) {
    cpuSamplingFilter = code;
    cpuSamplingFilterNode.updateFilter();
    if (context) {
        await context.globalState.update(PERSISTENT_CPU_SAMPLING_FILTER, String(code));
    }
}

function configureCpuSamplingFilter(context: vscode.ExtensionContext) {
    let choices: QuickPickAsyncString[] = getCpuSamplerFilters();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select CPU sampling filter'
    }).then(selection => { if (selection) setCpuSamplingFilter(context, selection.code); });
}

function initializeCpuSamplingRate(context: vscode.ExtensionContext) {
    const persistentCpuSamplingRate: string | undefined = context.globalState.get(PERSISTENT_CPU_SAMPLING_RATE);
    cpuSamplingRate = persistentCpuSamplingRate === undefined ? cpuSamplingRate : parseInt(persistentCpuSamplingRate);
    setCpuSamplingRate(undefined, cpuSamplingRate);
}

async function setCpuSamplingRate(context: vscode.ExtensionContext | undefined, code: number) {
    cpuSamplingRate = code;
    cpuSamplingRateNode.updateSamplingRate();
    if (context) {
        await context.globalState.update(PERSISTENT_CPU_SAMPLING_RATE, String(code));
    }
}

function configureCpuSamplingRate(context: vscode.ExtensionContext) {
    let choices: QuickPickNumber[] = getCpuSamplingFrequencies();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select CPU sampling rate'
    }).then(selection => { if (selection) setCpuSamplingRate(context, selection.code); });
}

function initializeMemorySamplingRate(context: vscode.ExtensionContext) {
    const persistentMemorySamplingRate: string | undefined = context.globalState.get(PERSISTENT_MEMORY_SAMPLING_RATE);
    memorySamplingRate = persistentMemorySamplingRate === undefined ? memorySamplingRate : parseInt(persistentMemorySamplingRate);
    setMemorySamplingRate(undefined, memorySamplingRate);
}

async function setMemorySamplingRate(context: vscode.ExtensionContext | undefined, code: number) {
    memorySamplingRate = code;
    memorySamplerRateNode.updateSamplingRate();
    if (context) {
        await context.globalState.update(PERSISTENT_MEMORY_SAMPLING_RATE, String(code));
    }
}

function configureMemorySamplingRate(context: vscode.ExtensionContext) {
    let choices: QuickPickNumber[] = getMemorySamplingFrequencies();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select memory sampling rate'
    }).then(selection => { if (selection) setMemorySamplingRate(context, selection.code); });
}

function initializeJfrSettings(context: vscode.ExtensionContext) {
    const persistentJfrSettings: string | undefined = context.globalState.get(PERSISTENT_JFR_SETTINGS);
    jfrSettings = persistentJfrSettings === undefined ? jfrSettings : parseInt(persistentJfrSettings);
    setJfrSettings(undefined, jfrSettings);
}

async function setJfrSettings(context: vscode.ExtensionContext | undefined, code: number) {
    jfrSettings = code;
    jfrSettingsNode.updateSettings();
    if (context) {
        await context.globalState.update(PERSISTENT_JFR_SETTINGS, String(code));
    }
}

function configureJfrSettings(context: vscode.ExtensionContext) {
    let choices: QuickPickString[] = getJfrSettingsChoices();
    vscode.window.showQuickPick(choices, {
        placeHolder: 'Select JFR settings'
    }).then(selection => { if (selection) setJfrSettings(context, selection.code); });
}


async function getLaunchCommand(openPID: boolean = false): Promise<string | undefined> {
    if (!graalVMHome || featureSet === 0) {
        setupGraalVM(true);
        return;
    }
    const executable = utils.findExecutable('jvisualvm', graalVMHome);
    if (!executable) {
        vscode.window.showErrorMessage("VisualVM not found in active GraalVM installation.");
        return;
    }

    // VisualVM launcher
    let command = executable.indexOf(' ') > -1 ? `"${executable}"` : executable;

    // Increase commandline length for jvmstat
    command += ' -J-XX:PerfMaxStringConstLength=6144';

    // Increase default timeout searching for the defined PID
    if (featureSet >= 2) {
        command += ' -J-Dvisualvm.search.process.timeout=10000';
    }

    // Bring VisualVM window to front on each command
    if (featureSet >= 2 && windowToFront) {
        command += ' --window-to-front';
    }

    // Configure Options | Sources in VisualVM to open in VS Code
    if (featureSet >= 2) {
        if (projectName !== undefined && sourcesIntegration) {
            let sourceViewer = '';
            const vsCodeLauncher = findVSCodeLauncher();
            if (vsCodeLauncher) sourceViewer = `${vsCodeLauncher} -g {file}:{line}:{column}`;

            let sourceRoots = '';
            const projectSourceRoots = await supportsProjectSourceRoots() ? await findProjectSourceRoots() : undefined;
            const javaSourceRoots = findJavaSourceRoots(graalVMHome);
            if (projectSourceRoots || javaSourceRoots) {
                sourceRoots = `${projectSourceRoots ? projectSourceRoots : javaSourceRoots}`;
                if (projectSourceRoots && javaSourceRoots) sourceRoots += path.delimiter + javaSourceRoots;
            }

            if (sourceViewer.length + sourceRoots.length < 200) {
                command += ` --source-viewer="${sourceViewer}"`;
                command += ` --source-roots="${sourceRoots}"`;
            } else {
                const file = await writeProperties('visualvm-source-config', `source-viewer=${sourceViewer}`, `source-roots=${sourceRoots}`);
                if (file) {
                    command += ` --source-config="${encode(file)}"`;
                }
            }
        } else {
            // Make sure to reset the previously forced settings
            command += ' --source-viewer=""';
            command += ' --source-roots=""';
        }
    }

    // Optionally open predefined view for the process
    if (openPID && PID) {
        command += ` --openpid ${PID?.toString()}`;
        if (preselect !== '1') command += `@${preselect}`
    }
    
    return command;
}

function findVSCodeLauncher(): string | undefined {
    const execPath = process.execPath;
    let launcherPath: string | undefined = undefined;
    
    if (process.platform === 'darwin') {
        const CONTENTS_HANDLE = '/Contents';
        const idx = execPath.indexOf(`${CONTENTS_HANDLE}/Frameworks/`);
        if (idx > -1) {
            launcherPath = `${execPath.substring(0, idx + CONTENTS_HANDLE.length)}/Resources/app/bin/code`;
        }
    } else {
        const execDir = path.resolve(execPath, '..');
        launcherPath = path.join(execDir, 'bin', 'code');
        if (process.platform === 'win32') {
            launcherPath = `${launcherPath}.cmd`;
        }
    }
    
    if (launcherPath && fs.existsSync(launcherPath)) {
        if (launcherPath.indexOf(' ') > -1) {
            launcherPath = `"${launcherPath}"`;
        }
        return encode(launcherPath);
    }

    return undefined;
}

async function supportsProjectSourceRoots(): Promise<boolean> {
    const commands: string[] = await vscode.commands.getCommands();
    return commands.includes('java.get.project.source.roots');
}

async function findProjectSourceRoots(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        let ret: string | undefined = undefined;
        for (const folder of folders) {
            let roots: string[] | undefined = await vscode.commands.executeCommand('java.get.project.source.roots', folder.uri.toString());
            if (roots) {
                for (const root of roots) {
                    if (ret === undefined) ret = ''; else ret += path.delimiter;
                    ret += encode(vscode.Uri.parse(root).fsPath);
                };
            }
        }
        return ret;
    } else {
        return undefined;
    }
}


function findJavaSourceRoots(graalVMHome: string): string | undefined {
    const modularJavaSrc = path.join(graalVMHome, 'lib', 'src.zip');
    if (fs.existsSync(modularJavaSrc)) {
        return `${encode(modularJavaSrc)}[subpaths=*modules*]`;
    }
    
    const javaSrc = path.join(graalVMHome, 'src.zip');
    if (fs.existsSync(javaSrc)) {
        return encode(javaSrc);
    }

    return undefined;
}

function getJdkPackages(): string {
    let ret: string = 'java.**, javax.**, jdk.**';
    ret += ', org.graalvm.**';
    ret += ', com.sun.**, sun.**, sunw.**';
    ret += ', org.omg.CORBA.**, org.omg.CosNaming.**, COM.rsa.**';
    if (process.platform === 'darwin') {
        ret += ', apple.laf.**, apple.awt.**, com.apple.**';
    }
    return encode(ret);
}

async function supportsProjectPackages(): Promise<boolean> {
    const commands: string[] = await vscode.commands.getCommands();
    return commands.includes('java.get.project.packages');
}

async function getProjectPackages(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        let ret: string | undefined = undefined;
        for (const folder of folders) {
            let packages: string[] | undefined = await vscode.commands.executeCommand('java.get.project.packages', folder.uri.toString(), true);
            if (packages) {
                for (const packg of packages) {
                    if (ret === undefined) ret = ''; else ret += ', ';
                    ret += packg + '.*';
                };
            }
        }
        return encode(ret);
    } else {
        return undefined;
    }
}

export function defineDisplayName(): string {
    processName = projectName;
    if (!processName) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            processName = folders[0].name;
        }
    }
    if (!processName) {
        processName = 'VSCode Project';
    }
    processName = processName.replace(' ', '_');
    return `${DISPLAY_NAME_PREFIX}${processName}${DISPLAY_NAME_SUFFIX}`;
}

export function attachVisualVM(): string {
    const id = Date.now().toString();
    ID = `-Dvisualvm.id=${id}`;
    PID = undefined;
    refreshUI();
    
    const searchID = ID;
    setTimeout(() => {
        const onFound = (_searchID: string, foundPID: number) => {
            setProcessVisualVM(foundPID);
            getWhenStartedChoices()[performWhenStarted].perform();
        };
        const onTimeout = (_searchID: string) => {
            clearMonitoredProcess();
        };
        const onCanceled = (_searchID: string) => {
        };
        awaitingProgress = 0;
        processNode.updateProcName();
        searchForProcess(searchID, 120, onFound, onTimeout, onCanceled);
    }, 1000);

    return ID;
}

async function searchForProcess(searchID: string, iterations: number, onFound: (searchID: string, foundPID: number) => void, onTimeout: (searchID: string) => void, onCanceled: (searchID: string) => void) {
    if (ID === searchID && iterations > 0) {
        const found = await findProcessByID(searchID);
        if (found) {
            onFound(searchID, found);
        } else {
            setTimeout(() => {
                awaitingProgress = awaitingProgress === 3 ? 0 : ++awaitingProgress;
                processNode.updateProcName();
                searchForProcess(searchID, --iterations, onFound, onTimeout, onCanceled);
            }, 1000);
        }
    } else if (iterations > 0) {
        if (onCanceled) onCanceled(searchID);
    } else {
        if (onTimeout) onTimeout(searchID);
    }
}

async function findProcessByID(searchID: string): Promise<number | undefined> {
    const executable = utils.findExecutable('jps', graalVMHome);
    if (!executable) {
        return;
    }
    const parts = await processCommand(`"${executable}" -v`);
    let ret: number | undefined;
    parts.some(p => {
        if (p.rest?.includes(searchID)) {
            ret = p.pid;
            return true;
        } else {
            return false;
        }
    });

    return ret;
}

async function findProcessByParams(searchParams: string[]): Promise<number | undefined> {
    const executable = utils.findExecutable('jps', graalVMHome);
    if (!executable) {
        return;
    }
    const parts = await processCommand(`"${executable}" -v`);
    let ret: number | undefined;
    parts.some(p => {
        if (includesAll(p.rest, searchParams)) {
            ret = p.pid;
            return true;
        } else {
            return false;
        }
    });

    return ret;
}

function includesAll(string: string | undefined, strings: string[]) {
    if (!string || string.length === 0) return false;
    for (const search of strings) {
        if (!string.includes(search)) return false;
    }
    return true;
}

async function setProcessVisualVM(pid: number) {
    awaitingProgress = 0;
    PID = pid;
    ID = undefined;
    processNode.updateProcName();
}

function clearMonitoredProcess() {
    awaitingProgress = 0;
    processName = undefined;
    PID = undefined;
    ID = undefined;
    processNode.updateProcName();
}

function checkProcessIsRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        vscode.window.showWarningMessage(`Process ${processNode.description} already terminated.`);
        clearMonitoredProcess();
        return false;
    }
}

async function checkPID(): Promise<boolean> {
    if (!PID) {
        await selectProcessVisualVM();
    }
    if (PID) {
        return checkProcessIsRunning(PID);
    }
    return false;
}

async function obtainRunningJavaProcesses(graalVMHome?: string): Promise<QuickPickProcess[] | undefined> {
    const executable = utils.findExecutable('jps', graalVMHome);
    if (!executable) {
        return;
    }
    const ret: QuickPickProcess[] = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Reading Java processes...',
        cancellable: false
    }, (_progress, _token) => {
        return new Promise(async (resolve) => {
            const parts1 = await processCommand(`"${executable}" -v`);
            const parts2 = await processCommand(`"${executable}" -lm`);
            const processes: QuickPickProcess[] = [];
            parts1.forEach(p1 => {
                const p2 = parts2.find(p2 => p2.pid === p1.pid);
                if (p2) {
                    processes.push(new QuickPickProcess(p1.pid, p1.rest, p2.rest));
                }
            });
            resolve(processes);
        });
    });
    return ret;
}

async function processCommand(cmd: string): Promise<Process[]> {
    return new Promise<Process[]>((resolve, reject) => {
        exec(cmd, async (error: any, stdout: string, _stderr) => {
            if (error) {
                reject(error);
            }
            const lines = stdout.split('\n');
            const parts: Process[] = [];
            lines.forEach(line => {
                const index = line.trim().indexOf(' ');
                if (index >= 0) {
                    parts.push({pid: Number.parseInt(line.slice(0, index)), rest: line.slice(index + 1, line.length)});
                } else {
                    parts.push({pid: Number.parseInt(line)});
                }
            });
            resolve(parts);
        });
    });
}

class QuickPickProcess implements vscode.QuickPickItem{
    label: string;
    description: string;
    detail?: string;
    constructor(
        public readonly pid: number,
        public readonly info1?: string,
        public readonly info2?: string
    ){
        if (info1) {
            const prefixIdx = info1.indexOf(DISPLAY_NAME_PREFIX);
            const suffixIdx = info1.indexOf(DISPLAY_NAME_SUFFIX);
            if (prefixIdx === -1 || suffixIdx === -1) {
                this.label = info1.split(' ')[0];
                if (this.label.length === 0) this.label = 'Java process';
            } else {
                this.label = info1.substring(prefixIdx + DISPLAY_NAME_PREFIX.length, suffixIdx);
            }
        } else {
            this.label = 'Java process';
        }
        this.description = `(pid ${pid})`;
        if (info2) this.detail = info2;
    }
}

class Process {
    constructor(
        public readonly pid: number,
        public readonly rest?: string
    ){}
}

export function configureSettingVisualVM(context: vscode.ExtensionContext, ...params: any[]) {
    if (params[0][0]) {
        (params[0][0] as Configurable).configure(context);
    }
}

function computeProcName(): string {
    if (PID) {
        if (processName) return `${processName} (pid ${PID.toString()})`;
        else return `Java process (pid ${PID.toString()})`;
    }

    if (!ID) return '<not selected, select...>';

    if (awaitingProgress === 1) return `${processName} (pid pending).`;
    if (awaitingProgress === 2) return `${processName} (pid pending)..`;
    return `${processName} (pid pending)...`;
}

export async function selectProcessVisualVM(selectOpen: boolean = false): Promise<boolean> {
    const picks = await obtainRunningJavaProcesses();
    if (picks) {
        picks.sort((a, b) => a.pid - b.pid);
        const pick = await vscode.window.showQuickPick(picks, {
            placeHolder: selectOpen ? 'Select the process to open in VisualVM' : 'Select the process to monitor by VisualVM'
        });
        if (pick) {
            processName = pick.label;
            setProcessVisualVM(pick.pid);
            return true;
        }
    } else {
        const str = await vscode.window.showInputBox({
            placeHolder: 'PID', 
            validateInput: input => (input && Number.parseInt(input) >= 0) ? undefined : 'PID must be positive integer',
            prompt: 'Enter the PID to open in VisualVM'
        });
        if (str) {
            processName = 'Java process';
            setProcessVisualVM(Number.parseInt(str));
            return true;
        }
    }
    return false;
}

export async function threadDumpVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --threaddump ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function heapDumpVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --heapdump ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function startCPUSamplerVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --start-cpu-sampler ${PID?.toString()}`;

            let filter = `${await getCpuSamplerFilters()[cpuSamplingFilter].getValue()}`;
            let samplingRate = `sampling-rate=${getCpuSamplingFrequencies()[cpuSamplingRate].value}`;
            if (filter.length + samplingRate.length < 200) {
                command += `@${filter},${samplingRate}`;
            } else {
                const file = await writeProperties('visualvm-sampler-config', filter, samplingRate);
                if (file) {
                    command += `@settings-file="${encode(file)}"`;
                }
            }
            
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function startMemorySamplerVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --start-memory-sampler ${PID?.toString()}`;
            command += `@sampling-rate=${getMemorySamplingFrequencies()[memorySamplingRate].value}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function snapshotSamplerVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --snapshot-sampler ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function stopSamplerVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --stop-sampler ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function startJFRRecordingVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand(true);
        if (command) {
            command += ` --start-jfr ${PID?.toString()}`;
            command += `@name=${encode(processName)},settings=${getJfrSettingsChoices()[jfrSettings].value}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function dumpJFRRecordingVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --dump-jfr ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function stopJFRRecordingVisualVM() {
    if (await checkPID() && featureSet >= 2) {
        let command = await getLaunchCommand();
        if (command) {
            command += ` --stop-jfr ${PID?.toString()}`;
            // console.log(`$$$ Executing command |${command}|`);
            exec(command);
        }
    }
}

export async function troubleshootNBLSThreadDump() {
    const threaddump = (pid: number) => {
        return ` --threaddump ${pid.toString()} --window-to-front`;
    };
    troubleshootNBLS(threaddump);
}

export async function troubleshootNBLSHeapDump() {
    const threaddump = (pid: number) => {
        return ` --heapdump ${pid.toString()} --window-to-front`;
    };
    troubleshootNBLS(threaddump);
}

let nblsSampling: boolean = false;
export async function troubleshootNBLSCpuSampler() {
    if (nblsSampling) {
        vscode.window.showWarningMessage('Troubleshoot Language Server: CPU sampling already in progress!')
        return;
    } else {
        nblsSampling = true;
    }
    try {
        let delay: number;
        const delayChoices: QuickPickNumber[] = getTroubleshootNBLSCpuSamplerDelays();
        const delaySelection = await vscode.window.showQuickPick(delayChoices, {
            placeHolder: 'Select the delay before starting CPU sampler'
        });
        if (delaySelection) {
            delay = delaySelection.value;
        } else {
            return;
        }
        
        let duration: number;
        const durationChoices: QuickPickNumber[] = getTroubleshootNBLSCpuSamplerDurations();
        const durationSelection = await vscode.window.showQuickPick(durationChoices, {
            placeHolder: 'Select the duration of CPU sampling'
        });
        if (durationSelection) {
            duration = durationSelection.value;
        } else {
            return;
        }

        if (delay > 0) {
            await troubleshootNBLS(); // start VisualVM in advance to be ready for sampling after the delay
            await waitWithProgress('Troubleshoot Language Server: waiting for CPU sampler...', delay);
        }
        let nblspid: number | undefined = undefined;
        const startSampler = (pid: number) => {
            nblspid = pid;
            let toFront = duration > 0 ? '' : ' --window-to-front';
            return ` --start-cpu-sampler ${pid}@include-classes=,sampling-rate=20${toFront}`;
        };
        await troubleshootNBLS(startSampler);
        if (nblspid !== undefined && duration > 0) {
            if (!checkNBLSProcessIsRunning(nblspid)) {
                return;
            }
            await waitWithProgress('Troubleshoot Language Server: CPU sampling in progress...', duration);
            if (!checkNBLSProcessIsRunning(nblspid)) {
                return;
            }
            const stopSampler = () => {
                return ` --snapshot-sampler ${nblspid} --stop-sampler ${nblspid} --window-to-front`;                
            };
            await troubleshootNBLS(stopSampler, nblspid);
        }
    } finally {
        nblsSampling = false;
    }
}

function checkNBLSProcessIsRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        vscode.window.showWarningMessage('Troubleshoot Language Server: the LS process already terminated');
        return false;
    }
}

async function waitWithProgress(message: string, ms: number) {
    if (ms < 1000) return;
    async function wait(time: number) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(undefined);
            }, time);
        })
    }
    async function waiter(progress: vscode.Progress<{ message?: string; increment?: number }>) {
        progress.report({
            increment: 1
        });
        const steps = ms / 1000;
        const incr = 100 / steps;
        for (let i = 0; i < steps; i++) {
            await wait(1000);
            progress.report({
                increment: incr
            });
        }
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false
    }, (progress) => {
        return waiter(progress);
    });
}

function getTroubleshootNBLSCpuSamplerDelays(): QuickPickNumber[] {
    return [
        new QuickPickNumber('3', 's', 3000, 0),
        new QuickPickNumber('5', 's', 5000, 1),
        new QuickPickNumber('10', 's', 10000, 2),
        new QuickPickNumber('30', 's', 30000, 3),
        new QuickPickNumber('1', 'm', 60000, 4),
        new QuickPickNumber('Start immediately', '', 0, 5)
    ];
}

function getTroubleshootNBLSCpuSamplerDurations(): QuickPickNumber[] {
    return [
        new QuickPickNumber('5', 's', 5000, 0),
        new QuickPickNumber('10', 's', 10000, 1),
        new QuickPickNumber('30', 's', 30000, 2),
        new QuickPickNumber('1', 'm', 60000, 3),
        new QuickPickNumber('3', 'm', 180000, 4),
        new QuickPickNumber('5', 'm', 300000, 5),
        new QuickPickNumber('Start only', '(manual snapshot & stop sampling in VisualVM)', 0, 6)
    ];
}

async function troubleshootNBLS(parameters: ((pid: number) => string) | undefined = undefined, nblsPID: number | undefined = undefined) {
    if (!graalVMHome) {
        vscode.window.showErrorMessage('Troubleshoot Language Server: No active GraalVM installation found');
        return;
    }
    if (featureSet < 2) {
        vscode.window.showErrorMessage('Troubleshoot Language Server: Active GraalVM version not supported');
        return;
    }
    const executable = utils.findExecutable('jvisualvm', graalVMHome);
    if (!executable) {
        vscode.window.showErrorMessage("Troubleshoot Language Server: VisualVM not found in active GraalVM installation.");
        return;
    }
    if (!nblsPID) {
        nblsPID = await findProcessByParams([ 'nbcode', 'asf.apache-netbeans-java', `-Djdk.home=${graalVMHome}` ]);
        if (!nblsPID) {
            vscode.window.showErrorMessage('Troubleshoot Language Server: the LS process not found');
            return;
        }
    }
    
    let command = executable.indexOf(' ') > -1 ? `"${executable}"` : executable; // VisualVM launcher
    command += ' -J-XX:PerfMaxStringConstLength=6144'; // Increase commandline length for jvmstat
    command += ' -J-Dvisualvm.search.process.timeout=10000'; // Increase default timeout searching for the defined PID
    if (parameters) {
        command += parameters(nblsPID);
    }
    // console.log(`$$$ Executing troubleshooting command |${command}|`);
    exec(command);
}

function encode(text: string | undefined): string {
    if (!text) return 'undefined';
    text = text.replace(/\'/g, '%27');
    text = text.replace(/\"/g, '%22');
    text = text.replace(/\s/g, '%20');
    text = text.replace( /,/g, '%2C');
    return text;
}

async function writeProperties(filename: string, ...records: string[]): Promise<string | undefined> {
    const tmp = await getTmpDir();
    if (tmp) {
        const file = path.join(tmp, filename);
        const stream = fs.createWriteStream(path.join(tmp, filename), { flags: 'w', encoding: 'utf8' });
        for (let record of records) {
            stream.write(record.replace(/\\/g, '\\\\') + '\n');
        }
        stream.end();
        return file;
    } else {
        return undefined;
    }
}

function getTmpDir(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const tmp = tmpdir();
        const realtmp = fs.realpathSync(tmp);
        resolve(realtmp);
    });
}


function refreshUI() {
    if (nodeProvider) {
        nodeProvider.refresh();
    }
}

function getWhenStartedChoices(): QuickPickAction[] {
    const ret: QuickPickAction[] = [];

    ret.push(new QuickPickAction('Do nothing', 'No action when process is started', () => {}, 0));
    ret.push(new QuickPickAction('Open process', 'Open the process in VisualVM and select the defined tab', startVisualVM, 1));
    
    if (featureSet >= 2) {
        ret.push(new QuickPickAction('Start CPU sampler', 'Open the process in VisualVM and start CPU sampler using the defined settings', startCPUSamplerVisualVM, 2));
        ret.push(new QuickPickAction('Start Memory sampler', 'Open the process in VisualVM and start Memory sampler using the defined settings', startMemorySamplerVisualVM, 3));
        ret.push(new QuickPickAction('Start JFR recording', 'Open the process in VisualVM and start flight recording using the defined settings', startJFRRecordingVisualVM, 4));
    }

    return ret;
}

class QuickPickAction implements vscode.QuickPickItem {
    constructor(
        public readonly label: string,
        public readonly detail: string,
        public readonly perform: () => any,
        public readonly code: number
    ) {}
}

function getCpuSamplerFilters(): QuickPickAsyncString[] {
    const ret: QuickPickAsyncString[] = [];

    ret.push(new QuickPickAsyncString('Include all classes', 'Collects data from all classes', async () => {
        return 'include-classes=';
    }, 0));
    ret.push(new QuickPickAsyncString('Exclude JDK classes', 'Excludes data from JDK classes (like java.*, com.sun.*, org.graalvm.* etc.)', async () => {
        const jdkPackages = getJdkPackages();
        return `exclude-classes=${jdkPackages}`;
    }, 1));

    if (projectName !== undefined) {
        ret.push(new QuickPickAsyncString('Include only project classes', 'Collects data only from project classes', async () => {
            const projectPackages = await supportsProjectPackages() ? await getProjectPackages() : undefined;
            if (projectPackages && projectPackages.length > 0) {
                return `include-classes=${projectPackages}`;
            } else {
                vscode.window.showWarningMessage(`Project classes cannot be resolved, all data will be collected.`);
                return `include-classes=`;
            }
        }, 2));
    }

    return ret;
}

class QuickPickAsyncString implements vscode.QuickPickItem {
    constructor(
        public readonly label: string,
        public readonly detail: string | undefined,
        public readonly getValue: () => Promise<string | undefined>,
        public readonly code: number
    ) {}
}

function getCpuSamplingFrequencies(): QuickPickNumber[] {
    return [
        new QuickPickNumber('20', 'ms', 20, 0),
        new QuickPickNumber('50', 'ms', 50, 1),
        new QuickPickNumber('100', 'ms', 100, 2),
        new QuickPickNumber('200', 'ms', 200, 3),
        new QuickPickNumber('500', 'ms', 500, 4),
        new QuickPickNumber('1.000', 'ms', 1000, 5),
        new QuickPickNumber('2.000', 'ms', 2000, 6),
        new QuickPickNumber('5.000', 'ms', 5000, 7),
        new QuickPickNumber('10.000', 'ms', 10000, 8)
    ];
}

function getMemorySamplingFrequencies(): QuickPickNumber[] {
    return [
        new QuickPickNumber('100', 'ms', 100, 0),
        new QuickPickNumber('200', 'ms', 200, 1),
        new QuickPickNumber('500', 'ms', 500, 2),
        new QuickPickNumber('1.000', 'ms', 1000, 3),
        new QuickPickNumber('2.000', 'ms', 2000, 4),
        new QuickPickNumber('5.000', 'ms', 5000, 5),
        new QuickPickNumber('10.000', 'ms', 10000, 6)
    ];
}

class QuickPickNumber implements vscode.QuickPickItem {
    constructor(
        public readonly label: string,
        public readonly description: string | undefined,
        public readonly value: number,
        public readonly code: number
    ) {}
}

function getJfrSettingsChoices(): QuickPickString[] {
    return [
        new QuickPickString('default', 'Collects a predefined set of information with low overhead', 'default', 0),
        new QuickPickString('profile', 'Provides more data than the default settings, but with more overhead and impact on performance', 'profile', 1)
    ];
}

class QuickPickString implements vscode.QuickPickItem {
    constructor(
        public readonly label: string,
        public readonly detail: string | undefined,
        public readonly value: string,
        public readonly code: number
    ) {}
}


class VisualVMNode extends vscode.TreeItem {

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

interface Configurable {

    configure(context: vscode.ExtensionContext): void;

}


class WhenStartedNode extends VisualVMNode implements Configurable {

    constructor() {
        super('When started:', undefined, 'visualvm.configure',  undefined, undefined);
        this.updateAction();
    }

    configure(context: vscode.ExtensionContext) {
        configureWhenStarted(context);
    }

    updateAction() {
        const value = getWhenStartedChoices()[performWhenStarted].label;
        this.description = value.charAt(0).toLowerCase() + value.slice(1);
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const whenStartedNode = new WhenStartedNode();

class EmptyNode extends VisualVMNode {

    constructor() {
        super('', undefined, undefined,  undefined, undefined);
    }

}
const emptyNode = new EmptyNode();

class LatestGraalVMNode extends VisualVMNode {

    iconPath =  new vscode.ThemeIcon('lightbulb');

    constructor() {
        super('Tip:', 'use the latest GraalVM for more features!', undefined,  undefined, undefined);
        this.tooltip = `${this.label} ${this.description}`;
    }

}
const latestGralVMNode = new LatestGraalVMNode();

class ThreadDumpNode extends VisualVMNode {

    constructor() {
        super('Thread dump', undefined, 'visualvm.threadDump',  undefined, undefined);
    }

}
const threadDumpNode = new ThreadDumpNode();

class HeapDumpNode extends VisualVMNode {

    constructor() {
        super('Heap dump', undefined, 'visualvm.heapDump',  undefined, undefined);
    }

}
const heapDumpNode = new HeapDumpNode();

class CpuSamplingFilterNode extends VisualVMNode implements Configurable {

    constructor() {
        super('Filter:', undefined, 'visualvm.configure',  undefined, undefined);
        this.updateFilter();
    }

    configure(context: vscode.ExtensionContext) {
        configureCpuSamplingFilter(context);
    }

    updateFilter() {
        const value = getCpuSamplerFilters()[cpuSamplingFilter].label;
        this.description = value.charAt(0).toLowerCase() + value.slice(1);
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const cpuSamplingFilterNode = new CpuSamplingFilterNode();

class CpuSamplingRateNode extends VisualVMNode implements Configurable {

    constructor() {
        super('Sampling rate:', undefined, 'visualvm.configure',  undefined, undefined);
        this.updateSamplingRate();
    }

    configure(context: vscode.ExtensionContext) {
        configureCpuSamplingRate(context);
    }

    updateSamplingRate() {
        const frequency = getCpuSamplingFrequencies()[cpuSamplingRate];
        this.description = `${frequency.label} ${frequency.description}`
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const cpuSamplingRateNode = new CpuSamplingRateNode();

class CpuSamplerNode extends VisualVMNode {

    constructor() {
        super('CPU sampler', undefined, 'visualvm.cpuSampler',  [ cpuSamplingFilterNode, cpuSamplingRateNode ], false);
    }

}
const cpuSamplerNode = new CpuSamplerNode();

class MemorySamplerRateNode extends VisualVMNode implements Configurable {

    constructor() {
        super('Sampling rate:', undefined, 'visualvm.configure',  undefined, undefined);
        this.updateSamplingRate();
    }

    configure(context: vscode.ExtensionContext) {
        configureMemorySamplingRate(context);
    }

    updateSamplingRate() {
        const frequency = getMemorySamplingFrequencies()[memorySamplingRate];
        this.description = `${frequency.label} ${frequency.description}`
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const memorySamplerRateNode = new MemorySamplerRateNode();

class MemorySamplerNode extends VisualVMNode {

    constructor() {
        super('Memory sampler', undefined, 'visualvm.memorySampler',  [ memorySamplerRateNode ], false);
    }

}
const memorySamplerNode = new MemorySamplerNode();

class JfrSettingsNode extends VisualVMNode implements Configurable {

    constructor() {
        super('Settings:', undefined, 'visualvm.configure',  undefined, undefined);
        this.updateSettings();
    }

    configure(context: vscode.ExtensionContext) {
        configureJfrSettings(context);
    }

    updateSettings() {
        this.description = getJfrSettingsChoices()[jfrSettings].label;
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

}
const jfrSettingsNode = new JfrSettingsNode();

class JfrNode extends VisualVMNode {

    constructor() {
        super('JFR', undefined, 'visualvm.jfr', [ jfrSettingsNode ], false);
    }

}
const jfrNode = new JfrNode();

class ProcessNode extends VisualVMNode {

    constructor() {
        super('Process:', undefined, 'visualvm.process', undefined, true);
        this.updateProcName();
        this.updateFeatures();
    }

    updateProcName() {
        this.description = computeProcName();
        this.tooltip = `${this.label} ${this.description}`;
        refreshUI()
    }

    updateFeatures() {
        if (featureSet === 0) {
            this.children = [];
        } else if (featureSet === 1) {
            this.children = [ whenStartedNode ];
        } else {
            this.children = [ whenStartedNode, threadDumpNode, heapDumpNode, cpuSamplerNode, memorySamplerNode, jfrNode ];
        }
        refreshUI();
    }

}
const processNode = new ProcessNode();

export class VisualVMNodeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

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
            if (featureSet === 0) {
                return [];
            } else if (featureSet === 1) {
                return [ processNode, emptyNode, latestGralVMNode ];
            } else {
                return [ processNode ];
            }
        } else {
            return (element as VisualVMNode).getChildren();
        }
	}
}
export const nodeProvider = new VisualVMNodeProvider();
