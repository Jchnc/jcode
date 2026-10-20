/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { linkCountCommand, parseLinkCount } from './saveStrategy';

/** How a command run beside the SFTP session ended. */
export interface ExecResult {
	output: string;
	/** The exit code, or null when the command was ended by a signal. */
	code: number | null;
}

/** Why link counts can no longer be read from a server. */
export type LinkCountFailure = 'refused' | 'unexpected-result';

const defaultLifetime = 15_000;
const maxEntries = 200;

/**
 * Reads the hard link count of remote files, which SFTP does not report, by running `stat` beside
 * the SFTP session. Saves ask for it every time, so a count is kept for a short while. Once the
 * server refuses to run the command, or answers like a server that is not POSIX (a Windows
 * OpenSSH server running `cmd.exe` exits cleanly without printing a count), asking again cannot
 * help, so it stops for the rest of the connection and callers fall back to assuming a single link.
 */
export class LinkCounter {
	private readonly counts = new Map<string, { count: number; expiresAt: number }>();
	private available = true;
	/** Set once the server printed a count, which shows it runs a POSIX `stat`. */
	private posix = false;

	/**
	 * @param run Runs a shell command and resolves how it ended, or undefined when the server did not run it.
	 * @param onUnavailable Called once, when link counts stop being read.
	 */
	constructor(
		private readonly run: (command: string) => Promise<ExecResult | undefined>,
		private readonly onUnavailable: (failure: LinkCountFailure) => void = () => undefined,
		private readonly now: () => number = Date.now,
		private readonly lifetime = defaultLifetime
	) { }

	/** The number of hard links to the file, or undefined when the server cannot tell. */
	async count(path: string): Promise<number | undefined> {
		if (!this.available) {
			return undefined;
		}
		const known = this.counts.get(path);
		if (known && known.expiresAt > this.now()) {
			return known.count;
		}
		const result = await this.run(linkCountCommand(path));
		const count = result?.code === 0 ? parseLinkCount(result.output) : undefined;
		if (count === undefined) {
			// On a server that already printed counts, a failing `stat` concerns this file only (another client may have just removed it).
			if (!(this.posix && result && result.code !== 0)) {
				this.stop(result ? 'unexpected-result' : 'refused');
			}
			return undefined;
		}
		this.posix = true;
		this.remember(path, count);
		return count;
	}

	/** Forgets the count of a path and of everything below it, because the files there changed. */
	invalidate(path: string): void {
		const prefix = path.endsWith('/') ? path : `${path}/`;
		for (const known of [...this.counts.keys()]) {
			if (known === path || known.startsWith(prefix)) {
				this.counts.delete(known);
			}
		}
	}

	/** Forgets every count. */
	clear(): void {
		this.counts.clear();
	}

	private remember(path: string, count: number): void {
		const now = this.now();
		for (const [known, entry] of this.counts) {
			if (entry.expiresAt <= now) {
				this.counts.delete(known);
			}
		}
		if (this.counts.size >= maxEntries) {
			// Entries are kept in the order they were added, so the first one is the oldest.
			this.counts.delete(this.counts.keys().next().value!);
		}
		this.counts.delete(path);
		this.counts.set(path, { count, expiresAt: now + this.lifetime });
	}

	private stop(failure: LinkCountFailure): void {
		this.available = false;
		this.counts.clear();
		this.onUnavailable(failure);
	}
}
