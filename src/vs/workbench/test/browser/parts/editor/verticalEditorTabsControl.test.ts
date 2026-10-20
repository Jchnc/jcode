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
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { LocalSelectionTransfer } from '../../../../../platform/dnd/browser/dnd.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { DraggedEditorIdentifier } from '../../../../browser/dnd.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { computeVerticalTabsWidth, isVerticalTabsWidthCompact, VerticalEditorTabsControl } from '../../../../browser/parts/editor/verticalEditorTabsControl.js';
import { EditorExtensions, EditorInputCapabilities, EditorsOrder, IEditorFactoryRegistry, IEditorPartOptions } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { createEditorPart, ITestInstantiationService, registerTestEditor, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../workbenchTestServices.js';

/** The `keyCode` of keyboard events as the browser reports it. */
const domKeyCodes = { 'Enter': 13, 'Escape': 27, ' ': 32, 'End': 35, 'Home': 36, 'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40 };

class TestEditorInput extends TestFileEditorInput {

	constructor(resource: URI, private name: string) {
		super(resource, 'testEditorInput');
	}

	private description: string | undefined;

	override getName(): string { return this.name; }

	setName(name: string): void { this.name = name; }

	override getDescription(): string | undefined { return this.description; }

	setDescription(description: string | undefined): void { this.description = description; }
}

suite('VerticalEditorTabsControl', () => {

	let disposables: DisposableStore;

	let container: HTMLElement;
	let control: VerticalEditorTabsControl;
	let partOptions: IEditorPartOptions;
	let model: EditorGroupModel;
	let openedEditors: EditorInput[];
	let calls: string[];
	let workbenchElement: HTMLElement;
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

	/** Names the item that holds focus: a tab by its file name, a tab group header by its name. */
	function focusedItem(): string | undefined {
		const element = activeElement();
		return element?.dataset.tabGroupId ? `group:${element.querySelector('.vertical-tab-group-name')?.textContent}` : element?.dataset.resourceName;
	}

	function pressKey(key: keyof typeof domKeyCodes): boolean {
		const event = new KeyboardEvent('keydown', { key, keyCode: domKeyCodes[key], bubbles: true, cancelable: true } as KeyboardEventInit);
		activeElement()!.dispatchEvent(event);
		return event.defaultPrevented;
	}

	function waitForAnimationFrame(): Promise<void> {
		return new Promise<void>(resolve => disposables.add(scheduleAtNextAnimationFrame(mainWindow, () => resolve())));
	}

	setup(() => {
		disposables = new DisposableStore();
		partOptions = { ...DEFAULT_EDITOR_PART_OPTIONS };
		openedEditors = [];
		calls = [];

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
			override addToTabGroup(groupId: string, editors: EditorInput[]) { model.addToTabGroup(groupId, editors); }
			override removeFromTabGroup(editors: EditorInput[]) { model.removeFromTabGroup(editors); }
			override moveEditor(editor: EditorInput, target: IEditorGroupView, options?: IEditorOptions) {
				model.moveEditor(editor, options?.index ?? model.indexOf(editor));
				return true;
			}
			override focus() { }
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
			override activateGroup() {
				calls.push('activateGroup');
				return groupView;
			}
			override readonly onDidChangeEditorPartOptions = Event.None;
			override readonly onDidVisibilityChange = Event.None;
		};

		editorPartsView = new class extends mock<IEditorPartsView>() {
			override get count() { return 1; }
			override getGroup() { return groupView; }
		};

		const workbench = workbenchElement = $('.monaco-workbench');
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
			ariaLabel: 'Work, 3 tabs, 1 unsaved',
			headerKept: true,
			focused: true
		});
	});

	test('dropping editors before the first tab of a tab group joins them to the group in front, in their order', () => {
		const editors = model.getEditors(EditorsOrder.SEQUENTIAL);
		model.createTabGroup(editors.slice(3, 5), 'Work', 'blue');
		const dropped = [editors[8], editors[7]];
		layoutControl(1000);

		const transfer = LocalSelectionTransfer.getInstance<DraggedEditorIdentifier>();
		transfer.setData(dropped.map(editor => new DraggedEditorIdentifier({ editor, groupId: groupView.id })), DraggedEditorIdentifier.prototype);
		const row = rows()[3];
		row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY: row.getBoundingClientRect().top }));
		transfer.clearData(DraggedEditorIdentifier.prototype);

		assert.deepStrictEqual(model.getEditors(EditorsOrder.SEQUENTIAL).map(editor => `${(editor as TestEditorInput).getName()}${model.getTabGroupForEditor(editor) ? ':Work' : ''}`).slice(2, 9), [
			'file2.txt', 'file8.txt:Work', 'file7.txt:Work', 'file3.txt:Work', 'file4.txt:Work', 'file5.txt', 'file6.txt'
		]);
	});

	test('tab group headers and rows announce their group the way top tabs do, without repeating what aria-expanded says', () => {
		const editors = model.getEditors(EditorsOrder.SEQUENTIAL).slice(0, 2);
		const tabGroup = model.createTabGroup(editors, 'Work', 'blue')!;
		model.setTabGroupSaved(tabGroup.id, true);
		model.setTabGroupLocked(tabGroup.id, true);
		(editors[1] as TestEditorInput).setDirty();
		control.updateEditorDirty(editors[1]);
		const describe = () => {
			const header = container.querySelector<HTMLElement>('.vertical-tab-group-header')!;
			return {
				header: header.getAttribute('aria-label'),
				expanded: header.getAttribute('aria-expanded'),
				rows: rows().filter(row => !row.classList.contains('exiting')).slice(0, 2).map(row => row.getAttribute('aria-label'))
			};
		};

		const expanded = describe();
		model.setTabGroupCollapsed(tabGroup.id, true);
		const collapsed = describe();
		model.renameTabGroup(tabGroup.id, '');
		const unnamed = describe();

		assert.deepStrictEqual({ expanded, collapsed, unnamed }, {
			expanded: { header: 'Work, 2 tabs, 1 unsaved, saved, locked', expanded: 'true', rows: ['file0.txt, tab group Work', 'file1.txt, tab group Work'] },
			collapsed: { header: 'Work, 2 tabs, 1 unsaved, saved, locked', expanded: 'false', rows: ['file0.txt, tab group Work, collapsed', 'file2.txt'] },
			unnamed: { header: 'Tab Group, 2 tabs, 1 unsaved, saved, locked', expanded: 'false', rows: ['file0.txt, tab group Tab Group, collapsed', 'file2.txt'] }
		});
	});

	function filterBar(): HTMLElement {
		return container.querySelector<HTMLElement>('.vertical-tabs-filter')!;
	}

	function filterInput(): HTMLInputElement {
		return filterBar().querySelector<HTMLInputElement>('input')!;
	}

	function filterToggle(): HTMLButtonElement {
		return container.querySelector<HTMLButtonElement>('.vertical-tabs-filter-toggle')!;
	}

	function typeFilter(text: string): void {
		const input = filterInput();
		input.value = text;
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}

	/** The tabs by their file name and the tab group headers by their name in brackets, in the order of the list. */
	function listedItems(): string[] {
		return Array.from(container.querySelectorAll<HTMLElement>('.vertical-tabs-list > :is(.vertical-tab:not(.exiting), .vertical-tab-group-header)'))
			.map(element => element.dataset.tabGroupId ? `[${element.querySelector('.vertical-tab-group-name')?.textContent}]` : element.dataset.resourceName!);
	}

	test('the Filter Tabs button reveals a quick filter that narrows the list by name and path and highlights what matched', () => {
		(model.getEditorByIndex(2) as TestEditorInput).setDescription('src/app');
		(model.getEditorByIndex(3) as TestEditorInput).setDescription('tests/app');
		const highlighted = (selector: string) => rows().map(row => Array.from(row.querySelectorAll(`${selector} .highlight`)).map(element => element.textContent).join('+')).filter(text => text);
		const describeFilter = () => ({
			hidden: filterBar().hidden,
			pressed: filterToggle().getAttribute('aria-pressed'),
			focusInInput: activeElement() === filterInput()
		});

		const initial = { hidden: filterBar().hidden, pressed: filterToggle().getAttribute('aria-pressed'), label: filterToggle().getAttribute('aria-label'), input: !!container.querySelector('.vertical-tabs-filter input') };
		filterToggle().click();
		const revealed = { ...describeFilter(), placeholder: filterInput().placeholder, label: filterInput().getAttribute('aria-label') };

		typeFilter('FILE1');
		const byName = { items: listedItems(), names: highlighted('.label-name'), descriptions: rows().map(row => row.querySelector('.label-description')?.textContent) };
		typeFilter('app');
		const byPath = { items: listedItems(), names: highlighted('.label-name'), descriptions: highlighted('.label-description') };
		typeFilter('file2 tests');
		const termsOfDifferentTabs = listedItems();
		typeFilter('zzz');
		const noMatches = { items: listedItems(), message: container.querySelector('.vertical-tabs-filter-empty')?.textContent };
		typeFilter('');
		const cleared = listedItems().length;
		filterToggle().click();

		assert.deepStrictEqual({ initial, revealed, byName, byPath, termsOfDifferentTabs, noMatches, cleared, closed: describeFilter() }, {
			initial: { hidden: true, pressed: 'false', label: 'Filter Tabs', input: false },
			revealed: { hidden: false, pressed: 'true', focusInInput: true, placeholder: 'Filter by name or path', label: 'Filter editor tabs by name or path' },
			byName: { items: ['file1.txt', 'file10.txt', 'file11.txt'], names: ['file1', 'file1', 'file1'], descriptions: [undefined, undefined, undefined] },
			byPath: { items: ['file2.txt', 'file3.txt'], names: [], descriptions: ['app', 'app'] },
			termsOfDifferentTabs: [],
			noMatches: { items: [], message: 'No matching tabs' },
			cleared: 12,
			closed: { hidden: true, pressed: 'false', focusInInput: false }
		});
	});

	test('tab groups stay in the filtered list for the tabs that match, and collapsed groups show their matches without changing', () => {
		const editors = model.getEditors(EditorsOrder.SEQUENTIAL);
		const work = model.createTabGroup(editors.slice(2, 5), 'Work', 'blue')!;
		const play = model.createTabGroup(editors.slice(6, 8), 'Play', 'red')!;
		model.setTabGroupCollapsed(play.id, true);
		const playHeader = () => container.querySelector<HTMLElement>(`.vertical-tab-group-header[data-tab-group-id="${play.id}"]`);
		const describeState = () => ({ items: listedItems().slice(0, 6), playExpanded: playHeader()?.getAttribute('aria-expanded'), playCollapsed: play.collapsed, workCollapsed: work.collapsed });

		const unfiltered = describeState();
		filterToggle().click();
		typeFilter('file7');
		const collapsedGroupMatches = describeState();
		typeFilter('file3');
		const expandedGroupMatches = describeState();
		typeFilter('WORK');
		const groupNameMatches = { ...describeState(), highlight: container.querySelector('.vertical-tab-group-name .highlight')?.textContent };
		typeFilter('file');
		const everyTabMatches = listedItems();
		pressKey('Escape');
		const afterEscape = describeState();

		assert.deepStrictEqual({ unfiltered, collapsedGroupMatches, expandedGroupMatches, groupNameMatches, everyTabMatches, afterEscape }, {
			unfiltered: { items: ['file0.txt', 'file1.txt', '[Work]', 'file2.txt', 'file3.txt', 'file4.txt'], playExpanded: 'false', playCollapsed: true, workCollapsed: false },
			collapsedGroupMatches: { items: ['[Play]', 'file7.txt'], playExpanded: 'true', playCollapsed: true, workCollapsed: false },
			expandedGroupMatches: { items: ['[Work]', 'file3.txt'], playExpanded: undefined, playCollapsed: true, workCollapsed: false },
			groupNameMatches: { items: ['[Work]', 'file2.txt', 'file3.txt', 'file4.txt'], playExpanded: undefined, playCollapsed: true, workCollapsed: false, highlight: 'Work' },
			everyTabMatches: ['file0.txt', 'file1.txt', '[Work]', 'file2.txt', 'file3.txt', 'file4.txt', 'file5.txt', '[Play]', 'file6.txt', 'file7.txt', 'file8.txt', 'file9.txt', 'file10.txt', 'file11.txt'],
			afterEscape: { items: ['file0.txt', 'file1.txt', '[Work]', 'file2.txt', 'file3.txt', 'file4.txt'], playExpanded: 'false', playCollapsed: true, workCollapsed: false }
		});
	});

	test('while filtering, the header of a group that the filter lists collapses it in the list again, and expanding it is a real expand', () => {
		const play = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(6, 8), 'Play', 'red')!;
		model.setTabGroupCollapsed(play.id, true);
		const header = () => container.querySelector<HTMLElement>(`.vertical-tab-group-header[data-tab-group-id="${play.id}"]`)!;
		const describeState = () => ({
			items: listedItems().slice(6, 10),
			expanded: header().getAttribute('aria-expanded'),
			collapsed: play.collapsed,
			rowLabel: rows().find(row => !row.classList.contains('exiting') && row.dataset.resourceName === 'file6.txt')?.getAttribute('aria-label')
		});

		filterToggle().click();
		typeFilter('file');
		const listedByFilter = describeState();
		header().click();
		const collapsedInList = describeState();
		header().focus();
		pressKey('ArrowRight');
		const expanded = describeState();
		pressKey('ArrowLeft');
		const collapsedAgain = describeState();
		pressKey('Escape');
		const afterClosing = describeState();

		assert.deepStrictEqual({ listedByFilter, collapsedInList, expanded, collapsedAgain, afterClosing }, {
			listedByFilter: { items: ['[Play]', 'file6.txt', 'file7.txt', 'file8.txt'], expanded: 'true', collapsed: true, rowLabel: 'file6.txt, tab group Play' },
			collapsedInList: { items: ['[Play]', 'file8.txt', 'file9.txt', 'file10.txt'], expanded: 'false', collapsed: true, rowLabel: undefined },
			expanded: { items: ['[Play]', 'file6.txt', 'file7.txt', 'file8.txt'], expanded: 'true', collapsed: false, rowLabel: 'file6.txt, tab group Play' },
			collapsedAgain: { items: ['[Play]', 'file8.txt', 'file9.txt', 'file10.txt'], expanded: 'false', collapsed: true, rowLabel: undefined },
			afterClosing: { items: ['[Play]', 'file8.txt', 'file9.txt', 'file10.txt'], expanded: 'false', collapsed: true, rowLabel: undefined }
		});
	});

	test('Escape clears and closes the filter, Down moves into the results, Up moves back out and Enter opens the first match', () => {
		filterToggle().click();
		typeFilter('file1');
		const log: Record<string, unknown> = {};

		openedEditors = [];
		log.down = { prevented: pressKey('ArrowDown'), focused: focusedItem(), opened: openedEditors.map(editor => editor.getName()) };
		log.downAgain = { prevented: pressKey('ArrowDown'), focused: focusedItem() };
		pressKey('ArrowUp');
		log.upToFirst = focusedItem();
		log.upOut = { prevented: pressKey('ArrowUp'), inInput: activeElement() === filterInput() };
		openedEditors = [];
		log.enter = { prevented: pressKey('Enter'), focused: focusedItem(), opened: openedEditors.map(editor => editor.getName()) };

		pressKey('ArrowDown');
		log.escapeFromList = { prevented: pressKey('Escape'), hidden: filterBar().hidden, query: filterInput().value, listed: listedItems().length, focused: focusedItem() };

		filterToggle().click();
		typeFilter('file');
		log.escapeFromInput = { prevented: pressKey('Escape'), hidden: filterBar().hidden, query: filterInput().value, listed: listedItems().length, focused: focusedItem() };

		assert.deepStrictEqual(log, {
			down: { prevented: true, focused: 'file1.txt', opened: ['file1.txt'] },
			downAgain: { prevented: true, focused: 'file10.txt' },
			upToFirst: 'file1.txt',
			upOut: { prevented: true, inInput: true },
			enter: { prevented: true, focused: 'file1.txt', opened: ['file1.txt'] },
			escapeFromList: { prevented: true, hidden: true, query: '', listed: 12, focused: 'file0.txt' },
			escapeFromInput: { prevented: true, hidden: true, query: '', listed: 12, focused: 'file0.txt' }
		});
	});

	test('the filter shows and hides above the list without taking room from it, and leaves the compact rail alone', () => {
		layoutControl(400, 240);
		const root = container.querySelector<HTMLElement>('.vertical-tabs-and-actions-container')!;
		const toolbarHeight = root.querySelector<HTMLElement>('.vertical-tabs-toolbar')!.offsetHeight;
		const listHeight = () => container.querySelector<HTMLElement>('.monaco-scrollable-element')!.getBoundingClientRect().height;
		const display = (selector: string) => mainWindow.getComputedStyle(root.querySelector(selector)!).display;

		const closed = { fits: toolbarHeight + listHeight() === 400 };
		filterToggle().click();
		const open = { bar: display('.vertical-tabs-filter'), fits: toolbarHeight + filterBar().offsetHeight + listHeight() === 400, listShrank: listHeight() < 400 - toolbarHeight };
		layoutControl(400, 48);
		const compact = { hidden: filterBar().hidden, bar: display('.vertical-tabs-filter'), button: display('.vertical-tabs-filter-toggle'), query: filterInput().value, listed: listedItems().length };

		assert.deepStrictEqual({ closed, open, compact }, {
			closed: { fits: true },
			open: { bar: 'flex', fits: true, listShrank: true },
			compact: { hidden: true, bar: 'none', button: 'none', query: '', listed: 12 }
		});
	});

	test('the vertical tabs tell the keybinding service that they hold focus', () => {
		assert.strictEqual(instantiationService.get(IContextKeyService).getContextKeyValue('verticalEditorTabsFocus'), true);
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

	test('the list is a valid tree with items positioned within their level, decorative section labels and a single Tab stop', () => {
		partOptions = { ...partOptions, pinnedTabsOnSeparateRow: true };
		model.stick(model.getEditorByIndex(0)!);
		model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'Work', 'blue');

		const list = container.querySelector('.vertical-tabs-list')!;
		const describe = (element: Element) => element.classList.contains('vertical-tabs-section-label')
			? { section: element.textContent, hidden: element.getAttribute('aria-hidden') }
			: {
				role: element.getAttribute('role'),
				level: element.getAttribute('aria-level'),
				position: element.getAttribute('aria-posinset') ? `${element.getAttribute('aria-posinset')}/${element.getAttribute('aria-setsize')}` : undefined,
				expanded: element.getAttribute('aria-expanded') ?? undefined,
				label: element.getAttribute('aria-label')
			};

		assert.deepStrictEqual({
			role: list.getAttribute('role'),
			children: Array.from(list.children).slice(0, 8).map(describe),
			tabStops: Array.from(list.children).filter(child => child.getAttribute('tabindex') === '0').map(child => (child as HTMLElement).dataset.resourceName),
			focusableNestedControls: list.querySelectorAll('.vertical-tab-actions [tabindex="0"]').length,
			childRoles: [...new Set(Array.from(list.children).map(element => element.getAttribute('role')))]
		}, {
			role: 'tree',
			children: [
				{ section: 'Pinned', hidden: 'true' },
				{ role: 'treeitem', level: '1', position: '1/11', expanded: undefined, label: 'file0.txt, pinned' },
				{ section: 'Editors', hidden: 'true' },
				{ role: 'treeitem', level: '1', position: '2/11', expanded: undefined, label: 'file1.txt' },
				{ role: 'treeitem', level: '1', position: '3/11', expanded: 'true', label: 'Work, 2 tabs' },
				{ role: 'treeitem', level: '2', position: '1/2', expanded: undefined, label: 'file2.txt, tab group Work' },
				{ role: 'treeitem', level: '2', position: '2/2', expanded: undefined, label: 'file3.txt, tab group Work' },
				{ role: 'treeitem', level: '1', position: '4/11', expanded: undefined, label: 'file4.txt' }
			],
			tabStops: ['file0.txt'],
			focusableNestedControls: 0,
			childRoles: [null, 'treeitem'] // the hidden section labels have no role, every other child is an item
		});
	});

	test('arrow keys move across tabs and headers and Home and End jump to the first and last item', () => {
		model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'Work', 'blue');
		const tabStops = () => Array.from(container.querySelectorAll<HTMLElement>('.vertical-tabs-list > [tabindex="0"]'));
		const log: { key: string; focused: string | undefined; focusIsTheOnlyTabStop: boolean }[] = [];
		const press = (key: keyof typeof domKeyCodes) => {
			pressKey(key);
			log.push({ key, focused: focusedItem(), focusIsTheOnlyTabStop: tabStops().length === 1 && tabStops()[0] === activeElement() });
		};

		rows()[1].focus();
		press('ArrowDown');
		press('ArrowDown');
		press('ArrowUp');
		press('ArrowUp');
		press('Home');
		press('ArrowUp');
		press('End');
		press('ArrowDown');

		assert.deepStrictEqual({ log, opened: openedEditors.map(editor => editor.getName()) }, {
			log: [
				{ key: 'ArrowDown', focused: 'group:Work', focusIsTheOnlyTabStop: true },
				{ key: 'ArrowDown', focused: 'file2.txt', focusIsTheOnlyTabStop: true },
				{ key: 'ArrowUp', focused: 'group:Work', focusIsTheOnlyTabStop: true },
				{ key: 'ArrowUp', focused: 'file1.txt', focusIsTheOnlyTabStop: true },
				{ key: 'Home', focused: 'file0.txt', focusIsTheOnlyTabStop: true },
				{ key: 'ArrowUp', focused: 'file0.txt', focusIsTheOnlyTabStop: true },
				{ key: 'End', focused: 'file11.txt', focusIsTheOnlyTabStop: true },
				{ key: 'ArrowDown', focused: 'file11.txt', focusIsTheOnlyTabStop: true }
			],
			opened: ['file2.txt', 'file1.txt', 'file0.txt', 'file11.txt']
		});
	});

	test('Left and Right collapse and expand a tab group header and Enter and Space toggle it', () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'Work', 'blue')!;
		container.querySelector<HTMLElement>('.vertical-tab-group-header')!.focus();
		const log: { key: string; collapsed: boolean; focused: string | undefined }[] = [];
		const press = (key: keyof typeof domKeyCodes) => {
			pressKey(key);
			log.push({ key, collapsed: tabGroup.collapsed, focused: focusedItem() });
		};

		press('ArrowRight'); // already expanded: moves into the group
		press('ArrowLeft'); // back out to the header
		press('ArrowLeft'); // collapses
		press('ArrowLeft'); // stays collapsed
		press('ArrowRight'); // expands
		press('Enter');
		press(' ');

		assert.deepStrictEqual(log, [
			{ key: 'ArrowRight', collapsed: false, focused: 'file2.txt' },
			{ key: 'ArrowLeft', collapsed: false, focused: 'group:Work' },
			{ key: 'ArrowLeft', collapsed: true, focused: 'group:Work' },
			{ key: 'ArrowLeft', collapsed: true, focused: 'group:Work' },
			{ key: 'ArrowRight', collapsed: false, focused: 'group:Work' },
			{ key: 'Enter', collapsed: true, focused: 'group:Work' },
			{ key: ' ', collapsed: false, focused: 'group:Work' }
		]);
	});

	test('Enter opens the focused tab and keys typed into nested controls are left alone', () => {
		const row = rows()[3];
		row.focus();
		pressKey('Enter');
		const opened = openedEditors.map(editor => editor.getName());

		openedEditors = [];
		row.querySelector<HTMLElement>('.vertical-tab-actions .action-label')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: domKeyCodes.Enter, bubbles: true, cancelable: true } as KeyboardEventInit));

		assert.deepStrictEqual({ opened, openedByNestedControl: openedEditors.map(editor => editor.getName()) }, { opened: ['file3.txt'], openedByNestedControl: [] });
	});

	test('the column width shrinks toward its minimum, then on to a compact rail without jumping, and leaves the editor room', () => {
		const contentWidths = [1000, 460, 420, 360, 359, 300, 100, 60, 20, 0];

		assert.deepStrictEqual({
			regular: contentWidths.map(contentWidth => computeVerticalTabsWidth(contentWidth, 0, 240, 220)),
			withGapAndNoEditorMinimum: contentWidths.map(contentWidth => computeVerticalTabsWidth(contentWidth, 10, 240, 0)),
			editorNeverCollapses: Array.from({ length: 2000 }, (_, index) => index + 1).every(contentWidth => contentWidth - computeVerticalTabsWidth(contentWidth, 0, 500, 0) >= 1)
		}, {
			regular: [240, 240, 200, 140, 139, 80, 48, 30, 10, 0],
			withGapAndNoEditorMinimum: [240, 230, 190, 130, 129, 70, 45, 25, 5, 0],
			editorNeverCollapses: true
		});
	});

	test('a column only turns compact well below the labeled minimum and needs the whole minimum to get its labels back', () => {
		const compactAlong = (wasCompact: boolean, widths: number[]) => widths.map(width => wasCompact = isVerticalTabsWidthCompact(width, wasCompact));
		const root = container.querySelector('.vertical-tabs-and-actions-container')!;
		const compactWhileLaidOutAt = (widths: number[]) => widths.map(width => {
			layoutControl(600, width);
			return root.classList.contains('compact');
		});

		assert.deepStrictEqual({
			shrinking: compactAlong(false, [240, 140, 130, 120, 119, 48]),
			growing: compactAlong(true, [48, 119, 139, 140, 240]),
			resizedAroundTheMinimum: compactAlong(false, [150, 139, 125, 119, 125, 139, 141, 139, 125]),
			hidden: compactAlong(true, [0]),
			control: compactWhileLaidOutAt([240, 130, 110, 130, 139, 140, 130])
		}, {
			shrinking: [false, false, false, false, true, true],
			growing: [true, true, true, false, false],
			resizedAroundTheMinimum: [false, false, false, true, true, true, false, false, false],
			hidden: [false],
			control: [false, false, true, true, true, false, false]
		});
	});

	test('a narrow column renders icons only, with the unsaved dot, stacked editor actions and the group header reduced to its color', () => {
		model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'Work', 'blue');
		const dirtyEditor = model.getEditorByIndex(1) as TestEditorInput;
		dirtyEditor.setDirty();
		control.updateEditorDirty(dirtyEditor);
		const root = container.querySelector('.vertical-tabs-and-actions-container')!;
		const display = (element: Element | null) => element ? mainWindow.getComputedStyle(element).display : undefined;
		const measure = () => {
			const [clean, dirty] = [rows()[0], rows()[1]];
			const header = container.querySelector('.vertical-tab-group-header')!;
			return {
				compact: root.classList.contains('compact'),
				names: display(clean.querySelector('.monaco-icon-label-container')),
				actions: display(clean.querySelector('.vertical-tab-actions')),
				editorActions: display(root.querySelector('.vertical-tabs-actions')),
				toolbar: mainWindow.getComputedStyle(root.querySelector('.vertical-tabs-toolbar')!).flexDirection,
				cleanDot: display(clean.querySelector('.vertical-tab-dirty-dot')),
				dirtyDot: display(dirty.querySelector('.vertical-tab-dirty-dot')),
				headerParts: Array.from(header.children).filter(child => display(child) !== 'none').map(child => child.className.split(' ')[0])
			};
		};

		layoutControl(600, 240);
		const regular = measure();
		layoutControl(600, 48);
		const compact = measure();
		layoutControl(600, 240);
		const restored = measure();

		assert.deepStrictEqual({ regular, compact, restored }, {
			regular: { compact: false, names: 'flex', actions: 'block', editorActions: 'block', toolbar: 'row', cleanDot: 'none', dirtyDot: 'none', headerParts: ['vertical-tab-group-twistie', 'vertical-tab-group-name', 'vertical-tab-group-count'] },
			compact: { compact: true, names: 'none', actions: 'none', editorActions: 'block', toolbar: 'column', cleanDot: 'none', dirtyDot: 'block', headerParts: ['vertical-tab-group-color-dot'] },
			restored: { compact: false, names: 'flex', actions: 'block', editorActions: 'block', toolbar: 'row', cleanDot: 'none', dirtyDot: 'none', headerParts: ['vertical-tab-group-twistie', 'vertical-tab-group-name', 'vertical-tab-group-count'] }
		});
	});

	test('the compact rendering keeps file icons even when icons are turned off', () => {
		partOptions = { ...partOptions, showIcons: false };
		control.dispose();
		reset(container);
		control = createControl();
		const hasIcon = () => {
			const label = rows()[0].querySelector('.vertical-tab-label')!;
			return label.classList.contains('file-icon') && !!label.closest('.show-file-icons'); // the icon theme paints only below that class
		};

		layoutControl(600, 240);
		const regular = hasIcon();
		layoutControl(600, 48);
		const compact = hasIcon();
		layoutControl(600, 240);

		assert.deepStrictEqual({ regular, compact, restored: hasIcon() }, { regular: false, compact: true, restored: false });
	});

	test('the compact rendering falls back to a codicon while the file icon theme has no file icons', () => {
		const setFileIcons = (hasIcons: boolean) => {
			const oldOptions = partOptions;
			partOptions = { ...partOptions, hasIcons };
			control.updateOptions(oldOptions, partOptions); // what the editor part does when the file icon theme changes
		};
		const describeIcon = () => {
			const row = rows()[0];
			const fallback = row.querySelector<HTMLElement>('.vertical-tab-fallback-icon')!;
			return {
				fallback: mainWindow.getComputedStyle(fallback).display !== 'none' ? Array.from(fallback.classList).filter(className => className.startsWith('codicon-')) : 'hidden',
				label: mainWindow.getComputedStyle(row.querySelector('.vertical-tab-label')!).display !== 'none'
			};
		};

		layoutControl(600, 240);
		const labeledWithoutIcons = (setFileIcons(false), describeIcon());
		layoutControl(600, 48);
		const compactWithoutIcons = describeIcon();
		setFileIcons(true);
		const compactWithIcons = describeIcon();
		setFileIcons(false);
		layoutControl(600, 240);

		assert.deepStrictEqual({ labeledWithoutIcons, compactWithoutIcons, compactWithIcons, restoredWithoutIcons: describeIcon() }, {
			labeledWithoutIcons: { fallback: 'hidden', label: true },
			compactWithoutIcons: { fallback: ['codicon-file'], label: false },
			compactWithIcons: { fallback: 'hidden', label: true },
			restoredWithoutIcons: { fallback: 'hidden', label: true }
		});
	});

	test('the New Tab button describes itself through the hover service', () => {
		const hovers = new Map<HTMLElement, string>();
		instantiationService.stub(IHoverService, {
			...NullHoverService,
			setupManagedHover: (_delegate, target, content) => {
				hovers.set(target, typeof content === 'string' ? content : '');
				return { dispose: () => hovers.delete(target), show: () => { }, hide: () => { }, update: tooltip => { hovers.set(target, typeof tooltip === 'string' ? tooltip : ''); } };
			}
		});
		control.dispose();
		reset(container);
		control = createControl();

		const button = container.querySelector<HTMLButtonElement>('.vertical-tabs-new-tab')!;
		assert.deepStrictEqual({ hover: hovers.get(button), nativeTitle: button.title, ariaLabel: button.getAttribute('aria-label') }, { hover: 'New Tab', nativeTitle: '', ariaLabel: 'New Tab' });
	});

	test('tab group headers describe themselves through the hover service', () => {
		const hovers = new Map<HTMLElement, string>();
		instantiationService.stub(IHoverService, {
			...NullHoverService,
			setupManagedHover: (_delegate, target, content) => {
				hovers.set(target, typeof content === 'string' ? content : '');
				return { dispose: () => hovers.delete(target), show: () => { }, hide: () => { }, update: tooltip => { hovers.set(target, typeof tooltip === 'string' ? tooltip : ''); } };
			}
		});
		control.dispose();
		reset(container);
		model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'Work', 'blue');
		control = createControl();

		const header = container.querySelector<HTMLElement>('.vertical-tab-group-header')!;
		assert.deepStrictEqual({ hover: hovers.get(header), nativeTitle: header.title }, { hover: 'Work (2 tabs)', nativeTitle: '' });
	});

	function closeAllEditors(): void {
		for (const editor of model.getEditors(EditorsOrder.SEQUENTIAL)) {
			model.closeEditor(editor);
		}
		control.closeEditors([]);
	}

	test('an empty group shows a message and a New File action that runs the new untitled file command', () => {
		instantiationService.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand(commandId: string) {
				calls.push(`command:${commandId}`);
				return undefined;
			}
		});
		control.dispose();
		reset(container);
		control = createControl();
		const root = container.querySelector('.vertical-tabs-and-actions-container')!;
		const display = (selector: string) => mainWindow.getComputedStyle(root.querySelector(selector)!).display;
		const describe = () => ({
			empty: root.classList.contains('empty'),
			emptyState: display('.vertical-tabs-empty-state'),
			list: display('.monaco-scrollable-element')
		});

		const withEditors = describe();
		closeAllEditors();
		const withoutEditors = describe();
		const action = root.querySelector<HTMLButtonElement>('.vertical-tabs-empty-action')!;
		action.click();

		assert.deepStrictEqual({
			withEditors,
			withoutEditors,
			message: root.querySelector('.vertical-tabs-empty-message')?.textContent,
			action: action.getAttribute('aria-label'),
			calls
		}, {
			withEditors: { empty: false, emptyState: 'none', list: 'block' },
			withoutEditors: { empty: true, emptyState: 'flex', list: 'none' },
			message: 'No open editors',
			action: 'New File',
			calls: ['activateGroup', 'command:workbench.action.files.newUntitledFile']
		});
	});

	async function waitUntil(condition: () => boolean, description: string): Promise<void> {
		const deadline = Date.now() + 3000;
		while (!condition()) {
			if (Date.now() >= deadline) {
				assert.fail(`Timed out waiting for ${description}`);
			}
			await waitForAnimationFrame();
		}
	}

	test('collapsing and expanding a tab group eases its rows out and in', async () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 5), 'Work', 'blue')!;
		const header = () => container.querySelector<HTMLElement>('.vertical-tab-group-header')!;
		const count = (selector: string) => container.querySelectorAll(selector).length;
		const log: Record<string, unknown> = {};

		header().click();
		log.collapse = {
			collapsed: tabGroup.collapsed,
			headerClass: header().classList.contains('collapsing'),
			exitingRows: count('.vertical-tab.exiting'),
			exitingAreHidden: Array.from(container.querySelectorAll('.vertical-tab.exiting')).every(row => row.getAttribute('aria-hidden') === 'true'),
			realRows: count('.vertical-tab:not(.exiting)')
		};
		await waitUntil(() => count('.vertical-tab.exiting') === 0, 'the collapsed rows to be removed');

		header().click();
		log.expand = {
			collapsed: tabGroup.collapsed,
			headerClass: header().classList.contains('expanding'),
			enteringRows: count('.vertical-tab.entering'),
			realRows: count('.vertical-tab:not(.exiting)')
		};
		await waitUntil(() => count('.vertical-tab.entering') === 0, 'the expanded rows to settle');

		assert.deepStrictEqual(log, {
			collapse: { collapsed: true, headerClass: true, exitingRows: 3, exitingAreHidden: true, realRows: 9 },
			expand: { collapsed: false, headerClass: true, enteringRows: 3, realRows: 12 }
		});
	});

	test('collapsing and expanding a tab group through the model animates it just like a header click, with a twistie that turns', async () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 5), 'Work', 'blue')!;
		const header = () => container.querySelector<HTMLElement>('.vertical-tab-group-header')!;
		const twistie = () => header().querySelector<HTMLElement>('.vertical-tab-group-twistie')!;
		const count = (selector: string) => container.querySelectorAll(selector).length;
		const rotation = () => {
			const matrix = new DOMMatrix(mainWindow.getComputedStyle(twistie()).transform);
			return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) + 0;
		};
		const describe = () => ({
			collapsed: tabGroup.collapsed,
			headerClass: ['expanding', 'collapsing'].filter(className => header().classList.contains(className)),
			exitingRows: count('.vertical-tab.exiting'),
			enteringRows: count('.vertical-tab.entering'),
			chevronDown: twistie().classList.contains('codicon-chevron-down')
		});
		const log: Record<string, unknown> = {};

		model.setTabGroupCollapsed(tabGroup.id, true); // as the context menu and the commands do
		log.collapse = describe();
		await waitUntil(() => count('.vertical-tab.exiting') === 0 && twistie().getAnimations().length === 0, 'the collapse to finish');
		log.collapsed = { rotation: rotation(), ...describe() };

		model.setTabGroupCollapsed(tabGroup.id, false);
		log.expand = describe();
		await waitUntil(() => count('.vertical-tab.entering') === 0 && twistie().getAnimations().length === 0, 'the expansion to finish');
		log.expanded = { rotation: rotation(), ...describe() };

		assert.deepStrictEqual(log, {
			collapse: { collapsed: true, headerClass: ['collapsing'], exitingRows: 3, enteringRows: 0, chevronDown: true },
			collapsed: { rotation: -90, collapsed: true, headerClass: ['collapsing'], exitingRows: 0, enteringRows: 0, chevronDown: true },
			expand: { collapsed: false, headerClass: ['expanding'], exitingRows: 0, enteringRows: 3, chevronDown: true },
			expanded: { rotation: 0, collapsed: false, headerClass: ['expanding'], exitingRows: 0, enteringRows: 0, chevronDown: true }
		});
	});

	test('animations only run for the tab group whose collapsed state changed', async () => {
		const [first, second] = [
			model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 4), 'First', 'blue')!,
			model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(6, 8), 'Second', 'red')!
		];
		const headers = () => Array.from(container.querySelectorAll<HTMLElement>('.vertical-tab-group-header'));
		const describe = () => ({ exitingRows: container.querySelectorAll('.vertical-tab.exiting').length, headerClasses: headers().map(header => header.className.replace('vertical-tab-group-header', '').trim()) });

		model.setTabGroupCollapsed(second.id, true);
		const collapseSecond = describe();
		await waitUntil(() => container.querySelectorAll('.vertical-tab.exiting').length === 0, 'the collapse to finish');

		model.renameTabGroup(first.id, 'Renamed'); // not a change of the collapsed state
		const rename = describe();

		assert.deepStrictEqual({ collapseSecond, rename }, {
			collapseSecond: { exitingRows: 2, headerClasses: ['', 'collapsed collapsing'] },
			rename: { exitingRows: 0, headerClasses: ['', 'collapsed'] }
		});
	});

	test('reduce motion keeps tab groups, hovers and rows from animating', () => {
		const tabGroup = model.createTabGroup(model.getEditors(EditorsOrder.SEQUENTIAL).slice(2, 5), 'Work', 'blue')!;
		const row = () => rows()[0];
		const animation = (className: string) => {
			row().classList.add(className);
			const name = mainWindow.getComputedStyle(row()).animationName;
			row().classList.remove(className);
			return name;
		};
		const motion = () => ({
			rowTransition: mainWindow.getComputedStyle(row()).transitionDuration,
			headerTransition: mainWindow.getComputedStyle(container.querySelector('.vertical-tab-group-header')!).transitionDuration,
			entering: animation('entering'),
			exiting: animation('exiting')
		});

		const withMotion = motion();
		workbenchElement.classList.add('monaco-reduce-motion');
		const reduced = motion();
		container.querySelector<HTMLElement>('.vertical-tab-group-header')!.click();

		assert.deepStrictEqual({
			withMotion,
			reduced,
			collapsedWithoutAnimation: { collapsed: tabGroup.collapsed, exitingRows: container.querySelectorAll('.vertical-tab.exiting').length, headerClass: container.querySelector('.vertical-tab-group-header')!.classList.contains('collapsing') }
		}, {
			withMotion: { rowTransition: '0.12s, 0.12s', headerTransition: '0.12s, 0.12s', entering: 'vertical-tab-enter', exiting: 'vertical-tab-exit' },
			reduced: { rowTransition: '0s', headerTransition: '0s', entering: 'none', exiting: 'none' },
			collapsedWithoutAnimation: { collapsed: true, exitingRows: 0, headerClass: false }
		});
	});
});

suite('EditorGroupView vertical tabs layout', () => {

	const disposables = new DisposableStore();
	let instantiationService: ITestInstantiationService | undefined;

	setup(() => {
		disposables.add(registerTestEditor('VerticalTabsLayoutTestEditor', [new SyncDescriptor(TestFileEditorInput)], 'verticalTabsLayoutTestEditorInput'));
	});

	teardown(async () => {
		if (instantiationService) {
			await workbenchTeardown(instantiationService);
			instantiationService = undefined;
		}

		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('narrow groups shrink the vertical tabs down to the compact rail without jumping, and keep the editor area visible', async () => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const part = await createEditorPart(instantiationService, disposables);
		const group = part.activeGroup as IEditorGroupView;
		const layoutAt = (width: number) => {
			group.layout(width, 400, 0, 0);
			return {
				width,
				tabs: group.element.querySelector<HTMLElement>('.vertical-tabs-container')!.style.width,
				editor: group.element.querySelector<HTMLElement>('.editor-container')!.style.width
			};
		};

		const topTabsMinimumWidth = group.minimumWidth;
		disposables.add(part.enforcePartOptions({ showTabs: 'multiple', tabPosition: 'left', verticalTabsWidth: 240 }));

		assert.deepStrictEqual({
			minimumWidthGrowsByTheCompactColumn: group.minimumWidth - topTabsMinimumWidth,
			tabsPaintFileIcons: group.element.querySelector('.vertical-tabs-container')!.classList.contains('show-file-icons'),
			layouts: [1000, 500, 400, 360, 359, 300, 268, 250, 100].map(layoutAt)
		}, {
			minimumWidthGrowsByTheCompactColumn: 48,
			tabsPaintFileIcons: true,
			layouts: [
				{ width: 1000, tabs: '240px', editor: '760px' },
				{ width: 500, tabs: '240px', editor: '260px' },
				{ width: 400, tabs: '180px', editor: '220px' },
				{ width: 360, tabs: '140px', editor: '220px' },
				{ width: 359, tabs: '139px', editor: '220px' },
				{ width: 300, tabs: '80px', editor: '220px' },
				{ width: 268, tabs: '48px', editor: '220px' },
				{ width: 250, tabs: '48px', editor: '202px' },
				{ width: 100, tabs: '48px', editor: '52px' }
			]
		});
	});

	test('an empty group keeps its watermark and toolbars clear of a tab column on the right', async () => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const part = await createEditorPart(instantiationService, disposables);
		const group = part.activeGroup as IEditorGroupView;
		disposables.add(part.enforcePartOptions({ showTabs: 'multiple', tabPosition: 'right', verticalTabsWidth: 240 }));

		// Mount the part below the ancestry the stylesheets expect
		let partElement = group.element;
		while (partElement.parentElement) {
			partElement = partElement.parentElement;
		}
		partElement.classList.add('part', 'editor');
		const workbench = $('.monaco-workbench');
		workbench.appendChild(partElement);
		mainWindow.document.body.appendChild(workbench);
		disposables.add({ dispose: () => workbench.remove() });
		group.layout(800, 400, 0, 0);

		const style = (selector: string) => mainWindow.getComputedStyle(group.element.querySelector(selector)!);
		assert.deepStrictEqual({
			empty: group.element.classList.contains('empty'),
			column: style('.editor-group-body').width,
			watermark: style('.editor-group-watermark-wrapper').paddingRight,
			watermarkToolbar: style('.editor-group-watermark-toolbar-container').right,
			groupToolbar: style('.editor-group-container-toolbar').paddingRight
		}, {
			empty: true,
			column: '240px',
			watermark: '240px',
			watermarkToolbar: '240px',
			groupToolbar: '240px'
		});
	});
});
