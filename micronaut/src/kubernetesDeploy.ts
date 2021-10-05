/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';

import * as kubernetes from 'vscode-kubernetes-tools-api';
import { askToExecCommand, createWrapper, findResourceFileByKind } from "./kubernetesUtil";
import { kubernetesChannel } from './kubernetesChannel';

const MAX_WAIT_CYCLES = 60;
const WAIT_TIMEOUT = 500; //ms

export async function deployProject() {
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showInformationMessage("kubectl not found");
        return;
    }
    const deploymentFile = await findResourceFileByKind('Deployment');
    if (!deploymentFile) {
        askToExecCommand(
            'extension.micronaut.createDeploy',
            'Deployment file is not present. Would you like to create it?');
        return;
    }
    
    let wrapper =  await createWrapper();
    kubernetesChannel.clearAndShow();
    wrapper.buildAll()
        .then(() => deploy(deploymentFile))
        .catch((error) => kubernetesChannel.appendLine(error));
}

export async function deploy(deploymentFile: string) {
    
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (kubectl.available) {
        let command = `get -f ${deploymentFile} -o jsonpath='{.metadata.name}'`;
        let result = await kubectl.api.invokeCommand(command);
        let deploymentName: string | undefined;
        if (result?.code == 0) {
            deploymentName = result?.stdout.trim();
            command = `rollout restart deployment/${deploymentName}`;
        } else {
            command = `apply -f ${deploymentFile}`;
        }
        let oldRs = deploymentName ? await getLatestRs(kubectl.api, deploymentName) : undefined;
        kubernetesChannel.appendLine(`> kubectl ${command}`);
        result = await kubectl.api.invokeCommand(command);
        if (result) {
            if (result.code == 0) {
                kubernetesChannel.appendLine(result.stdout);
                if (deploymentName && oldRs) {
                    let repeat = MAX_WAIT_CYCLES;
                    while (oldRs == await getLatestRs(kubectl.api, deploymentName) && repeat-- > 0) {
                        await new Promise(resolve => setTimeout(resolve, WAIT_TIMEOUT));
                    }
                    if (repeat > -1) {
                        kubernetesChannel.appendLine(`APPLICATION DEPLOYED`);
                    }
                }
                return Promise.resolve();
            } else {
                return Promise.reject(result.stderr);
            }
        }
        return Promise.reject();
    }
}

async function getLatestRs(kubectl: kubernetes.KubectlV1, label: string) {
    const command = `get rs --selector=app=${label} --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}'`;
    let result = await kubectl.invokeCommand(command);
    if (result?.code === 0) {
        return result.stdout;
    }
    return undefined;
}
