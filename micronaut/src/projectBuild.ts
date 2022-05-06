/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { getJavaHome, findExecutable } from "./utils";

const MICRONAUT: string = 'Micronaut';
const NATIVE_IMAGE: string = 'native-image';

interface Goals {
    build: vscode.QuickPickItem[];
    deploy: vscode.QuickPickItem[];
}
let goals: Goals;

export async function builderInit() {
    goals = await buildWrapper(getAvailableGradleGoals, getAvailableMavenGoals) || { build: [], deploy: [] };
}

export async function build(goal?: string, group?: string) {
    group = group || 'build';
    const items: vscode.QuickPickItem[] = goals[group as keyof Goals];
    if (!goal) {
        if (items.length === 0) {
            goal = 'build';
        } else {
            const selected = items.length > 1 ? await vscode.window.showQuickPick(items, { placeHolder: `Select ${group} goal to invoke` }) : items.length === 1 ? items[0] : undefined;
            if (selected) {
                goal = selected.label;
            }
        }
    }
    if (goal) {
        const javaHome = getJavaHome();
        const isNativeImageGoal = goal === 'nativeImage' || goal === 'nativeCompile' || goal === 'dockerBuildNative';
        if (javaHome && isNativeImageGoal) {
            const nativeImage = findExecutable(NATIVE_IMAGE, javaHome);
            if (!nativeImage) {
                const gu = findExecutable('gu', javaHome);
                if (gu) {
                    const selected = await vscode.window.showInformationMessage(`${NATIVE_IMAGE} is not installed in your GraalVM`, `Install ${NATIVE_IMAGE}`);
                    if (selected === `Install ${NATIVE_IMAGE}`) {
                        await vscode.commands.executeCommand('extension.graalvm.installGraalVMComponent', NATIVE_IMAGE, javaHome);
                        return;
                    }
                } else {
                    vscode.window.showWarningMessage(`native-image is missing in ${javaHome}`);
                }
            }
        }
        const command = await terminalCommandFor(goal);
        if (command) {
            let terminal: vscode.Terminal | undefined = vscode.window.terminals.find(terminal => terminal.name === MICRONAUT);
            if (terminal) {
                terminal.dispose();
            }
            const env: any = {};
            if (javaHome) {
                env.JAVA_HOME = javaHome;
                env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`;
            }
            if (isNativeImageGoal && process.platform === 'win32') {
                const command = 'extension.graalvm.createWindowsNITerminal';
                const commands: string[] = await vscode.commands.getCommands();
                if (commands.includes(command)) {
                    terminal = await vscode.commands.executeCommand(command, { name: MICRONAUT, env });
                }
                if (!terminal) {
                    return;
                }
            } else {
                terminal = vscode.window.createTerminal({ name: MICRONAUT, env });
            }
            terminal.show();
            terminal.sendText(command);
        } else {
            throw new Error(`No terminal command for ${goal}`);
        }
    }
}

async function buildWrapper<T>(gradle?: (wrapper: vscode.Uri, ...args: any[]) => Promise<T>, maven?: (wrapper: vscode.Uri, ...args: any[]) => T, ...args: any[]): Promise<T | undefined> {
    let wrapper: vscode.Uri[] = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/gradlew.bat' : '**/gradlew', '**/node_modules/**');
    if (gradle && wrapper && wrapper.length > 0) {
        return await gradle(wrapper[0], ...args);
    }
    wrapper = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/mvnw.bat' : '**/mvnw', '**/node_modules/**');
    if (maven && wrapper && wrapper.length > 0) {
        return maven(wrapper[0], ...args);
    }
    return undefined;
}

async function terminalCommandFor(goal: string): Promise<string | undefined> {
    return buildWrapper(terminalGradleCommandFor, terminalMavenCommandFor, goal);
}

async function terminalGradleCommandFor(wrapper: vscode.Uri, goal: string): Promise<string | undefined> {
    if (goal === 'nativeImage') {
        const microVersion = await getMicronautVersion();
        if (microVersion && microVersion.length > 1) {
            const major = parseInt(microVersion[0]);
            // Micronaut uses nativeCompile instead of nativeImage starting from 3.2.0
            if (major > 3 || (major === 3 && parseInt(microVersion[1]) >= 2)) {
                goal = 'nativeCompile';
            }
        }
    }
    const exec = wrapper.fsPath.replace(/(\s+)/g, '\\$1');
    if (exec) {
        return `${exec} ${goal}`;
    }
    return undefined;
}

async function getMicronautVersion(): Promise<string[] | undefined> {
    const properties: vscode.Uri[] = await vscode.workspace.findFiles('**/gradle.properties', '**/node_modules/**', 1);
    if (properties?.length == 1) {
        const fileStream = createReadStream(properties[0].fsPath);
        const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        for await (const line of rl) {
            const key = 'micronautVersion=';
            const str: string = line.toString();
            const idx = str.indexOf(key);
            if (idx >= 0) {
                return str.substr(idx + key.length).trim().split('.');
            }
        }
    }
    return undefined;
}

function terminalMavenCommandFor(wrapper: vscode.Uri, goal: string): string | undefined {
    const exec = wrapper.fsPath.replace(/(\s+)/g, '\\$1');
    if (exec) {
        let command;
        switch(goal) {
            case 'build':
                command = 'compile';
                break;
            case 'nativeImage':
                command = 'package -Dpackaging=native-image';
                break;
            case 'dockerBuild':
                command = 'package -Dpackaging=docker';
                break;
            case 'dockerBuildNative':
                command = 'package -Dpackaging=docker-native';
                break;
            case 'dockerPush':
                command = 'deploy -Dpackaging=docker';
                break;
            case 'dockerPushNative':
                command = 'deploy -Dpackaging=docker-native';
                break;
            default:
                command = goal;
                break;
        }
        if (command) {
            return `${exec} ${command}`;
        }
    }
    return undefined;
}

function getAvailableGradleGoals(wrapper: vscode.Uri): Promise<Goals> {
    const out = cp.execFileSync(wrapper.fsPath, ['tasks', `--project-dir=${path.dirname(wrapper.fsPath)}`]);
    const buildGoals: vscode.QuickPickItem[] = parseAvailableGradleGoals(out.toString(), 'Build tasks');
    const deployGoals: vscode.QuickPickItem[] = parseAvailableGradleGoals(out.toString(), 'Upload tasks');
    return Promise.resolve({ build: buildGoals, deploy: deployGoals });
}

function parseAvailableGradleGoals(out: string, category: string): vscode.QuickPickItem[] {
    const goals: vscode.QuickPickItem[] = [];
    let process: boolean = false;
    out.toString().split('\n').map(line => line.trim()).forEach(line => {
        if (process) {
            if (line.length === 0) {
                process = false;
            }
            if (!line.startsWith('---')) {
                const info: string[] | null = line.match(/(\S+)\s*-\s*(.*)/);
                if (info && info.length >= 3) {
                    goals.push({ label: info[1], detail: info[2] });
                }
            }
        } else {
            if (line === category) {
                process = true;
            }
        }
    });
    return goals;
}

function getAvailableMavenGoals(): Goals {
    const buildGoals: vscode.QuickPickItem[] = [
        { label: 'clean', detail: 'Cleans the project' },
        { label: 'compile', detail: 'Compiles the source code of the project' },
        { label: 'package', detail: 'Packages the compiled code in its distributable format' },
        { label: 'nativeImage', detail: 'Packages the compiled code as a GraalVM native image'},
        { label: 'dockerBuild', detail: 'Builds a Docker image with the application artifacts'},
        { label: 'dockerBuildNative', detail: 'Builds a Docker image with a GraalVM native image inside'}
    ];
    const deployGoals: vscode.QuickPickItem[] = [
        { label: 'dockerPush', detail: 'Pushes a Docker Image' },
        { label: 'dockerPushNative', detail: 'Pushes a Native Docker Image using GraalVM' }
    ];
    return { build: buildGoals, deploy: deployGoals };
}
