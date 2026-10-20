/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client, type ClientChannel, type ClientErrorExtensions, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { EventEmitter, l10n, window, type Memento, type SecretStorage } from 'vscode';
import { classifyAuthFailure } from './authFailure';
import { LinkCounter, type ExecResult, type LinkCountFailure } from './linkCounter';
import { PausableTimeout } from './pausableTimeout';
import { ReconnectBackoff } from './reconnectBackoff';

export interface RemoteProfile {
	id: string;
	name?: string;
	host: string;
	port: number;
	username: string;
	root: string;
	authentication: 'password' | 'privateKey' | 'agent';
	privateKeyPath?: string;
}

/** The name shown for a profile: its name, or the user and host when it has none. */
export function profileLabel(profile: RemoteProfile): string {
	return profile.name || `${profile.username}@${profile.host}`;
}

/** Whether a saved profile has a live connection, is connecting, or has none. */
export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

/** A password or passphrase is missing or was refused, so the user can fix it by entering one. */
export class CredentialError extends Error {
	constructor(message: string, readonly rejected: boolean, options?: ErrorOptions) {
		super(message, options);
		this.name = 'CredentialError';
	}
}

/** The parts of an ssh2 client that a connection uses, so that tests can substitute a fake. */
export interface SshClient {
	connect(config: ConnectConfig): void;
	on(event: 'error', listener: (error: Error) => void): void;
	once(event: 'ready' | 'close', listener: () => void): void;
	sftp(callback: (error: Error | undefined, sftp: SFTPWrapper) => void): void;
	exec(command: string, callback: (error: Error | undefined, channel: ClientChannel) => void): void;
	destroy(): void;
}

/** What connections need from the extension context: saved profiles and trusted host keys, and secrets. */
export interface ConnectionStorage {
	readonly globalState: Pick<Memento, 'get' | 'update'>;
	readonly secrets: Pick<SecretStorage, 'get' | 'store' | 'delete'>;
}

interface Connection {
	client: SshClient;
	sftp: SFTPWrapper;
	/** Reads hard link counts for saves. It lives and dies with the connection, so a new connection asks the server again. */
	links: LinkCounter;
}

interface PendingConnection {
	client: SshClient;
	controller: AbortController;
	promise: Promise<Connection>;
	/** Set for a background retry after earlier failures, which stays out of the connection state until someone waits for it. */
	quiet: boolean;
}

/** Who needs a connection: a request of the user, or work in the background that can wait and try again later. */
export interface ConnectionRequest {
	background?: boolean;
}

/** Optional parts of {@link SftpConnections}, which tests replace. */
export interface SftpConnectionsOptions {
	/** Decides how long background attempts wait after failures. */
	backoff?: ReconnectBackoff;
	/** Creates the SSH client of a connection attempt. */
	createClient?: () => SshClient;
	/** Receives notes about connection behavior, such as why hard links cannot be detected. */
	log?: { info(message: string): void };
}

const profilesKey = 'jcodeSftp.profiles';
const trustedKeysKey = 'jcodeSftp.trustedHostKeys';

export class SftpConnections {
	private readonly active = new Map<string, Connection>();
	private readonly pending = new Map<string, PendingConnection>();
	/** Credentials the user just typed, which are saved only once a server accepts them. */
	private readonly candidates = new Map<string, string>();
	/** Profiles that had a live connection since they were last disconnected. */
	private readonly connected = new Set<string>();
	private readonly suspended = new Set<string>();
	private readonly failures = new Map<string, Error>();
	private readonly stateEmitter = new EventEmitter<string>();
	private readonly failureEmitter = new EventEmitter<{ id: string; error: Error }>();
	private disposed = false;

	/** Fires with the id of a profile whose connection state changed. */
	readonly onDidChangeState = this.stateEmitter.event;
	/** Fires when a connection attempt fails, including when its credential is missing or refused. */
	readonly onDidFailToConnect = this.failureEmitter.event;

	private readonly backoff: ReconnectBackoff;
	private readonly createClient: () => SshClient;
	private readonly log: { info(message: string): void } | undefined;

	constructor(private readonly context: ConnectionStorage, options: SftpConnectionsOptions = {}) {
		this.backoff = options.backoff ?? new ReconnectBackoff();
		this.createClient = options.createClient ?? (() => new Client());
		this.log = options.log;
	}

	get profiles(): RemoteProfile[] {
		return this.context.globalState.get<RemoteProfile[]>(profilesKey, []);
	}

	getProfile(id: string): RemoteProfile {
		const profile = this.profiles.find(candidate => candidate.id === id);
		if (!profile) {
			throw new Error(l10n.t('Unknown SSH/SFTP connection: {0}', id));
		}
		return profile;
	}

	getStoredCredential(id: string): Thenable<string | undefined> {
		return this.context.secrets.get(`jcodeSftp.credential.${id}`);
	}

	async saveProfile(profile: RemoteProfile, credential?: string): Promise<void> {
		const profiles = this.profiles;
		const previous = profiles.find(candidate => candidate.id === profile.id);
		const updated = previous ? profiles.map(candidate => candidate.id === profile.id ? profile : candidate) : [...profiles, profile];
		await this.context.globalState.update(profilesKey, updated);
		// A failure with the previous settings says nothing about the new ones.
		this.failures.delete(profile.id);
		this.backoff.reset(profile.id);
		if (credential !== undefined) {
			await this.context.secrets.store(`jcodeSftp.credential.${profile.id}`, credential);
		} else if (previous?.authentication !== profile.authentication || profile.authentication === 'agent') {
			await this.context.secrets.delete(`jcodeSftp.credential.${profile.id}`);
		}
	}

	async deleteProfile(id: string): Promise<void> {
		this.disconnect(id);
		await this.context.globalState.update(profilesKey, this.profiles.filter(profile => profile.id !== id));
		await this.context.secrets.delete(`jcodeSftp.credential.${id}`);
	}

	/**
	 * Resolves the SFTP session of a saved profile, connecting when there is none. A request from the
	 * user connects at once. Background work (change detection) instead waits out a delay that grows
	 * while the server keeps failing, so a server that is down is not tried again at every poll.
	 */
	async sftp(id: string, request: ConnectionRequest = {}): Promise<SFTPWrapper> {
		if (this.disposed) {
			throw new Error(l10n.t('SSH connections have been disposed.'));
		}
		const existing = this.active.get(id);
		if (existing) {
			return existing.sftp;
		}
		let pending = this.pending.get(id);
		if (request.background) {
			if (!pending && (this.waitsForUser(id) || this.backoff.remaining(id) > 0)) {
				throw new Error(l10n.t('Waiting before connecting again.'));
			}
		} else {
			// Someone is waiting for the connection, so it is tried right away and in plain view.
			this.suspended.delete(id);
			this.backoff.reset(id);
			if (pending?.quiet) {
				pending.quiet = false;
				this.changed(id);
			}
		}
		if (!pending) {
			const profile = this.getProfile(id);
			const client = this.createClient();
			const controller = new AbortController();
			const quiet = request.background === true && this.backoff.failures(id) > 0;
			pending = { client, controller, quiet, promise: this.connect(profile, client, controller.signal) };
			this.pending.set(id, pending);
			const attempt = pending;
			void attempt.promise.then(() => this.failures.delete(id), error => {
				if (!attempt.controller.signal.aborted && !this.disposed) {
					this.failures.set(id, error);
					this.backoff.failed(id);
					this.failureEmitter.fire({ id, error });
				}
			}).finally(() => {
				if (this.pending.get(id) === attempt) {
					this.pending.delete(id);
				}
				this.changed(id);
			});
			if (!quiet) {
				this.changed(id);
			}
		}
		return (await pending.promise).sftp;
	}

	/**
	 * The connection state of a saved profile. A new attempt after a live connection ended is a
	 * reconnect. A quiet retry in the background still counts as offline, so the state does not flicker.
	 */
	getState(id: string): ConnectionState {
		if (this.active.has(id)) {
			return 'connected';
		}
		const pending = this.pending.get(id);
		if (pending && !pending.quiet) {
			return this.connected.has(id) ? 'reconnecting' : 'connecting';
		}
		return 'offline';
	}

	/** Milliseconds until background work may try to connect again: zero when it may do so now. */
	backgroundDelay(id: string): number {
		return this.active.has(id) || this.pending.has(id) ? 0 : this.backoff.remaining(id);
	}

	/**
	 * When background work may next try to connect after a failure, in milliseconds since the epoch.
	 * Undefined when nothing is scheduled: it is connected, an attempt is running, or it waits for the user.
	 */
	nextRetry(id: string): number | undefined {
		return this.active.has(id) || this.pending.has(id) || this.waitsForUser(id) ? undefined : this.backoff.retryAt(id);
	}

	/** The error that ended the latest connection attempt, until a connection succeeds. */
	lastFailure(id: string): Error | undefined {
		return this.failures.get(id);
	}

	/**
	 * Whether background work must not reconnect until something else asks: the user disconnected, or
	 * the credential is missing or was refused, which retrying cannot fix.
	 */
	waitsForUser(id: string): boolean {
		return this.suspended.has(id) || this.failures.get(id) instanceof CredentialError;
	}

	/** Ends the connection on request. It stays closed until the next file operation needs it. */
	disconnect(id: string): void {
		this.suspended.add(id);
		this.connected.delete(id);
		this.failures.delete(id);
		this.backoff.reset(id);
		this.reconnect(id);
	}

	private changed(id: string): void {
		if (!this.disposed) {
			this.stateEmitter.fire(id);
		}
	}

	private describeLinkFailure(endpoint: string, failure: LinkCountFailure): string {
		return failure === 'refused'
			? `${endpoint} does not run commands, so saves assume that files have a single hard link.`
			: `${endpoint} did not report a hard link count, which suggests it is not a POSIX server, so saves assume that files have a single hard link.`;
	}

	/**
	 * Runs a short command beside the SFTP session and resolves its output and exit code, or undefined
	 * when the server refuses it or it takes longer than the timeout.
	 */
	private execute(client: SshClient, command: string, timeout = 5000): Promise<ExecResult | undefined> {
		return new Promise<ExecResult | undefined>(resolve => {
			let output = '';
			let channel: ClientChannel | undefined;
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				channel?.close();
				resolve(undefined);
			}, timeout);
			const finish = (value: ExecResult | undefined) => {
				clearTimeout(timer);
				resolve(value);
			};
			try {
				client.exec(command, (error, stream) => {
					if (error || timedOut) {
						stream?.close();
						finish(undefined);
						return;
					}
					channel = stream;
					stream.on('data', (chunk: Buffer) => {
						if (output.length < 1024) {
							output += chunk.toString('utf8');
						}
					});
					stream.stderr.on('data', () => undefined);
					stream.once('close', (code: number | null) => finish({ output, code }));
					// Send EOF right away so a forced command that reads input (such as internal-sftp) exits instead of waiting for the timeout.
					stream.end();
				});
			} catch {
				finish(undefined);
			}
		});
	}

	/**
	 * The number of hard links to a remote file, or undefined when the server cannot tell: it does not
	 * run commands or does not answer like a POSIX server. A count is kept for a short while, and
	 * a server that cannot tell is not asked again until the connection is replaced.
	 */
	async linkCount(id: string, path: string): Promise<number | undefined> {
		await this.sftp(id);
		return this.active.get(id)?.links.count(path);
	}

	/** Forgets the link counts of a path and everything below it, or of the whole server when no path is given, after the files there changed. */
	invalidateLinkCounts(id: string, path?: string): void {
		const links = this.active.get(id)?.links;
		if (path === undefined) {
			links?.clear();
		} else {
			links?.invalidate(path);
		}
	}

	/**
	 * Connects with a credential the user just typed. It reaches SecretStorage only after the server
	 * accepts it, so a wrong password is never saved.
	 */
	async connectWithCredential(id: string, credential: string): Promise<void> {
		this.reconnect(id);
		this.candidates.set(id, credential);
		try {
			await this.sftp(id);
		} finally {
			this.candidates.delete(id);
		}
	}

	reconnect(id: string): void {
		const pending = this.pending.get(id);
		this.pending.delete(id);
		pending?.controller.abort(new Error(l10n.t('SSH connection attempt cancelled.')));
		pending?.client.destroy();
		const active = this.active.get(id);
		this.active.delete(id);
		active?.client.destroy();
		this.changed(id);
	}

	dispose(): void {
		this.disposed = true;
		for (const id of new Set([...this.active.keys(), ...this.pending.keys()])) {
			this.reconnect(id);
		}
		this.stateEmitter.dispose();
		this.failureEmitter.dispose();
	}

	private async connect(profile: RemoteProfile, client: SshClient, signal: AbortSignal): Promise<Connection> {
		// Where the credential in use came from, so only a failing saved one is cleared and only an accepted typed one is saved.
		let credential: string | undefined;
		let credentialSource: 'saved' | 'typed' | undefined;
		// The handshake limit stops running while the user answers the host key prompt.
		let timeout: PausableTimeout | undefined;
		try {
			signal.throwIfAborted();
			const endpoint = `${profile.host}:${profile.port}`;
			const trustedKeys = this.context.globalState.get<Record<string, string>>(trustedKeysKey, {});
			const config: ConnectConfig = {
				host: profile.host,
				port: profile.port,
				username: profile.username,
				readyTimeout: 0,
				keepaliveInterval: 10_000,
				keepaliveCountMax: 3,
				hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
					if (signal.aborted) {
						verify(false);
						return;
					}
					const fingerprint = createHash('sha256').update(key).digest('base64');
					if (trustedKeys[endpoint] === fingerprint) {
						verify(true);
						return;
					}
					timeout?.pause();
					void window.showWarningMessage(
						trustedKeys[endpoint]
							? l10n.t('The SSH host key for {0} has changed. New SHA256 fingerprint: {1}. Only trust it if you verified this change.', endpoint, fingerprint)
							: l10n.t('Trust SSH host {0}? SHA256 fingerprint: {1}', endpoint, fingerprint),
						{ modal: true }, l10n.t('Trust Once'), l10n.t('Trust and Remember')
					).then(async choice => {
						timeout?.resume();
						try {
							signal.throwIfAborted();
							if (choice === l10n.t('Trust and Remember')) {
								await this.context.globalState.update(trustedKeysKey, { ...this.context.globalState.get<Record<string, string>>(trustedKeysKey, {}), [endpoint]: fingerprint });
							}
							verify(!signal.aborted && (choice === l10n.t('Trust Once') || choice === l10n.t('Trust and Remember')));
						} catch {
							verify(false);
						}
					}, () => {
						timeout?.resume();
						verify(false);
					});
				}
			};
			credential = this.candidates.get(profile.id);
			credentialSource = credential === undefined ? undefined : 'typed';
			if (credential === undefined) {
				credential = await this.context.secrets.get(`jcodeSftp.credential.${profile.id}`);
				credentialSource = credential === undefined ? undefined : 'saved';
			}
			signal.throwIfAborted();
			if (profile.authentication === 'password') {
				if (!credential) {
					throw new CredentialError(l10n.t('No password is saved for {0}. Enter it to connect.', endpoint), false);
				}
				config.password = credential;
			} else if (profile.authentication === 'privateKey') {
				if (!profile.privateKeyPath) {
					throw new Error(l10n.t('No private key configured for {0}.', endpoint));
				}
				const keyPath = /^~[/\\]/.test(profile.privateKeyPath) ? join(homedir(), profile.privateKeyPath.slice(2)) : profile.privateKeyPath;
				config.privateKey = await readFile(keyPath);
				signal.throwIfAborted();
				if (credential) {
					config.passphrase = credential;
				}
			} else {
				if (!process.env.SSH_AUTH_SOCK) {
					throw new Error(l10n.t('SSH_AUTH_SOCK is not set. Start an SSH agent or choose another authentication method.'));
				}
				config.agent = process.env.SSH_AUTH_SOCK;
			}

			let cancel: (() => void) | undefined;
			let closed = false;
			const connection = await new Promise<Connection>((resolve, reject) => {
				let settled = false;
				cancel = () => reject(signal.reason);
				signal.addEventListener('abort', cancel, { once: true });
				timeout = new PausableTimeout(20_000, () => reject(new Error(l10n.t('Timed out while connecting to {0}.', endpoint))));
				timeout.start();
				const invalidate = () => {
					closed = true;
					if (this.active.get(profile.id)?.client === client) {
						this.active.delete(profile.id);
						client.destroy();
						this.changed(profile.id);
					}
				};
				client.once('ready', () => {
					timeout?.dispose();
					if (signal.aborted) { return; }
					client.sftp((error, sftp) => {
						if (signal.aborted) {
							reject(signal.reason);
						} else if (error) {
							reject(error);
						} else {
							sftp.once('close', invalidate);
							settled = true;
							resolve({ client, sftp, links: new LinkCounter(command => this.execute(client, command), failure => this.log?.info(this.describeLinkFailure(endpoint, failure))) });
						}
					});
				});
				client.on('error', error => {
					if (!settled) {
						reject(error);
					} else {
						invalidate();
					}
				});
				client.once('close', () => {
					if (!settled) {
						reject(new Error(l10n.t('SSH connection to {0} closed.', endpoint)));
					}
					invalidate();
				});
				try {
					client.connect(config);
				} catch (error) {
					reject(error);
				}
			}).finally(() => {
				timeout?.dispose();
				if (cancel) { signal.removeEventListener('abort', cancel); }
			});
			signal.throwIfAborted();
			if (closed) {
				throw new Error(l10n.t('SSH connection to {0} closed.', endpoint));
			}
			if (credentialSource === 'typed') {
				await this.context.secrets.store(`jcodeSftp.credential.${profile.id}`, credential!);
				signal.throwIfAborted();
			}
			this.active.set(profile.id, connection);
			this.connected.add(profile.id);
			this.backoff.reset(profile.id);
			return connection;
		} catch (error) {
			timeout?.dispose();
			client.destroy();
			throw await this.interpretFailure(profile, error, credentialSource, signal);
		}
	}

	/** Turns authentication failures the user can fix into {@link CredentialError}, clearing a saved credential the server refused. */
	private async interpretFailure(profile: RemoteProfile, error: Error & ClientErrorExtensions, source: 'saved' | 'typed' | undefined, signal: AbortSignal): Promise<Error> {
		if (signal.aborted || !(error instanceof Error) || error instanceof CredentialError) {
			return error;
		}
		const endpoint = `${profile.host}:${profile.port}`;
		const failure = classifyAuthFailure(profile.authentication, error, source !== undefined);
		if ((failure === 'password-rejected' || failure === 'passphrase-rejected') && source === 'saved') {
			await this.context.secrets.delete(`jcodeSftp.credential.${profile.id}`);
		}
		switch (failure) {
			case 'password-rejected':
				return new CredentialError(l10n.t('The password for {0} was not accepted.', endpoint), true, { cause: error });
			case 'passphrase-rejected':
				return new CredentialError(l10n.t('The private key passphrase for {0} was not accepted.', endpoint), true, { cause: error });
			case 'passphrase-missing':
				return new CredentialError(l10n.t('The private key for {0} is encrypted. Enter its passphrase to connect.', endpoint), false, { cause: error });
			case 'key-rejected':
				return new Error(l10n.t('{0} did not accept the private key.', endpoint), { cause: error });
			default:
				return error;
		}
	}
}
