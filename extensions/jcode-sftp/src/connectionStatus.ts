/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, l10n, ProgressLocation, StatusBarAlignment, ThemeColor, window, workspace, type StatusBarItem } from 'vscode';
import { CredentialError, profileLabel, SftpConnections } from './connection';
import { presentStatus, type StatusEntry } from './statusPresentation';

const scheme = 'jcode-sftp';

/** What the user can ask for from a connection notification. */
export interface StatusActions {
	reconnect(id: string): Promise<void>;
	edit(id: string): Promise<void>;
}

/**
 * Shows the state of the connections used by the open workspace folders in the status bar, shows
 * window progress while connecting, and reports failed connections with actions to recover.
 */
export class ConnectionStatus implements Disposable {
	private readonly item: StatusBarItem;
	private readonly subscriptions: Disposable;
	private readonly progress = new Map<string, () => void>();
	private readonly reporting = new Set<string>();
	private readonly reported = new WeakSet<Error>();
	/** Connections whose failure notification was dismissed. Background failures stay quiet until they connect or the user retries. */
	private readonly muted = new Set<string>();
	/** How many connection attempts the user started are running per connection. Those ask for credentials themselves. */
	private readonly attempts = new Map<string, number>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly connections: SftpConnections, private readonly actions: StatusActions) {
		this.item = window.createStatusBarItem('jcodeSftp.status', StatusBarAlignment.Left, 0);
		this.item.name = l10n.t('SSH/SFTP Connection');
		this.item.command = 'jcodeSftp.showStatusMenu';
		this.subscriptions = Disposable.from(
			this.item,
			connections.onDidChangeState(id => this.stateChanged(id)),
			connections.onDidFailToConnect(({ id, error }) => {
				// An attempt the user started asks for a missing or refused credential instead of reporting it.
				if (!(error instanceof CredentialError && this.attempts.has(id))) {
					void this.reportFailure(id, error);
				}
			}),
			workspace.onDidChangeWorkspaceFolders(() => this.refresh())
		);
		this.refresh();
	}

	/**
	 * Runs a connection attempt the user started. Its failures are reported even if an earlier
	 * notification was dismissed, and credential problems are left to its own prompts.
	 */
	async attempt<T>(id: string, action: () => Promise<T>): Promise<T> {
		this.muted.delete(id);
		this.attempts.set(id, (this.attempts.get(id) ?? 0) + 1);
		try {
			return await action();
		} finally {
			const remaining = (this.attempts.get(id) ?? 1) - 1;
			if (remaining) {
				this.attempts.set(id, remaining);
			} else {
				this.attempts.delete(id);
			}
		}
	}

	/** The saved connections that the open workspace folders belong to. */
	get connectionIds(): string[] {
		const ids = new Set(workspace.workspaceFolders?.filter(folder => folder.uri.scheme === scheme).map(folder => folder.uri.authority));
		return this.connections.profiles.filter(profile => ids.has(profile.id)).map(profile => profile.id);
	}

	/** Updates the status bar item soon, merging the bursts of changes a connection attempt causes. */
	refresh(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.update(), 50);
	}

	/** Whether a failure was already reported to the user, so callers do not report it again. */
	handled(error: Error): boolean {
		return this.reported.has(error);
	}

	/**
	 * Shows a notification for a failed connection with Retry (or Enter Password) and Edit Connection
	 * actions. Only one is shown per connection at a time, and after it is dismissed background
	 * attempts stay quiet, so a server that is down does not keep raising notifications.
	 */
	async reportFailure(id: string, error: Error): Promise<void> {
		this.reported.add(error);
		const profile = this.connections.profiles.find(candidate => candidate.id === id);
		if (!profile || this.reporting.has(id) || this.muted.has(id)) {
			return;
		}
		this.reporting.add(id);
		const retry = !(error instanceof CredentialError) ? l10n.t('Retry') : profile.authentication === 'password' ? l10n.t('Enter Password') : l10n.t('Enter Passphrase');
		const edit = l10n.t('Edit Connection');
		const choice = await window.showErrorMessage(l10n.t('Could not connect to {0}: {1}', profileLabel(profile), error.message), retry, edit);
		this.reporting.delete(id);
		if (choice === retry) {
			await this.actions.reconnect(id);
		} else if (choice === edit) {
			await this.actions.edit(id);
		} else {
			this.muted.add(id);
		}
	}

	private stateChanged(id: string): void {
		const state = this.connections.getState(id);
		if (state === 'connected') {
			this.muted.delete(id);
		}
		if (state === 'connecting' || state === 'reconnecting') {
			this.beginProgress(id, state);
		} else {
			this.progress.get(id)?.();
			this.progress.delete(id);
		}
		this.refresh();
	}

	/** Shows window progress until the connection settles. */
	private beginProgress(id: string, state: 'connecting' | 'reconnecting'): void {
		const profile = this.connections.profiles.find(candidate => candidate.id === id);
		if (!profile || this.progress.has(id)) {
			return;
		}
		const name = profileLabel(profile);
		const settled = new Promise<void>(resolve => this.progress.set(id, resolve));
		void window.withProgress({
			location: ProgressLocation.Window,
			title: state === 'reconnecting' ? l10n.t('Reconnecting to {0}...', name) : l10n.t('Connecting to {0}...', name)
		}, () => settled);
	}

	private update(): void {
		const entries: StatusEntry[] = [];
		for (const id of this.connectionIds) {
			const profile = this.connections.getProfile(id);
			entries.push({
				name: profileLabel(profile),
				detail: `${profile.username}@${profile.host}:${profile.port}`,
				state: this.connections.getState(id),
				failed: this.connections.lastFailure(id) !== undefined
			});
		}
		if (!entries.length) {
			this.item.hide();
			return;
		}
		const { text, tooltip, accessibleLabel, attention } = presentStatus(entries);
		this.item.text = text;
		this.item.tooltip = tooltip;
		this.item.accessibilityInformation = { label: accessibleLabel, role: 'button' };
		this.item.backgroundColor = attention === 'none' ? undefined : new ThemeColor(attention === 'error' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground');
		this.item.show();
	}

	dispose(): void {
		clearTimeout(this.timer);
		for (const settle of this.progress.values()) {
			settle();
		}
		this.progress.clear();
		this.subscriptions.dispose();
	}
}
