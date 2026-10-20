/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';

/** A host to connect through on the way to a server, written like the host of an OpenSSH `ProxyJump`. */
export interface JumpHost {
	host: string;
	/** The port to connect to. Undefined means 22. */
	port?: number;
	/** The user to sign in as. Undefined means the user of the connection. */
	username?: string;
}

/** The most jump hosts one connection goes through. */
const maxJumpHosts = 8;

function invalidJumpHost(text: string): Error {
	return new Error(l10n.t('"{0}" is not a valid jump host. Use [user@]host[:port].', text));
}

/** Reads one `[user@]host[:port]` (or `ssh://[user@]host[:port]`) the way OpenSSH does. IPv6 addresses go in square brackets. */
function parseJumpHost(text: string): JumpHost {
	let rest = text.replace(/^ssh:\/\//i, '').replace(/\/+$/, '');
	// The user is everything before the last @, so it can contain one.
	const at = rest.lastIndexOf('@');
	const username = at >= 0 ? rest.slice(0, at) : undefined;
	rest = rest.slice(at + 1);
	if (username !== undefined && !/^\S+$/.test(username)) {
		throw invalidJumpHost(text);
	}
	let host: string;
	let port: string | undefined;
	if (rest.startsWith('[')) {
		const end = rest.indexOf(']');
		const after = end < 0 ? '' : rest.slice(end + 1);
		if (end < 0 || (after && !after.startsWith(':')) || !/^[0-9A-Za-z:.%_-]*:[0-9A-Za-z:.%_-]*$/.test(rest.slice(1, end))) {
			throw invalidJumpHost(text);
		}
		host = rest.slice(1, end);
		port = after ? after.slice(1) : undefined;
	} else {
		const parts = rest.split(':');
		if (parts.length > 2 || !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(parts[0])) {
			throw invalidJumpHost(text);
		}
		[host, port] = parts;
	}
	if (port === undefined) {
		return { host, username };
	}
	if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
		throw new Error(l10n.t('"{0}" does not have a valid port. Use a number from 1 to 65535.', text));
	}
	return { host, port: Number(port), username };
}

/**
 * Reads a list of jump hosts like OpenSSH reads `ProxyJump`: `[user@]host[:port]`, separated by commas.
 * An empty list or `none` means no jump hosts. Throws an error that says what is wrong.
 */
export function parseJumpHosts(value: string): JumpHost[] {
	const trimmed = value.trim();
	if (!trimmed || trimmed.toLowerCase() === 'none') {
		return [];
	}
	const parts = trimmed.split(',').map(part => part.trim());
	if (parts.length > maxJumpHosts) {
		throw new Error(l10n.t('Use at most {0} jump hosts.', maxJumpHosts));
	}
	return parts.map(parseJumpHost);
}

/** Writes jump hosts in the form {@link parseJumpHosts} reads, leaving out the default port. */
export function formatJumpHosts(hosts: readonly JumpHost[]): string {
	return hosts.map(({ host, port, username }) => `${username === undefined ? '' : `${username}@`}${host.includes(':') ? `[${host}]` : host}${port === undefined || port === 22 ? '' : `:${port}`}`).join(',');
}
