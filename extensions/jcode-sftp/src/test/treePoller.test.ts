/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { posix } from 'node:path';
import { describe, test } from 'node:test';
import { FileChangeType, FileType } from 'vscode';
import { TreePoller, type PollChange, type PollLimits, type PollSource, type SnapshotEntry } from '../treePoller';

/** An in-memory remote tree that records which folders were listed. */
class FakeRemote implements PollSource {
	readonly entries = new Map<string, SnapshotEntry>();
	listed: string[] = [];

	constructor(paths: readonly string[]) {
		for (const path of paths) {
			this.set(path);
		}
	}

	/** Adds or updates an entry; a trailing slash makes it a folder. */
	set(path: string, mtime = 1): void {
		const directory = path.endsWith('/');
		this.entries.set(directory ? path.slice(0, -1) : path, { type: directory ? FileType.Directory : FileType.File, mtime, size: 1 });
	}

	remove(path: string): void {
		for (const entry of [...this.entries.keys()]) {
			if (entry === path || entry.startsWith(`${path}/`)) {
				this.entries.delete(entry);
			}
		}
	}

	async stat(path: string): Promise<SnapshotEntry | undefined> {
		return this.entries.get(path);
	}

	async list(path: string, include: (path: string) => boolean): Promise<Map<string, SnapshotEntry> | undefined> {
		this.listed.push(path);
		return new Map([...this.entries].filter(([entry]) => posix.dirname(entry) === path && entry !== path && include(entry)));
	}

	/** Runs a step and returns the folders it listed along with what it reported. */
	async stepWith(poller: TreePoller, limits: PollLimits): Promise<{ listed: string[]; changes: string[]; limited: string[] }> {
		this.listed = [];
		const result = await poller.step(this, limits);
		return { listed: this.listed, changes: summarize(result.changes), limited: result.limited };
	}
}

const roomy: PollLimits = { maxEntries: 5000, entriesPerStep: 5000 };

function summarize(changes: readonly PollChange[]): string[] {
	return changes.map(({ type, path }) => `${FileChangeType[type]} ${path}`).sort();
}

describe('TreePoller', () => {
	test('reports changes only once the first sweep has recorded a baseline', async () => {
		const remote = new FakeRemote(['/w/', '/w/a.txt', '/w/src/', '/w/src/b.txt']);
		const poller = new TreePoller('/w', true, () => false);
		const baseline = await remote.stepWith(poller, roomy);
		remote.set('/w/a.txt', 2);
		remote.set('/w/src/c.txt');
		remote.remove('/w/src/b.txt');
		const next = await remote.stepWith(poller, roomy);
		assert.deepStrictEqual({ baseline: baseline.changes, next: next.changes }, {
			baseline: [],
			next: ['Changed /w/a.txt', 'Created /w/src/c.txt', 'Deleted /w/src/b.txt']
		});
	});

	test('spreads a sweep over several steps and reports a change as soon as its folder is read', async () => {
		const remote = new FakeRemote(['/w/', '/w/a/', '/w/a/one.txt', '/w/b/', '/w/b/two.txt', '/w/c/', '/w/c/three.txt']);
		const poller = new TreePoller('/w', true, () => false);
		const limits: PollLimits = { maxEntries: 5000, entriesPerStep: 2 };
		const baseline = [await remote.stepWith(poller, limits), await remote.stepWith(poller, limits), await remote.stepWith(poller, limits)];
		remote.set('/w/a/one.txt', 2);
		remote.set('/w/c/three.txt', 2);
		const sweep = [await remote.stepWith(poller, limits), await remote.stepWith(poller, limits), await remote.stepWith(poller, limits)];
		assert.deepStrictEqual({ baseline, sweep }, {
			baseline: [
				{ listed: ['/w'], changes: [], limited: [] },
				{ listed: ['/w/a', '/w/b'], changes: [], limited: [] },
				{ listed: ['/w/c'], changes: [], limited: [] }
			],
			sweep: [
				{ listed: ['/w'], changes: [], limited: [] },
				{ listed: ['/w/a', '/w/b'], changes: ['Changed /w/a/one.txt'], limited: [] },
				{ listed: ['/w/c'], changes: ['Changed /w/c/three.txt'], limited: [] }
			]
		});
	});

	test('polls one folder for non-recursive watches and skips excluded folders', async () => {
		const remote = new FakeRemote(['/w/', '/w/a.txt', '/w/src/', '/w/src/b.txt', '/w/node_modules/', '/w/node_modules/x.js']);
		const shallow = new TreePoller('/w', false, () => false);
		const deep = new TreePoller('/w', true, path => path.includes('node_modules'));
		const baseline = { shallow: await remote.stepWith(shallow, roomy), deep: await remote.stepWith(deep, roomy) };
		remote.set('/w/src/c.txt');
		remote.set('/w/node_modules/y.js');
		remote.set('/w/d.txt');
		const next = { shallow: await remote.stepWith(shallow, roomy), deep: await remote.stepWith(deep, roomy) };
		assert.deepStrictEqual({ baseline, next }, {
			baseline: {
				shallow: { listed: ['/w'], changes: [], limited: [] },
				deep: { listed: ['/w', '/w/src'], changes: [], limited: [] }
			},
			next: {
				shallow: { listed: ['/w'], changes: ['Created /w/d.txt'], limited: [] },
				deep: { listed: ['/w', '/w/src'], changes: ['Created /w/d.txt', 'Created /w/src/c.txt'], limited: [] }
			}
		});
	});

	test('reports everything below a deleted folder and a vanished root', async () => {
		const remote = new FakeRemote(['/w/', '/w/gone/', '/w/gone/deep/', '/w/gone/deep/file.txt', '/w/keep.txt']);
		const poller = new TreePoller('/w', true, () => false);
		await poller.step(remote, roomy);
		remote.remove('/w/gone');
		const folder = (await remote.stepWith(poller, roomy)).changes;
		remote.remove('/w');
		const root = (await remote.stepWith(poller, roomy)).changes;
		assert.deepStrictEqual({ folder, root }, {
			folder: ['Deleted /w/gone', 'Deleted /w/gone/deep', 'Deleted /w/gone/deep/file.txt'],
			root: ['Deleted /w', 'Deleted /w/keep.txt']
		});
	});

	test('skips a folder over the entry limit and polls it again once the limit is raised', async () => {
		const remote = new FakeRemote(['/w/', '/w/small/', '/w/small/a.txt', '/w/big/', ...Array.from({ length: 10 }, (_, index) => `/w/big/f${index}.txt`)]);
		const poller = new TreePoller('/w', true, () => false);
		const tight: PollLimits = { maxEntries: 8, entriesPerStep: 5000 };
		const first = await remote.stepWith(poller, tight);
		const second = await remote.stepWith(poller, tight);
		const raised = await remote.stepWith(poller, { maxEntries: 100, entriesPerStep: 5000 });
		assert.deepStrictEqual({ first, second, raised }, {
			first: { listed: ['/w', '/w/small', '/w/big'], changes: [], limited: ['/w/big'] },
			second: { listed: ['/w', '/w/small'], changes: [], limited: [] },
			raised: {
				listed: ['/w', '/w/small', '/w/big'],
				changes: Array.from({ length: 10 }, (_, index) => `Created /w/big/f${index}.txt`),
				limited: []
			}
		});
	});
});
