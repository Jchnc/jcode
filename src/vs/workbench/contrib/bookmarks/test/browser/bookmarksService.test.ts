/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { createModelServices } from '../../../../../editor/test/common/testTextModel.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { CodeBookmarksService } from '../../browser/bookmarksService.js';

suite('CodeBookmarksService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/file.txt');

	function setup(text = 'alpha\nbeta\ngamma\ndelta\nepsilon', stored?: object[]) {
		const disposables = store.add(new DisposableStore());
		const instantiationService = createModelServices(disposables);
		const fileService = disposables.add(new FileService(new NullLogService()));
		const storageService = disposables.add(new InMemoryStorageService());
		if (stored) {
			storageService.store('jcode.codeBookmarks', JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(IUriIdentityService, disposables.add(new UriIdentityService(fileService)));
		instantiationService.stub(IContextKeyService, new MockContextKeyService());

		const model = disposables.add(instantiationService.get(IModelService).createModel(text, null, resource));
		const service = disposables.add(instantiationService.createInstance(CodeBookmarksService));
		return { model, service };
	}

	function snapshot(service: CodeBookmarksService) {
		// Looking up a bookmark applies the edits that are otherwise picked up after a short delay.
		service.find(resource, 1);
		return service.bookmarks.map(({ lineNumber, lineText, stale, note }) => ({ lineNumber, lineText, stale, note }));
	}

	function countGutterDecorations(model: ITextModel): number {
		return model.getAllDecorations().filter(decoration => decoration.options.description === 'jcode-code-bookmark').length;
	}

	function deleteLine(model: ITextModel, lineNumber: number): void {
		model.applyEdits([{ range: lineNumber < model.getLineCount() ? new Range(lineNumber, 1, lineNumber + 1, 1) : new Range(lineNumber - 1, model.getLineMaxColumn(lineNumber - 1), lineNumber, model.getLineMaxColumn(lineNumber)), text: '' }]);
	}

	test('marks a bookmark stale instead of moving it to the next line when its line is deleted', () => {
		const { model, service } = setup();
		service.toggle(resource, 3);
		service.toggle(resource, 5);

		deleteLine(model, 3);

		assert.deepStrictEqual({
			bookmarks: snapshot(service),
			gutterDecorations: countGutterDecorations(model),
			occupant: service.find(resource, 3)
		}, {
			bookmarks: [
				{ lineNumber: 3, lineText: 'gamma', stale: true, note: undefined },
				{ lineNumber: 4, lineText: 'epsilon', stale: false, note: undefined }
			],
			gutterDecorations: 1,
			occupant: undefined
		});
	});

	test('marks a bookmark stale when the last line of the file is deleted', () => {
		const { model, service } = setup();
		service.toggle(resource, 5);

		deleteLine(model, 5);

		assert.deepStrictEqual(snapshot(service), [{ lineNumber: 5, lineText: 'epsilon', stale: true, note: undefined }]);
	});

	test('reports a deleted line to listeners without waiting for edits to settle', () => {
		const { model, service } = setup();
		service.toggle(resource, 3);
		let changes = 0;
		store.add(service.onDidChangeBookmarks(() => changes++));

		deleteLine(model, 3);

		assert.strictEqual(changes, 1);
	});

	test('follows edits once they settle', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { model, service } = setup();
		service.toggle(resource, 3);

		model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'inserted\n' }]);
		await timeout(250);

		assert.deepStrictEqual(service.bookmarks.map(bookmark => bookmark.lineNumber), [4]);
	}));

	test('keeps a bookmark on its line when only the text of the line changes', () => {
		const { model, service } = setup();
		service.toggle(resource, 2);

		model.applyEdits([{ range: new Range(2, 1, 2, 5), text: 'changed' }]);
		model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'inserted\n' }]);

		assert.deepStrictEqual(snapshot(service), [{ lineNumber: 3, lineText: 'changed', stale: false, note: undefined }]);
	});

	test('keeps a bookmark on an empty line when the line before it is deleted', () => {
		const { model, service } = setup('alpha\nbeta\n\ndelta');
		service.toggle(resource, 3);

		deleteLine(model, 2);

		assert.deepStrictEqual({ bookmarks: snapshot(service), gutterDecorations: countGutterDecorations(model) }, {
			bookmarks: [{ lineNumber: 2, lineText: '', stale: false, note: undefined }],
			gutterDecorations: 1
		});
	});

	test('restores a stale bookmark when the deletion is undone', () => {
		const { model, service } = setup();
		service.toggle(resource, 3);
		model.pushEditOperations([], [{ range: new Range(3, 1, 4, 1), text: '' }], () => null);
		const afterDelete = snapshot(service);

		model.undo();

		assert.deepStrictEqual({ afterDelete, afterUndo: snapshot(service), gutterDecorations: countGutterDecorations(model) }, {
			afterDelete: [{ lineNumber: 3, lineText: 'gamma', stale: true, note: undefined }],
			afterUndo: [{ lineNumber: 3, lineText: 'gamma', stale: false, note: undefined }],
			gutterDecorations: 1
		});
	});

	test('does not let a similar line adopt a stale bookmark when the file is refreshed later', () => {
		const { model, service } = setup('}\nbeta\n}\ndelta');
		service.toggle(resource, 3);
		deleteLine(model, 3);

		service.toggle(resource, 1);

		assert.deepStrictEqual(snapshot(service), [
			{ lineNumber: 3, lineText: '}', stale: true, note: undefined },
			{ lineNumber: 1, lineText: '}', stale: false, note: undefined }
		]);
	});

	test('bookmarks a new line even when a stale bookmark was last known on it', () => {
		const { model, service } = setup();
		service.toggle(resource, 3);
		deleteLine(model, 3);

		service.toggle(resource, 3);

		assert.deepStrictEqual(snapshot(service), [
			{ lineNumber: 3, lineText: 'gamma', stale: true, note: undefined },
			{ lineNumber: 3, lineText: 'delta', stale: false, note: undefined }
		]);
	});

	test('relocates a stale bookmark to another line and clears its stale state', () => {
		const { model, service } = setup();
		const bookmark = service.toggle(resource, 3)!;
		service.updateNote(bookmark.id, 'remember this');
		deleteLine(model, 3);

		service.relocate(bookmark.id, resource, 1);

		assert.deepStrictEqual({ bookmarks: snapshot(service), gutterDecorations: countGutterDecorations(model) }, {
			bookmarks: [{ lineNumber: 1, lineText: 'alpha', stale: false, note: 'remember this' }],
			gutterDecorations: 1
		});
	});

	test('merges a stale bookmark into the bookmark already on the line it is relocated to', () => {
		const { model, service } = setup();
		const stale = service.toggle(resource, 3)!;
		service.updateNote(stale.id, 'remember this');
		service.toggle(resource, 1);
		deleteLine(model, 3);

		service.relocate(stale.id, resource, 1);

		assert.deepStrictEqual(snapshot(service), [{ lineNumber: 1, lineText: 'alpha', stale: false, note: 'remember this' }]);
	});

	test('toggling removes the bookmark and its gutter icon', () => {
		const { model, service } = setup();

		service.toggle(resource, 2);
		const added = { bookmarks: snapshot(service).length, gutterDecorations: countGutterDecorations(model) };
		service.toggle(resource, 2);

		assert.deepStrictEqual({ added, bookmarks: snapshot(service), gutterDecorations: countGutterDecorations(model) }, {
			added: { bookmarks: 1, gutterDecorations: 1 },
			bookmarks: [],
			gutterDecorations: 0
		});
	});

	test('merges bookmarks when an edit moves one onto the line of another and keeps the note', () => {
		const { model, service } = setup();
		service.toggle(resource, 2);
		const second = service.toggle(resource, 3)!;
		service.updateNote(second.id, 'keep me');

		// Joining the lines moves both bookmarks onto line 2.
		model.applyEdits([{ range: new Range(2, 5, 3, 1), text: '' }]);

		assert.deepStrictEqual({ bookmarks: snapshot(service), gutterDecorations: countGutterDecorations(model) }, {
			bookmarks: [{ lineNumber: 2, lineText: 'betagamma', stale: false, note: 'keep me' }],
			gutterDecorations: 1
		});

		service.toggle(resource, 2);

		assert.deepStrictEqual({ bookmarks: snapshot(service), gutterDecorations: countGutterDecorations(model) }, { bookmarks: [], gutterDecorations: 0 });
	});

	test('merges duplicates found in stored data', () => {
		const stored = (id: string, lineNumber: number, extra: object = {}) => ({ id, resource: resource.toString(), lineNumber, column: 1, lineText: 'beta', beforeText: 'alpha', afterText: 'gamma', stale: false, createdAt: 1, ...extra });
		const { service } = setup('alpha\nbeta\ngamma', [
			stored('a', 2),
			stored('b', 2, { note: 'second' }),
			stored('c', 1, { lineText: 'alpha' }),
			stored('d', 9, { stale: true, lineText: 'gone' }),
			stored('e', 9, { stale: true, lineText: 'gone' }),
			stored('f', 9, { stale: true, lineText: 'other' })
		]);

		assert.deepStrictEqual(service.bookmarks.map(({ id, lineNumber, stale, note }) => ({ id, lineNumber, stale, note })), [
			{ id: 'b', lineNumber: 2, stale: false, note: 'second' },
			{ id: 'c', lineNumber: 1, stale: false, note: undefined },
			{ id: 'd', lineNumber: 9, stale: true, note: undefined },
			{ id: 'f', lineNumber: 9, stale: true, note: undefined }
		]);
	});

	test('only follows a model while it has bookmarks', () => {
		const { model, service } = setup();
		const withoutBookmarks = service.trackedModelCount;

		service.toggle(resource, 2);
		const withBookmark = { tracked: service.trackedModelCount, gutterDecorations: countGutterDecorations(model) };
		service.toggle(resource, 2);

		assert.deepStrictEqual({ withoutBookmarks, withBookmark, afterRemoval: service.trackedModelCount }, {
			withoutBookmarks: 0,
			withBookmark: { tracked: 1, gutterDecorations: 1 },
			afterRemoval: 0
		});
	});

	test('follows a model that already has stored bookmarks and stops when the service is disposed', () => {
		const { model, service } = setup('alpha\nbeta', [{ id: 'a', resource: resource.toString(), lineNumber: 2, column: 1, lineText: 'beta', beforeText: 'alpha', afterText: '', stale: false, createdAt: 1 }]);
		const tracked = { count: service.trackedModelCount, gutterDecorations: countGutterDecorations(model) };

		service.dispose();

		assert.deepStrictEqual({ tracked, afterDispose: { count: service.trackedModelCount, gutterDecorations: countGutterDecorations(model) } }, {
			tracked: { count: 1, gutterDecorations: 1 },
			afterDispose: { count: 0, gutterDecorations: 0 }
		});
	});

	test('keeps the line number in the hover of a bookmark up to date', () => {
		const { model, service } = setup();
		const hover = () => model.getAllDecorations().map(decoration => (decoration.options.hoverMessage as IMarkdownString | null)?.value);
		service.toggle(resource, 3);
		const before = hover();

		model.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'inserted\n' }]);
		service.find(resource, 4);

		assert.deepStrictEqual({ before, after: hover() }, { before: ['Bookmark at line 3'], after: ['Bookmark at line 4'] });
	});

	test('removes only stale bookmarks', () => {
		const { model, service } = setup();
		service.toggle(resource, 2);
		service.toggle(resource, 4);
		deleteLine(model, 2);

		service.removeStale();

		assert.deepStrictEqual(snapshot(service), [{ lineNumber: 3, lineText: 'delta', stale: false, note: undefined }]);
	});
});
