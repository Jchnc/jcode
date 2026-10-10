/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize, localize2 } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';

export class BookmarksView extends ViewPane {
	static readonly ID = 'workbench.view.jcodeBookmarks';
	static readonly NAME = localize2('bookmarksViewName', "Bookmarks");

	private container: HTMLElement | undefined;
	private scrollable: DomScrollableElement | undefined;
	private firstFocusable: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());

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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILabelService private readonly labelService: ILabelService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.bookmarksService.onDidChangeBookmarks(() => this.renderBookmarks()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('jcode-bookmarks-view');
		this.container = DOM.$('.jcode-bookmarks-list', { role: 'list', 'aria-label': localize('bookmarkList', "Code bookmarks") });
		this.scrollable = this._register(new DomScrollableElement(this.container, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto
		}));
		const scrollableNode = this.scrollable.getDomNode();
		scrollableNode.classList.add('jcode-bookmarks-scrollable');
		container.appendChild(scrollableNode);
		this.renderBookmarks();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.scrollable) {
			const scrollableNode = this.scrollable.getDomNode();
			scrollableNode.style.width = `${width}px`;
			scrollableNode.style.height = `${height}px`;
			if (this.container) {
				this.container.style.width = `${width}px`;
				this.container.style.height = `${height}px`;
			}
			this.scrollable.scanDomNode();
		}
	}

	override focus(): void {
		super.focus();
		this.firstFocusable?.focus();
	}

	private renderBookmarks(): void {
		if (!this.container) {
			return;
		}
		this.renderDisposables.clear();
		DOM.clearNode(this.container);
		this.firstFocusable = undefined;

		if (this.bookmarksService.bookmarks.length === 0) {
			this.renderEmptyState(this.container);
			this.scrollable?.scanDomNode();
			return;
		}

		for (const group of this.groupBookmarks()) {
			const section = DOM.append(this.container, DOM.$('section.jcode-bookmarks-group', { role: 'group', 'aria-label': group.label }));
			const header = DOM.append(section, DOM.$('.jcode-bookmarks-file'));
			const icon = DOM.append(header, DOM.$('span.jcode-bookmarks-file-icon', { 'aria-hidden': 'true' }));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.file));
			const labels = DOM.append(header, DOM.$('.jcode-bookmarks-file-labels'));
			DOM.append(labels, DOM.$('span.jcode-bookmarks-file-name', undefined, basename(group.resource)));
			DOM.append(labels, DOM.$('span.jcode-bookmarks-file-path', undefined, this.labelService.getUriLabel(dirname(group.resource), { relative: true })));

			for (const bookmark of group.bookmarks) {
				this.renderBookmark(section, bookmark);
			}
		}
		this.scrollable?.scanDomNode();
	}

	private renderEmptyState(parent: HTMLElement): void {
		const empty = DOM.append(parent, DOM.$('.jcode-bookmarks-empty'));
		const icon = DOM.append(empty, DOM.$('span.jcode-bookmarks-empty-icon', { 'aria-hidden': 'true' }));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.bookmark));
		DOM.append(empty, DOM.$('h3', undefined, localize('bookmarksEmptyTitle', "No bookmarks yet")));
		DOM.append(empty, DOM.$('p', undefined, localize('bookmarksEmptyDescription', "Bookmark important lines to return to them from anywhere in your workspace.")));
		const action = DOM.append(empty, DOM.$('button.jcode-bookmarks-empty-action', { type: 'button' }, localize('bookmarkCurrentLine', "Bookmark Current Line"))) as HTMLButtonElement;
		this.firstFocusable = action;
		this.renderDisposables.add(DOM.addDisposableListener(action, DOM.EventType.CLICK, () => this.commandService.executeCommand('jcode.bookmarks.toggle')));
	}

	private renderBookmark(parent: HTMLElement, bookmark: ICodeBookmark): void {
		const row = DOM.append(parent, DOM.$('.jcode-bookmark-row', { role: 'listitem' }));
		if (bookmark.stale) {
			row.classList.add('stale');
		}

		const main = DOM.append(row, DOM.$('button.jcode-bookmark-main', {
			type: 'button',
			'title': bookmark.stale ? localize('bookmarkNeedsAttentionTitle', "This bookmark could not be relocated confidently.") : localize('openBookmarkTitle', "Open bookmark")
		})) as HTMLButtonElement;
		this.firstFocusable ??= main;
		const marker = DOM.append(main, DOM.$('span.jcode-bookmark-marker', { 'aria-hidden': 'true' }));
		marker.classList.add(...ThemeIcon.asClassNameArray(bookmark.stale ? Codicon.warning : Codicon.bookmark));
		const content = DOM.append(main, DOM.$('.jcode-bookmark-content'));
		const primary = bookmark.note || bookmark.lineText.trim() || localize('bookmarkEmptyLine', "Empty line");
		DOM.append(content, DOM.$('span.jcode-bookmark-primary', undefined, primary));
		const secondaryParts = [localize('bookmarkLine', "Line {0}", bookmark.lineNumber)];
		if (bookmark.note && bookmark.lineText.trim()) {
			secondaryParts.push(bookmark.lineText.trim());
		}
		if (bookmark.stale) {
			secondaryParts.push(localize('bookmarkNeedsAttention', "Needs attention"));
		}
		DOM.append(content, DOM.$('span.jcode-bookmark-secondary', undefined, secondaryParts.join(' · ')));
		this.renderDisposables.add(DOM.addDisposableListener(main, DOM.EventType.CLICK, () => this.openBookmark(bookmark)));

		const actions = DOM.append(row, DOM.$('.jcode-bookmark-actions'));
		const edit = this.actionButton(actions, Codicon.edit, localize('editBookmarkNote', "Edit Bookmark Note"), () => this.editNote(bookmark));
		const remove = this.actionButton(actions, Codicon.trash, localize('removeBookmark', "Remove Bookmark"), () => this.bookmarksService.remove(bookmark.id));
		edit.tabIndex = 0;
		remove.tabIndex = 0;
	}

	private actionButton(parent: HTMLElement, icon: ThemeIcon, label: string, action: () => void | Promise<void>): HTMLButtonElement {
		const button = DOM.append(parent, DOM.$('button.jcode-bookmark-action', { type: 'button', 'aria-label': label, title: label })) as HTMLButtonElement;
		button.classList.add(...ThemeIcon.asClassNameArray(icon));
		this.renderDisposables.add(DOM.addDisposableListener(button, DOM.EventType.CLICK, event => {
			event.stopPropagation();
			void action();
		}));
		return button;
	}

	private async openBookmark(bookmark: ICodeBookmark): Promise<void> {
		await this.editorService.openEditor({
			resource: bookmark.resource,
			options: { pinned: true, selection: new Range(bookmark.lineNumber, bookmark.column, bookmark.lineNumber, bookmark.column) }
		});
	}

	private async editNote(bookmark: ICodeBookmark): Promise<void> {
		const note = await this.quickInputService.input({
			title: localize('bookmarkNoteTitle', "Bookmark Note"),
			prompt: localize('bookmarkNotePrompt', "Add context that will help you recognize this location later."),
			placeHolder: localize('bookmarkNotePlaceholder', "What is important here?"),
			value: bookmark.note ?? ''
		});
		if (note !== undefined) {
			this.bookmarksService.updateNote(bookmark.id, note);
		}
	}

	private groupBookmarks(): { resource: URI; label: string; bookmarks: ICodeBookmark[] }[] {
		const groups = new Map<string, { resource: URI; label: string; bookmarks: ICodeBookmark[] }>();
		for (const bookmark of this.bookmarksService.bookmarks) {
			const key = bookmark.resource.toString();
			let group = groups.get(key);
			if (!group) {
				group = { resource: bookmark.resource, label: this.labelService.getUriLabel(bookmark.resource, { relative: true }), bookmarks: [] };
				groups.set(key, group);
			}
			group.bookmarks.push(bookmark);
		}
		return [...groups.values()]
			.sort((left, right) => left.label.localeCompare(right.label))
			.map(group => ({ ...group, bookmarks: group.bookmarks.sort((left, right) => left.lineNumber - right.lineNumber) }));
	}
}
