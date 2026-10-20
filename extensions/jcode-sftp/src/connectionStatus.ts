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
 * window progress while connecting, and reports failed connections.
 *
 * The status bar item is where a failure lives: it follows the connection, so it is accurate the
 * moment a later attempt succeeds, and its menu offers the ways to recover. A notification would
 * stay on screen after that, and an extension cannot close one. So only an attempt the user started
 * is reported with a dialog, which the user answers before anything else can change.
 */
export class ConnectionStatus implements Disposable {
	private readonly item: StatusBarItem;
	private readonly subscriptions: Disposable;
	private readonly progress = new Map<string, () => void>();
	private readonly reporting = new Set<string>();
	private readonly reported = new WeakSet<Error>();
	/** How many connection attempts the user started are running per connection. Those ask for credentials themselves. */
	private readonly attempts = new Map<string, number>();
	/** The latest connection failure during the attempts the user started, reported once they end. */
	private readonly attemptFailures = new Map<string, Error>();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly connections: SftpConnections, private readonly actions: StatusActions) {
		this.item = window.createStatusBarItem('jcodeSftp.status', StatusBarAlignment.Left, 0);
		this.item.name = l10n.t('SSH/SFTP Connection');
		this.item.command = 'jcodeSftp.showStatusMenu';
		this.subscriptions = Disposable.from(
			this.item,
			connections.onDidChangeState(id => this.stateChanged(id)),
			connections.onDidFailToConnect(({ id, error }) => {
				// Only an attempt the user started is reported, and it asks for a missing or refused credential instead.
				if (this.attempts.has(id) && !(error instanceof CredentialError)) {
					// Marked right away so that callers catching it do not report it too.
					this.reported.add(error);
					this.attemptFailures.set(id, error);
				}
			}),
			workspace.onDidChangeWorkspaceFolders(() => this.refresh())
		);
		this.refresh();
	}

	/**
	 * Runs a connection attempt the user started. Its failures are reported, and credential problems
	 * are left to its own prompts. Failures of work in the background only show in the status bar.
	 * The report waits until the attempt ends, so a failure that a retry within it overcame, such as
	 * the immediate second try after a refused connection, does not claim that connecting failed.
	 */
	async attempt<T>(id: string, action: () => Promise<T>): Promise<T> {
		this.attempts.set(id, (this.attempts.get(id) ?? 0) + 1);
		try {
			return await action();
		} finally {
			const remaining = (this.attempts.get(id) ?? 1) - 1;
			if (remaining) {
				this.attempts.set(id, remaining);
			} else {
				this.attempts.delete(id);
				const failure = this.attemptFailures.get(id);
				this.attemptFailures.delete(id);
				if (failure && this.connections.getState(id) !== 'connected') {
					void this.reportFailure(id, failure);
				}
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
	 * Tells the user that a connection attempt they started failed, with Retry (or Enter Password) and
	 * Edit Connection actions. It is a dialog rather than a notification, because a notification
	 * cannot be closed when a later attempt succeeds. Only one is shown per connection at a time.
	 */
	async reportFailure(id: string, error: Error): Promise<void> {
		this.reported.add(error);
		const profile = this.connections.profiles.find(candidate => candidate.id === id);
		if (!profile || this.reporting.has(id)) {
			return;
		}
		this.reporting.add(id);
		const retry = !(error instanceof CredentialError) ? l10n.t('Retry') : profile.authentication === 'password' ? l10n.t('Enter Password') : l10n.t('Enter Passphrase');
		const edit = l10n.t('Edit Connection');
		let choice: string | undefined;
		try {
			choice = await window.showErrorMessage(l10n.t('Could not connect to {0}.', profileLabel(profile)), { modal: true, detail: error.message }, retry, edit);
		} finally {
			this.reporting.delete(id);
		}
		if (choice === retry) {
			await this.actions.reconnect(id);
		} else if (choice === edit) {
			await this.actions.edit(id);
		}
	}

	private stateChanged(id: string): void {
		const state = this.connections.getState(id);
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
			const failure = this.connections.lastFailure(id);
			entries.push({
				name: profileLabel(profile),
				detail: `${profile.username}@${profile.host}:${profile.port}`,
				state: this.connections.getState(id),
				failed: failure !== undefined,
				failure: failure?.message,
				retryAt: this.connections.nextRetry(id)
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
