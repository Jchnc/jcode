/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import { EventEmitter } from 'node:events';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import type { ConnectionStorage, RemoteProfile, SshClient } from '../connection';

export const profile: RemoteProfile = { id: 'a', name: 'Production', host: 'prod.example.com', port: 22, username: 'deploy', root: '/srv', authentication: 'password' };

/** How a fake server answers a command: with output and an exit code, or by refusing to run it. */
export type FakeCommandResult = { output: string; code: number } | 'refuse';

/** A server that accepts or refuses connections on demand, and records how often it was tried. */
export class FakeServer {
	up = true;
	attempts = 0;
	/** Called when a client starts connecting. */
	onAttempt: () => void = () => undefined;
	/** When set, attempts wait until {@link settle} is called. */
	hold = false;
	/** The commands that clients asked to run. */
	readonly commands: string[] = [];
	/** Decides how commands end. */
	answer: (command: string) => FakeCommandResult = () => ({ output: '', code: 0 });
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

/** Stands in for a command channel: it ends with the exit code once the client sends its end of input. */
class FakeChannel extends EventEmitter {
	readonly stderr = new EventEmitter();

	constructor(private readonly result: { output: string; code: number }) {
		super();
	}

	end(): void {
		setImmediate(() => {
			this.emit('data', Buffer.from(this.result.output));
			this.emit('close', this.result.code);
		});
	}

	close(): void { }
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

	exec(command: string, callback: (error: Error | undefined, channel: ClientChannel) => void): boolean {
		this.server.commands.push(command);
		const result = this.server.answer(command);
		// Only the events and calls that connections use are implemented, so the fake channel stands in for a real one.
		const channel = new FakeChannel(result === 'refuse' ? { output: '', code: 1 } : result) as unknown as ClientChannel;
		callback(result === 'refuse' ? new Error('Channel open failure') : undefined, channel);
		return true;
	}

	destroy(): void { }
}

/** Keeps the saved profile in memory, with a saved password unless `withPassword` is false. */
export function createStorage({ withPassword = true } = {}): ConnectionStorage {
	const values = new Map<string, unknown>([['jcodeSftp.profiles', [profile]]]);
	const secrets = new Map<string, string>(withPassword ? [['jcodeSftp.credential.a', 'secret']] : []);
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
