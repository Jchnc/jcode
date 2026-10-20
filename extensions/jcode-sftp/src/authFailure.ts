/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RemoteProfile } from './connection';

export type AuthFailure = 'password-rejected' | 'passphrase-missing' | 'passphrase-rejected' | 'key-rejected' | 'other';

/**
 * Tells apart failures the user can fix by entering a credential from everything else. A server
 * refusing a key says nothing about the passphrase, so only failures to unlock the key point at it.
 */
export function classifyAuthFailure(authentication: RemoteProfile['authentication'], error: { message: string; level?: string }, hadCredential: boolean): AuthFailure {
	if (authentication === 'password' && error.level === 'client-authentication') {
		return 'password-rejected';
	}
	if (authentication === 'privateKey') {
		if (/passphrase/i.test(error.message)) {
			return hadCredential ? 'passphrase-rejected' : 'passphrase-missing';
		}
		if (error.level === 'client-authentication') {
			return 'key-rejected';
		}
	}
	return 'other';
}
