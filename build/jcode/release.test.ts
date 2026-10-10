/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('metadata uses the installer target and rejects a mismatched build', async () => {
	const temporaryRoot = resolve(tmpdir());
	const directory = await mkdtemp(join(temporaryRoot, 'jcode-release-test-'));
	try {
		const app = join(directory, 'app');
		await mkdir(join(app, 'resources/app'), { recursive: true });
		const product = { commit: 'a'.repeat(40), quality: 'jcode' };
		await writeFile(join(app, 'resources/app/product.json'), JSON.stringify(product));
		await writeFile(join(app, 'resources/app/package.json'), JSON.stringify({ version: '1.142.0-jcode' }));
		const stagedProduct = join(directory, 'product.json');
		await writeFile(stagedProduct, JSON.stringify({ ...product, target: 'user' }));
		const installer = join(directory, 'setup.exe');
		await writeFile(installer, 'fixture installer');
		const output = join(directory, 'jcode-update.json');
		const args = [fileURLToPath(new URL('./release.ts', import.meta.url)), app, installer, output, stagedProduct];
		execFileSync(process.execPath, args);
		assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
			commit: product.commit, version: '1.142.0', quality: 'jcode', platform: 'win32-x64-user', asset: 'setup.exe',
			sha256hash: createHash('sha256').update('fixture installer').digest('hex')
		});
		await writeFile(stagedProduct, JSON.stringify({ ...product, target: 'user', commit: 'b'.repeat(40) }));
		assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }));
		for (const platform of ['linux-x64', 'linux-arm64', 'darwin', 'darwin-arm64']) {
			const resources = platform.startsWith('darwin') ? join(app, 'Contents/Resources/app') : join(app, 'resources/app');
			await mkdir(resources, { recursive: true });
			await writeFile(join(resources, 'product.json'), JSON.stringify(product));
			await writeFile(join(resources, 'package.json'), JSON.stringify({ version: '1.142.0-jcode' }));
			execFileSync(process.execPath, [args[0], app, installer, output, '-', platform]);
			assert.equal(JSON.parse(await readFile(output, 'utf8')).platform, platform);
		}
	} finally {
		assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
		await rm(directory, { recursive: true, force: true });
	}
});
