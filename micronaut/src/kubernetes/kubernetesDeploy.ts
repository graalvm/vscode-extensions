/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';

import * as kubernetes from 'vscode-kubernetes-tools-api';
import { collectInfo, createWrapper, RunInfo } from "./kubernetesUtil";
import { kubernetesChannel } from './kubernetesChannel';

const MAX_WAIT_CYCLES = 60;
const WAIT_TIMEOUT = 500; //ms

export async function deployProject() {
    let wrapper =  await createWrapper();
    let info = await collectInfo((await wrapper.getProjectInfo()).name);
    kubernetesChannel.clearAndShow();
    wrapper.buildAll()
        .then(() => deploy(info))
        .catch((error) => kubernetesChannel.appendLine(error));
}

async function setEnvDebug(info: RunInfo) {
    let command = `set env deployment/${info.appName} JAVA_TOOL_OPTIONS=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005`;
	return info.kubectl.invokeCommand(command);
}

export async function deploy(info: RunInfo) {
    let command = `get -f ${info.deploymentFile} -o jsonpath='{.metadata.name}'`;
    let result = await info.kubectl.invokeCommand(command);
    let deploymentName: string | undefined;
    if (result?.code !== 0) {
        command = `apply -f ${info.deploymentFile}`;
        result = await info.kubectl.invokeCommand(command);
        if (result?.code !== 0) {
            vscode.window.showErrorMessage(`Deploy of ${info.appName} failed.`);
            return;
        }
        deploymentName = result?.stdout.trim();
    } 
    setEnvDebug(info);
    command = `rollout restart deployment/${info.appName}`;
    let oldRs = deploymentName ? await getLatestRs(info.kubectl, deploymentName) : undefined;
    kubernetesChannel.appendLine(`> kubectl ${command}`);
    result = await info.kubectl.invokeCommand(command);
    if (result) {
        if (result.code == 0) {
            kubernetesChannel.appendLine(result.stdout);
            if (deploymentName && oldRs) {
                let repeat = MAX_WAIT_CYCLES;
                while (oldRs == await getLatestRs(info.kubectl, deploymentName) && repeat-- > 0) {
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

async function getLatestRs(kubectl: kubernetes.KubectlV1, label: string) {
    const command = `get rs --selector=app=${label} --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}'`;
    let result = await kubectl.invokeCommand(command);
    if (result?.code === 0) {
        return result.stdout;
    }
    return undefined;
}
