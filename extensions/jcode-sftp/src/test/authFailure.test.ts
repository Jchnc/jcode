/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { classifyAuthFailure } from '../authFailure';

describe('classifyAuthFailure', () => {
	const refused = { message: 'All configured authentication methods failed', level: 'client-authentication' };

	test('points at the credential only when the user can fix it by entering one', () => {
		assert.deepStrictEqual({
			password: classifyAuthFailure('password', refused, true),
			keyRefusedByServer: classifyAuthFailure('privateKey', refused, true),
			passphraseNeeded: classifyAuthFailure('privateKey', { message: 'Cannot parse privateKey: Encrypted OpenSSH private key detected, but no passphrase given' }, false),
			passphraseWrong: classifyAuthFailure('privateKey', { message: 'Cannot parse privateKey: OpenSSH key integrity check failed -- bad passphrase?' }, true),
			network: classifyAuthFailure('password', { message: 'connect ECONNREFUSED 10.0.0.1:22', level: 'client-socket' }, true),
			timeout: classifyAuthFailure('password', { message: 'Timed out while connecting to host:22.' }, true),
			agent: classifyAuthFailure('agent', refused, false)
		}, {
			password: 'password-rejected',
			keyRefusedByServer: 'key-rejected',
			passphraseNeeded: 'passphrase-missing',
			passphraseWrong: 'passphrase-rejected',
			network: 'other',
			timeout: 'other',
			agent: 'other'
		});
	});
});
