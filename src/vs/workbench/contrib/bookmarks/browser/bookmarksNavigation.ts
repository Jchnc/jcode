/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { findAdjacentBookmark, IBookmarkFileOrder, ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';

/**
 * The order in which the Bookmarks view lists files: by the path shown for the file.
 * Everything that walks through bookmarks uses it, so that all of them agree.
 */
export function getBookmarkFileOrder(uriIdentityService: IUriIdentityService, labelService: ILabelService): IBookmarkFileOrder {
	return {
		getResourceKey: resource => uriIdentityService.extUri.getComparisonKey(resource),
		getResourceLabel: resource => labelService.getUriLabel(resource, { relative: true })
	};
}

/**
 * Finds the bookmark that Go to Next or Previous Bookmark goes to. Edits that were just made are
 * applied first, so that the line numbers are exact even right after typing.
 */
export function findBookmarkToNavigateTo(bookmarksService: ICodeBookmarksService, cursor: { readonly resource: URI; readonly lineNumber: number } | undefined, direction: 1 | -1, fileOrder: IBookmarkFileOrder): ICodeBookmark | undefined {
	bookmarksService.sync();
	return findAdjacentBookmark(bookmarksService.bookmarks, cursor, direction, fileOrder);
}

/**
 * Looks up a bookmark again, with its line as it is right now, for something that was listed a moment ago.
 */
export function getCurrentBookmark(bookmarksService: ICodeBookmarksService, bookmark: ICodeBookmark): ICodeBookmark {
	bookmarksService.sync();
	return bookmarksService.bookmarks.find(candidate => candidate.id === bookmark.id) ?? bookmark;
}

export async function openBookmark(editorService: IEditorService, bookmark: ICodeBookmark): Promise<void> {
	await editorService.openEditor({
		resource: bookmark.resource,
		options: { pinned: true, selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column) }
	});
}
