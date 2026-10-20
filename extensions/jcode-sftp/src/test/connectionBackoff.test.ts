/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import type { SFTPWrapper } from 'ssh2';
import { SftpConnections, type ConnectionStorage, type RemoteProfile, type SshClient } from '../connection';
import { ReconnectBackoff } from '../reconnectBackoff';

const profile: RemoteProfile = { id: 'a', name: 'Production', host: 'prod.example.com', port: 22, username: 'deploy', root: '/srv', authentication: 'password' };

/** A server that accepts or refuses connections on demand, and records how often it was tried. */
class FakeServer {
	up = true;
	attempts = 0;
	/** Called when a client starts connecting. */
	onAttempt: () => void = () => undefined;
	/** When set, attempts wait until {@link settle} is called. */
	hold = false;
	private readonly waiting: (() => void)[] = [];
	private readonly sessions: EventEmitter[] = [];

	client(): SshClient {
		return new FakeClient(this);
	}

	/** Starts an attempt, which ends right away unless the server is held. */
	attempt(client: EventEmitter): void {
		this.attempts++;
		this.onAttempt();
		const outcome = () => this.up ? client.emit('ready') : client.emit('error', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:22'), { code: 'ECONNREFUSED' }));
		if (this.hold) {
			this.waiting.push(outcome);
		} else {
			setImmediate(outcome);
		}
	}

	open(): EventEmitter {
		const session = new EventEmitter();
		this.sessions.push(session);
		return session;
	}

	settle(): void {
		for (const outcome of this.waiting.splice(0)) {
			outcome();
		}
	}

	/** Ends every live session the way a dropped network does. */
	drop(): void {
		for (const session of this.sessions.splice(0)) {
			session.emit('close');
		}
	}
}

class FakeClient extends EventEmitter {
	constructor(private readonly server: FakeServer) {
		super();
	}

	connect(): this {
		this.server.attempt(this);
		return this;
	}

	sftp(callback: (error: Error | undefined, sftp: SFTPWrapper) => void): boolean {
		// Connections only listen for the close of a session, so any emitter can stand in for one.
		callback(undefined, this.server.open() as unknown as SFTPWrapper);
		return true;
	}

	exec(): boolean {
		return false;
	}

	destroy(): void { }
}

function createStorage(): ConnectionStorage {
	const values = new Map<string, unknown>([['jcodeSftp.profiles', [profile]]]);
	const secrets = new Map<string, string>([['jcodeSftp.credential.a', 'secret']]);
	return {
		globalState: {
			get: <T>(key: string, fallback?: T): T => (values.has(key) ? values.get(key) : fallback) as T,
			update: async (key: string, value: unknown) => { values.set(key, value); }
		},
		secrets: {
			get: async key => secrets.get(key),
			store: async (key, value) => { secrets.set(key, value); },
			delete: async key => { secrets.delete(key); }
		}
	};
}

function create(): { connections: SftpConnections; server: FakeServer; advance(milliseconds: number): void; states: string[] } {
	let now = 1_000_000;
	const server = new FakeServer();
	const backoff = new ReconnectBackoff({ baseDelay: 10_000, maxDelay: 60_000 }, () => now, () => 0.999999);
	const connections = new SftpConnections(createStorage(), backoff, () => server.client());
	const states: string[] = [];
	connections.onDidChangeState(id => states.push(connections.getState(id)));
	return { connections, server, advance: milliseconds => { now += milliseconds; }, states };
}

describe('background reconnects', () => {
	test('wait longer after each failure and stay out of the visible state while retrying', async () => {
		const { connections, server, advance, states } = create();
		await connections.sftp('a');
		server.up = false;
		server.drop();
		states.length = 0;
		const during: string[] = [];
		server.onAttempt = () => during.push(connections.getState('a'));
		const background = { background: true };

		const delays: number[] = [];
		await assert.rejects(connections.sftp('a', background), /ECONNREFUSED/);
		delays.push(connections.backgroundDelay('a'));
		const attemptsAfterFirst = server.attempts;
		await assert.rejects(connections.sftp('a', background), /Waiting before connecting again/);
		const retriedTooEarly = server.attempts - attemptsAfterFirst;
		advance(10_000);
		delays.push(connections.backgroundDelay('a'));
		await assert.rejects(connections.sftp('a', background), /ECONNREFUSED/);
		delays.push(connections.backgroundDelay('a'));
		advance(20_000);
		await assert.rejects(connections.sftp('a', background), /ECONNREFUSED/);
		delays.push(connections.backgroundDelay('a'));

		assert.deepStrictEqual({ delays, retriedTooEarly, duringAttempts: during, stateChanges: states, resting: connections.getState('a') }, {
			delays: [10000, 0, 20000, 40000],
			retriedTooEarly: 0,
			// Only the first attempt after the connection dropped is shown; retries after failures stay offline.
			duringAttempts: ['reconnecting', 'offline', 'offline'],
			stateChanges: ['reconnecting', 'offline', 'offline', 'offline'],
			resting: 'offline'
		});
	});

	test('start over when the user asks, and when the server comes back', async () => {
		const { connections, server, advance } = create();
		server.up = false;
		await assert.rejects(connections.sftp('a', { background: true }), /ECONNREFUSED/);
		await assert.rejects(connections.sftp('a', { background: true }), /Waiting before connecting again/);
		const afterBackground = connections.backgroundDelay('a');
		// A request of the user is tried at once, even while background work waits.
		const attemptsBefore = server.attempts;
		await assert.rejects(connections.sftp('a'), /ECONNREFUSED/);
		const userAttempts = server.attempts - attemptsBefore;
		const afterUser = connections.backgroundDelay('a');
		server.up = true;
		advance(10_000);
		await connections.sftp('a', { background: true });
		assert.deepStrictEqual({ afterBackground, userAttempts, afterUser, afterSuccess: connections.backgroundDelay('a'), state: connections.getState('a'), failure: connections.lastFailure('a') }, {
			afterBackground: 10000,
			userAttempts: 1,
			afterUser: 10000,
			afterSuccess: 0,
			state: 'connected',
			failure: undefined
		});
	});

	test('show a quiet retry as connecting once the user starts waiting for it', async () => {
		const { connections, server, advance, states } = create();
		server.up = false;
		await assert.rejects(connections.sftp('a', { background: true }), /ECONNREFUSED/);
		advance(10_000);
		server.hold = true;
		states.length = 0;
		const quiet = connections.sftp('a', { background: true });
		const whileQuiet = connections.getState('a');
		const waiting = connections.sftp('a');
		const whileWaiting = connections.getState('a');
		await new Promise(resolve => setImmediate(resolve));
		server.up = true;
		server.settle();
		await Promise.all([quiet, waiting]);
		assert.deepStrictEqual({ whileQuiet, whileWaiting, stateChanges: states, attempts: server.attempts }, {
			whileQuiet: 'offline',
			whileWaiting: 'connecting',
			stateChanges: ['connecting', 'connected'],
			attempts: 2
		});
	});

	test('report when the next retry happens, and nothing while connected or waiting for the user', async () => {
		const { connections, server } = create();
		const before = connections.nextRetry('a');
		server.up = false;
		await assert.rejects(connections.sftp('a', { background: true }), /ECONNREFUSED/);
		const afterFailure = connections.nextRetry('a');
		connections.disconnect('a');
		const afterDisconnect = connections.nextRetry('a');
		assert.deepStrictEqual({ before, afterFailure, afterDisconnect }, { before: undefined, afterFailure: 1_010_000, afterDisconnect: undefined });
	});
});
