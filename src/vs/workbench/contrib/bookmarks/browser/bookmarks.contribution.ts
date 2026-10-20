/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/bookmarks.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor, isCodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ILocalizedString, localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
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
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { FocusedViewContext } from '../../../common/contextkeys.js';
import { BOOKMARKS_VIEW_ITEM_INLINE_MENU, BOOKMARKS_VIEW_ITEM_MENU, BookmarkItemKind, CONTEXT_CODE_BOOKMARK_ITEM_KIND, CONTEXT_CODE_BOOKMARKS_PRESENT, CONTEXT_CODE_BOOKMARKS_STALE_PRESENT, getBookmarkLabel, ICodeBookmark, ICodeBookmarksService, isBookmarkActionContext } from '../common/bookmarks.js';
import { pickBookmarkColor } from './bookmarksColorPick.js';
import { ALT_CLICK_TOGGLES_BOOKMARK_SETTING, BookmarkGlyphMarginContribution } from './bookmarksGlyphMargin.js';
import { findBookmarkToNavigateTo, getBookmarkFileOrder, openBookmark } from './bookmarksNavigation.js';
import { showBookmarksQuickPick } from './bookmarksQuickPick.js';
import { getBookmarkTarget } from './bookmarksTarget.js';
import { CodeBookmarksService } from './bookmarksService.js';
import { BookmarksView } from './bookmarksView.js';

const TOGGLE_BOOKMARK_ID = 'jcode.bookmarks.toggle';
const TOGGLE_BOOKMARK_WITH_NOTE_ID = 'jcode.bookmarks.toggleWithNote';
const NEXT_BOOKMARK_ID = 'jcode.bookmarks.next';
const PREVIOUS_BOOKMARK_ID = 'jcode.bookmarks.previous';
const SHOW_BOOKMARKS_ID = 'jcode.bookmarks.show';
const REMOVE_ALL_BOOKMARKS_ID = 'jcode.bookmarks.removeAll';
const REMOVE_STALE_BOOKMARKS_ID = 'jcode.bookmarks.removeStale';
const RELOCATE_BOOKMARK_ID = 'jcode.bookmarks.relocate';
const GO_TO_BOOKMARK_ID = 'jcode.bookmarks.goTo';
const EDIT_BOOKMARK_NOTE_ID = 'jcode.bookmarks.editNote';
const REMOVE_BOOKMARK_ID = 'jcode.bookmarks.remove';
const SET_BOOKMARK_COLOR_ID = 'jcode.bookmarks.setColor';

const IS_BOOKMARK_ITEM = CONTEXT_CODE_BOOKMARK_ITEM_KIND.notEqualsTo(BookmarkItemKind.File);
const IS_FOCUSED_IN_BOOKMARKS_VIEW = FocusedViewContext.isEqualTo(BookmarksView.ID);

const bookmarksViewIcon = registerIcon('jcode-bookmarks-view-icon', Codicon.bookmark, localize('bookmarksViewIcon', "View icon of the Bookmarks view."));

registerSingleton(ICodeBookmarksService, CodeBookmarksService, InstantiationType.Delayed);

class CodeBookmarksContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.jcodeCodeBookmarks';
	constructor(@ICodeBookmarksService _bookmarksService: ICodeBookmarksService) { }
}

registerWorkbenchContribution2(CodeBookmarksContribution.ID, CodeBookmarksContribution, WorkbenchPhase.AfterRestored);

registerEditorContribution(BookmarkGlyphMarginContribution.ID, BookmarkGlyphMarginContribution, EditorContributionInstantiation.AfterFirstRender);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'jcodeBookmarks',
	order: 100,
	title: localize('bookmarksConfigurationTitle', "Bookmarks"),
	type: 'object',
	properties: {
		[ALT_CLICK_TOGGLES_BOOKMARK_SETTING]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize('toggleOnAltClick', "Controls whether holding `Alt` while clicking the editor glyph margin toggles a bookmark on that line. Glyphs that belong to other features, such as breakpoints, keep their own `Alt` + click behavior. In files where the debugger can set breakpoints, `Alt` + click on an empty glyph margin keeps opening the conditional breakpoint editor, so use the Toggle Bookmark command or the line number context menu to bookmark lines there.")
		}
	}
});

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
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyB,
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
			// In the original side of a diff editor the line may belong to another file, or to none.
			const target = getBookmarkTarget({ codeEditorService: accessor.get(ICodeEditorService), fileService: accessor.get(IFileService), uriIdentityService: accessor.get(IUriIdentityService) }, context.uri, context.lineNumber);
			if (target) {
				accessor.get(ICodeBookmarksService).toggle(target.resource, target.lineNumber, 1);
			}
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
		await promptForBookmarkNote(service, accessor.get(IQuickInputService), bookmark);
	}
});

async function promptForBookmarkNote(service: ICodeBookmarksService, quickInputService: IQuickInputService, bookmark: ICodeBookmark): Promise<void> {
	const note = await quickInputService.input({
		title: localize('bookmarkNoteTitle', "Bookmark Note"),
		prompt: localize('bookmarkNotePrompt', "Add context that will help you recognize this location later."),
		placeHolder: localize('bookmarkNotePlaceholder', "What is important here?"),
		value: bookmark.note ?? ''
	});
	if (note !== undefined) {
		service.updateNote(bookmark.id, note);
	}
}

/**
 * Finds the bookmark an action was invoked on, as passed by the Bookmarks view.
 */
function getContextBookmark(accessor: ServicesAccessor, context: unknown): ICodeBookmark | undefined {
	const id = typeof context === 'string' ? context : isBookmarkActionContext(context) ? context.bookmarkId : undefined;
	return id ? accessor.get(ICodeBookmarksService).bookmarks.find(bookmark => bookmark.id === id) : undefined;
}

/**
 * Finds the bookmark on the line of the cursor in the active editor.
 */
function getBookmarkAtCursor(accessor: ServicesAccessor): ICodeBookmark | undefined {
	const editor = getActiveCodeEditor(accessor.get(IEditorService));
	const model = editor?.getModel();
	const position = editor?.getPosition();
	return model && position ? accessor.get(ICodeBookmarksService).find(model.uri, position.lineNumber) : undefined;
}

/**
 * Finds the bookmark an action was invoked on: the one passed by the Bookmarks view, else the one
 * that has keyboard focus in the view.
 */
function resolveBookmark(accessor: ServicesAccessor, context: unknown): ICodeBookmark | undefined {
	const bookmark = getContextBookmark(accessor, context);
	if (bookmark) {
		return bookmark;
	}
	const id = accessor.get(IViewsService).getActiveViewWithId<BookmarksView>(BookmarksView.ID)?.getFocusedBookmarkId();
	return id ? accessor.get(ICodeBookmarksService).bookmarks.find(candidate => candidate.id === id) : undefined;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: EDIT_BOOKMARK_NOTE_ID,
			title: localize2('editBookmarkNote', "Edit Bookmark Note"),
			icon: Codicon.edit,
			keybinding: { primary: KeyCode.F2, weight: KeybindingWeight.WorkbenchContrib, when: IS_FOCUSED_IN_BOOKMARKS_VIEW },
			menu: [
				{ id: BOOKMARKS_VIEW_ITEM_INLINE_MENU, group: 'inline', order: 2, when: IS_BOOKMARK_ITEM },
				{ id: BOOKMARKS_VIEW_ITEM_MENU, group: '1_modification', order: 2, when: IS_BOOKMARK_ITEM }
			]
		});
	}

	async run(accessor: ServicesAccessor, context?: unknown): Promise<void> {
		const service = accessor.get(ICodeBookmarksService);
		const quickInputService = accessor.get(IQuickInputService);
		const bookmark = resolveBookmark(accessor, context);
		if (bookmark) {
			await promptForBookmarkNote(service, quickInputService, bookmark);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SET_BOOKMARK_COLOR_ID,
			title: localize2('setBookmarkColor', "Set Bookmark Color..."),
			icon: Codicon.symbolColor,
			f1: true,
			precondition: CONTEXT_CODE_BOOKMARKS_PRESENT,
			menu: { id: BOOKMARKS_VIEW_ITEM_MENU, group: '1_modification', order: 3, when: IS_BOOKMARK_ITEM }
		});
	}

	async run(accessor: ServicesAccessor, context?: unknown): Promise<void> {
		const service = accessor.get(ICodeBookmarksService);
		const quickInputService = accessor.get(IQuickInputService);
		const accessibilityService = accessor.get(IAccessibilityService);
		// Without an item to act on, as from the palette, it is the bookmark focused in the Bookmarks view when that has
		// focus, else the bookmark under the cursor. A bookmark that was focused in the view earlier is not a hidden target.
		const isFocusedInView = accessor.get(IContextKeyService).contextMatchesRules(IS_FOCUSED_IN_BOOKMARKS_VIEW);
		const bookmark = getContextBookmark(accessor, context) ?? (isFocusedInView ? resolveBookmark(accessor, undefined) : getBookmarkAtCursor(accessor));
		if (!bookmark) {
			accessor.get(INotificationService).info(localize('setColorNeedsBookmark', "Place the cursor on a bookmarked line, or select a bookmark in the Bookmarks view, to set its color."));
			return;
		}

		const pick = await pickBookmarkColor(quickInputService, bookmark.color);
		if (pick) {
			service.updateColor(bookmark.id, pick.color);
			accessibilityService.status(pick.color ? localize('bookmarkColorSet', "Bookmark color set to {0}", pick.label) : localize('bookmarkColorRemoved', "Bookmark color removed"));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: REMOVE_BOOKMARK_ID,
			title: localize2('removeBookmark', "Remove Bookmark"),
			icon: Codicon.trash,
			keybinding: { primary: KeyCode.Delete, mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace }, weight: KeybindingWeight.WorkbenchContrib, when: IS_FOCUSED_IN_BOOKMARKS_VIEW },
			menu: [
				{ id: BOOKMARKS_VIEW_ITEM_INLINE_MENU, group: 'inline', order: 3, when: IS_BOOKMARK_ITEM },
				{ id: BOOKMARKS_VIEW_ITEM_MENU, group: '3_remove', order: 1, when: IS_BOOKMARK_ITEM }
			]
		});
	}

	run(accessor: ServicesAccessor, context?: unknown): void {
		const bookmark = resolveBookmark(accessor, context);
		if (bookmark) {
			accessor.get(ICodeBookmarksService).remove(bookmark.id);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: GO_TO_BOOKMARK_ID,
			title: localize2('goToBookmark', "Go to Bookmark..."),
			icon: Codicon.search,
			f1: true,
			precondition: CONTEXT_CODE_BOOKMARKS_PRESENT,
			// Ctrl+K L sits next to Toggle Bookmark (Ctrl+K B) and no other binding uses it.
			keybinding: { primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyL, weight: KeybindingWeight.WorkbenchContrib },
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 0,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', BookmarksView.ID), CONTEXT_CODE_BOOKMARKS_PRESENT)
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return showBookmarksQuickPick({
			bookmarksService: accessor.get(ICodeBookmarksService),
			quickInputService: accessor.get(IQuickInputService),
			editorService: accessor.get(IEditorService),
			instantiationService: accessor.get(IInstantiationService),
			notificationService: accessor.get(INotificationService),
			labelService: accessor.get(ILabelService),
			uriIdentityService: accessor.get(IUriIdentityService)
		});
	}
});

registerNavigationAction(NEXT_BOOKMARK_ID, localize2('nextBookmark', "Go to Next Bookmark"), 1, KeyCode.KeyJ);
registerNavigationAction(PREVIOUS_BOOKMARK_ID, localize2('previousBookmark', "Go to Previous Bookmark"), -1, KeyCode.KeyK);

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

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: REMOVE_STALE_BOOKMARKS_ID,
			title: localize2('removeStaleBookmarks', "Remove Stale Bookmarks"),
			f1: true,
			precondition: CONTEXT_CODE_BOOKMARKS_STALE_PRESENT,
			menu: {
				id: MenuId.ViewTitle,
				group: '1_cleanup',
				order: 1,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('view', BookmarksView.ID), CONTEXT_CODE_BOOKMARKS_STALE_PRESENT)
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(ICodeBookmarksService).removeStale();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RELOCATE_BOOKMARK_ID,
			title: localize2('relocateBookmark', "Relocate Bookmark"),
			icon: Codicon.target,
			f1: true,
			precondition: CONTEXT_CODE_BOOKMARKS_STALE_PRESENT,
			menu: [
				{ id: BOOKMARKS_VIEW_ITEM_INLINE_MENU, group: 'inline', order: 1, when: CONTEXT_CODE_BOOKMARK_ITEM_KIND.isEqualTo(BookmarkItemKind.StaleBookmark) },
				{ id: BOOKMARKS_VIEW_ITEM_MENU, group: '1_modification', order: 1, when: CONTEXT_CODE_BOOKMARK_ITEM_KIND.isEqualTo(BookmarkItemKind.StaleBookmark) }
			]
		});
	}

	async run(accessor: ServicesAccessor, context?: unknown): Promise<void> {
		const service = accessor.get(ICodeBookmarksService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);
		const labelService = accessor.get(ILabelService);
		const accessibilityService = accessor.get(IAccessibilityService);
		const editor = getActiveCodeEditor(accessor.get(IEditorService));
		const model = editor?.getModel();
		const position = editor?.getPosition();
		if (!model || !position) {
			notificationService.info(localize('relocateNeedsEditor', "Place the cursor on a line in an editor to relocate a bookmark to it."));
			return;
		}

		const id = getContextBookmark(accessor, context)?.id ?? await pickStaleBookmark(service, quickInputService, labelService);
		if (!id) {
			return;
		}
		const relocated = service.relocate(id, model.uri, position.lineNumber, position.column);
		if (relocated) {
			accessibilityService.status(localize('bookmarkRelocated', "Bookmark relocated to line {0}", relocated.lineNumber));
		}
	}
});

async function pickStaleBookmark(service: ICodeBookmarksService, quickInputService: IQuickInputService, labelService: ILabelService): Promise<string | undefined> {
	const picked = await quickInputService.pick(service.bookmarks.filter(bookmark => bookmark.stale).map(bookmark => ({
		id: bookmark.id,
		label: getBookmarkLabel(bookmark),
		description: localize('staleBookmarkLocation', "{0}, was on line {1}", labelService.getUriLabel(bookmark.resource, { relative: true }), bookmark.lineNumber)
	})), {
		title: localize('relocateBookmarkTitle', "Relocate Bookmark"),
		placeHolder: localize('relocateBookmarkPlaceholder', "Select the stale bookmark to move to the current line")
	});
	return picked?.id;
}

CommandsRegistry.registerCommandAlias('bookmarks.toggle', TOGGLE_BOOKMARK_ID);

function registerNavigationAction(id: string, title: ILocalizedString, direction: 1 | -1, key: KeyCode): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, f1: true, keybinding: { primary: KeyMod.Shift | KeyMod.Alt | key, weight: KeybindingWeight.WorkbenchContrib, when: CONTEXT_CODE_BOOKMARKS_PRESENT } });
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			const service = accessor.get(ICodeBookmarksService);
			const editorService = accessor.get(IEditorService);
			const notificationService = accessor.get(INotificationService);
			const fileOrder = getBookmarkFileOrder(accessor.get(IUriIdentityService), accessor.get(ILabelService));

			const editor = getActiveCodeEditor(editorService);
			const model = editor?.getModel();
			const position = editor?.getPosition();
			const bookmark = findBookmarkToNavigateTo(service, model && position ? { resource: model.uri, lineNumber: position.lineNumber } : undefined, direction, fileOrder);
			if (!bookmark) {
				notificationService.info(localize('noBookmarks', "There are no active bookmarks in this workspace."));
				return;
			}
			await openBookmark(editorService, bookmark);
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
