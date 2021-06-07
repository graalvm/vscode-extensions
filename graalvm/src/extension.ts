/*
 * Copyright (c) 2019, 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { toggleCodeCoverage, activeTextEditorChaged } from './graalVMCoverage';
import { GraalVMConfigurationProvider, GraalVMDebugAdapterDescriptorFactory, GraalVMDebugAdapterTracker } from './graalVMDebug';
import { setupGraalVM, installGraalVM, addExistingGraalVM, installGraalVMComponent, uninstallGraalVMComponent, selectActiveGraalVM, findGraalVMs, InstallationNodeProvider, Component, Installation, removeGraalVMInstallation } from './graalVMInstall';
import { onClientNotification, startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { installRPackage, R_LANGUAGE_SERVER_PACKAGE_NAME } from './graalVMR';
import { installRubyGem, RUBY_LANGUAGE_SERVER_GEM_NAME } from './graalVMRuby';
import { addNativeImageToPOM, attachNativeImageAgent } from './graalVMNativeImage';
import { getGVMHome, setupProxy, configureGraalVMHome } from './graalVMConfiguration';
import { runVisualVMForPID } from './graalVMVisualVM';
import { removeSDKmanUnclassifiedInstallation } from './sdkmanSupport';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.selectGraalVMHome', async (installation?: string | Installation, nonInteractive?: boolean) => {
		await selectActiveGraalVM(installation instanceof Installation ? installation.home : installation, nonInteractive);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVM', () => {
		installGraalVM(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addExistingGraalVM', () => {
		addExistingGraalVM(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.findGraalVMs', async () => {
		const graalVMHome = getGVMHome();
		return (await findGraalVMs()).map(item => ({name: item.name, path: item.path, active: item.path === graalVMHome}));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVMComponent', (component: string | Component | undefined, homeFolder?: string) => {
		installGraalVMComponent(component, homeFolder, context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.uninstallGraalVMComponent', (component: string | Component | undefined, homeFolder?: string) => {
		uninstallGraalVMComponent(component, homeFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addNativeImageToPOM', () => {
		addNativeImageToPOM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.attachNativeImageAgent', async (): Promise<string> => {
		return await attachNativeImageAgent();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleCodeCoverage', () => {
		toggleCodeCoverage(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installRLanguageServer', () => {
		if(!installRPackage(R_LANGUAGE_SERVER_PACKAGE_NAME)){
			vscode.window.showErrorMessage("R isn't present in GraalVM Installation.");
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installRubyLanguageServer', () => {
		if(!installRubyGem(RUBY_LANGUAGE_SERVER_GEM_NAME)){
			vscode.window.showErrorMessage("Ruby isn't present in GraalVM Installation.");
		}
	}));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => {
		if (e) {
			activeTextEditorChaged(e);
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.setupProxy' , () => {
		setupProxy();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.removeInstallation', (path?: string | Installation) => {
		removeGraalVMInstallation(path instanceof Installation ? path.home : path);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.runVisualVMForPID', (pid?: number) => {
		runVisualVMForPID(pid);
	}));

	const nodeProvider = new InstallationNodeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('graalvm-installations', nodeProvider));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.refreshInstallations', () => nodeProvider.refresh()));
	const configurationProvider = new GraalVMConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('graalvm', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('node', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('graalvm', new GraalVMDebugAdapterDescriptorFactory()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('graalvm', new GraalVMDebugAdapterTracker()));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('graalvm.home')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
			const graalVMHome = getGVMHome();
			if (!graalVMHome) {
				setupGraalVM();
			}
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		} else if (e.affectsConfiguration('graalvm.installations') || e.affectsConfiguration('graalvm.systemDetect')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
		} else if (e.affectsConfiguration('graalvm.languageServer.currentWorkDir') || e.affectsConfiguration('graalvm.languageServer.inProcessServer')) {
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		}
	}));
	context.subscriptions.push(vscode.extensions.onDidChange(() => {
		const netbeansExt = vscode.extensions.getExtension('asf.apache-netbeans-java');
		if (netbeansExt) {
			configureGraalVMHome(getGVMHome(), true);
		}
	}));
	const graalVMHome = getGVMHome();
	if (!graalVMHome) {
		setupGraalVM();
	} else {
		selectActiveGraalVM(graalVMHome, true).then(() => startLanguageServer(graalVMHome));
	}
	vscode.window.setStatusBarMessage('GraalVM extension activated', 3000);
	
	// Public API
	return {
		onClientNotification: onClientNotification,
	};
}

export async function deactivate() {
	await stopLanguageServer();
	return await removeSDKmanUnclassifiedInstallation(getGVMHome());
}
