/*
 * Copyright (c) 2021, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as cp from "child_process";
import * as fs from "fs";
import { join } from "path";
import { getGraalVMVersion } from "./graalVMInstall";

const SDKMAN_DIR: string = process.env.SDKMAN_DIR ?? "";
const SDKMAN_INIT: string = join(SDKMAN_DIR, "bin", "sdkman-init.sh");
const SDKMAN_CANDIDATES_JAVA: string = join(SDKMAN_DIR, "candidates", "java");
const SDKMAN_CURRENT_JAVA: string = join(SDKMAN_CANDIDATES_JAVA, "current");
const SDKMAN_SOURCE: string = `source ${SDKMAN_INIT} ; sdk `;

let SDKMAN_PRESENT: boolean | undefined = undefined;
let SDKMAN_LOADED_JAVA_VERSION: string | undefined = undefined;
export function isSDKmanPresent(): boolean {
    if (SDKMAN_PRESENT === undefined) {
        SDKMAN_PRESENT = fs.existsSync(SDKMAN_INIT) && execSDKmanSync("v").includes("SDKMAN");
        if (SDKMAN_PRESENT) {
            if (!fs.existsSync(SDKMAN_CANDIDATES_JAVA)) {
                fs.mkdirSync(SDKMAN_CANDIDATES_JAVA);
            }
            SDKMAN_LOADED_JAVA_VERSION = _currentSDKmanJavaInstallation();
        }
    }
    return SDKMAN_PRESENT;
}

export function obtainSDKmanGVMInstallations(): [string, string][] {
    if (!isSDKmanPresent())
        return [];
    return _obtainSDKmanGVMInstallations();
}

function _obtainSDKmanGVMInstallations(): [string, string][] {
    return fs.readdirSync(SDKMAN_CANDIDATES_JAVA)
        .map<[string, string]>(c => [join(SDKMAN_CANDIDATES_JAVA, c), c])
        .filter(c => !fs.lstatSync(c[0]).isSymbolicLink() && c[1].endsWith("grl"));
}

export function obtainSDKmanUnclassifiedInstallations(): [string, string][] {
    if (!isSDKmanPresent())
        return [];
    return _obtainSDKmanUnclassifiedInstallations();
}

function _obtainSDKmanUnclassifiedInstallations(): [string, string][] {
    return fs.readdirSync(SDKMAN_CANDIDATES_JAVA)
        .map<[string, string]>(c => [join(SDKMAN_CANDIDATES_JAVA, c), c])
        .filter(c => fs.lstatSync(c[0]).isSymbolicLink() && c[0] !== SDKMAN_CURRENT_JAVA);
}

export function obtainSDKmanInstallations(): [string, string][] {
    if (!isSDKmanPresent())
        return [];
    return _obtainSDKmanInstallations();
}

function _obtainSDKmanInstallations(): [string, string][] {
    return _obtainSDKmanGVMInstallations().concat(_obtainSDKmanUnclassifiedInstallations());
}

export async function setupSDKmanGVMInstallation(graalVMhome: string): Promise<void> {
    if (!isSDKmanPresent())
        return;
    return _setupSDKmanGVMInstallation(graalVMhome);
}

async function _setupSDKmanGVMInstallation(graalVMhome: string): Promise<void> {
    const javaInsts: [string, string][] = _obtainSDKmanInstallations();
    for(const inst of javaInsts) {
        if (inst[0].startsWith(graalVMhome)) {
            setCurrent(inst[1]);
            return;
        }
    }
    const versionName = await createSDKmanGVMVersionName(graalVMhome);
    if (versionName) {
        installLocalJava(graalVMhome, versionName);
        setCurrent(versionName);
    }
}

export async function removeSDKmanUnclassifiedInstallation(graalVMhome: string): Promise<void> {
    if (!isSDKmanPresent())
        return;
    return _removeSDKmanUnclassifiedInstallation(graalVMhome);
}

async function _removeSDKmanUnclassifiedInstallation(graalVMhome: string): Promise<void> {
    const javaInsts: [string, string][] = _obtainSDKmanUnclassifiedInstallations();
    for(const inst of javaInsts) {
        if (fs.readlinkSync(inst[0]).startsWith(graalVMhome)) {
            const versionName = await createSDKmanGVMVersionName(graalVMhome);
            if (versionName && versionName === inst[1]) {
                if (_currentSDKmanJavaInstallation() === versionName) {
                    _resetSDKmanJavaVersion();
                }
                uninstallLocalJava(versionName);
                return;
            }
        }
    }
}

export function currentSDKmanJavaInstallation(): string | undefined {
    if (!isSDKmanPresent())
        return undefined;
    return _currentSDKmanJavaInstallation();
}

function _currentSDKmanJavaInstallation(): string | undefined {
    return fs.existsSync(SDKMAN_CURRENT_JAVA) ? fs.readlinkSync(SDKMAN_CURRENT_JAVA) : undefined;
}

export function resetSDKmanJavaVersion(): void {
    if (!isSDKmanPresent())
        return;
    _resetSDKmanJavaVersion();
}

function _resetSDKmanJavaVersion(): void {
    setCurrent(SDKMAN_LOADED_JAVA_VERSION);
}

function setCurrent(newCurrent?: string) {
    try {
        fs.unlinkSync(SDKMAN_CURRENT_JAVA);
    } catch (_) {}
    if(newCurrent)
        fs.symlinkSync(newCurrent, SDKMAN_CURRENT_JAVA, "dir");
}

function installLocalJava(localPath: string, version: string) {
    const candidate = join(SDKMAN_CANDIDATES_JAVA, version);
    try {
        fs.unlinkSync(candidate);
    } catch (_) {}
    fs.symlinkSync(localPath, candidate, "dir");
}

function uninstallLocalJava(version: string) {
    const candidate = join(SDKMAN_CANDIDATES_JAVA, version);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        fs.unlinkSync(candidate);
    }
}

function execSDKmanSync(command: string): string {
    return cp.spawnSync(SDKMAN_SOURCE + command, { encoding: "utf8", shell: vscode.env.shell}).stdout;
}

async function createSDKmanGVMVersionName(graalVMhome: string): Promise<string | undefined> {
    const version: string[] | undefined = (await getGraalVMVersion(graalVMhome))?.split(" ");
    if (version)
        return `${version[2].slice(0, version[2].length-1)}-${version[1]}-J${version[version.length-1]}`;
    return undefined;
}