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
import { readDirSyncSafe } from './utils';

const SDKMAN_DIR: string = process.env.SDKMAN_DIR ?? "";
const SDKMAN_INIT: string = join(SDKMAN_DIR, "bin", "sdkman-init.sh");
const SDKMAN_CANDIDATES_JAVA: string = join(SDKMAN_DIR, "candidates", "java");
const SDKMAN_CURRENT_JAVA: string = join(SDKMAN_CANDIDATES_JAVA, "current");
const SDKMAN_SOURCE: string = `source ${SDKMAN_INIT} ; sdk `;

let SDKMAN_PRESENT: boolean | undefined = undefined;
export function isSDKmanPresent(): boolean {
    if (SDKMAN_PRESENT === undefined) {
        SDKMAN_PRESENT = fs.existsSync(SDKMAN_INIT) && execSDKmanSync("v").includes("SDKMAN");
    }
    return SDKMAN_PRESENT;
}

export function obtainSDKmanGVMInstallations(): [string, string][] {
    if (!isSDKmanPresent())
        return [];
    return _obtainSDKmanGVMInstallations();
}

function _obtainSDKmanGVMInstallations(): [string, string][] {
    return readDirSyncSafe(SDKMAN_CANDIDATES_JAVA)
        .map<[string, string]>(c => [join(SDKMAN_CANDIDATES_JAVA, c), c])
        .filter(c => !fs.lstatSync(c[0]).isSymbolicLink() && c[1].endsWith("grl"));
}

export function obtainSDKmanUnclassifiedInstallations(): [string, string][] {
    if (!isSDKmanPresent())
        return [];
    return _obtainSDKmanUnclassifiedInstallations();
}

function _obtainSDKmanUnclassifiedInstallations(): [string, string][] {
    return readDirSyncSafe(SDKMAN_CANDIDATES_JAVA)
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

export function currentSDKmanJavaInstallation(): string | undefined {
    if (!isSDKmanPresent())
        return undefined;
    return _currentSDKmanJavaInstallation();
}

function _currentSDKmanJavaInstallation(): string | undefined {
    return fs.existsSync(SDKMAN_CURRENT_JAVA) ? fs.readlinkSync(SDKMAN_CURRENT_JAVA) : undefined;
}

function execSDKmanSync(command: string): string {
    return cp.spawnSync(SDKMAN_SOURCE + command, { encoding: "utf8", shell: vscode.env.shell }).stdout;
}
