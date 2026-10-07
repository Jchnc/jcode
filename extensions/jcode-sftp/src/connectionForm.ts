/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { ExtensionContext, l10n, Uri, ViewColumn, WebviewPanel, window } from 'vscode';
import { RemoteProfile, SftpConnections } from './connection';

export interface ConnectionFormResult {
	profile: RemoteProfile;
	connect: boolean;
}

interface FormMessage {
	type?: string;
	profile?: unknown;
	credential?: unknown;
	connect?: unknown;
}

function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
		.replaceAll(String.fromCharCode(34), '&quot;').replaceAll(String.fromCharCode(39), '&#39;');
}

function validateProfile(value: unknown, id: string): RemoteProfile {
	if (!value || typeof value !== 'object') {
		throw new Error(l10n.t('Enter the connection details.'));
	}
	const input = value as Record<string, unknown>;
	const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
	const host = typeof input.host === 'string' ? input.host.trim() : '';
	const username = typeof input.username === 'string' ? input.username.trim() : '';
	const root = typeof input.root === 'string' ? input.root.trim() : '';
	const port = Number(input.port);
	const authentication = input.authentication;
	const privateKeyPath = typeof input.privateKeyPath === 'string' ? input.privateKeyPath.trim() : undefined;
	if (!host || !username || !root.startsWith('/') || !Number.isInteger(port) || port < 1 || port > 65535 ||
		(authentication !== 'password' && authentication !== 'privateKey' && authentication !== 'agent') ||
		(authentication === 'privateKey' && !privateKeyPath)) {
		throw new Error(l10n.t('Enter a host, user, valid port, absolute remote folder, and private key path when required.'));
	}
	return { id, name, host, port, username, root: root.replace(/\/+$/, '') || '/', authentication, privateKeyPath: authentication === 'privateKey' ? privateKeyPath : undefined };
}

export class ConnectionForm {
	private current: { id?: string; panel: WebviewPanel; result: Promise<ConnectionFormResult | undefined> } | undefined;

	constructor(private readonly context: ExtensionContext, private readonly connections: SftpConnections) { }

	show(existing?: RemoteProfile): Promise<ConnectionFormResult | undefined> {
		if (this.current && this.current.id === existing?.id) {
			this.current.panel.reveal();
			return this.current.result;
		}
		this.current?.panel.dispose();
		const panel = window.createWebviewPanel('jcodeSftp.connectionForm', existing ? l10n.t('Edit SSH/SFTP Connection') : l10n.t('New SSH/SFTP Connection'), ViewColumn.Active, {
			enableScripts: true,
			localResourceRoots: [Uri.joinPath(this.context.extensionUri, 'media'), Uri.joinPath(this.context.extensionUri, 'out')]
		});
		panel.webview.html = this.html(panel, Boolean(existing));
		const result = new Promise<ConnectionFormResult | undefined>(resolve => {
			let settled = false;
			let saving = false;
			const finish = (value: ConnectionFormResult | undefined, close = true): void => {
				if (settled) { return; }
				settled = true;
				this.current = undefined;
				resolve(value);
				if (close) { panel.dispose(); }
			};
			const receiver = panel.webview.onDidReceiveMessage(async (message: FormMessage) => {
				if (message.type === 'ready') {
					void panel.webview.postMessage({
						type: 'init', profile: existing,
						username: process.env.USERNAME ?? process.env.USER ?? '',
						labels: { password: l10n.t('Password'), passphrase: l10n.t('Passphrase'), existingCredential: l10n.t('Leave blank to keep the saved credential'), newCredential: l10n.t('Optional; you can enter it when connecting'), invalidRoot: l10n.t('Enter an absolute remote path.') }
					});
					return;
				}
				if (message.type === 'cancel') { finish(undefined); return; }
				if (message.type !== 'save' || saving || settled) { return; }
				saving = true;
				try {
					const profile = validateProfile(message.profile, existing?.id ?? randomUUID());
					const credential = profile.authentication !== 'agent' && typeof message.credential === 'string' && message.credential.length ? message.credential : undefined;
					await this.connections.saveProfile(profile, credential);
					finish({ profile, connect: message.connect === true });
				} catch (error) {
					void panel.webview.postMessage({ type: 'error', message: String(error) });
				} finally {
					saving = false;
				}
			});
			panel.onDidDispose(() => { receiver.dispose(); finish(undefined, false); });
		});
		this.current = { id: existing?.id, panel, result };
		return result;
	}

	private html(panel: WebviewPanel, editing: boolean): string {
		const style = panel.webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'media', 'connectionForm.css'));
		const script = panel.webview.asWebviewUri(Uri.joinPath(this.context.extensionUri, 'out', 'connectionFormWebview.js'));
		const label = (value: string) => escapeHtml(value);
		return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource};"><link rel="stylesheet" href="${style}"></head><body>
			<main><header><h1>${label(editing ? l10n.t('Edit Connection') : l10n.t('New Connection'))}</h1><p>${label(l10n.t('Open a remote folder in JCode using SSH/SFTP.'))}</p></header>
			<form id="connection-form"><section><h2>${label(l10n.t('Server'))}</h2><div class="fields"><label class="full" for="name">${label(l10n.t('Connection Name'))}<span>${label(l10n.t('Optional'))}</span><input id="name" maxlength="80" placeholder="${label(l10n.t('Production'))}"></label>
			<label for="host">${label(l10n.t('Host'))}<input id="host" required placeholder="server.example.com" autocomplete="off"></label><label for="port">${label(l10n.t('Port'))}<input id="port" type="number" min="1" max="65535" required value="22"></label>
			<label class="full" for="username">${label(l10n.t('User'))}<input id="username" required autocomplete="username"></label></div></section>
			<section><h2>${label(l10n.t('Workspace'))}</h2><div class="fields"><label class="full" for="root">${label(l10n.t('Remote Folder'))}<input id="root" required value="/" placeholder="/srv/project"><small>${label(l10n.t('Enter an absolute path on the server.'))}</small></label></div></section>
			<section><h2>${label(l10n.t('Authentication'))}</h2><div class="fields"><label class="full" for="authentication">${label(l10n.t('Method'))}<select id="authentication"><option value="password">${label(l10n.t('Password'))}</option><option value="privateKey">${label(l10n.t('Private Key'))}</option><option value="agent">${label(l10n.t('SSH Agent'))}</option></select></label>
			<label class="full" for="privateKeyPath" id="key-field" hidden>${label(l10n.t('Local Private Key Path'))}<input id="privateKeyPath" placeholder="~/.ssh/id_ed25519"></label>
			<label class="full" for="credential" id="credential-field"><span id="credential-label">${label(l10n.t('Password'))}</span><input id="credential" type="password" autocomplete="new-password"><small id="credential-hint"></small></label></div></section>
			<div id="error" role="alert" hidden></div><footer><button type="button" id="cancel" class="secondary">${label(l10n.t('Cancel'))}</button><div class="save-actions"><button type="submit" value="save" class="secondary">${label(l10n.t('Save'))}</button><button type="submit" value="connect" class="primary">${label(l10n.t('Save and Connect'))}</button></div></footer>
			</form></main><script src="${script}"></script></body></html>`;
	}
}
