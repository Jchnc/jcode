/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/bookmarks.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor, isCodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../editor/common/core/range.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ILocalizedString, localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Extensions as ViewExtensions, IViewsRegistry } from '../../../common/views.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { CONTEXT_CODE_BOOKMARKS_PRESENT, ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';
import { CodeBookmarksService } from './bookmarksService.js';
import { BookmarksView } from './bookmarksView.js';

const TOGGLE_BOOKMARK_ID = 'jcode.bookmarks.toggle';
const TOGGLE_BOOKMARK_WITH_NOTE_ID = 'jcode.bookmarks.toggleWithNote';
const NEXT_BOOKMARK_ID = 'jcode.bookmarks.next';
const PREVIOUS_BOOKMARK_ID = 'jcode.bookmarks.previous';
const SHOW_BOOKMARKS_ID = 'jcode.bookmarks.show';
const REMOVE_ALL_BOOKMARKS_ID = 'jcode.bookmarks.removeAll';

const bookmarksViewIcon = registerIcon('jcode-bookmarks-view-icon', Codicon.bookmark, localize('bookmarksViewIcon', "View icon of the Bookmarks view."));

registerSingleton(ICodeBookmarksService, CodeBookmarksService, InstantiationType.Delayed);

class CodeBookmarksContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.jcodeCodeBookmarks';
	constructor(@ICodeBookmarksService _bookmarksService: ICodeBookmarksService) { }
}

registerWorkbenchContribution2(CodeBookmarksContribution.ID, CodeBookmarksContribution, WorkbenchPhase.AfterRestored);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: BookmarksView.ID,
	name: BookmarksView.NAME,
	containerIcon: bookmarksViewIcon,
	ctorDescriptor: new SyncDescriptor(BookmarksView),
	order: 3,
	weight: 20,
	canToggleVisibility: true,
	canMoveView: true,
	collapsed: true,
	hideByDefault: false,
	focusCommand: { id: 'jcode.bookmarks.focus' }
}], VIEW_CONTAINER);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: TOGGLE_BOOKMARK_ID,
			title: localize2('toggleBookmark', "Toggle Bookmark"),
			icon: Codicon.bookmark,
			f1: true,
			keybinding: {
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyB),
				weight: KeybindingWeight.WorkbenchContrib,
				when: EditorContextKeys.editorTextFocus
			},
			menu: [
				{ id: MenuId.EditorContext, group: '1_modification', order: 25 },
				{ id: MenuId.EditorLineNumberContext, group: '3_bookmarks', order: 1 },
				{ id: MenuId.ViewTitle, group: 'navigation', order: 1, when: ContextKeyExpr.equals('view', BookmarksView.ID) }
			]
		});
	}

	run(accessor: ServicesAccessor, context?: unknown): void {
		if (isEditorLineNumberContext(context)) {
			accessor.get(ICodeBookmarksService).toggle(context.uri, context.lineNumber, 1);
			return;
		}

		const editor = getActiveCodeEditor(accessor.get(IEditorService));
		const model = editor?.getModel();
		const position = editor?.getPosition();
		if (model && position) {
			accessor.get(ICodeBookmarksService).toggle(model.uri, position.lineNumber, position.column);
		}
	}
});

interface IEditorLineNumberContext {
	readonly lineNumber: number;
	readonly uri: URI;
}

function isEditorLineNumberContext(context: unknown): context is IEditorLineNumberContext {
	if (typeof context !== 'object' || context === null) {
		return false;
	}

	const candidate = context as Partial<IEditorLineNumberContext>;
	return typeof candidate.lineNumber === 'number' && URI.isUri(candidate.uri);
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: TOGGLE_BOOKMARK_WITH_NOTE_ID,
			title: localize2('bookmarkWithNote', "Bookmark with Note..."),
			f1: true,
			menu: { id: MenuId.EditorContext, group: '1_modification', order: 26 }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editor = getActiveCodeEditor(accessor.get(IEditorService));
		const model = editor?.getModel();
		const position = editor?.getPosition();
		if (!model || !position) {
			return;
		}
		const service = accessor.get(ICodeBookmarksService);
		const bookmark = service.find(model.uri, position.lineNumber) ?? service.toggle(model.uri, position.lineNumber, position.column);
		if (!bookmark) {
			return;
		}
		const note = await accessor.get(IQuickInputService).input({
			title: localize('bookmarkNoteTitle', "Bookmark Note"),
			prompt: localize('bookmarkNotePrompt', "Add context that will help you recognize this location later."),
			placeHolder: localize('bookmarkNotePlaceholder', "What is important here?"),
			value: bookmark.note ?? ''
		});
		if (note !== undefined) {
			service.updateNote(bookmark.id, note);
		}
	}
});

registerNavigationAction(NEXT_BOOKMARK_ID, localize2('nextBookmark', "Go to Next Bookmark"), 1);
registerNavigationAction(PREVIOUS_BOOKMARK_ID, localize2('previousBookmark', "Go to Previous Bookmark"), -1);

registerAction2(class extends Action2 {
	constructor() {
		super({ id: SHOW_BOOKMARKS_ID, title: localize2('showBookmarks', "Show Bookmarks"), icon: Codicon.bookmark, f1: true });
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IViewsService).openView(BookmarksView.ID, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: REMOVE_ALL_BOOKMARKS_ID,
			title: localize2('removeAllBookmarks', "Remove All Bookmarks"),
			icon: Codicon.clearAll,
			f1: true,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 2,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', BookmarksView.ID), CONTEXT_CODE_BOOKMARKS_PRESENT)
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const service = accessor.get(ICodeBookmarksService);
		if (service.bookmarks.length === 0) {
			return;
		}
		const confirmation = await accessor.get(IDialogService).confirm({
			type: 'warning',
			message: localize('removeAllBookmarksConfirm', "Remove all code bookmarks from this workspace?"),
			primaryButton: localize('removeAllBookmarksButton', "Remove All")
		});
		if (confirmation.confirmed) {
			service.removeAll();
		}
	}
});

CommandsRegistry.registerCommandAlias('bookmarks.toggle', TOGGLE_BOOKMARK_ID);

function registerNavigationAction(id: string, title: ILocalizedString, direction: 1 | -1): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, f1: true });
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const service = accessor.get(ICodeBookmarksService);
			const bookmarks = service.bookmarks.filter(bookmark => !bookmark.stale).sort(compareBookmarks);
			if (bookmarks.length === 0) {
				accessor.get(INotificationService).info(localize('noBookmarks', "There are no active bookmarks in this workspace."));
				return;
			}

			const editor = getActiveCodeEditor(accessor.get(IEditorService));
			const model = editor?.getModel();
			const position = editor?.getPosition();
			let index = direction > 0 ? 0 : bookmarks.length - 1;
			if (model && position) {
				const current: ICodeBookmark = { ...bookmarks[0], resource: model.uri, lineNumber: position.lineNumber, column: position.column };
				if (direction > 0) {
					const next = bookmarks.findIndex(bookmark => compareBookmarks(bookmark, current) > 0);
					index = next >= 0 ? next : 0;
				} else {
					const previous = bookmarks.findLastIndex(bookmark => compareBookmarks(bookmark, current) < 0);
					index = previous >= 0 ? previous : bookmarks.length - 1;
				}
			}
			await openBookmark(accessor.get(IEditorService), bookmarks[index]);
		}
	});
}

function getActiveCodeEditor(editorService: IEditorService): ICodeEditor | undefined {
	const control = editorService.activeTextEditorControl;
	if (isDiffEditor(control)) {
		return control.getModifiedEditor();
	}
	return isCodeEditor(control) ? control : undefined;
}

function compareBookmarks(left: ICodeBookmark, right: ICodeBookmark): number {
	const resourceComparison = left.resource.toString().localeCompare(right.resource.toString());
	return resourceComparison || left.lineNumber - right.lineNumber || left.column - right.column;
}

async function openBookmark(editorService: IEditorService, bookmark: ICodeBookmark): Promise<void> {
	await editorService.openEditor({
		resource: bookmark.resource,
		options: { pinned: true, selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column) }
	});
}
