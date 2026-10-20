/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, Dimension, reset, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDnd.js';
import { ITreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDndService.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { VerticalEditorTabsControl } from '../../../../browser/parts/editor/verticalEditorTabsControl.js';
import { EditorInputCapabilities, EditorsOrder, IEditorPartOptions } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { TestFileEditorInput, workbenchInstantiationService } from '../../workbenchTestServices.js';

class TestEditorInput extends TestFileEditorInput {

	constructor(resource: URI, private name: string) {
		super(resource, 'testEditorInput');
	}

	override getName(): string { return this.name; }

	setName(name: string): void { this.name = name; }
}

suite('VerticalEditorTabsControl', () => {

	let disposables: DisposableStore;

	let container: HTMLElement;
	let control: VerticalEditorTabsControl;
	let partOptions: IEditorPartOptions;
	let model: EditorGroupModel;
	let openedEditors: EditorInput[];
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let groupView: IEditorGroupView;
	let groupsView: IEditorGroupsView;
	let editorPartsView: IEditorPartsView;

	function openEditor(name: string, options: { pinned?: boolean } = { pinned: true }): TestEditorInput {
		const editor = disposables.add(new TestEditorInput(URI.file(`/path/${name}`), name));
		model.openEditor(editor, { ...options, active: model.count === 0, index: model.count });
		return editor;
	}

	function createControl(): VerticalEditorTabsControl {
		return disposables.add(instantiationService.createInstance(VerticalEditorTabsControl, container, editorPartsView, groupsView, groupView, model, undefined, false, false));
	}

	/**
	 * Lays the control out with the given height, so that row sizes and overflow are
	 * real (the stylesheet is applied through the ancestry mounted in `setup`).
	 */
	function layoutControl(height: number, width = 240): void {
		control.layout({ container: new Dimension(width, height), available: new Dimension(width, height) });
	}

	function rows(): HTMLElement[] {
		return Array.from(container.querySelectorAll<HTMLElement>('.vertical-tab'));
	}

	function activeElement(): HTMLElement | null {
		return mainWindow.document.activeElement as HTMLElement | null;
	}

	function waitForAnimationFrame(): Promise<void> {
		return new Promise<void>(resolve => disposables.add(scheduleAtNextAnimationFrame(mainWindow, () => resolve())));
	}

	setup(() => {
		disposables = new DisposableStore();
		partOptions = { ...DEFAULT_EDITOR_PART_OPTIONS };
		openedEditors = [];

		instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(ITreeViewsDnDService, new TreeViewsDnDService());
		instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());

		model = disposables.add(instantiationService.createInstance(EditorGroupModel, undefined));

		groupView = new class extends mock<IEditorGroupView>() {
			override get id() { return model.id; }
			override get count() { return model.count; }
			override get stickyCount() { return model.stickyCount; }
			override get activeEditor() { return model.activeEditor; }
			override get selectedEditors() { return model.selectedEditors; }
			override get ariaLabel() { return 'Editor Group 1'; }
			override get groupsView(): IEditorGroupsView { return groupsView; }
			override getIndexOfEditor(editor: EditorInput) { return model.indexOf(editor); }
			override getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }) { return model.getEditors(order, options); }
			override isActive(editor: EditorInput) { return model.isActive(editor); }
			override isPinned(editorOrIndex: EditorInput | number) { return model.isPinned(editorOrIndex); }
			override isSticky(editorOrIndex: EditorInput | number) { return model.isSticky(editorOrIndex); }
			override isSelected(editorOrIndex: EditorInput | number) { return model.isSelected(editorOrIndex); }
			override setTabGroupCollapsed(groupId: string, collapsed: boolean) { model.setTabGroupCollapsed(groupId, collapsed); }
			override createEditorActions() { return { actions: { primary: [], secondary: [] }, onDidChange: Event.None }; }
			override async openEditor(editor: EditorInput) {
				openedEditors.push(editor);
				return undefined;
			}
			override relayout() { }
			override readonly onDidActiveEditorChange = Event.None;
		};

		groupsView = new class extends mock<IEditorGroupsView>() {
			override get partOptions() { return partOptions; }
			override get activeGroup(): IEditorGroupView { return groupView; }
			override get groups(): IEditorGroupView[] { return [groupView]; }
			override readonly onDidChangeEditorPartOptions = Event.None;
			override readonly onDidVisibilityChange = Event.None;
		};

		editorPartsView = new class extends mock<IEditorPartsView>() {
			override get count() { return 1; }
			override getGroup() { return groupView; }
		};

		const workbench = $('.monaco-workbench');
		const part = $('.part.editor');
		const content = $('.content');
		const group = $('.editor-group-container.active');
		const body = $('.editor-group-body.vertical-tabs-left');
		container = $('.vertical-tabs-container');
		workbench.appendChild(part);
		part.appendChild(content);
		content.appendChild(group);
		group.appendChild(body);
		body.appendChild(container);
		mainWindow.document.body.appendChild(workbench);
		disposables.add({ dispose: () => workbench.remove() });

		for (let i = 0; i < 12; i++) {
			openEditor(`file${i}.txt`);
		}
		control = createControl();
	});

	teardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	function wheel(options: { shiftKey?: boolean; deltaX?: number; deltaY?: number }): { prevented: boolean; opened: string[] } {
		openedEditors = [];
		const event = new WheelEvent('wheel', { deltaX: options.deltaX ?? 0, deltaY: options.deltaY ?? 100, shiftKey: options.shiftKey ?? false, bubbles: true, cancelable: true });
		container.querySelector('.vertical-tab')!.dispatchEvent(event);
		return { prevented: event.defaultPrevented, opened: openedEditors.map(editor => editor.getName()) };
	}

	test('mouse wheel scrolls an overflowing list and only switches tabs when it fits or Shift is held', () => {
		partOptions = { ...partOptions, scrollToSwitchTabs: true };
		const result: Record<string, { prevented: boolean; opened: string[] }> = {};

		layoutControl(200);
		result.overflowingPlain = wheel({});
		result.overflowingShift = wheel({ shiftKey: true });
		result.overflowingShiftReportedHorizontally = wheel({ shiftKey: true, deltaX: 100, deltaY: 0 });

		layoutControl(1000);
		result.fittingPlain = wheel({});
		result.fittingShift = wheel({ shiftKey: true });

		partOptions = { ...partOptions, scrollToSwitchTabs: false };
		result.fittingPlainSettingOff = wheel({});

		assert.deepStrictEqual(result, {
			overflowingPlain: { prevented: false, opened: [] },
			overflowingShift: { prevented: true, opened: ['file1.txt'] },
			overflowingShiftReportedHorizontally: { prevented: true, opened: ['file1.txt'] },
			fittingPlain: { prevented: true, opened: ['file1.txt'] },
			fittingShift: { prevented: true, opened: ['file1.txt'] },
			fittingPlainSettingOff: { prevented: false, opened: [] }
		});
	});

	test('non-structural updates change the affected row in place and keep keyboard focus', () => {
		const before = rows();
		const editor = model.getEditorByIndex(2) as TestEditorInput;
		before[2].focus();

		editor.setDirty();
		control.updateEditorDirty(editor);
		editor.setName('renamed.txt');
		control.updateEditorLabel(editor);
		editor.capabilities = EditorInputCapabilities.CannotClose;
		control.updateEditorCapabilities(editor);

		assert.deepStrictEqual({
			rowsKept: rows().every((row, index) => row === before[index]),
			focused: activeElement() === before[2],
			dirty: before[2].classList.contains('dirty'),
			name: before[2].querySelector('.label-name')?.textContent,
			resourceName: before[2].dataset.resourceName,
			closeActions: before[2].querySelectorAll('.vertical-tab-actions .action-item').length,
			otherRowCloseActions: before[3].querySelectorAll('.vertical-tab-actions .action-item').length
		}, {
			rowsKept: true,
			focused: true,
			dirty: true,
			name: 'renamed.txt',
			resourceName: 'file2.txt',
			closeActions: 0,
			otherRowCloseActions: 1
		});
	});

	test('pinning a preview editor updates its row in place', () => {
		const preview = openEditor('preview.txt', { pinned: false });
		control.openEditors([preview]);
		const row = rows().at(-1)!;
		const isItalic = () => row.querySelector('.vertical-tab-label')!.classList.contains('italic');
		const wasItalic = isItalic();

		model.pin(preview);
		control.pinEditor(preview);

		assert.deepStrictEqual({ wasItalic, isItalic: isItalic(), rowKept: rows().at(-1) === row }, { wasItalic: true, isItalic: false, rowKept: true });
	});

	test('decoration changes refresh labels without recreating rows', async () => {
		control.dispose();
		reset(container);
		const service = disposables.add(instantiationService.createInstance(DecorationsService));
		instantiationService.stub(IDecorationsService, service);
		const changed = disposables.add(new Emitter<readonly URI[]>());
		const resource = model.getEditorByIndex(1)!.resource!;
		let decorated = false;
		disposables.add(service.registerDecorationsProvider({
			label: 'Vertical tab badge',
			onDidChange: changed.event,
			provideDecorations: uri => decorated && uri.toString() === resource.toString() ? { letter: 'M', tooltip: 'Modified' } : undefined,
		}));
		partOptions = { ...partOptions, decorations: { badges: true, colors: true } };
		control = createControl();

		const before = rows();
		decorated = true;
		changed.fire([resource]);
		const deadline = Date.now() + 3000;
		while (!before[1].querySelector('.vertical-tab-label')!.classList.contains('monaco-decoration-badge')) {
			if (Date.now() >= deadline) {
				assert.fail('The decoration badge was not rendered');
			}
			await waitForAnimationFrame();
		}

		assert.deepStrictEqual({ rowsKept: rows().every((row, index) => row === before[index]), count: rows().length }, { rowsKept: true, count: 12 });
	});

	test('a full redraw restores focus to the row of the focused editor', () => {
		const before = rows();
		before[3].focus();

		const closed = model.getEditorByIndex(5)!;
		model.closeEditor(closed);
		control.closeEditor(closed);

		assert.deepStrictEqual({
			count: rows().length,
			oldRowRemoved: !before[3].isConnected,
			focusedEditor: activeElement()?.dataset.resourceName
		}, {
			count: 11,
			oldRowRemoved: true,
			focusedEditor: 'file3.txt'
		});
	});

	test('a full redraw moves focus to the active row when the focused editor is closed', () => {
		rows()[4].focus();

		const closed = model.getEditorByIndex(4)!;
		model.closeEditor(closed);
		control.closeEditor(closed);

		assert.strictEqual(activeElement()?.dataset.resourceName, model.activeEditor?.getName());
	});

	test('tab group headers refresh their unsaved status in place and keep focus', () => {
		const editors = model.getEditors(EditorsOrder.SEQUENTIAL).slice(0, 3);
		model.createTabGroup(editors, 'Work', 'blue');
		const header = container.querySelector<HTMLElement>('.vertical-tab-group-header')!;
		header.focus();
		const dirtyIndicators = () => header.querySelectorAll('.vertical-tab-group-dirty').length;
		const initial = dirtyIndicators();

		(editors[1] as TestEditorInput).setDirty();
		control.updateEditorDirty(editors[1]);

		assert.deepStrictEqual({
			initial,
			dirty: dirtyIndicators(),
			ariaLabel: header.getAttribute('aria-label'),
			headerKept: container.querySelector('.vertical-tab-group-header') === header,
			focused: activeElement() === header
		}, {
			initial: 0,
			dirty: 1,
			ariaLabel: 'Work, expanded, 3 editors, 1 unsaved',
			headerKept: true,
			focused: true
		});
	});

	test('toggling a tab group keeps focus on its header', () => {
		const editors = model.getEditors(EditorsOrder.SEQUENTIAL).slice(0, 3);
		const tabGroup = model.createTabGroup(editors, 'Work', 'blue')!;
		container.querySelector<HTMLElement>('.vertical-tab-group-header')!.focus();

		container.querySelector<HTMLElement>('.vertical-tab-group-header')!.click();

		assert.deepStrictEqual({
			collapsed: tabGroup.collapsed,
			focusedGroup: activeElement()?.dataset.tabGroupId === tabGroup.id,
			expanded: container.querySelector('.vertical-tab-group-header')!.getAttribute('aria-expanded')
		}, {
			collapsed: true,
			focusedGroup: true,
			expanded: 'false'
		});
	});
});
