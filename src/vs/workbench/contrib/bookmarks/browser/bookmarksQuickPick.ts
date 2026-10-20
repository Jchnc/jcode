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
import { IQuickInputService, IQuickPickItem, QuickInputHideReason } from '../../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { PickerEditorState } from '../../../browser/quickaccess.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getBookmarkLabel, groupBookmarksByFile, ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';
import { getBookmarkFileOrder, getCurrentBookmark, openBookmark } from './bookmarksNavigation.js';

interface IBookmarkQuickPickItem extends IQuickPickItem {
	readonly bookmark: ICodeBookmark;
}

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
 * Lets the user search all bookmarks and go to one. The editor previews the highlighted bookmark
 * and returns to where it was when the picker is dismissed.
 *
 * @returns Resolves once the picker is closed.
 */
export function showBookmarksQuickPick(services: IBookmarksQuickPickServices): Promise<void> {
	const { bookmarksService, quickInputService, editorService, instantiationService, notificationService, labelService, uriIdentityService } = services;
	const fileOrder = getBookmarkFileOrder(uriIdentityService, labelService);

	const createItems = (): IBookmarkQuickPickItem[] => {
		// The lines of bookmarks lag behind edits that were just made, so catch up before listing them.
		bookmarksService.sync();
		return groupBookmarksByFile(bookmarksService.bookmarks.filter(bookmark => !bookmark.stale), fileOrder).flatMap(group => group.bookmarks.map(bookmark => ({
			bookmark,
			label: getBookmarkLabel(bookmark),
			description: `${group.label}:${bookmark.lineNumber}`,
			detail: bookmark.note ? bookmark.lineText.trim() || undefined : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.bookmark),
			buttons: [{ iconClass: ThemeIcon.asClassName(Codicon.trash), tooltip: localize('removeBookmark', "Remove Bookmark") }]
		})));
	};

	const items = createItems();
	if (items.length === 0) {
		notificationService.info(localize('noBookmarks', "There are no active bookmarks in this workspace."));
		return Promise.resolve();
	}

	return new Promise<void>(resolve => {
		const disposables = new DisposableStore();
		const editorState = disposables.add(instantiationService.createInstance(PickerEditorState));
		const picker = disposables.add(quickInputService.createQuickPick<IBookmarkQuickPickItem>());
		picker.title = localize('goToBookmarkTitle', "Go to Bookmark");
		picker.placeholder = localize('goToBookmarkPlaceholder', "Search bookmarks by note, file, or line");
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;
		picker.sortByLabel = false;
		picker.items = items;

		disposables.add(picker.onDidChangeActive(async ([item]) => {
			if (item) {
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
		disposables.add(picker.onDidTriggerItemButton(({ item }) => {
			const index = picker.items.indexOf(item);
			bookmarksService.remove(item.bookmark.id);
			const remaining = createItems();
			if (remaining.length === 0) {
				// Nothing is left to go to, so go back to where the user was, as when the picker is dismissed.
				restoreOnHide = true;
				picker.hide();
				return;
			}
			picker.items = remaining;
			picker.activeItems = [remaining[Math.min(index, remaining.length - 1)]];
		}));

		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
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
