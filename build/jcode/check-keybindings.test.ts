/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';

test('JCode shortcuts are free on Windows, Linux and macOS', () => {
	const result = spawnSync(process.execPath, [join(import.meta.dirname, 'check-keybindings.ts'), 'jcode'], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
