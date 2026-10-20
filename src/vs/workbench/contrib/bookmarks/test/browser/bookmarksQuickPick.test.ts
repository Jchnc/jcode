/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isResourceEditorInput } from '../../../../common/editor.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { INotificationHandle, INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPick, IQuickPickDidAcceptEvent, IQuickPickItem, IQuickPickItemButtonEvent, QuickInputHideReason, QuickPickFocus } from '../../../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { extUri } from '../../../../../base/common/resources.js';
import { PickerEditorState } from '../../../../browser/quickaccess.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { showBookmarksQuickPick } from '../../browser/bookmarksQuickPick.js';
import { ICodeBookmark, ICodeBookmarksService } from '../../common/bookmarks.js';

suite('Go to Bookmark quick pick', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function bookmark(path: string, lineNumber: number, extra: Partial<ICodeBookmark> = {}): ICodeBookmark {
		return { id: `${path}:${lineNumber}`, resource: URI.file(path), lineNumber, column: 1, lineText: `  text ${lineNumber}`, beforeText: '', afterText: '', stale: false, createdAt: lineNumber, ...extra };
	}

	function setup(initial: ICodeBookmark[], linesInsertedAbove = 0) {
		const disposables = store.add(new DisposableStore());
		let bookmarks = initial;
		let pendingLinesInserted = linesInsertedAbove;
		const log: string[] = [];
		const openedLines: number[] = [];

		const onDidChangeActive = disposables.add(new Emitter<IQuickPickItem[]>());
		const onDidTriggerItemButton = disposables.add(new Emitter<IQuickPickItemButtonEvent<IQuickPickItem>>());
		const onDidAccept = disposables.add(new Emitter<IQuickPickDidAcceptEvent>());
		const onDidHide = disposables.add(new Emitter<{ reason: QuickInputHideReason }>());
		let activeItems: readonly IQuickPickItem[] = [];
		let selectedItems: readonly IQuickPickItem[] = [];
		// Like the real list, the fake leaves out the items that the typed text filters out.
		let isShown = (_item: IQuickPickItem) => true;
		const picker = upcastPartial<IQuickPick<IQuickPickItem>>({
			items: [],
			get activeItems() { return activeItems; },
			set activeItems(items: readonly IQuickPickItem[]) {
				activeItems = items.filter(isShown);
				onDidChangeActive.fire([...activeItems]);
			},
			focus(focus: QuickPickFocus) {
				const shown = picker.items.filter(isShown);
				const step = focus === QuickPickFocus.Next ? 1 : -1;
				picker.activeItems = [shown[(shown.indexOf(activeItems[0]) + step + shown.length) % shown.length]];
			},
			get selectedItems() { return selectedItems; },
			onDidChangeActive: onDidChangeActive.event,
			onDidTriggerItemButton: onDidTriggerItemButton.event,
			onDidAccept: onDidAccept.event,
			onDidHide: onDidHide.event,
			show() { log.push('show'); },
			hide() {
				log.push('hide');
				onDidHide.fire({ reason: QuickInputHideReason.Other });
			},
			dispose() { }
		});

		const editorState = new class extends mock<PickerEditorState>() {
			override set(): void { log.push('state.set'); }
			override reset(): void { log.push('state.reset'); }
			override async restore(): Promise<void> { log.push('state.restore'); }
			override async openTransientEditor(editor: unknown): Promise<undefined> { log.push(`preview ${isResourceEditorInput(editor) ? editor.resource.path : ''}`); return undefined; }
			override dispose(): void { }
		};
		const services = {
			bookmarksService: upcastPartial<ICodeBookmarksService>({
				get bookmarks() { return bookmarks; },
				sync() {
					// Edits that the service has not picked up yet move every bookmark down.
					bookmarks = bookmarks.map(candidate => ({ ...candidate, lineNumber: candidate.lineNumber + pendingLinesInserted }));
					pendingLinesInserted = 0;
				},
				remove(id: string) { bookmarks = bookmarks.filter(candidate => candidate.id !== id); }
			}),
			quickInputService: upcastPartial<IQuickInputService>({ createQuickPick: (() => picker) as IQuickInputService['createQuickPick'] }),
			editorService: new class extends mock<IEditorService>() {
				override async openEditor(input: unknown): Promise<undefined> {
					log.push(`open ${isResourceEditorInput(input) ? input.resource.path : ''}`);
					openedLines.push((isResourceEditorInput(input) && (input.options as ITextEditorOptions | undefined)?.selection?.startLineNumber) || 0);
					return undefined;
				}
			},
			instantiationService: upcastPartial<IInstantiationService>({ createInstance: (() => editorState) as IInstantiationService['createInstance'] }),
			notificationService: upcastPartial<INotificationService>({
				info: (message: string) => {
					log.push(`info ${message}`);
					return upcastPartial<INotificationHandle>({});
				}
			}),
			labelService: upcastPartial<ILabelService>({ getUriLabel: (resource: URI) => resource.path }),
			uriIdentityService: upcastPartial<IUriIdentityService>({ extUri })
		};

		const closed = showBookmarksQuickPick(services);
		return {
			picker, log, closed, openedLines,
			insertLinesAbove: (count: number) => { pendingLinesInserted += count; },
			filter: (predicate: (item: IQuickPickItem) => boolean) => { isShown = predicate; },
			items: () => picker.items.map(item => ({ label: item.label, description: item.description, detail: item.detail })),
			activate: (index: number) => { picker.activeItems = [picker.items[index]]; },
			select: (index: number) => { selectedItems = [picker.items[index]]; onDidAccept.fire({ inBackground: false }); },
			removeItem: (index: number) => onDidTriggerItemButton.fire({ button: { iconClass: 'remove' }, item: picker.items[index] }),
			hide: (reason: QuickInputHideReason) => onDidHide.fire({ reason }),
			get activeLabels() { return activeItems.map(item => item.label); }
		};
	}

	test('lists live bookmarks in the order of the view and shows their note, file, and line', async () => {
		const { items, hide, closed, picker } = setup([
			bookmark('/src/b.ts', 4, { note: 'check this' }),
			bookmark('/src/a.ts', 9),
			bookmark('/src/a.ts', 2, { stale: true }),
			bookmark('/src/a.ts', 1)
		]);

		assert.deepStrictEqual({
			items: items(),
			matchesDescriptionAndDetail: [picker.matchOnDescription, picker.matchOnDetail],
			removeButtons: picker.items.map(item => item.buttons?.length)
		}, {
			items: [
				{ label: 'text 1', description: '/src/a.ts:1', detail: undefined },
				{ label: 'text 9', description: '/src/a.ts:9', detail: undefined },
				{ label: 'check this', description: '/src/b.ts:4', detail: 'text 4' }
			],
			matchesDescriptionAndDetail: [true, true],
			removeButtons: [1, 1, 1]
		});

		hide(QuickInputHideReason.Blur);
		await closed;
	});

	test('lists and opens bookmarks on their lines right after an edit that has not settled', async () => {
		const { items, insertLinesAbove, select, closed, openedLines } = setup([bookmark('/src/a.ts', 3), bookmark('/src/a.ts', 5)], 2);
		const listed = items().map(item => item.description);

		insertLinesAbove(1);
		select(1);
		await closed;

		assert.deepStrictEqual({ listed, openedLines }, { listed: ['/src/a.ts:5', '/src/a.ts:7'], openedLines: [8] });
	});

	test('previews the highlighted bookmark and goes back when the picker is dismissed', async () => {
		const { activate, hide, closed, log } = setup([bookmark('/src/a.ts', 1), bookmark('/src/b.ts', 2)]);

		activate(1);
		hide(QuickInputHideReason.Gesture);
		await closed;

		assert.deepStrictEqual(log, ['show', 'state.set', 'preview /src/b.ts', 'state.restore']);
	});

	test('keeps the previewed editor when focus is lost', async () => {
		const { activate, hide, closed, log } = setup([bookmark('/src/a.ts', 1)]);

		activate(0);
		hide(QuickInputHideReason.Blur);
		await closed;

		assert.deepStrictEqual(log, ['show', 'state.set', 'preview /src/a.ts']);
	});

	test('opens the accepted bookmark without restoring the previous editor', async () => {
		const { activate, select, closed, log } = setup([bookmark('/src/a.ts', 1), bookmark('/src/b.ts', 2)]);

		activate(1);
		select(1);
		await closed;

		assert.deepStrictEqual(log, ['show', 'state.set', 'preview /src/b.ts', 'hide', 'state.reset', 'open /src/b.ts']);
	});

	test('removes a bookmark from the list with its button and highlights the next one', async () => {
		const quickPick = setup([bookmark('/src/a.ts', 1), bookmark('/src/a.ts', 2), bookmark('/src/a.ts', 3)]);

		quickPick.removeItem(1);

		assert.deepStrictEqual({ items: quickPick.items().map(item => item.label), active: quickPick.activeLabels }, { items: ['text 1', 'text 3'], active: ['text 3'] });

		quickPick.hide(QuickInputHideReason.Blur);
		await quickPick.closed;
	});

	test('highlights the next item that is still shown when an item is removed while a filter is typed', async () => {
		const quickPick = setup([bookmark('/src/a.ts', 1), bookmark('/src/b.ts', 2), bookmark('/src/c.ts', 3), bookmark('/src/d.ts', 4)]);
		quickPick.filter(item => item.label === 'text 1' || item.label === 'text 4');
		quickPick.activate(0);

		quickPick.removeItem(0);
		const afterFirst = { items: quickPick.items().map(item => item.label), active: quickPick.activeLabels };
		quickPick.removeItem(2);

		assert.deepStrictEqual({
			afterFirst,
			afterLast: { items: quickPick.items().map(item => item.label), active: quickPick.activeLabels },
			// Looking for the neighbor goes through the list, which must not open the items on the way.
			opened: quickPick.log.filter(entry => entry.startsWith('preview'))
		}, {
			afterFirst: { items: ['text 2', 'text 3', 'text 4'], active: ['text 4'] },
			afterLast: { items: ['text 2', 'text 3'], active: [] },
			opened: ['preview /src/a.ts', 'preview /src/d.ts']
		});

		quickPick.hide(QuickInputHideReason.Blur);
		await quickPick.closed;
	});

	test('highlights the previous item that is still shown when the last shown item is removed', async () => {
		const quickPick = setup([bookmark('/src/a.ts', 1), bookmark('/src/b.ts', 2), bookmark('/src/c.ts', 3), bookmark('/src/d.ts', 4)]);
		quickPick.filter(item => item.label !== 'text 3');

		quickPick.removeItem(3);

		assert.deepStrictEqual({ items: quickPick.items().map(item => item.label), active: quickPick.activeLabels }, { items: ['text 1', 'text 2', 'text 3'], active: ['text 2'] });

		quickPick.hide(QuickInputHideReason.Blur);
		await quickPick.closed;
	});

	test('closes and goes back to the previous editor when the last bookmark is removed', async () => {
		const { activate, removeItem, closed, log } = setup([bookmark('/src/a.ts', 1)]);

		activate(0);
		removeItem(0);
		await closed;

		assert.deepStrictEqual(log, ['show', 'state.set', 'preview /src/a.ts', 'hide', 'state.restore']);
	});

	test('tells the user when there is nothing to go to', async () => {
		const { picker, log, closed } = setup([bookmark('/src/a.ts', 1, { stale: true })]);

		await closed;

		assert.deepStrictEqual({ log, shown: picker.items.length }, { log: ['info There are no active bookmarks in this workspace.'], shown: 0 });
	});
});
