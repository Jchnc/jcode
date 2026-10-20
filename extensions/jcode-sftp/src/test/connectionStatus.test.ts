/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { afterEach, describe, test } from 'node:test';
import { SftpConnections } from '../connection';
import { ConnectionStatus } from '../connectionStatus';
import { ReconnectBackoff } from '../reconnectBackoff';
import { createStorage, FakeServer } from './fakeSsh';
import { window, workspace, type FakeMessageOptions } from './vscodeStub';

interface Dialog {
	message: string;
	options: FakeMessageOptions;
	items: string[];
}

describe('ConnectionStatus', () => {
	const statuses: ConnectionStatus[] = [];

	afterEach(() => {
		statuses.splice(0).forEach(status => status.dispose());
	});

	function create(options: { withPassword?: boolean } = {}) {
		const server = new FakeServer();
		const backoff = new ReconnectBackoff({ baseDelay: 10_000, maxDelay: 60_000 }, () => 1_000_000, () => 0.999999);
		const connections = new SftpConnections(createStorage(options), { backoff, createClient: () => server.client() });
		workspace.workspaceFolders = [{ uri: { scheme: 'jcode-sftp', authority: 'a' } }];
		window.statusBarItems.length = 0;
		const dialogs: Dialog[] = [];
		const requests: string[] = [];
		let answer: string | undefined;
		window.showErrorMessage = async (message, dialogOptions, ...items) => {
			dialogs.push({ message, options: dialogOptions, items });
			return answer;
		};
		const status = new ConnectionStatus(connections, {
			reconnect: async id => { requests.push(`reconnect ${id}`); },
			edit: async id => { requests.push(`edit ${id}`); }
		});
		statuses.push(status);
		const item = window.statusBarItems[0];
		return {
			connections, server, dialogs, requests, status,
			answerWith: (choice: string | undefined) => { answer = choice; },
			/** Waits for the status bar item to catch up, which it does after a short delay. */
			settle: () => new Promise<void>(resolve => setTimeout(resolve, 80)),
			shown: () => ({ text: item.text, tooltip: item.tooltip, background: item.backgroundColor?.id })
		};
	}

	const retryTime = new Date(1_010_000).toLocaleTimeString();

	test('shows a failure in the background only in the status bar item', async () => {
		const { connections, server, dialogs, settle, shown } = create();
		server.up = false;
		await assert.rejects(connections.sftp('a', { background: true }), /ECONNREFUSED/);
		await settle();
		assert.deepStrictEqual({ dialogs, shown: shown() }, {
			dialogs: [],
			shown: {
				text: '$(debug-disconnect) Production (Offline)',
				tooltip: `Production (deploy@prod.example.com:22): Offline. Retrying after ${retryTime}\nconnect ECONNREFUSED prod.example.com:22`,
				background: 'statusBarItem.errorBackground'
			}
		});
	});

	test('reports a failed attempt that the user started with a dialog that offers to recover', async () => {
		const { connections, server, status, dialogs, requests, answerWith, settle } = create();
		server.up = false;
		answerWith('Retry');
		await assert.rejects(status.attempt('a', () => connections.sftp('a')), /ECONNREFUSED/);
		await settle();
		assert.deepStrictEqual({ dialogs, requests }, {
			dialogs: [{ message: 'Could not connect to Production.', options: { modal: true, detail: 'connect ECONNREFUSED prod.example.com:22' }, items: ['Retry', 'Edit Connection'] }],
			requests: ['reconnect a']
		});
	});

	test('offers to edit the connection, and reports the next failure again after a dismissed dialog', async () => {
		const { connections, server, status, dialogs, requests, answerWith, settle } = create();
		server.up = false;
		answerWith('Edit Connection');
		await assert.rejects(status.attempt('a', () => connections.sftp('a')), /ECONNREFUSED/);
		await settle();
		answerWith(undefined);
		await assert.rejects(status.attempt('a', () => connections.sftp('a')), /ECONNREFUSED/);
		await settle();
		assert.deepStrictEqual({ dialogs: dialogs.length, requests }, { dialogs: 2, requests: ['edit a'] });
	});

	test('does not report a failure that a retry within the same attempt overcame', async () => {
		const { connections, server, status, dialogs, settle } = create();
		server.up = false;
		await status.attempt('a', async () => {
			await assert.rejects(connections.sftp('a'), /ECONNREFUSED/);
			server.up = true;
			await connections.sftp('a');
		});
		await settle();
		assert.deepStrictEqual({ dialogs, state: connections.getState('a') }, { dialogs: [], state: 'connected' });
	});

	test('leaves a missing password to the prompt of the attempt instead of a dialog', async () => {
		const { connections, status, dialogs, settle, shown } = create({ withPassword: false });
		await assert.rejects(status.attempt('a', () => connections.sftp('a')), /No password is saved/);
		await settle();
		assert.deepStrictEqual({ dialogs, shown: shown() }, {
			dialogs: [],
			shown: {
				text: '$(debug-disconnect) Production (Offline)',
				tooltip: 'Production (deploy@prod.example.com:22): Offline\nNo password is saved for prod.example.com:22. Enter it to connect.',
				background: 'statusBarItem.errorBackground'
			}
		});
	});

	test('goes back to normal once a later attempt succeeds, with no error left over', async () => {
		const { connections, server, status, dialogs, answerWith, settle, shown } = create();
		server.up = false;
		answerWith(undefined);
		await assert.rejects(status.attempt('a', () => connections.sftp('a')), /ECONNREFUSED/);
		await settle();
		const failed = shown().background;
		server.up = true;
		await connections.sftp('a');
		await settle();
		assert.deepStrictEqual({ failed, dialogs: dialogs.length, shown: shown() }, {
			failed: 'statusBarItem.errorBackground',
			dialogs: 1,
			shown: { text: '$(vm-active) Production', tooltip: 'Production (deploy@prod.example.com:22): Connected', background: undefined }
		});
	});
});
