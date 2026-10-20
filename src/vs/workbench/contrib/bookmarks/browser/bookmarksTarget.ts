/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { mapOriginalLineToModified } from '../common/bookmarks.js';

/**
 * A line of a file that can be bookmarked.
 */
export interface IBookmarkTarget {
	readonly resource: URI;
	readonly lineNumber: number;
}

export interface IBookmarkTargetServices {
	readonly codeEditorService: ICodeEditorService;
	readonly fileService: IFileService;
	readonly uriIdentityService: IUriIdentityService;
}

/**
 * Finds the line to bookmark when a line of an editor is clicked.
 *
 * The original (left) side of a diff editor usually shows a read-only copy of a file, such as the
 * version in git, and its lines are not the lines of the file. So the click is turned into the line of
 * the file on the modified side that has the same text, and nothing is bookmarked when there is no such
 * line, or when the copy belongs to another file. A bookmark of such a copy could not be opened again
 * once the diff is closed.
 *
 * @param editor The editor that was clicked, when that is known. Otherwise the diff editor is found from the resource.
 * @returns The line to bookmark, or `undefined` when nothing should be bookmarked.
 */
export function getBookmarkTarget({ codeEditorService, fileService, uriIdentityService }: IBookmarkTargetServices, resource: URI, lineNumber: number, editor?: ICodeEditor): IBookmarkTarget | undefined {
	const { extUri } = uriIdentityService;
	const diffEditor = codeEditorService.listDiffEditors().find(candidate => {
		const originalEditor = candidate.getOriginalEditor();
		const originalResource = originalEditor.getModel()?.uri;
		return (!editor || originalEditor === editor) && originalResource && extUri.isEqual(originalResource, resource);
	});
	const modifiedResource = diffEditor?.getModifiedEditor().getModel()?.uri;
	if (!diffEditor || !modifiedResource || extUri.isEqual(modifiedResource, resource)) {
		return { resource, lineNumber };
	}

	// An ordinary file on the left, such as when two files are compared, can be bookmarked as it is.
	if (fileService.hasProvider(resource) && !fileService.hasCapability(resource, FileSystemProviderCapabilities.Readonly)) {
		return { resource, lineNumber };
	}

	const isCopyOfModified = extUri.isEqual(resource.with({ scheme: modifiedResource.scheme, authority: modifiedResource.authority, query: modifiedResource.query, fragment: modifiedResource.fragment }), modifiedResource);
	const lineChanges = diffEditor.getLineChanges();
	const modifiedLineNumber = isCopyOfModified && lineChanges ? mapOriginalLineToModified(lineNumber, lineChanges) : undefined;
	return modifiedLineNumber === undefined ? undefined : { resource: modifiedResource, lineNumber: modifiedLineNumber };
}
