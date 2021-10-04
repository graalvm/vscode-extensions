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

export async function deployProject() {
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showInformationMessage("kubectl not found");
        return;
    }
    
    let wrapper =  await createWrapper();
    kubernetesChannel.clearAndShow();
    wrapper.buildAll()
        .then(() => deploy())
        .catch((error) => kubernetesChannel.appendLine(error));
}

export async function deploy() {
    const deploymentFile = await findResourceFileByKind('Deployment');
    if (!deploymentFile) {
        askToExecCommand(
            'extension.micronaut.createDeploy',
            'Deployment file is not present. Would you like to create it?');
        return Promise.reject();
    }
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
        kubernetesChannel.appendLine(`> kubectl ${command}`);
        result = await kubectl.api.invokeCommand(command);
        if (result) {
            if (result.code == 0) {
                kubernetesChannel.appendLine(result.stdout);
                return Promise.resolve();
            } else {
                return Promise.reject(result.stderr);
            }
        }
        return Promise.reject();
    }

}
