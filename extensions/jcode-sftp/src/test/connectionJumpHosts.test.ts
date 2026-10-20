/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { afterEach, describe, test } from 'node:test';
import { CredentialError, SftpConnections } from '../connection';
import { createStorage, FakeServer } from './fakeSsh';
import { window } from './vscodeStub';

const originalWarning = window.showWarningMessage;

function create(proxyJump = 'admin@bastion.example.com,gateway.internal:2200') {
	const server = new FakeServer();
	const connections = new SftpConnections(createStorage({ proxyJump }), { createClient: () => server.client() });
	return { connections, server };
}

/** The fingerprint that the fake servers present: they use the name of the host as their key. */
function fingerprint(endpoint: string): string {
	return createHash('sha256').update(Buffer.from(endpoint)).digest('base64');
}

describe('connecting through jump hosts', () => {
	afterEach(() => {
		window.showWarningMessage = originalWarning;
	});

	test('reaches the server through every jump host, signing in to each with the credentials of the connection', async () => {
		const { connections, server } = create();
		await connections.sftp('a');
		assert.deepStrictEqual({ connects: server.connects, forwards: server.forwards, state: connections.getState('a') }, {
			connects: [
				{ endpoint: 'bastion.example.com:22', username: 'admin', password: 'secret', direct: true },
				// A jump host without a user is signed in to as the user of the connection.
				{ endpoint: 'gateway.internal:2200', username: 'deploy', password: 'secret', direct: false },
				{ endpoint: 'prod.example.com:22', username: 'deploy', password: 'secret', direct: false }
			],
			forwards: [
				{ from: 'bastion.example.com:22', to: 'gateway.internal:2200' },
				{ from: 'gateway.internal:2200', to: 'prod.example.com:22' }
			],
			state: 'connected'
		});
	});

	test('connects directly when there are no jump hosts', async () => {
		const { connections, server } = create('');
		await connections.sftp('a');
		assert.deepStrictEqual({ connects: server.connects.map(({ endpoint, direct }) => `${endpoint} ${direct}`), forwards: server.forwards }, {
			connects: ['prod.example.com:22 true'],
			forwards: []
		});
	});

	test('verifies the host key of every jump host and remembers the ones the user trusts', async () => {
		const { connections, server } = create();
		server.checkHostKeys = true;
		const prompts: string[] = [];
		window.showWarningMessage = async message => {
			prompts.push(message);
			return 'Trust and Remember';
		};
		await connections.sftp('a');
		const first = prompts.splice(0);
		connections.reconnect('a');
		await connections.sftp('a');
		assert.deepStrictEqual({ first, second: prompts }, {
			first: ['bastion.example.com:22', 'gateway.internal:2200', 'prod.example.com:22'].map(endpoint => `Trust SSH host ${endpoint}? SHA256 fingerprint: ${fingerprint(endpoint)}`),
			second: []
		});
	});

	test('does not connect through a jump host whose key the user declines', async () => {
		const { connections, server } = create();
		server.checkHostKeys = true;
		window.showWarningMessage = async () => undefined;
		await assert.rejects(connections.sftp('a'), { message: 'Could not connect through jump host bastion.example.com:22: Host denied (verification failed)' });
		// The client of the server is created first, then one for the jump host that was tried.
		assert.deepStrictEqual(server.clients.map(client => client.destroyed), [true, true]);
	});

	test('names the jump host that refused the password and keeps the saved password, which may be right for the server', async () => {
		const { connections, server } = create();
		server.rejecting.add('gateway.internal:2200');
		const failure = await connections.sftp('a').then(() => undefined, (error: Error) => error);
		assert.deepStrictEqual({
			credentialProblem: failure instanceof CredentialError && failure.rejected,
			message: failure?.message,
			saved: await connections.getStoredCredential('a')
		}, {
			credentialProblem: true,
			message: 'The password for gateway.internal:2200 was not accepted.',
			saved: 'secret'
		});
	});

	test('clears the saved password when the server itself refuses it', async () => {
		const { connections, server } = create();
		server.rejecting.add('prod.example.com:22');
		const failure = await connections.sftp('a').then(() => undefined, (error: Error) => error);
		assert.deepStrictEqual({ message: failure?.message, saved: await connections.getStoredCredential('a') }, {
			message: 'The password for prod.example.com:22 was not accepted.',
			saved: undefined
		});
	});

	test('reports a jump host that cannot open a channel to the server', async () => {
		const { connections, server } = create();
		server.refusing.add('prod.example.com:22');
		await assert.rejects(connections.sftp('a'), { message: 'Jump host gateway.internal:2200 could not open a connection to prod.example.com:22: Connection refused' });
		assert.deepStrictEqual(server.clients.map(client => client.destroyed), [true, true, true]);
	});

	test('closes every client in the chain when the connection is closed, dropped or cancelled', async () => {
		const closed = create();
		await closed.connections.sftp('a');
		const live = closed.server.clients.map(client => client.destroyed);
		closed.connections.disconnect('a');

		const dropped = create();
		await dropped.connections.sftp('a');
		// The client of the server, which is the first one created, ends when the channel that carries it does.
		dropped.server.clients[0].emit('close');

		const cancelled = create();
		cancelled.server.hold = true;
		const attempt = cancelled.connections.sftp('a').catch(() => undefined);
		await new Promise(resolve => setImmediate(resolve));
		cancelled.connections.reconnect('a');
		await attempt;
		assert.deepStrictEqual({
			live,
			closed: closed.server.clients.map(client => client.destroyed),
			dropped: dropped.server.clients.map(client => client.destroyed),
			droppedState: dropped.connections.getState('a'),
			cancelled: cancelled.server.clients.map(client => client.destroyed)
		}, {
			live: [false, false, false],
			closed: [true, true, true],
			dropped: [true, true, true],
			droppedState: 'offline',
			cancelled: [true, true]
		});
	});

	test('fails with a clear message when the saved jump hosts cannot be read', async () => {
		const { connections, server } = create('bad host!');
		await assert.rejects(connections.sftp('a'), { message: '"bad host!" is not a valid jump host. Use [user@]host[:port].' });
		assert.strictEqual(server.attempts, 0);
	});
});
