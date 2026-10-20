/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client, type ClientChannel, type ClientErrorExtensions, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import { ExtensionContext, l10n, window } from 'vscode';
import { classifyAuthFailure } from './authFailure';
import { PausableTimeout } from './pausableTimeout';

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

/** A password or passphrase is missing or was refused, so the user can fix it by entering one. */
export class CredentialError extends Error {
	constructor(message: string, readonly rejected: boolean, options?: ErrorOptions) {
		super(message, options);
		this.name = 'CredentialError';
	}
}

interface Connection {
	client: Client;
	sftp: SFTPWrapper;
	/** Set once the server refuses or ignores command execution so it is not retried. */
	execUnavailable?: boolean;
}

interface PendingConnection {
	client: Client;
	controller: AbortController;
	promise: Promise<Connection>;
}

const profilesKey = 'jcodeSftp.profiles';
const trustedKeysKey = 'jcodeSftp.trustedHostKeys';

export class SftpConnections {
	private readonly active = new Map<string, Connection>();
	private readonly pending = new Map<string, PendingConnection>();
	/** Credentials the user just typed, which are saved only once a server accepts them. */
	private readonly candidates = new Map<string, string>();
	private disposed = false;

	constructor(private readonly context: ExtensionContext) { }

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
		if (credential !== undefined) {
			await this.context.secrets.store(`jcodeSftp.credential.${profile.id}`, credential);
		} else if (previous?.authentication !== profile.authentication || profile.authentication === 'agent') {
			await this.context.secrets.delete(`jcodeSftp.credential.${profile.id}`);
		}
	}

	async deleteProfile(id: string): Promise<void> {
		this.reconnect(id);
		await this.context.globalState.update(profilesKey, this.profiles.filter(profile => profile.id !== id));
		await this.context.secrets.delete(`jcodeSftp.credential.${id}`);
	}

	async sftp(id: string): Promise<SFTPWrapper> {
		if (this.disposed) {
			throw new Error(l10n.t('SSH connections have been disposed.'));
		}
		const existing = this.active.get(id);
		if (existing) {
			return existing.sftp;
		}
		let pending = this.pending.get(id);
		if (!pending) {
			const profile = this.getProfile(id);
			const client = new Client();
			const controller = new AbortController();
			pending = { client, controller, promise: this.connect(profile, client, controller.signal) };
			this.pending.set(id, pending);
			const attempt = pending;
			void pending.promise.finally(() => {
				if (this.pending.get(id) === attempt) {
					this.pending.delete(id);
				}
			}).catch(() => undefined);
		}
		return (await pending.promise).sftp;
	}

	/**
	 * Runs a short command beside the SFTP session and resolves its output, or undefined when the
	 * server refuses it, it fails, or it takes longer than the timeout. Servers that do not allow
	 * command execution are remembered so later calls return immediately.
	 */
	async exec(id: string, command: string, timeout = 5000): Promise<string | undefined> {
		await this.sftp(id);
		const connection = this.active.get(id);
		if (!connection || connection.execUnavailable) {
			return undefined;
		}
		return new Promise<string | undefined>(resolve => {
			let output = '';
			let channel: ClientChannel | undefined;
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				connection.execUnavailable = true;
				channel?.close();
				resolve(undefined);
			}, timeout);
			const finish = (value: string | undefined) => {
				clearTimeout(timer);
				resolve(value);
			};
			try {
				connection.client.exec(command, (error, stream) => {
					if (error || timedOut) {
						connection.execUnavailable = true;
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
					stream.once('close', (code: number | null) => finish(code === 0 ? output : undefined));
					// Send EOF right away so a forced command that reads input (such as internal-sftp) exits instead of waiting for the timeout.
					stream.end();
				});
			} catch {
				finish(undefined);
			}
		});
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
	}

	dispose(): void {
		this.disposed = true;
		for (const id of new Set([...this.active.keys(), ...this.pending.keys()])) {
			this.reconnect(id);
		}
	}

	private async connect(profile: RemoteProfile, client: Client, signal: AbortSignal): Promise<Connection> {
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
							resolve({ client, sftp });
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
