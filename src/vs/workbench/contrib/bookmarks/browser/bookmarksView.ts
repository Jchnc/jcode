/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize, localize2 } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { BOOKMARKS_VIEW_ITEM_MENU, BookmarkItemKind, CONTEXT_CODE_BOOKMARK_ITEM_KIND, IBookmarkActionContext, ICodeBookmarksService } from '../common/bookmarks.js';
import { BookmarkElement, BookmarksTree, IBookmarksTreeContextMenuEvent, IBookmarksTreeOpenEvent } from './bookmarksTree.js';

export class BookmarksView extends ViewPane {
	static readonly ID = 'workbench.view.jcodeBookmarks';
	static readonly NAME = localize2('bookmarksViewName', "Bookmarks");

	private tree: BookmarksTree | undefined;
	private treeContainer: HTMLElement | undefined;
	private emptyContainer: HTMLElement | undefined;
	private emptyAction: HTMLButtonElement | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICodeBookmarksService private readonly bookmarksService: ICodeBookmarksService,
		@IEditorService private readonly editorService: IEditorService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.bookmarksService.onDidChangeBookmarks(() => this.refresh()));
		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				this.refresh();
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('jcode-bookmarks-view');

		this.treeContainer = DOM.append(container, DOM.$('.jcode-bookmarks-tree.show-file-icons'));
		const tree = this.tree = this._register(this.instantiationService.createInstance(BookmarksTree, this.treeContainer, {
			overrideStyles: this.getLocationBasedColors().listOverrideStyles,
			onDidChangeVisibility: this.onDidChangeBodyVisibility
		}));
		this._register(tree.onDidOpenBookmark(event => this.openBookmark(event)));
		this._register(tree.onDidRequestContextMenu(event => this.showContextMenu(event)));

		this.emptyContainer = this.renderEmptyState(container);
		this.refresh();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		if (this.bookmarksService.bookmarks.length > 0) {
			this.tree?.focus();
		} else {
			this.emptyAction?.focus();
		}
	}

	/**
	 * The bookmark that has keyboard focus in the view, if any.
	 */
	getFocusedBookmarkId(): string | undefined {
		return this.tree?.getFocusedBookmark()?.id;
	}

	private refresh(): void {
		if (!this.tree || !this.isBodyVisible()) {
			return;
		}

		const bookmarks = this.bookmarksService.bookmarks;
		const isEmpty = bookmarks.length === 0;
		if (this.treeContainer && this.emptyContainer) {
			DOM.setVisibility(!isEmpty, this.treeContainer);
			DOM.setVisibility(isEmpty, this.emptyContainer);
		}
		this.tree.setBookmarks(bookmarks);
	}

	private renderEmptyState(parent: HTMLElement): HTMLElement {
		const empty = DOM.append(parent, DOM.$('.jcode-bookmarks-empty'));
		const icon = DOM.append(empty, DOM.$('span.jcode-bookmarks-empty-icon', { 'aria-hidden': 'true' }));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.bookmark));
		DOM.append(empty, DOM.$('h3', undefined, localize('bookmarksEmptyTitle', "No bookmarks yet")));
		DOM.append(empty, DOM.$('p', undefined, localize('bookmarksEmptyDescription', "Bookmark important lines to return to them from anywhere in your workspace.")));
		const action = this.emptyAction = DOM.append(empty, DOM.$('button.jcode-bookmarks-empty-action', { type: 'button' }, localize('bookmarkCurrentLine', "Bookmark Current Line"))) as HTMLButtonElement;
		this._register(DOM.addDisposableListener(action, DOM.EventType.CLICK, () => this.commandService.executeCommand('jcode.bookmarks.toggle')));
		return empty;
	}

	private async openBookmark({ bookmark, editorOptions, sideBySide }: IBookmarksTreeOpenEvent): Promise<void> {
		await this.editorService.openEditor({
			resource: bookmark.resource,
			options: { ...editorOptions, selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column) }
		}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
	}

	private showContextMenu({ element, anchor }: IBookmarksTreeContextMenuEvent): void {
		if (!(element instanceof BookmarkElement)) {
			return;
		}
		const { bookmark } = element;
		const context: IBookmarkActionContext = { bookmarkId: bookmark.id };
		this.contextMenuService.showContextMenu({
			menuId: BOOKMARKS_VIEW_ITEM_MENU,
			menuActionOptions: { shouldForwardArgs: true },
			contextKeyService: this.scopedContextKeyService.createOverlay([[CONTEXT_CODE_BOOKMARK_ITEM_KIND.key, bookmark.stale ? BookmarkItemKind.StaleBookmark : BookmarkItemKind.Bookmark]]),
			getAnchor: () => anchor,
			getActionsContext: () => context
		});
	}
}
