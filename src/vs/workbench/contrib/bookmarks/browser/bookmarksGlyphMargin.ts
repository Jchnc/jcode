/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IMouseTarget, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICodeBookmarksService } from '../common/bookmarks.js';

export const ALT_CLICK_TOGGLES_BOOKMARK_SETTING = 'jcode.bookmarks.toggleOnAltClick';

/**
 * Finds the line whose bookmark an Alt+click on the glyph margin toggles, if the click is one.
 *
 * The click is left alone when it lands on a glyph that belongs to something else, such as a
 * breakpoint, which uses Alt+click to open itself for editing, or a code action.
 */
export function getAltClickedBookmarkLine(event: Pick<MouseEvent, 'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, target: IMouseTarget | null): number | undefined {
	if (event.button !== 0 || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return undefined;
	}
	if (target?.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || target.detail.isAfterLines) {
		return undefined;
	}

	const glyph = target.element?.classList;
	const isForeignGlyph = !!glyph?.contains('codicon') && !glyph.contains('jcode-bookmark-glyph') && !glyph.contains('codicon-debug-hint');
	return isForeignGlyph ? undefined : target.position.lineNumber;
}

/**
 * Toggles the bookmark of a line when its glyph margin is clicked with Alt held.
 *
 * The click is taken before the editor sees it. The debugger would otherwise react to the same
 * Alt+click on an empty glyph margin by opening a conditional breakpoint, so a single click would
 * both bookmark the line and open a breakpoint editor.
 */
export class BookmarkGlyphMarginContribution extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.jcodeBookmarkGlyphMargin';

	constructor(
		private readonly editor: ICodeEditor,
		@ICodeBookmarksService private readonly bookmarksService: ICodeBookmarksService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(DOM.addDisposableListener(editor.getContainerDomNode(), DOM.EventType.MOUSE_DOWN, event => this.onMouseDown(event), true));
	}

	private onMouseDown(event: MouseEvent): void {
		const model = this.editor.getModel();
		if (!model || !event.altKey || !this.configurationService.getValue<boolean>(ALT_CLICK_TOGGLES_BOOKMARK_SETTING)) {
			return;
		}

		const lineNumber = getAltClickedBookmarkLine(event, this.editor.getTargetAtClientPoint(event.clientX, event.clientY));
		if (lineNumber !== undefined) {
			DOM.EventHelper.stop(event, true);
			this.bookmarksService.toggle(model.uri, lineNumber, 1);
		}
	}
}
