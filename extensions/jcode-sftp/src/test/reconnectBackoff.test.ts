/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert';
import { describe, test } from 'node:test';
import { backoffDelay, ReconnectBackoff } from '../reconnectBackoff';

const policy = { baseDelay: 10_000, maxDelay: 60_000 };

describe('backoffDelay', () => {
	test('doubles the ceiling with every failure up to the limit and randomizes the upper half', () => {
		const delays = (random: number) => [1, 2, 3, 4, 5, 20].map(failures => backoffDelay(failures, random, policy));
		assert.deepStrictEqual({ shortest: delays(0), longest: delays(0.999999), middle: delays(0.5) }, {
			shortest: [5000, 10000, 20000, 30000, 30000, 30000],
			longest: [10000, 20000, 40000, 60000, 60000, 60000],
			middle: [7500, 15000, 30000, 45000, 45000, 45000]
		});
	});
});

describe('ReconnectBackoff', () => {
	function create(): { backoff: ReconnectBackoff; advance(milliseconds: number): void } {
		let now = 1_000_000;
		return { backoff: new ReconnectBackoff(policy, () => now, () => 0.999999), advance: milliseconds => { now += milliseconds; } };
	}

	test('holds background attempts back until the delay has passed and lengthens it with each failure', () => {
		const { backoff, advance } = create();
		const states: object[] = [];
		const capture = () => states.push({ failures: backoff.failures('a'), remaining: backoff.remaining('a'), other: backoff.remaining('b') });
		capture();
		backoff.failed('a');
		capture();
		advance(10_000);
		capture();
		backoff.failed('a');
		capture();
		advance(20_000);
		capture();
		assert.deepStrictEqual(states, [
			{ failures: 0, remaining: 0, other: 0 },
			{ failures: 1, remaining: 10000, other: 0 },
			{ failures: 1, remaining: 0, other: 0 },
			{ failures: 2, remaining: 20000, other: 0 },
			{ failures: 2, remaining: 0, other: 0 }
		]);
	});

	test('starts over after a reset', () => {
		const { backoff } = create();
		backoff.failed('a');
		backoff.failed('a');
		backoff.failed('a');
		const before = { failures: backoff.failures('a'), retryAt: backoff.retryAt('a') };
		backoff.reset('a');
		backoff.failed('a');
		assert.deepStrictEqual({ before, after: { failures: backoff.failures('a'), remaining: backoff.remaining('a') } }, {
			before: { failures: 3, retryAt: 1_040_000 },
			after: { failures: 1, remaining: 10000 }
		});
	});
});
