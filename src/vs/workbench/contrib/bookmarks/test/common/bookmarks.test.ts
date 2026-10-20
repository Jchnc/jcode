/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { captureBookmarkAnchor, findBookmarkLine, groupBookmarksByFile, ICodeBookmark, isBookmarkLineRemoved, mergeDuplicateBookmarks } from '../../common/bookmarks.js';

suite('Code bookmarks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
			deleteStartOfLine: edit(3, 1, 4, 1, 'moved\n'),
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
			deleteStartOfLine: false,
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

	test('groups bookmarks by file label and sorts them by position', () => {
		const bookmark = (id: string, path: string, lineNumber: number, column = 1): ICodeBookmark => ({ id, resource: URI.file(path), lineNumber, column, lineText: '', beforeText: '', afterText: '', stale: false, createdAt: 0 });

		const groups = groupBookmarksByFile([
			bookmark('a', '/src/b.ts', 9),
			bookmark('b', '/src/a.ts', 12),
			bookmark('c', '/src/b.ts', 2, 5),
			bookmark('d', '/src/a.ts', 3),
			bookmark('e', '/src/b.ts', 2, 1)
		], resource => resource.toString(), resource => resource.path);

		assert.deepStrictEqual(groups.map(group => ({ label: group.label, bookmarks: group.bookmarks.map(candidate => candidate.id) })), [
			{ label: '/src/a.ts', bookmarks: ['d', 'b'] },
			{ label: '/src/b.ts', bookmarks: ['e', 'c', 'a'] }
		]);
	});
});
