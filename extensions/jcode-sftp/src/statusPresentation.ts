/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import type { ConnectionState } from './connection';

export interface StatusEntry {
	name: string;
	/** The user, host and port, for the tooltip. */
	detail: string;
	state: ConnectionState;
	/** Whether the latest connection attempt failed. */
	failed: boolean;
	/** Why the latest connection attempt failed, for the tooltip of an offline connection. */
	failure?: string;
	/** When background work tries to connect again, in milliseconds since the epoch. Undefined when it is not waiting on a timer. */
	retryAt?: number;
}

export interface StatusPresentation {
	text: string;
	tooltip: string;
	accessibleLabel: string;
	/** Which status bar background to use. */
	attention: 'none' | 'warning' | 'error';
}

const icons: Record<ConnectionState, string> = {
	connected: '$(vm-active)',
	connecting: '$(loading~spin)',
	reconnecting: '$(sync~spin)',
	offline: '$(debug-disconnect)'
};

function stateLabel(state: ConnectionState): string {
	switch (state) {
		case 'connected': return l10n.t('Connected');
		case 'connecting': return l10n.t('Connecting');
		case 'reconnecting': return l10n.t('Reconnecting');
		case 'offline': return l10n.t('Offline');
	}
}

/** How urgent an entry is, so the status bar item reflects the connection needing the most attention. */
function urgency(entry: StatusEntry): number {
	return { connected: 0, connecting: 1, reconnecting: 2, offline: 3 }[entry.state] + (entry.failed ? 0.5 : 0);
}

function formatLocalTime(time: number): string {
	return new Date(time).toLocaleTimeString();
}

/** The tooltip line of one connection. */
function describeEntry(entry: StatusEntry, formatTime: (time: number) => string): string {
	const line = `${entry.name} (${entry.detail}): ${stateLabel(entry.state)}`;
	if (entry.state !== 'offline') {
		return line;
	}
	const summary = entry.retryAt !== undefined ? l10n.t('{0}. Retrying after {1}', line, formatTime(entry.retryAt)) : line;
	return entry.failure ? `${summary}\n${entry.failure}` : summary;
}

/**
 * Describes the status bar item for the connections of the open workspace folders.
 *
 * @param formatTime Writes the time of the next retry for the tooltip, in the user's locale by default.
 */
export function presentStatus(entries: readonly StatusEntry[], formatTime: (time: number) => string = formatLocalTime): StatusPresentation {
	const worst = entries.reduce((current, entry) => urgency(entry) > urgency(current) ? entry : current);
	const subject = entries.length === 1 ? worst.name : l10n.t('{0} SSH Connections', entries.length);
	const label = stateLabel(worst.state);
	let text: string;
	switch (worst.state) {
		case 'connected': text = subject; break;
		case 'connecting': text = l10n.t('Connecting to {0}', subject); break;
		case 'reconnecting': text = l10n.t('Reconnecting to {0}', subject); break;
		case 'offline': text = l10n.t('{0} (Offline)', subject); break;
	}
	return {
		text: `${icons[worst.state]} ${text}`,
		tooltip: entries.map(entry => describeEntry(entry, formatTime)).join('\n'),
		accessibleLabel: l10n.t('SSH/SFTP: {0}, {1}', subject, label),
		attention: worst.state === 'offline' ? (worst.failed ? 'error' : 'warning') : worst.state === 'reconnecting' ? 'warning' : 'none'
	};
}

/** A failed connection that the status bar menu offers to recover. */
export interface StatusMenuFailure {
	id: string;
	name: string;
	message: string;
	/** Set when the connection failed for lack of a working password or passphrase, which the user fixes by entering it. */
	credential?: 'password' | 'passphrase';
}

/** What choosing a status bar menu entry does. */
export type StatusMenuChoice =
	| { action: 'retry' | 'edit'; id: string }
	| { action: 'reconnect' | 'disconnect' | 'manage' };

/** An entry of the status bar menu. An entry without a choice is a separator. */
export interface StatusMenuEntry {
	label: string;
	detail?: string;
	choice?: StatusMenuChoice;
}

/**
 * Lists the entries of the status bar menu. A failed connection comes first, with the reason it
 * failed and the ways to recover, because the status bar item is where a failure is found again
 * after a notification went away.
 */
export function planStatusMenu(failures: readonly StatusMenuFailure[]): StatusMenuEntry[] {
	const entries: StatusMenuEntry[] = [];
	for (const failure of failures) {
		const retry = failure.credential === 'password' ? l10n.t('Enter Password') : failure.credential === 'passphrase' ? l10n.t('Enter Passphrase') : l10n.t('Retry');
		entries.push(
			{ label: `${failure.credential ? '$(key)' : '$(sync)'} ${retry}`, detail: l10n.t('{0}: {1}', failure.name, failure.message), choice: { action: 'retry', id: failure.id } },
			{ label: `$(edit) ${l10n.t('Edit Connection')}`, detail: failure.name, choice: { action: 'edit', id: failure.id } }
		);
	}
	if (failures.length) {
		entries.push({ label: '' });
	}
	entries.push(
		{ label: `$(sync) ${l10n.t('Reconnect')}`, choice: { action: 'reconnect' } },
		{ label: `$(debug-disconnect) ${l10n.t('Disconnect')}`, choice: { action: 'disconnect' } },
		{ label: `$(remote) ${l10n.t('Manage Connections')}`, choice: { action: 'manage' } }
	);
	return entries;
}
