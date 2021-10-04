/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as kubernetes from 'vscode-kubernetes-tools-api';
import { askToExecCommand, createWrapper, findResourceFileByKind } from "./kubernetesUtil";
import { deploy } from "./kubernetesDeploy";
import { kubernetesChannel } from './kubernetesChannel';
import * as readline from 'readline'; 
import * as fs from 'fs';

let forwardSession: vscode.Disposable | undefined;

export async function runProject() {
    const deploymentFile = await findResourceFileByKind('Deployment');
    if (!deploymentFile) {
        askToExecCommand(
            'extension.micronaut.createServiceResource',
            'Deployment file is not present. Would you like to create it?');
            return;
    }
    let wrapper =  await createWrapper();
    kubernetesChannel.clearAndShow();
    let proj = await wrapper.getProjectInfo();

    if (forwardSession) {
        forwardSession.dispose();
    }

    wrapper.buildAll()
    .then(() => deploy())
    .then(() => run(proj.name, deploymentFile))
    .catch((error) => kubernetesChannel.appendLine(error));
    
    }
        
    async function run(name: string, resourceFile: string) {
        const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
            if (!kubectl.available) {
                vscode.window.showErrorMessage(`kubectl not available: ${kubectl.reason}.`);
                return;
            }
        let rl = readline.createInterface({
            input: fs.createReadStream(resourceFile),
        })
        let ports = [];
        for await (const line of rl) {
            let matches = line.match(/\s*containerPort:\s+(\d+)/);
            if (matches) {
                ports.push(matches[1]);
            }
        }
        let port: number | undefined;
        if (ports.length > 1) {
            port = Number(await vscode.window.showQuickPick(ports));
        } else if (ports.length == 1) {
            port = Number(ports[0]);
        }
        if (port === undefined) {
            vscode.window.showInformationMessage(`port ${port}`);
            return;
        }
        let command = `wait --for=condition=available deployment ${name}`;
        await kubectl.api.invokeCommand(command);

        command = `get pods --selector=app=${name} -o jsonpath='{..items[*].metadata.name}'`
        let result = await  kubectl.api.invokeCommand(command);
        let pods: string[] = [];
        if (result && result.code == 0) {
            let parts = result.stdout.split(' ');
            parts.forEach(pod => {
                pods.push(pod);
            });
        }
        if (port && pods.length > 0) {
            command = `wait --for=condition=ready pod ${pods[0]}`;
            await kubectl.api.invokeCommand(command);
            setTimeout(() => {}, 2000);
            forwardSession = await kubectl.api.portForward(
                pods[0], 
                undefined, 
                port, 
                port, 
                { showInUI: { location: 'status-bar' } 
            });
            if (!forwardSession) {
                await vscode.window.showErrorMessage(`Can't access ${pods[0]} on cluster`);
                return;
            }
            kubernetesChannel.appendLine(`You can access ${pods[0]} on http://localhost:${port}`);
        }
            
    }
