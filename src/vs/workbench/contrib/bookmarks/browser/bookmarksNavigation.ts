/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../../../../editor/common/core/range.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IBookmarkFileOrder, ICodeBookmark } from '../common/bookmarks.js';

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

export async function openBookmark(editorService: IEditorService, bookmark: ICodeBookmark): Promise<void> {
	await editorService.openEditor({
		resource: bookmark.resource,
		options: { pinned: true, selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column) }
	});
}
