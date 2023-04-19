/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { micronautProjectExists, getJavaHome } from "./utils";
import { WelcomePanel } from './welcome';
import { creatorInit, createProject } from './projectCreate';
import { builderInit, build } from './projectBuild';
import { createDeployment } from './kubernetes/kubernetesDeployment';
import { deployProject } from './kubernetes/kubernetesDeploy';
import { runProject, createService } from './kubernetes/kubernetesRun';
import * as kubernetes from 'vscode-kubernetes-tools-api';

export function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.getConfiguration().get<boolean>('micronaut.showWelcomePage')) {
		WelcomePanel.createOrShow(context);
	}
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.showWelcomePage', () => {
		WelcomePanel.createOrShow(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.createProject', () => {
		createProject(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.build', (goal?: string) => {
		build(goal, 'build');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.deploy', (goal?: string) => {
		build(goal, 'deploy');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.buildNativeImage', () => {
		vscode.commands.executeCommand('extension.micronaut.build', 'nativeImage');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.kubernetes.createDeploy', () => {
		createDeployment(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.kubernetes.deploy', () => {
		deployProject();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.kubernetes.createService', () => {
		createService(context);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.kubernetes.run', () => {
		runProject(false);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.kubernetes.debug', () => {
		runProject(true);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.odb.register', (dbNode) => {
		let userId: string = dbNode.connectionProperties.userID;
		let dataSource: string = dbNode.connectionProperties.dataSource;
		let tnsAdmin: string = dbNode.connectionProperties.tnsAdmin;
		let password: string = String.fromCharCode(...dbNode.connectionProperties.password);
		let url = `jdbc:oracle:thin:@${dataSource}?TNS_ADMIN=\"${tnsAdmin}\"`;
		let driver = "oracle.jdbc.OracleDriver";
		let schema = userId.toUpperCase();
		let displayName = dataSource;
		let info = {userId, password, url, driver, schema, displayName};
		vscode.commands.executeCommand('db.add.connection', info);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.micronaut.oci.register', (ociNode) => {
		let id: string = ociNode.adbInstanceNodeProperties.adbInstanceID;
		let name: string = ociNode.adbInstanceNodeProperties.adbInstanceDisplayName;
		let info = {id, name};
		vscode.commands.executeCommand('nbls:Tools:org.netbeans.modules.cloud.oracle.actions.DownloadWalletAction', info);
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('micronaut.home')) {
			creatorInit();
		}
	}));
	creatorInit();
	const graalVmExt = vscode.extensions.getExtension('oracle-labs-graalvm.graalvm');
	if (graalVmExt) {
		if (!graalVmExt.isActive) {
			graalVmExt.activate();
		}
		vscode.commands.executeCommand('setContext', 'graalVMExt.available', true);
	}
	micronautProjectExists().then(exists => {
		if (exists) {
			vscode.commands.executeCommand('setContext', 'micronautProjectExists', true);
			builderInit();
			const javaHome = getJavaHome();
			if (javaHome) {
				vscode.commands.executeCommand('setContext', 'javaHomeSet', true);
			}
			kubernetes.extension.kubectl.v1.then((kubectl => {
				if (kubectl.available) {
					vscode.commands.executeCommand('setContext', 'kubectl.available', true);
				}
			}));
		}
	});
}

export function deactivate() {}
