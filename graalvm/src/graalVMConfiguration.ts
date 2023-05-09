/*
 * Copyright (c) 2023, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as utils from './utils';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { checkForMissingComponents, getInstallConfigurations } from './graalVMInstall';
import { getPythonConfigurations } from './graalVMPython';
import { getRConfigurations } from './graalVMR';
import { getRubyConfigurations } from './graalVMRuby';
import { extContext } from './extension';

let configurations: ConfigurationPickItem[];
const SAVE_SETTINGS: string = "graalvm.settings.savepoint";

export function getConf(key: string): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(key);
}

export async function setConf(config: vscode.WorkspaceConfiguration, key: string, value: any): Promise<void> {
    return config.update(key, value, await getConfigTarget(config, key));
}

async function getConfigTarget(config: vscode.WorkspaceConfiguration, key: string): Promise<vscode.ConfigurationTarget | boolean | undefined> {
    const info: {
        key: string;
        defaultValue?: unknown;
        globalValue?: unknown;
        workspaceValue?: unknown;
        workspaceFolderValue?: unknown;
        defaultLanguageValue?: unknown;
        globalLanguageValue?: unknown;
        workspaceLanguageValue?: unknown;
        workspaceFolderLanguageValue?: unknown;
        languageIds?: string[] | undefined;
    } | undefined = config.inspect(key);
    if(info?.workspaceFolderValue !== undefined)
        return vscode.ConfigurationTarget.WorkspaceFolder;
    if(info?.workspaceValue !== undefined)
        return vscode.ConfigurationTarget.Workspace;
    if(info?.globalValue !== undefined)
        return vscode.ConfigurationTarget.Global;
    let store: vscode.ConfigurationTarget | undefined = extContext.globalState.get(SAVE_SETTINGS);
    if(store === undefined) {
        store = await utils.askYesNo("Do you want to store GraalVM settings globally?", () => vscode.ConfigurationTarget.Global, () => vscode.ConfigurationTarget.Workspace);
        extContext.globalState.update(SAVE_SETTINGS, store);
    }
    return store;
}

export function getGVMConfig(gvmConfig?: vscode.WorkspaceConfiguration): vscode.WorkspaceConfiguration {
	if (!gvmConfig) {
		gvmConfig = getConf('graalvm');
	}
	return gvmConfig;
}

export function getGVMHome(gvmConfig?: vscode.WorkspaceConfiguration): string {
	return getGVMConfig(gvmConfig).get('home') as string;
}

export function setGVMHome(graalVMHome: string | undefined, gvmConfig?: vscode.WorkspaceConfiguration): Thenable<void> {
	return setConf(getGVMConfig(gvmConfig), 'home', graalVMHome);
}

const CONFIG_INSTALLATIONS = 'installations';
export function getGVMInsts(gvmConfig?: vscode.WorkspaceConfiguration): string[] {
	return getGVMConfig(gvmConfig).get(CONFIG_INSTALLATIONS) as string[] || [];
}

const CONFIG_RUNTIMES = 'configuration.runtimes';
export async function setJavaRuntime(version: string, path: string, setAsDefault?: boolean): Promise<void> {
    const javaConf = getConf('java');
    const runtimes = javaConf.get(CONFIG_RUNTIMES) as object[] || [];
    const idx = version.lastIndexOf(', Java ');
    if (idx >= 0) {
        let javaVersion = version.slice(idx + 7).trim();
        if (+javaVersion <= 8) {
            javaVersion = '1.' + javaVersion;
        }
        const javaVersionName = `JavaSE-${javaVersion}`;
        let runtime: any = runtimes.find((runtime: any) => runtime.name === javaVersionName);
        if (runtime) {
            if (runtime.path !== path) {
                const update = () => {
                    runtime.path = path;
                    delete runtime.sources;
                    if (setAsDefault) {
                        runtime.default = true;
                    } else {
                        delete runtime.default;
                    }
                };
                if (setAsDefault) {
                    update();
                } else {
                    await utils.askYesNo(`Set ${version} as runtime for ${javaVersionName}?`, update);
                }
            }
        } else {
            runtime = { name: javaVersionName, path };
            if (setAsDefault) {
                runtime.default = true;
            }
            runtimes.push(runtime);
        }
    }
    return setConf(javaConf, CONFIG_RUNTIMES, runtimes);
}

export function removeJavaRuntime(path: string): Thenable<void> {
    const javaConf = getConf('java');
    const runtimes = javaConf.get(CONFIG_RUNTIMES) as object[] || [];
    const idx = runtimes.findIndex((runtime: any) => runtime.path === path);
    if (idx > -1) {
        runtimes.splice(idx, 1);
    }
    return setConf(javaConf, CONFIG_RUNTIMES, runtimes);
}

export function setGVMInsts(gvmConfig: vscode.WorkspaceConfiguration, installations: string[]): Thenable<void> {
	return setConf(gvmConfig, CONFIG_INSTALLATIONS, installations);
}

const TERMINAL_INTEGRATED: string = 'terminal.integrated';

export function getTerminalEnvName(): string {
    return `${TERMINAL_INTEGRATED}.env.${utils.platform()}`;
}

export function getTerminalEnv(): any {
    return getConf(TERMINAL_INTEGRATED).get(`env.${utils.platform()}`) as any | {};
}

export async function setTerminalEnv(env: any): Promise<any> {
    return setConf(getConf(TERMINAL_INTEGRATED),`env.${utils.platform()}`, env).then(() => {
        let collection = extContext.environmentVariableCollection;
        if (env.GRAALVM_HOME) {
            const separator = process.platform === 'win32' ? ';' : ':';
            collection.prepend('PATH', env.GRAALVM_HOME + path.sep + 'bin' + separator);
            collection.replace('JAVA_HOME', env.GRAALVM_HOME);
        } else {
            collection.prepend('PATH', '');
            collection.delete('JAVA_HOME');
        }
    });
}

export async function setupProxy() {
    const http = getConf('http');
    const proxy = http.get<string>('proxy');
    const isMvn: boolean = await isMaven();
    const mavenProxy: string | undefined = isMvn ? await readMavenProxy() : undefined;
    const usedProxy = proxy || mavenProxy;
    vscode.window.showInputBox(
        {
            prompt: 'Input proxy settings.',
            placeHolder: '<http(s)>://<host>:<port>',
            value: usedProxy
        }
    ).then(async out => {
        if (out === undefined) {
            return;
        }
        try {
            if (out) {
                validateProxySettings(out);
            }
            if (proxy !== out || mavenProxy !== out) {
                await setConf(http, 'proxy', out);
                await vscode.commands.executeCommand('extension.graalvm.refreshInstallations');
                if (isMvn && mavenProxy !== out) {
                    utils.askYesNo(`Change also Maven proxy in "${getMavenSettingsFilePath()}"?`,
                        () => updateMavenProxy(out));
                }
            }
        } catch (ex: unknown) {
            const e = ex as Error;
            vscode.window.showWarningMessage(e?.message);
        };
    });
}

export async function checkGraalVMconfiguration(graalVMHome: string) {
    gatherConfigurations();
    for (const conf of configurations) {
        if (!conf.show(graalVMHome) && conf.setted(graalVMHome)) {
            try {
                await conf.unset(graalVMHome);
            } catch (_err) {}
        }
    }
}

export async function configureGraalVMHome(graalVMHome: string, nonInteractive?: boolean) {
    const gr = getGVMConfig();
    const oldGVM = getGVMHome(gr);
    if (graalVMHome !== oldGVM) {
        await removeConfigurations(oldGVM);
    }
    await defaultConfig(graalVMHome, gr);
    if (!nonInteractive) {
        await configureInteractive(graalVMHome);
    }
}

export async function removeGraalVMconfiguration(graalVMHome: string) {
    await removeDefaultConfigurations(graalVMHome);
    await removeConfigurations(graalVMHome);
    removeJavaRuntime(graalVMHome);
}

function validateProxySettings(proxy: string) {
    const parts = splitProxy(proxy);
    if (parts[0].length === 0) {
        throw new Error("Proxy protocol must be specified.");
    }
    if (parts[0] !== "http" && parts[0] !== "https") {
        throw new Error("Http/s protocol must be used for proxy settings.");
    }
    if (parts[1].length === 0) {
        throw new Error("Proxy host must be specified.");
    }
    if (parts[2].length === 0) {
        throw new Error("Proxy port must be specified.");
    }
    if (!Number.isSafeInteger(parseInt(parts[2]))) {
        throw new Error("Proxy port must be number.");
    }
}

type MavenProxy = { id?:string; active: boolean; protocol: string; host: string; port: number };
type MavenSettings = { settings?: { proxies?: { proxy?: MavenProxy | MavenProxy[] }; [key: string]: any }};
function parseMavenProxies(mavenSettings: MavenSettings | undefined): MavenProxy[] {
    const proxies: MavenProxy | MavenProxy[] | undefined = mavenSettings?.settings?.proxies?.proxy;
    if (!proxies) {
        return [];
    }
    if (Array.isArray(proxies)) {
        return proxies;
    }
    return [proxies];
}

async function getMavenProxies(file: string | undefined = getMavenSettingsFilePath()): Promise<MavenProxy[]> {
    if (!file || !fs.existsSync(file)) {
        return [];
    }
    const mavenSettings: MavenSettings = await utils.parseXMLFile(file);
    return parseMavenProxies(mavenSettings);
}

async function readMavenProxy(): Promise<string | undefined> {
    const proxies: MavenProxy[] = await getMavenProxies();
    const proxy = proxies.find(p => p.active);
    if (!proxy) {
        return undefined;
    }
    return `${proxy.protocol}://${proxy.host}:${proxy.port}`;
}
export function isMaven(): Promise<boolean> {
    return new Promise((resolve, _reject) => {
        cp.exec('mvn --version',(_error, stdout, _stderr) => {
            resolve(stdout.includes('Apache Maven'));
        });
    });
}
function getMavenSettingsFilePath(): string | undefined {
    const home = utils.getUserHome();
    if (!home) {
        vscode.window.showErrorMessage("Users HOME is undefined in process!");
        return undefined;
    }
    const file = path.join(home, '.m2', 'settings.xml');
    return file;
}

const ID_GRAALVM_VSCODE: string = 'graalvm-vscode';
async function updateMavenProxy(proxy: string | undefined) {
    const file = getMavenSettingsFilePath();
    if (!file) {
        return;
    }
    if (!fs.existsSync(file) && proxy) {
        utils.writeXMLFile(file, wrappedMavenProxy(proxy));
        return;
    }
    const mavenSettings: MavenSettings = await utils.parseXMLFile(file) || { settings: {}};
    if(!mavenSettings.settings || typeof mavenSettings.settings === "string") {
        mavenSettings.settings = {};
    }
    const mavenProxies = parseMavenProxies(mavenSettings);
    if (mavenProxies.length === 0 && proxy) {
        mavenSettings.settings.proxies = { proxy: createMavenProxy(proxy) };
        utils.writeXMLFile(file, mavenSettings);
        return;
    }
    const aProxy = mavenProxies.find(p => p.active);
    if (aProxy) {
        aProxy.active = false;
    }
    if (!proxy) {
        utils.writeXMLFile(file, mavenSettings);
        return;
    }
    const foundProxy = mavenProxies.find(findMavenProxy(proxy));
    if (foundProxy) {
        foundProxy.active = true;
    } else {
        const gvmProxyIndex = mavenProxies.findIndex(p => p.id === ID_GRAALVM_VSCODE);
        if (gvmProxyIndex < 0) {
            mavenProxies.push(createMavenProxy(proxy));
        } else {
            mavenProxies[gvmProxyIndex] = createMavenProxy(proxy);
        }
    }
    mavenSettings.settings.proxies = { proxy: mavenProxies };
    utils.writeXMLFile(file, mavenSettings);
    return;
}

function findMavenProxy(proxy: string): (mavenProxy: MavenProxy) => boolean {
    const parts = splitProxy(proxy);
    return function (mavenProxy: MavenProxy): boolean {
        return mavenProxy.protocol === parts[0]
            && mavenProxy.host === parts[1]
            && mavenProxy.port === parseInt(parts[2]);
    };
}

function splitProxy(proxy: string): [string, string, string] {
    const protocolIndex = proxy.indexOf('://');
    const portIndex = proxy.lastIndexOf(':');
    if (protocolIndex < 0 || portIndex < 0) {
        throw new Error("Proxy is invalid.");
    }
    return [proxy.substring(0, protocolIndex),
        proxy.substring(protocolIndex + 3, portIndex),
        proxy.substring(portIndex + 1)];
}

function createMavenProxy(proxy: string): MavenProxy {
    const parts = splitProxy(proxy);
    return {
        id: ID_GRAALVM_VSCODE,
        active: true,
        protocol: parts[0],
        host: parts[1],
        port: parseInt(parts[2])
    };
}

function wrappedMavenProxy(proxy: string): MavenSettings {
    return {
        settings: {
            proxies: {
                proxy: createMavenProxy(proxy)
            }
        }
    };
}

async function removeDefaultConfigurations(graalVMHome: string) {
    const gr = getGVMConfig();
    const installations = getGVMInsts(gr);
    const index = installations.indexOf(graalVMHome);
    if (index > -1) {
        installations.splice(index, 1);
        await setGVMInsts(gr, installations);
    }
    const home = getGVMHome(gr);
    if (home === graalVMHome) {
        await setGVMHome(undefined, gr);
    }
    const env = getTerminalEnv();
    if (env) {
        if (env.GRAALVM_HOME === graalVMHome) {
            env.GRAALVM_HOME = undefined;
        }
        await setTerminalEnv(env);
    }
    try {
        const nbConf = getConf('netbeans');
        const nbHome = nbConf.get('jdkhome') as string;
        if (nbHome === graalVMHome) {
            await setConf(nbConf, 'jdkhome', undefined);
        }
    } catch(_err) {}
}

async function removeConfigurations(graalVMHome: string) {
    gatherConfigurations();
    for (const conf of configurations) {
        if (conf.setted(graalVMHome)) {
            try {
                await conf.unset(graalVMHome);
            } catch (_err) {}
        }
    }
}

async function configureInteractive(graalVMHome: string) {
    checkForMissingComponents(graalVMHome);
    gatherConfigurations();
    const toShow: ConfigurationPickItem[] = configurations.filter(conf => {
        const show = conf.show(graalVMHome);
        if (show) {
            conf.picked = conf.setted(graalVMHome);
        }
        return show;
    });
    if (toShow.length > 0) {
        const selected: ConfigurationPickItem[] | undefined = await vscode.window.showQuickPick(
            toShow, {
                canPickMany: true,
                placeHolder: 'Configure active GraalVM'
            });
        if (selected) {
            for (const shown of toShow) {
                try {
                    if (selected.includes(shown)) {
                        await shown.set(graalVMHome);
                    } else {
                        await shown.unset(graalVMHome);
                    }
                } catch (ex: unknown) {
                    const error = ex as Error;
                    vscode.window.showErrorMessage(error?.message);
                }
            }
        }
    }
}

function gatherConfigurations() {
    if (configurations) {
        return;
    }
    configurations = getInstallConfigurations().concat(
        getPythonConfigurations(), 
        getRubyConfigurations(),
        getRConfigurations());
}

async function defaultConfig(graalVMHome: string, gr: vscode.WorkspaceConfiguration) {
    await setGVMHome(graalVMHome, gr);
    const insts = getGVMInsts(gr);
    if (!insts.includes(graalVMHome)) {
        insts.push(graalVMHome);
        await setGVMInsts(gr, insts);
    }

    try {
        await setConf(getConf('netbeans'), 'jdkhome', graalVMHome);
    } catch (error) {}

    let env: any = getTerminalEnv();
    env.GRAALVM_HOME = graalVMHome;
    await setTerminalEnv(env);
}

export class ConfigurationPickItem implements vscode.QuickPickItem {
    public picked?: boolean;
    public detail?: string;
	constructor (
        public readonly label: string,
        public readonly description: string,
        public readonly show: (graalVMHome: string) => boolean,
        public readonly setted: (graalVMHome: string) => boolean,
        public readonly set: ((graalVMHome: string) => Promise<any>),
        public readonly unset: ((graalVMHome: string) => Promise<any>)
	) {}
}