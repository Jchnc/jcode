/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import { EventEmitter } from 'node:events';
import { PassThrough, type Duplex } from 'node:stream';
import type { ClientChannel, ConnectConfig, HostVerifier, SFTPWrapper } from 'ssh2';
import type { ConnectionStorage, RemoteProfile, SshClient } from '../connection';

export const profile: RemoteProfile = { id: 'a', name: 'Production', host: 'prod.example.com', port: 22, username: 'deploy', root: '/srv', authentication: 'password' };

/** How a fake server answers a command: with output and an exit code, or by refusing to run it. */
export type FakeCommandResult = { output: string; code: number } | 'refuse';

/** A connection that a client was asked to make. */
export interface FakeConnect {
	/** The host and port that were reached: the one asked for, or the end of the tunnel the client was given. */
	endpoint: string;
	username: string;
	password?: string;
	/** Whether the client connected on its own rather than through a jump host. */
	direct: boolean;
}

/** A network of fake SSH servers, which accept or refuse connections on demand, and a record of what happened to it. */
export class FakeServer {
	/** When false, every server refuses connections. */
	up = true;
	attempts = 0;
	/** Called when a client starts connecting. */
	onAttempt: () => void = () => undefined;
	/** When set, attempts wait until {@link settle} is called. */
	hold = false;
	/** Servers (as `host:port`) that refuse connections, and cannot be reached through a jump host either. */
	readonly refusing = new Set<string>();
	/** Servers (as `host:port`) that turn away the credentials they get. */
	readonly rejecting = new Set<string>();
	/** Whether clients are made to verify host keys, which asks the user. Off by default, because most tests do not care. */
	checkHostKeys = false;
	/** The commands that clients asked to run. */
	readonly commands: string[] = [];
	/** Every connection that clients made, in order. */
	readonly connects: FakeConnect[] = [];
	/** Every channel that a jump host was asked to open. */
	readonly forwards: { from: string; to: string }[] = [];
	/** Every client that was created. */
	readonly clients: FakeClient[] = [];
	/** Decides how commands end. */
	answer: (command: string) => FakeCommandResult = () => ({ output: '', code: 0 });
	private readonly waiting: (() => void)[] = [];
	private readonly sessions: EventEmitter[] = [];

	client(): SshClient {
		const client = new FakeClient(this);
		this.clients.push(client);
		return client;
	}

	/** Starts an attempt, which ends right away unless the server is held. */
	attempt(client: FakeClient, config: ConnectConfig): void {
		this.attempts++;
		this.onAttempt();
		const tunnel = config.sock instanceof FakeTunnel ? config.sock : undefined;
		const endpoint = tunnel?.destination ?? `${config.host}:${config.port}`;
		client.endpoint = endpoint;
		this.connects.push({ endpoint, username: config.username ?? '', password: config.password, direct: !tunnel });
		const outcome = () => {
			if (!this.up || this.refusing.has(endpoint)) {
				client.emit('error', Object.assign(new Error(`connect ECONNREFUSED ${endpoint}`), { code: 'ECONNREFUSED' }));
				return;
			}
			const signIn = () => this.rejecting.has(endpoint)
				? client.emit('error', Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' }))
				: client.emit('ready');
			if (this.checkHostKeys && typeof config.hostVerifier === 'function') {
				(config.hostVerifier as HostVerifier)(Buffer.from(endpoint), valid => valid ? signIn() : client.emit('error', new Error('Host denied (verification failed)')));
			} else {
				signIn();
			}
		};
		if (this.hold) {
			this.waiting.push(outcome);
		} else {
			setImmediate(outcome);
		}
	}

	/** Opens the channel through which a client reaches another server. */
	forward(from: string, to: string): Duplex {
		this.forwards.push({ from, to });
		return new FakeTunnel(to);
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

/** A channel from a jump host to the server it was asked to reach. */
export class FakeTunnel extends PassThrough {
	constructor(readonly destination: string) {
		super();
	}
}

/** Stands in for a command channel: it ends with the exit code once the client sends its end of input. */
class FakeExecChannel extends EventEmitter {
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

export class FakeClient extends EventEmitter {
	/** The server this client connected to. */
	endpoint = '';
	destroyed = false;

	constructor(private readonly server: FakeServer) {
		super();
	}

	connect(config: ConnectConfig): this {
		this.server.attempt(this, config);
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
		const channel = new FakeExecChannel(result === 'refuse' ? { output: '', code: 1 } : result) as unknown as ClientChannel;
		callback(result === 'refuse' ? new Error('Channel open failure') : undefined, channel);
		return true;
	}

	forwardOut(_sourceIP: string, _sourcePort: number, destinationIP: string, destinationPort: number, callback: (error: Error | undefined, channel: Duplex) => void): boolean {
		const destination = `${destinationIP}:${destinationPort}`;
		const channel = this.server.forward(this.endpoint, destination);
		callback(this.server.refusing.has(destination) ? new Error('Connection refused') : undefined, channel);
		return true;
	}

	destroy(): void {
		this.destroyed = true;
	}
}

/** Keeps the saved profile in memory, with a saved password unless `withPassword` is false, and with jump hosts when given. */
export function createStorage({ withPassword = true, proxyJump }: { withPassword?: boolean; proxyJump?: string } = {}): ConnectionStorage {
	const values = new Map<string, unknown>([['jcodeSftp.profiles', [{ ...profile, proxyJump }]]]);
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
