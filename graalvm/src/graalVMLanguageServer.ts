/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as utils from './utils';
import * as net from 'net';
import { GenericNotificationHandler, LanguageClient, LanguageClientOptions, StreamInfo } from 'vscode-languageclient';
import { getGVMConfig } from './graalVMConfiguration';

export const LSPORT: number = 8123;
const POLYGLOT: string = 'polyglot';
const delegateLanguageServers: Set<() => Thenable<String>> = new Set();

let languageClient: Promise<LanguageClient> | undefined;
let languageServerPID: number = 0;
let hasR: boolean | undefined;

export function registerLanguageServer(server: (() => Thenable<string>)): void {
    delegateLanguageServers.add(server);
}

export function startLanguageServer(graalVMHome?: string) {
	if (!graalVMHome) {
		return;
	}
	const languageServerStart = getGVMConfig().get('languageServer.start') as 'none' | 'single' | 'inProcess';
	if (languageServerStart === 'single' || delegateLanguageServers.size > 0) {
		const re = utils.findExecutable(POLYGLOT, graalVMHome);
		if (re) {
			let serverWorkDir: string | undefined = getGVMConfig().get('languageServer.currentWorkDir') as string;
			if (!serverWorkDir) {
				serverWorkDir = vscode.workspace.rootPath;
			}
			if (serverWorkDir) {
				connectToLanguageServer(() => new Promise<StreamInfo>((resolve, reject) => {
					lspArgs().then(args => {
						const lspArg = args.find(arg => arg.startsWith('--lsp='));
						const lsPort = lspArg ? parseInt(lspArg.substring(6)) : LSPORT;
						const serverProcess = cp.spawn(re, args.concat(['--experimental-options', '--shell']), { cwd: serverWorkDir });
						if (!serverProcess || !serverProcess.pid) {
							reject(`Launching server using command ${re} failed.`);
						} else {
							languageServerPID = serverProcess.pid;
							serverProcess.on('close', code => {
								if (code) {
									reject(`Server exited with exit code: ${code}`);
								}
							});
							serverProcess.stdout.once('data', () => {
								const socket = new net.Socket();
								socket.once('error', (e) => {
									reject(e);
								});
								setTimeout(() => {
									socket.connect(lsPort, '127.0.0.1', () => {
										resolve({
											reader: socket,
											writer: socket
										});
									});
								}, 1000);
							});
						}
					});
				}));
			}
		} else {
			vscode.window.showErrorMessage('Cannot find runtime ' + POLYGLOT + ' within your GraalVM installation.');
		}
	}
}

export function connectToLanguageServer(connection: (() => Thenable<StreamInfo>)) {
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'javascript' },
			{ scheme: 'file', language: 'sl' },
			{ scheme: 'file', language: 'python' },
			{ scheme: 'file', language: 'r' },
			{ scheme: 'file', language: 'ruby' }
		]
	};

	languageClient = new Promise<LanguageClient>((resolve) => {
		let client = new LanguageClient('GraalVMLanguageServer', 'GraalVM Language Client', connection, clientOptions);
		let prepareStatus = vscode.window.setStatusBarMessage("Graal Language Client: Connecting to GraalLS");
		client.onReady().then(() => {
			prepareStatus.dispose();
			vscode.window.setStatusBarMessage('GraalLS is ready.', 3000);
			resolve(client);
		}).catch(() => {
			prepareStatus.dispose();
			vscode.window.setStatusBarMessage('GraalLS failed to initialize.', 3000);
			resolve(client);
		});
		client.start();
	});
}

export function stopLanguageServer(): Thenable<void> {
	if (languageClient) {
		let terminate = () => {
			languageClient = undefined;
			if (languageServerPID > 0) {
				terminateLanguageServer();
			}
		};
		return languageClient.then((client) => client.stop().then(terminate, terminate));
	}
	if (languageServerPID > 0) {
		terminateLanguageServer();
	}
	return Promise.resolve();
}

export async function lspArgs(): Promise<string[]> {
	const port = utils.random(3000, 50000);
    let delegateServers: string | undefined = getGVMConfig().get('languageServer.delegateServers') as string;
	const s = Array.from(delegateLanguageServers).map(server => server());
	const r = await hasRSource();
    return Promise.all(s).then((servers) => {
		let args = r ? ['--jvm', `--lsp=${port}`] : [`--lsp=${port}`];
		delegateServers = delegateServers ? delegateServers.concat(',', servers.join()) : servers.join();
		if (delegateServers) {
			args = args.concat('--lsp.Delegates=' + delegateServers);
		}
		return args;
    });
}

export function setLSPID(pid: number) {
    languageServerPID = pid;
}

export function hasLSClient(): boolean {
    return languageClient !== undefined;
}

async function hasRSource(): Promise<boolean> {
	if (hasR === undefined) {
		const uris: vscode.Uri[] = await vscode.workspace.findFiles('*.{r,R}', undefined, 1);
		hasR = uris.length > 0;
		if (!hasR) {
			const fsWatcher = vscode.workspace.createFileSystemWatcher('*.{r,R}', false, true, true);
			fsWatcher.onDidCreate(_uri => {
				hasR = true;
				fsWatcher.dispose();
			});
		}
	}
	return hasR;
}

export async function onClientNotification(method: string, handler: GenericNotificationHandler): Promise<boolean> {
	if (languageClient) {
		let isSuccessful = false;
		await languageClient.then((client) => client.onNotification(method, handler)).then(() => isSuccessful = true);
		return isSuccessful;
	} else {
		return false;
	}
}

function terminateLanguageServer() {
	utils.killProcess(languageServerPID);
	languageServerPID = 0;
}
