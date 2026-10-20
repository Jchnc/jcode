/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import type { RemoteProfile } from './connection';
import { formatJumpHosts, parseJumpHosts } from './jumpHosts';

/** An error in one field of the form, which the form marks so the user sees where to look. */
export class FormFieldError extends Error {
	constructor(message: string, readonly field: 'proxyJump') {
		super(message);
	}
}

/** Reads the jump hosts the user typed, and writes them in a normalized form. Nothing typed, or `none`, means no jump hosts. */
function validateJumpHosts(value: unknown): string | undefined {
	const text = typeof value === 'string' ? value.trim() : '';
	try {
		return formatJumpHosts(parseJumpHosts(text)) || undefined;
	} catch (error) {
		throw new FormFieldError(error instanceof Error ? error.message : String(error), 'proxyJump');
	}
}

/** Checks what the connection form sent and builds the profile from it. Throws an error that says what to fix. */
export function validateProfile(value: unknown, id: string): RemoteProfile {
	if (!value || typeof value !== 'object') {
		throw new Error(l10n.t('Enter the connection details.'));
	}
	const input = value as Record<string, unknown>;
	const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
	const host = typeof input.host === 'string' ? input.host.trim() : '';
	const username = typeof input.username === 'string' ? input.username.trim() : '';
	const root = typeof input.root === 'string' ? input.root.trim() : '';
	const port = Number(input.port);
	const authentication = input.authentication;
	const privateKeyPath = typeof input.privateKeyPath === 'string' ? input.privateKeyPath.trim() : undefined;
	if (!host || !username || !root.startsWith('/') || !Number.isInteger(port) || port < 1 || port > 65535 ||
		(authentication !== 'password' && authentication !== 'privateKey' && authentication !== 'agent') ||
		(authentication === 'privateKey' && !privateKeyPath)) {
		throw new Error(l10n.t('Enter a host, user, valid port, absolute remote folder, and private key path when required.'));
	}
	return { id, name, host, port, username, root: root.replace(/\/+$/, '') || '/', authentication, privateKeyPath: authentication === 'privateKey' ? privateKeyPath : undefined, proxyJump: validateJumpHosts(input.proxyJump) };
}
