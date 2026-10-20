/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseWorkspaceColorInput } from '../../common/workspaceAppearance.js';

suite('Workspace appearance', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads typed and pasted hex colors', () => {
		assert.deepStrictEqual(['#3B82F6', '3b82f6', ' #3b82f6 ', '#ABC', 'abc'].map(parseWorkspaceColorInput), [
			'#3b82f6', '#3b82f6', '#3b82f6', '#aabbcc', '#aabbcc'
		]);
	});

	test('rejects incomplete, transparent and non-hex input', () => {
		assert.deepStrictEqual(['', '#', '#3b82f', '#3b82f6ff', '##3b82f6', '#ggg', 'blue', 'rgb(1, 2, 3)'].map(parseWorkspaceColorInput), [
			undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined
		]);
	});
});
