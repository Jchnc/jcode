/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { planOwnership } from '../saveStrategy';

describe('planOwnership', () => {
	test('only attempts to restore ownership where it can succeed', () => {
		const original = { uid: 1000, gid: 33 };
		assert.deepStrictEqual({
			unchanged: planOwnership({ uid: 1000, gid: 33 }, original),
			root: planOwnership({ uid: 0, gid: 0 }, original),
			sameUserOtherGroup: planOwnership({ uid: 1000, gid: 1000 }, original),
			otherUser: planOwnership({ uid: 1001, gid: 1001 }, original),
			unknownOwner: planOwnership({ uid: 1001, gid: 1001 }, {})
		}, {
			unchanged: { action: 'keep' },
			root: { action: 'restore', owner: original },
			sameUserOtherGroup: { action: 'restore', owner: original },
			otherUser: { action: 'unrestorable' },
			unknownOwner: { action: 'keep' }
		});
	});
});
