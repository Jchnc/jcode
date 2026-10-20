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

/** Describes the status bar item for the connections of the open workspace folders. */
export function presentStatus(entries: readonly StatusEntry[]): StatusPresentation {
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
		tooltip: entries.map(entry => `${entry.name} (${entry.detail}): ${stateLabel(entry.state)}`).join('\n'),
		accessibleLabel: l10n.t('SSH/SFTP: {0}, {1}', subject, label),
		attention: worst.state === 'offline' ? (worst.failed ? 'error' : 'warning') : worst.state === 'reconnecting' ? 'warning' : 'none'
	};
}
