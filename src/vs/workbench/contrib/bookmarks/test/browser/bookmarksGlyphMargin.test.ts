/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditor, IDiffEditor, IMouseTarget, IMouseTargetMargin, MouseTargetType } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ILineChange } from '../../../../../editor/common/diff/legacyLinesDiffComputer.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../../platform/files/common/files.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IAdapterManager, IDebugService } from '../../../debug/common/debug.js';
import { ALT_CLICK_TOGGLES_BOOKMARK_SETTING, BookmarkGlyphMarginContribution, getAltClickedBookmarkLine } from '../../browser/bookmarksGlyphMargin.js';
import { ICodeBookmarksService } from '../../common/bookmarks.js';

suite('Bookmark glyph margin', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const resource = URI.file('/workspace/file.ts');
	const gitRevision = URI.from({ scheme: 'git', path: '/workspace/file.ts', query: '{"ref":"HEAD"}' });

	function glyphMarginTarget(lineNumber: number, classNames: string[] = [], isAfterLines = false, type: IMouseTargetMargin['type'] = MouseTargetType.GUTTER_GLYPH_MARGIN): IMouseTargetMargin {
		const element = mainWindow.document.createElement('div');
		element.classList.add(...classNames);
		return {
			type,
			element,
			position: new Position(lineNumber, 1),
			range: new Range(lineNumber, 1, lineNumber, 1),
			mouseColumn: 1,
			detail: { isAfterLines, glyphMarginLeft: 0, glyphMarginWidth: 18, lineNumbersWidth: 0, offsetX: 0 }
		};
	}

	const altClick = { button: 0, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false };

	test('only Alt+clicks on the glyph margin of a line, or on its bookmark, toggle it', () => {
		assert.deepStrictEqual({
			emptyMargin: getAltClickedBookmarkLine(altClick, glyphMarginTarget(3)),
			bookmarkGlyph: getAltClickedBookmarkLine(altClick, glyphMarginTarget(4, ['codicon', 'codicon-bookmark', 'jcode-bookmark-glyph'])),
			breakpointHint: getAltClickedBookmarkLine(altClick, glyphMarginTarget(5, ['codicon', 'codicon-debug-hint'])),
			breakpoint: getAltClickedBookmarkLine(altClick, glyphMarginTarget(6, ['codicon', 'codicon-debug-breakpoint'])),
			otherGlyph: getAltClickedBookmarkLine(altClick, glyphMarginTarget(7, ['codicon', 'codicon-gutter-lightbulb'])),
			plainClick: getAltClickedBookmarkLine({ ...altClick, altKey: false }, glyphMarginTarget(3)),
			shiftAltClick: getAltClickedBookmarkLine({ ...altClick, shiftKey: true }, glyphMarginTarget(3)),
			rightClick: getAltClickedBookmarkLine({ ...altClick, button: 2 }, glyphMarginTarget(3)),
			lineNumbers: getAltClickedBookmarkLine(altClick, glyphMarginTarget(3, [], false, MouseTargetType.GUTTER_LINE_NUMBERS)),
			belowLastLine: getAltClickedBookmarkLine(altClick, glyphMarginTarget(9, [], true)),
			nothing: getAltClickedBookmarkLine(altClick, null)
		}, {
			emptyMargin: 3,
			bookmarkGlyph: 4,
			breakpointHint: 5,
			breakpoint: undefined,
			otherGlyph: undefined,
			plainClick: undefined,
			shiftAltClick: undefined,
			rightClick: undefined,
			lineNumbers: undefined,
			belowLastLine: undefined,
			nothing: undefined
		});
	});

	/**
	 * @param diff Makes the editor the original side of a diff, which shows a git revision of the modified file.
	 */
	function setup(enabled = true, debuggerState: { readonly hasEnabledDebuggers: boolean; readonly canSetBreakpoints: boolean } = { hasEnabledDebuggers: false, canSetBreakpoints: false }, diff?: { readonly changes: ILineChange[] }) {
		const container = mainWindow.document.createElement('div');
		const inner = container.appendChild(mainWindow.document.createElement('div'));
		const toggled: { lineNumber: number; column: number | undefined }[] = [];
		const toggledResources: string[] = [];
		const reachedEditor: string[] = [];
		inner.addEventListener('mousedown', () => reachedEditor.push('mousedown'));

		let target: IMouseTarget | null = glyphMarginTarget(3);
		const editorResource = diff ? gitRevision : resource;
		const editor = upcastPartial<ICodeEditor>({
			getContainerDomNode: () => container,
			getModel: () => upcastPartial<ITextModel>({ uri: editorResource }),
			getTargetAtClientPoint: () => target
		});
		const bookmarksService = upcastPartial<ICodeBookmarksService>({
			toggle: (toggledResource: URI, lineNumber: number, column?: number) => {
				toggled.push({ lineNumber, column });
				toggledResources.push(toggledResource.toString());
				return undefined;
			}
		});
		const diffEditors = diff ? [upcastPartial<IDiffEditor>({
			getOriginalEditor: () => editor,
			getModifiedEditor: () => upcastPartial<ICodeEditor>({ getModel: () => upcastPartial<ITextModel>({ uri: resource }) }),
			getLineChanges: () => diff.changes
		})] : [];
		const codeEditorService = upcastPartial<ICodeEditorService>({ listDiffEditors: () => diffEditors });
		const fileService = upcastPartial<IFileService>({
			hasProvider: () => true,
			hasCapability: (uri: URI, capability: FileSystemProviderCapabilities) => uri.scheme === 'git' && capability === FileSystemProviderCapabilities.Readonly
		});
		const uriIdentityService = upcastPartial<IUriIdentityService>({ extUri });
		const configurationService = new TestConfigurationService({ [ALT_CLICK_TOGGLES_BOOKMARK_SETTING]: enabled });
		const debugService = upcastPartial<IDebugService>({
			getAdapterManager: () => upcastPartial<IAdapterManager>({ hasEnabledDebuggers: () => debuggerState.hasEnabledDebuggers }),
			canSetBreakpointsIn: () => debuggerState.canSetBreakpoints
		});
		store.add(new BookmarkGlyphMarginContribution(editor, bookmarksService, configurationService, debugService, codeEditorService, fileService, uriIdentityService));

		const click = (init: MouseEventInit) => {
			const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
			inner.dispatchEvent(event);
			return event.defaultPrevented;
		};
		return { click, toggled, toggledResources, reachedEditor, setTarget: (next: IMouseTarget | null) => { target = next; } };
	}

	test('Alt+click toggles the bookmark of the line and keeps the click from the editor', () => {
		const { click, toggled, reachedEditor } = setup();

		const prevented = click({ altKey: true });

		assert.deepStrictEqual({ prevented, toggled, reachedEditor }, { prevented: true, toggled: [{ lineNumber: 3, column: 1 }], reachedEditor: [] });
	});

	test('plain clicks, which set breakpoints, and clicks on a breakpoint reach the editor untouched', () => {
		const { click, toggled, reachedEditor, setTarget } = setup();

		const plain = click({});
		setTarget(glyphMarginTarget(3, ['codicon', 'codicon-debug-breakpoint']));
		const onBreakpoint = click({ altKey: true });

		assert.deepStrictEqual({ plain, onBreakpoint, toggled, reachedEditor }, { plain: false, onBreakpoint: false, toggled: [], reachedEditor: ['mousedown', 'mousedown'] });
	});

	test('Alt+click is left to the debugger in files where it can set breakpoints', () => {
		const debuggable = setup(true, { hasEnabledDebuggers: true, canSetBreakpoints: true });
		const debuggableResult = { prevented: debuggable.click({ altKey: true }), toggled: debuggable.toggled, reachedEditor: debuggable.reachedEditor };

		const plainText = setup(true, { hasEnabledDebuggers: true, canSetBreakpoints: false });
		const plainTextResult = { prevented: plainText.click({ altKey: true }), toggled: plainText.toggled, reachedEditor: plainText.reachedEditor };

		const withoutDebugger = setup(true, { hasEnabledDebuggers: false, canSetBreakpoints: true });
		const withoutDebuggerResult = { prevented: withoutDebugger.click({ altKey: true }), toggled: withoutDebugger.toggled, reachedEditor: withoutDebugger.reachedEditor };

		assert.deepStrictEqual({ debuggableResult, plainTextResult, withoutDebuggerResult }, {
			debuggableResult: { prevented: false, toggled: [], reachedEditor: ['mousedown'] },
			plainTextResult: { prevented: true, toggled: [{ lineNumber: 3, column: 1 }], reachedEditor: [] },
			withoutDebuggerResult: { prevented: true, toggled: [{ lineNumber: 3, column: 1 }], reachedEditor: [] }
		});
	});

	test('on the original side of a diff, Alt+click bookmarks the matching line of the modified file, or nothing', () => {
		// A line was added above line 3, so it is line 4 in the modified file, unless the change includes it.
		const shifted = setup(true, undefined, { changes: [{ originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 2, charChanges: undefined }] });
		const changed = setup(true, undefined, { changes: [{ originalStartLineNumber: 3, originalEndLineNumber: 3, modifiedStartLineNumber: 3, modifiedEndLineNumber: 3, charChanges: undefined }] });

		const result = {
			shifted: { prevented: shifted.click({ altKey: true }), toggled: shifted.toggled, toggledResources: shifted.toggledResources },
			changed: { prevented: changed.click({ altKey: true }), toggled: changed.toggled, toggledResources: changed.toggledResources }
		};

		assert.deepStrictEqual(result, {
			shifted: { prevented: true, toggled: [{ lineNumber: 4, column: 1 }], toggledResources: [resource.toString()] },
			changed: { prevented: true, toggled: [], toggledResources: [] }
		});
	});

	test('does nothing when the setting is turned off', () => {
		const { click, toggled, reachedEditor } = setup(false);

		click({ altKey: true });

		assert.deepStrictEqual({ toggled, reachedEditor }, { toggled: [], reachedEditor: ['mousedown'] });
	});
});
