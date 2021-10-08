/*
 * Copyright (c) 2019, 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as kubernetes from 'vscode-kubernetes-tools-api';
import * as net from 'net';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as utils from './utils';
import { LSPORT, connectToLanguageServer, stopLanguageServer, lspArgs, hasLSClient, setLSPID } from './graalVMLanguageServer';
import { StreamInfo } from 'vscode-languageclient';
import { ILaunchRequestArguments, IGraalVMLaunchInfo } from './graalVMDebugInterfaces';
import { getGVMConfig, getConf, getGVMHome } from './graalVMConfiguration';

const DEBUG_TERMINAL_NAME = 'GraalVM Debug Console';
const NODE: string = "node";
const POLYGLOT: string = "polyglot";

let rTermArgs: string[] | undefined;

export class GraalVMDebugAdapterTracker implements vscode.DebugAdapterTrackerFactory {

	createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
		const inProcessServer = getGVMConfig().get('languageServer.inProcessServer') as boolean;
		return {
			onDidSendMessage(message: any) {
				if (message.type === 'event' && !hasLSClient() && session.configuration.request === 'launch' && inProcessServer) {
					if (message.event === 'output' && message.body.category === 'telemetry' && message.body.output === 'childProcessID') {
						setLSPID(message.body.data.pid);
					}
					if (message.event === 'initialized') {
						connectToLanguageServer(() => new Promise<StreamInfo>((resolve, reject) => {
							const socket = new net.Socket();
							socket.once('error', (e) => {
								reject(e);
							});
							socket.connect(session.configuration._lsPort ? session.configuration._lsPort : LSPORT, '127.0.0.1', () => {
								resolve({
									reader: socket,
									writer: socket
								});
							});
						}));
					}
				}
			},
			onWillStopSession() {
				if (rTermArgs) {
					getConf('r').update('rterm.option', rTermArgs, true);
				}
			}
		};
	}
}

export class GraalVMConfigurationProvider implements vscode.DebugConfigurationProvider {

	resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
		return new Promise<vscode.DebugConfiguration>(resolve => {
			if (!config.type && !config.request && !config.name && !config.runtimeExecutable) {
				// if launch.json is missing or empty
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					switch (editor.document.languageId) {
						case 'javascript':
						case 'typescript':
							config.runtimeExecutable = 'js';
							break;
						case 'python':
							config.runtimeExecutable = 'graalpython';
							break;
						case 'r':
							config.runtimeExecutable = 'Rscript';
							break;
						case 'ruby':
							config.runtimeExecutable = 'ruby';
							break;
					}
					if (config.runtimeExecutable) {
						config.type = 'graalvm';
						config.name = 'Launch';
						config.request = 'launch';
						config.program = '${file}';
					}
				}
			}

			if (config.request === 'launch' && config.name === 'Launch R Term') {
				config.request = 'attach';
				const conf = getConf('r');
				rTermArgs = conf.get('rterm.option') as string[];
				let args = config.runtimeArgs ? rTermArgs.slice().concat(config.runtimeArgs) : rTermArgs.slice();
				if (!args.find((arg: string) => arg.startsWith('--inspect'))) {
					args.push('--inspect.Suspend=false');
				}
				conf.update('rterm.option', args, true);
				setTimeout(() => {
					vscode.commands.executeCommand('r.createRTerm');
					setTimeout(() => {
						resolve(config);
					}, config.timeout | 3000);
				}, 1000);
			} else {
				const gvmc = getGVMConfig();
				const inProcessServer = gvmc.get('languageServer.inProcessServer') as boolean;
				const graalVMHome = getGVMHome(gvmc);
				if (graalVMHome) {
					config.graalVMHome = graalVMHome;
					const graalVMBin = path.join(graalVMHome, 'bin');
					if (config.env) {
						config.env['PATH'] = updatePath(config.env['PATH'], graalVMBin);
					} else {
						config.env = { 'PATH': graalVMBin };
					}
					if (config.request === 'launch' && inProcessServer) {
						stopLanguageServer().then(() => {
							lspArgs().then(args => {
								const lspArg = args.find(arg => arg.startsWith('--lsp='));
								if (lspArg) {
									config._lsPort = parseInt(lspArg.substring(6));
								}
								if (config.runtimeArgs) {
									config.runtimeArgs = config.runtimeArgs.filter((arg: string) => !arg.startsWith('--lsp'));
									config.runtimeArgs = config.runtimeArgs.concat(args);
									let idx = config.runtimeArgs.indexOf('--experimental-options');
									if (idx < 0) {
										config.runtimeArgs = config.runtimeArgs.concat('--experimental-options');
									}
									if (config.runtimeExecutable !== POLYGLOT) {
										let idx = config.runtimeArgs.indexOf('--polyglot');
										if (idx < 0) {
											config.runtimeArgs = config.runtimeArgs.concat('--polyglot');
										}
									}
								} else {
									args = args.concat('--experimental-options');
									if (config.runtimeExecutable !== POLYGLOT) {
										args = args.concat('--polyglot');
									}
									config.runtimeArgs = args;
								}
								resolve(config);
							});
						});
					} else {
						resolve(config);
					}
				} else {
					resolve(config);
				}
			}
		});
	}

	resolveDebugConfigurationWithSubstitutedVariables?(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
        return getLaunchInfo(config, getGVMHome()).then(launchInfo => {
			config.graalVMLaunchInfo = launchInfo;
			if (config.program) {
				if (!getGVMConfig().get('languageServer.inProcessServer') as boolean) {
					vscode.commands.getCommands().then((commands: string[]) => {
						if (commands.includes('dry_run')) {
							vscode.commands.executeCommand('dry_run', pathToFileURL(config.program));
						}
					});
				}
			}
			return config;
		});
	}
}

export class GraalVMDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		if (session.configuration.protocol === 'debugAdapter') {
			if (session.configuration.request === 'attach') {
				return new vscode.DebugAdapterServer(session.configuration.port, session.configuration.address);
			} else if (session.configuration.request === 'launch') {
				if (session.configuration.console === 'integratedTerminal') {
					let terminal: vscode.Terminal | undefined = vscode.window.terminals.find(term => term.name === DEBUG_TERMINAL_NAME);
					if (terminal) {
						terminal.sendText(`cd ${session.configuration.graalVMLaunchInfo.cwd}`);
					} else {
						terminal = vscode.window.createTerminal({name: DEBUG_TERMINAL_NAME,	cwd: session.configuration.graalVMLaunchInfo.cwd});
					}
					terminal.sendText(`${session.configuration.graalVMLaunchInfo.exec.replace(/(\s+)/g, '\\$1')} ${session.configuration.graalVMLaunchInfo.args.join(' ')}`);
					terminal.show();
					return new Promise<vscode.DebugAdapterServer>(resolve => {
						setTimeout(() => {
							resolve(new vscode.DebugAdapterServer(session.configuration.graalVMLaunchInfo.port));
						}, session.configuration.timeout | 3000);
					});
				} else if (!session.configuration.console || session.configuration.console === 'internalConsole') {
					const spawnOpts: cp.SpawnOptions = {cwd: session.configuration.graalVMLaunchInfo.cwd, env: process.env, detached: true};
					const childProcess = cp.spawn(session.configuration.graalVMLaunchInfo.exec, session.configuration.graalVMLaunchInfo.args, spawnOpts);
					return new Promise<vscode.DebugAdapterServer>((resolve, reject) => {
						childProcess.on('error', (error) => {
							reject(new Error(`Cannot launch debug target (${error.toString()}).`));
						});
						const captureStdOutput: boolean = session.configuration.outputCapture === 'std';
						const noDebugMode = session.configuration.noDebug;
						if (childProcess.stderr) {
							childProcess.stderr.on('data', (data: string) => {
								if (noDebugMode || captureStdOutput) {
									let msg = data.toString();
									vscode.debug.activeDebugConsole.appendLine(msg);
								}
							});
						}
						let lastEarlyNodeMsgSeen: boolean = false;
						if (childProcess.stdout) {
							childProcess.stdout.on('data', (data: string) => {
								let msg = data.toString();
								if (!lastEarlyNodeMsgSeen && !noDebugMode) {
									let regExp = /^\s*\[Graal DAP\] Starting server and listening on \S*\s*$/m;
									if (msg.match(regExp)) {
										lastEarlyNodeMsgSeen = true;
										resolve(new vscode.DebugAdapterServer(session.configuration.graalVMLaunchInfo.port));
									}
								}
								if (noDebugMode || captureStdOutput) {
									vscode.debug.activeDebugConsole.appendLine(msg);
								}
							});
						}
					});
				} else {
					throw new Error(`Unknown console type '${session.configuration.console}'.`);
				}
			}
		}
		return executable;
	}

	dispose() {
	}
}

export async function attachToKubernetes(target?: any): Promise<void> {
    const explorer = await kubernetes.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`Cluster Explorer not available: ${explorer.reason}.`);
        return;
    }
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available: ${kubectl.reason}.`);
        return;
    }
    const node = explorer.api.resolveCommandTarget(target);
    if (node && node.nodeType === 'resource' && node.resourceKind.manifestKind === 'Pod') {
		const namespace = node.namespace ? node.namespace : undefined;
        const port = await getDebugPort(kubectl.api, node.name, namespace);
        if (!port) {
            utils.askYesNo(`Debug port not opened in selected pod. Restart pod with debug port opened?`, async () => {
				let info: any = {name: node.name, kind: 'Pod'};
				while (info && info.kind !== 'Deployment') {
					info = await getOwner(kubectl.api, info.name, info.kind);
				}
				if (info) {
					const success = await redeployWithDebugPortOpened(kubectl.api, info.name);
					if (success) {
						vscode.window.showInformationMessage(`Restarted. Refresh cluster explorer and invoke debug action again.`);
						return;
					}
				}
				vscode.window.showInformationMessage(`Cannot restart pod automatically. Try to restart the pod manually.`);
			});
            return;
        }
        const forward = await kubectl.api.portForward(node.name, namespace, port, port, { showInUI: { location: 'status-bar' }});
        if (forward) {
            const workspaceFolder = await selectWorkspaceFolder();
            const debugConfig : vscode.DebugConfiguration = {
                type: "java8+",
                name: "Attach to Kubernetes",
                request: "attach",
                hostName: "localhost",
                port: port.toString()
            };
            const ret = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
            if (ret) {
				forwardAndPrintAppUrl(kubectl.api, node.name, namespace);
                const listener = vscode.debug.onDidTerminateDebugSession(() => {
                    listener.dispose();
                    forward.dispose();
                });
            } else {
                forward.dispose();
            }
        }
		return;
    }
    vscode.window.showErrorMessage(`This command is available only on Kubernetes Node or Pod resources.`);
}

async function forwardAndPrintAppUrl(kubectl: kubernetes.KubectlV1, podName: string, podNamespace?: string): Promise<void> {
	const namespaceArg = podNamespace ? `--namespace ${podNamespace}` : '';
	let command = `get pod ${podName} ${namespaceArg} -o jsonpath='{..spec.containers[*].ports[*].containerPort}'`;
	let result = await kubectl.invokeCommand(command);
	if (result && result.code === 0) {
		const ports = result.stdout.trim().split(' ');
		ports.forEach ((port) => {
			kubectl.portForward(
				podName, 
				podNamespace, 
				Number(port), 
				Number(port), 
				{ showInUI: { location: 'status-bar' }})
				.then(() => vscode.debug.activeDebugConsole.appendLine(`Application is listening at http://localhost:${port} with debugger enabled`));
		});
	} 
}

async function selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('No open folder found.');
        return undefined;
    } else if (vscode.workspace.workspaceFolders.length === 1) {
        return vscode.workspace.workspaceFolders[0];
    }
    return await vscode.window.showWorkspaceFolderPick();
}

async function getDebugPort(kubectl: kubernetes.KubectlV1, podName: string, podNamespace?: string): Promise<number | undefined> {
    const envs = await getEnv(kubectl, podName, podNamespace);
    if (envs) {
        for (const env of envs) {
            const matches = env.match(/^JAVA_TOOL_OPTIONS=(-agentlib|-Xrunjdwp):\S*(address=[^\s,]+)\S*/i);
            if (matches && matches.length > 0) {
                const addresses = matches[2].split("=")[1].split(":");
                return Number(addresses[addresses.length - 1]);
            }
        }
    }
    return undefined;
}

async function getEnv(kubectl: kubernetes.KubectlV1, podName: string, podNamespace?: string): Promise<string[] | undefined> {
    const namespaceArg = podNamespace ? `--namespace ${podNamespace}` : '';
    const command = `exec ${podName} ${namespaceArg} -- env`;
    const result: kubernetes.KubectlV1.ShellResult | undefined = await kubectl.invokeCommand(command);
    if (result && result.code === 0) {
        return result.stdout.split('\n');
    }
    return undefined;
}

async function getOwner(kubectl: kubernetes.KubectlV1, name: string, kind: string): Promise<any> {
	let kindArg: string;
	switch (kind) {
		case 'Pod':
			kindArg = 'po';
			break;
		case 'ReplicaSet':
			kindArg = 'rs';
			break;
		default:
			return undefined;
	}
	const command = `get ${kindArg}/${name} -o json`;
	const result: kubernetes.KubectlV1.ShellResult | undefined = await kubectl.invokeCommand(command);
	if (result && result.code === 0) {
		const owners = JSON.parse(result.stdout)?.metadata?.ownerReferences;
		if (owners && owners.length > 0) {
			return owners[0];
		}
	}
	return undefined;
}

async function redeployWithDebugPortOpened(kubectl: kubernetes.KubectlV1, appName?: string): Promise<boolean | undefined> {
	let command = `set env deployment/${appName} JAVA_TOOL_OPTIONS=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005`;
	let result: kubernetes.KubectlV1.ShellResult | undefined = await kubectl.invokeCommand(command);
	if (result && result.code === 0) {
		command = `rollout restart deployment ${appName}`;
		result = await kubectl.invokeCommand(command);
		return result && result.code === 0;
	}
	return false;
}

function updatePath(path: string | undefined, graalVMBin: string): string {
	if (!path) {
		return graalVMBin;
	}
	let pathItems = path.split(':');
	let idx = pathItems.indexOf(graalVMBin);
	if (idx < 0) {
		pathItems.unshift(graalVMBin);
	}
	return pathItems.join(':');
}

async function getLaunchInfo(config: vscode.DebugConfiguration | ILaunchRequestArguments, graalVMHome: string | undefined): Promise<IGraalVMLaunchInfo> {
	const port = config.port || utils.random(3000, 50000);
	let runtimeExecutable = config.runtimeExecutable;
	if (runtimeExecutable) {
		if (path.isAbsolute(runtimeExecutable)) {
			if (!fs.existsSync(runtimeExecutable)) {
				return Promise.reject(new Error(`Attribute 'runtimeExecutable' does not exist ('${runtimeExecutable}').`));
			}
		} else {
			const re = utils.findExecutable(runtimeExecutable, graalVMHome);
			if (!re) {
				return Promise.reject(new Error(`Cannot find runtime '${runtimeExecutable}' within your GraalVM installation. Make sure to have GraalVM '${runtimeExecutable}' installed.`));
			}
			runtimeExecutable = re;
		}
	} else {
		const re = utils.findExecutable(NODE, graalVMHome);
		if (!re) {
			return Promise.reject(new Error(`Cannot find runtime '${NODE}' within your GraalVM installation. Make sure to have GraalVM '${NODE}' installed.`));
		}
		runtimeExecutable = re;
	}
	let programPath = config.program;
	if (programPath) {
		if (!path.isAbsolute(programPath)) {
			return Promise.reject(new Error(`Attribute 'program' is not absolute ('${programPath}'); consider adding '\${workspaceFolder}/' as a prefix to make it absolute.`));
		}
		if (!fs.existsSync(programPath)) {
			if (fs.existsSync(programPath + '.js')) {
				programPath += '.js';
			} else {
				return Promise.reject(new Error(`Attribute 'program' does not exist ('${programPath}').`));
			}
		}
		programPath = path.normalize(programPath);
	}
	let program: string | undefined;
	let cwd = config.cwd;
	if (cwd) {
		if (!path.isAbsolute(cwd)) {
			return Promise.reject(new Error(`Attribute 'cwd' is not absolute ('${cwd}'); consider adding '\${workspaceFolder}/' as a prefix to make it absolute.`));
		}
		if (!fs.existsSync(cwd)) {
			return Promise.reject(new Error(`Attribute 'cwd' does not exist ('${cwd}').`));
		}
		if (programPath) {
			program = await utils.isSymlinked(cwd) ? programPath : path.relative(cwd, programPath);
		}
	} else if (programPath) {
		cwd = path.dirname(programPath);
		program = await utils.isSymlinked(cwd) ? programPath : path.basename(programPath);
	}
	const runtimeArgs = config.runtimeArgs || [];
	const programArgs = config.args || [];
	let launchArgs = [];
	if (!config.noDebug) {
		if (!config.protocol || config.protocol === 'chromeDevTools') {
			if (path.basename(runtimeExecutable) === NODE) {
				launchArgs.push(`--inspect-brk=${port}`);
			} else {
				launchArgs.push(`--inspect=${port}`);
			}
		} else if (config.protocol === 'debugAdapter') {
			let idx = runtimeArgs.indexOf('--jvm');
			if (idx < 0) {
				launchArgs.push('--jvm');
			}
			launchArgs.push(`--dap=${port}`);
		}
	}
	return Promise.resolve({exec: runtimeExecutable, args: runtimeArgs.concat(launchArgs, program ? [program] : [], programArgs), cwd: cwd, port: port});
}
