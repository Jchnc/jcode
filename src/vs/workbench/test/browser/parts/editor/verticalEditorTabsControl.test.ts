/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, Dimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDnd.js';
import { ITreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDndService.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { VerticalEditorTabsControl } from '../../../../browser/parts/editor/verticalEditorTabsControl.js';
import { EditorsOrder, IEditorPartOptions } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { TestFileEditorInput, workbenchInstantiationService } from '../../workbenchTestServices.js';

suite('VerticalEditorTabsControl', () => {

	let disposables: DisposableStore;

	let container: HTMLElement;
	let control: VerticalEditorTabsControl;
	let partOptions: IEditorPartOptions;
	let model: EditorGroupModel;
	let openedEditors: EditorInput[];
	let groupView: IEditorGroupView;
	let groupsView: IEditorGroupsView;
	let editorPartsView: IEditorPartsView;

	function createEditors(count: number): void {
		for (let i = 0; i < count; i++) {
			const editor = disposables.add(new class extends TestFileEditorInput {
				override getName(): string { return `file${i}.txt`; }
			}(URI.file(`/path/file${i}.txt`), 'testEditorInput'));
			model.openEditor(editor, { pinned: true, active: i === 0, index: i });
		}
	}

	function createControl(): VerticalEditorTabsControl {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(ITreeViewsDnDService, new TreeViewsDnDService());
		instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());

		model = disposables.add(instantiationService.createInstance(EditorGroupModel, undefined));
		createEditors(12);

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

		return disposables.add(instantiationService.createInstance(VerticalEditorTabsControl, container, editorPartsView, groupsView, groupView, model, undefined, false, false));
	}

	/**
	 * Mounts the control below the ancestry the stylesheet expects and lays it out
	 * with the given height, so that row sizes and overflow are real.
	 */
	function layoutControl(height: number, width = 240): void {
		control.layout({ container: new Dimension(width, height), available: new Dimension(width, height) });
	}

	setup(() => {
		disposables = new DisposableStore();
		partOptions = { ...DEFAULT_EDITOR_PART_OPTIONS };
		openedEditors = [];

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

		control = createControl();
	});

	teardown(() => {
		disposables.dispose();
	});

	function wheel(options: { shiftKey?: boolean; deltaX?: number; deltaY?: number }): { prevented: boolean; opened: string[] } {
		openedEditors = [];
		const event = new WheelEvent('wheel', { deltaX: options.deltaX ?? 0, deltaY: options.deltaY ?? 100, shiftKey: options.shiftKey ?? false, bubbles: true, cancelable: true });
		container.querySelector('.vertical-tab')!.dispatchEvent(event);
		return { prevented: event.defaultPrevented, opened: openedEditors.map(editor => editor.getName()) };
	}

	ensureNoDisposablesAreLeakedInTestSuite();

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
});
