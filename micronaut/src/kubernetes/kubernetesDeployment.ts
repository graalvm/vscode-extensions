/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { createWrapper, createContent, createNewFile } from "./kubernetesUtil";
import * as kubernetes from 'vscode-kubernetes-tools-api';
import { MultiStepInput } from "../utils";

const LOCAL = "<local>";
const NO_SECRET = "<public repository>";

export async function createDeployment(context: vscode.ExtensionContext) {
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available: ${kubectl.reason}.`);
        return;;
    }
    const title = 'Create Kubernetes Deployment File';

    let wrapper =  await createWrapper();

    let secretsPromise = getSecrets(kubectl.api);
    let namespacesPromise = getNamespaces(kubectl.api);

    let [projectInfo, secrets, namespaces]  = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title, cancellable: true},
        async progress => {
          progress.report({ message: 'Retrieving project info' });
          const projectInfo = await wrapper.getProjectInfo();
          progress.report({ message: 'Retrieving Namespaces' });
          const namespaces = await namespacesPromise;
          progress.report({ message: 'Retrieving Docker Secret Resources' });

          return [projectInfo, await secretsPromise, namespaces];  
        }
    );

    interface State {
		dockerRegistry: string;
		imageName: string;
        dockerSecret: string;
        namespace: string;
	}

    async function collectInputs(): Promise<State> {
		const state = {} as Partial<State>;
        await MultiStepInput.run(input => pickDockerRegistry(input, state));
		return state as State;
	}

    /**
     * Compute total steps based on state/selections made.
     * @param state current state
     * @returns total steps
     */
     function totalSteps(state: Partial<State>) : number {
        const regex = /([^\/]+\.[^\/.]+)\/[^\/.]+\/?[^\/.]+(:.+)?/m;
        let match = state.imageName?.match(regex);
        if (match && secrets) {
            return 4;
        }
        return 3;
    }

    async function pickDockerRegistry(input: MultiStepInput, state: Partial<State>) {
        const selected: any = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: totalSteps(state),
			placeholder: 'Pick Docker Repository',
			items: getDockerRegistries(),
			activeItems: {label: "local", value: LOCAL},
            validate: () => Promise.resolve(undefined),
			shouldResume: () => Promise.resolve(false)
        });
        state.dockerRegistry = normalizeRegistryUrl(selected.value);
		return (input: MultiStepInput) => inputImageName(input, state);
	}

    async function inputImageName(input: MultiStepInput, state: Partial<State>) {
        let defaultValue = "";
        if (projectInfo && state.dockerRegistry) {
            defaultValue = `${state.dockerRegistry}${projectInfo.name}:${projectInfo.version}`
        }
		state.imageName = await input.showInputBox({
			title,
			step: 2,
			totalSteps: totalSteps(state),
			value: state.imageName || defaultValue,
			prompt: 'Provide image name and version',
			validate: () => Promise.resolve(undefined),
			shouldResume: () => Promise.resolve(false)
		});
        
        return (input: MultiStepInput) => pickNamespace(input, state);
	}

    async function pickNamespace(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: totalSteps(state),
            placeholder: `Select Namespace ${state.namespace}`,
            items: namespaces,
			shouldResume: () => Promise.resolve(false)
        });
        state.namespace = selected.label;
        if (totalSteps(state) == 4) {
		    return (input: MultiStepInput) => pickDockerSecret(input, state);
        } else {
            return undefined;
        }
	}

    async function pickDockerSecret(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 4,
			totalSteps: totalSteps(state),
            placeholder: `Select Docker Registry Secret for ${state.imageName}`,
            items: secrets,
			shouldResume: () => Promise.resolve(false)
        });
        if (selected.label !== NO_SECRET) {
            state.dockerSecret = selected.label;
        }
	}

    const state = await collectInputs();
    if (state.dockerRegistry  && state.imageName) {
        let text = createContent(context.extensionPath, 'deploy.yaml', projectInfo.name, state.namespace, state.imageName, state.dockerSecret);
        createNewFile(projectInfo.root, "deploy", "yaml", text);
    }
}

async function getSecrets(kubectl: kubernetes.KubectlV1): Promise<{label: string}[]> {
    return new Promise<vscode.QuickPickItem[]> ((resolve) => {
        let command = `get secrets -o jsonpath='{range .items[*]}{@.metadata.name}{\"\\t\"}{@.type}{\"\\n\"}{end}'`;
        let secrets: vscode.QuickPickItem[] = [];
        console.log(command);
        kubectl.invokeCommand(command).then((result) => {
            result?.stdout.split("\n").forEach(line => {
                let str = line.split("\t");
                if (str[1] === 'kubernetes.io/dockerconfigjson') {
                    secrets.push({label: str[0]});
                }
            });
        });
        secrets.push({label: NO_SECRET});
        resolve(secrets);
    });
}
 
async function getNamespaces(kubectl: kubernetes.KubectlV1): Promise<vscode.QuickPickItem[]> {
    const command = "get namespace -o jsonpath='{.items[*].metadata.name}'";
    let namespaces: vscode.QuickPickItem[] = [];
    kubectl.invokeCommand(command)
        .then((result) => {
            if (result?.code === 0) {
                let parts = result.stdout.trim().split(' ');
                parts.forEach(ns => {
                    namespaces.push({label: ns});
                });
            }
        })
    return namespaces;
}

function normalizeRegistryUrl(repo: string): string {
    if (repo == LOCAL) {
        return "";
    } else if (repo && !repo.trim().endsWith('/')) {
        return `${repo.trim()}/`;
    } 
    return repo;
}

function getDockerRegistries(): {label: string, value: string}[]  {
    return [
        { label: 'local', value: LOCAL},
        { label: 'Docker', value: 'docker.io'},
        { label: 'OCIR Phoenix', value: 'phx.ocir.io'}
    ];
}



