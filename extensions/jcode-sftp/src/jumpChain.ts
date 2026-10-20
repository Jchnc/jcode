/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Duplex } from 'node:stream';
import type { ConnectConfig } from 'ssh2';
import { l10n } from 'vscode';
import type { SshClient } from './connection';
import { PausableTimeout } from './pausableTimeout';

/** A jump host to pass through, with everything needed to connect to it. */
export interface JumpHop {
	host: string;
	port: number;
	username: string;
}

/** The address of a host as the user sees it and as trusted host keys are filed. */
export function hopEndpoint(host: { host: string; port: number }): string {
	return `${host.host}:${host.port}`;
}

/** A failure on the way through a jump host. It keeps the underlying error, so a refused password can be told from a network problem. */
export class JumpHopError extends Error {
	declare readonly cause: Error;

	constructor(readonly hop: JumpHop, message: string, cause: Error) {
		super(message, { cause });
		this.name = 'JumpHopError';
	}

	get endpoint(): string {
		return hopEndpoint(this.hop);
	}
}

/** Wraps an error from connecting to a hop, naming the hop in its message. */
function connectFailure(hop: JumpHop, cause: Error): JumpHopError {
	return new JumpHopError(hop, l10n.t('Could not connect through jump host {0}: {1}', hopEndpoint(hop), cause.message), cause);
}

export interface JumpChainOptions {
	/** The jump hosts to pass through, in order. */
	hops: readonly JumpHop[];
	/** Where the last jump host opens its connection to. */
	target: { host: string; port: number };
	/** Creates the SSH client for one hop. */
	createClient(): SshClient;
	/**
	 * Provides the credentials and host key check for connecting to a hop. A check that has to ask the
	 * user pauses the handshake limit while it waits.
	 */
	configure(hop: JumpHop, handshake: Pick<PausableTimeout, 'pause' | 'resume'>): ConnectConfig;
	/** Receives every client as soon as it exists, so the caller can close it if the attempt is abandoned. */
	register(client: SshClient): void;
	/** Cancels the attempt. */
	signal: AbortSignal;
	/** How long one hop may take to complete its handshake, in milliseconds. */
	handshakeLimit?: number;
}

/**
 * Connects to each jump host in turn, the first directly and every next one through a channel
 * that the previous host opens to it, and resolves the channel from the last host to the target.
 * Connect the server's own client over it by passing it as `sock`. Resolves undefined when there
 * are no jump hosts.
 *
 * Every client is handed to `register` as soon as it exists, and the caller closes them all when
 * this rejects, so nothing is left open by a hop that failed or by an attempt that was cancelled.
 */
export async function openJumpChain(options: JumpChainOptions): Promise<Duplex | undefined> {
	const { signal } = options;
	let onAbort = () => { };
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
	});
	aborted.catch(() => undefined);
	try {
		let channel: Duplex | undefined;
		for (const [index, hop] of options.hops.entries()) {
			signal.throwIfAborted();
			const client = options.createClient();
			options.register(client);
			// Whatever the hop is doing, it fails when the hop drops or the attempt is cancelled.
			const interruptions = [watchHop(client, hop), aborted];
			await connectHop(client, hop, channel, options, interruptions);
			channel = await Promise.race([openChannel(client, hop, options.hops[index + 1] ?? options.target), ...interruptions]);
		}
		return channel;
	} finally {
		signal.removeEventListener('abort', onAbort);
	}
}

/** Rejects when the client of a hop fails or closes, and never resolves. */
function watchHop(client: SshClient, hop: JumpHop): Promise<never> {
	const gone = new Promise<never>((_, reject) => {
		client.on('error', error => reject(connectFailure(hop, error)));
		client.once('close', () => reject(connectFailure(hop, new Error(l10n.t('The connection was closed.')))));
	});
	// Only the step that is running hears about it. A hop that drops later is noticed by the connection through it.
	gone.catch(() => undefined);
	return gone;
}

/** Connects the client of a hop, over the channel from the hop before it when there is one. Resolves when it is signed in. */
async function connectHop(client: SshClient, hop: JumpHop, channel: Duplex | undefined, options: JumpChainOptions, interruptions: readonly Promise<never>[]): Promise<void> {
	let handshake: PausableTimeout | undefined;
	try {
		await Promise.race([
			new Promise<void>((resolve, reject) => {
				handshake = new PausableTimeout(options.handshakeLimit ?? 20_000, () => reject(connectFailure(hop, new Error(l10n.t('Timed out during the SSH handshake.')))));
				client.once('ready', resolve);
				handshake.start();
				try {
					client.connect({ ...options.configure(hop, handshake), host: hop.host, port: hop.port, username: hop.username, readyTimeout: 0, sock: channel });
				} catch (error) {
					reject(error);
				}
			}),
			...interruptions
		]);
	} finally {
		handshake?.dispose();
	}
}

/** Opens the channel through which a hop reaches the next host. */
function openChannel(client: SshClient, hop: JumpHop, next: { host: string; port: number }): Promise<Duplex> {
	return new Promise<Duplex>((resolve, reject) => {
		client.forwardOut('127.0.0.1', 0, next.host, next.port, (error, channel) => {
			if (error) {
				reject(new JumpHopError(hop, l10n.t('Jump host {0} could not open a connection to {1}: {2}', hopEndpoint(hop), hopEndpoint(next), error.message), error));
			} else {
				resolve(channel);
			}
		});
	});
}
