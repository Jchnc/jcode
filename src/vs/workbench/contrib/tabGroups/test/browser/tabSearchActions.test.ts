/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IQuickInputHideEvent, IQuickPick, IQuickPickDidAcceptEvent, IQuickPickItem, IQuickPickItemButtonEvent, IQuickPickSeparator, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { ConfirmResult, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IEditorGroupView, isEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { GroupDirection, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IHistoryService, ISavedEditorTabGroup } from '../../../../services/history/common/history.js';
import { createEditorPart, registerTestEditor, TestEditorPart, TestFileDialogService, TestFileEditorInput, TestQuickInputService, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { showTabSearch } from '../../browser/tabSearchActions.js';

interface ITabSearchController {
	readonly labels: readonly string[];
	readonly activeLabels: readonly string[];
	type(value: string): void;
	accept(label: string): void;
	triggerButton(label: string, buttonIndex: number): void;
	dismiss(): void;
}

/** Quick pick service with a picker that a script can drive, step by step. */
class FakeQuickInputService extends TestQuickInputService {

	constructor(private readonly script: (controller: ITabSearchController) => Promise<void>) {
		super();
	}

	override createQuickPick<T extends IQuickPickItem>(): IQuickPick<T, { useSeparators: boolean }> {
		const onDidChangeValue = new Emitter<string>();
		const onDidAccept = new Emitter<IQuickPickDidAcceptEvent>();
		const onDidHide = new Emitter<IQuickInputHideEvent>();
		const onDidTriggerItemButton = new Emitter<IQuickPickItemButtonEvent<T>>();

		const picker = new class extends mock<IQuickPick<T, { useSeparators: boolean }>>() {
			override items: readonly T[] = []; // that can also hold separators, as the picker is asked to use them
			override value = '';
			override activeItems: readonly T[] = [];
			override selectedItems: readonly T[] = [];
			override placeholder: string | undefined;
			override matchOnLabel = true;
			override matchOnDescription = false;
			override matchOnDetail = false;
			override sortByLabel = true;
			override readonly onDidChangeValue = onDidChangeValue.event;
			override readonly onDidAccept = onDidAccept.event;
			override readonly onDidHide = onDidHide.event;
			override readonly onDidTriggerItemButton = onDidTriggerItemButton.event;
			override show(): void { void script(controller); }
			override hide(): void { onDidHide.fire({ reason: QuickInputHideReason.Other }); }
			override dispose(): void {
				onDidChangeValue.dispose();
				onDidAccept.dispose();
				onDidHide.dispose();
				onDidTriggerItemButton.dispose();
			}
		}();

		const script = this.script;
		const entries = (): ReadonlyArray<T | IQuickPickSeparator> => picker.items;
		const findItem = (label: string) => entries().find((item): item is T => item.type !== 'separator' && item.label === label)!;
		const controller: ITabSearchController = {
			get labels() { return entries().map(item => item.type === 'separator' ? `-- ${item.label}` : item.label ?? ''); },
			get activeLabels() { return picker.activeItems.map(item => item.label ?? ''); },
			type: value => {
				picker.value = value;
				onDidChangeValue.fire(value);
			},
			accept: label => {
				picker.selectedItems = [findItem(label)];
				onDidAccept.fire({ inBackground: false });
			},
			triggerButton: (label, buttonIndex) => {
				const item = findItem(label);
				onDidTriggerItemButton.fire({ item, button: item.buttons![buttonIndex] });
			},
			dismiss: () => picker.hide()
		};

		return picker;
	}
}

suite('Tab Search Actions', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTabSearch';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTabSearch';

	const disposables = new DisposableStore();

	/** An editor that is named after its resource, as editors are in the tab bar. */
	class TestNamedEditorInput extends TestFileEditorInput {
		override getName(): string {
			return basename(this.resource);
		}
	}

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
	});

	teardown(() => {
		disposables.clear();
	});

	async function setupWindow(script: (controller: ITabSearchController) => Promise<void>, savedGroups: ISavedEditorTabGroup[] = []) {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);

		const reopened: string[] = [];
		const historyService = new class extends mock<IHistoryService>() {
			override getSavedTabGroups() { return savedGroups; }
			override async reopenSavedTabGroup(id: string, groupId?: number) { reopened.push(`${id} in group ${groupId}`); }
		};

		const quickInputService = new FakeQuickInputService(script);
		const run = () => showTabSearch({
			quickInputService,
			editorGroupsService: part,
			historyService,
			modelService: instantiationService.get(IModelService),
			languageService: instantiationService.get(ILanguageService)
		});

		return { instantiationService, part, run, reopened, quickInputService };
	}

	function createEditor(path: string): TestFileEditorInput {
		return disposables.add(new TestNamedEditorInput(URI.file(`/work/${path}`), TEST_EDITOR_INPUT_ID));
	}

	async function open(group: IEditorGroupView, ...paths: string[]): Promise<TestFileEditorInput[]> {
		const editors = paths.map(createEditor);
		for (const editor of editors) {
			await group.openEditor(editor, { pinned: true });
		}

		return editors;
	}

	function settle(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	function activeGroup(part: TestEditorPart): IEditorGroupView {
		assert.ok(isEditorGroupView(part.activeGroup));
		return part.activeGroup;
	}

	test('lists the tabs of all editor groups, starting at the active tab, and goes to the one that is picked', async () => {
		const trace: string[] = [];
		const { instantiationService, part, run } = await setupWindow(async picker => {
			trace.push(`initial: ${picker.labels.join(' | ')} (active: ${picker.activeLabels.join(', ')})`);
			picker.type('c.ts');
			trace.push(`typed: ${picker.labels.join(' | ')}`);
			picker.accept('c.ts');
		});
		const first = activeGroup(part);
		const second = part.addGroup(first, GroupDirection.RIGHT);
		await open(first, 'a.ts', 'b.ts');
		await open(second, 'c.ts', 'd.ts');
		part.activateGroup(first);
		await first.openEditor(first.getEditorByIndex(1)!);

		await run();

		assert.deepStrictEqual({
			trace,
			activeGroup: part.activeGroup.id === second.id,
			activeEditor: part.activeGroup.activeEditor?.resource ? basename(part.activeGroup.activeEditor.resource) : undefined
		}, {
			trace: [
				'initial: -- Group 1 | a.ts | b.ts | -- Group 2 | c.ts | d.ts (active: b.ts)',
				'typed: -- Group 2 | c.ts'
			],
			activeGroup: true,
			activeEditor: 'c.ts'
		});

		return workbenchTeardown(instantiationService);
	});

	test('expands the collapsed tab group of a tab that is hidden when the tab is picked', async () => {
		const { instantiationService, part, run } = await setupWindow(async picker => picker.accept('hidden.ts'));
		const group = activeGroup(part);
		const editors = await open(group, 'shown.ts', 'hidden.ts', 'other.ts');
		const tabGroup = group.createTabGroup([editors[1], editors[2]], 'Docs', 'blue', { collapsed: true });
		await group.openEditor(editors[0]);

		await run();

		assert.deepStrictEqual({ collapsed: tabGroup?.collapsed, active: group.activeEditor === editors[1] }, { collapsed: false, active: true });

		return workbenchTeardown(instantiationService);
	});

	test('keeps a collapsed tab group collapsed when its visible tab is picked', async () => {
		const { instantiationService, part, run } = await setupWindow(async picker => picker.accept('b.ts'));
		const group = activeGroup(part);
		const editors = await open(group, 'a.ts', 'b.ts');
		const tabGroup = group.createTabGroup([editors[1]], 'Docs', 'blue', { collapsed: true });
		await group.openEditor(editors[1]);
		await group.openEditor(editors[0]);
		await group.openEditor(editors[1]);

		await run();

		assert.deepStrictEqual({ collapsed: tabGroup?.collapsed, active: group.activeEditor === editors[1] }, { collapsed: true, active: true });

		return workbenchTeardown(instantiationService);
	});

	test('closes a tab with its button, keeps the list open and moves on to the tab next to it', async () => {
		const trace: string[] = [];
		const { instantiationService, part, run } = await setupWindow(async picker => {
			picker.triggerButton('b.ts', 0);
			await settle();
			trace.push(`${picker.labels.join(' | ')} (active: ${picker.activeLabels.join(', ')})`);
			picker.triggerButton('c.ts', 0);
			await settle();
			picker.triggerButton('a.ts', 0);
			await settle();
			trace.push(picker.labels.join(' | '));
			picker.dismiss();
		});
		const group = activeGroup(part);
		await open(group, 'a.ts', 'b.ts', 'c.ts');

		await run();

		assert.deepStrictEqual({ trace, editors: group.getEditors(EditorsOrder.SEQUENTIAL).length }, { trace: ['a.ts | c.ts (active: c.ts)', 'There are no open tabs'], editors: 0 });

		return workbenchTeardown(instantiationService);
	});

	test('keeps a tab open and listed when the user does not want to close it', async () => {
		const trace: string[] = [];
		const { instantiationService, part, run } = await setupWindow(async picker => {
			picker.triggerButton('dirty.ts', 0);
			await settle();
			trace.push(picker.labels.join(' | '));
			picker.dismiss();
		});
		const group = activeGroup(part);
		const [dirty] = await open(group, 'dirty.ts');
		dirty.setDirty();
		(instantiationService.get(IFileDialogService) as TestFileDialogService).setConfirmResult(ConfirmResult.CANCEL);

		await run();

		assert.deepStrictEqual({ trace, kept: group.editors.length }, { trace: ['dirty.ts'], kept: 1 });

		return workbenchTeardown(instantiationService);
	});

	test('opens a saved tab group in the editor group that was active, and ignores the message that nothing matches', async () => {
		const saved: ISavedEditorTabGroup = { id: 'saved-docs', name: 'Docs', color: 'green', collapsed: false, locked: false, editors: [{ editor: { resource: URI.file('/work/docs/a.md') }, index: 0 }] };
		const trace: string[] = [];
		const { instantiationService, part, run, reopened } = await setupWindow(async picker => {
			picker.type('zzz');
			trace.push(picker.labels.join(' | '));
			picker.accept('No matching tabs'); // not something to pick: the list stays open
			picker.type('');
			trace.push(picker.labels.join(' | '));
			picker.accept('Docs');
		}, [saved]);
		const first = activeGroup(part);
		const second = part.addGroup(first, GroupDirection.RIGHT);
		await open(first, 'a.ts');
		part.activateGroup(second);

		await run();

		assert.deepStrictEqual({ trace, reopened }, {
			trace: ['No matching tabs', '-- Group 1 | a.ts | -- Saved Tab Groups | Docs'],
			reopened: [`saved-docs in group ${second.id}`]
		});

		return workbenchTeardown(instantiationService);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
