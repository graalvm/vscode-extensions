/*
 * Copyright (c) 2020, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';
import { kubernetesChannel } from './kubernetesChannel';
import * as fs from 'fs';
import * as readline from 'readline'; 
import * as path from 'path';
import * as mustache from 'mustache';
import * as kubernetes from 'vscode-kubernetes-tools-api';

enum ProjectType {
    Maven = 'pom.xml',
    Gradle = 'build.gradle'
}

export interface RunInfo {
    appName: string,
    deploymentFile: string;
    kubectl: kubernetes.KubectlV1;
    port: number;
    debugPort?: number;
    podName?: string;
    debug?: boolean;
}

const YES: string = 'Yes';
const NO: string = 'No';
const templatesFolder: string = 'templates';

export interface ProjectInfo {
    name: string;   
    version: string;
    root: string;
}

export async function collectInfo(appName: string, debug?: boolean): Promise<RunInfo> {
    const deploymentFile = await findResourceFileByKind('Deployment');
    if (!deploymentFile) {
        askToExecCommand(
            'extension.micronaut.createServiceResource',
            'Deployment file is not present. Would you like to create it?');
        return Promise.reject();
    }
    const kubectl: kubernetes.API<kubernetes.KubectlV1> = await kubernetes.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available: ${kubectl.reason}.`);
        return Promise.reject();
    }
    const port = await getPort(deploymentFile);
    if (!port) {
        vscode.window.showErrorMessage(`containerPort was not found in  ${deploymentFile}.`);
        return Promise.reject()
    }
    let podName: string | undefined;
    if (appName) {
        podName = await getPod(kubectl.api, appName);
    } 
    return {
        appName,
        deploymentFile,
        kubectl: kubectl.api,
        port,
        debug,
        podName
    };
}

export interface WrapperHelper {
    getProjectInfo: () => Promise<ProjectInfo>;
    buildAll: () => Promise<void>;
}

export async function createWrapper(): Promise<WrapperHelper> {
    let wrapper: vscode.Uri[] = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/gradlew.bat' : '**/gradlew', '**/node_modules/**');
    if (wrapper && wrapper.length > 0) {
        const exec = wrapper[0].fsPath.replace(/(\s+)/g, '\\$1');
        return new GradleHelper(exec);
    }
    wrapper = await vscode.workspace.findFiles(process.platform === 'win32' ? '**/mvnw.bat' : '**/mvnw', '**/node_modules/**');
    if (wrapper && wrapper.length > 0) {
        const exec = wrapper[0].fsPath.replace(/(\s+)/g, '\\$1');
        return new MavenHelper(exec);
    }
    return Promise.reject();
}

async function findProjectDir(type: ProjectType): Promise<string> {
    let files: vscode.Uri[] = await vscode.workspace.findFiles(`**/${type}`);
    let projectDir = undefined;
    if(vscode.workspace.workspaceFolders !== undefined) {
        projectDir = vscode.workspace.workspaceFolders[0].uri.fsPath ; 
    }
    if (files && files.length > 0) {
        projectDir = files[0].fsPath.replace(/(.*\/).*/g, '$1');
    }
    if (projectDir) {
        return projectDir;
    }
    return Promise.reject();
}

class MavenHelper implements WrapperHelper {
    wrapper: string;
    projectRoot: Promise<string>;
    constructor(wrapper: string) {
        this.wrapper = wrapper;
        this.projectRoot = findProjectDir(ProjectType.Maven);
    }

    async getProjectInfo(): Promise<ProjectInfo> {
        const projectDir = await this.projectRoot;
        if (projectDir) {
            const artifactId = cp.execFileSync(this.wrapper, 
                ["org.apache.maven.plugins:maven-help-plugin:evaluate", "-Dexpression=project.artifactId", "-q", "-DforceStdout"], 
                {cwd: projectDir}).toString(); 
            const version = cp.execFileSync(this.wrapper, 
                ["org.apache.maven.plugins:maven-help-plugin:evaluate", "-Dexpression=project.version", "-q", "-DforceStdout"], 
                {cwd: projectDir}).toString(); 
            return {name: artifactId, version, root: projectDir};
        }
        return Promise.reject();
    }

    async buildAll() {
        return spawnWithOutput(this.wrapper, 
            ['-f', `${await this.projectRoot}/pom.xml`, 'compile', 'jib:dockerBuild'], 
            {cwd: await this.projectRoot}
        );
    }
}

class GradleHelper implements WrapperHelper {
    wrapper: string;
    projectRoot: Promise<string>;

    constructor(wrapper: string) {
        this.wrapper = wrapper;
        this.projectRoot = findProjectDir(ProjectType.Maven);
    }

    async getProjectRoot() {
        return this.projectRoot;
    }

    async getProjectInfo(): Promise<ProjectInfo> {
        const projectDir = await this.projectRoot;
        if (projectDir) {
            let name = "";
            let version = "";
            const properties = cp.execFileSync(this.wrapper, 
                ["properties", "-q"], 
                {cwd: projectDir}); 
            properties.toString().split("\n").forEach(line => {
                let parts = line.split(": ");
                switch (parts[0]) {
                    case 'name': name = parts[1]; break;
                    case 'version': version = parts[1]; break;
                }
            })
            return {name, version, root: projectDir};
        }   
        return Promise.reject();
    }

    async buildAll() {
        return spawnWithOutput(this.wrapper, 
            ['-b', `${await this.projectRoot}/build.gradle`, 'build', 'dockerBuild', 'dockerPush'], 
            {cwd: await this.projectRoot}
        );
       
    }
}

async function spawnWithOutput(command: string, args?: readonly string[] | undefined, options?: cp.SpawnOptionsWithoutStdio | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = cp.spawn(command, args, options);
        process.stdout.on('data', (data) => {
            kubernetesChannel.appendLine(data);
        });
        
        process.stderr.on('data', (data) => {
            kubernetesChannel.appendLine(data);
        });
        process.on('exit', (exitCode) => {
            if (exitCode === 0) {
                resolve();
            } else {
                reject();
            }
        });
    });
}

export function createContent(extensionPath: string, template: string, name: string, namespace?: string, image?: string, dockerSecret?: string) {
    let templatePath = path.join(extensionPath, templatesFolder, template);
    return mustache.render(fs.readFileSync(templatePath).toString(), {
        name, image, dockerSecret, namespace
    });
}

export function getUniqueFilename(parent: string, filename: string, extension: string): string {
    let file = path.join(parent, `${filename}.${extension}`);
    let i = 1;
    while (fs.existsSync(file)) {
        file = path.join(parent, `${filename}_${i++}.${extension}`);
    }
    return file;
}

export function createNewFile(root: string, filename: string, extension: string, text: string) {
    const filePath = vscode.Uri.file(getUniqueFilename(root, filename, extension));
    const wsedit = new vscode.WorkspaceEdit();
    wsedit.createFile(filePath);
    wsedit.insert(filePath, new vscode.Position(0, 0), text);
    vscode.workspace.applyEdit(wsedit).then(
        () => vscode.window.showTextDocument(filePath)
    ).then(() => vscode.workspace.openTextDocument(filePath))
    .then((doc) => doc.save());
}

export async function findResourceFileByKind(kind: string) {
    let files: vscode.Uri[] = await vscode.workspace.findFiles(`**/*.{yaml,yml}`, '**/node_modules/**');
    let resourceFiles: string [] = [];
    for (const file of files) {
        let rl = readline.createInterface({
            input: fs.createReadStream(file.fsPath),
        })
        for await (const line of rl) {
            if (line.includes('kind') && line.includes(kind)) {
                resourceFiles.push(file.fsPath);
                break;
            }
        }
    }   
    if (resourceFiles.length > 1) {
        return pickOneFile(resourceFiles);
    } else if (resourceFiles.length == 1) {
        return resourceFiles[0];
    }
    return undefined;
}

async function pickOneFile(files: string[]): Promise<string | undefined> {
    const items: (vscode.QuickPickItem & {value: string})[] = [];
    for (const file of files) {
        items.push({label: path.parse(file).base, value: file});
    }
    let selected = await vscode.window.showQuickPick(items, { placeHolder: `Select deployment file` })
    return selected?.value;
}

export async function askToExecCommand(command: string, message: string) {
    vscode.window.showInformationMessage(
        message, 
        ...[YES, NO]).then((answer) => {
        if (answer === YES) {
            vscode.commands.executeCommand(command);
        }
    });
}

async function getPort(deploymentFile: string): Promise<number | undefined> {
    let rl = readline.createInterface({
        input: fs.createReadStream(deploymentFile),
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
    return port;
}

export async function getPod(kubectl: kubernetes.KubectlV1, appName: string) {
    let command = `get pods --selector=app=${appName} -o jsonpath='{..items[*].metadata.name}'`
    let result = await  kubectl.invokeCommand(command);
    let pods: string[] = [];
    if (result && result.code == 0) {
        let parts = result.stdout.split(' ');
        parts.forEach(pod => {
            pods.push(pod);
        });
    }
    if (pods.length > 0) {
        return Promise.resolve(pods[0]);
    } 
    return Promise.reject();
}
