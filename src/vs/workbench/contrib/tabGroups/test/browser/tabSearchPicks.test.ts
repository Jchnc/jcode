/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { createTabSearchPicks, ITabSearchEditor, ITabSearchGroup, ITabSearchSavedGroup, TabSearchPick } from '../../browser/tabSearchPicks.js';

suite('Tab Search Picks', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const buttons = { close: { iconClass: 'close' }, closeDirty: { iconClass: 'close-dirty' } };

	function createEntry(name: string, options: Partial<ITabSearchEditor<string>> = {}): ITabSearchEditor<string> {
		return {
			editor: `${name}`,
			name,
			description: undefined,
			resource: URI.file(`/work/${options.description ? `${options.description}/` : ''}${name}`),
			dirty: false,
			sticky: false,
			preview: false,
			current: false,
			tabGroup: undefined,
			iconUri: undefined,
			iconClasses: ['file-icon'],
			...options
		};
	}

	function createGroup(id: number, ...editors: ITabSearchEditor<string>[]): ITabSearchGroup<string> {
		return { id, label: `Group ${id}`, ariaLabel: `Editor Group ${id}`, editors };
	}

	function createSavedGroup(id: string, name: string, tabNames: string[], options: Partial<ITabSearchSavedGroup> = {}): ITabSearchSavedGroup {
		return { id, name, color: 'green', icon: undefined, tabCount: tabNames.length, tabNames, ...options };
	}

	const groups = [
		createGroup(1,
			createEntry('main.ts', { description: 'src', sticky: true, current: true }),
			createEntry('util.test.ts', { description: 'src/util', tabGroup: { name: 'Tests', color: 'red' } }),
			createEntry('notes.md', { description: 'docs', preview: true, dirty: true })),
		createGroup(2,
			createEntry('util.ts', { description: 'src/util', tabGroup: { name: 'Source', color: 'blue' } }),
			createEntry('$(star).md'))
	];

	function search(searchGroups: readonly ITabSearchGroup<string>[], savedGroups: readonly ITabSearchSavedGroup[], filter = '') {
		return createTabSearchPicks(searchGroups, savedGroups, filter, buttons);
	}

	/** What a list shows: the labels of the picks under their sections. */
	function outline(picks: ReadonlyArray<TabSearchPick<string> | IQuickPickSeparator>): string[] {
		return picks.map(pick => pick.type === 'separator' ? `-- ${pick.label}` : pick.label ?? '');
	}

	function iconFill(pick: IQuickPickItem): string | undefined {
		return pick.iconPath ? /fill="(?<color>[^"]+)"/.exec(decodeURIComponent(pick.iconPath.dark.toString()))?.groups?.color : undefined;
	}

	test('lists the tabs under a section for each editor group, followed by the saved tab groups', () => {
		const picks = search(groups, [createSavedGroup('saved-1', 'Docs', ['a.md', 'b.md'], { icon: 'book' })]);

		assert.deepStrictEqual(outline(picks), [
			'-- Group 1', 'main.ts $(pinned)', 'util.test.ts', 'notes.md',
			'-- Group 2', 'util.ts', '\\$(star).md',
			'-- Saved Tab Groups', '$(book) Docs'
		]);
	});

	test('shows the state, group and location of each tab', () => {
		const picks = search(groups, []).filter((pick): pick is TabSearchPick<string> => pick.type !== 'separator');

		assert.deepStrictEqual(picks.map(pick => ({
			label: pick.label,
			description: pick.description,
			ariaLabel: pick.ariaLabel,
			italic: pick.italic,
			buttons: pick.buttons?.map(button => button.iconClass),
			iconFill: iconFill(pick),
			iconClasses: pick.iconClasses
		})), [
			{ label: 'main.ts $(pinned)', description: 'src', ariaLabel: 'main.ts src, pinned, Editor Group 1', italic: false, buttons: ['close'], iconFill: 'transparent', iconClasses: ['file-icon'] },
			{ label: 'util.test.ts', description: 'Tests · src/util', ariaLabel: 'util.test.ts src/util, tab group Tests, Editor Group 1', italic: false, buttons: ['close'], iconFill: '#fb7185', iconClasses: ['file-icon'] },
			{ label: 'notes.md', description: 'docs', ariaLabel: 'notes.md docs, preview, unsaved changes, Editor Group 1', italic: true, buttons: ['close-dirty'], iconFill: 'transparent', iconClasses: ['file-icon'] },
			{ label: 'util.ts', description: 'Source · src/util', ariaLabel: 'util.ts src/util, tab group Source, Editor Group 2', italic: false, buttons: ['close'], iconFill: '#60a5fa', iconClasses: ['file-icon'] },
			{ label: '\\$(star).md', description: undefined, ariaLabel: '$(star).md, Editor Group 2', italic: false, buttons: ['close'], iconFill: 'transparent', iconClasses: ['file-icon'] }
		]);
	});

	test('does not reserve room for the color of a tab group when no tab is in one, and prefers the icon of an editor', () => {
		const picks = search([createGroup(1, createEntry('a.ts'), createEntry('b.ts', { iconUri: URI.file('/icons/b.svg') }))], []);

		assert.deepStrictEqual(picks.filter((pick): pick is TabSearchPick<string> => pick.type !== 'separator').map(pick => pick.iconPath?.dark.path), [undefined, '/icons/b.svg']);
	});

	test('leaves out the sections when there is only one editor group', () => {
		assert.deepStrictEqual(outline(search([createGroup(1, createEntry('a.ts'), createEntry('b.ts'))], [])), ['a.ts', 'b.ts']);
	});

	test('keeps the order of the editor groups and tab bars without a filter and the order given for saved tab groups', () => {
		const picks = search(groups, [createSavedGroup('newer', 'Newer', ['a.ts']), createSavedGroup('older', 'Older', ['b.ts'])]);

		assert.deepStrictEqual(picks.filter((pick): pick is TabSearchPick<string> => pick.type !== 'separator').map(pick => pick.kind === 'editor' ? `${pick.groupId}:${pick.editor}` : pick.kind === 'savedGroup' ? pick.savedGroupId : pick.kind), [
			'1:main.ts', '1:util.test.ts', '1:notes.md', '2:util.ts', '2:$(star).md', 'newer', 'older'
		]);
	});

	test('describes saved tab groups with their color, the number of tabs and some of their tab names', () => {
		const picks = search([], [
			createSavedGroup('one', 'Single', ['a.ts'], { color: 'blue', icon: 'rocket' }),
			createSavedGroup('many', 'Many $(star)', ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'], { color: '#ff8800', tabCount: 7 })
		]).filter((pick): pick is TabSearchPick<string> => pick.type !== 'separator');

		assert.deepStrictEqual(picks.map(pick => ({ label: pick.label, description: pick.description, ariaLabel: pick.ariaLabel, iconFill: iconFill(pick) })), [
			{ label: '$(rocket) Single', description: 'a.ts', ariaLabel: 'Single, 1 tab, Blue, saved tab group', iconFill: '#60a5fa' },
			{ label: 'Many \\$(star)', description: 'a.ts, b.ts, c.ts, d.ts, +2 more', ariaLabel: 'Many $(star), 7 tabs, #ff8800, saved tab group', iconFill: '#ff8800' }
		]);
	});

	test('searches by name, location, tab group and path and shows what matched', () => {
		const savedGroups = [createSavedGroup('saved-tests', 'Tests', ['a.test.ts']), createSavedGroup('saved-docs', 'Docs', ['a.md'])];
		const matchesOf = (filter: string) => search(groups, savedGroups, filter).map(pick => {
			if (pick.type === 'separator') {
				return `-- ${pick.label}`;
			}

			const ranges = (matches: { start: number; end: number }[] | undefined) => matches?.length ? matches.map(({ start, end }) => `${start}-${end}`).join(',') : undefined;
			return [pick.label, ranges(pick.highlights?.label) && `label ${ranges(pick.highlights?.label)}`, ranges(pick.highlights?.description) && `description ${ranges(pick.highlights?.description)}`].filter(Boolean).join(' | ');
		});

		assert.deepStrictEqual({
			byName: matchesOf('notes'),
			fuzzy: matchesOf('utt'),
			byTabGroup: matchesOf('source'),
			byLocation: matchesOf('docs'),
			byPath: matchesOf('src/util').filter(label => !label.startsWith('-- ')).map(label => label.split(' | ')[0]),
			nothing: matchesOf('zzz')
		}, {
			byName: ['-- Group 1', 'notes.md | label 0-5'],
			fuzzy: ['-- Group 1', 'util.test.ts | label 0-2,10-11', '-- Group 2', 'util.ts | label 0-2,5-6'],
			byTabGroup: ['-- Group 2', 'util.ts | description 0-6'],
			byLocation: ['-- Group 1', 'notes.md | description 0-4', '-- Saved Tab Groups', 'Docs | label 0-4'],
			byPath: ['util.test.ts', 'util.ts'],
			nothing: ['No matching tabs']
		});
	});

	test('puts the best match first within its editor group and keeps the editor groups in order', () => {
		const picks = search([
			createGroup(1, createEntry('library.ts', { description: 'lib' }), createEntry('readme.md', { description: 'docs' })),
			createGroup(2, createEntry('a.ts', { description: 'lib/util' }), createEntry('util.ts', { description: 'lib' }), createEntry('b.ts', { description: 'lib/util' }), createEntry('utility.ts'))
		], [], 'util');

		assert.deepStrictEqual(outline(picks), ['-- Group 2', 'util.ts', 'utility.ts', 'a.ts', 'b.ts']);
	});

	test('shows that nothing can be picked when there are no tabs or none match', () => {
		const noTabs = search([createGroup(1)], []);
		const noMatch = search(groups, [], 'zzz');

		assert.deepStrictEqual([noTabs, noMatch].map(picks => picks.map(pick => pick.type === 'separator' ? pick.label : ({ kind: pick.kind, label: pick.label, pickable: pick.pickable, alwaysShow: pick.alwaysShow }))), [
			[{ kind: 'noResults', label: 'There are no open tabs', pickable: false, alwaysShow: true }],
			[{ kind: 'noResults', label: 'No matching tabs', pickable: false, alwaysShow: true }]
		]);
	});
});
