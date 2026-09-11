/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, EventType, ModifierKeyEmitter } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDnd.js';
import { ITreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDndService.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { MultiEditorTabsControl } from '../../../../browser/parts/editor/multiEditorTabsControl.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { TestFileEditorInput, TestHostService, workbenchInstantiationService } from '../../workbenchTestServices.js';

suite('MultiEditorTabsControl', () => {

	let disposables: DisposableStore;

	let container: HTMLElement;
	let hostService: TestHostService;
	let model: EditorGroupModel;

	setup(() => {
		disposables = new DisposableStore();

		// The tabs control resolves the shared modifier key emitter on creation,
		// so dispose it again to keep each test independent of the Alt state that
		// other suites may have left behind
		disposables.add(toDisposable(() => ModifierKeyEmitter.disposeInstance()));

		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(ITreeViewsDnDService, new TreeViewsDnDService());
		instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());

		hostService = instantiationService.get(IHostService) as TestHostService;

		model = disposables.add(instantiationService.createInstance(EditorGroupModel, undefined));
		for (let i = 0; i < 2; i++) {
			const editor = disposables.add(new TestFileEditorInput(URI.file(`/path/file${i}.txt`), 'testEditorInput'));
			model.openEditor(editor, { pinned: true, active: i === 0 });
		}

		const groupView = new class extends mock<IEditorGroupView>() {
			override get id() { return model.id; }
			override get count() { return model.count; }
			override get stickyCount() { return model.stickyCount; }
			override get activeEditor() { return model.activeEditor; }
			override get activeEditorPane() { return undefined; }
			override get selectedEditors() { return model.selectedEditors; }
			override get ariaLabel() { return 'Editor Group 1'; }
			override get groupsView(): IEditorGroupsView { return groupsView; }
			override getEditorByIndex(index: number) { return model.getEditorByIndex(index); }
			override getIndexOfEditor(editor: EditorInput) { return model.indexOf(editor); }
			override getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }) { return model.getEditors(order, options); }
			override get tabGroups() { return model.tabGroups; }
			override getTabGroupForEditor(editor: EditorInput) { return model.getTabGroupForEditor(editor); }
			override createTabGroup(editors: EditorInput[], name?: string, color?: string) { return model.createTabGroup(editors, name, color); }
			override dissolveTabGroup(groupId: string) { model.dissolveTabGroup(groupId); }
			override addToTabGroup(groupId: string, editors: EditorInput[]) { model.addToTabGroup(groupId, editors); }
			override renameTabGroup(groupId: string, name: string) { model.renameTabGroup(groupId, name); }
			override recolorTabGroup(groupId: string, color: string) { model.recolorTabGroup(groupId, color); }
			override setTabGroupSaved(groupId: string, saved: boolean) { model.setTabGroupSaved(groupId, saved); }
			override setTabGroupLocked(groupId: string, locked: boolean) { model.setTabGroupLocked(groupId, locked); }
			override get canUndoTabGroupAction() { return model.canUndoTabGroupAction; }
			override undoLastTabGroupAction() { return model.undoLastTabGroupAction(); }
			override isActive(editor: EditorInput) { return model.isActive(editor); }
			override isPinned(editorOrIndex: EditorInput | number) { return model.isPinned(editorOrIndex); }
			override isSticky(editorOrIndex: EditorInput | number) { return model.isSticky(editorOrIndex); }
			override isSelected(editorOrIndex: EditorInput | number) { return model.isSelected(editorOrIndex); }
			override createEditorActions() { return { actions: { primary: [], secondary: [] }, onDidChange: Event.None }; }
			override relayout() { }
			override readonly onDidActiveEditorChange = Event.None;
		};

		const groupsView = new class extends mock<IEditorGroupsView>() {
			override get partOptions() { return DEFAULT_EDITOR_PART_OPTIONS; }
			override get activeGroup(): IEditorGroupView { return groupView; }
			override get groups(): IEditorGroupView[] { return [groupView]; }
			override readonly onDidChangeEditorPartOptions = Event.None;
			override readonly onDidVisibilityChange = Event.None;
		};

		const editorPartsView = new class extends mock<IEditorPartsView>() {
			override get count() { return 1; }
			override getGroup() { return groupView; }
		};

		container = $('.title.tabs');
		mainWindow.document.body.appendChild(container);

		const control = disposables.add(instantiationService.createInstance(MultiEditorTabsControl, container, editorPartsView, groupsView, groupView, model, undefined, false, false));
		control.openEditors(model.getEditors(EditorsOrder.SEQUENTIAL));
	});

	teardown(() => {
		container.remove();
		disposables.dispose();
	});

	function tabActions(): string[] {
		return Array.from(container.querySelectorAll('.tabs-container > .tab')).map(tab => {
			const action = tab.querySelector('.tab-actions .action-label');
			if (action?.classList.contains('codicon-close-all')) {
				return 'closeOthers';
			}

			return action?.classList.contains('codicon-close-small') ? 'close' : 'unknown';
		});
	}

	function hoverTab(tabIndex: number): void {
		container.querySelectorAll('.tabs-container > .tab')[tabIndex].dispatchEvent(new MouseEvent(EventType.MOUSE_ENTER));
	}

	function moveMouseOverTabs(altKey: boolean): void {
		container.querySelector('.tabs-container')!.dispatchEvent(new MouseEvent(EventType.MOUSE_MOVE, { altKey, bubbles: true }));
	}

	function mouseDownOnTabAction(tabIndex: number, altKey: boolean): void {
		container.querySelectorAll('.tabs-container > .tab')[tabIndex].querySelector('.tab-actions .action-label')!.dispatchEvent(new MouseEvent(EventType.MOUSE_DOWN, { altKey, bubbles: true, cancelable: true }));
	}

	function alt(pressed: boolean): void {
		mainWindow.dispatchEvent(new KeyboardEvent(pressed ? EventType.KEY_DOWN : EventType.KEY_UP, { key: 'Alt', altKey: pressed }));
	}

	test('tab group context menu exposes identity, colors and group actions', () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL), 'Work', 'blue');
		assert.ok(tabGroup);

		const header = container.querySelector<HTMLElement>('.tab-group-header');
		assert.ok(header);
		header.dispatchEvent(new MouseEvent(EventType.CONTEXT_MENU, { bubbles: true, cancelable: true, button: 2 }));

		const menu = mainWindow.document.querySelector<HTMLElement>('.context-view.tab-group-context-view .tab-group-context-menu');
		const nameInput = menu?.querySelector<HTMLInputElement>('.tab-group-menu-name');
		const colorButtons = Array.from(menu?.querySelectorAll<HTMLButtonElement>('.tab-group-menu-color') ?? []);
		const actionLabels = Array.from(menu?.querySelectorAll<HTMLElement>('.tab-group-menu-action-label') ?? []).map(element => element.textContent);

		assert.deepStrictEqual({
			name: nameInput?.value,
			colors: colorButtons.length,
			selectedColor: colorButtons.find(button => button.classList.contains('selected'))?.getAttribute('aria-label'),
			actions: actionLabels
		}, {
			name: 'Work',
			colors: 8,
			selectedColor: 'Blue',
			actions: ['New Tab in Group', 'Move Group into New Window', 'Close Group', 'Ungroup Tabs']
		});

		colorButtons.find(button => button.getAttribute('aria-label') === 'Red')?.click();
		assert.strictEqual(tabGroup.color, 'red');

		assert.ok(nameInput);
		nameInput.value = 'Frontend';
		nameInput.dispatchEvent(new InputEvent(EventType.INPUT, { bubbles: true }));
		nameInput.dispatchEvent(new KeyboardEvent(EventType.KEY_DOWN, { key: 'Enter', bubbles: true }));
		assert.strictEqual(tabGroup.name, 'Frontend');
	});

	test('tab group context menu closes on outside pointer and focus loss', () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL), 'Work', 'blue');
		assert.ok(tabGroup);

		const header = container.querySelector<HTMLElement>('.tab-group-header');
		assert.ok(header);

		const openMenu = () => {
			header.dispatchEvent(new MouseEvent(EventType.CONTEXT_MENU, { bubbles: true, cancelable: true, button: 2 }));
			const contextView = mainWindow.document.querySelector<HTMLElement>('.context-view.tab-group-context-view');
			assert.ok(contextView);
			assert.notStrictEqual(contextView.style.display, 'none');
			return contextView;
		};

		let contextView = openMenu();
		mainWindow.document.body.dispatchEvent(new PointerEvent(EventType.POINTER_DOWN, { bubbles: true }));
		assert.strictEqual(contextView.style.display, 'none');

		contextView = openMenu();
		const nameInput = contextView.querySelector<HTMLInputElement>('.tab-group-menu-name');
		assert.ok(nameInput);
		const outside = mainWindow.document.body.appendChild(document.createElement('button'));
		nameInput.focus();
		outside.focus();
		assert.strictEqual(contextView.style.display, 'none');
		outside.remove();
	});

	test('Alt swaps the close action of the hovered tab only', () => {
		const actions = [tabActions()];

		hoverTab(0);
		alt(true);
		actions.push(tabActions());

		alt(false);
		actions.push(tabActions());

		assert.deepStrictEqual(actions, [
			['close', 'close'],
			['closeOthers', 'close'],
			['close', 'close']
		]);
	});

	test('Alt does not stay armed when the window loses focus (#331979)', () => {
		hoverTab(0);
		alt(true);

		const actions = [tabActions()];

		// Alt+Tab to another application: the `keyup` for Alt is
		// delivered to that application and never seen here
		hostService.setFocus(false);
		ModifierKeyEmitter.getInstance().resetKeyStatus();
		actions.push(tabActions());

		// Alt being reported as pressed again when focus returns must not
		// swap the action of a tab that is still hovered from before
		hostService.setFocus(true);
		alt(true);
		actions.push(tabActions());

		// Hovering a tab again arms the swap as usual
		hoverTab(0);
		actions.push(tabActions());

		assert.deepStrictEqual(actions, [
			['closeOthers', 'close'],
			['close', 'close'],
			['close', 'close'],
			['closeOthers', 'close']
		]);
	});

	test('Alt is revalidated from mouse events over the tabs (#331979)', () => {
		hoverTab(0);
		alt(true);

		const actions = [tabActions()];

		// The `keyup` for Alt went to another application, so only the
		// next mouse event reveals that Alt is no longer pressed
		moveMouseOverTabs(false);
		actions.push(tabActions());

		assert.deepStrictEqual(actions, [
			['closeOthers', 'close'],
			['close', 'close']
		]);
	});

	test('Alt is revalidated when pressing the tab action without moving the mouse (#331979)', () => {
		hoverTab(0);
		alt(true);

		const actions = [tabActions()];

		mouseDownOnTabAction(0, false);
		actions.push(tabActions());

		assert.deepStrictEqual(actions, [
			['closeOthers', 'close'],
			['close', 'close']
		]);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
