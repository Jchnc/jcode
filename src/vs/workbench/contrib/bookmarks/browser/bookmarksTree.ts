/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { IMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { CountBadge } from '../../../../base/browser/ui/countBadge/countBadge.js';
import { IIdentityProvider, IKeyboardNavigationLabelProvider, IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { IListAccessibilityProvider, IListStyles } from '../../../../base/browser/ui/list/listWidget.js';
import { IObjectTreeElement, ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { WorkbenchObjectTree } from '../../../../platform/list/browser/listService.js';
import { defaultCountBadgeStyles, IStyleOverride } from '../../../../platform/theme/browser/defaultStyles.js';
import { asCssVariable } from '../../../../platform/theme/common/colorUtils.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { getBookmarkColor } from '../common/bookmarkColors.js';
import { getBookmarkFileOrder } from './bookmarksNavigation.js';
import { BOOKMARKS_VIEW_ITEM_INLINE_MENU, BookmarkItemKind, CONTEXT_CODE_BOOKMARK_ITEM_KIND, getBookmarkLabel, IBookmarkActionContext, IBookmarkFileGroup, ICodeBookmark, groupBookmarksByFile } from '../common/bookmarks.js';

const FILE_ROW_HEIGHT = 22;
const BOOKMARK_ROW_HEIGHT = 40;

/**
 * A file with bookmarks. The element instance of a file stays the same for as long as the file
 * has bookmarks, so that the tree can update it in place.
 */
export class BookmarkFileElement {
	readonly id: string;

	constructor(readonly key: string, readonly resource: URI, public label: string, public count: number) {
		this.id = `file:${key}`;
	}
}

/**
 * A bookmark in a file. The element instance stays the same while the bookmark stays in the same
 * file, so that the tree can update it in place.
 */
export class BookmarkElement {
	readonly id: string;

	constructor(readonly file: BookmarkFileElement, public bookmark: ICodeBookmark) {
		this.id = `bookmark:${bookmark.id}`;
	}
}

export type BookmarksTreeElement = BookmarkFileElement | BookmarkElement;

export interface IBookmarkFileTreeElement extends IObjectTreeElement<BookmarksTreeElement> {
	readonly children: IObjectTreeElement<BookmarksTreeElement>[];
}

export interface IBookmarksTreeUpdate {
	readonly elements: IBookmarkFileTreeElement[];
	/**
	 * Elements that stay in the tree but have to be rendered again.
	 */
	readonly changed: BookmarksTreeElement[];
}

/**
 * Turns the listed bookmarks into tree elements. Elements are reused between updates so
 * that the tree only touches what actually changed.
 */
export class BookmarksTreeModel {
	private files = new Map<string, BookmarkFileElement>();
	private bookmarks = new Map<string, BookmarkElement>();

	update(groups: readonly IBookmarkFileGroup[]): IBookmarksTreeUpdate {
		const files = new Map<string, BookmarkFileElement>();
		const bookmarks = new Map<string, BookmarkElement>();
		const changed: BookmarksTreeElement[] = [];
		const elements: IBookmarkFileTreeElement[] = [];

		for (const group of groups) {
			let file = this.files.get(group.key);
			if (!file) {
				file = new BookmarkFileElement(group.key, group.resource, group.label, group.bookmarks.length);
			} else if (file.label !== group.label || file.count !== group.bookmarks.length) {
				file.label = group.label;
				file.count = group.bookmarks.length;
				changed.push(file);
			}
			files.set(group.key, file);

			const children: IObjectTreeElement<BookmarksTreeElement>[] = [];
			for (const bookmark of group.bookmarks) {
				let element = this.bookmarks.get(bookmark.id);
				if (!element || element.file !== file) {
					element = new BookmarkElement(file, bookmark);
				} else if (element.bookmark !== bookmark) {
					element.bookmark = bookmark;
					changed.push(element);
				}
				bookmarks.set(bookmark.id, element);
				children.push({ element });
			}
			// Files have to be marked collapsible explicitly, otherwise the tree shows no twistie for them.
			elements.push({ element: file, collapsible: true, children });
		}

		this.files = files;
		this.bookmarks = bookmarks;
		return { elements, changed };
	}

	getBookmarkElement(bookmarkId: string): BookmarkElement | undefined {
		return this.bookmarks.get(bookmarkId);
	}
}

class BookmarksIdentityProvider implements IIdentityProvider<BookmarksTreeElement> {
	getId(element: BookmarksTreeElement): string {
		return element.id;
	}
}

class BookmarksDelegate implements IListVirtualDelegate<BookmarksTreeElement> {
	getHeight(element: BookmarksTreeElement): number {
		return element instanceof BookmarkFileElement ? FILE_ROW_HEIGHT : BOOKMARK_ROW_HEIGHT;
	}

	getTemplateId(element: BookmarksTreeElement): string {
		return element instanceof BookmarkFileElement ? BookmarkFileRenderer.TEMPLATE_ID : BookmarkRenderer.TEMPLATE_ID;
	}
}

class BookmarksAccessibilityProvider implements IListAccessibilityProvider<BookmarksTreeElement> {
	getWidgetAriaLabel(): string {
		return localize('bookmarkList', "Code bookmarks");
	}

	getAriaLabel(element: BookmarksTreeElement): string {
		if (element instanceof BookmarkFileElement) {
			const name = basename(element.resource);
			return element.count === 1 ? localize('bookmarkFileAriaLabelOne', "{0}, 1 bookmark", name) : localize('bookmarkFileAriaLabel', "{0}, {1} bookmarks", name, element.count);
		}

		const { bookmark } = element;
		const label = getBookmarkLabel(bookmark);
		const color = getBookmarkColor(bookmark.color);
		let ariaLabel: string;
		if (bookmark.stale) {
			ariaLabel = localize('staleBookmarkAriaLabel', "{0}, stale bookmark, was on line {1}", label, bookmark.lineNumber);
		} else {
			const lineText = bookmark.note ? bookmark.lineText.trim() : '';
			ariaLabel = lineText ? localize('bookmarkWithTextAriaLabel', "{0}, line {1}, {2}", label, bookmark.lineNumber, lineText) : localize('bookmarkAriaLabel', "{0}, line {1}", label, bookmark.lineNumber);
		}
		return color ? localize('bookmarkColorAriaLabel', "{0}, {1} color", ariaLabel, color.label) : ariaLabel;
	}
}

class BookmarksKeyboardNavigationLabelProvider implements IKeyboardNavigationLabelProvider<BookmarksTreeElement> {
	getKeyboardNavigationLabel(element: BookmarksTreeElement): string {
		return element instanceof BookmarkFileElement ? basename(element.resource) : getBookmarkLabel(element.bookmark);
	}
}

interface IBookmarkFileTemplate {
	readonly label: IResourceLabel;
	readonly count: CountBadge;
}

class BookmarkFileRenderer implements ITreeRenderer<BookmarkFileElement, void, IBookmarkFileTemplate> {
	static readonly TEMPLATE_ID = 'jcode.bookmarks.file';
	readonly templateId = BookmarkFileRenderer.TEMPLATE_ID;

	constructor(
		private readonly labels: ResourceLabels,
		@ILabelService private readonly labelService: ILabelService,
	) { }

	renderTemplate(container: HTMLElement): IBookmarkFileTemplate {
		const file = DOM.append(container, DOM.$('.jcode-bookmarks-file'));
		const label = this.labels.create(DOM.append(file, DOM.$('.jcode-bookmarks-file-label')));
		const count = new CountBadge(DOM.append(file, DOM.$('.jcode-bookmarks-file-count')), {}, defaultCountBadgeStyles);
		return { label, count };
	}

	renderElement(node: ITreeNode<BookmarkFileElement, void>, _index: number, template: IBookmarkFileTemplate): void {
		const { resource, count } = node.element;
		template.label.setResource({ resource, name: basename(resource), description: this.labelService.getUriLabel(dirname(resource), { relative: true }) }, { fileKind: FileKind.FILE });
		template.count.setCount(count);
	}

	disposeTemplate(template: IBookmarkFileTemplate): void {
		template.label.dispose();
		template.count.dispose();
	}
}

interface IBookmarkTemplate {
	readonly row: HTMLElement;
	readonly marker: HTMLElement;
	readonly primary: HTMLElement;
	readonly secondary: HTMLElement;
	readonly toolbar: MenuWorkbenchToolBar;
	readonly itemKind: IContextKey<string>;
	readonly hover: { content: MarkdownString | undefined };
	readonly disposables: DisposableStore;
}

class BookmarkRenderer implements ITreeRenderer<BookmarkElement, void, IBookmarkTemplate> {
	static readonly TEMPLATE_ID = 'jcode.bookmarks.bookmark';
	readonly templateId = BookmarkRenderer.TEMPLATE_ID;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILabelService private readonly labelService: ILabelService,
	) { }

	renderTemplate(container: HTMLElement): IBookmarkTemplate {
		const disposables = new DisposableStore();
		const row = DOM.append(container, DOM.$('.jcode-bookmark-row'));
		const marker = DOM.append(row, DOM.$('span.jcode-bookmark-marker', { 'aria-hidden': 'true' }));
		const content = DOM.append(row, DOM.$('.jcode-bookmark-content'));
		const primary = DOM.append(content, DOM.$('span.jcode-bookmark-primary'));
		const secondary = DOM.append(content, DOM.$('span.jcode-bookmark-secondary'));
		const actions = DOM.append(row, DOM.$('.jcode-bookmark-actions'));

		const scopedContextKeyService = disposables.add(this.contextKeyService.createScoped(row));
		const itemKind = CONTEXT_CODE_BOOKMARK_ITEM_KIND.bindTo(scopedContextKeyService);
		const scopedInstantiationService = disposables.add(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService])));
		const toolbar = disposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, actions, BOOKMARKS_VIEW_ITEM_INLINE_MENU, {
			menuOptions: { shouldForwardArgs: true },
			toolbarOptions: { primaryGroup: () => true }
		}));

		const hover: { content: MarkdownString | undefined } = { content: undefined };
		// The hover sits on the text only, so that it does not cover the tooltips of the inline actions.
		disposables.add(this.hoverService.setupDelayedHover(content, () => ({ content: hover.content ?? '' })));

		return { row, marker, primary, secondary, toolbar, itemKind, hover, disposables };
	}

	renderElement(node: ITreeNode<BookmarkElement, void>, _index: number, template: IBookmarkTemplate): void {
		const { bookmark } = node.element;
		const lineText = bookmark.lineText.trim();

		template.row.classList.toggle('stale', bookmark.stale);
		template.marker.className = `jcode-bookmark-marker ${ThemeIcon.asClassName(bookmark.stale ? Codicon.warning : Codicon.bookmark)}`;
		// A stale bookmark keeps its warning color, which matters more than the tag.
		const color = getBookmarkColor(bookmark.color);
		template.marker.style.color = color && !bookmark.stale ? asCssVariable(color.colorId) : '';
		template.primary.textContent = getBookmarkLabel(bookmark);

		const secondaryParts = [bookmark.stale ? localize('bookmarkStaleLine', "Was on line {0}", bookmark.lineNumber) : localize('bookmarkLine', "Line {0}", bookmark.lineNumber)];
		if (color) {
			// The color is named, so that it does not rely on being seen.
			secondaryParts.push(color.label);
		}
		if (bookmark.note && lineText) {
			secondaryParts.push(lineText);
		}
		if (bookmark.stale) {
			secondaryParts.push(localize('bookmarkStale', "Stale"));
		}
		template.secondary.textContent = secondaryParts.join(' · ');

		const hover = new MarkdownString().appendText(`${this.labelService.getUriLabel(bookmark.resource, { relative: true })}:${bookmark.lineNumber}`);
		if (bookmark.note && lineText) {
			hover.appendMarkdown('\n\n').appendText(lineText);
		}
		if (bookmark.stale) {
			hover.appendMarkdown('\n\n').appendText(localize('staleBookmarkTitle', "The bookmarked line was deleted or can no longer be found. Relocate the bookmark to the current line, or remove it."));
		}
		template.hover.content = hover;

		template.itemKind.set(bookmark.stale ? BookmarkItemKind.StaleBookmark : BookmarkItemKind.Bookmark);
		const context: IBookmarkActionContext = { bookmarkId: bookmark.id };
		template.toolbar.context = context;
	}

	disposeTemplate(template: IBookmarkTemplate): void {
		template.disposables.dispose();
	}
}

export interface IBookmarksTreeOpenEvent {
	readonly bookmark: ICodeBookmark;
	readonly editorOptions: IEditorOptions;
	readonly sideBySide: boolean;
}

export interface IBookmarksTreeContextMenuEvent {
	readonly element: BookmarksTreeElement;
	readonly anchor: HTMLElement | IMouseEvent;
}

export interface IBookmarksTreeOptions {
	readonly overrideStyles?: IStyleOverride<IListStyles>;
	readonly onDidChangeVisibility: Event<boolean>;
}

/**
 * The list of bookmarks grouped by file. It is updated incrementally, so that focus,
 * selection, scroll position and collapsed files survive changes to the bookmarks.
 */
export class BookmarksTree extends Disposable {
	private readonly model = new BookmarksTreeModel();
	private readonly identityProvider = new BookmarksIdentityProvider();
	private readonly tree: WorkbenchObjectTree<BookmarksTreeElement>;
	private order: readonly BookmarksTreeElement[] = [];

	private readonly _onDidOpenBookmark = this._register(new Emitter<IBookmarksTreeOpenEvent>());
	readonly onDidOpenBookmark = this._onDidOpenBookmark.event;

	private readonly _onDidRequestContextMenu = this._register(new Emitter<IBookmarksTreeContextMenuEvent>());
	readonly onDidRequestContextMenu = this._onDidRequestContextMenu.event;

	constructor(
		container: HTMLElement,
		options: IBookmarksTreeOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();

		const labels = this._register(instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: options.onDidChangeVisibility }));
		this.tree = this._register(instantiationService.createInstance(WorkbenchObjectTree<BookmarksTreeElement>, 'JCodeBookmarks', container, new BookmarksDelegate(), [
			instantiationService.createInstance(BookmarkFileRenderer, labels),
			instantiationService.createInstance(BookmarkRenderer)
		], {
			identityProvider: this.identityProvider,
			accessibilityProvider: new BookmarksAccessibilityProvider(),
			keyboardNavigationLabelProvider: new BookmarksKeyboardNavigationLabelProvider(),
			overrideStyles: options.overrideStyles,
			multipleSelectionSupport: false,
			findWidgetEnabled: false,
			horizontalScrolling: false
		}));

		this._register(this.tree.onDidOpen(event => {
			if (event.element instanceof BookmarkElement) {
				this._onDidOpenBookmark.fire({ bookmark: event.element.bookmark, editorOptions: event.editorOptions, sideBySide: event.sideBySide });
			}
		}));
		this._register(this.tree.onContextMenu(event => {
			if (event.element) {
				this._onDidRequestContextMenu.fire({ element: event.element, anchor: event.anchor });
			}
		}));
	}

	/**
	 * Shows the given bookmarks, touching only the rows that changed.
	 */
	setBookmarks(bookmarks: readonly ICodeBookmark[]): void {
		const groups = groupBookmarksByFile(bookmarks, getBookmarkFileOrder(this.uriIdentityService, this.labelService));
		const [focused] = this.tree.getFocus();
		const hadFocus = DOM.isAncestorOfActiveElement(this.tree.getHTMLElement());
		const previousOrder = this.order;

		const { elements, changed } = this.model.update(groups);
		this.order = elements.flatMap(({ element, children }) => [element, ...children.map(child => child.element)]);
		this.tree.setChildren(null, elements, { diffIdentityProvider: this.identityProvider, diffDepth: 1 });
		for (const element of changed) {
			if (this.tree.hasElement(element)) {
				this.tree.rerender(element);
			}
		}

		if (focused && hadFocus && !this.tree.hasElement(focused)) {
			// The focused item is gone, so hand focus to its closest neighbor instead of dropping it.
			const index = previousOrder.indexOf(focused);
			const neighbor = [...previousOrder.slice(index + 1), ...previousOrder.slice(0, index).reverse()].find(element => this.tree.hasElement(element));
			if (neighbor) {
				this.tree.setFocus([neighbor]);
			}
		}
	}

	layout(height: number, width: number): void {
		this.tree.layout(height, width);
	}

	focus(): void {
		this.tree.domFocus();
	}

	/**
	 * Moves focus to the given bookmark and scrolls it into view.
	 */
	focusBookmark(bookmarkId: string): void {
		const element = this.model.getBookmarkElement(bookmarkId);
		if (element) {
			this.tree.reveal(element);
			this.tree.setFocus([element]);
		}
	}

	getFocusedBookmark(): ICodeBookmark | undefined {
		const [focused] = this.tree.getFocus();
		return focused instanceof BookmarkElement ? focused.bookmark : undefined;
	}
}
