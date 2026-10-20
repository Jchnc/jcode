/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** How long background work waits between connection attempts after failures. */
export interface BackoffPolicy {
	/** The longest wait after the first failure, in milliseconds. It doubles with every further failure. */
	readonly baseDelay: number;
	/** The longest wait of all, in milliseconds. */
	readonly maxDelay: number;
}

export const defaultBackoffPolicy: BackoffPolicy = { baseDelay: 10_000, maxDelay: 5 * 60_000 };

/**
 * The wait before the next background attempt after a number of consecutive failures. The ceiling
 * doubles with each failure up to the policy limit, and the wait is somewhere between half of it and
 * all of it, so clients that lost the same server do not all come back at the same moment.
 *
 * @param random A number from 0 up to but not including 1, which positions the wait within its range.
 */
export function backoffDelay(failures: number, random: number, policy: BackoffPolicy = defaultBackoffPolicy): number {
	const ceiling = Math.min(policy.maxDelay, policy.baseDelay * 2 ** Math.max(0, failures - 1));
	return Math.round(ceiling / 2 + random * (ceiling / 2));
}

interface BackoffState {
	failures: number;
	retryAt: number;
}

/**
 * Remembers when background work may try each server again. A server that keeps failing is tried
 * less and less often, and any success or request from the user starts over.
 */
export class ReconnectBackoff {
	private readonly states = new Map<string, BackoffState>();

	constructor(
		private readonly policy: BackoffPolicy = defaultBackoffPolicy,
		private readonly now: () => number = Date.now,
		private readonly random: () => number = Math.random
	) { }

	/** Records a failed attempt and returns when background work may try again. */
	failed(id: string): number {
		const failures = (this.states.get(id)?.failures ?? 0) + 1;
		const retryAt = this.now() + backoffDelay(failures, this.random(), this.policy);
		this.states.set(id, { failures, retryAt });
		return retryAt;
	}

	/** Forgets earlier failures, so the next background attempt is not delayed. */
	reset(id: string): void {
		this.states.delete(id);
	}

	/** How many attempts in a row failed. */
	failures(id: string): number {
		return this.states.get(id)?.failures ?? 0;
	}

	/** When background work may try again, or undefined when the last attempt did not fail. */
	retryAt(id: string): number | undefined {
		return this.states.get(id)?.retryAt;
	}

	/** Milliseconds until background work may try again: zero when it may do so now. */
	remaining(id: string): number {
		return Math.max(0, (this.states.get(id)?.retryAt ?? 0) - this.now());
	}
}
