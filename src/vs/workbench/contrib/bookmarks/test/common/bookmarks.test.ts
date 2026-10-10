/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { captureBookmarkAnchor, findBookmarkLine } from '../../common/bookmarks.js';

suite('Code bookmarks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('relocates a bookmark using its source context', () => {
		const original = ['function save() {', '\tvalidate();', '\tcommit();', '}'];
		const anchor = captureBookmarkAnchor(original, 3);
		const changed = ['const ready = true;', '', ...original];

		assert.strictEqual(findBookmarkLine(changed, 3, anchor), 5);
	});

	test('uses neighboring lines to disambiguate repeated source text', () => {
		const lines = ['if (first) {', '\treturn value;', '}', 'if (second) {', '\treturn value;', '}'];
		const anchor = captureBookmarkAnchor(lines, 5);
		const changed = ['// inserted', ...lines];

		assert.strictEqual(findBookmarkLine(changed, 5, anchor), 6);
	});

	test('reports a bookmark as unresolved when its source text disappeared', () => {
		const anchor = captureBookmarkAnchor(['const previous = true;'], 1);
		assert.strictEqual(findBookmarkLine(['const replacement = true;'], 1, anchor), undefined);
	});
});
