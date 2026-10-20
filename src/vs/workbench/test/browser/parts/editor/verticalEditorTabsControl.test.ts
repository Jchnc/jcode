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
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { computeVerticalTabsWidth, VerticalEditorTabsControl } from '../../../../browser/parts/editor/verticalEditorTabsControl.js';
import { EditorExtensions, EditorInputCapabilities, EditorsOrder, IEditorFactoryRegistry, IEditorPartOptions } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import { IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { createEditorPart, ITestInstantiationService, registerTestEditor, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../workbenchTestServices.js';

/** The `keyCode` of keyboard events as the browser reports it. */
const domKeyCodes = { 'Enter': 13, ' ': 32, 'End': 35, 'Home': 36, 'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40 };

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
			ariaLabel: 'Work, 3 editors, 1 unsaved',
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
				{ role: 'treeitem', level: '1', position: '3/11', expanded: 'true', label: 'Work, 2 editors' },
				{ role: 'treeitem', level: '2', position: '1/2', expanded: undefined, label: 'file2.txt' },
				{ role: 'treeitem', level: '2', position: '2/2', expanded: undefined, label: 'file3.txt' },
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

	test('the column width shrinks toward its minimum, then falls back to a compact rail, and leaves the editor room', () => {
		const contentWidths = [1000, 460, 420, 360, 359, 300, 100, 60, 20, 0];

		assert.deepStrictEqual({
			regular: contentWidths.map(contentWidth => computeVerticalTabsWidth(contentWidth, 0, 240, 220)),
			withGapAndNoEditorMinimum: contentWidths.map(contentWidth => computeVerticalTabsWidth(contentWidth, 10, 240, 0)),
			editorNeverCollapses: Array.from({ length: 2000 }, (_, index) => index + 1).every(contentWidth => contentWidth - computeVerticalTabsWidth(contentWidth, 0, 500, 0) >= 1)
		}, {
			regular: [240, 240, 200, 140, 48, 48, 48, 30, 10, 0],
			withGapAndNoEditorMinimum: [240, 230, 190, 48, 48, 48, 45, 25, 5, 0],
			editorNeverCollapses: true
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
		assert.deepStrictEqual({ hover: hovers.get(header), nativeTitle: header.title }, { hover: 'Work (2 editors)', nativeTitle: '' });
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

	test('narrow groups shrink the vertical tabs, then compact them, and keep the editor area visible', async () => {
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
			layouts: [1000, 500, 400, 360, 359, 300, 100].map(layoutAt)
		}, {
			minimumWidthGrowsByTheCompactColumn: 48,
			tabsPaintFileIcons: true,
			layouts: [
				{ width: 1000, tabs: '240px', editor: '760px' },
				{ width: 500, tabs: '240px', editor: '260px' },
				{ width: 400, tabs: '180px', editor: '220px' },
				{ width: 360, tabs: '140px', editor: '220px' },
				{ width: 359, tabs: '48px', editor: '311px' },
				{ width: 300, tabs: '48px', editor: '252px' },
				{ width: 100, tabs: '48px', editor: '52px' }
			]
		});
	});
});
