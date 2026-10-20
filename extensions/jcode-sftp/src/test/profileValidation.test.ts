/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import { FormFieldError, validateProfile } from '../profileValidation';

const form = { name: ' Production ', host: ' prod.example.com ', port: '2222', username: ' deploy ', root: '/srv/app/', authentication: 'password', privateKeyPath: '' };

describe('validateProfile', () => {
	test('cleans up what the form sent', () => {
		assert.deepStrictEqual(validateProfile(form, 'id'), {
			id: 'id', name: 'Production', host: 'prod.example.com', port: 2222, username: 'deploy', root: '/srv/app', authentication: 'password', privateKeyPath: undefined, proxyJump: undefined
		});
	});

	test('writes the jump hosts in a normalized form, and reads nothing or none as no jump hosts', () => {
		const jumps = (proxyJump: unknown) => validateProfile({ ...form, proxyJump }, 'id').proxyJump;
		assert.deepStrictEqual([jumps('  admin@bastion:22 ,  gateway:2200 '), jumps(''), jumps('none'), jumps(undefined)], ['admin@bastion,gateway:2200', undefined, undefined, undefined]);
	});

	test('points at the jump hosts field when they cannot be read', () => {
		for (const proxyJump of ['bad host', 'host:99999']) {
			assert.throws(() => validateProfile({ ...form, proxyJump }, 'id'), error => error instanceof FormFieldError && error.field === 'proxyJump');
		}
		assert.throws(() => validateProfile({ ...form, proxyJump: 'bad host' }, 'id'), { message: '"bad host" is not a valid jump host. Use [user@]host[:port].' });
	});

	test('still asks for the required details first', () => {
		assert.throws(() => validateProfile({ ...form, host: '', proxyJump: 'bad host' }, 'id'), error => !(error instanceof FormFieldError) && error instanceof Error);
	});
});
