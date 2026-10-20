/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { linkCountCommand, parseLinkCount, planOwnership, shellQuote } from '../saveStrategy';

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

describe('hard link detection', () => {
	test('quotes paths so they stay a single shell word', () => {
		assert.deepStrictEqual({
			plain: shellQuote('/var/www/index.php'),
			quote: shellQuote(`/srv/it's here`),
			metacharacters: shellQuote('/srv/a b; rm -rf $HOME')
		}, {
			plain: `'/var/www/index.php'`,
			quote: `'/srv/it'\\''s here'`,
			metacharacters: `'/srv/a b; rm -rf $HOME'`
		});
	});

	test('tries the GNU form of stat before the BSD form', () => {
		assert.strictEqual(linkCountCommand('/srv/a.txt'), `stat -c %h -- '/srv/a.txt' || stat -f %l -- '/srv/a.txt'`);
	});

	test('reads a link count only from a plain number', () => {
		assert.deepStrictEqual(
			[parseLinkCount('2\n'), parseLinkCount(' 1 '), parseLinkCount(''), parseLinkCount(undefined), parseLinkCount('stat: cannot stat'), parseLinkCount('2 3')],
			[2, 1, undefined, undefined, undefined, undefined]
		);
	});
});
