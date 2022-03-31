/*
 * Copyright (c) 2019, 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { toggleCodeCoverage, activeTextEditorChaged } from './graalVMCoverage';
import * as kubernetes from 'vscode-kubernetes-tools-api';
import * as debug from './graalVMDebug';
import { setupGraalVM, installGraalVM, addExistingGraalVM, installGraalVMComponent, uninstallGraalVMComponent, selectActiveGraalVM, findGraalVMs, InstallationNodeProvider, Component, Installation, removeGraalVMInstallation } from './graalVMInstall';
import { onClientNotification, startLanguageServer, stopLanguageServer } from './graalVMLanguageServer';
import { installRPackage, R_LANGUAGE_SERVER_PACKAGE_NAME } from './graalVMR';
import { installRubyGem, RUBY_LANGUAGE_SERVER_GEM_NAME } from './graalVMRuby';
import { addNativeImageToPOM, attachNativeImageAgent } from './graalVMNativeImage';
import { getGVMHome, setupProxy, configureGraalVMHome } from './graalVMConfiguration';
import * as visualvm from './graalVMVisualVM';
import * as gds from './gdsUtils';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.selectGraalVMHome', async (installation?: string | Installation, nonInteractive?: boolean) => {
		await selectActiveGraalVM(context, installation instanceof Installation ? installation.home : installation, nonInteractive);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVM', () => {
		installGraalVM(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.addExistingGraalVM', () => {
		addExistingGraalVM(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.findGraalVMs', async () => {
		const graalVMHome = getGVMHome();
		return (await findGraalVMs(context)).map(item => ({name: item.name, path: item.path, active: item.path === graalVMHome}));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.installGraalVMComponent', (component: string | Component | undefined, homeFolder?: string) => {
		installGraalVMComponent(context, component, homeFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.uninstallGraalVMComponent', (component: string | Component | undefined, homeFolder?: string) => {
		uninstallGraalVMComponent(context, component, homeFolder);
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
		removeGraalVMInstallation(context, path instanceof Installation ? path.home : path);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.gds.showConfiguration', () => {
		gds.showConfiguration();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.startVisualVM', () => {
		visualvm.startVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectOverviewVisualVM', () => {
		visualvm.preselectView(context, '1');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectOverviewVisualVM_', () => {}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectMonitorVisualVM', () => {
		visualvm.preselectView(context, '2');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectMonitorVisualVM_', () => {}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectThreadsVisualVM', () => {
		visualvm.preselectView(context, '3');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectThreadsVisualVM_', () => {}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectSamplerVisualVM', () => {
		visualvm.preselectView(context, '4');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.preselectSamplerVisualVM_', () => {}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleWindowToFrontVisualVM', () => {
		visualvm.toggleWindowToFront(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleWindowToFrontVisualVM_', () => {
		visualvm.toggleWindowToFront(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleSourcesIntegrationVisualVM', () => {
		visualvm.toggleSourcesIntegration(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.toggleSourcesIntegrationVisualVM_', () => {
		visualvm.toggleSourcesIntegration(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.defineDisplayName', (): string => {
		return visualvm.defineDisplayName();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.attachVisualVM', (): string => {
		return visualvm.attachVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.selectProcessVisualVM', () => {
		visualvm.selectProcessVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.runVisualVMForPID', () => {
		visualvm.selectProcessVisualVM(true).then(selected => {
			if (selected) visualvm.startVisualVM(); 
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.threadDumpVisualVM', () => {
		visualvm.threadDumpVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.heapDumpVisualVM', () => {
		visualvm.heapDumpVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.startCPUSamplerVisualVM', () => {
		visualvm.startCPUSamplerVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.startMemorySamplerVisualVM', () => {
		visualvm.startMemorySamplerVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.snapshotSamplerVisualVM', () => {
		visualvm.snapshotSamplerVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.stopSamplerVisualVM', () => {
		visualvm.stopSamplerVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.startJFRRecordingVisualVM', () => {
		visualvm.startJFRRecordingVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.dumpJFRRecordingVisualVM', () => {
		visualvm.dumpJFRRecordingVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.stopJFRRecordingVisualVM', () => {
		visualvm.stopJFRRecordingVisualVM();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.configureSettingVisualVM', (...params: any[]) => {
		visualvm.configureSettingVisualVM(context, params);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.troubleshootNBLSThreadDump', () => {
		visualvm.troubleshootNBLSThreadDump();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.troubleshootNBLSHeapDump', () => {
		visualvm.troubleshootNBLSHeapDump();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.troubleshootNBLSCpuSampler', () => {
		visualvm.troubleshootNBLSCpuSampler();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.debugKubernetes', debug.attachToKubernetes));
	context.subscriptions.push(vscode.commands.registerCommand('extension.graalvm.heapReplay', debug.heapReplay));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('visualvm-control-panel', visualvm.nodeProvider));
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'extension.graalvm.debugPod', 
			(kubectl: kubernetes.KubectlV1, podName: string, namespace?: string) => {
				debug.attachToPod(kubectl, podName, namespace);
			})
	);

	const nodeProvider = new InstallationNodeProvider(context);
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
			visualvm.initializeGraalVM(context, graalVMHome);
			if (!graalVMHome) {
				setupGraalVM(context);
			}
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		} else if (e.affectsConfiguration('graalvm.installations') || e.affectsConfiguration('graalvm.systemDetect')) {
			vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
		} else if (e.affectsConfiguration('graalvm.languageServer.currentWorkDir') || e.affectsConfiguration('graalvm.languageServer.start')) {
			stopLanguageServer().then(() => startLanguageServer(getGVMHome()));
		}
	}));
	context.subscriptions.push(vscode.extensions.onDidChange(() => {
		const netbeansExt = vscode.extensions.getExtension('asf.apache-netbeans-java');
		if (netbeansExt) {
			configureGraalVMHome(context, getGVMHome(), true);
		}
	}));
	const graalVMHome = getGVMHome();
	if (!graalVMHome) {
		setupGraalVM(context);
	} else {
		selectActiveGraalVM(context, graalVMHome, true).then(() => startLanguageServer(graalVMHome));
	}
	visualvm.initialize(context);
	vscode.window.setStatusBarMessage('GraalVM extension activated', 3000);
	
	// Public API
	return {
		onClientNotification: onClientNotification,
	};
}

export async function deactivate() {
	return await stopLanguageServer();
}
