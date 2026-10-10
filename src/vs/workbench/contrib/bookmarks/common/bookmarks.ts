/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const CONTEXT_CODE_BOOKMARKS_PRESENT = new RawContextKey<boolean>('jcode.bookmarks.hasBookmarks', false, true);

export interface ICodeBookmarkAnchor {
	readonly lineText: string;
	readonly beforeText: string;
	readonly afterText: string;
}

export interface ICodeBookmark extends ICodeBookmarkAnchor {
	readonly id: string;
	readonly resource: URI;
	readonly lineNumber: number;
	readonly column: number;
	readonly note?: string;
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
	find(resource: URI, lineNumber: number): ICodeBookmark | undefined;
}

export const ICodeBookmarksService = createDecorator<ICodeBookmarksService>('codeBookmarksService');

export function findBookmarkLine(lines: readonly string[], preferredLineNumber: number, anchor: ICodeBookmarkAnchor): number | undefined {
	if (lines.length === 0) {
		return undefined;
	}

	const preferredIndex = Math.max(0, Math.min(lines.length - 1, preferredLineNumber - 1));
	const lineText = normalizeLine(anchor.lineText);
	if (normalizeLine(lines[preferredIndex]) === lineText) {
		return preferredIndex + 1;
	}

	let best: { lineNumber: number; score: number } | undefined;
	for (let index = 0; index < lines.length; index++) {
		if (normalizeLine(lines[index]) !== lineText) {
			continue;
		}

		let score = -Math.abs(index - preferredIndex);
		if (index > 0 && normalizeLine(lines[index - 1]) === normalizeLine(anchor.beforeText)) {
			score += 1000;
		}
		if (index + 1 < lines.length && normalizeLine(lines[index + 1]) === normalizeLine(anchor.afterText)) {
			score += 1000;
		}
		if (!best || score > best.score) {
			best = { lineNumber: index + 1, score };
		}
	}

	return best?.lineNumber;
}

export function captureBookmarkAnchor(lines: readonly string[], lineNumber: number): ICodeBookmarkAnchor {
	const index = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
	return {
		lineText: lines[index] ?? '',
		beforeText: index > 0 ? lines[index - 1] : '',
		afterText: index + 1 < lines.length ? lines[index + 1] : ''
	};
}

function normalizeLine(value: string): string {
	return value.trim();
}
