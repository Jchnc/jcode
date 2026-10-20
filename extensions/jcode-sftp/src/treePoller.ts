/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileChangeType, FileType } from 'vscode';

export interface SnapshotEntry {
	type: FileType;
	mtime: number;
	size: number;
}

/** Reads remote state for a poller. Implementations may share work between pollers. */
export interface PollSource {
	/** Resolves the entry at a path, or undefined when it does not exist. */
	stat(path: string): Promise<SnapshotEntry | undefined>;
	/**
	 * Lists the included children of a directory keyed by their full path. A missing directory lists
	 * as empty, and undefined means it cannot be read, so its last known state is kept.
	 */
	list(path: string, include: (path: string) => boolean): Promise<Map<string, SnapshotEntry> | undefined>;
}

export interface PollLimits {
	/** Most entries one watch request tracks. A directory that would exceed it is not polled. */
	maxEntries: number;
	/** Entries to read in one step before the sweep pauses until the next step. */
	entriesPerStep: number;
}

export interface PollChange {
	type: FileChangeType;
	path: string;
}

export interface PollResult {
	changes: PollChange[];
	/** Directories skipped in this step because they exceed {@link PollLimits.maxEntries}. */
	limited: string[];
}

/**
 * Detects changes below one watched path by sweeping it a bounded amount at a time. Each step reads
 * directories until the entry budget is spent and resumes where it stopped, so a large tree is
 * spread over several steps instead of being walked in one go. Changes are reported as soon as the
 * directory containing them has been read, after the first complete sweep has recorded a baseline.
 */
export class TreePoller {
	private readonly entries = new Map<string, SnapshotEntry>();
	private readonly children = new Map<string, Set<string>>();
	private readonly oversized = new Set<string>();
	private pending: string[] | undefined;
	private baselined = false;
	private maxEntries = 0;

	constructor(private readonly root: string, private readonly recursive: boolean, private readonly excluded: (path: string) => boolean) { }

	async step(source: PollSource, limits: PollLimits): Promise<PollResult> {
		if (limits.maxEntries !== this.maxEntries) {
			// A new limit deserves a fresh look at the directories that exceeded the old one.
			this.maxEntries = limits.maxEntries;
			this.oversized.clear();
		}
		const report = this.baselined;
		const changes: PollChange[] = [];
		const limited: string[] = [];
		const pending = this.pending ?? await this.begin(source, changes);
		this.pending = pending;
		for (let budget = limits.entriesPerStep; pending.length && budget > 0;) {
			const directory = pending.shift()!;
			try {
				budget -= await this.scan(directory, pending, source, changes, limited);
			} catch (error) {
				// Keep the directory in the sweep so the next step retries it.
				pending.unshift(directory);
				throw error;
			}
		}
		if (!pending.length) {
			this.pending = undefined;
			this.baselined = true;
		}
		return { changes: report ? changes : [], limited };
	}

	/** Refreshes the watched path itself and returns the directories a sweep still has to read. */
	private async begin(source: PollSource, changes: PollChange[]): Promise<string[]> {
		const root = this.excluded(this.root) ? undefined : await source.stat(this.root);
		if (!root) {
			this.forget(this.root, changes, true);
			return [];
		}
		this.record(this.root, root, changes);
		return (root.type & FileType.Directory) ? [this.root] : [];
	}

	/** Compares one directory with its last known children and returns how many entries were read. */
	private async scan(directory: string, pending: string[], source: PollSource, changes: PollChange[], limited: string[]): Promise<number> {
		if (this.oversized.has(directory)) {
			return 0;
		}
		const current = await source.list(directory, path => !this.excluded(path));
		if (!current) {
			return 0;
		}
		const known = this.children.get(directory) ?? new Set<string>();
		let projected = this.entries.size;
		for (const path of current.keys()) {
			projected += known.has(path) ? 0 : 1;
		}
		for (const path of known) {
			projected -= current.has(path) ? 0 : 1;
		}
		if (projected > this.maxEntries) {
			this.oversized.add(directory);
			limited.push(directory);
			return current.size;
		}
		for (const path of known) {
			if (!current.has(path)) {
				this.forget(path, changes, true);
			}
		}
		for (const [path, entry] of current) {
			this.record(path, entry, changes);
			// Linked directories are watched directly rather than followed, which avoids cycles.
			if (this.recursive && entry.type === FileType.Directory) {
				pending.push(path);
			}
		}
		this.children.set(directory, new Set(current.keys()));
		return current.size;
	}

	private record(path: string, entry: SnapshotEntry, changes: PollChange[]): void {
		const before = this.entries.get(path);
		if (!before) {
			changes.push({ type: FileChangeType.Created, path });
		} else if (before.type !== entry.type) {
			this.forget(path, changes, false);
			changes.push({ type: FileChangeType.Created, path });
		} else if (before.mtime !== entry.mtime || before.size !== entry.size) {
			changes.push({ type: FileChangeType.Changed, path });
		}
		this.entries.set(path, entry);
	}

	/** Drops a path and everything known below it, reporting each as deleted. */
	private forget(path: string, changes: PollChange[], includeSelf: boolean): void {
		if (this.entries.has(path) && includeSelf) {
			changes.push({ type: FileChangeType.Deleted, path });
		}
		this.entries.delete(path);
		for (const child of this.children.get(path) ?? []) {
			this.forget(child, changes, true);
		}
		this.children.delete(path);
		this.oversized.delete(path);
	}
}
