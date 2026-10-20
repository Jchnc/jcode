/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { planWorkspaceFolders } from '../workspacePlan';

describe('planWorkspaceFolders', () => {
	const target = { uri: 'jcode-sftp://prod/srv/app', name: 'Production', connection: 'prod' };
	const local = { uri: 'file:///c%3A/code/site', name: 'site' };

	test('never replaces folders without asking', () => {
		assert.deepStrictEqual({
			emptyWindow: planWorkspaceFolders([], target),
			alreadyOpen: planWorkspaceFolders([local, { ...target }], target),
			renamed: planWorkspaceFolders([local, { ...target, name: 'Old Name' }], target),
			rootChanged: planWorkspaceFolders([local, { uri: 'jcode-sftp://prod/srv/old', name: 'Production', connection: 'prod' }], target),
			otherFolders: planWorkspaceFolders([local, { uri: 'jcode-sftp://staging/srv/app', name: 'Staging', connection: 'staging' }], target)
		}, {
			emptyWindow: { action: 'open' },
			alreadyOpen: { action: 'none' },
			renamed: { action: 'update', index: 1 },
			rootChanged: { action: 'update', index: 1 },
			otherFolders: { action: 'ask' }
		});
	});
});
