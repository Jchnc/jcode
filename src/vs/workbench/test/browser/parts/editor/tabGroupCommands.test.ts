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
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { INotificationHandle, INotificationService, IPromptChoice, NoOpNotification } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputHideEvent, IQuickPick, IQuickPickDidAcceptEvent, IQuickPickItem, IQuickPickItemButtonEvent, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { closeTabGroup, createSavedTabGroupPicks, focusAdjacentTabGroup, moveEditorByTabs, showSavedTabGroups } from '../../../../browser/parts/editor/editorCommands.js';
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

	test('focus next and previous tab group activate the first editor of an expanded group, the last active editor of a collapsed group and wrap around', async () => {
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

		await group.openEditor(editors.get('c1')!); // the last active editor of the collapsed group

		const results: { from: string; direction: 'next' | 'previous'; active: string | undefined; collapsed: boolean }[] = [];
		for (const [from, direction] of [['b', 'next'], ['c2', 'next'], ['a2', 'previous'], ['b', 'previous'], ['a1', 'next'], ['c1', 'previous']] as const) {
			await group.openEditor(editors.get(from)!);
			await focusAdjacentTabGroup(group, editorService, direction);
			results.push({ from, direction, active: group.activeEditor?.resource?.authority, collapsed: collapsedGroup.collapsed });
		}

		assert.deepStrictEqual(results, [
			{ from: 'b', direction: 'next', active: 'c1', collapsed: true },
			{ from: 'c2', direction: 'next', active: 'a1', collapsed: true },
			{ from: 'a2', direction: 'previous', active: 'c2', collapsed: true },
			{ from: 'b', direction: 'previous', active: 'a1', collapsed: true },
			{ from: 'a1', direction: 'next', active: 'c2', collapsed: true },
			{ from: 'c1', direction: 'previous', active: 'a1', collapsed: true }
		]);

		return workbenchTeardown(instantiationService);
	});

	suite('move editor left and right', () => {

		/** Opens pinned editors with the given names and creates the tab groups, each with the names of its members. */
		async function createLayout(names: string[], tabGroups: { members: string[]; collapsed?: boolean; locked?: boolean }[] = []) {
			const instantiationService = workbenchInstantiationService(undefined, disposables);
			const part = await createEditorPart(instantiationService, disposables);
			const group = part.activeGroup;

			const editors = new Map<string, EditorInput>();
			for (const name of names) {
				const editor = disposables.add(new TestFileEditorInput(URI.parse(`foo://${name}`), TEST_EDITOR_INPUT_ID));
				await group.openEditor(editor, { pinned: true });
				editors.set(name, editor);
			}
			for (const { members, collapsed, locked } of tabGroups) {
				group.createTabGroup(members.map(name => editors.get(name)!), 'G', 'blue', { collapsed, locked });
			}

			/** Moves an editor and describes the editors in order, followed by the tab group they are in, if any. */
			const move = (name: string, direction: 'left' | 'right', count = 1) => {
				moveEditorByTabs(group, editors.get(name)!, direction, count);

				return group.editors.map(editor => `${editor.resource?.authority}${group.getTabGroupForEditor(editor) ? ':G' : ''}`).join(' ');
			};

			return { instantiationService, part, group, editors, move };
		}

		test('an editor enters a tab group, steps through it and leaves it again one step at a time', async () => {
			const { instantiationService, move } = await createLayout(['a', 'b', 'c', 'd', 'e'], [{ members: ['c', 'd'] }]);

			const steps = Array.from({ length: 7 }, () => move('a', 'right'));

			assert.deepStrictEqual(steps, [
				'b a c:G d:G e', // past an editor
				'b a:G c:G d:G e', // joins the group without moving
				'b c:G a:G d:G e',
				'b c:G d:G a:G e',
				'b c:G d:G a e', // leaves the group without moving
				'b c:G d:G e a',
				'b c:G d:G e a'
			]);

			return workbenchTeardown(instantiationService);
		});

		test('moving left mirrors moving right', async () => {
			const { instantiationService, move } = await createLayout(['b', 'c', 'd', 'e', 'a'], [{ members: ['c', 'd'] }]);

			const steps = Array.from({ length: 7 }, () => move('a', 'left'));

			assert.deepStrictEqual(steps, [
				'b c:G d:G a e',
				'b c:G d:G a:G e',
				'b c:G a:G d:G e',
				'b a:G c:G d:G e',
				'b a c:G d:G e',
				'a b c:G d:G e',
				'a b c:G d:G e'
			]);

			return workbenchTeardown(instantiationService);
		});

		test('moving several tabs at once goes through the tab groups one step at a time', async () => {
			const { instantiationService, move } = await createLayout(['a', 'b', 'c', 'd'], [{ members: ['c', 'd'] }]);

			assert.deepStrictEqual([move('a', 'right', 3), move('a', 'right', 2)], ['b c:G a:G d:G', 'b c:G d:G a']);

			return workbenchTeardown(instantiationService);
		});

		test('the only editor of a tab group leaves the group before it moves', async () => {
			const { instantiationService, group, move } = await createLayout(['a', 'b', 'c'], [{ members: ['b'] }]);

			const leaving = move('b', 'right');
			const groupsAfterLeaving = group.tabGroups.length;

			assert.deepStrictEqual({ leaving, groupsAfterLeaving, moving: move('b', 'right') }, { leaving: 'a b c', groupsAfterLeaving: 0, moving: 'a c b' });

			return workbenchTeardown(instantiationService);
		});

		test('a collapsed tab group is skipped as a whole', async () => {
			const { instantiationService, move } = await createLayout(['a', 'b', 'c', 'd', 'e'], [{ members: ['b', 'c', 'd'], collapsed: true }]);

			const movingRight = move('a', 'right');
			const movingLeft = move('a', 'left');

			assert.deepStrictEqual({ movingRight, movingLeft }, { movingRight: 'b:G c:G d:G a e', movingLeft: 'a b:G c:G d:G e' });

			return workbenchTeardown(instantiationService);
		});

		test('the editor that is shown for a collapsed tab group leaves the group before it moves', async () => {
			const { instantiationService, group, editors, move } = await createLayout(['a', 'b', 'c', 'd', 'e'], [{ members: ['b', 'c', 'd'], collapsed: true }]);
			await group.openEditor(editors.get('c')!);

			const leaving = move('c', 'right');
			const moving = move('c', 'right');

			assert.deepStrictEqual({ leaving, moving }, { leaving: 'a b:G d:G c e', moving: 'a b:G d:G e c' });

			return workbenchTeardown(instantiationService);
		});

		test('the editor that is shown for a collapsed tab group leaves the group to the side it moves to', async () => {
			const { instantiationService, group, editors, move } = await createLayout(['a', 'b', 'c', 'd', 'e'], [{ members: ['b', 'c', 'd'], collapsed: true }]);

			await group.openEditor(editors.get('c')!);
			const leavingMiddleToTheLeft = move('c', 'left');
			await group.openEditor(editors.get('b')!);
			const leavingFirstToTheRight = move('b', 'right');

			assert.deepStrictEqual({ leavingMiddleToTheLeft, leavingFirstToTheRight }, {
				leavingMiddleToTheLeft: 'a c b:G d:G e',
				leavingFirstToTheRight: 'a c d:G b e'
			});

			return workbenchTeardown(instantiationService);
		});

		test('a sticky editor that leaves the sticky editors skips a collapsed tab group', async () => {
			const { instantiationService, group, editors, move } = await createLayout(['a', 'b', 'c', 'd'], [{ members: ['b', 'c'], collapsed: true }]);
			group.stickEditor(editors.get('a')!);

			assert.deepStrictEqual({ layout: move('a', 'right'), sticky: group.isSticky(editors.get('a')!) }, { layout: 'b:G c:G a d', sticky: false });

			return workbenchTeardown(instantiationService);
		});

		test('a locked tab group keeps its editors and is skipped by the editors next to it', async () => {
			const { instantiationService, move } = await createLayout(['a', 'b', 'c', 'd'], [{ members: ['b', 'c'], locked: true }]);

			const movingPast = move('a', 'right');
			const movingInside = move('b', 'right');
			const movingOut = move('b', 'right', 2);

			assert.deepStrictEqual({ movingPast, movingInside, movingOut }, { movingPast: 'b:G c:G a d', movingInside: 'c:G b:G a d', movingOut: 'c:G b:G a d' });

			return workbenchTeardown(instantiationService);
		});

		test('tab groups are ignored while they are disabled', async () => {
			const { instantiationService, move } = await createLayout(['a', 'b', 'c', 'd'], [{ members: ['b', 'c'] }]);
			const configurationService = instantiationService.get(IConfigurationService) as TestConfigurationService;

			const key = 'workbench.editor.tabGroups.enabled';
			await configurationService.setUserConfiguration('workbench', { editor: { tabGroups: { enabled: false } } });
			configurationService.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([key]), change: { keys: [key], overrides: [] }, affectsConfiguration: candidate => key.startsWith(candidate) });

			assert.deepStrictEqual([move('a', 'right'), move('a', 'right'), move('c', 'right', 2)], ['b:G a c:G d', 'b:G c:G a d', 'b:G a d c:G']);

			return workbenchTeardown(instantiationService);
		});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
