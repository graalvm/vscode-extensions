/*
 * Copyright (c) 2019, 2021, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from "vscode";
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as xmlparser from 'xml2js';
import { getGVMHome } from "./graalVMConfiguration";

export function random(low: number, high: number): number {
    return Math.floor(Math.random() * (high - low) + low);
}

export function findExecutable(program: string, graalVMHome?: string): string | undefined {
	graalVMHome = graalVMHome || getGVMHome();
    if (graalVMHome) {
        let executablePath = path.join(graalVMHome, 'bin', program);
        if (process.platform === 'win32') {
            if (fs.existsSync(executablePath + '.cmd')) {
                return executablePath + '.cmd';
            }
            if (fs.existsSync(executablePath + '.exe')) {
                return executablePath + '.exe';
            }
        } else if (fs.existsSync(executablePath)) {
            return executablePath;
        }
    }
    return undefined;
}

export function findExecutables(programs: string[], graalVMHome?: string): string | undefined {
	return programs.map(program => findExecutable(program, graalVMHome)).find(executable => executable !== undefined);
}

export function readDirSyncSafe(path: string): string[] {
    if(fs.existsSync(path))
        return fs.readdirSync(path);
    return [];
}

export async function ask(question: string, options: {option: string; fnc?: (() => any)}[], otherwise?: (() => any)): Promise<any> {
	const select = await vscode.window.showInformationMessage(question, ...options.map(o => o.option));
	if (!select) {
		if (!otherwise) {
			return;
		} else {
			return otherwise();
		}
	}
	const opt = options.find(o => o.option === select);
	if (opt && opt.fnc) {
		return opt.fnc();
	}
	return;
}

const YES: string = 'Yes';
const NO: string = 'No';
export async function askYesNo(question: string, ifYes: (() => any) | undefined, ifNo?: (() => any), otherwise?: (() => any)): Promise<any> {
	return ask(question, [{option: YES, fnc: ifYes}, {option: NO, fnc: ifNo}], otherwise);
}

const INSTALL: string = 'Install';
async function askInstall(question: string, ifYes: (() => any) | undefined, otherwise?: (() => any)): Promise<any> {
	return ask(question, [{option: INSTALL, fnc: ifYes}], otherwise);
}

export function isSamePath(): (path1: string) => ((path2: string) => boolean) {
    if (platform() !== PLATFORM_WINDOWS) {
        return (path1: string) => ((path2: string) => path1 === path2);
    }
    return (path1: string) => {
        const upperPath1 = path1.toUpperCase();
        return (path2: string) => upperPath1 === path2.toUpperCase();
    };
}

export async function runInTerminal(command: string) {
    let terminal: vscode.Terminal | undefined = vscode.window.activeTerminal;
    if (!terminal) {
        terminal = vscode.window.createTerminal();
	}
    terminal.show();
	terminal.sendText(command);
}

export function checkRecommendedExtension(extensionName: string, display: string): boolean {
	const extension =  vscode.extensions.getExtension(extensionName);
	if (!extension) {
		askInstall(`Do you want to install the recommended extensions for ${display}?`, 
			() => runInTerminal(`code --install-extension ${extensionName}`));
	}
	return extension !== undefined;
}

export function isSymlinked(dirPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        fs.lstat(dirPath, (err, stats) => {
            if (err) {
                reject(err);
            }
            if (stats.isSymbolicLink()) {
                resolve(true);
            } else {
                const parent = path.dirname(dirPath);
                if (parent === dirPath) {
                    resolve(false);
                } else {
                    resolve(isSymlinked(parent));
                }
            }
        });
    });
}
export const ARCH_X64: string = 'x64';
export const ARCH_AMD64: string = 'amd64';
export const ARCH_ARM64: string = 'arm64';
export const ARCH_AARCH64: string = 'aarch64';
export const ARCH_UNKNOWN: string = 'unknown';
export function getArch() {
	const arch = process.arch;
	switch (arch) {
		case ARCH_X64:
			return ARCH_AMD64;
		case ARCH_ARM64:
			return ARCH_AARCH64;
		default:
			return ARCH_UNKNOWN;
	}
}

export function killProcess(pid: number) {
    if (process.platform === 'win32') {
        try {
            cp.execSync(`${path.join(process.env['WINDIR'] || 'C:\\Windows', 'System32', 'taskkill.exe')} /f /t /pid ${pid}`);
        } catch (e) {}
    } else {
		const groupPID = -pid;
		try {
			process.kill(groupPID, 'SIGKILL');
		} catch (ex: unknown) {
			const e = ex as Error;
			if (e.message === 'kill ESRCH') {
				try {
					process.kill(pid, 'SIGKILL');
				} catch (e) {}
			}
		}
	}
}

export function checkFolderWritePermissions(graalVMHome: string, silent?: boolean): boolean {
    try {
		if (platform() === PLATFORM_WINDOWS) {
			const tmpFile = path.join(graalVMHome, 'tmp.tmp');
			fs.writeFileSync(tmpFile, '');
			fs.unlinkSync(tmpFile);
		} else {
			fs.accessSync(graalVMHome, fs.constants.W_OK);
		}
        return true;
    } catch (err) {
        if (!silent) {
            vscode.window.showErrorMessage(`Permission denied: no write access to ${graalVMHome}`);
        }
        return false;
    }
}

export const PLATFORM_WINDOWS: string = 'windows';
export const PLATFORM_WIN32: string = 'win32';
export const PLATFORM_OSX: string = 'osx';
export const PLATFORM_DARWIN: string = 'darwin';
export const PLATFORM_LINUX: string = 'linux';
export const PLATFORM_UNDEFINED: string = 'undefined';
export function platform(): string {
    if (process.platform === PLATFORM_LINUX) {
        return PLATFORM_LINUX;
    } else if (process.platform === PLATFORM_DARWIN) {
        return PLATFORM_OSX;
    } else if (process.platform === PLATFORM_WIN32) {
        return PLATFORM_WINDOWS;
    }
    return PLATFORM_UNDEFINED;
}

export function getUserHome(): string | undefined{
    const env = process.env;
	if (platform() === PLATFORM_WINDOWS) {
		const drive = env['HOMEDRIVE'];
		const homePath = env['HOMEPATH'];
		return drive && homePath ? drive + homePath : undefined;
	} else {
		return env['HOME'];
	}
}

function toNumber(value: string, _name: string): number | string {
	const out = Number.parseInt(value);
	return Number.isSafeInteger(out) ? out : value;
}

function toBoolean(value: string, _name: string): boolean | string {
	if (value === "true") {
		return true;
	} else if (value === "false") {
		return false;
	} else {
		return value;
	}
}

export async function parseXMLFile(file: string, explicitArray: boolean = false): Promise<any> {
    const content = readFileToString(file);
	return await xmlparser.parseStringPromise(content, { explicitArray: explicitArray, valueProcessors: [toNumber, toBoolean]});
}

export function writeXMLFile(file: string, content: any, pretty: boolean = true) {
	fs.writeFileSync(file, new xmlparser.Builder({renderOpts: {pretty: pretty}}).buildObject(content));
}

export function readFileToString(file: string): string {
	return fs.readFileSync(file).toString();
}

export function readReleaseFile(gvmHome?: string): any {
	gvmHome = gvmHome == undefined ? getGVMHome() : gvmHome;
	let content: string = readFileToString(path.join(gvmHome, "release"));
	return parsePropertiesString(content);
}

export function parsePropertiesString(content: string): any {
	return content.split("\n")
	.reduce((acc: any, line: string) => {
		const i = line.indexOf("=");
		acc[line.slice(0, i)] = line.slice(i + 1);
		return acc;
	}, {});
}

export function simpleProgress<T>(message: string, task: () => Thenable<T>): Thenable<T> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: message,
		cancellable: false
	}, (_progress, _token) => {
		return task();
	});
}

class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends vscode.QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	placeholder: string;
	postProcess?: (value: T) => Promise<void>;
	buttons?: vscode.QuickInputButton[];
	shouldResume: () => Thenable<boolean>;
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	validate?: (value: string) => Promise<string | undefined>;
	buttons?: vscode.QuickInputButton[];
	shouldResume: () => Thenable<boolean>;
}

export class MultiStepInput {

	static async run(start: InputStep) {
		const input = new MultiStepInput();
		return input.stepThrough(start);
	}

	private current?: vscode.QuickInput;
	private steps: InputStep[] = [];

	private async stepThrough(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel) {
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends vscode.QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItem, placeholder, postProcess, buttons, shouldResume }: P) {
		const disposables: vscode.Disposable[] = [];
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = vscode.window.createQuickPick<T>();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.placeholder = placeholder;
				input.items = items;
				if (activeItem) {
					input.activeItems = [activeItem];
				}
				input.buttons = [
					...(this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				input.ignoreFocusOut = true;
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === vscode.QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else {
							resolve(<any>item);
						}
					}),
					input.onDidAccept(async () => {
						const item = input.selectedItems[0];
						if (postProcess) {
							input.enabled = false;
							input.busy = true;
							try {
								await postProcess(item);
							} catch(ex: unknown) {
								const e = ex as Error;
								reject(InputFlowAction.cancel);
								vscode.window.showErrorMessage(e.message);
							}
							input.enabled = true;
							input.busy = false;
						}
						resolve(item);
					}),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})()
							.catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}

	async showInputBox<P extends InputBoxParameters>({ title, step, totalSteps, value, prompt, validate, buttons, shouldResume }: P) {
		const disposables: vscode.Disposable[] = [];
		try {
			return await new Promise<string | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = vscode.window.createInputBox();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.value = value || '';
				input.prompt = prompt;
				input.buttons = [
					...(this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : []),
					...(buttons || [])
				];
				input.ignoreFocusOut = true;
				disposables.push(
					input.onDidTriggerButton(item => {
						if (item === vscode.QuickInputButtons.Back) {
							reject(InputFlowAction.back);
						} else {
							resolve(<any>item);
						}
					}),
					input.onDidAccept(async () => {
						const value = input.value;
						input.enabled = false;
						input.busy = true;
						if (validate) {
							input.validationMessage = await validate(value);
						}
						if (!input.validationMessage) {
							resolve(value);
						}
						input.enabled = true;
						input.busy = false;
					}),
					input.onDidChangeValue(async () => {
						input.validationMessage = undefined;
					}),
					input.onDidHide(() => {
						(async () => {
							reject(shouldResume && await shouldResume() ? InputFlowAction.resume : InputFlowAction.cancel);
						})()
							.catch(reject);
					})
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current.show();
			});
		} finally {
			disposables.forEach(d => d.dispose());
		}
	}
}
