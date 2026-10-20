/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'node:os';
import { join } from 'node:path';
import { commands, EventEmitter, ExtensionContext, l10n, QuickPickItemKind, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace, type LogOutputChannel, type QuickPickItem, type TreeView } from 'vscode';
import { CredentialError, profileLabel, RemoteProfile, SftpConnections } from './connection';
import { ConnectionForm, ConnectionFormResult } from './connectionForm';
import { ConnectionStatus } from './connectionStatus';
import { SftpFileSystemProvider } from './fileSystemProvider';
import { exportEncryptedProfiles, exportProfiles, importProfiles, isEncryptedExport } from './profileJson';
import { planStatusMenu, type StatusMenuChoice, type StatusMenuFailure } from './statusPresentation';
import { planWorkspaceFolders, type WorkspacePlan } from './workspacePlan';

const scheme = 'jcode-sftp';

/** How saved passwords and passphrases are written when exporting connections. */
type SecretHandling = 'encrypt' | 'exclude' | 'plain';

/** How many times to ask for a refused password or passphrase before giving up. */
const maxCredentialAttempts = 3;

/** Where to open a connection when other folders are already open. */
type Placement = 'add' | 'newWindow' | 'replace';

export class ConnectionManager implements TreeDataProvider<RemoteProfile> {
	private readonly changeEmitter = new EventEmitter<RemoteProfile | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly view: TreeView<RemoteProfile>;
	private readonly form: ConnectionForm;
	private readonly status: ConnectionStatus;

	constructor(
		context: ExtensionContext,
		private readonly connections: SftpConnections,
		private readonly provider: SftpFileSystemProvider,
		private readonly log: LogOutputChannel
	) {
		this.form = new ConnectionForm(context, connections);
		this.view = window.createTreeView('jcodeSftp.connections', { treeDataProvider: this });
		this.status = new ConnectionStatus(connections, {
			reconnect: id => this.run(() => this.reconnect(id)),
			edit: id => this.run(() => this.edit(id))
		});
		context.subscriptions.push(this.changeEmitter, this.view, this.status, workspace.onDidChangeWorkspaceFolders(() => this.refresh()));
		this.refresh();
	}

	getChildren(): RemoteProfile[] {
		return this.connections.profiles;
	}

	getTreeItem(profile: RemoteProfile): TreeItem {
		const active = workspace.workspaceFolders?.some(folder => folder.uri.scheme === scheme && folder.uri.authority === profile.id) ?? false;
		const item = new TreeItem(profileLabel(profile), TreeItemCollapsibleState.None);
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
		this.status.refresh();
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
			await this.open(result.profile.id, result.credential);
		}
		return result;
	}

	private isActive(id: string): boolean {
		return workspace.workspaceFolders?.some(folder => folder.uri.scheme === scheme && folder.uri.authority === id) ?? false;
	}

	async open(target?: string | RemoteProfile, typedCredential?: string): Promise<void> {
		const profile = await this.selectProfile(target);
		if (!profile) { return; }
		const uri = Uri.from({ scheme, authority: profile.id, path: profile.root });
		if (await this.ensureConnected(profile, uri, typedCredential)) {
			const folders = workspace.workspaceFolders ?? [];
			const folder = { uri, name: profileLabel(profile) };
			const plan = planWorkspaceFolders(
				folders.map(existing => ({ uri: existing.uri.toString(), name: existing.name, connection: existing.uri.scheme === scheme ? existing.uri.authority : undefined })),
				{ uri: uri.toString(), name: folder.name, connection: profile.id }
			);
			if (plan.action === 'none') {
				await commands.executeCommand('workbench.view.explorer');
				return;
			}
			const placement = plan.action === 'ask' ? await this.askPlacement(folder.name) : undefined;
			if (plan.action === 'ask' && !placement) { return; }
			if (placement === 'newWindow') {
				await commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
				return;
			}
			await commands.executeCommand('workbench.view.explorer');
			if (!this.updateFolders(plan, placement, folders.length, folder)) {
				throw new Error(l10n.t('Could not switch the current window to this SSH/SFTP workspace. Try again after the current workspace finishes opening.'));
			}
		}
	}

	private updateFolders(plan: WorkspacePlan, placement: Placement | undefined, count: number, folder: { uri: Uri; name: string }): boolean {
		if (plan.action === 'open') {
			return workspace.updateWorkspaceFolders(0, 0, folder);
		}
		if (plan.action === 'update') {
			return workspace.updateWorkspaceFolders(plan.index, 1, folder);
		}
		return placement === 'replace' ? workspace.updateWorkspaceFolders(0, count, folder) : workspace.updateWorkspaceFolders(count, 0, folder);
	}

	/** Asks where to open a connection when other folders are already open, so none is closed unexpectedly. */
	private async askPlacement(name: string): Promise<Placement | undefined> {
		const choice = await window.showQuickPick<QuickPickItem & { placement: Placement }>([
			{ label: l10n.t('Add to Workspace'), description: l10n.t('Default'), detail: l10n.t('Keep the open folders and add this connection as another folder.'), placement: 'add' },
			{ label: l10n.t('Open in New Window'), detail: l10n.t('Leave this window as it is.'), placement: 'newWindow' },
			{ label: l10n.t('Replace Workspace'), detail: l10n.t('Close the open folders and show only this connection.'), placement: 'replace' }
		], { title: l10n.t('Open {0}', name), placeHolder: l10n.t('Folders are already open in this window. Where should this connection open?'), ignoreFocusOut: true });
		return choice?.placement;
	}

	/**
	 * Connects, asking for the password or passphrase again when the server refuses the one in use.
	 * Typed credentials are saved by the connection only after the server accepts them. Returns false
	 * when the user cancels the prompt.
	 */
	private ensureConnected(profile: RemoteProfile, uri: Uri, typedCredential?: string): Promise<boolean> {
		return this.status.attempt(profile.id, async () => {
			let credential = typedCredential;
			for (let attempt = 0; ; attempt++) {
				let failure: CredentialError;
				try {
					if (credential !== undefined) {
						await this.connections.connectWithCredential(profile.id, credential);
					}
					await this.provider.stat(uri);
					return true;
				} catch (error) {
					if (!(error instanceof CredentialError)) {
						throw error;
					}
					if (attempt >= maxCredentialAttempts) {
						void this.status.reportFailure(profile.id, error);
						return false;
					}
					failure = error;
				}
				credential = await window.showInputBox({
					title: profile.authentication === 'password' ? l10n.t('SSH Password') : l10n.t('Private Key Passphrase'),
					prompt: failure.rejected ? l10n.t('{0} Enter it again.', failure.message) : failure.message,
					password: true,
					ignoreFocusOut: true
				});
				if (credential === undefined) { return false; }
			}
		});
	}

	async delete(target?: string | RemoteProfile): Promise<void> {
		const profile = await this.selectProfile(target);
		if (!profile) { return; }
		if (this.isActive(profile.id)) {
			throw new Error(l10n.t('Switch to another workspace before deleting this connection.'));
		}
		const choice = await window.showWarningMessage(l10n.t('Delete connection "{0}"?', profileLabel(profile)), { modal: true }, l10n.t('Delete'));
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
		const profiles = this.connections.profiles;
		const credentials = new Map<string, string>();
		for (const profile of profiles) {
			if (profile.authentication === 'agent') { continue; }
			const credential = await this.connections.getStoredCredential(profile.id);
			if (credential !== undefined) { credentials.set(profile.id, credential); }
		}
		// Nothing to protect without saved credentials, so only ask when there are secrets to write.
		const handling = credentials.size ? await this.askSecretHandling() : 'exclude';
		if (!handling) { return; }
		const passphrase = handling === 'encrypt' ? await this.askNewPassphrase() : undefined;
		if (handling === 'encrypt' && !passphrase) { return; }
		if (handling === 'plain' && !await this.confirmPlainSecrets()) { return; }
		const uri = await window.showSaveDialog({ defaultUri: Uri.file(join(homedir(), 'jcode-sftp-connections.json')), filters: { JSON: ['json'] }, saveLabel: l10n.t('Export Connections') });
		if (!uri) { return; }
		const json = passphrase
			? await exportEncryptedProfiles(profiles, credentials, passphrase)
			: exportProfiles(profiles, handling === 'plain' ? credentials : new Map());
		await workspace.fs.writeFile(uri, new TextEncoder().encode(json));
		if (handling === 'encrypt') {
			void window.showInformationMessage(l10n.t('Connections exported with encrypted credentials. Keep the passphrase safe; it cannot be recovered.'));
		} else if (handling === 'plain') {
			void window.showWarningMessage(l10n.t('Connections exported with unencrypted credentials. Anyone with this file can decode its passwords.'));
		} else {
			void window.showInformationMessage(l10n.t('Connections exported without credentials.'));
		}
	}

	private async askSecretHandling(): Promise<SecretHandling | undefined> {
		const choice = await window.showQuickPick<QuickPickItem & { handling: SecretHandling }>([
			{ label: l10n.t('Encrypt with Passphrase'), description: l10n.t('Recommended'), detail: l10n.t('Saved passwords and passphrases are encrypted. Importing them needs the same passphrase.'), handling: 'encrypt' },
			{ label: l10n.t('Exclude Secrets'), detail: l10n.t('Export connection details only. Enter passwords again after importing.'), handling: 'exclude' },
			{ label: l10n.t('Include Unencrypted'), detail: l10n.t('Anyone with the file can read the saved passwords and passphrases.'), handling: 'plain' }
		], { title: l10n.t('Export Connections'), placeHolder: l10n.t('How should saved passwords and passphrases be exported?'), ignoreFocusOut: true });
		return choice?.handling;
	}

	private async askNewPassphrase(): Promise<string | undefined> {
		const title = l10n.t('Encrypt Export');
		const passphrase = await window.showInputBox({
			title, prompt: l10n.t('Enter a passphrase to encrypt saved credentials. You need it to import them.'), password: true, ignoreFocusOut: true,
			validateInput: value => value.length < 8 ? l10n.t('Use at least 8 characters.') : undefined
		});
		if (passphrase === undefined) { return undefined; }
		const confirmation = await window.showInputBox({
			title, prompt: l10n.t('Enter the passphrase again to confirm it.'), password: true, ignoreFocusOut: true,
			validateInput: value => value === passphrase ? undefined : l10n.t('The passphrases do not match.')
		});
		return confirmation === undefined ? undefined : passphrase;
	}

	private async confirmPlainSecrets(): Promise<boolean> {
		const include = l10n.t('Include Unencrypted');
		const choice = await window.showWarningMessage(
			l10n.t('Export saved passwords without encryption?'),
			{ modal: true, detail: l10n.t('Passwords and passphrases are written to the file in a form anyone can decode. Anyone who gets the file can sign in to your servers.') },
			include
		);
		return choice === include;
	}

	async reconnectCurrent(): Promise<void> {
		const folders = workspace.workspaceFolders?.filter(folder => folder.uri.scheme === scheme) ?? [];
		if (!folders.length) { await this.show(); return; }
		const folder = folders.length === 1 ? folders[0] : await window.showQuickPick(folders.map(folder => ({ label: folder.name, folder }))).then(choice => choice?.folder);
		if (folder) { await this.reconnect(folder.uri.authority, folder.uri); }
	}

	/** Drops the connection of a saved profile and connects again, asking for credentials when needed. */
	async reconnect(id: string, uri?: Uri): Promise<void> {
		const profile = this.connections.getProfile(id);
		this.connections.reconnect(id);
		if (await this.ensureConnected(profile, uri ?? Uri.from({ scheme, authority: id, path: profile.root }))) {
			void window.showInformationMessage(l10n.t('SSH/SFTP workspace reconnected.'));
		}
	}

	/** Closes a connection. It reconnects the next time a file operation needs it. */
	async disconnect(target?: string): Promise<void> {
		const id = target ?? await this.pickWorkspaceConnection();
		if (id) { this.connections.disconnect(id); }
	}

	/** The workspace connections whose latest attempt failed, with the reason. */
	private failedConnections(): StatusMenuFailure[] {
		return this.status.connectionIds.flatMap(id => {
			const error = this.connections.lastFailure(id);
			if (!error) { return []; }
			const profile = this.connections.getProfile(id);
			const credential = error instanceof CredentialError ? (profile.authentication === 'password' ? 'password' : 'passphrase') : undefined;
			return [{ id, name: profileLabel(profile), message: error.message, credential }];
		});
	}

	/**
	 * Offers the actions for the connections shown in the status bar. A failed connection is listed
	 * first with its reason, so the failure is always at hand here and never depends on a notification.
	 */
	async showStatusMenu(): Promise<void> {
		const entries = planStatusMenu(this.failedConnections());
		const choice = await window.showQuickPick<QuickPickItem & { choice?: StatusMenuChoice }>(
			entries.map(entry => entry.choice ? { label: entry.label, detail: entry.detail, choice: entry.choice } : { label: entry.label, kind: QuickPickItemKind.Separator }),
			{ title: l10n.t('SSH/SFTP Connection'), placeHolder: l10n.t('Select an action') }
		);
		switch (choice?.choice?.action) {
			case 'retry': return this.reconnect(choice.choice.id);
			case 'edit': return this.edit(choice.choice.id);
			case 'manage': return this.show();
			case 'reconnect':
			case 'disconnect': {
				const id = await this.pickWorkspaceConnection();
				if (id) {
					await (choice.choice.action === 'reconnect' ? this.reconnect(id) : this.disconnect(id));
				}
			}
		}
	}

	/** The connection of the open workspace folders, asking which one when there are several. */
	private async pickWorkspaceConnection(): Promise<string | undefined> {
		const ids = this.status.connectionIds;
		if (ids.length <= 1) { return ids[0]; }
		const choice = await window.showQuickPick(ids.map(id => {
			const profile = this.connections.getProfile(id);
			return { label: profileLabel(profile), description: `${profile.username}@${profile.host}:${profile.port}`, id };
		}), { placeHolder: l10n.t('Select a connection') });
		return choice?.id;
	}

	async run(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (error) {
			this.log.error(error);
			// A failed connection was already reported with actions to retry or edit it.
			if (!(error instanceof Error && this.status.handled(error))) {
				void window.showErrorMessage(l10n.t('SSH/SFTP action failed: {0}', String(error)));
			}
		}
	}
}
