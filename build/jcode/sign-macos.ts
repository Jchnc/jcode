/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sign } from '@electron/osx-sign';
import { readFile } from 'node:fs/promises';
import { getEntitlementsForFile } from '../darwin/sign.ts';

const [app] = process.argv.slice(2);
const identity = process.env['CODESIGN_IDENTITY'];
const keychain = process.env['JCODE_KEYCHAIN'];
if (!app || !identity || (identity !== '-' && !keychain)) {
	throw new Error('Expected an app path, CODESIGN_IDENTITY and a keychain for Developer ID signing.');
}
const version = /^target="(.*)"$/m.exec(await readFile('.npmrc', 'utf8'))?.[1];
if (!version) {
	throw new Error('Cannot determine the Electron version.');
}
await sign({
	app,
	identity,
	identityValidation: identity !== '-',
	keychain,
	version,
	platform: 'darwin',
	preAutoEntitlements: false,
	preEmbedProvisioningProfile: false,
	optionsForFile: file => ({ hardenedRuntime: true, entitlements: getEntitlementsForFile(file) })
});
