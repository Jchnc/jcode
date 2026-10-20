/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const CONTEXT_CODE_BOOKMARKS_PRESENT = new RawContextKey<boolean>('jcode.bookmarks.hasBookmarks', false, true);
export const CONTEXT_CODE_BOOKMARKS_STALE_PRESENT = new RawContextKey<boolean>('jcode.bookmarks.hasStaleBookmarks', false, true);

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
 * Whether an edit deleted a whole line, content and line break, rather than merely changing its text.
 *
 * @param lineNumber The line number before the edit.
 * @param lineMaxColumn The max column of that line before the edit.
 */
export function isBookmarkLineRemoved(edit: IBookmarkTextEdit, lineNumber: number, lineMaxColumn: number): boolean {
	const { range, text } = edit;
	if (/[\r\n]/.test(text) || range.startLineNumber === range.endLineNumber || lineNumber < range.startLineNumber || lineNumber > range.endLineNumber) {
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

function normalizeLine(value: string): string {
	return value.trim();
}
