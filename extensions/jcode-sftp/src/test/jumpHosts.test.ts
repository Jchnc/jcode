/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import { formatJumpHosts, parseJumpHosts } from '../jumpHosts';

describe('parseJumpHosts', () => {
	test('reads user, host and port in any combination, as OpenSSH does', () => {
		assert.deepStrictEqual(parseJumpHosts('bastion, deploy@gateway.example.com:2222 ,ssh://ops@10.0.0.1:2200/,me@corp@jump,[::1]:2200,admin@[fe80::1]'), [
			{ host: 'bastion', username: undefined },
			{ host: 'gateway.example.com', port: 2222, username: 'deploy' },
			{ host: '10.0.0.1', port: 2200, username: 'ops' },
			{ host: 'jump', username: 'me@corp' },
			{ host: '::1', port: 2200, username: undefined },
			{ host: 'fe80::1', username: 'admin' }
		]);
	});

	test('reads nothing, and none, as no jump hosts', () => {
		assert.deepStrictEqual([parseJumpHosts(''), parseJumpHosts('   '), parseJumpHosts('none'), parseJumpHosts('NONE')], [[], [], [], []]);
	});

	test('says what is wrong with a jump host that cannot be read', () => {
		const message = (value: string): string => {
			try {
				parseJumpHosts(value);
			} catch (error) {
				return (error as Error).message;
			}
			return 'accepted';
		};
		const format = `is not a valid jump host. Use [user@]host[:port].`;
		const port = `does not have a valid port. Use a number from 1 to 65535.`;
		assert.deepStrictEqual(Object.fromEntries(['a,,b', 'bad host', '-flag', 'user@', '@host', 'host:abc', 'host:0', 'host:65536', 'a:b:c', '[::1', '[::1]x', '[host]', 'ho$t', 'a/b', 'a;b', 'ssh://', ',']
			.map(value => [value, message(value)])), {
			'a,,b': `"" ${format}`,
			'bad host': `"bad host" ${format}`,
			'-flag': `"-flag" ${format}`,
			'user@': `"user@" ${format}`,
			'@host': `"@host" ${format}`,
			'host:abc': `"host:abc" ${port}`,
			'host:0': `"host:0" ${port}`,
			'host:65536': `"host:65536" ${port}`,
			'a:b:c': `"a:b:c" ${format}`,
			'[::1': `"[::1" ${format}`,
			'[::1]x': `"[::1]x" ${format}`,
			'[host]': `"[host]" ${format}`,
			'ho$t': `"ho$t" ${format}`,
			'a/b': `"a/b" ${format}`,
			'a;b': `"a;b" ${format}`,
			'ssh://': `"ssh://" ${format}`,
			',': `"" ${format}`
		});
	});

	test('allows at most eight jump hosts', () => {
		const hosts = (count: number) => Array.from({ length: count }, (_, index) => `jump${index}`).join(',');
		assert.deepStrictEqual({ eight: parseJumpHosts(hosts(8)).length }, { eight: 8 });
		assert.throws(() => parseJumpHosts(hosts(9)), { message: 'Use at most 8 jump hosts.' });
	});
});

describe('formatJumpHosts', () => {
	test('writes jump hosts so that they read back the same, leaving out the default port', () => {
		const text = ' deploy@bastion:22 , gateway:2222,[::1]:2200,ops@[fe80::1] ';
		const formatted = formatJumpHosts(parseJumpHosts(text));
		assert.deepStrictEqual({ formatted, again: formatJumpHosts(parseJumpHosts(formatted)), none: formatJumpHosts([]) }, {
			formatted: 'deploy@bastion,gateway:2222,[::1]:2200,ops@[fe80::1]',
			again: 'deploy@bastion,gateway:2222,[::1]:2200,ops@[fe80::1]',
			none: ''
		});
	});
});
