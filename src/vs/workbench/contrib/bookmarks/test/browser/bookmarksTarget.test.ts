/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditor, IDiffEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ILineChange } from '../../../../../editor/common/diff/legacyLinesDiffComputer.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../../platform/files/common/files.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { getBookmarkTarget } from '../../browser/bookmarksTarget.js';

suite('Bookmark target', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const file = URI.file('/workspace/file.ts');
	const gitRevision = URI.from({ scheme: 'git', path: '/workspace/file.ts', query: '{"ref":"HEAD"}' });
	const otherGitRevision = URI.from({ scheme: 'git', path: '/workspace/other.ts', query: '{"ref":"HEAD"}' });

	function lineChange(originalStartLineNumber: number, originalEndLineNumber: number, modifiedStartLineNumber: number, modifiedEndLineNumber: number): ILineChange {
		return { originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber, charChanges: undefined };
	}

	function createEditor(resource: URI): ICodeEditor {
		return upcastPartial<ICodeEditor>({ getModel: () => upcastPartial<ITextModel>({ uri: resource }) });
	}

	function setup(original: URI, modified: URI, changes: ILineChange[] | null) {
		const originalEditor = createEditor(original);
		const modifiedEditor = createEditor(modified);
		const diffEditor = upcastPartial<IDiffEditor>({ getOriginalEditor: () => originalEditor, getModifiedEditor: () => modifiedEditor, getLineChanges: () => changes });
		const services = {
			codeEditorService: upcastPartial<ICodeEditorService>({ listDiffEditors: () => [diffEditor] }),
			fileService: upcastPartial<IFileService>({
				// Files are writable, and git revisions can be read but not written.
				hasProvider: (resource: URI) => resource.scheme === 'file' || resource.scheme === 'git',
				hasCapability: (resource: URI, capability: FileSystemProviderCapabilities) => resource.scheme === 'git' && capability === FileSystemProviderCapabilities.Readonly
			}),
			uriIdentityService: upcastPartial<IUriIdentityService>({ extUri })
		};
		return { services, originalEditor, modifiedEditor };
	}

	test('maps a line of a git revision to the file it is a copy of, and leaves lines that changed alone', () => {
		// Original lines 3 to 4 became modified lines 3 to 5, and one line was added after original line 7.
		const { services, originalEditor } = setup(gitRevision, file, [lineChange(3, 4, 3, 5), lineChange(7, 0, 9, 9)]);
		const target = (lineNumber: number) => getBookmarkTarget(services, gitRevision, lineNumber, originalEditor);

		assert.deepStrictEqual({
			beforeChange: target(2),
			inChange: target(4),
			afterChange: target(5),
			beforeInsertion: target(7),
			afterInsertion: target(8)
		}, {
			beforeChange: { resource: file, lineNumber: 2 },
			inChange: undefined,
			afterChange: { resource: file, lineNumber: 6 },
			beforeInsertion: { resource: file, lineNumber: 8 },
			afterInsertion: { resource: file, lineNumber: 10 }
		});
	});

	test('finds the diff editor from the resource when the clicked editor is not known', () => {
		const { services } = setup(gitRevision, file, []);

		assert.deepStrictEqual(getBookmarkTarget(services, gitRevision, 3), { resource: file, lineNumber: 3 });
	});

	test('bookmarks nothing on the original side when it is a copy of another file or the diff is not ready', () => {
		const anotherFile = setup(otherGitRevision, file, []);
		const notReady = setup(gitRevision, file, null);

		assert.deepStrictEqual({
			anotherFile: getBookmarkTarget(anotherFile.services, otherGitRevision, 3, anotherFile.originalEditor),
			notReady: getBookmarkTarget(notReady.services, gitRevision, 3, notReady.originalEditor)
		}, { anotherFile: undefined, notReady: undefined });
	});

	test('bookmarks lines as they are on the modified side, in plain editors, and in an ordinary file on the left', () => {
		const revision = setup(gitRevision, file, [lineChange(3, 4, 3, 5)]);
		const otherFile = URI.file('/workspace/other.ts');
		const comparedFiles = setup(otherFile, file, [lineChange(3, 4, 3, 5)]);
		const unrelated = URI.file('/workspace/unrelated.ts');

		assert.deepStrictEqual({
			modifiedSide: getBookmarkTarget(revision.services, file, 4, revision.modifiedEditor),
			plainEditor: getBookmarkTarget(revision.services, unrelated, 4, createEditor(unrelated)),
			fileOnTheLeft: getBookmarkTarget(comparedFiles.services, otherFile, 4, comparedFiles.originalEditor)
		}, {
			modifiedSide: { resource: file, lineNumber: 4 },
			plainEditor: { resource: unrelated, lineNumber: 4 },
			fileOnTheLeft: { resource: otherFile, lineNumber: 4 }
		});
	});
});
