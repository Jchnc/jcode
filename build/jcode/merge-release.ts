/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [directory] = process.argv.slice(2);
if (!directory) {
	throw new Error('Usage: node build/jcode/merge-release.ts <artifact-directory>');
}
const files = (await readdir(directory)).filter(file => /^jcode-update-.+\.json$/.test(file));
const entries: { platform: string; version: string; commit: string; asset: string }[] = await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8'))));
const expected = ['darwin', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64-user'];
if (entries.length !== expected.length || expected.some(platform => entries.filter(entry => entry.platform === platform).length !== 1) ||
	entries.some(entry => entry.commit !== entries[0].commit || entry.version !== entries[0].version || !/^[a-f0-9]{40}$/.test(entry.commit) || !/^\d+\.\d+\.\d+$/.test(entry.version))) {
	throw new Error('Expected matching Windows, macOS x64/ARM64 and Linux x64/ARM64 artifacts.');
}
const artifacts = await readdir(directory);
if (entries.some(entry => !artifacts.includes(entry.asset))) {
	throw new Error('A release artifact is missing.');
}
await writeFile(join(directory, 'jcode-update.json'), JSON.stringify(entries, null, '\t') + '\n');
