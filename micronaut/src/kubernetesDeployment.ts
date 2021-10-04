/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { createWrapper, createContent, createNewFile } from "./kubernetesUtil";
import * as kubernetes from 'vscode-kubernetes-tools-api';
import { MultiStepInput } from "./utils";


const LOCAL = "<local>";

export async function createDeployment(context: vscode.ExtensionContext) {
    const title = 'Create Kubernetes Deployment File';

    let wrapper =  await createWrapper();

    let secretsPromise = getSecrets();

    let [projectInfo, secrets]  = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title, cancellable: true},
        async progress => {
          progress.report({ message: 'Retrieving project info' });
          const projectInfo = await wrapper.getProjectInfo();
          progress.report({ message: 'Retrieving Docker Secret Resources' });
          return [projectInfo, await secretsPromise];  
        }
    );

    interface State {
		dockerRegistry: string;
		imageName: string;
        dockerSecret: string;
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
            return 3;
        }
        return 2;
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
        
        if (totalSteps(state) == 3) {
		    return (input: MultiStepInput) => pickDockerSecret(input, state);
        } else {
            return undefined;
        }
	}

    async function pickDockerSecret(input: MultiStepInput, state: Partial<State>) {
		const selected: any = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: totalSteps(state),
            placeholder: `Select Docker Registry Secret for ${state.imageName}`,
            items: secrets,
			shouldResume: () => Promise.resolve(false)
        });
        state.dockerSecret = selected.label;
	}

    const state = await collectInputs();
    if (state.dockerRegistry  && state.imageName) {
        let text = createContent(context.extensionPath, 'deploy.yaml', projectInfo.name, state.imageName, state.dockerSecret);
        createNewFile(projectInfo.root, "deploy", "yaml", text);
    }
}

async function getSecrets(): Promise<{label: string}[]> {
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    return new Promise<vscode.QuickPickItem[]> ((resolve) => {
        if (kubectl.available) {
            let command = `get secrets -o jsonpath='{range .items[*]}{@.metadata.name}{\"\\t\"}{@.type}{\"\\n\"}{end}'`;
            let secrets: vscode.QuickPickItem[] = [];
            console.log(command);
            kubectl.api.invokeCommand(command).then((result) => {
                result?.stdout.split("\n").forEach(line => {
                    let str = line.split("\t");
                    if (str[1] === 'kubernetes.io/dockerconfigjson') {
                        secrets.push({label: str[0]});
                    }
                });
                resolve(secrets);
            });
        } 
    });
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



