/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { GroupOrientation } from '../../../../services/editor/common/editorGroupsService.js';
import { cloneTabSessionLayout, createTabSessionEditorGroup, findTabSessionByName, ITabSession, ITabSessionEditor, parseTabSessions, planTabSessionRestore, stringifyTabSessions, summarizeTabSession, TabSessionNameProblem, validateTabSessionName } from '../../common/tabSessions.js';

suite('Tab Sessions', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function editor(name: string): ITabSessionEditor {
		return { typeId: 'test.editor', value: JSON.stringify({ resource: `file:///work/${name}` }), name, description: '/work' };
	}

	/** Drops properties that are undefined, as they are when a session is stored. */
	function plain<T>(value: T): T {
		return JSON.parse(JSON.stringify(value));
	}

	function createSession(overrides: Partial<ITabSession> = {}): ITabSession {
		return {
			id: 'session-1',
			name: 'Review',
			savedAt: 1000,
			layout: { orientation: GroupOrientation.HORIZONTAL, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] },
			groups: [
				{
					editors: [editor('pinned.ts'), editor('a.ts'), editor('b.ts'), editor('c.ts'), editor('d.ts')],
					active: 3,
					stickyCount: 1,
					locked: true,
					tabGroups: [
						{ name: 'Docs', color: 'blue', icon: 'book', collapsed: true, saved: true, locked: true, members: [1, 2] },
						{ name: 'Tests', color: '#ff0000', members: [3] }
					]
				},
				{ editors: [editor('e.ts')], active: 0 },
				{ editors: [] }
			],
			activeGroup: 1,
			...overrides
		};
	}

	suite('capture', () => {

		test('leaves out editors that cannot be saved and keeps what refers to editors in line', () => {
			const group = createTabSessionEditorGroup({
				locked: true,
				editors: [
					{ editor: editor('pinned.ts') },
					{ editor: undefined },
					{ editor: editor('a.ts'), tabGroupId: 'docs' },
					{ editor: undefined, tabGroupId: 'docs' },
					{ editor: editor('b.ts'), tabGroupId: 'docs' },
					{ editor: undefined, tabGroupId: 'gone' },
					{ editor: editor('c.ts') }
				],
				activeIndex: 4,
				stickyCount: 2,
				tabGroups: [
					{ id: 'docs', name: 'Docs', color: 'blue', icon: 'book', collapsed: true, saved: false, locked: false },
					{ id: 'gone', name: 'Gone', color: 'red', collapsed: false, saved: false, locked: false },
					{ id: 'empty', name: 'Empty', color: 'red', collapsed: false, saved: false, locked: false }
				]
			});

			assert.deepStrictEqual(plain(group), {
				editors: [editor('pinned.ts'), editor('a.ts'), editor('b.ts'), editor('c.ts')],
				active: 2,
				stickyCount: 1,
				locked: true,
				tabGroups: [{ name: 'Docs', color: 'blue', icon: 'book', collapsed: true, members: [1, 2] }]
			});
		});

		test('moves the active editor to the editor after it when it cannot be saved', () => {
			const group = createTabSessionEditorGroup({
				locked: false,
				editors: [{ editor: editor('a.ts') }, { editor: undefined }, { editor: editor('b.ts') }],
				activeIndex: 1,
				stickyCount: 0,
				tabGroups: []
			});

			assert.deepStrictEqual(plain(group), { editors: [editor('a.ts'), editor('b.ts')], active: 1 });
		});
	});

	suite('storage', () => {

		test('sessions are the same after storing and reading them', () => {
			const sessions = [createSession(), createSession({ id: 'session-2', name: 'Other', groups: [{ editors: [editor('x.ts')], active: 0 }], layout: { orientation: GroupOrientation.VERTICAL, groups: [{}] }, activeGroup: 0 })];

			assert.deepStrictEqual(plain(parseTabSessions(stringifyTabSessions(sessions))), plain(sessions));
		});

		test('ignores storage that cannot be read', () => {
			assert.deepStrictEqual([undefined, '', 'not json', '"text"', '{}', '{"sessions":"no"}', '[]', '{"sessions":[null,1,"a",[],{}]}'].map(raw => parseTabSessions(raw)), [[], [], [], [], [], [], [], []]);
		});

		test('leaves out sessions that are incomplete or have the same identifier as an earlier one', () => {
			const valid = createSession({ id: 'valid' });
			const sessions = parseTabSessions(JSON.stringify({
				version: 1,
				sessions: [
					valid,
					{ ...valid, id: 'valid', name: 'Duplicate' },
					{ ...valid, id: '' },
					{ ...valid, id: 'unnamed', name: '  ' },
					{ ...valid, id: 'no-groups', groups: [] },
					{ ...valid, id: 'bad-groups', groups: 'none' }
				]
			}));

			assert.deepStrictEqual(sessions.map(session => session.id), ['valid']);
		});

		test('repairs data that is inconsistent', () => {
			const [session] = parseTabSessions(JSON.stringify({
				sessions: [{
					id: 'broken',
					name: ' Broken ',
					savedAt: 'yesterday',
					activeGroup: 9,
					layout: { orientation: GroupOrientation.HORIZONTAL, groups: [{}, {}, {}] }, // more groups than the session has
					groups: [
						{
							editors: [editor('a.ts'), { typeId: 'test.editor' }, editor('b.ts'), 7, editor('c.ts'), editor('d.ts')],
							active: 1,
							stickyCount: 3,
							tabGroups: [
								{ name: 'Sticky', color: 'blue', members: [0, 2, 4] },
								{ name: 'Overlap', color: '', members: [4, 5, 5.5, 'x'] },
								{ name: 'Nothing', color: 'red', members: [1, 3] },
								{ name: 'Invalid' },
								null
							]
						},
						'not a group'
					]
				}]
			}));

			assert.deepStrictEqual(plain(session), {
				id: 'broken',
				name: 'Broken',
				savedAt: 0,
				activeGroup: 0,
				layout: { orientation: GroupOrientation.HORIZONTAL, groups: [{}, {}] },
				groups: [
					{
						editors: [editor('a.ts'), editor('b.ts'), editor('c.ts'), editor('d.ts')],
						active: 1,
						stickyCount: 2,
						tabGroups: [{ name: 'Sticky', color: 'blue', members: [2] }, { name: 'Overlap', color: 'blue', members: [3] }]
					},
					{ editors: [] }
				]
			});
		});

		test('keeps a layout that has a leaf for each group and drops sizes that are not usable', () => {
			const parse = (layout: unknown) => plain(parseTabSessions(JSON.stringify({ sessions: [{ ...createSession(), layout, groups: [{ editors: [] }, { editors: [] }] }] }))[0].layout);

			assert.deepStrictEqual([
				parse({ orientation: GroupOrientation.VERTICAL, groups: [{ size: 0.3 }, { size: -1 }] }),
				parse({ orientation: 7, groups: [{}, {}] }),
				parse({ orientation: GroupOrientation.VERTICAL, groups: [{ groups: [] }, {}] }),
				parse({ orientation: GroupOrientation.VERTICAL, groups: [{ groups: [{}, {}] }] })
			], [
				{ orientation: GroupOrientation.VERTICAL, groups: [{ size: 0.3 }, {}] },
				{ orientation: GroupOrientation.HORIZONTAL, groups: [{}, {}] },
				{ orientation: GroupOrientation.HORIZONTAL, groups: [{}, {}] },
				{ orientation: GroupOrientation.VERTICAL, groups: [{ groups: [{}, {}] }] }
			].map(layout => plain(layout)));
		});

		test('applying a layout does not change the layout of the session', () => {
			const layout = createSession().layout;
			const copy = cloneTabSessionLayout(layout);
			copy.groups[1].groups![0] = { size: 1 };

			assert.deepStrictEqual(plain(layout), plain(createSession().layout));
		});
	});

	suite('restore planning', () => {

		test('restores everything when all editors can be restored', () => {
			const session = createSession();
			const plan = planTabSessionRestore(session, () => true);

			assert.deepStrictEqual(plain(plan), plain({
				layout: session.layout,
				groups: [
					{ group: { ...session.groups[0], stickyCount: 1 }, editorIndexes: [0, 1, 2, 3, 4] },
					{ group: session.groups[1], editorIndexes: [0] },
					{ group: { editors: [] }, editorIndexes: [] }
				],
				activeGroup: 1,
				skippedEditorCount: 0
			}));
		});

		test('leaves out editors that cannot be restored and moves the active editor, sticky editors and tab groups along', () => {
			const session = createSession();
			const unavailable = new Set(['0:0', '0:2', '0:3', '1:0']); // pinned.ts, b.ts, c.ts (the active editor) and e.ts
			const plan = planTabSessionRestore(session, (groupIndex, editorIndex) => !unavailable.has(`${groupIndex}:${editorIndex}`));

			assert.deepStrictEqual(plain(plan), plain({
				layout: session.layout,
				groups: [
					{
						group: {
							editors: [editor('a.ts'), editor('d.ts')],
							active: 1,
							locked: true,
							tabGroups: [{ name: 'Docs', color: 'blue', icon: 'book', collapsed: true, saved: true, locked: true, members: [0] }]
						},
						editorIndexes: [1, 4]
					},
					{ group: { editors: [], locked: undefined }, editorIndexes: [] },
					{ group: { editors: [] }, editorIndexes: [] }
				],
				activeGroup: 1,
				skippedEditorCount: 4
			}));
		});

		test('moves the active editor to the one before it when no editor after it remains', () => {
			const session = createSession();
			const plan = planTabSessionRestore(session, (groupIndex, editorIndex) => groupIndex !== 0 || editorIndex < 2);

			assert.deepStrictEqual(plan.groups[0].group.active, 1);
		});

		test('takes sticky editors out of tab groups', () => {
			const session = createSession({
				groups: [{ editors: [editor('a.ts'), editor('b.ts'), editor('c.ts')], stickyCount: 2, tabGroups: [{ name: 'All', color: 'blue', members: [0, 1, 2] }] }],
				layout: { orientation: GroupOrientation.HORIZONTAL, groups: [{}] },
				activeGroup: 0
			});

			assert.deepStrictEqual(plain(planTabSessionRestore(session, () => true).groups[0].group.tabGroups), [{ name: 'All', color: 'blue', members: [2] }]);
		});
	});

	suite('describing', () => {

		test('summarizes the contents of a session', () => {
			assert.deepStrictEqual(summarizeTabSession(createSession()), { groupCount: 3, editorCount: 6, tabGroupCount: 2 });
		});

		test('finds a session by its name regardless of case and surrounding spaces', () => {
			const sessions = [createSession(), createSession({ id: 'session-2', name: 'Other' })];

			assert.deepStrictEqual([findTabSessionByName(sessions, ' review ')?.id, findTabSessionByName(sessions, 'OTHER')?.id, findTabSessionByName(sessions, 'None')?.id], ['session-1', 'session-2', undefined]);
		});

		test('validates the name of a session', () => {
			const sessions = [createSession()];

			assert.deepStrictEqual(['', '   ', 'review', 'Fresh'].map(name => validateTabSessionName(name, sessions)), [TabSessionNameProblem.Empty, TabSessionNameProblem.Empty, TabSessionNameProblem.Exists, undefined]);
		});
	});
});
