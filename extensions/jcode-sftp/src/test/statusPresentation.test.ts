/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import { presentStatus, type StatusEntry } from '../statusPresentation';

describe('presentStatus', () => {
	const entry = (name: string, state: StatusEntry['state'], failed = false): StatusEntry => ({ name, detail: `deploy@${name.toLowerCase()}.example.com:22`, state, failed });

	test('shows each connection state with its own icon and attention level', () => {
		const present = (state: StatusEntry['state'], failed?: boolean) => {
			const { text, attention } = presentStatus([entry('Production', state, failed)]);
			return `${attention}: ${text}`;
		};
		assert.deepStrictEqual({
			connected: present('connected'),
			connecting: present('connecting'),
			reconnecting: present('reconnecting'),
			offline: present('offline'),
			failed: present('offline', true)
		}, {
			connected: 'none: $(vm-active) Production',
			connecting: 'none: $(loading~spin) Connecting to Production',
			reconnecting: 'warning: $(sync~spin) Reconnecting to Production',
			offline: 'warning: $(debug-disconnect) Production (Offline)',
			failed: 'error: $(debug-disconnect) Production (Offline)'
		});
	});

	test('tells when an offline connection is tried again, and only then', () => {
		const tooltip = (state: StatusEntry['state'], retryAt?: number) => presentStatus([{ ...entry('Production', state, true), retryAt }], time => `t=${time}`).tooltip;
		assert.deepStrictEqual({
			offline: tooltip('offline', 1500),
			waitingForUser: tooltip('offline'),
			connecting: tooltip('connecting', 1500)
		}, {
			offline: 'Production (deploy@production.example.com:22): Offline. Retrying after t=1500',
			waitingForUser: 'Production (deploy@production.example.com:22): Offline',
			connecting: 'Production (deploy@production.example.com:22): Connecting'
		});
	});

	test('summarizes several connections by the one needing the most attention', () => {
		assert.deepStrictEqual(presentStatus([entry('Production', 'connected'), entry('Staging', 'offline', true), entry('Backup', 'reconnecting')]), {
			text: '$(debug-disconnect) 3 SSH Connections (Offline)',
			tooltip: [
				'Production (deploy@production.example.com:22): Connected',
				'Staging (deploy@staging.example.com:22): Offline',
				'Backup (deploy@backup.example.com:22): Reconnecting'
			].join('\n'),
			accessibleLabel: 'SSH/SFTP: 3 SSH Connections, Offline',
			attention: 'error'
		});
	});
});
