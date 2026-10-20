/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { TextEditorSelectionRevealType } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputButton, IQuickInputService, IQuickPick, IQuickPickItem, QuickInputHideReason, QuickPickFocus } from '../../../../platform/quickinput/common/quickInput.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { PickerEditorState } from '../../../browser/quickaccess.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getBookmarkColor } from '../common/bookmarkColors.js';
import { getBookmarkLabel, groupBookmarksByFile, ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';
import { createBookmarkColorPicks, getBookmarkColorPickStrings, IBookmarkColorPick } from './bookmarksColorPick.js';
import { getBookmarkFileOrder, getCurrentBookmark, openBookmark } from './bookmarksNavigation.js';

interface IBookmarkQuickPickItem extends IQuickPickItem {
	readonly kind: 'bookmark';
	readonly bookmark: ICodeBookmark;
}

/**
 * The picker lists the bookmarks, and the colors to tag one with while that is being picked.
 */
type BookmarksPickerItem = IBookmarkQuickPickItem | IBookmarkColorPick;

export interface IBookmarksQuickPickServices {
	readonly bookmarksService: ICodeBookmarksService;
	readonly quickInputService: IQuickInputService;
	readonly editorService: IEditorService;
	readonly instantiationService: IInstantiationService;
	readonly notificationService: INotificationService;
	readonly labelService: ILabelService;
	readonly uriIdentityService: IUriIdentityService;
}

/**
 * Finds the item to highlight once an item is removed: the next one that the text typed so far leaves visible,
 * or else the one before it.
 */
function findVisibleNeighbor(picker: IQuickPick<BookmarksPickerItem>, removed: IBookmarkQuickPickItem): IBookmarkQuickPickItem | undefined {
	const items = picker.items;
	const removedIndex = items.indexOf(removed);
	const find = (focus: QuickPickFocus, isInDirection: (index: number) => boolean): IBookmarkQuickPickItem | undefined => {
		picker.activeItems = [removed];
		picker.focus(focus);
		const [neighbor] = picker.activeItems;
		// The list wraps around, so an item on the other side of the removed one is not a neighbor.
		return neighbor?.kind === 'bookmark' && isInDirection(items.indexOf(neighbor)) ? neighbor : undefined;
	};
	return find(QuickPickFocus.Next, index => index > removedIndex) ?? find(QuickPickFocus.Previous, index => index < removedIndex);
}

/**
 * Lets the user search all bookmarks and go to one. The editor previews the highlighted bookmark
 * and returns to where it was when the picker is dismissed. A bookmark can also be tagged with a
 * color, or have its color removed, and it can be removed.
 *
 * @returns Resolves once the picker is closed.
 */
export function showBookmarksQuickPick(services: IBookmarksQuickPickServices): Promise<void> {
	const { bookmarksService, quickInputService, editorService, instantiationService, notificationService, labelService, uriIdentityService } = services;
	const fileOrder = getBookmarkFileOrder(uriIdentityService, labelService);

	const setColorButton: IQuickInputButton = { iconClass: ThemeIcon.asClassName(Codicon.symbolColor), tooltip: localize('setBookmarkColor', "Set Bookmark Color") };
	const removeButton: IQuickInputButton = { iconClass: ThemeIcon.asClassName(Codicon.trash), tooltip: localize('removeBookmark', "Remove Bookmark") };

	const createItems = (): IBookmarkQuickPickItem[] => {
		// The lines of bookmarks lag behind edits that were just made, so catch up before listing them.
		bookmarksService.sync();
		return groupBookmarksByFile(bookmarksService.bookmarks.filter(bookmark => !bookmark.stale), fileOrder).flatMap(group => group.bookmarks.map((bookmark): IBookmarkQuickPickItem => {
			// The color is named next to the line, so that it is found by searching for it and does not rely on being seen.
			const color = getBookmarkColor(bookmark.color);
			const location = `${group.label}:${bookmark.lineNumber}`;
			return {
				kind: 'bookmark',
				bookmark,
				label: getBookmarkLabel(bookmark),
				description: color ? localize('bookmarkLocationWithColor', "{0} · {1}", location, color.label) : location,
				detail: bookmark.note ? bookmark.lineText.trim() || undefined : undefined,
				iconClass: ThemeIcon.asClassName(Codicon.bookmark),
				iconColor: color && themeColorFromId(color.colorId),
				buttons: [setColorButton, removeButton]
			};
		}));
	};

	const items = createItems();
	if (items.length === 0) {
		notificationService.info(localize('noBookmarks', "There are no active bookmarks in this workspace."));
		return Promise.resolve();
	}

	return new Promise<void>(resolve => {
		const disposables = new DisposableStore();
		const editorState = disposables.add(instantiationService.createInstance(PickerEditorState));
		const picker = disposables.add(quickInputService.createQuickPick<BookmarksPickerItem>());
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;
		picker.sortByLabel = false;

		// The bookmark whose color is being picked, while the picker lists colors, and the text that was typed to search.
		let colorTarget: ICodeBookmark | undefined;
		let searchBeforeColors = '';
		const showBookmarks = (bookmarkItems: IBookmarkQuickPickItem[], activeBookmarkId?: string) => {
			colorTarget = undefined;
			picker.title = localize('goToBookmarkTitle', "Go to Bookmark");
			picker.placeholder = localize('goToBookmarkPlaceholder', "Search bookmarks by note, file, line, or color");
			picker.buttons = [];
			picker.value = searchBeforeColors;
			picker.items = bookmarkItems;
			const active = bookmarkItems.find(item => item.bookmark.id === activeBookmarkId);
			if (active) {
				picker.activeItems = [active];
			}
		};
		const showColors = (bookmark: ICodeBookmark) => {
			colorTarget = bookmark;
			searchBeforeColors = picker.value;
			const { title, placeholder } = getBookmarkColorPickStrings();
			picker.title = title;
			picker.placeholder = placeholder;
			picker.buttons = [quickInputService.backButton];
			picker.value = '';
			const colorPicks = createBookmarkColorPicks(bookmark.color);
			picker.items = colorPicks;
			picker.activeItems = colorPicks.filter(pick => pick.color === bookmark.color);
		};
		showBookmarks(items);

		let isProbingActiveItem = false;
		disposables.add(picker.onDidChangeActive(async ([item]) => {
			if (item?.kind === 'bookmark' && !isProbingActiveItem) {
				const { bookmark } = item;
				editorState.set();
				await editorState.openTransientEditor({
					resource: bookmark.resource,
					options: {
						preserveFocus: true,
						revealIfOpened: true,
						ignoreError: true,
						selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column),
						selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport
					}
				});
			}
		}));

		let restoreOnHide = false;
		disposables.add(picker.onDidTriggerItemButton(({ button, item }) => {
			if (item.kind !== 'bookmark') {
				return;
			}
			if (button === setColorButton) {
				showColors(item.bookmark);
				return;
			}

			bookmarksService.remove(item.bookmark.id);
			const remaining = picker.items.filter(candidate => candidate !== item);
			if (remaining.length === 0) {
				// Nothing is left to go to, so go back to where the user was, as when the picker is dismissed.
				restoreOnHide = true;
				picker.hide();
				return;
			}

			// Moving through the list is how to tell which items the text typed so far leaves visible.
			let neighbor: IBookmarkQuickPickItem | undefined;
			isProbingActiveItem = true;
			try {
				neighbor = findVisibleNeighbor(picker, item);
			} finally {
				isProbingActiveItem = false;
			}
			picker.items = remaining;
			picker.activeItems = neighbor ? [neighbor] : [];
		}));

		disposables.add(picker.onDidTriggerButton(button => {
			if (button === quickInputService.backButton) {
				showBookmarks(createItems(), colorTarget?.id);
			}
		}));

		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
			if (item?.kind === 'color') {
				// Back to the bookmarks, with the tagged one highlighted.
				const taggedId = colorTarget?.id;
				if (taggedId) {
					bookmarksService.updateColor(taggedId, item.color);
				}
				showBookmarks(createItems(), taggedId);
				return;
			}

			picker.hide();
			if (item) {
				// The selected bookmark is opened for good, so the previewed editors are not restored.
				editorState.reset();
				void openBookmark(editorService, getCurrentBookmark(bookmarksService, item.bookmark));
			}
		}));

		disposables.add(Event.once(picker.onDidHide)(async ({ reason }) => {
			// Only a deliberate dismissal goes back: losing focus may mean the user clicked into an editor.
			try {
				if (reason === QuickInputHideReason.Gesture || restoreOnHide) {
					await editorState.restore();
				}
			} finally {
				disposables.dispose();
				resolve();
			}
		}));

		picker.show();
	});
}
