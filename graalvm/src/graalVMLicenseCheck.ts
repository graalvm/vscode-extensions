/*
 * Copyright (c) 2023, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as mustache from 'mustache';
import { extContext } from './extension';

export class LicenseCheckPanel {

	public static readonly viewType: string = 'graalVMLicenseCheck';

	private static readonly webviewsFolder: string = 'webviews';
	private static readonly userAcceptedLicenses: string = 'userAcceptedLicenses';

	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

	public static show(licenseLabel: string, license: string): Promise<string | undefined> {
		const userAcceptedLicenses = JSON.parse(extContext.globalState.get(LicenseCheckPanel.userAcceptedLicenses) || '{}');
		return new Promise<string | undefined>(resolve => {
			new LicenseCheckPanel(extContext.extensionPath, licenseLabel, license, userAcceptedLicenses.userEmail, (message: any) => {
				if (message?.command === 'accepted') {
					if (message.email) {
						userAcceptedLicenses.userEmail = message.email;
						extContext.globalState.update(LicenseCheckPanel.userAcceptedLicenses, JSON.stringify(userAcceptedLicenses));
					}
					resolve(userAcceptedLicenses.userEmail);
				} else {
					resolve(undefined);
				}
			});
		});
	}

	private constructor(extensionPath: string, licenseLabel: string, license: string, userEmail: string, messageHandler: (message: any) => any) {
		this._panel = vscode.window.createWebviewPanel(LicenseCheckPanel.viewType, licenseLabel,
			{ viewColumn: vscode.ViewColumn.One, preserveFocus: true },
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.file(path.join(extensionPath, LicenseCheckPanel.webviewsFolder))]
			}
		);
		this._panel.iconPath = {
			light: vscode.Uri.file(path.join(extensionPath, LicenseCheckPanel.webviewsFolder, 'icons', 'law_light.png')),
			dark: vscode.Uri.file(path.join(extensionPath, LicenseCheckPanel.webviewsFolder, 'icons', 'law_dark.png'))
		};

		// Set the webview's html content
		this.setHtml(extensionPath, license, userEmail || '');

		let result: any;

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(
			() => {
				this.dispose();
				messageHandler(result);
			},
			null,
			this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			() => {
				if (this._panel.visible) {
					this.setHtml(extensionPath, license, userEmail || '');
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			(message: any) => {
				result = message;
				this.dispose();
			},
			undefined,
			this._disposables
		);
	}

	private setHtml(extensionPath: string, license: string, email: string) {
		const templatePath = path.join(extensionPath, LicenseCheckPanel.webviewsFolder, 'licenseCheck.html');
		this._panel.webview.html = mustache.render(fs.readFileSync(templatePath).toString(), {
			cspSource: this._panel.webview.cspSource,
			email,
			license: license,
			cssUri: this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, LicenseCheckPanel.webviewsFolder, 'styles', 'licenseCheck.css'))),
			jsUri: this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, LicenseCheckPanel.webviewsFolder, 'scripts', 'licenseCheck.js')))
		});
	}

	public dispose() {
		// Clean up our resources
		this._panel.dispose();
		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}
}
