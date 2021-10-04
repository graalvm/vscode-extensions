/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import { createWrapper, findResourceFileByKind, askToExecCommand, createNewFile, createContent } from "./kubernetesUtil";

export async function createService(context: vscode.ExtensionContext) {
    const title = 'Create Kubernetes Service File';

    let wrapper =  await createWrapper();

    let projectInfo  = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, 
        title,
        cancellable: true},
        async progress => {
          progress.report({ message: 'Retrieving project info' });
          return await wrapper.getProjectInfo();
        }
    );
    const deployment = await findResourceFileByKind('Deployment');
    if (!deployment) {
        askToExecCommand(
            'extension.micronaut.createDeploy',
            'Deployment file is not present. Would you like to create it?');
        return;
    }

    let text = createContent(context.extensionPath, 'service.yaml', projectInfo.name);
    createNewFile(projectInfo.root, "service", "yaml", text);
    
}