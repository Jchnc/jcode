/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'node:os';
import { join } from 'node:path';
import { commands, EventEmitter, ExtensionContext, l10n, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace, type LogOutputChannel, type TreeView } from 'vscode';
import { RemoteProfile, SftpConnections } from './connection';
import { ConnectionForm, ConnectionFormResult } from './connectionForm';
import { SftpFileSystemProvider } from './fileSystemProvider';
import { exportProfiles, importProfiles, isEncryptedExport } from './profileJson';

const scheme = 'jcode-sftp';

export class ConnectionManager implements TreeDataProvider<RemoteProfile> {
	private readonly changeEmitter = new EventEmitter<RemoteProfile | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly view: TreeView<RemoteProfile>;
	private readonly form: ConnectionForm;

	constructor(
		context: ExtensionContext,
		private readonly connections: SftpConnections,
		private readonly provider: SftpFileSystemProvider,
		private readonly log: LogOutputChannel
	) {
		this.form = new ConnectionForm(context, connections);
		this.view = window.createTreeView('jcodeSftp.connections', { treeDataProvider: this });
		context.subscriptions.push(this.changeEmitter, this.view, workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
		this.refresh();
	}

	getChildren(): RemoteProfile[] {
		return this.connections.profiles;
	}

	getTreeItem(profile: RemoteProfile): TreeItem {
		const active = workspace.workspaceFolders?.some(folder => folder.uri.scheme === scheme && folder.uri.authority === profile.id) ?? false;
		const item = new TreeItem(profile.name || `${profile.username}@${profile.host}`, TreeItemCollapsibleState.None);
		item.id = profile.id;
		item.description = active
			? l10n.t('Current · {0}', profile.root)
			: profile.root;
		item.tooltip = `${profile.username}@${profile.host}:${profile.port}\n${profile.root}\n${this.authenticationLabel(profile.authentication)}`;
		item.iconPath = new ThemeIcon('remote');
		item.contextValue = active ? 'activeConnection' : 'connection';
		item.command = { command: 'jcodeSftp.open', title: l10n.t('Open Connection'), arguments: [profile.id] };
		return item;
	}

	private authenticationLabel(authentication: RemoteProfile['authentication']): string {
		return authentication === 'password' ? l10n.t('Password') : authentication === 'privateKey' ? l10n.t('Private Key') : l10n.t('SSH Agent');
	}

	private refresh(): void {
		const count = this.connections.profiles.length;
		this.view.description = count ? String(count) : undefined;
		this.changeEmitter.fire(undefined);
	}

	async show(): Promise<void> {
		await commands.executeCommand('jcodeSftp.connections.focus');
	}

	async create(): Promise<void> {
		await this.editProfile();
	}

	private async selectProfile(target?: string | RemoteProfile): Promise<RemoteProfile | undefined> {
		if (typeof target === 'string') {
			return this.connections.getProfile(target);
		}
		if (target) {
			return this.connections.getProfile(target.id);
		}
		const selected = await window.showQuickPick(this.connections.profiles.map(profile => ({
			label: profile.name || profile.host,
			description: `${profile.username}@${profile.host}:${profile.port}`,
			profile
		})), { placeHolder: l10n.t('Select a connection') });
		return selected?.profile;
	}

	async edit(target?: string | RemoteProfile): Promise<void> {
		const profile = await this.selectProfile(target);
		if (profile) { await this.editProfile(profile); }
	}

	private async editProfile(existing?: RemoteProfile): Promise<ConnectionFormResult | undefined> {
		const result = await this.form.show(existing);
		if (!result) { return undefined; }
		this.connections.reconnect(result.profile.id);
		this.refresh();
		if (result.connect || (existing && existing.root !== result.profile.root && this.isActive(result.profile.id))) {
			await this.open(result.profile.id);
		}
		return result;
	}

	private isActive(id: string): boolean {
		return workspace.workspaceFolders?.some(folder => folder.uri.scheme === scheme && folder.uri.authority === id) ?? false;
	}

	async open(target?: string | RemoteProfile): Promise<void> {
		const profile = await this.selectProfile(target);
		if (!profile) { return; }
		const uri = Uri.from({ scheme, authority: profile.id, path: profile.root });
		if (await this.ensureConnected(profile, uri)) {
			const folders = workspace.workspaceFolders ?? [];
			const name = profile.name || `${profile.username}@${profile.host}`;
			await commands.executeCommand('workbench.view.explorer');
			if (folders.length !== 1 || folders[0].uri.toString() !== uri.toString() || folders[0].name !== name) {
				const updated = workspace.updateWorkspaceFolders(0, folders.length, {
					uri,
					name
				});
				if (!updated) {
					throw new Error(l10n.t('Could not switch the current window to this SSH/SFTP workspace. Try again after the current workspace finishes opening.'));
				}
			}
		}
	}

	private async ensureConnected(profile: RemoteProfile, uri: Uri): Promise<boolean> {
		try {
			await this.provider.stat(uri);
		} catch (error) {
			if (profile.authentication === 'agent' || !/authentication|private key|passphrase|password/i.test(String(error))) {
				throw error;
			}
			const credential = await window.showInputBox({ title: profile.authentication === 'password' ? l10n.t('SSH Password') : l10n.t('Private Key Passphrase'), password: true, ignoreFocusOut: true });
			if (credential === undefined) { return false; }
			await this.connections.saveProfile(profile, credential);
			this.connections.reconnect(profile.id);
			await this.provider.stat(uri);
		}
		return true;
	}

	async delete(target?: string | RemoteProfile): Promise<void> {
		const profile = await this.selectProfile(target);
		if (!profile) { return; }
		if (this.isActive(profile.id)) {
			throw new Error(l10n.t('Switch to another workspace before deleting this connection.'));
		}
		const choice = await window.showWarningMessage(l10n.t('Delete connection "{0}"?', profile.name || `${profile.username}@${profile.host}`), { modal: true }, l10n.t('Delete'));
		if (choice === l10n.t('Delete')) {
			await this.connections.deleteProfile(profile.id);
			this.refresh();
		}
	}

	async import(): Promise<void> {
		const [uri] = await window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] }, openLabel: l10n.t('Import Connections') }) ?? [];
		if (!uri) { return; }
		const json = new TextDecoder().decode(await workspace.fs.readFile(uri));
		const encrypted = isEncryptedExport(json);
		const passphrase = encrypted ? await window.showInputBox({ title: l10n.t('Import Connections'), prompt: l10n.t('Enter the export passphrase to restore connections and saved credentials.'), password: true, ignoreFocusOut: true }) : undefined;
		if (encrypted && passphrase === undefined) { return; }
		const imported = await importProfiles(json, passphrase);
		const keyFor = (profile: RemoteProfile): string => `${profile.name ?? ''}\0${profile.username}\0${profile.host}\0${profile.port}\0${profile.root}\0${profile.authentication}\0${profile.privateKeyPath ?? ''}`;
		const existing = new Map(this.connections.profiles.map(profile => [keyFor(profile), profile]));
		let count = 0;
		let restored = 0;
		for (const { profile, credential } of imported) {
			const key = keyFor(profile);
			const saved = existing.get(key);
			if (saved) {
				if (credential !== undefined) {
					await this.connections.saveProfile(saved, credential);
					this.connections.reconnect(saved.id);
					restored++;
				}
				continue;
			}
			existing.set(key, profile);
			await this.connections.saveProfile(profile, credential);
			count++;
			if (credential !== undefined) { restored++; }
		}
		this.refresh();
		void window.showInformationMessage(encrypted || restored
			? l10n.t('Imported {0} connections and restored {1} saved credentials.', count, restored)
			: l10n.t('Imported {0} connections. This export did not contain credentials.', count));
	}

	async export(): Promise<void> {
		const uri = await window.showSaveDialog({ defaultUri: Uri.file(join(homedir(), 'jcode-sftp-connections.json')), filters: { JSON: ['json'] }, saveLabel: l10n.t('Export Connections') });
		if (!uri) { return; }
		const profiles = this.connections.profiles;
		const credentials = new Map<string, string>();
		for (const profile of profiles) {
			if (profile.authentication === 'agent') { continue; }
			const credential = await this.connections.getStoredCredential(profile.id);
			if (credential !== undefined) { credentials.set(profile.id, credential); }
		}
		await workspace.fs.writeFile(uri, new TextEncoder().encode(exportProfiles(profiles, credentials)));
		void window.showInformationMessage(l10n.t('Connections and saved credentials exported. Anyone with this file can decode its passwords.'));
	}

	async reconnectCurrent(): Promise<void> {
		const folders = workspace.workspaceFolders?.filter(folder => folder.uri.scheme === scheme) ?? [];
		if (!folders.length) { await this.show(); return; }
		const folder = folders.length === 1 ? folders[0] : await window.showQuickPick(folders.map(folder => ({ label: folder.name, folder }))).then(choice => choice?.folder);
		if (!folder) { return; }
		this.connections.reconnect(folder.uri.authority);
		if (await this.ensureConnected(this.connections.getProfile(folder.uri.authority), folder.uri)) {
			void window.showInformationMessage(l10n.t('SSH/SFTP workspace reconnected.'));
		}
	}

	async run(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (error) {
			this.log.error(error);
			void window.showErrorMessage(l10n.t('SSH/SFTP action failed: {0}', String(error)));
		}
	}
}
