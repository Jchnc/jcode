/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getColorRegistry } from '../../../../../platform/theme/common/colorUtils.js';
import { WORKBENCH_COLOR_PALETTE } from '../../../../common/workbenchColorPalette.js';
import { BOOKMARK_COLORS, getBookmarkColor, getBookmarkGlyphColorRules } from '../../common/bookmarkColors.js';
import { captureBookmarkAnchor, findAdjacentBookmark, findBookmarkLine, groupBookmarksByFile, ICodeBookmark, isBookmarkLineRemoved, mergeDuplicateBookmarks, resolveBookmarkLinesAfterEdit } from '../../common/bookmarks.js';

suite('Code bookmarks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const fileOrder = { getResourceKey: (resource: URI) => resource.toString(), getResourceLabel: (resource: URI) => resource.path };

	test('relocates a bookmark using its source context', () => {
		const original = ['function save() {', '\tvalidate();', '\tcommit();', '}'];
		const anchor = captureBookmarkAnchor(original, 3);
		const changed = ['const ready = true;', '', ...original];

		assert.strictEqual(findBookmarkLine(changed, 3, anchor), 5);
	});

	test('uses neighboring lines to disambiguate repeated source text', () => {
		const lines = ['if (first) {', '\treturn value;', '}', 'if (second) {', '\treturn value;', '}'];
		const anchor = captureBookmarkAnchor(lines, 5);
		const changed = ['// inserted', ...lines];

		assert.strictEqual(findBookmarkLine(changed, 5, anchor), 6);
	});

	test('reports a bookmark as unresolved when its source text disappeared', () => {
		const anchor = captureBookmarkAnchor(['const previous = true;'], 1);
		assert.strictEqual(findBookmarkLine(['const replacement = true;'], 1, anchor), undefined);
	});

	test('only relocates a stale bookmark to a line whose surroundings match', () => {
		const anchor = captureBookmarkAnchor(['if (a) {', '\treturn;', '}', 'next();'], 3);
		const unrelated = ['if (b) {', '\tlog();', '}', 'other();'];
		const unchanged = ['// added', 'if (a) {', '\treturn;', '}', 'next();'];

		assert.deepStrictEqual({
			unrelated: findBookmarkLine(unrelated, 3, anchor, true),
			unrelatedWithoutContext: findBookmarkLine(unrelated, 3, anchor),
			unchanged: findBookmarkLine(unchanged, 3, anchor, true)
		}, { unrelated: undefined, unrelatedWithoutContext: 3, unchanged: 4 });
	});

	test('detects an edit that deletes the whole line', () => {
		const line = 3;
		const maxColumn = 6;
		const edit = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, text = '') => isBookmarkLineRemoved({ range: { startLineNumber, startColumn, endLineNumber, endColumn }, text }, line, maxColumn);

		assert.deepStrictEqual({
			deleteLineWithBreak: edit(3, 1, 4, 1),
			deleteLineWithPrecedingBreak: edit(2, 6, 3, 6),
			deleteSeveralLines: edit(2, 3, 5, 2),
			replaceSeveralLinesWithText: edit(2, 3, 5, 2, 'x'),
			clearTextOnly: edit(3, 1, 3, 6),
			editInsideLine: edit(3, 2, 3, 4),
			joinWithPreviousLine: edit(2, 6, 3, 1),
			replaceLineWithOtherLines: edit(3, 1, 4, 1, 'moved\n'),
			typeNewLine: edit(3, 3, 3, 3, '\n'),
			otherLine: edit(5, 1, 6, 1)
		}, {
			deleteLineWithBreak: true,
			deleteLineWithPrecedingBreak: true,
			deleteSeveralLines: true,
			replaceSeveralLinesWithText: true,
			clearTextOnly: false,
			editInsideLine: false,
			joinWithPreviousLine: false,
			replaceLineWithOtherLines: true,
			typeNewLine: false,
			otherLine: false
		});
	});

	test('keeps an empty line when the line next to it is deleted', () => {
		const line = 3;
		const edit = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => isBookmarkLineRemoved({ range: { startLineNumber, startColumn, endLineNumber, endColumn }, text: '' }, line, 1);

		assert.deepStrictEqual({
			deletePreviousLine: edit(2, 1, 3, 1),
			deleteFollowingLastLine: edit(3, 1, 4, 6),
			deleteEmptyLine: edit(3, 1, 4, 1),
			backspaceOnEmptyLine: edit(2, 6, 3, 1)
		}, {
			deletePreviousLine: false,
			deleteFollowingLastLine: false,
			deleteEmptyLine: true,
			backspaceOnEmptyLine: true
		});
	});

	test('lets a line that an edit inserted once be followed by one bookmark only', () => {
		// Lines 1 to 3 are replaced by two lines, of which only one has the text of the two bookmarked lines.
		const after = ['a', '}'];
		const text = { getLineCount: () => after.length, getLineContent: (lineNumber: number) => after[lineNumber - 1] };
		const bookmark = (id: string, lineNumber: number) => ({ id, lineNumber, maxColumn: 2, lineText: '}' });

		const resolutions = resolveBookmarkLinesAfterEdit(
			[{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 }, text: after.join('\n') }],
			[bookmark('second', 2), bookmark('first', 1)],
			text);

		assert.deepStrictEqual([...resolutions], [['first', { kind: 'moved', lineNumber: 2 }], ['second', { kind: 'removed' }]]);
	});

	test('does not look for the text of a line that an edit merely changed', () => {
		const after = ['alpha', 'beta changed', 'gamma'];
		const text = { getLineCount: () => after.length, getLineContent: (lineNumber: number) => after[lineNumber - 1] };

		const resolutions = resolveBookmarkLinesAfterEdit(
			[{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 5 }, text: 'beta changed' }],
			[{ id: 'a', lineNumber: 2, maxColumn: 5, lineText: 'beta' }],
			text);

		assert.deepStrictEqual([...resolutions], []);
	});

	test('merges bookmarks that share a line and keeps their notes', () => {
		const resource = URI.file('/workspace/file.ts');
		const bookmark = (id: string, lineNumber: number, extra: Partial<ICodeBookmark> = {}): ICodeBookmark => ({ id, resource, lineNumber, column: 1, lineText: 'text', beforeText: '', afterText: '', stale: false, createdAt: 10, ...extra });
		const getKey = (uri: URI) => uri.toString();
		const unique = [bookmark('a', 1), bookmark('b', 2)];
		const summarize = (bookmarks: readonly ICodeBookmark[]) => bookmarks.map(({ id, note }) => ({ id, note }));

		assert.deepStrictEqual({
			unique: mergeDuplicateBookmarks(unique, getKey) === unique,
			noteWins: summarize(mergeDuplicateBookmarks([bookmark('a', 1, { createdAt: 1 }), bookmark('b', 1, { note: 'keep' })], getKey)),
			olderWins: summarize(mergeDuplicateBookmarks([bookmark('a', 1), bookmark('b', 1, { createdAt: 1 })], getKey)),
			bothNotes: summarize(mergeDuplicateBookmarks([bookmark('a', 1, { note: 'first' }), bookmark('b', 1, { note: 'second', createdAt: 1 })], getKey)),
			staleStaysApart: summarize(mergeDuplicateBookmarks([bookmark('a', 1), bookmark('b', 1, { stale: true }), bookmark('c', 1, { stale: true }), bookmark('d', 1, { stale: true, lineText: 'other' })], getKey))
		}, {
			unique: true,
			noteWins: [{ id: 'b', note: 'keep' }],
			olderWins: [{ id: 'b', note: undefined }],
			bothNotes: [{ id: 'b', note: 'second · first' }],
			staleStaysApart: [{ id: 'a', note: undefined }, { id: 'b', note: undefined }, { id: 'd', note: undefined }]
		});
	});

	test('keeps the color of the merged bookmark, else the color of the other one', () => {
		const resource = URI.file('/workspace/file.ts');
		const bookmark = (id: string, extra: Partial<ICodeBookmark> = {}): ICodeBookmark => ({ id, resource, lineNumber: 1, column: 1, lineText: 'text', beforeText: '', afterText: '', stale: false, createdAt: 10, ...extra });
		const merged = (...bookmarks: ICodeBookmark[]) => mergeDuplicateBookmarks(bookmarks, uri => uri.toString()).map(({ id, note, color }) => ({ id, note, color }));

		assert.deepStrictEqual({
			ownColorWins: merged(bookmark('a', { createdAt: 1, color: 'blue' }), bookmark('b', { note: 'keep', color: 'red' })),
			otherColorFillsIn: merged(bookmark('a', { createdAt: 1, color: 'blue' }), bookmark('b', { note: 'keep' })),
			olderWithoutColorTakesIt: merged(bookmark('a', { createdAt: 1 }), bookmark('b', { color: 'teal' })),
			uncolored: merged(bookmark('a'), bookmark('b', { createdAt: 1 }))
		}, {
			ownColorWins: [{ id: 'b', note: 'keep', color: 'red' }],
			otherColorFillsIn: [{ id: 'b', note: 'keep', color: 'blue' }],
			olderWithoutColorTakesIt: [{ id: 'a', note: undefined, color: 'teal' }],
			uncolored: [{ id: 'b', note: undefined, color: undefined }]
		});
	});

	test('only knows the colors of the shared palette', () => {
		assert.deepStrictEqual({
			known: BOOKMARK_COLORS.length > 0 && BOOKMARK_COLORS.every(color => getBookmarkColor(color.id) === color),
			themeColors: BOOKMARK_COLORS.map(color => color.colorId),
			registered: BOOKMARK_COLORS.every(color => getColorRegistry().getColors().some(registered => registered.id === color.colorId)),
			glyphRules: getBookmarkGlyphColorRules().length,
			blueGlyphRule: getBookmarkGlyphColorRules().find(rule => rule.includes('jcode-bookmark-color-blue')),
			sharedWithTabGroups: BOOKMARK_COLORS.map(color => color.id),
			unknown: getBookmarkColor('magenta'),
			none: getBookmarkColor(undefined)
		}, {
			known: true,
			themeColors: WORKBENCH_COLOR_PALETTE.map(color => `editorBookmark.${color.id}Foreground`),
			registered: true,
			glyphRules: WORKBENCH_COLOR_PALETTE.length,
			blueGlyphRule: '.monaco-workbench .jcode-bookmark-glyph.codicon.jcode-bookmark-color-blue { color: var(--vscode-editorBookmark-blueForeground); }',
			sharedWithTabGroups: WORKBENCH_COLOR_PALETTE.map(color => color.id),
			unknown: undefined,
			none: undefined
		});
	});

	test('groups bookmarks by file label and sorts them by position', () => {
		const bookmark = (id: string, path: string, lineNumber: number, column = 1): ICodeBookmark => ({ id, resource: URI.file(path), lineNumber, column, lineText: '', beforeText: '', afterText: '', stale: false, createdAt: 0 });

		const groups = groupBookmarksByFile([
			bookmark('a', '/src/b.ts', 9),
			bookmark('b', '/src/a.ts', 12),
			bookmark('c', '/src/b.ts', 2, 5),
			bookmark('d', '/src/a.ts', 3),
			bookmark('e', '/src/b.ts', 2, 1)
		], fileOrder);

		assert.deepStrictEqual(groups.map(group => ({ label: group.label, bookmarks: group.bookmarks.map(candidate => candidate.id) })), [
			{ label: '/src/a.ts', bookmarks: ['d', 'b'] },
			{ label: '/src/b.ts', bookmarks: ['e', 'c', 'a'] }
		]);
	});

	test('goes to the next and previous bookmark in the order they are listed', () => {
		const bookmark = (id: string, path: string, lineNumber: number, stale = false): ICodeBookmark => ({ id, resource: URI.file(path), lineNumber, column: 1, lineText: '', beforeText: '', afterText: '', stale, createdAt: 0 });
		const bookmarks = [bookmark('b9', '/b.ts', 9), bookmark('a4', '/a.ts', 4), bookmark('a20', '/a.ts', 20), bookmark('b2', '/b.ts', 2), bookmark('a8', '/a.ts', 8, true)];
		const go = (path: string | undefined, lineNumber: number, direction: 1 | -1) => findAdjacentBookmark(bookmarks, path ? { resource: URI.file(path), lineNumber } : undefined, direction, fileOrder)?.id;

		assert.deepStrictEqual({
			nextInFile: go('/a.ts', 4, 1),
			nextAcrossFiles: go('/a.ts', 20, 1),
			nextWraps: go('/b.ts', 9, 1),
			previousInFile: go('/b.ts', 9, -1),
			previousAcrossFiles: go('/b.ts', 2, -1),
			previousWraps: go('/a.ts', 4, -1),
			fromFileWithoutBookmarks: [go('/0.ts', 1, 1), go('/c.ts', 1, -1), go('/ab.ts', 1, 1), go('/ab.ts', 1, -1)],
			withoutCursor: [go(undefined, 1, 1), go(undefined, 1, -1)],
			staleIgnored: go('/a.ts', 5, 1)
		}, {
			nextInFile: 'a20',
			nextAcrossFiles: 'b2',
			nextWraps: 'a4',
			previousInFile: 'b2',
			previousAcrossFiles: 'a20',
			previousWraps: 'b9',
			fromFileWithoutBookmarks: ['a4', 'b9', 'b2', 'a20'],
			withoutCursor: ['a4', 'b9'],
			staleIgnored: 'a20'
		});
	});
});
