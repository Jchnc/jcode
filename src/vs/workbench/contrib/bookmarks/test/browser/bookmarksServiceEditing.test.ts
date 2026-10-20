/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorAutoIndentStrategy } from '../../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { ILanguageConfigurationService } from '../../../../../editor/common/languages/languageConfigurationRegistry.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { MoveLinesCommand } from '../../../../../editor/contrib/linesOperations/browser/moveLinesCommand.js';
import { SortLinesCommand } from '../../../../../editor/contrib/linesOperations/browser/sortLinesCommand.js';
import { createCodeEditorServices, instantiateTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService, IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { CodeBookmarksService } from '../../browser/bookmarksService.js';

suite('CodeBookmarksService with editor edits', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/file.txt');
	const text = 'alpha\nbeta\ngamma\ndelta\nepsilon';

	function setup(initialText: string, bookmarkedLines: number[]) {
		const disposables = store.add(new DisposableStore());
		const instantiationService = createCodeEditorServices(disposables);
		const fileService = disposables.add(new FileService(new NullLogService()));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IStorageService, disposables.add(new InMemoryStorageService()));
		instantiationService.stub(IUriIdentityService, disposables.add(new UriIdentityService(fileService)));
		instantiationService.stub(IContextKeyService, new MockContextKeyService());

		const modelService = instantiationService.get(IModelService);
		const model = disposables.add(modelService.createModel(initialText, null, resource));
		const service = disposables.add(instantiationService.createInstance(CodeBookmarksService));
		const editor = disposables.add(instantiateTestCodeEditor(instantiationService, model));
		for (const lineNumber of bookmarkedLines) {
			service.toggle(resource, lineNumber);
		}

		const languageConfigurationService = instantiationService.get(ILanguageConfigurationService);
		return {
			model,
			moveLines: (selection: Selection, isMovingDown: boolean) => editor.executeCommand('test', new MoveLinesCommand(selection, isMovingDown, EditorAutoIndentStrategy.Advanced, languageConfigurationService)),
			sortLines: (selection: Selection) => editor.executeCommand('test', new SortLinesCommand(selection, false)),
			paste: (selection: Selection, pasted: string) => {
				editor.setSelection(selection);
				editor.getViewModel()?.paste(pasted, false);
			},
			replace: (range: Range, replacement: string) => model.applyEdits([{ range, text: replacement }]),
			/**
			 * Replaces the text the way reloading a file that changed on disk does: one edit across the changed lines.
			 */
			reload: (value: string) => modelService.updateModel(model, value),
			/**
			 * The bookmarks in the order they were created, next to the lines that carry a gutter icon.
			 */
			snapshot: () => {
				service.sync();
				return {
					bookmarks: service.bookmarks.map(({ lineNumber, lineText, stale }) => ({ lineNumber, lineText, stale })),
					gutterLines: model.getAllDecorations().filter(decoration => decoration.options.description === 'jcode-code-bookmark').map(decoration => decoration.range.startLineNumber).sort((left, right) => left - right)
				};
			}
		};
	}

	test('moving a line down takes its bookmark along and keeps the bookmark of the line it jumps over', () => {
		const { moveLines, snapshot } = setup(text, [2, 3]);

		moveLines(new Selection(2, 1, 2, 1), true);

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'beta', stale: false },
				{ lineNumber: 2, lineText: 'gamma', stale: false }
			],
			gutterLines: [2, 3]
		});
	});

	test('moving a line up takes its bookmark along and keeps the bookmark of the line it jumps over', () => {
		const { moveLines, snapshot } = setup(text, [2, 3]);

		moveLines(new Selection(3, 1, 3, 1), false);

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'beta', stale: false },
				{ lineNumber: 2, lineText: 'gamma', stale: false }
			],
			gutterLines: [2, 3]
		});
	});

	test('moving several lines moves their bookmarks and the bookmark of the line they jump over', () => {
		const { moveLines, snapshot } = setup(text, [2, 3, 4]);

		moveLines(new Selection(2, 1, 3, 3), true);

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'beta', stale: false },
				{ lineNumber: 4, lineText: 'gamma', stale: false },
				{ lineNumber: 2, lineText: 'delta', stale: false }
			],
			gutterLines: [2, 3, 4]
		});
	});

	test('moving an empty line past a bookmarked line keeps the bookmark with its text', () => {
		const { moveLines, snapshot } = setup('alpha\nbeta\n\ngamma', [2]);

		moveLines(new Selection(3, 1, 3, 1), false);

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [{ lineNumber: 3, lineText: 'beta', stale: false }],
			gutterLines: [3]
		});
	});

	test('moving an empty bookmarked line takes its bookmark along, also past a bookmarked line', () => {
		const { moveLines, snapshot } = setup('alpha\n\ngamma\ndelta', [2, 3]);

		moveLines(new Selection(2, 1, 2, 1), true);
		const movedDown = snapshot();
		moveLines(new Selection(3, 1, 3, 1), false);

		assert.deepStrictEqual({ movedDown, movedBackUp: snapshot() }, {
			movedDown: {
				bookmarks: [
					{ lineNumber: 3, lineText: '', stale: false },
					{ lineNumber: 2, lineText: 'gamma', stale: false }
				],
				gutterLines: [2, 3]
			},
			movedBackUp: {
				bookmarks: [
					{ lineNumber: 2, lineText: '', stale: false },
					{ lineNumber: 3, lineText: 'gamma', stale: false }
				],
				gutterLines: [2, 3]
			}
		});
	});

	test('undoing a move puts the bookmarks back on their lines', () => {
		const { moveLines, model, snapshot } = setup(text, [2, 3]);
		moveLines(new Selection(2, 1, 2, 1), true);
		snapshot();

		model.undo();

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 2, lineText: 'beta', stale: false },
				{ lineNumber: 3, lineText: 'gamma', stale: false }
			],
			gutterLines: [2, 3]
		});
	});

	test('sorting lines takes the bookmarks along with their text', () => {
		const { sortLines, snapshot } = setup('charlie\nalpha\nbravo', [1, 2]);

		sortLines(new Selection(1, 1, 3, 6));

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'charlie', stale: false },
				{ lineNumber: 1, lineText: 'alpha', stale: false }
			],
			gutterLines: [1, 3]
		});
	});

	test('pasting lines over whole lines keeps the bookmarks with their text', () => {
		const { paste, snapshot } = setup(text, [2, 3, 4]);

		paste(new Selection(2, 1, 4, 1), 'new\nbeta\ngamma\n');

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'beta', stale: false },
				{ lineNumber: 4, lineText: 'gamma', stale: false },
				{ lineNumber: 5, lineText: 'delta', stale: false }
			],
			gutterLines: [3, 4, 5]
		});
	});

	test('pasting the same lines in another order moves the bookmarks with them', () => {
		const { paste, snapshot } = setup(text, [2, 3, 4]);

		paste(new Selection(2, 1, 4, 1), 'gamma\nbeta\n');

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 3, lineText: 'beta', stale: false },
				{ lineNumber: 2, lineText: 'gamma', stale: false },
				{ lineNumber: 4, lineText: 'delta', stale: false }
			],
			gutterLines: [2, 3, 4]
		});
	});

	test('pasting different lines over bookmarked lines marks their bookmarks stale', () => {
		const { paste, snapshot } = setup(text, [2, 3, 4]);

		paste(new Selection(2, 1, 4, 1), 'x\ny\n');

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 2, lineText: 'beta', stale: true },
				{ lineNumber: 3, lineText: 'gamma', stale: true },
				{ lineNumber: 4, lineText: 'delta', stale: false }
			],
			gutterLines: [4]
		});
	});

	test('replacing text across line breaks keeps the bookmarks of the lines that survive', () => {
		const { replace, snapshot } = setup(text, [2, 3, 4]);

		replace(new Range(2, 3, 4, 3), 'X\nY\nZ');

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 2, lineText: 'beX', stale: false },
				{ lineNumber: 3, lineText: 'gamma', stale: true },
				{ lineNumber: 4, lineText: 'Zlta', stale: false }
			],
			gutterLines: [2, 4]
		});
	});

	test('reloading changed text from disk keeps the bookmarks with their text instead of collapsing them', () => {
		const { reload, snapshot } = setup('alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta', [2, 4, 6]);

		reload('alpha\nnew one\nnew two\nbeta\ngamma\ndelta\nepsilon\nzeta changed\neta');

		assert.deepStrictEqual(snapshot(), {
			bookmarks: [
				{ lineNumber: 4, lineText: 'beta', stale: false },
				{ lineNumber: 6, lineText: 'delta', stale: false },
				{ lineNumber: 6, lineText: 'zeta', stale: true }
			],
			gutterLines: [4, 6]
		});
	});
});
