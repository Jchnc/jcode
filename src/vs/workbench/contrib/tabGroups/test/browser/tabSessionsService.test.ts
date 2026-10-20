/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, NotificationMessage } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { isEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions, EditorsOrder, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { GroupDirection, GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart, registerTestEditor, TestEditorPart, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { TestFileService } from '../../../../test/common/workbenchTestServices.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { stringifyTabSessions } from '../../common/tabSessions.js';
import { TabSessionsService } from '../../browser/tabSessionsService.js';

suite('Tab Sessions Service', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTabSessions';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTabSessions';

	const disposables = new DisposableStore();

	/** An editor that is named after its resource, which is how the editors of a session are described. */
	class TestNamedEditorInput extends TestFileEditorInput {
		override getName(): string {
			return this.resource.authority;
		}
	}

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
	});

	teardown(() => {
		disposables.clear();
	});

	async function createService(options: { confirm?: boolean; storedSessions?: string } = {}) {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);

		const confirmations: string[] = [];
		instantiationService.stub(IDialogService, new class extends mock<IDialogService>() {
			override async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
				confirmations.push(`${confirmation.message} | ${confirmation.detail}`);
				return { confirmed: options.confirm ?? true };
			}
		});

		const warnings: string[] = [];
		instantiationService.stub(INotificationService, new class extends TestNotificationService {
			override warn(message: NotificationMessage) {
				warnings.push(String(message));
				return super.warn(message);
			}
		});

		if (options.storedSessions) {
			instantiationService.get(IStorageService).store('jcode.tabSessions', options.storedSessions, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}

		const service = disposables.add(instantiationService.createInstance(TabSessionsService));

		return { instantiationService, part, service, confirmations, warnings, fileService: instantiationService.get(IFileService) as TestFileService };
	}

	async function openEditors(group: IEditorGroup, names: string[]): Promise<Map<string, TestFileEditorInput>> {
		const editors = new Map<string, TestFileEditorInput>();
		for (const name of names) {
			const editor = disposables.add(new TestNamedEditorInput(URI.parse(`file://${name}/`), TEST_EDITOR_INPUT_ID));
			await group.openEditor(editor, { pinned: true });
			editors.set(name, editor);
		}

		return editors;
	}

	/** What the editor groups show, in the order they are arranged. */
	function snapshot(part: TestEditorPart) {
		return {
			groups: part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => ({
				editors: group.getEditors(EditorsOrder.SEQUENTIAL).map(editor => `${editor.resource?.authority}${group.isSticky(editor) ? ' (sticky)' : ''}`),
				active: group.activeEditor?.resource?.authority,
				locked: group.isLocked,
				tabGroups: isEditorGroupView(group) ? group.tabGroups.map(tabGroup => `${tabGroup.name} ${tabGroup.color} ${tabGroup.icon ?? '-'} ${tabGroup.collapsed ? 'collapsed' : 'expanded'}: ${group.editors.filter(editor => group.getTabGroupForEditor(editor) === tabGroup).map(editor => editor.resource?.authority).join(', ')}`) : []
			})),
			activeGroup: part.getGroups(GroupsOrder.GRID_APPEARANCE).indexOf(part.activeGroup)
		};
	}

	/** Two side by side editor groups with sticky and grouped editors. */
	async function arrangeWindow(part: TestEditorPart): Promise<void> {
		const first = part.activeGroup;
		const second = part.addGroup(first, GroupDirection.RIGHT);

		const editors = await openEditors(first, ['pinned', 'a', 'b', 'c', 'd']);
		first.stickEditor(editors.get('pinned'));
		if (isEditorGroupView(first)) {
			first.createTabGroup([editors.get('b')!, editors.get('c')!], 'Docs', 'blue', { icon: 'book', collapsed: true });
		}
		await first.openEditor(editors.get('c')!);
		first.lock(true);

		await openEditors(second, ['e', 'f']);
		await second.openEditor(second.getEditorByIndex(0)!);
		part.activateGroup(second);
	}

	const arranged = {
		groups: [
			{ editors: ['pinned (sticky)', 'a', 'b', 'c', 'd'], active: 'c', locked: true, tabGroups: ['Docs blue book collapsed: b, c'] },
			{ editors: ['e', 'f'], active: 'e', locked: false, tabGroups: [] }
		],
		activeGroup: 1
	};

	test('restores the layout, editors, active editors, sticky editors and tab groups of a session', async () => {
		const { instantiationService, part, service } = await createService();
		await arrangeWindow(part);
		const before = snapshot(part);

		const session = service.saveSession('Review');
		assert.ok(session);

		// Replace the layout by something else
		part.mergeAllGroups(part.groups[0]);
		part.groups[0].lock(false);
		await part.groups[0].closeAllEditors();
		await openEditors(part.groups[0], ['other']);
		assert.notDeepStrictEqual(snapshot(part), before);

		const restored = await service.restoreSession(session.id);

		assert.deepStrictEqual({ restored, before, after: snapshot(part) }, { restored: true, before: arranged, after: arranged });

		return workbenchTeardown(instantiationService);
	});

	test('restores layouts with fewer and more editor groups than the window has', async () => {
		const { instantiationService, part, service } = await createService();
		await openEditors(part.activeGroup, ['solo']);
		const single = service.saveSession('Single')!;

		await part.activeGroup.closeAllEditors();
		await arrangeWindow(part);
		const double = service.saveSession('Double')!;

		await service.restoreSession(single.id);
		const afterSingle = snapshot(part);
		await service.restoreSession(double.id);

		assert.deepStrictEqual({ afterSingle, afterDouble: snapshot(part) }, {
			afterSingle: { groups: [{ editors: ['solo'], active: 'solo', locked: false, tabGroups: [] }], activeGroup: 0 },
			afterDouble: arranged
		});

		return workbenchTeardown(instantiationService);
	});

	test('keeps editors with unsaved changes open after asking, and does not touch anything when the user declines', async () => {
		const detail = 'Do you want to restore the tab session "Saved"? | The open editors are replaced by the editors of the session. Editors with unsaved changes stay open so that your changes are not lost: dirty.';

		for (const confirm of [true, false]) {
			const { instantiationService, part, service, confirmations } = await createService({ confirm });
			const group = part.activeGroup;
			await openEditors(group, ['kept', 'closed']);
			const session = service.saveSession('Saved')!;

			const editors = await openEditors(group, ['dirty', 'extra']);
			editors.get('dirty')!.setDirty();
			const restored = await service.restoreSession(session.id);

			assert.deepStrictEqual({ confirm, restored, confirmations, editors: snapshot(part).groups[0].editors }, confirm
				? { confirm, restored: true, confirmations: [detail], editors: ['kept', 'closed', 'dirty'] }
				: { confirm, restored: false, confirmations: [detail], editors: ['kept', 'closed', 'dirty', 'extra'] });

			await workbenchTeardown(instantiationService);
		}
	});

	test('does not ask when no editor has unsaved changes', async () => {
		const { instantiationService, part, service, confirmations } = await createService({ confirm: false });
		await openEditors(part.activeGroup, ['a', 'b']);
		const session = service.saveSession('Clean')!;
		await part.activeGroup.closeAllEditors();

		const restored = await service.restoreSession(session.id);

		assert.deepStrictEqual({ restored, confirmations, editors: snapshot(part).groups[0].editors }, { restored: true, confirmations: [], editors: ['a', 'b'] });

		return workbenchTeardown(instantiationService);
	});

	test('leaves out editors that can no longer be opened and keeps the rest of the session together', async () => {
		const { instantiationService, part, service, warnings, fileService } = await createService();
		const group = part.activeGroup;
		const editors = await openEditors(group, ['a', 'gone', 'b', 'c']);
		if (isEditorGroupView(group)) {
			group.createTabGroup([editors.get('gone')!, editors.get('b')!], 'Pair', 'red');
		}
		await group.openEditor(editors.get('gone')!);
		const session = service.saveSession('Stale')!;
		await group.closeAllEditors();

		fileService.notExistsSet.set(URI.parse('file://gone/'), true);
		await service.restoreSession(session.id);

		assert.deepStrictEqual({ snapshot: snapshot(part), warnings }, {
			snapshot: { groups: [{ editors: ['a', 'b', 'c'], active: 'b', locked: false, tabGroups: ['Pair red - expanded: b'] }], activeGroup: 0 },
			warnings: ['Restored the tab session "Stale" without 1 editor that can no longer be opened.']
		});

		return workbenchTeardown(instantiationService);
	});

	test('keeps an open editor with unsaved changes whose file is gone when the serializer hands out that same editor', async () => {
		const CACHED_EDITOR_INPUT_ID = 'testCachedEditorInputForTabSessions';
		const cache = new Map<string, EditorInput>();
		disposables.add(Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(CACHED_EDITOR_INPUT_ID, class implements IEditorSerializer {
			canSerialize(): boolean { return true; }
			serialize(editor: EditorInput): string { return editor.resource!.toString(); }
			deserialize(_instantiationService: IInstantiationService, value: string): EditorInput | undefined { return cache.get(value); } // like text file editors, which are cached by resource
		}));

		const { instantiationService, part, service, warnings, fileService } = await createService();
		const group = part.activeGroup;
		await openEditors(group, ['a']);
		const deleted = disposables.add(new TestNamedEditorInput(URI.parse('file://deleted/'), CACHED_EDITOR_INPUT_ID));
		cache.set(deleted.resource.toString(), deleted);
		await group.openEditor(deleted, { pinned: true });
		const session = service.saveSession('Cached')!;

		deleted.setDirty();
		fileService.notExistsSet.set(deleted.resource, true);
		await service.restoreSession(session.id);

		assert.deepStrictEqual({ editors: snapshot(part).groups[0].editors, disposed: deleted.isDisposed(), warnings: warnings.length }, { editors: ['a', 'deleted'], disposed: false, warnings: 1 });

		return workbenchTeardown(instantiationService);
	});

	test('ignores editors of a type that no longer exists', async () => {
		const stored = stringifyTabSessions([{
			id: 'old',
			name: 'Old',
			savedAt: 1,
			layout: { orientation: 0, groups: [{}] },
			groups: [{ editors: [{ typeId: 'removedEditorType', value: '{}', name: 'removed' }, { typeId: TEST_EDITOR_INPUT_ID, value: JSON.stringify({ resource: 'file://kept/' }), name: 'kept' }], active: 0 }],
			activeGroup: 0
		}]);
		const { instantiationService, part, service, warnings } = await createService({ storedSessions: stored });

		await service.restoreSession('old');

		assert.deepStrictEqual({ snapshot: snapshot(part), warnings: warnings.length }, {
			snapshot: { groups: [{ editors: ['kept'], active: 'kept', locked: false, tabGroups: [] }], activeGroup: 0 },
			warnings: 1
		});

		return workbenchTeardown(instantiationService);
	});

	test('editors that open while a session is restored are reported as part of the restore', async () => {
		const { instantiationService, part, service } = await createService();
		await openEditors(part.activeGroup, ['a', 'b']);
		const session = service.saveSession('Busy')!;
		await part.activeGroup.closeAllEditors();

		const restoringWhileOpening: boolean[] = [];
		disposables.add(part.activeGroup.onDidModelChange(() => restoringWhileOpening.push(service.isRestoring)));
		await service.restoreSession(session.id);

		assert.deepStrictEqual({ restoringWhileOpening: restoringWhileOpening.length > 0 && restoringWhileOpening.every(restoring => restoring), restoringAfter: service.isRestoring }, { restoringWhileOpening: true, restoringAfter: false });

		return workbenchTeardown(instantiationService);
	});

	test('saves sessions by name, replaces a session with the same name and keeps the most recent first', async () => {
		const { instantiationService, part, service } = await createService();
		await openEditors(part.activeGroup, ['a']);

		const first = service.saveSession('First')!;
		await openEditors(part.activeGroup, ['b']);
		const second = service.saveSession('Second')!;
		const replaced = service.saveSession('  first ')!;

		assert.deepStrictEqual({
			ids: service.getSessions().map(session => session.id),
			names: service.getSessions().map(session => session.name),
			replacedId: replaced.id === first.id,
			editors: service.getSessions().map(session => session.groups[0].editors.map(editor => editor.name)),
			emptyName: service.saveSession('   '),
			second: second.name
		}, {
			ids: [first.id, second.id],
			names: ['first', 'Second'],
			replacedId: true,
			editors: [['a', 'b'], ['a', 'b']],
			emptyName: undefined,
			second: 'Second'
		});

		return workbenchTeardown(instantiationService);
	});

	test('renames and deletes sessions, and sessions are kept in the workspace storage', async () => {
		const { instantiationService, part, service } = await createService();
		await openEditors(part.activeGroup, ['a']);
		const first = service.saveSession('First')!;
		const second = service.saveSession('Second')!;

		const results = [
			service.renameSession(first.id, 'Second'), // used by another session
			service.renameSession(first.id, '  '),
			service.renameSession('unknown', 'Name'),
			service.renameSession(first.id, 'FIRST'), // only its case changes
			service.renameSession(second.id, ' Renamed ')
		];
		service.deleteSession('unknown');

		const reloaded = disposables.add(instantiationService.createInstance(TabSessionsService));
		const namesAfterRename = reloaded.getSessions().map(session => session.name).sort();
		service.deleteSession(first.id);

		assert.deepStrictEqual({
			results,
			namesAfterRename,
			remaining: disposables.add(instantiationService.createInstance(TabSessionsService)).getSessions().map(session => session.name)
		}, {
			results: [false, false, false, true, true],
			namesAfterRename: ['FIRST', 'Renamed'],
			remaining: ['Renamed']
		});

		return workbenchTeardown(instantiationService);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
