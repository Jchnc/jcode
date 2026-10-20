/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A timeout that can be suspended while the user is being asked something, so the time spent
 * answering does not count against it. Pauses nest, and the clock restarts when all have ended.
 */
export class PausableTimeout {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private startedAt = 0;
	private pauses = 0;
	private finished = false;

	constructor(private remaining: number, private readonly onTimeout: () => void) { }

	start(): void {
		this.arm();
	}

	pause(): void {
		this.pauses++;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
			this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
		}
	}

	resume(): void {
		this.pauses = Math.max(0, this.pauses - 1);
		if (!this.pauses && !this.finished) {
			this.arm();
		}
	}

	dispose(): void {
		this.finished = true;
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private arm(): void {
		if (this.timer !== undefined || this.pauses || this.finished) {
			return;
		}
		this.startedAt = Date.now();
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.finished = true;
			this.onTimeout();
		}, this.remaining);
	}
}
