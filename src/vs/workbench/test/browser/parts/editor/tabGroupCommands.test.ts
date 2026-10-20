/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import Severity from '../../../../../base/common/severity.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { INotificationHandle, INotificationService, IPromptChoice, NoOpNotification } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputHideEvent, IQuickPick, IQuickPickDidAcceptEvent, IQuickPickItem, IQuickPickItemButtonEvent, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { closeTabGroup, createSavedTabGroupPicks, focusAdjacentTabGroup, showSavedTabGroups } from '../../../../browser/parts/editor/editorCommands.js';
import { IEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorTabGroup } from '../../../../common/editor/editorTabGroup.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IHistoryService, ISavedEditorTabGroup } from '../../../../services/history/common/history.js';
import { createEditorPart, registerTestEditor, registerTestFileEditor, TestFileEditorInput, TestQuickInputService, workbenchInstantiationService, workbenchTeardown } from '../../workbenchTestServices.js';

interface IFakePickerController {
	readonly labels: readonly string[];
	readonly activeLabels: readonly string[];
	accept(label: string): void;
	triggerButton(label: string, buttonIndex: number): void;
	hide(): void;
}

/** Notification service that records the prompts that are shown. */
class FakeNotificationService extends mock<INotificationService>() {

	readonly prompts: { severity: Severity; message: string; choices: IPromptChoice[] }[] = [];

	override prompt(severity: Severity, message: string, choices: IPromptChoice[]): INotificationHandle {
		this.prompts.push({ severity, message, choices });
		return new NoOpNotification();
	}
}

/** Quick pick service that lets a script drive every quick pick that is shown. */
class FakeQuickInputService extends TestQuickInputService {

	private shownPickers = 0;

	constructor(private readonly pickerScripts: ((picker: IFakePickerController) => void)[], private readonly inputs: string[]) {
		super();
	}

	override createQuickPick<T extends IQuickPickItem>(): IQuickPick<T, { useSeparators: boolean }> {
		const script = this.pickerScripts[this.shownPickers++];
		const onDidAccept = new Emitter<IQuickPickDidAcceptEvent>();
		const onDidHide = new Emitter<IQuickInputHideEvent>();
		const onDidTriggerItemButton = new Emitter<IQuickPickItemButtonEvent<T>>();

		const picker = new class extends mock<IQuickPick<T, { useSeparators: boolean }>>() {
			override items: readonly T[] = [];
			override activeItems: readonly T[] = [];
			override selectedItems: readonly T[] = [];
			override placeholder: string | undefined;
			override matchOnDescription = false;
			override matchOnDetail = false;
			override readonly onDidAccept = onDidAccept.event;
			override readonly onDidHide = onDidHide.event;
			override readonly onDidTriggerItemButton = onDidTriggerItemButton.event;
			override show(): void { script(controller); }
			override hide(): void { onDidHide.fire({ reason: QuickInputHideReason.Other }); }
			override dispose(): void {
				onDidAccept.dispose();
				onDidHide.dispose();
				onDidTriggerItemButton.dispose();
			}
		}();

		const findItem = (label: string) => picker.items.find(item => item.label === label)!;
		const controller: IFakePickerController = {
			get labels() { return picker.items.map(item => item.label); },
			get activeLabels() { return picker.activeItems.map(item => item.label); },
			accept: label => {
				picker.selectedItems = [findItem(label)];
				onDidAccept.fire({ inBackground: false });
			},
			triggerButton: (label, buttonIndex) => {
				const item = findItem(label);
				onDidTriggerItemButton.fire({ item, button: item.buttons![buttonIndex] });
			},
			hide: () => picker.hide()
		};

		return picker;
	}

	override async input(): Promise<string> {
		return this.inputs.shift()!;
	}
}

suite('Tab Group Commands', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTabGroupCommands';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTabGroupCommands';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
		disposables.add(registerTestFileEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	async function createTabGroup(options: { saved: boolean; locked: boolean }): Promise<{ instantiationService: ReturnType<typeof workbenchInstantiationService>; group: IEditorGroupView; tabGroup: IEditorTabGroup; closedGroups: string[]; historyService: IHistoryService }> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		const group = part.activeGroup;

		const editors: EditorInput[] = [];
		for (const name of ['first', 'second', 'other']) {
			const editor = disposables.add(new TestFileEditorInput(URI.parse(`foo://${name}`), TEST_EDITOR_INPUT_ID));
			await group.openEditor(editor, { pinned: true });
			editors.push(editor);
		}
		const tabGroup = group.createTabGroup(editors.slice(0, 2), 'Work', 'blue', options);
		assert.ok(tabGroup);

		const closedGroups: string[] = [];
		const historyService = new class extends mock<IHistoryService>() {
			override saveClosedTabGroup(closedGroup: IEditorTabGroup, closedEditors: readonly { editor: EditorInput; index: number }[]): void {
				closedGroups.push(`${closedGroup.name}: ${closedEditors.map(({ editor, index }) => `${index}=${editor.resource?.authority}`).join(', ')}`);
			}
		};

		return { instantiationService, group, tabGroup, closedGroups, historyService };
	}

	for (const scenario of [
		{ name: 'saved group is closed and recorded', saved: true, locked: false, expected: { editors: ['other'], closedGroups: ['Work: 0=first, 1=second'] } },
		{ name: 'group that is not saved is closed without being recorded', saved: false, locked: false, expected: { editors: ['other'], closedGroups: [] } },
		{ name: 'locked group is left alone', saved: true, locked: true, expected: { editors: ['first', 'second', 'other'], closedGroups: [] } }
	]) {
		test(`close tab group: ${scenario.name}`, async () => {
			const { instantiationService, group, tabGroup, closedGroups, historyService } = await createTabGroup(scenario);

			await closeTabGroup(group, tabGroup, historyService, true);

			assert.deepStrictEqual({ editors: group.editors.map(editor => editor.resource?.authority), closedGroups }, scenario.expected);

			return workbenchTeardown(instantiationService);
		});
	}

	function createSavedGroup(id: string, name: string, color: string, files: string[], icon?: string): ISavedEditorTabGroup {
		return { id, name, color, icon, collapsed: false, locked: false, editors: files.map((file, index) => ({ editor: { resource: URI.file(`/work/${file}`) }, index })) };
	}

	test('saved tab group picks show the color, icon, tab count and tab names of the group', () => {
		const picks = createSavedTabGroupPicks([
			createSavedGroup('alpha', 'Alpha', 'blue', ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'], 'rocket'),
			createSavedGroup('beta', 'Docs $(star)', 'rgb(1, 2, 3)', ['readme.md'])
		], [{ iconClass: 'rename' }, { iconClass: 'delete' }]);

		assert.deepStrictEqual(picks.map(({ groupId, label, description, detail, ariaLabel, iconPath, buttons }) => ({
			groupId,
			label,
			description,
			detail,
			ariaLabel,
			color: /fill="(?<color>[^"]+)"/.exec(decodeURIComponent(iconPath!.dark.toString()))?.groups?.color,
			buttons: buttons?.map(button => button.iconClass)
		})), [{
			groupId: 'beta',
			label: 'Docs \\$(star)',
			description: '1 tab',
			detail: 'readme.md',
			ariaLabel: 'Docs $(star), 1 tab, rgb(1, 2, 3)',
			color: 'rgb(1, 2, 3)',
			buttons: ['rename', 'delete']
		}, {
			groupId: 'alpha',
			label: '$(rocket) Alpha',
			description: '6 tabs',
			detail: 'a.ts, b.ts, c.ts, d.ts, +2 more',
			ariaLabel: 'Alpha, 6 tabs, Blue',
			color: '#60a5fa',
			buttons: ['rename', 'delete']
		}]);
	});

	test('saved tab groups quick pick deletes, renames and opens groups', async () => {
		let savedGroups = [createSavedGroup('alpha', 'Alpha', 'blue', ['a.ts', 'b.ts'], 'rocket'), createSavedGroup('beta', 'Beta', 'red', ['c.ts'])];
		const calls: string[] = [];
		const historyService = new class extends mock<IHistoryService>() {
			override getSavedTabGroups() { return savedGroups; }
			override deleteSavedTabGroup(id: string) {
				calls.push(`delete ${id}`);
				savedGroups = savedGroups.filter(group => group.id !== id);
			}
			override renameSavedTabGroup(id: string, name: string) {
				calls.push(`rename ${id} to ${name}`);
				savedGroups = savedGroups.map(group => group.id === id ? { ...group, name } : group);
			}
			override async reopenSavedTabGroup(id: string, groupId?: number) { calls.push(`open ${id} in group ${groupId}`); }
		};
		const notificationService = new FakeNotificationService();

		const trace: string[] = [];
		const quickInputService = new FakeQuickInputService([
			picker => {
				trace.push(`pick 1: ${picker.labels.join(' | ')}`);
				picker.triggerButton('Beta', 1);
				trace.push(`pick 1 after delete: ${picker.labels.join(' | ')}, active: ${picker.activeLabels.join(' | ')}`);
				picker.triggerButton('$(rocket) Alpha', 0);
			},
			picker => {
				trace.push(`pick 2: ${picker.labels.join(' | ')}, active: ${picker.activeLabels.join(' | ')}`);
				picker.accept('$(rocket) Gamma');
			}
		], ['Gamma']);

		await showSavedTabGroups(quickInputService, historyService, notificationService, 7);

		assert.deepStrictEqual({ trace, calls }, {
			trace: [
				'pick 1: Beta | $(rocket) Alpha',
				'pick 1 after delete: $(rocket) Alpha, active: $(rocket) Alpha',
				'pick 2: $(rocket) Gamma, active: $(rocket) Gamma'
			],
			calls: ['delete beta', 'rename alpha to Gamma', 'open alpha in group 7']
		});
	});

	test('deleting a saved tab group from the quick pick can be undone', async () => {
		const alpha = createSavedGroup('alpha', 'Alpha', 'blue', ['a.ts']);
		const beta = createSavedGroup('beta', 'Beta', 'red', ['b.ts']);
		const gamma = createSavedGroup('gamma', 'Gamma', 'green', ['c.ts']);
		let savedGroups = [alpha, beta, gamma];
		const historyService = new class extends mock<IHistoryService>() {
			override getSavedTabGroups() { return savedGroups; }
			override deleteSavedTabGroup(id: string) { savedGroups = savedGroups.filter(group => group.id !== id); }
			override restoreSavedTabGroup(group: ISavedEditorTabGroup, index = savedGroups.length) { savedGroups = savedGroups.toSpliced(index, 0, group); }
		};
		const notificationService = new FakeNotificationService();
		const quickInputService = new FakeQuickInputService([picker => {
			picker.triggerButton('Beta', 1);
			picker.hide();
		}], []);

		await showSavedTabGroups(quickInputService, historyService, notificationService, 7);
		const afterDelete = savedGroups.map(group => group.id);
		const [{ severity, message, choices }] = notificationService.prompts;
		choices[0].run();

		assert.deepStrictEqual({ afterDelete, severity, message, choices: choices.map(choice => choice.label), afterUndo: savedGroups.map(group => group.id) }, {
			afterDelete: ['alpha', 'gamma'],
			severity: Severity.Info,
			message: 'Deleted the saved tab group "Beta".',
			choices: ['Undo'],
			afterUndo: ['alpha', 'beta', 'gamma']
		});
	});

	test('focus next and previous tab group activate the first editor of the group and wrap around', async () => {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);

		// [a1 a2] b [c1 c2] with the last group collapsed
		const group = part.activeGroup;
		const editors = new Map<string, EditorInput>();
		for (const name of ['a1', 'a2', 'b', 'c1', 'c2']) {
			const editor = disposables.add(new TestFileEditorInput(URI.parse(`foo://${name}`), TEST_EDITOR_INPUT_ID));
			await group.openEditor(editor, { pinned: true });
			editors.set(name, editor);
		}
		group.createTabGroup([editors.get('a1')!, editors.get('a2')!], 'A', 'blue');
		const collapsedGroup = group.createTabGroup([editors.get('c1')!, editors.get('c2')!], 'C', 'red', { collapsed: true });
		assert.ok(collapsedGroup);

		const results: { from: string; direction: 'next' | 'previous'; active: string | undefined; collapsed: boolean }[] = [];
		for (const [from, direction] of [['b', 'next'], ['c2', 'next'], ['a2', 'previous'], ['b', 'previous'], ['a1', 'next'], ['c1', 'previous']] as const) {
			await group.openEditor(editors.get(from)!);
			await focusAdjacentTabGroup(group, editorService, direction);
			results.push({ from, direction, active: group.activeEditor?.resource?.authority, collapsed: collapsedGroup.collapsed });
		}

		assert.deepStrictEqual(results, [
			{ from: 'b', direction: 'next', active: 'c1', collapsed: false },
			{ from: 'c2', direction: 'next', active: 'a1', collapsed: false },
			{ from: 'a2', direction: 'previous', active: 'c1', collapsed: false },
			{ from: 'b', direction: 'previous', active: 'a1', collapsed: false },
			{ from: 'a1', direction: 'next', active: 'c1', collapsed: false },
			{ from: 'c1', direction: 'previous', active: 'a1', collapsed: false }
		]);

		return workbenchTeardown(instantiationService);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
