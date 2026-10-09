/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { suite, test } from 'node:test';
import { ensureCodiconFont } from '../codicons.ts';

const fontPath = 'vs/base/browser/ui/codicons/codicon/codicon.ttf';

suite('Codicon font recovery', () => {
	test('restores missing and outdated fonts without rewriting matching assets', async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-codicons-'));
		try {
			const installed = path.join(repoRoot, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');
			await fs.mkdir(path.dirname(installed), { recursive: true });
			await fs.writeFile(installed, 'installed font');
			await ensureCodiconFont(repoRoot);
			const destinations = ['src', 'out'].map(directory => path.join(repoRoot, directory, fontPath));
			assert.deepStrictEqual(await Promise.all(destinations.map(file => fs.readFile(file, 'utf8'))), ['installed font', 'installed font']);

			const timestamp = new Date('2020-01-01T00:00:00Z');
			await Promise.all(destinations.map(file => fs.utimes(file, timestamp, timestamp)));
			await ensureCodiconFont(repoRoot);
			assert.deepStrictEqual(await Promise.all(destinations.map(async file => (await fs.stat(file)).mtimeMs)), [timestamp.getTime(), timestamp.getTime()]);

			await fs.writeFile(installed, 'updated font');
			await fs.rm(destinations[0]);
			await ensureCodiconFont(repoRoot);
			assert.deepStrictEqual(await Promise.all(destinations.map(file => fs.readFile(file, 'utf8'))), ['updated font', 'updated font']);
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});

	test('reports missing dependencies instead of leaving stale fonts', async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-codicons-'));
		try {
			await assert.rejects(ensureCodiconFont(repoRoot), /Codicon font.*install-fast/);
		} finally {
			await fs.rm(repoRoot, { recursive: true, force: true });
		}
	});
});
