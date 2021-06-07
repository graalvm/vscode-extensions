/*
 * Copyright (c) 2019, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as sax from "sax";
import { getGVMHome } from "./graalVMConfiguration";
import { getGraalVMVersion } from './graalVMInstall';

const URL_SEARCH: string = 'https://search.maven.org/solrsearch/select';
const GID: string = 'org.graalvm.nativeimage';
const AID: string = 'native-image-maven-plugin';
const YES: string = 'Yes';
const NO: string = 'No';

export async function addNativeImageToPOM() {
    let textEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (!textEditor || 'pom.xml' !== path.basename(textEditor.document.fileName)) {
        const poms: vscode.Uri[] = await vscode.workspace.findFiles('**/pom.xml', '**/node_modules/**');
        if (!poms || poms.length === 0) {
            vscode.window.showErrorMessage("No pom.xml file found in workspace.");
            return;
        } else if (poms.length === 1) {
            textEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(poms[0].fsPath));
        } else {
            const pickItems: vscode.QuickPickItem[] = poms.map((pomUri: vscode.Uri) => {
                return { label: pomUri.fsPath };
            });
            const selected: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(pickItems, { placeHolder: 'Multiple pom.xml found in workspace. Choose a pom.xml to modify.' });
            if (selected) {
                textEditor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.label));
            } else {
                return;
            }
        }
    }

    const doc: vscode.TextDocument = textEditor.document;
    if (checkForNativeImage(doc.getText())) {
        vscode.window.showErrorMessage("Native image plugin already present in the selected pom.xml.");
        return;
    }

    const graalVMHome = getGVMHome();
    const fullVersion: string | undefined = await getGraalVMVersion(graalVMHome);
    if (!fullVersion) {
        vscode.window.showErrorMessage("Cannot get the version information of the selected GraalVM.");
        return;
    }
    const version: string[] | null = fullVersion.match(/\d+\.\d+\.\d+(-dev)?/);
    if (!version || version.length === 0) {
        vscode.window.showErrorMessage("Cannot get the version information of the selected GraalVM.");
        return;
    }
    const rawArtefactInfo: Promise<string> = new Promise<string>((resolve, reject) => {
        let result: string = "";
        https.get(url.parse(`${URL_SEARCH}?q=g:"${GID}"+AND+a:"${AID}"+AND+v:"${version[0]}"&vt=json`), (res: http.IncomingMessage) => {
            res.on("data", chunk => {
                result = result.concat(chunk.toString());
            });
            res.on("end", () => {
                resolve(result);
            });
            res.on("error", err => {
                reject(err);
            });
        });
    });

    let artefactAvailable: boolean = false;
    try {
        const artefactInfo: any = JSON.parse(await rawArtefactInfo);
        artefactAvailable = artefactInfo.response.numFound > 0;
    } catch (error) {}

    let install: boolean = true;
    if (!artefactAvailable) {
        if (NO === await vscode.window.showInformationMessage(`Unable to verify the native-image artefact version ${version[0]}. Continue anyway?`, YES, NO)) {
            return;
        }
    }

    if (install) {
        const options: vscode.TextEditorOptions = textEditor.options;
        const indent: string = options.insertSpaces ? " ".repeat(<number>options.tabSize) : "\t";
        const eol: string = doc.eol === vscode.EndOfLine.LF ? "\n" : "\r\n";

        const stack: string[] = [];
        let insertOffset: number | undefined;
        let toInsert: string | undefined;

        const parser = sax.parser(true);
        parser.onopentag = tag => {
            stack.push(tag.name);
        };
        parser.onclosetag = tagName => {
            let top: string | undefined = stack.pop();
            while(top !== tagName) {
                top = stack.pop();
            }
            if (top) {
                switch (top) {
                    case 'plugins':
                        if (!insertOffset && stack.length > 1 && stack[stack.length - 1] === 'build' && stack[stack.length - 2] === 'project') {
                            toInsert = getPlugin(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                    case 'build':
                        if (!insertOffset && stack.length > 0 && stack[stack.length - 1] === 'project') {
                            toInsert = getPlugins(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                    case 'project':
                        if (!insertOffset) {
                            toInsert = getBuild(getIndent(doc, insertOffset = parser.startTagPosition - 1), indent, eol, version[0]);
                        }
                        break;
                }
            }
        };

        parser.write(doc.getText());

        if (toInsert && insertOffset) {
            const pos: vscode.Position = doc.positionAt(insertOffset);
            const range: vscode.Range = new vscode.Range(pos, pos);
            const textEdit: vscode.TextEdit = new vscode.TextEdit(range, toInsert);
            const workspaceEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(doc.uri, [textEdit]);
            await vscode.workspace.applyEdit(workspaceEdit);
            doc.save();
            const endPos: vscode.Position = doc.positionAt(insertOffset + toInsert.length);
            textEditor.revealRange(new vscode.Range(pos, endPos));
        }
    }
}

function checkForNativeImage(text: string): boolean {
    let hasNativeImage = false;
    const stack: string[] = [];
    const parser = sax.parser(true);
    parser.onopentag = tag => {
        stack.push(tag.name);
    };
    parser.onclosetag = tagName => {
        let top: string | undefined = stack.pop();
        while(top !== tagName) {
            top = stack.pop();
        }
    };
    parser.ontext = text => {
        if (text === AID && stack.length > 0 && stack[stack.length -1] === 'artifactId' && [stack[stack.length -2] === 'plugin']) {
            hasNativeImage = true;
        }
    };
    parser.write(text);
    return hasNativeImage;
}

function getIndent(doc: vscode.TextDocument, off: number): string {
    const pos: vscode.Position = doc.positionAt(off);
    return doc.getText(new vscode.Range(new vscode.Position(pos.line, 0), pos));
}

function getPlugin(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<plugin>`,
        `${indent}<groupId>${GID}</groupId>`,
        `${indent}<artifactId>${AID}</artifactId>`,
        `${indent}<version>${version}</version>`,
        `${indent}<executions>`,
        `${indent}${indent}<execution>`,
        `${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}</execution>`,
        `${indent}</executions>`,
        `${indent}<configuration>`,
        `${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}</configuration>`,
        `</plugin>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}

function getPlugins(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<plugins>`,
        `${indent}<plugin>`,
        `${indent}${indent}<groupId>${GID}</groupId>`,
        `${indent}${indent}<artifactId>${AID}</artifactId>`,
        `${indent}${indent}<version>${version}</version>`,
        `${indent}${indent}<executions>`,
        `${indent}${indent}${indent}<execution>`,
        `${indent}${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}${indent}</execution>`,
        `${indent}${indent}</executions>`,
        `${indent}${indent}<configuration>`,
        `${indent}${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}</configuration>`,
        `${indent}</plugin>`,
        `</plugins>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}

function getBuild(baseIndent: string, indent: string, eol: string, version: string): string {
    return [
        `${indent}<build>`,
        `${indent}<plugins>`,
        `${indent}${indent}<plugin>`,
        `${indent}${indent}${indent}<groupId>${GID}</groupId>`,
        `${indent}${indent}${indent}<artifactId>${AID}</artifactId>`,
        `${indent}${indent}${indent}<version>${version}</version>`,
        `${indent}${indent}${indent}<executions>`,
        `${indent}${indent}${indent}${indent}<execution>`,
        `${indent}${indent}${indent}${indent}${indent}<goals>`,
        `${indent}${indent}${indent}${indent}${indent}${indent}<goal>native-image</goal>`,
        `${indent}${indent}${indent}${indent}${indent}</goals>`,
        `${indent}${indent}${indent}${indent}${indent}<phase>package</phase>`,
        `${indent}${indent}${indent}${indent}</execution>`,
        `${indent}${indent}${indent}</executions>`,
        `${indent}${indent}${indent}<configuration>`,
        `${indent}${indent}${indent}${indent}<!--<mainClass>com.acme.Main</mainClass>-->`,
        `${indent}${indent}${indent}${indent}<!--<imageName>\${project.name}</imageName>-->`,
        `${indent}${indent}${indent}${indent}<!--<buildArgs></buildArgs>-->`,
        `${indent}${indent}${indent}</configuration>`,
        `${indent}${indent}</plugin>`,
        `${indent}</plugins>`,
        `</build>${eol}${baseIndent}`
    ].join(`${eol}${baseIndent}${indent}`);
}


export async function attachNativeImageAgent(): Promise<string> {
    const outputDir = await selectOutputDir();
    if (outputDir) {
        const agent = 'native-image-agent';
        const parameter = 'config-output-dir';
        return `-agentlib:${agent}=${parameter}=${outputDir}`;
    } else {
        return '';
    }
}

async function selectOutputDir(): Promise<string | undefined> {
    let choices: QuickPickTargetDir[] = [
        new QuickPickTargetDir(path.join('META-INF', 'native-image'), 'Store configuration to project', () => { return getProjectConfigDir(); }),
        new QuickPickTargetDir(process.platform === 'win32' ? 'Temp' : '/tmp', 'Store configuration to temporary directory', () => { return getTmpConfigDir(); }),
        new QuickPickTargetDir('Custom directory...', 'Store configuration to custom directory', () => {  return getCustomConfigDir(); })
    ];
    let ret: string | undefined = undefined;
    await vscode.window.showQuickPick(choices, {
        placeHolder: 'Select native-image configuration output directory'
    }).then(async e => { if (e) ret = await e.getTarget(); });
    if (ret) {
        vscode.window.showInformationMessage(`Configuration will be stored in ${ret}`);
    }
    return ret;
}

async function findResourcesRoot(): Promise<string | undefined> {
    const roots = vscode.workspace.workspaceFolders;
    if (roots && roots.length > 0) {
        const project = roots[0].uri.toString();
        const resources: string[] | undefined = await vscode.commands.executeCommand("java.get.project.source.roots", project, 'resources');
        if (resources && resources.length > 0) {
            return vscode.Uri.parse(resources[0]).fsPath;
        }
    }
    return undefined;
}

async function getProjectConfigDir(): Promise<string | undefined> {
    const resources = await findResourcesRoot();
    if (resources) {
        return path.join(resources, 'META-INF', 'native-image');
    }
    return undefined;
}

function getTmpConfigDir(): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const tmp = require('os').tmpdir();
        const realtmp = require('fs').realpathSync(tmp);
        resolve(path.join(realtmp, 'native-image'));
    });
}

async function getCustomConfigDir(): Promise<string | undefined> {
    const location: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select Native Image Configuration Output Directory',
        openLabel: 'Select'
    });
    if (location && location.length > 0) {
        return location[0].fsPath;
    }
    return undefined;
}

class QuickPickTargetDir implements vscode.QuickPickItem{
    constructor(
        public readonly label: string,
        public readonly detail: string,
        public readonly getTarget: () => Promise<string | undefined>
    ){}
}
