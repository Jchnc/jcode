/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorGroupView, isEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { EditorsOrder, GroupModelChangeKind } from '../../../../common/editor.js';
import { GroupDirection, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart, registerTestEditor, TestEditorPart, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { TabAutoGroupContribution } from '../../browser/tabAutoGroup.js';
import { getTabAutoGroupColor, TAB_AUTO_GROUP_RULES_SETTING } from '../../common/tabAutoGroupRules.js';
import { ITabSessionsService } from '../../common/tabSessionsService.js';

suite('Tab Auto Group', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTabAutoGroup';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTabAutoGroup';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
	});

	teardown(() => {
		disposables.clear();
	});

	const rules = [
		{ name: 'Tests', pattern: '**/*.test.ts', color: 'red', icon: 'beaker' },
		{ name: 'Docs', pattern: 'docs/**' },
		{ name: 'Source', pattern: 'src/**/*.ts', color: 'blue' }
	];

	async function setupAutoGroup(options: { rules?: unknown; restoring?: () => boolean } = {}) {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		await configurationService.setUserConfiguration(TAB_AUTO_GROUP_RULES_SETTING, options.rules ?? rules);

		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(URI.file('/work'))));
		instantiationService.stub(ITabSessionsService, new class extends mock<ITabSessionsService>() {
			override get isRestoring() { return options.restoring?.() ?? false; }
		});

		disposables.add(instantiationService.createInstance(TabAutoGroupContribution));

		return { instantiationService, configurationService, part };
	}

	function createEditor(path: string): TestFileEditorInput {
		return disposables.add(new TestFileEditorInput(URI.file(`/work/${path}`), TEST_EDITOR_INPUT_ID));
	}

	/** Lets the rules look at the editors that were opened. */
	function settle(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	async function open(group: IEditorGroupView, ...paths: string[]): Promise<TestFileEditorInput[]> {
		const editors = paths.map(createEditor);
		for (const editor of editors) {
			await group.openEditor(editor, { pinned: true });
		}
		await settle();

		return editors;
	}

	function snapshot(group: IEditorGroupView) {
		return {
			editors: group.getEditors(EditorsOrder.SEQUENTIAL).map(editor => basename(editor.resource!)),
			tabGroups: group.tabGroups.map(tabGroup => `${tabGroup.name} (${tabGroup.color}${tabGroup.icon ? `, ${tabGroup.icon}` : ''}${tabGroup.locked ? ', locked' : ''}): ${group.editors.filter(editor => group.getTabGroupForEditor(editor) === tabGroup).map(editor => basename(editor.resource!)).join(', ')}`)
		};
	}

	function activeGroup(part: TestEditorPart): IEditorGroupView {
		assert.ok(isEditorGroupView(part.activeGroup));
		return part.activeGroup;
	}

	test('adds opened editors to the tab group of the first rule that matches and creates the group when needed', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const group = activeGroup(part);

		// b.test.ts opens next to the active b.ts, right in front of the Tests group, and joins that group where it is
		await open(group, 'other.txt', 'src/a.ts', 'src/a.test.ts', 'docs/readme.md', 'src/b.ts', 'src/b.test.ts');

		assert.deepStrictEqual(snapshot(group), {
			editors: ['other.txt', 'a.ts', 'b.ts', 'b.test.ts', 'a.test.ts', 'readme.md'],
			tabGroups: [
				'Source (blue): a.ts, b.ts',
				'Tests (red, beaker): b.test.ts, a.test.ts',
				`Docs (${getTabAutoGroupColor({ name: 'Docs', pattern: '' })}): readme.md`
			]
		});

		return workbenchTeardown(instantiationService);
	});

	test('adds editors to a tab group of that name that already exists in the editor group, and to none in other editor groups', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const first = activeGroup(part);
		const second = part.addGroup(first, GroupDirection.RIGHT);

		const [existing] = await open(first, 'src/a.ts');
		first.createTabGroup([existing], 'Tests', 'green'); // made by the user, not by a rule
		await open(first, 'src/a.test.ts');
		await open(second, 'src/b.test.ts');

		assert.deepStrictEqual([snapshot(first), snapshot(second)], [{
			editors: ['a.ts', 'a.test.ts'],
			tabGroups: ['Tests (green): a.ts, a.test.ts']
		}, {
			editors: ['b.test.ts'],
			tabGroups: ['Tests (red, beaker): b.test.ts']
		}]);

		return workbenchTeardown(instantiationService);
	});

	test('keeps preview editors out of tab groups until they are pinned', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const group = activeGroup(part);

		const editor = createEditor('src/a.test.ts');
		await group.openEditor(editor, { pinned: false });
		await settle();
		const asPreview = snapshot(group);

		group.pinEditor(editor);
		await settle();

		assert.deepStrictEqual({ asPreview, pinned: snapshot(group) }, {
			asPreview: { editors: ['a.test.ts'], tabGroups: [] },
			pinned: { editors: ['a.test.ts'], tabGroups: ['Tests (red, beaker): a.test.ts'] }
		});

		return workbenchTeardown(instantiationService);
	});

	test('leaves sticky editors, editors that are in a tab group already and locked tab groups alone', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const group = activeGroup(part);

		// Sticky editors
		const sticky = createEditor('src/sticky.test.ts');
		await group.openEditor(sticky, { pinned: true, sticky: true });

		// An editor that gets a tab group of its own when it opens
		const listener = disposables.add(group.onDidModelChange(e => {
			if (e.kind === GroupModelChangeKind.EDITOR_OPEN && e.editor?.resource && basename(e.editor.resource) === 'mine.test.ts') {
				group.createTabGroup([e.editor], 'Mine', 'green');
			}
		}));
		await open(group, 'mine.test.ts');
		listener.dispose();

		// A locked tab group the next editor would otherwise join
		const [locked] = await open(group, 'src/locked.ts');
		group.createTabGroup([locked], 'Source', 'blue', { locked: true });
		await open(group, 'src/joins.ts');

		assert.deepStrictEqual(snapshot(group), {
			editors: ['sticky.test.ts', 'mine.test.ts', 'locked.ts', 'joins.ts'],
			tabGroups: ['Mine (green): mine.test.ts', 'Source (blue, locked): locked.ts']
		});

		return workbenchTeardown(instantiationService);
	});

	test('does not add an editor again to a tab group that the user removed it from', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const first = activeGroup(part);
		const second = part.addGroup(first, GroupDirection.RIGHT);

		// The same editor in two editor groups, which are grouped by the rule. The first one keeps another
		// editor so that it does not close with its last editor.
		const [, editor] = await open(first, 'other.txt', 'src/a.test.ts');
		await second.openEditor(editor, { pinned: true });
		await settle();
		const grouped = [snapshot(first).tabGroups, snapshot(second).tabGroups];

		// The user removes it from the tab group in the first editor group, closes it there and opens it again
		first.removeFromTabGroup([editor]);
		await first.closeEditor(editor);
		await first.openEditor(editor, { pinned: true });
		await settle();
		const afterReopen = [snapshot(first), snapshot(second)];

		// Editors that were not removed are still added
		await open(first, 'src/b.test.ts');

		assert.deepStrictEqual({ grouped, afterReopen, afterNewEditor: snapshot(first) }, {
			grouped: [['Tests (red, beaker): a.test.ts'], ['Tests (red, beaker): a.test.ts']],
			afterReopen: [{ editors: ['other.txt', 'a.test.ts'], tabGroups: [] }, { editors: ['a.test.ts'], tabGroups: ['Tests (red, beaker): a.test.ts'] }],
			afterNewEditor: { editors: ['other.txt', 'a.test.ts', 'b.test.ts'], tabGroups: ['Tests (red, beaker): b.test.ts'] }
		});

		return workbenchTeardown(instantiationService);
	});

	test('remembers a removed file after its editor closed, until the user puts it in a tab group again', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const group = activeGroup(part);

		const [, editor] = await open(group, 'other.txt', 'src/a.test.ts');
		group.removeFromTabGroup([editor]);
		await settle();
		await group.closeEditor(editor);

		// A new editor for the same file
		const [reopened] = await open(group, 'src/a.test.ts');
		const afterReopen = snapshot(group);

		// The user puts the file in a tab group of their own, which lets the rule apply to it again
		group.createTabGroup([reopened], 'Mine', 'green');
		await settle();
		await group.closeEditor(reopened);
		await open(group, 'src/a.test.ts');

		assert.deepStrictEqual({ afterReopen, afterPutBack: snapshot(group) }, {
			afterReopen: { editors: ['other.txt', 'a.test.ts'], tabGroups: [] },
			afterPutBack: { editors: ['other.txt', 'a.test.ts'], tabGroups: ['Tests (red, beaker): a.test.ts'] }
		});

		return workbenchTeardown(instantiationService);
	});

	test('does not take closing the last editor of a tab group for the user removing it', async () => {
		const { instantiationService, part } = await setupAutoGroup();
		const first = activeGroup(part);
		const second = part.addGroup(first, GroupDirection.RIGHT);

		const [, editor] = await open(first, 'other.txt', 'src/a.test.ts');
		await second.openEditor(editor, { pinned: true });
		await first.closeEditor(editor); // the tab group of the editor goes away first, then the editor
		await first.openEditor(editor, { pinned: true });
		await settle();

		assert.deepStrictEqual(snapshot(first), { editors: ['other.txt', 'a.test.ts'], tabGroups: ['Tests (red, beaker): a.test.ts'] });

		return workbenchTeardown(instantiationService);
	});

	test('does nothing when tab groups are disabled, a session is being restored or there are no rules', async () => {
		let restoring = false;
		const { instantiationService, part } = await setupAutoGroup({ restoring: () => restoring });
		const group = activeGroup(part);

		const disabled = part.enforcePartOptions({ tabGroups: { enabled: false } });
		await open(group, 'src/disabled.test.ts');
		disabled.dispose();

		restoring = true;
		await open(group, 'src/restoring.test.ts');
		restoring = false;

		const empty = await setupAutoGroup({ rules: [] });
		await open(activeGroup(empty.part), 'src/empty.test.ts');

		assert.deepStrictEqual({ group: snapshot(group), withoutRules: snapshot(activeGroup(empty.part)) }, {
			group: { editors: ['disabled.test.ts', 'restoring.test.ts'], tabGroups: [] },
			withoutRules: { editors: ['empty.test.ts'], tabGroups: [] }
		});

		await workbenchTeardown(empty.instantiationService);
		return workbenchTeardown(instantiationService);
	});

	test('follows changes to the rules and ignores rules that are not valid', async () => {
		const { instantiationService, configurationService, part } = await setupAutoGroup({ rules: [{ name: 'Broken' }, 'rule'] });
		const group = activeGroup(part);

		await open(group, 'src/a.test.ts');
		await configurationService.setUserConfiguration(TAB_AUTO_GROUP_RULES_SETTING, [{ name: 'Fresh', pattern: '**/*.test.ts', color: 'teal' }]);
		configurationService.onDidChangeConfigurationEmitter.fire(upcastPartial<IConfigurationChangeEvent>({ affectsConfiguration: key => key === TAB_AUTO_GROUP_RULES_SETTING }));
		await open(group, 'src/b.test.ts');

		assert.deepStrictEqual(snapshot(group), { editors: ['a.test.ts', 'b.test.ts'], tabGroups: ['Fresh (teal): b.test.ts'] });

		return workbenchTeardown(instantiationService);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
