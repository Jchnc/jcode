/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Read identity from the packaged app, not the checkout: this must describe the installer.
const [appDirectory, installer, output, installerProduct, platform = 'win32-x64-user'] = process.argv.slice(2);
if (!appDirectory || !installer || !output || !installerProduct) {
	throw new Error('Usage: node build/jcode/release.ts <app-directory> <asset> <output-json> <installer-product-json-or-dash> [platform]');
}
if (!['win32-x64-user', 'darwin', 'darwin-arm64', 'linux-x64', 'linux-arm64'].includes(platform)) {
	throw new Error('Unsupported release platform.');
}
const appResources = platform.startsWith('darwin') ? join(appDirectory, 'Contents/Resources/app') : join(appDirectory, 'resources/app');
// Inno Setup stages a separate product.json with the installation target added.
const appProduct = JSON.parse(await readFile(join(appResources, 'product.json'), 'utf8'));
const product = installerProduct === '-' ? appProduct : JSON.parse(await readFile(installerProduct, 'utf8'));
const pkg = JSON.parse(await readFile(join(appResources, 'package.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(product.commit) || (platform.startsWith('win32') && product.target !== 'user') || product.quality !== 'jcode' ||
	product.commit !== appProduct.commit || product.quality !== appProduct.quality) {
	throw new Error('Expected a packaged JCode user installer with a build commit.');
}
const version = pkg.version.replace(/-jcode$/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
	throw new Error('JCode releases require a numeric major.minor.patch version.');
}
await writeFile(output, JSON.stringify({
	commit: product.commit,
	version,
	quality: product.quality,
	platform,
	asset: basename(installer),
	sha256hash: createHash('sha256').update(await readFile(installer)).digest('hex')
}, null, '\t') + '\n');
