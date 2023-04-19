/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export async function micronautProjectExists(): Promise<boolean> {
	return (await vscode.workspace.findFiles('**/micronaut-cli.yml', '**/node_modules/**')).length > 0;
}

export function getMicronautHome(): string {
	let micronautHome: string = vscode.workspace.getConfiguration('micronaut').get('home') as string;
	if (micronautHome) {
		return micronautHome;
	}
	micronautHome = process.env['MICRONAUT_HOME'] as string;
	return micronautHome;
}

export function getMicronautLaunchURL(): string {
	let micronautLaunchURL: string = vscode.workspace.getConfiguration('micronaut').get('launchUrl') as string;
	if (!micronautLaunchURL) {
		micronautLaunchURL = process.env['MICRONAUT_LAUNCH_URL'] as string;
	}
	if (micronautLaunchURL) {
		if (!micronautLaunchURL.startsWith('https://') && !micronautLaunchURL.startsWith('http://')) {
			micronautLaunchURL = 'https://' + micronautLaunchURL;
		}
		if (micronautLaunchURL.endsWith('/')) {
			return micronautLaunchURL.slice(0, micronautLaunchURL.length - 1);
		}
	}
	return micronautLaunchURL;
}

export function getJavaHome(): string {
	let javaHome: string = vscode.workspace.getConfiguration('graalvm').get('home') as string;
	if (javaHome) {
		return javaHome;
	}
	javaHome = process.env['GRAALVM_HOME'] as string;
	if (javaHome) {
		return javaHome;
	}
	const javaRuntimes = vscode.workspace.getConfiguration('java').get('configuration.runtimes') as any[];
	for (const runtime of javaRuntimes) {
		if (runtime && typeof runtime === 'object' && runtime.path && runtime.default) {
			return runtime.path;
		}
	}
	javaHome = vscode.workspace.getConfiguration('java').get('home') as string;
	if (javaHome) {
		return javaHome;
	}
	javaHome = process.env['JAVA_HOME'] as string;
	return javaHome;
}

export async function getJavaVersion(homeFolder: string): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        if (homeFolder && fs.existsSync(homeFolder)) {
            const executable: string | undefined = findExecutable('java', homeFolder);
            if (executable) {
                cp.execFile(executable, ['-version'], { encoding: 'utf8' }, (_error, _stdout, stderr) => {
                    if (stderr) {
                        let javaVersion: string | undefined;
                        let graalVMInfo: string | undefined;
                        let javaVMInfo: string | undefined;
                        stderr.split('\n').forEach((line: string) => {
							const javaInfo: string[] | null = line.match(/version\s+"(\S+)"/);
							const gvmInfo = line.match(/(GraalVM.*)\s+\(/);
							const jvmInfo = line.match(/^(.*)\s+Runtime Environment/);
							if (javaInfo && javaInfo.length > 1) {
								javaVersion = javaInfo[1];
							}
							if (gvmInfo && gvmInfo.length > 1) {
								graalVMInfo = gvmInfo[1];
							}
							if (jvmInfo && jvmInfo.length > 1) {
								javaVMInfo = jvmInfo[1];
							}
                        });
                        if (javaVersion && (javaVMInfo || graalVMInfo)) {
							let majorVersion = javaVersion;
                            if (majorVersion.startsWith('1.')) {
                                majorVersion = majorVersion.slice(2);
                            }
                            let i = majorVersion.indexOf('.');
                            if (i > -1) {
                                majorVersion = majorVersion.slice(0, i);
                            }
                            resolve(graalVMInfo ? `${graalVMInfo}, Java ${majorVersion}` : `${javaVMInfo} ${javaVersion}, Java ${majorVersion}`);
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

export function findExecutable(program: string, home: string): string | undefined {
    if (home) {
        let executablePath = path.join(home, 'bin', program);
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
	activeItems?: T | T[];
	placeholder: string;
	canSelectMany?: boolean;
	buttons?: vscode.QuickInputButton[];
	shouldResume: () => Thenable<boolean>;
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	validate: (value: string) => Promise<string | undefined>;
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

	async showQuickPick<T extends vscode.QuickPickItem, P extends QuickPickParameters<T>>({ title, step, totalSteps, items, activeItems, placeholder, canSelectMany, buttons, shouldResume }: P) {
		const disposables: vscode.Disposable[] = [];
		try {
			return await new Promise<T | readonly T[] | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
				const input = vscode.window.createQuickPick<T>();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.placeholder = placeholder;
				input.items = items;
				if (canSelectMany) {
					input.canSelectMany = canSelectMany;
				}
				if (activeItems) {
					input.activeItems = Array.isArray(activeItems) ? activeItems : [activeItems];
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
					input.onDidAccept(() => {
						resolve(canSelectMany ? input.selectedItems : input.selectedItems[0]);
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
				let validating = validate('');
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
						if (!(await validate(value))) {
							resolve(value);
						}
						input.enabled = true;
						input.busy = false;
					}),
					input.onDidChangeValue(async text => {
						const current = validate(text);
						validating = current;
						const validationMessage = await current;
						if (current === validating) {
							input.validationMessage = validationMessage;
						}
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
