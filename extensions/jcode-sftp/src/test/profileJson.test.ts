/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import type { RemoteProfile } from '../connection';
import { exportEncryptedProfiles, exportProfiles, importProfiles, isEncryptedExport } from '../profileJson';

const profiles: RemoteProfile[] = [
	{ id: 'a', name: 'Production', host: 'prod.example.com', port: 22, username: 'deploy', root: '/srv/app', authentication: 'password' },
	{ id: 'b', name: 'Staging', host: 'staging.example.com', port: 2222, username: 'ci', root: '/var/www', authentication: 'privateKey', privateKeyPath: '~/.ssh/id_ed25519' },
	{ id: 'c', name: 'Bastion', host: 'bastion.example.com', port: 22, username: 'ops', root: '/', authentication: 'agent' }
];
const credentials = new Map([['a', 'p@ss w0rd'], ['b', 'key passphrase']]);

/** Imports an export and drops the ids, which are regenerated on import. */
async function restore(json: string, passphrase?: string): Promise<{ name?: string; host: string; authentication: string; credential?: string }[]> {
	return (await importProfiles(json, passphrase)).map(({ profile, credential }) => ({ name: profile.name, host: profile.host, authentication: profile.authentication, credential }));
}

describe('profile export', () => {
	test('encrypts credentials in the version 2 format the importer reads', async () => {
		const json = await exportEncryptedProfiles(profiles, credentials, 'correct horse');
		const restored = await restore(json, 'correct horse');
		await assert.rejects(() => importProfiles(json, 'wrong passphrase'));
		assert.deepStrictEqual({
			encrypted: isEncryptedExport(json),
			leaksPlain: ['p@ss w0rd', 'key passphrase', 'prod.example.com'].some(secret => json.includes(secret)),
			leaksBase64: [credentials.get('a')!, credentials.get('b')!].some(secret => json.includes(Buffer.from(secret).toString('base64'))),
			restored
		}, {
			encrypted: true,
			leaksPlain: false,
			leaksBase64: false,
			restored: [
				{ name: 'Production', host: 'prod.example.com', authentication: 'password', credential: 'p@ss w0rd' },
				{ name: 'Staging', host: 'staging.example.com', authentication: 'privateKey', credential: 'key passphrase' },
				{ name: 'Bastion', host: 'bastion.example.com', authentication: 'agent', credential: undefined }
			]
		});
	});

	test('rejects a tampered encrypted export and an empty passphrase', async () => {
		const json = JSON.parse(await exportEncryptedProfiles(profiles, credentials, 'correct horse')) as { data: string };
		const data = Buffer.from(json.data, 'base64');
		data[0] ^= 1;
		json.data = data.toString('base64');
		await assert.rejects(() => importProfiles(JSON.stringify(json), 'correct horse'));
		await assert.rejects(() => exportEncryptedProfiles(profiles, credentials, ''));
	});

	test('leaves secrets out unless they are passed, and only base64 encodes them otherwise', async () => {
		const without = exportProfiles(profiles, new Map());
		const included = exportProfiles(profiles, credentials);
		assert.deepStrictEqual({
			withoutCredentials: JSON.parse(without).connections.some((connection: { credential?: string }) => connection.credential !== undefined),
			restoredWithout: (await restore(without)).map(connection => connection.credential),
			includedBase64: JSON.parse(included).connections.map((connection: { credential?: string }) => connection.credential),
			restoredIncluded: (await restore(included)).map(connection => connection.credential)
		}, {
			withoutCredentials: false,
			restoredWithout: [undefined, undefined, undefined],
			includedBase64: [Buffer.from('p@ss w0rd').toString('base64'), Buffer.from('key passphrase').toString('base64'), undefined],
			restoredIncluded: ['p@ss w0rd', 'key passphrase', undefined]
		});
	});
});
