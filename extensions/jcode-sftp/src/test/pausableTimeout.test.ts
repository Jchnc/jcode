/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { PausableTimeout } from '../pausableTimeout';

describe('PausableTimeout', () => {
	beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
	afterEach(() => mock.timers.reset());

	test('does not count time spent paused', () => {
		let fired = 0;
		const timeout = new PausableTimeout(20_000, () => fired++);
		timeout.start();
		mock.timers.tick(15_000);
		timeout.pause();
		mock.timers.tick(120_000);
		const whilePaused = fired;
		timeout.resume();
		mock.timers.tick(4_999);
		const beforeDeadline = fired;
		mock.timers.tick(1);
		assert.deepStrictEqual({ whilePaused, beforeDeadline, afterDeadline: fired }, { whilePaused: 0, beforeDeadline: 0, afterDeadline: 1 });
	});

	test('keeps waiting until every nested pause has ended and stops when disposed', () => {
		let fired = 0;
		const timeout = new PausableTimeout(1_000, () => fired++);
		timeout.start();
		timeout.pause();
		timeout.pause();
		timeout.resume();
		mock.timers.tick(5_000);
		const nested = fired;
		timeout.resume();
		timeout.dispose();
		mock.timers.tick(5_000);
		assert.deepStrictEqual({ nested, afterDispose: fired }, { nested: 0, afterDispose: 0 });
	});
});
