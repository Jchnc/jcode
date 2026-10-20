/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { BookmarkElement, BookmarkFileElement, BookmarksTree, BookmarksTreeModel } from '../../browser/bookmarksTree.js';
import { groupBookmarksByFile, ICodeBookmark } from '../../common/bookmarks.js';

function bookmark(path: string, lineNumber: number, extra: Partial<ICodeBookmark> = {}): ICodeBookmark {
	return { id: `${path}:${lineNumber}`, resource: URI.file(path), lineNumber, column: 1, lineText: `line ${lineNumber}`, beforeText: '', afterText: '', stale: false, createdAt: lineNumber, ...extra };
}

function group(bookmarks: readonly ICodeBookmark[]) {
	return groupBookmarksByFile(bookmarks, { getResourceKey: resource => resource.toString(), getResourceLabel: resource => resource.path });
}

suite('BookmarksTreeModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function isSame(actual: readonly unknown[], expected: readonly unknown[]): boolean {
		return actual.length === expected.length && actual.every((element, index) => element === expected[index]);
	}

	test('reuses elements and reports only the ones that changed', () => {
		const model = new BookmarksTreeModel();
		const first = bookmark('/a.ts', 1);
		const second = bookmark('/a.ts', 2);
		const other = bookmark('/b.ts', 1);
		const initial = model.update(group([first, second, other]));
		const files = initial.elements.map(({ element }) => element);
		const elements = initial.elements[0].children.map(({ element }) => element as BookmarkElement);

		const edited = { ...second, note: 'edited' };
		const update = model.update(group([first, edited, other]));

		assert.deepStrictEqual({
			files: isSame(update.elements.map(({ element }) => element), files),
			bookmarks: isSame(update.elements[0].children.map(({ element }) => element), elements),
			changed: isSame(update.changed, [elements[1]]),
			updatedBookmark: elements[1].bookmark === edited
		}, { files: true, bookmarks: true, changed: true, updatedBookmark: true });
	});

	test('reports a file whose bookmark count changed and drops removed files', () => {
		const model = new BookmarksTreeModel();
		const first = bookmark('/a.ts', 1);
		const initial = model.update(group([first, bookmark('/a.ts', 2), bookmark('/b.ts', 1)]));
		const fileA = initial.elements[0].element as BookmarkFileElement;

		const update = model.update(group([first]));

		assert.deepStrictEqual({
			files: isSame(update.elements.map(({ element }) => element), [fileA]),
			changed: isSame(update.changed, [fileA]),
			count: fileA.count
		}, { files: true, changed: true, count: 1 });
	});

	test('creates a new element for a bookmark that moves to another file', () => {
		const model = new BookmarksTreeModel();
		const moving = bookmark('/a.ts', 1);
		const initial = model.update(group([moving, bookmark('/b.ts', 1)]));
		const original = initial.elements[0].children[0].element;

		const update = model.update(group([{ ...moving, resource: URI.file('/c.ts') }, bookmark('/b.ts', 1)]));

		assert.deepStrictEqual({
			files: update.elements.map(({ element }) => (element as BookmarkFileElement).label),
			keptElement: update.elements.flatMap(({ children }) => children).some(({ element }) => element === original)
		}, { files: ['/b.ts', '/c.ts'], keptElement: false });
	});
});

suite('BookmarksTree', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(height = 200) {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const container = mainWindow.document.createElement('div');
		container.style.width = '300px';
		container.style.height = `${height}px`;
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));

		const tree = disposables.add(instantiationService.createInstance(BookmarksTree, container, { onDidChangeVisibility: Event.None }));
		tree.layout(height, 300);

		const rows = () => [...container.querySelectorAll<HTMLElement>('.monaco-list-row')];
		const focusedRow = () => container.querySelector<HTMLElement>('.monaco-list-row.focused');
		const scrollOffset = () => container.querySelector<HTMLElement>('.monaco-list-rows')!.style.top;
		const collapsibleRows = () => container.querySelectorAll('.monaco-tl-twistie.collapsible').length;
		return { tree, rows, focusedRow, scrollOffset, collapsibleRows };
	}

	const bookmarks = [1, 2, 3, 4, 5].map(line => bookmark('/a.ts', line));

	test('keeps focus, scroll position and the rendered rows when a bookmark changes', () => {
		const { tree, rows, focusedRow, scrollOffset } = setup(100);
		tree.setBookmarks(bookmarks);
		tree.focusBookmark('/a.ts:5');
		const rowsBefore = rows();
		const focusedRowBefore = focusedRow();
		const scrollBefore = scrollOffset();

		tree.setBookmarks(bookmarks.map(candidate => candidate.lineNumber === 4 ? { ...candidate, note: 'typed note' } : candidate));
		const rowsAfter = rows();

		assert.deepStrictEqual({
			focused: tree.getFocusedBookmark()?.id,
			scrolled: scrollBefore !== '0px' && scrollBefore !== '-0px',
			scrollKept: scrollOffset() === scrollBefore,
			untouchedRowsKept: rowsBefore.map((row, index) => rowsAfter[index] === row || row.textContent!.includes('line 4')),
			focusedRowKept: focusedRow() === focusedRowBefore,
			editedRow: rowsAfter.some(row => row.textContent!.includes('typed note'))
		}, {
			focused: '/a.ts:5',
			scrolled: true,
			scrollKept: true,
			untouchedRowsKept: rowsBefore.map(() => true),
			focusedRowKept: true,
			editedRow: true
		});
	});

	test('shows the color of a bookmark in its marker, names it, and announces it', () => {
		const { tree, rows } = setup();
		const describeRow = (row: HTMLElement) => ({
			markerColor: row.querySelector<HTMLElement>('.jcode-bookmark-marker')!.style.color,
			secondary: row.querySelector('.jcode-bookmark-secondary')!.textContent,
			ariaLabel: row.getAttribute('aria-label')
		});

		tree.setBookmarks([bookmark('/a.ts', 1), bookmark('/a.ts', 2, { color: 'blue' }), bookmark('/a.ts', 3, { color: 'blue', stale: true })]);
		const [, plain, colored, stale] = rows();

		assert.deepStrictEqual({ plain: describeRow(plain), colored: describeRow(colored), stale: describeRow(stale) }, {
			plain: { markerColor: '', secondary: 'Line 1', ariaLabel: 'line 1, line 1' },
			colored: { markerColor: 'var(--vscode-editorBookmark-blueForeground)', secondary: 'Line 2 · Blue', ariaLabel: 'line 2, line 2, Blue color' },
			// A stale bookmark keeps the warning color, which matters more than its tag.
			stale: { markerColor: '', secondary: 'Was on line 3 · Blue · Stale', ariaLabel: 'line 3, stale bookmark, was on line 3, Blue color' }
		});
	});

	test('hands focus to the next bookmark when the focused one is removed', () => {
		const { tree } = setup();
		tree.setBookmarks(bookmarks);
		tree.focusBookmark('/a.ts:2');
		tree.focus();

		tree.setBookmarks(bookmarks.filter(candidate => candidate.lineNumber !== 2));

		assert.strictEqual(tree.getFocusedBookmark()?.id, '/a.ts:3');
	});

	test('lets every file collapse, but not the bookmarks in it', () => {
		const { tree, collapsibleRows } = setup();

		tree.setBookmarks([...bookmarks.slice(0, 2), bookmark('/b.ts', 1)]);

		assert.strictEqual(collapsibleRows(), 2);
	});
});
