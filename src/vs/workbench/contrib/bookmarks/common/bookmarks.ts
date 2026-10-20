/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const CONTEXT_CODE_BOOKMARKS_PRESENT = new RawContextKey<boolean>('jcode.bookmarks.hasBookmarks', false, true);
export const CONTEXT_CODE_BOOKMARKS_STALE_PRESENT = new RawContextKey<boolean>('jcode.bookmarks.hasStaleBookmarks', false, true);

/**
 * The kind of item in the Bookmarks view an action is invoked on.
 */
export const enum BookmarkItemKind {
	File = 'file',
	Bookmark = 'bookmark',
	StaleBookmark = 'staleBookmark'
}

export const CONTEXT_CODE_BOOKMARK_ITEM_KIND = new RawContextKey<string>('jcode.bookmarks.itemKind', '', true);

/**
 * The context menu of an item in the Bookmarks view.
 */
export const BOOKMARKS_VIEW_ITEM_MENU = new MenuId('JCodeBookmarksViewItem');

/**
 * The actions shown inline on a hovered or focused item in the Bookmarks view.
 */
export const BOOKMARKS_VIEW_ITEM_INLINE_MENU = new MenuId('JCodeBookmarksViewItemInline');

/**
 * The argument passed to actions that are invoked on a bookmark in the Bookmarks view.
 */
export interface IBookmarkActionContext {
	readonly bookmarkId: string;
}

export function isBookmarkActionContext(value: unknown): value is IBookmarkActionContext {
	return typeof value === 'object' && value !== null && typeof (value as Partial<IBookmarkActionContext>).bookmarkId === 'string';
}

export interface ICodeBookmarkAnchor {
	readonly lineText: string;
	readonly beforeText: string;
	readonly afterText: string;
}

export interface ICodeBookmark extends ICodeBookmarkAnchor {
	readonly id: string;
	readonly resource: URI;
	/**
	 * The line the bookmark is on. For a stale bookmark this is the last known line,
	 * which no longer identifies a location in the file.
	 */
	readonly lineNumber: number;
	readonly column: number;
	readonly note?: string;
	/**
	 * Whether the bookmarked line was deleted or could not be found again.
	 */
	readonly stale: boolean;
	readonly createdAt: number;
}

export interface ICodeBookmarksService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeBookmarks: Event<void>;
	readonly bookmarks: readonly ICodeBookmark[];

	toggle(resource: URI, lineNumber: number, column?: number): ICodeBookmark | undefined;
	updateNote(id: string, note: string | undefined): void;
	remove(id: string): void;
	removeAll(): void;
	/**
	 * Removes every stale bookmark.
	 */
	removeStale(): void;
	/**
	 * Moves a bookmark, typically a stale one, to the given line and clears its stale state.
	 * When the target line already has a bookmark, the stale one is merged into it.
	 */
	relocate(id: string, resource: URI, lineNumber: number, column?: number): ICodeBookmark | undefined;
	/**
	 * Finds the live (not stale) bookmark on the given line.
	 */
	find(resource: URI, lineNumber: number): ICodeBookmark | undefined;
	/**
	 * Applies the edits to open files that are not reflected in the bookmarks yet, which otherwise
	 * happens a moment after typing stops. Call it before reading line numbers for something the
	 * user is about to land on, such as navigation. Listeners are notified when a line changed.
	 */
	sync(): void;
}

export const ICodeBookmarksService = createDecorator<ICodeBookmarksService>('codeBookmarksService');

/**
 * Finds the line a bookmark belongs to after the text changed.
 *
 * @param requireContext Only accept a line whose neighboring lines also match the anchor. Used for
 * bookmarks that were already marked stale, so that a common line such as `}` can not silently
 * adopt them.
 */
export function findBookmarkLine(lines: readonly string[], preferredLineNumber: number, anchor: ICodeBookmarkAnchor, requireContext = false): number | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const preferredIndex = Math.max(0, Math.min(lines.length - 1, preferredLineNumber - 1));
	const lineText = normalizeLine(anchor.lineText);
	if (!requireContext && normalizeLine(lines[preferredIndex]) === lineText) {
		return preferredIndex + 1;
	}

	let best: { lineNumber: number; score: number; hasContext: boolean } | undefined;
	for (let index = 0; index < lines.length; index++) {
		if (normalizeLine(lines[index]) !== lineText) {
			continue;
		}

		let score = -Math.abs(index - preferredIndex);
		const beforeMatches = index > 0 ? normalizeLine(lines[index - 1]) === normalizeLine(anchor.beforeText) : normalizeLine(anchor.beforeText) === '';
		const afterMatches = index + 1 < lines.length ? normalizeLine(lines[index + 1]) === normalizeLine(anchor.afterText) : normalizeLine(anchor.afterText) === '';
		if (index > 0 && beforeMatches) {
			score += 1000;
		}
		if (index + 1 < lines.length && afterMatches) {
			score += 1000;
		}
		if (!best || score > best.score) {
			best = { lineNumber: index + 1, score, hasContext: beforeMatches && afterMatches };
		}
	}

	if (requireContext && !best?.hasContext) {
		return undefined;
	}
	return best?.lineNumber;
}

/**
 * The text that best identifies a bookmark: its note, else its line, else a placeholder.
 */
export function getBookmarkLabel(bookmark: Pick<ICodeBookmark, 'note' | 'lineText'>): string {
	return bookmark.note || bookmark.lineText.trim() || localize('bookmarkEmptyLine', "Empty line");
}

/**
 * Merges bookmarks that share a resource and line so that every line has at most one bookmark.
 * The bookmark with a note is kept, else the one created first, and it keeps the note of the
 * other when it has none of its own.
 *
 * A stale bookmark no longer has a position, so it is only merged with an identical stale bookmark.
 *
 * @returns The given array when there is nothing to merge, else a new array in which a merged
 * bookmark takes the place of the first of its duplicates.
 */
export function mergeDuplicateBookmarks(bookmarks: readonly ICodeBookmark[], getResourceKey: (resource: URI) => string): readonly ICodeBookmark[] {
	const indexByKey = new Map<string, number>();
	const result: ICodeBookmark[] = [];
	for (const bookmark of bookmarks) {
		const resourceKey = getResourceKey(bookmark.resource);
		const key = JSON.stringify(bookmark.stale ? ['stale', resourceKey, bookmark.lineNumber, bookmark.lineText] : ['live', resourceKey, bookmark.lineNumber]);
		const index = indexByKey.get(key);
		if (index === undefined) {
			indexByKey.set(key, result.length);
			result.push(bookmark);
		} else {
			result[index] = mergeBookmarks(result[index], bookmark);
		}
	}
	return result.length === bookmarks.length ? bookmarks : result;
}

function mergeBookmarks(first: ICodeBookmark, second: ICodeBookmark): ICodeBookmark {
	const keepFirst = !!first.note === !!second.note ? first.createdAt <= second.createdAt : !!first.note;
	const [kept, other] = keepFirst ? [first, second] : [second, first];
	const note = kept.note && other.note && kept.note !== other.note ? `${kept.note} · ${other.note}` : kept.note || other.note;
	return { ...kept, note };
}

/**
 * The bookmarks of a single file as they are listed.
 */
export interface IBookmarkFileGroup {
	readonly key: string;
	readonly resource: URI;
	readonly label: string;
	readonly bookmarks: readonly ICodeBookmark[];
}

/**
 * Defines how files are told apart and ordered when bookmarks are listed, so that the Bookmarks
 * view and the navigation commands agree on the order.
 */
export interface IBookmarkFileOrder {
	getResourceKey(resource: URI): string;
	getResourceLabel(resource: URI): string;
}

function compareFiles(left: { readonly key: string; readonly label: string }, right: { readonly key: string; readonly label: string }): number {
	return left.label.localeCompare(right.label) || left.key.localeCompare(right.key);
}

/**
 * Groups bookmarks by file in the order they are listed: files by label, bookmarks by position.
 */
export function groupBookmarksByFile(bookmarks: readonly ICodeBookmark[], order: IBookmarkFileOrder): IBookmarkFileGroup[] {
	const groups = new Map<string, { readonly key: string; readonly resource: URI; readonly label: string; readonly bookmarks: ICodeBookmark[] }>();
	for (const bookmark of bookmarks) {
		const key = order.getResourceKey(bookmark.resource);
		let group = groups.get(key);
		if (!group) {
			group = { key, resource: bookmark.resource, label: order.getResourceLabel(bookmark.resource), bookmarks: [] };
			groups.set(key, group);
		}
		group.bookmarks.push(bookmark);
	}
	return [...groups.values()]
		.sort(compareFiles)
		.map(group => ({ ...group, bookmarks: group.bookmarks.sort((left, right) => left.lineNumber - right.lineNumber || left.column - right.column || left.createdAt - right.createdAt) }));
}

/**
 * Finds the bookmark to go to from a cursor position, following the order in which bookmarks are
 * listed and wrapping around at either end. Stale bookmarks have no position and are skipped.
 */
export function findAdjacentBookmark(bookmarks: readonly ICodeBookmark[], cursor: { readonly resource: URI; readonly lineNumber: number } | undefined, direction: 1 | -1, order: IBookmarkFileOrder): ICodeBookmark | undefined {
	const cursorFile = cursor && { key: order.getResourceKey(cursor.resource), label: order.getResourceLabel(cursor.resource) };
	const positions = groupBookmarksByFile(bookmarks.filter(bookmark => !bookmark.stale), order).flatMap(group => group.bookmarks.map(bookmark => ({
		bookmark,
		// Whether the bookmark is after (positive) or before (negative) the cursor, and zero on the cursor line.
		relativeToCursor: cursor && cursorFile ? compareFiles(group, cursorFile) || bookmark.lineNumber - cursor.lineNumber : 0
	})));
	if (!cursor) {
		return (direction > 0 ? positions[0] : positions[positions.length - 1])?.bookmark;
	}
	const adjacent = direction > 0 ? positions.find(position => position.relativeToCursor > 0) : positions.findLast(position => position.relativeToCursor < 0);
	return (adjacent ?? (direction > 0 ? positions[0] : positions[positions.length - 1]))?.bookmark;
}

export function captureBookmarkAnchor(lines: readonly string[], lineNumber: number): ICodeBookmarkAnchor {
	const index = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
	return {
		lineText: lines[index] ?? '',
		beforeText: index > 0 ? lines[index - 1] : '',
		afterText: index + 1 < lines.length ? lines[index + 1] : ''
	};
}

/**
 * A text edit as reported by a model content change, with the range expressed in the
 * coordinates of the text before the edit.
 */
export interface IBookmarkTextEdit {
	readonly range: IRange;
	readonly text: string;
}

/**
 * Whether an edit consumed a whole line, content and line break, rather than merely changing its
 * text. What the edit inserts in its place does not matter: a line that was replaced is gone, and
 * {@link resolveBookmarkLinesAfterEdit} looks for its content in the inserted text.
 *
 * @param lineNumber The line number before the edit.
 * @param lineMaxColumn The max column of that line before the edit.
 */
export function isBookmarkLineRemoved(edit: IBookmarkTextEdit, lineNumber: number, lineMaxColumn: number): boolean {
	const { range } = edit;
	if (range.startLineNumber === range.endLineNumber || lineNumber < range.startLineNumber || lineNumber > range.endLineNumber) {
		return false;
	}

	// The edit joins its first and last line into one, so the lines in between are gone.
	if (lineNumber > range.startLineNumber && lineNumber < range.endLineNumber) {
		return true;
	}

	// The first or last line is gone when the edit takes all of its text. An empty line has no text
	// to take, so it only counts as gone when the line on the other side of the edit survives:
	// deleting a line keeps the empty line that follows or precedes it.
	const isEmpty = lineMaxColumn === 1;
	if (lineNumber === range.startLineNumber) {
		return range.startColumn === 1 && (!isEmpty || range.endColumn === 1);
	}
	return range.endColumn >= lineMaxColumn && (!isEmpty || range.startColumn > 1);
}

/**
 * A change of a diff, in the shape in which diff editors report it: a range that is empty is
 * given as an end line of 0, with the start line being the line before the empty range.
 */
export interface IBookmarkDiffChange {
	readonly originalStartLineNumber: number;
	readonly originalEndLineNumber: number;
	readonly modifiedStartLineNumber: number;
	readonly modifiedEndLineNumber: number;
}

/**
 * Finds the line of the modified side of a diff that has the same text as a line of the original side.
 *
 * @param changes The changes of the diff, in the order of the text.
 * @returns The line, or `undefined` when the line is part of a change and so has no counterpart.
 */
export function mapOriginalLineToModified(lineNumber: number, changes: readonly IBookmarkDiffChange[]): number | undefined {
	let lineDelta = 0;
	for (const change of changes) {
		const originalLength = change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1;
		const modifiedLength = change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
		const lastLineBefore = originalLength === 0 ? change.originalStartLineNumber : change.originalStartLineNumber - 1;
		if (lineNumber <= lastLineBefore) {
			break;
		}
		if (lineNumber <= change.originalStartLineNumber + originalLength - 1) {
			return undefined;
		}
		lineDelta += modifiedLength - originalLength;
	}
	return lineNumber + lineDelta;
}

/**
 * A bookmarked line as it was right before an edit.
 */
export interface IEditedBookmark {
	readonly id: string;
	readonly lineNumber: number;
	readonly maxColumn: number;
	readonly lineText: string;
}

/**
 * What an edit did to a bookmark whose line did not simply stay put or shift along: the bookmark
 * is either gone with its line, or follows the content of its line to another line.
 */
export type BookmarkLineResolution = { readonly kind: 'removed' } | { readonly kind: 'moved'; readonly lineNumber: number };

/**
 * The text after an edit, as far as {@link resolveBookmarkLinesAfterEdit} needs it.
 */
export interface IBookmarkEditedText {
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
}

/**
 * Works out what a change did to the bookmarked lines that the range tracking of the editor can not follow.
 * Tracked ranges are offsets in the text, so when an edit spans lines, a bookmark inside it lands wherever the
 * offset arithmetic puts it, rather than with the content of its line. That is what happens with edits that
 * delete a line and bring it back elsewhere, such as Move Line Up and Down and Sort Lines, with a paste over
 * whole lines, and with a replacement across line breaks.
 *
 * - A line that an edit consumed is searched for among the lines that the edits inserted, and its bookmark
 *   follows it there. When it is not found and its line break is gone too, the bookmark is removed.
 * - The rest of a line that an edit joined to an earlier line keeps its bookmark, on the line that results.
 * - An empty line that Move Line Up or Down moved keeps its bookmark, see {@link findMovedEmptyLine}.
 *
 * Bookmarks that are not in the result stay where the editor tracked them.
 *
 * @param edits The edits of one change, with ranges in the coordinates of the text before the change.
 * @param bookmarks The bookmarks as they were before the change.
 * @param text The text after the change.
 */
export function resolveBookmarkLinesAfterEdit(edits: readonly IBookmarkTextEdit[], bookmarks: readonly IEditedBookmark[], text: IBookmarkEditedText): Map<string, BookmarkLineResolution> {
	const resolutions = new Map<string, BookmarkLineResolution>();
	if (bookmarks.length === 0) {
		return resolutions;
	}

	// Edits are described in the text before the change, so each edit starts further down by the lines added above it.
	let precedingDelta = 0;
	const blocks = [...edits].sort((left, right) => Range.compareRangesUsingEnds(left.range, right.range)).map((edit): IEditBlock => {
		const lines = edit.text.split(/\r\n|\r|\n/);
		const lineDelta = lines.length - 1 - (edit.range.endLineNumber - edit.range.startLineNumber);
		const block = { edit, lines, lineDelta, startLine: edit.range.startLineNumber + precedingDelta };
		precedingDelta += lineDelta;
		return block;
	});

	let insertedLines: { readonly lineNumber: number; readonly text: string }[] | undefined;
	const getInsertedLines = () => insertedLines ??= blocks.flatMap(({ edit, lines, startLine }) => edit.text === '' ? [] : lines.flatMap((line, index) => {
		// Only whole lines count, not a line that got the rest of another line attached to it.
		const lineNumber = startLine + index;
		const lineText = normalizeLine(line);
		return lineText && lineNumber <= text.getLineCount() && normalizeLine(text.getLineContent(lineNumber)) === lineText ? [{ lineNumber, text: lineText }] : [];
	}));

	const claimed = new Set<number>();
	for (const bookmark of [...bookmarks].sort((left, right) => left.lineNumber - right.lineNumber)) {
		const { lineNumber, maxColumn } = bookmark;
		const lineText = normalizeLine(bookmark.lineText);
		const isRemoved = edits.some(edit => isBookmarkLineRemoved(edit, lineNumber, maxColumn));

		if (lineText && (isRemoved || edits.some(({ range }) => isLineTextCovered(range, lineNumber, maxColumn)))) {
			// Follows the content of its line, to the closest line with the same text.
			const expectedLineNumber = lineNumber + blocks.reduce((delta, block) => block.edit.range.endLineNumber < lineNumber ? delta + block.lineDelta : delta, 0);
			let target: number | undefined;
			for (const candidate of getInsertedLines()) {
				if (candidate.text === lineText && !claimed.has(candidate.lineNumber) && (target === undefined || Math.abs(candidate.lineNumber - expectedLineNumber) < Math.abs(target - expectedLineNumber))) {
					target = candidate.lineNumber;
				}
			}
			if (target !== undefined) {
				claimed.add(target);
				resolutions.set(bookmark.id, { kind: 'moved', lineNumber: target });
				continue;
			}
		}

		if (isRemoved) {
			resolutions.set(bookmark.id, { kind: 'removed' });
			continue;
		}

		const emptyLineMovedTo = !lineText && maxColumn === 1 ? findMovedEmptyLine(blocks, lineNumber, text) : undefined;
		if (emptyLineMovedTo !== undefined) {
			resolutions.set(bookmark.id, { kind: 'moved', lineNumber: emptyLineMovedTo });
			continue;
		}

		const joinedTo = blocks.find(({ edit: { range } }) => range.startLineNumber < lineNumber && range.endLineNumber === lineNumber);
		if (joinedTo) {
			resolutions.set(bookmark.id, { kind: 'moved', lineNumber: joinedTo.startLine + joinedTo.lines.length - 1 });
		}
	}
	return resolutions;
}

/**
 * An edit of a change, with the line it starts on in the text after the change.
 */
interface IEditBlock {
	readonly edit: IBookmarkTextEdit;
	readonly lines: readonly string[];
	readonly lineDelta: number;
	readonly startLine: number;
}

/**
 * An empty line has no text to follow. Move Line Up and Down move an empty line by typing the text of
 * the neighboring line into it and clearing that line, so when a change does exactly that, the empty
 * line went to the line that was cleared.
 *
 * @returns The line, in the text after the change, that the empty line moved to.
 */
function findMovedEmptyLine(blocks: readonly IEditBlock[], lineNumber: number, text: IBookmarkEditedText): number | undefined {
	const typed = blocks.find(({ edit: { range, text: inserted } }) => range.startLineNumber === lineNumber && range.endLineNumber === lineNumber && range.startColumn === 1 && range.endColumn === 1 && inserted !== '' && !/[\r\n]/.test(inserted));
	if (!typed) {
		return undefined;
	}
	const cleared = blocks.find(({ edit: { range, text: inserted } }) => inserted === '' && Math.abs(range.startLineNumber - lineNumber) === 1 && range.endLineNumber === range.startLineNumber && range.startColumn === 1 && range.endColumn === typed.edit.text.length + 1);
	return cleared && cleared.startLine <= text.getLineCount() && text.getLineContent(cleared.startLine) === '' ? cleared.startLine : undefined;
}

/**
 * Whether a range takes all the text of a line, which has some, whether or not it takes the line break.
 */
function isLineTextCovered(range: IRange, lineNumber: number, lineMaxColumn: number): boolean {
	const startsBefore = range.startLineNumber < lineNumber || range.startLineNumber === lineNumber && range.startColumn === 1;
	const endsAfter = range.endLineNumber > lineNumber || range.endLineNumber === lineNumber && range.endColumn >= lineMaxColumn;
	return lineMaxColumn > 1 && startsBefore && endsAfter;
}

function normalizeLine(value: string): string {
	return value.trim();
}
