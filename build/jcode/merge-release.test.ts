/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('assemble all platforms and reject incomplete or inconsistent releases', async () => {
	const temporaryRoot = resolve(tmpdir());
	const directory = await mkdtemp(join(temporaryRoot, 'jcode-merge-test-'));
	try {
		const entries = ['win32-x64-user', 'darwin', 'darwin-arm64', 'linux-x64', 'linux-arm64'].map(platform => ({
			platform, commit: 'a'.repeat(40), version: '1.142.0', quality: 'jcode', sha256hash: 'a'.repeat(64), asset: `${platform}.zip`
		}));
		const args = [fileURLToPath(new URL('./merge-release.ts', import.meta.url)), directory];
		for (const entry of entries) {
			await writeFile(join(directory, `jcode-update-${entry.platform}.json`), JSON.stringify(entry));
			await writeFile(join(directory, entry.asset), 'fixture asset');
		}
		execFileSync(process.execPath, args);
		const manifest = JSON.parse(await readFile(join(directory, 'jcode-update.json'), 'utf8')) as typeof entries;
		assert.deepEqual(manifest.sort((a, b) => a.platform.localeCompare(b.platform)), entries.sort((a, b) => a.platform.localeCompare(b.platform)));
		const metadataPath = join(directory, `jcode-update-${entries[0].platform}.json`);
		await writeFile(metadataPath, JSON.stringify({ ...entries[0], commit: 'b'.repeat(40) }));
		assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }));
		await rm(metadataPath);
		assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }));
	} finally {
		assert.ok(resolve(directory).startsWith(temporaryRoot + sep));
		await rm(directory, { recursive: true, force: true });
	}
});
