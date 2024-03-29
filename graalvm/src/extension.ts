/*
 * Copyright (c) 2023, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { toggleCodeCoverage, activeTextEditorChaged } from './graalVMCoverage';
import * as kubernetes from 'vscode-kubernetes-tools-api';
import * as debug from './graalVMDebug';
import { setupGraalVM, installGraalVM, addExistingGraalVM, installGraalVMComponent, uninstallGraalVMComponent, selectActiveGraalVM, findGraalVMs, InstallationNodeProvider, TreeItemComponent, Installation, removeGraalVMInstallation } from './graalVMInstall';
import { onClientNotification, startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { installRPackage, R_LANGUAGE_SERVER_PACKAGE_NAME } from './graalVMR';
import { installRubyGem, RUBY_LANGUAGE_SERVER_GEM_NAME } from './graalVMRuby';
import * as nativeImage from './graalVMNativeImage';
import { getGVMHome, setupProxy, configureGraalVMHome } from './graalVMConfiguration';
import * as gds from './gdsUtils';

export let extContext: vscode.ExtensionContext;
export function activate(context: vscode.ExtensionContext) {
	extContext = context;
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.selectGraalVMHome', async (installation?: string | Installation, nonInteractive?: boolean) => {
		await selectActiveGraalVM(installation instanceof Installation ? installation.home : installation, nonInteractive);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVM', () => {
		installGraalVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addExistingGraalVM', () => {
		addExistingGraalVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.findGraalVMs', async () => {
		const graalVMHome = getGVMHome();
		return (await findGraalVMs()).map(item => ({name: item.name, path: item.path, active: item.path === graalVMHome}));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVMComponent', (component: string | TreeItemComponent | undefined, homeFolder?: string) => {
		installGraalVMComponent(component, homeFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.uninstallGraalVMComponent', (component: string | TreeItemComponent | undefined, homeFolder?: string) => {
		uninstallGraalVMComponent(component, homeFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addNativeImageToPOM', () => {
		nativeImage.addNativeImageToPOM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.attachNativeImageAgent', async (): Promise<string> => {
		return await nativeImage.attachNativeImageAgent();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleCodeCoverage', () => {
		toggleCodeCoverage();
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
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.gds.showConfiguration', () => {
		gds.showConfiguration();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.createWindowsNITerminal', (options: vscode.TerminalOptions): Promise<vscode.Terminal | undefined> => {
		return nativeImage.createWindowsNITerminal(options);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.openWindowsNITerminal', () => {
		nativeImage.openWindowsNITerminal();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.showDocsNativeImage', (...params: any[]) => {
		nativeImage.showDocumentation(params);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.configureSettingNativeImage', (...params: any[]) => {
		nativeImage.configureSetting(context, params);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.openConfigNativeImage', () => {
		nativeImage.openConfiguration();
	}));
	nativeImage.initializeConfiguration().then(initialized => {
		if (initialized) {
			context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('java+', nativeImage.configurationProvider));
			context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('java8+', nativeImage.configurationProvider));
			context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('java', nativeImage.configurationProvider));
			vscode.commands.executeCommand('setContext', 'nativeImageInitialized', true);
		}
	});
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.debugKubernetes', debug.attachToKubernetes));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.heapReplay', debug.heapReplay));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installNBJava', () => {
		vscode.commands.executeCommand('workbench.extensions.installExtension', 'asf.apache-netbeans-java');
		nativeImage.setFeatureSet(-2);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installRHJava', () => {
		vscode.commands.executeCommand('workbench.extensions.installExtension', 'redhat.java');
		nativeImage.setFeatureSet(-2);
	}));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('ni-control-panel', nativeImage.nodeProvider));
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'extension.graalvm.debugPod', 
			(kubectl: kubernetes.KubectlV1, podName: string, namespace?: string) => {
				debug.attachToPod(kubectl, podName, namespace);
			})
	);

	const nodeProvider = new InstallationNodeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('graalvm-installations', nodeProvider));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.refreshInstallations', () => nodeProvider.refresh()));
	const configurationProvider = new debug.GraalVMConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('graalvm', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('node', configurationProvider));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('graalvm', new debug.GraalVMDebugAdapterDescriptorFactory()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('graalvm', new debug.GraalVMDebugAdapterTracker()));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('graalvm.home')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
			const graalVMHome = getGVMHome();
			nativeImage.initializeGraalVM(graalVMHome);
			if (!graalVMHome) {
				setupGraalVM();
			}
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		} else if (e.affectsConfiguration('graalvm.installations') || e.affectsConfiguration('graalvm.systemDetect')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
		} else if (e.affectsConfiguration('graalvm.languageServer.currentWorkDir') || e.affectsConfiguration('graalvm.languageServer.start')) {
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		}
	}));
	context.subscriptions.push(vscode.extensions.onDidChange(() => {
		const graalVMHome = getGVMHome();
		nativeImage.initializeGraalVM(graalVMHome);
		const netbeansExt = vscode.extensions.getExtension('asf.apache-netbeans-java');
		if (netbeansExt) {
			configureGraalVMHome(graalVMHome, true);
		}
	}));
	const graalVMHome = getGVMHome();
	if (!graalVMHome) {
		setupGraalVM();
	} else {
		selectActiveGraalVM(graalVMHome, true).then(() => startLanguageServer(graalVMHome));
	}
	nativeImage.initialize(context);

	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installVisualVMIntegration', async () => {
		const VISUALVM_EXTENSION_ID = 'oracle-labs-graalvm.visualvm-integration';
		if (vscode.extensions.getExtension(VISUALVM_EXTENSION_ID)) {
			await vscode.window.showInformationMessage('VisualVM Integration extension already installed.');
		} else {
			try {
				await vscode.commands.executeCommand('workbench.extensions.installExtension', VISUALVM_EXTENSION_ID);
			} catch (err) {
				await vscode.window.showErrorMessage(`Failed to install VisualVM Integration extension: ${err}`);
			}
		}
	}));

	vscode.window.setStatusBarMessage('GraalVM extension activated', 3000);
	
	// Public API
	return {
		onClientNotification: onClientNotification,
	};
}

export async function deactivate() {
	return await stopLanguageServer();
}
