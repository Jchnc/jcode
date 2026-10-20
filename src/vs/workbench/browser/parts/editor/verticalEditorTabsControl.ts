/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/verticalEditorTabsControl.css';
import { $, addDisposableListener, clearNode, Dimension, DragAndDropObserver, EventHelper, EventType, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { applyDragImage } from '../../../../base/browser/ui/dnd/dnd.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { HighlightedLabel } from '../../../../base/browser/ui/highlightedlabel/highlightedLabel.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { ScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { IMatch } from '../../../../base/common/filters.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basenameOrAuthority } from '../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { LocalSelectionTransfer } from '../../../../platform/dnd/browser/dnd.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { localize } from '../../../../nls.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { IMergeGroupOptions, MergeGroupMode } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorInputCapabilities, EditorResourceAccessor, EditorsOrder, IEditorPartOptions, IToolbarActions, preventEditorClose, EditorCloseMethod, SideBySideEditor, GroupModelChangeKind, Verbosity } from '../../../common/editor.js';
import { VerticalEditorTabsFocusContext } from '../../../common/contextkeys.js';
import { getEditorTabGroupColor, IEditorTabGroup, resolveEditorTabGroupIcon } from '../../../common/editor/editorTabGroup.js';
import { IReadonlyEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { computeEditorAriaLabel } from '../../editor.js';
import { DraggedEditorGroupIdentifier, DraggedEditorIdentifier, DraggedEditorTabGroupIdentifier, ResourcesDropHandler } from '../../dnd.js';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from '../../labels.js';
import { CloseEditorTabAction, UnpinEditorAction } from './editorActions.js';
import { FILTER_VERTICAL_TABS_COMMAND_ID, getTabGroupMembers, UNLOCK_GROUP_COMMAND_ID } from './editorCommands.js';
import { EditorCommandsContextActionRunner, EditorTabsControl } from './editorTabsControl.js';
import { DEFAULT_EDITOR_MIN_DIMENSIONS, IEditorGroupMenuIds, IEditorGroupsView, IEditorGroupView, IEditorPartsView, IInternalEditorOpenOptions, isEditorGroupView, prepareMoveCopyEditors } from './editor.js';
import { IEditorTitleControlDimensions } from './editorTitleControl.js';
import { TabGroupContextMenu } from './tabGroupContextMenu.js';
import { getTabGroupHeaderAriaLabel, getTabGroupHeaderTitle, getTabGroupName, getTabGroupTabAriaLabel } from './tabGroupLabels.js';
import { filterVerticalTabs, IVerticalTabsFilterMatches, IVerticalTabsFilterResult } from './verticalTabsFilter.js';

class DraggedVerticalEditorIdentifier extends DraggedEditorIdentifier { }

/** The id of the "New Untitled Text File" command, which the files contribution registers. */
const NEW_UNTITLED_FILE_COMMAND_ID = 'workbench.action.files.newUntitledFile';

/** A tab group that the change about to be rendered collapses or expands, so that it can animate rows instead of just swapping them. */
interface IVerticalTabGroupTransition {
	readonly kind: 'expand' | 'collapse';
	/** The editors that had a row before the change. */
	readonly existing: ReadonlySet<EditorInput>;
	/** Copies of the rows that the change removes, to animate out. */
	readonly exitingRows: ReadonlyMap<EditorInput, HTMLElement>;
}

/** The narrowest width at which the vertical tab column is laid out with labels; a column that gets narrower shrinks on into the compact rendering. */
export const VERTICAL_TABS_MIN_WIDTH = 140;

/** The width of the icons-only column a group falls back to when it cannot fit the labeled one. */
export const VERTICAL_TABS_COMPACT_WIDTH = 48;

/**
 * How far below {@link VERTICAL_TABS_MIN_WIDTH} a column that shows labels may shrink before it
 * switches to the compact rendering. A compact column needs the whole minimum width to get its
 * labels back, so a column that is resized around that width does not flicker between the two.
 */
const VERTICAL_TABS_COMPACT_HYSTERESIS = 20;

/**
 * Computes the width of the vertical tab column of a group. The column shrinks from its
 * preferred width toward {@link VERTICAL_TABS_MIN_WIDTH} so that the editor keeps its minimum
 * width. Once even that does not fit it keeps shrinking with the room it gets, down to the
 * compact icons-only rail, so the column and the editor never jump when a group gets narrower.
 * The editor always keeps at least half of a group too small for the rail.
 */
export function computeVerticalTabsWidth(contentWidth: number, gap: number, preferredWidth: number, minimumEditorWidth: number): number {
	const availableWidth = Math.max(0, contentWidth - gap);
	const roomForTabs = availableWidth - Math.max(minimumEditorWidth, DEFAULT_EDITOR_MIN_DIMENSIONS.width);
	if (roomForTabs >= VERTICAL_TABS_MIN_WIDTH) {
		return Math.max(VERTICAL_TABS_MIN_WIDTH, Math.min(preferredWidth, roomForTabs));
	}

	return Math.min(Math.max(VERTICAL_TABS_COMPACT_WIDTH, roomForTabs), Math.floor(availableWidth / 2));
}

/**
 * Whether a column of the given width renders compact (icons only), given how it rendered
 * before. Leaving the compact rendering takes more width than entering it does.
 */
export function isVerticalTabsWidthCompact(width: number, wasCompact: boolean): boolean {
	return width > 0 && width < (wasCompact ? VERTICAL_TABS_MIN_WIDTH : VERTICAL_TABS_MIN_WIDTH - VERTICAL_TABS_COMPACT_HYSTERESIS);
}

/** The parts of a rendered tab row that non-structural updates touch. */
interface IVerticalTab {
	readonly element: HTMLElement;
	readonly label: IResourceLabel;
	/** Stands in for the file icon of the compact rendering while the file icon theme has none. */
	readonly fallbackIcon: HTMLElement;
	readonly actionBar: ActionBar;
	/** Set while the list is filtered: what of the label matches the filter. */
	readonly filterMatches: IVerticalTabsFilterMatches | undefined;
}

/** A rendered tab group header together with the callback that refreshes its status. */
interface IVerticalTabGroupHeader {
	readonly element: HTMLElement;
	updateStatus(): void;
}

export class VerticalEditorTabsControl extends EditorTabsControl {

	private root: HTMLElement | undefined;
	private toolbar: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;
	private dimensions = Dimension.None;

	/** Holds the listeners and widgets of each rendered row, so a row owns exactly what it created. */
	private readonly rowDisposables = this._register(new DisposableMap<HTMLElement, DisposableStore>());
	private readonly verticalEditorTransfer = LocalSelectionTransfer.getInstance<DraggedVerticalEditorIdentifier>();
	private readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	private readonly tabs = new Map<EditorInput, IVerticalTab>();
	private readonly tabGroupHeaders = new Map<string, IVerticalTabGroupHeader>();
	private readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseEditorTabAction, CloseEditorTabAction.ID, CloseEditorTabAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));
	private lastSingleSelectSelectedEditor: EditorInput | undefined;
	private tabStop: HTMLElement | undefined;
	private compact = false;
	private newTabAction: HTMLElement | undefined;
	private filterAction: HTMLElement | undefined;
	private emptyStateAction: HTMLElement | undefined;

	/** The quick filter: its bar reveals above the list, and its input is only created once the bar shows for the first time. */
	private filterBar: HTMLElement | undefined;
	private filterInput: InputBox | undefined;
	private filterQuery = '';

	/**
	 * The tab groups that were collapsed when the filter started. The filter lists their matching
	 * tabs without expanding them in the model, until they are collapsed in the list again.
	 */
	private readonly tabGroupsExpandedByFilter = new Set<string>();

	/** Whether each tab group was shown collapsed when the list was last drawn, to tell which ones a change collapses or expands. */
	private readonly renderedTabGroups = new Map<string, boolean>();
	private tabGroupTransitions: ReadonlyMap<string, IVerticalTabGroupTransition> = new Map();
	private dropTarget: HTMLElement | undefined;
	private lastMouseWheelEventTime = 0;

	constructor(
		parent: HTMLElement,
		editorPartsView: IEditorPartsView,
		groupsView: IEditorGroupsView,
		groupView: IEditorGroupView,
		tabsModel: IReadonlyEditorGroupModel,
		menuIds: IEditorGroupMenuIds | undefined,
		breadcrumbsInHeader: boolean,
		useModernUITabs: boolean,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IThemeService themeService: IThemeService,
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IHostService hostService: IHostService,
		@IMenuService menuService: IMenuService,
		@IEditorService private readonly editorService: IEditorService,
		@IHistoryService private readonly historyService: IHistoryService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IHoverService private readonly hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(parent, editorPartsView, groupsView, groupView, tabsModel, menuIds, breadcrumbsInHeader, useModernUITabs, contextMenuService, instantiationService, contextKeyService, keybindingService, notificationService, quickInputService, themeService, editorResolverService, hostService, menuService);

		if (this.newTabAction) {
			this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.newTabAction, localize('verticalTabs.newTab', "New Tab")));
		}
		if (this.filterAction) {
			this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.filterAction, () => {
				const keybinding = keybindingService.lookupKeybinding(FILTER_VERTICAL_TABS_COMMAND_ID, this.contextMenuContextKeyService)?.getLabel();
				return keybinding ? localize('verticalTabs.filterTabsKeybinding', "Filter Tabs ({0})", keybinding) : localize('verticalTabs.filterTabs', "Filter Tabs");
			}));
		}
		if (this.emptyStateAction) {
			this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.emptyStateAction, localize('verticalTabs.newFile', "New File")));
		}

		// Everything inside the column, i.e. the toolbar, the filter and the list, counts as the vertical tabs holding focus
		VerticalEditorTabsFocusContext.bindTo(this.contextMenuContextKeyService).set(true);
		this._register(this.tabsModel.onDidModelChange(event => {
			if (event.kind === GroupModelChangeKind.TAB_GROUP_CHANGED) {
				// A group that got expanded in the model no longer needs the filter to list its tabs,
				// so that collapsing it again while filtering shows
				for (const groupId of this.tabGroupsExpandedByFilter) {
					if (!this.tabsModel.tabGroups.some(group => group.id === groupId && group.collapsed)) {
						this.tabGroupsExpandedByFilter.delete(groupId);
					}
				}

				// Whichever way a tab group got collapsed or expanded (header, keyboard, context
				// menu, command), it arrives here as a change of the model, which drives the animation
				this.redrawAnimatingTabGroups();
			} else if (event.kind === GroupModelChangeKind.TAB_GROUP_CREATED || event.kind === GroupModelChangeKind.TAB_GROUP_REMOVED) {
				this.redraw();
			}
		}));
		this.redraw();
	}

	protected override create(parent: HTMLElement): HTMLElement {
		super.create(parent);

		this.root = $('.vertical-tabs-and-actions-container');
		parent.appendChild(this.root);

		this.toolbar = $('.vertical-tabs-toolbar');
		this.toolbar.draggable = true;
		this.toolbar.setAttribute('aria-label', localize('verticalTabs.toolbar', "Editor tab actions"));
		const leadingActions = $('.vertical-tabs-toolbar-leading');
		this.toolbar.appendChild(leadingActions);
		const newTabButton = $<HTMLButtonElement>('button.vertical-tabs-toolbar-button.vertical-tabs-new-tab');
		newTabButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.add));
		newTabButton.type = 'button';
		newTabButton.setAttribute('aria-label', localize('verticalTabs.newTab', "New Tab"));
		leadingActions.appendChild(newTabButton);
		this.newTabAction = newTabButton; // gets its hover once the services are injected
		this._register(addDisposableListener(newTabButton, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.openNewTab();
		}));
		const filterButton = $<HTMLButtonElement>('button.vertical-tabs-toolbar-button.vertical-tabs-filter-toggle');
		filterButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.filter));
		filterButton.type = 'button';
		filterButton.setAttribute('aria-label', localize('verticalTabs.filterTabs', "Filter Tabs"));
		filterButton.setAttribute('aria-pressed', 'false');
		leadingActions.appendChild(filterButton);
		this.filterAction = filterButton;
		this._register(addDisposableListener(filterButton, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.toggleFilter();
		}));
		this.createEditorActionsToolBar(this.toolbar, ['vertical-tabs-actions']);
		this.root.appendChild(this.toolbar);
		let lastGroupDragEvent: DragEvent | undefined;
		let isNewWindowOperation = false;
		this._register(addDisposableListener(this.toolbar, EventType.DRAG_START, event => {
			if (event.target !== this.toolbar) {
				event.preventDefault();
				return;
			}
			isNewWindowOperation = this.onGroupDragStart(event, this.toolbar!);
		}));
		this._register(addDisposableListener(this.toolbar, EventType.DRAG, event => lastGroupDragEvent = event));
		this._register(addDisposableListener(this.toolbar, EventType.DRAG_END, event => void this.onGroupDragEnd(event, lastGroupDragEvent, this.toolbar!, isNewWindowOperation)));

		// The quick filter reveals above the list. Its input is created when it shows for the first time.
		this.filterBar = $('.vertical-tabs-filter');
		this.filterBar.hidden = true;
		this.root.appendChild(this.filterBar);

		// The list mixes editor tabs with collapsible tab group headers, which a tablist
		// cannot own. A tree can: headers are expandable items, tabs are selectable items.
		this.tabsContainer = $('.vertical-tabs-list', {
			role: 'tree',
			'aria-orientation': 'vertical',
			'aria-multiselectable': 'true',
			'aria-label': localize('verticalTabs.ariaLabel', "Editor tabs")
		});
		this.tabsScrollbar = this._register(new ScrollableElement(this.tabsContainer, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			useShadows: false,
			scrollYToX: false
		}));
		this.root.appendChild(this.tabsScrollbar.getDomNode());

		// Shown instead of the list while the group has no editors
		const emptyState = $('.vertical-tabs-empty-state');
		const emptyMessage = $('.vertical-tabs-empty-message');
		emptyMessage.textContent = localize('verticalTabs.empty', "No open editors");
		const newFileButton = $<HTMLButtonElement>('button.vertical-tabs-empty-action');
		newFileButton.type = 'button';
		newFileButton.setAttribute('aria-label', localize('verticalTabs.newFile', "New File"));
		const newFileIcon = $('span.vertical-tabs-empty-action-icon');
		newFileIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.newFile));
		newFileIcon.setAttribute('aria-hidden', 'true');
		const newFileLabel = $('span.vertical-tabs-empty-action-label');
		newFileLabel.textContent = localize('verticalTabs.newFile', "New File");
		newFileLabel.setAttribute('aria-hidden', 'true');
		newFileButton.append(newFileIcon, newFileLabel);
		emptyState.append(emptyMessage, newFileButton);
		this.root.appendChild(emptyState);
		this.emptyStateAction = newFileButton;
		this._register(addDisposableListener(newFileButton, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.createNewFile();
		}));
		this._register(addDisposableListener(this.tabsContainer, EventType.DBLCLICK, event => {
			if (event.target === this.tabsContainer) {
				EventHelper.stop(event, true);
				this.openNewTab();
			}
		}));

		this._register(addDisposableListener(this.tabsContainer, EventType.CONTEXT_MENU, event => {
			if (event.target !== this.tabsContainer) {
				return;
			}
			EventHelper.stop(event, true);
			const anchor = new StandardMouseEvent(getWindow(this.tabsContainer!), event);
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				menuId: this.menuIds?.tabsBarContext ?? MenuId.EditorTabsBarContext,
				contextKeyService: this.contextKeyService,
				getActionsContext: () => ({ groupId: this.groupView.id }),
				getKeyBinding: action => this.getKeybinding(action),
				onHide: () => this.groupView.focus()
			});
		}));
		this._register(addDisposableListener(this.tabsContainer, EventType.MOUSE_WHEEL, event => this.onTabsMouseWheel(event)));
		this._register(addDisposableListener(this.tabsContainer, EventType.KEY_DOWN, event => this.onListKeyDown(event)));
		this._register(addDisposableListener(this.tabsContainer, EventType.FOCUS_IN, event => {
			const item = this.getItem(event.target);
			if (item) {
				this.setTabStop(item);
			}
		}));
		this._register(addDisposableListener(this.tabsContainer, EventType.DRAG_OVER, event => {
			if (event.target !== this.tabsContainer || !this.isSupportedDropTransfer(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const target = this.getBackgroundDropTarget(event);
			this.tabsContainer?.classList.toggle('drop-target-end', !target.row);
			if (target.row && target.location) {
				this.setDropTarget(target.row, target.location);
			} else {
				this.clearDropTarget();
			}
		}));
		this._register(addDisposableListener(this.tabsContainer, EventType.DRAG_LEAVE, event => {
			if (!this.tabsContainer?.contains(event.relatedTarget as Node)) {
				this.tabsContainer?.classList.remove('drop-target-end');
			}
		}));
		this._register(addDisposableListener(this.tabsContainer, EventType.DROP, event => {
			if (event.target !== this.tabsContainer) {
				return;
			}
			this.tabsContainer?.classList.remove('drop-target-end');
			const target = this.getBackgroundDropTarget(event);
			void this.drop(event, target.index, null, target.sticky);
		}));
		this._register(addDisposableListener(this.toolbar, EventType.DBLCLICK, event => {
			if (event.target === this.toolbar) {
				EventHelper.stop(event, true);
				this.openNewTab();
			}
		}));

		return this.root;
	}

	/** Opens a new untitled file in this group using the regular command. */
	private createNewFile(): void {
		this.groupsView.activateGroup(this.groupView);
		void this.commandService.executeCommand(NEW_UNTITLED_FILE_COMMAND_ID);
	}

	private openNewTab(): void {
		void this.editorService.openEditor({
			resource: undefined,
			options: { pinned: true, index: this.groupView.count, override: DEFAULT_EDITOR_ASSOCIATION.id }
		}, this.groupView.id);
	}

	private get isFiltering(): boolean {
		return this.filterQuery.trim().length > 0;
	}

	/**
	 * Whether the list shows a tab group collapsed. While filtering, the groups that were
	 * collapsed when the filter started list their matching tabs until they are collapsed again.
	 */
	private isTabGroupCollapsedInList(group: IEditorTabGroup): boolean {
		return group.collapsed && !(this.isFiltering && this.tabGroupsExpandedByFilter.has(group.id));
	}

	/** What the quick filter leaves in the list, or `undefined` while it filters nothing. */
	private getFilterResult(editors: readonly EditorInput[]): IVerticalTabsFilterResult | undefined {
		if (!this.isFiltering) {
			return undefined;
		}

		const tabGroupsEnabled = this.groupsView.partOptions.tabGroups.enabled;
		return filterVerticalTabs(
			this.filterQuery,
			editors.map(editor => ({
				name: editor.getName(),
				description: editor.getDescription(Verbosity.MEDIUM),
				tabGroupId: tabGroupsEnabled ? this.tabsModel.getTabGroupForEditor(editor)?.id : undefined
			})),
			tabGroupsEnabled ? this.tabsModel.tabGroups.map(group => ({ id: group.id, name: getTabGroupName(group) })) : []
		);
	}

	private isFilterVisible(): boolean {
		return !!this.filterBar && !this.filterBar.hidden;
	}

	/** Shows the quick filter above the list, or hides it again together with its query. */
	private toggleFilter(): void {
		if (this.isFilterVisible()) {
			this.closeFilter();
		} else {
			this.revealFilter();
		}
	}

	/** Shows the quick filter above the list, if it is not showing yet, and moves keyboard focus into its input. */
	revealFilter(): void {
		const bar = this.filterBar;
		if (!bar || this.compact) {
			return; // the compact rail has no room for it
		}

		const input = this.filterInput ?? this.createFilterInput(bar);
		bar.hidden = false;
		this.filterAction?.setAttribute('aria-pressed', 'true');
		this.layoutScrollbar();
		input.focus();
		input.select();
	}

	private createFilterInput(bar: HTMLElement): InputBox {
		const inputContainer = $('.vertical-tabs-filter-input');
		bar.appendChild(inputContainer);
		const input = this.filterInput = this._register(new InputBox(inputContainer, this.contextViewService, {
			placeholder: localize('verticalTabs.filterPlaceholder', "Filter by name or path"),
			ariaLabel: localize('verticalTabs.filterAriaLabel', "Filter editor tabs by name or path"),
			inputBoxStyles: defaultInputBoxStyles
		}));
		this._register(input.onDidChange(value => this.onFilterQueryChanged(value)));
		this._register(addDisposableListener(input.inputElement, EventType.KEY_DOWN, event => this.onFilterKeyDown(event)));

		const closeButton = $<HTMLButtonElement>('button.vertical-tabs-toolbar-button.vertical-tabs-filter-close');
		closeButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		closeButton.type = 'button';
		closeButton.setAttribute('aria-label', localize('verticalTabs.closeFilter', "Close Tab Filter"));
		bar.appendChild(closeButton);
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), closeButton, localize('verticalTabs.closeFilter', "Close Tab Filter")));
		this._register(addDisposableListener(closeButton, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.closeFilter();
		}));

		return input;
	}

	/** Hides the quick filter and its query, so the list shows all tabs again, and brings keyboard focus back to the list. */
	private closeFilter(): void {
		const bar = this.filterBar;
		if (!bar || bar.hidden) {
			return;
		}

		const activeElement = this.root ? getWindow(this.root).document.activeElement : null;
		const hadFocus = !!activeElement && !!this.root?.contains(activeElement) && !this.toolbar?.contains(activeElement); // the toolbar button that toggled the filter does not count
		this.filterQuery = '';
		this.tabGroupsExpandedByFilter.clear();
		if (this.filterInput) {
			this.filterInput.value = '';
		}
		bar.hidden = true;
		this.filterAction?.setAttribute('aria-pressed', 'false');
		this.redraw();
		if (hadFocus) {
			const activeRow = this.tabsModel.activeEditor ? this.tabs.get(this.tabsModel.activeEditor)?.element : undefined;
			const item = activeRow ?? this.getItems()[0];
			item?.focus();
			this.setTabStop(item);
		}
	}

	private onFilterQueryChanged(query: string): void {
		if (query === this.filterQuery) {
			return;
		}

		const wasFiltering = this.isFiltering;
		this.filterQuery = query;
		if (!wasFiltering && this.isFiltering) {
			// A new filter lists the matching tabs of collapsed tab groups too, without changing the groups
			this.tabGroupsExpandedByFilter.clear();
			for (const group of this.tabsModel.tabGroups) {
				if (group.collapsed) {
					this.tabGroupsExpandedByFilter.add(group.id);
				}
			}
		}
		this.redraw();

		const editors = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL);
		const matching = this.getFilterResult(editors)?.tabs.size;
		if (matching !== undefined) {
			status(matching === 0 ? localize('verticalTabs.filterNoMatches', "No matching tabs") : localize('verticalTabs.filterMatches', "{0} of {1} tabs match", matching, editors.length));
		}
	}

	private onFilterKeyDown(event: KeyboardEvent): void {
		const keyboardEvent = new StandardKeyboardEvent(event);
		if (keyboardEvent.equals(KeyCode.Escape)) {
			EventHelper.stop(event, true);
			this.closeFilter();
		} else if (keyboardEvent.equals(KeyCode.DownArrow)) {
			EventHelper.stop(event, true);
			this.focusItem(this.getItems()[0]); // into the results
		} else if (keyboardEvent.equals(KeyCode.Enter)) {
			const firstTab = this.getItems().find(item => this.getEditorOfRow(item));
			if (firstTab) {
				EventHelper.stop(event, true);
				this.focusItem(firstTab); // opens the first match
			}
		}
	}

	/**
	 * Rebuilds the whole list. Only structural changes (editors or tab groups being
	 * added, removed or moved, option changes) warrant this; everything else updates
	 * the affected row in place. Focus stays on the row (or header) that had it.
	 */
	private redraw(): void {
		if (!this.tabsContainer) {
			return;
		}

		const restoreFocus = this.captureFocus();

		this.rowDisposables.clearAndDisposeAll();
		this.tabResourceLabels.clear();
		this.tabs.clear();
		this.tabGroupHeaders.clear();
		clearNode(this.tabsContainer);

		const editors = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL);
		this.renderedTabGroups.clear();
		const tabGroupsEnabled = this.groupsView.partOptions.tabGroups.enabled;
		const filter = this.getFilterResult(editors);
		const showPinnedSection = !filter && this.groupsView.partOptions.pinnedTabsOnSeparateRow && this.tabsModel.stickyCount > 0;
		for (let index = 0; index < editors.length; index++) {
			const editor = editors[index];
			if (showPinnedSection && index === 0) {
				this.tabsContainer.appendChild(this.createSectionLabel(localize('verticalTabs.pinned', "Pinned"), 0, true));
			} else if (showPinnedSection && index === this.tabsModel.stickyCount) {
				this.tabsContainer.appendChild(this.createSectionLabel(localize('verticalTabs.editors', "Editors"), this.tabsModel.stickyCount, false));
			}

			const filterMatches = filter?.tabs.get(index);
			if (filter && !filterMatches) {
				continue; // the filter leaves the tab out
			}

			const tabGroup = tabGroupsEnabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
			const collapsed = !!tabGroup && this.isTabGroupCollapsedInList(tabGroup); // a filter lists the matching tabs of a collapsed group without changing the group
			const transition = tabGroup ? this.tabGroupTransitions.get(tabGroup.id) : undefined;
			if (tabGroup && !this.renderedTabGroups.has(tabGroup.id)) {
				const header = this.createTabGroupHeader(tabGroup, editors, collapsed, filter?.tabGroups.get(tabGroup.id));
				if (transition) {
					header.classList.add(transition.kind === 'expand' ? 'expanding' : 'collapsing');
				}
				this.tabsContainer.appendChild(header);
				this.renderedTabGroups.set(tabGroup.id, collapsed);
			}

			if (collapsed && !this.tabsModel.isActive(editor)) {
				const exitingRow = transition?.exitingRows.get(editor);
				if (exitingRow) {
					this.tabsContainer.appendChild(this.animateExitingRow(exitingRow));
				}
				continue;
			}

			const row = this.createTab(editor, filterMatches);
			if (transition?.kind === 'expand' && !transition.existing.has(editor)) {
				this.animateEnteringRow(row);
			}
			this.tabsContainer.appendChild(row);
		}

		if (filter?.tabs.size === 0) {
			const message = $('.vertical-tabs-filter-empty', { 'aria-hidden': 'true' }); // the filter announces the result
			message.textContent = localize('verticalTabs.filterNoMatches', "No matching tabs");
			this.tabsContainer.appendChild(message);
		}

		this.root?.classList.toggle('empty', editors.length === 0);
		this.root?.classList.toggle('no-file-icons', !this.groupsView.partOptions.hasIcons); // follows the file icon theme, which updates the part options and so redraws the list
		this.updateEditorActionsToolbar();
		this.layoutScrollbar();
		this.revealActiveTab();
		restoreFocus?.();
		this.updateItemPositions();
		this.updateTabStop();
	}

	/**
	 * Remembers which row or header holds keyboard focus and returns a callback that
	 * puts it back on the rebuilt element. When the focused editor or tab group is
	 * gone the active editor's row takes over, so focus is not dropped onto the body.
	 */
	private captureFocus(): (() => void) | undefined {
		const container = this.tabsContainer;
		const activeElement = container ? getWindow(container).document.activeElement : null;
		if (!container || !activeElement || !container.contains(activeElement)) {
			return undefined;
		}

		const activeEditorRow = () => this.tabsModel.activeEditor ? this.tabs.get(this.tabsModel.activeEditor)?.element : undefined;

		for (const [editor, tab] of this.tabs) {
			if (tab.element.contains(activeElement)) {
				return () => (this.tabs.get(editor)?.element ?? activeEditorRow())?.focus();
			}
		}

		const tabGroupId = activeElement.closest<HTMLElement>('.vertical-tab-group-header')?.dataset.tabGroupId;
		if (tabGroupId) {
			return () => (this.tabGroupHeaders.get(tabGroupId)?.element ?? activeEditorRow())?.focus();
		}

		return undefined;
	}

	/** Redraws the list and animates the tab groups that it now shows collapsed or expanded. */
	private redrawAnimatingTabGroups(): void {
		this.tabGroupTransitions = this.captureTabGroupTransitions();
		try {
			this.redraw();
		} finally {
			this.tabGroupTransitions = new Map();
		}
	}

	/**
	 * Finds the tab groups that the change about to be drawn collapses or expands in the list and
	 * takes what the animation needs from the rows that are still on screen: the editors that
	 * had a row and copies of the rows that a collapse removes. Nothing animates while motion
	 * is reduced.
	 */
	private captureTabGroupTransitions(): ReadonlyMap<string, IVerticalTabGroupTransition> {
		const transitions = new Map<string, IVerticalTabGroupTransition>();
		if (this.isMotionReduced()) {
			return transitions;
		}

		for (const group of this.tabsModel.tabGroups) {
			const collapsed = this.isTabGroupCollapsedInList(group);
			const wasCollapsed = this.renderedTabGroups.get(group.id);
			if (wasCollapsed === undefined || wasCollapsed === collapsed) {
				continue; // not drawn before, or drawn in the state that it is in now
			}

			const exitingRows = new Map<EditorInput, HTMLElement>();
			if (collapsed) {
				for (const [editor, tab] of this.tabs) {
					if (this.tabsModel.getTabGroupForEditor(editor)?.id === group.id && !this.tabsModel.isActive(editor)) {
						exitingRows.set(editor, tab.element.cloneNode(true) as HTMLElement); // taken now, the redraw replaces the rows
					}
				}
			}

			transitions.set(group.id, { kind: collapsed ? 'collapse' : 'expand', existing: new Set(this.tabs.keys()), exitingRows });
		}

		return transitions;
	}

	/** Lets a row that an expanding tab group reveals grow into place. */
	private animateEnteringRow(row: HTMLElement): void {
		if (this.isMotionReduced()) {
			return;
		}

		row.classList.add('entering');
		this.rowDisposables.get(row)?.add(addDisposableListener(row, EventType.ANIMATION_END, event => {
			if (event.target !== row) {
				return; // an animation of a nested element
			}
			row.classList.remove('entering');
			this.layoutScrollbar();
		}));
	}

	/**
	 * Keeps a copy of a row that a collapsing tab group hides in place while it shrinks away.
	 * The copy is inert and removed as soon as its animation is over.
	 */
	private animateExitingRow(row: HTMLElement): HTMLElement {
		row.classList.add('exiting');
		row.removeAttribute('tabindex');
		row.removeAttribute('draggable');
		row.setAttribute('aria-hidden', 'true');
		row.inert = true;

		const disposables = this.registerRow(row);
		const remove = () => {
			this.rowDisposables.deleteAndDispose(row);
			row.remove();
			this.layoutScrollbar();
		};
		disposables.add(addDisposableListener(row, EventType.ANIMATION_END, event => {
			if (event.target === row) {
				remove();
			}
		}));
		disposables.add(disposableTimeout(remove, 400)); // in case the animation never runs, e.g. in a hidden window

		return row;
	}

	private registerRow(element: HTMLElement): DisposableStore {
		const disposables = new DisposableStore();
		this.rowDisposables.set(element, disposables);
		return disposables;
	}

	private createSectionLabel(label: string, targetEditorIndex: number, sticky: boolean): HTMLElement {
		const element = $('.vertical-tabs-section-label', { 'aria-hidden': 'true' });
		const disposables = this.registerRow(element);
		element.textContent = label;
		disposables.add(addDisposableListener(element, EventType.DRAG_OVER, event => {
			if (!this.isSupportedDropTransfer(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.setDropTarget(element, 'before');
		}));
		disposables.add(addDisposableListener(element, EventType.DRAG_LEAVE, event => {
			if (!element.contains(event.relatedTarget as Node)) {
				this.clearDropTarget();
			}
		}));
		disposables.add(addDisposableListener(element, EventType.DROP, event => void this.drop(event, targetEditorIndex, null, sticky)));
		return element;
	}

	/**
	 * A plain wheel always scrolls the list natively while it overflows, so a long
	 * list stays reachable. Tabs only switch when there is nothing to scroll (and
	 * the setting asks for it) or while Shift is held.
	 */
	private shouldSwitchTabsOnWheel(shiftKey: boolean): boolean {
		return shiftKey || (this.groupsView.partOptions.scrollToSwitchTabs && !this.isListOverflowing());
	}

	private isListOverflowing(): boolean {
		if (!this.tabsScrollbar) {
			return false;
		}

		const { height, scrollHeight } = this.tabsScrollbar.getScrollDimensions();
		return scrollHeight > height;
	}

	private onTabsMouseWheel(event: WheelEvent): void {
		const activeEditor = this.groupView.activeEditor;
		if (!activeEditor || this.groupView.count < 2) {
			return;
		}

		if (!this.shouldSwitchTabsOnWheel(event.shiftKey)) {
			return;
		}

		// Chromium reports a Shift+wheel as a horizontal scroll, so both axes count
		const delta = event.deltaX + event.deltaY;
		const now = Date.now();
		if (now - this.lastMouseWheelEventTime < 150 - 2 * (Math.abs(event.deltaX) + Math.abs(event.deltaY)) || Math.abs(delta) <= 1.5) {
			return;
		}
		this.lastMouseWheelEventTime = now;

		const visibleEditors = this.getVisibleEditors();
		const target = visibleEditors[visibleEditors.indexOf(activeEditor) + (delta < 0 ? -1 : 1)];
		if (target) {
			EventHelper.stop(event, true);
			void this.groupView.openEditor(target);
		}
	}

	private createTabGroupHeader(group: IEditorTabGroup, editors: readonly EditorInput[], collapsed: boolean, nameMatches: readonly IMatch[] | undefined): HTMLElement {
		const members = editors.filter(editor => this.tabsModel.getTabGroupForEditor(editor)?.id === group.id);
		const header = $('.vertical-tab-group-header', {
			role: 'treeitem',
			tabindex: -1,
			draggable: !group.locked,
			'aria-level': 1,
			'aria-expanded': String(!collapsed)
		});
		const disposables = this.registerRow(header);
		header.dataset.tabGroupId = group.id;
		header.classList.toggle('collapsed', collapsed);
		header.classList.toggle('saved', group.saved);
		header.classList.toggle('locked', group.locked);
		header.style.setProperty('--tab-group-color', getEditorTabGroupColor(group.color));

		// The twistie always shows the same icon and turns when the group collapses (see the stylesheet)
		const twistie = $('span.vertical-tab-group-twistie', { 'aria-hidden': 'true' });
		twistie.classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronDown));
		header.appendChild(twistie);
		const colorDot = $('span.vertical-tab-group-color-dot');
		colorDot.setAttribute('aria-hidden', 'true');
		header.appendChild(colorDot);

		if (group.icon) {
			const icon = $('span.vertical-tab-group-icon');
			icon.classList.add(...ThemeIcon.asClassNameArray(resolveEditorTabGroupIcon(group.icon)));
			icon.setAttribute('aria-hidden', 'true');
			header.appendChild(icon);
		}

		if (group.saved) {
			const savedIndicator = $('span.vertical-tab-group-saved');
			savedIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.bookmark));
			savedIndicator.setAttribute('aria-hidden', 'true');
			header.appendChild(savedIndicator);
		}

		// The dirty indicator is attached by `updateStatus` while any member has unsaved changes
		const dirtyIndicator = $('span.vertical-tab-group-dirty');
		dirtyIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.circleFilled));
		dirtyIndicator.setAttribute('aria-hidden', 'true');

		let lockIndicator: HTMLElement | undefined;
		if (group.locked) {
			lockIndicator = $('span.vertical-tab-group-lock');
			lockIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.lockSmall));
			lockIndicator.setAttribute('aria-hidden', 'true');
			header.appendChild(lockIndicator);
		}

		const label = getTabGroupName(group);
		const name = $('span.vertical-tab-group-name');
		if (nameMatches?.length) {
			disposables.add(new HighlightedLabel(name)).set(label, nameMatches);
		} else {
			name.textContent = label;
		}
		header.appendChild(name);
		const dirtyIndicatorAnchor = lockIndicator ?? name;

		const count = $('span.vertical-tab-group-count');
		count.textContent = String(members.length);
		header.appendChild(count);

		const hover = disposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), header, ''));
		const updateStatus = () => {
			const dirtyCount = members.filter(editor => editor.isDirty() && !editor.isSaving()).length;
			if (dirtyCount > 0) {
				header.insertBefore(dirtyIndicator, dirtyIndicatorAnchor); // the header hover reports the unsaved count
			} else {
				dirtyIndicator.remove();
			}

			const details = { count: members.length, dirtyCount };
			header.setAttribute('aria-label', getTabGroupHeaderAriaLabel(group, details)); // aria-expanded announces the state
			hover.update(getTabGroupHeaderTitle(group, details));
		};
		updateStatus();
		this.tabGroupHeaders.set(group.id, { element: header, updateStatus });

		disposables.add(addDisposableListener(header, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.toggleTabGroup(group);
		}));
		disposables.add(addDisposableListener(header, EventType.CONTEXT_MENU, event => {
			EventHelper.stop(event, true);
			this.showTabGroupContextMenu(group, header, event);
		}));
		disposables.add(addDisposableListener(header, EventType.DRAG_OVER, event => {
			const draggedGroup = this.getDraggedTabGroup();
			if (draggedGroup) {
				if (draggedGroup.sourceGroupId === this.groupView.id && draggedGroup.tabGroup.id === group.id) {
					event.stopPropagation();
					if (event.dataTransfer) {
						event.dataTransfer.dropEffect = 'none';
					}
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'move';
				}
				this.setDropTarget(header, this.getTabDragOverLocation(event, header));
				return;
			}

			if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
				const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
				if (!Array.isArray(data) || data.length === 0) {
					return;
				}
				event.stopPropagation();
				if (data[0].identifier === this.groupView.id) {
					if (event.dataTransfer) {
						event.dataTransfer.dropEffect = 'none';
					}
					return;
				}
				event.preventDefault();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = this.isMoveOperation(event, data[0].identifier) ? 'move' : 'copy';
				}
				this.setDropTarget(header, this.getTabDragOverLocation(event, header));
				return;
			}

			if (!this.getDraggedEditors()?.length) {
				return;
			}
			event.stopPropagation();
			if (group.locked) {
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}
			event.preventDefault();
			this.setDropTarget(header, 'into');
		}));
		disposables.add(addDisposableListener(header, EventType.DRAG_LEAVE, event => {
			if (!header.contains(event.relatedTarget as Node)) {
				this.clearDropTarget();
			}
		}));
		disposables.add(addDisposableListener(header, EventType.DROP, event => {
			const firstMember = members[0];
			if (!firstMember) {
				return;
			}
			const draggedGroup = this.getDraggedTabGroup();
			if (draggedGroup) {
				const memberIndexes = members.map(member => this.groupView.getIndexOfEditor(member));
				const location = this.getTabDragOverLocation(event, header);
				void this.dropTabGroup(event, location === 'before' ? Math.min(...memberIndexes) : Math.max(...memberIndexes) + 1);
				return;
			}
			if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
				const memberIndexes = members.map(member => this.groupView.getIndexOfEditor(member));
				const location = this.getTabDragOverLocation(event, header);
				void this.drop(event, location === 'before' ? Math.min(...memberIndexes) : Math.max(...memberIndexes) + 1, null, false);
				return;
			}
			if (group.locked) {
				return;
			}
			const lastMemberIndex = members.reduce((index, member) => Math.max(index, this.groupView.getIndexOfEditor(member)), -1);
			void this.dropEditors(event, lastMemberIndex + 1, group.id, false);
		}));
		disposables.add(addDisposableListener(header, EventType.DRAG_START, event => {
			event.stopPropagation();
			if (group.locked) {
				event.preventDefault();
				return;
			}
			this.tabGroupTransfer.setData([new DraggedEditorTabGroupIdentifier({ sourceGroupId: this.groupView.id, tabGroup: { ...group } })], DraggedEditorTabGroupIdentifier.prototype);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('application/x-vscode-vertical-tab-group', group.id);
				applyDragImage(event, header, label);
			}
			header.classList.add('dragged');
		}));
		disposables.add(addDisposableListener(header, EventType.DRAG_END, () => {
			header.classList.remove('dragged');
			this.clearDropTarget();
			this.tabGroupTransfer.clearData(DraggedEditorTabGroupIdentifier.prototype);
		}));

		return header;
	}

	private showTabGroupContextMenu(group: IEditorTabGroup, header: HTMLElement, event: Event): void {
		new TabGroupContextMenu(this.groupView, this.editorPartsView, this.contextViewService, this.editorService, this.historyService, this.tabsContainer ?? header.parentElement ?? header).show(group, header, event);
	}

	private toggleTabGroup(group: IEditorTabGroup): void {
		this.setTabGroupCollapsed(group, !this.isTabGroupCollapsedInList(group));
	}

	private setTabGroupCollapsed(group: IEditorTabGroup, collapsed: boolean): void {
		if (collapsed && group.collapsed && this.isFiltering && this.tabGroupsExpandedByFilter.delete(group.id)) {
			this.redrawAnimatingTabGroups(); // collapsed in the model all along, only the filter listed its tabs
			return;
		}

		this.groupView.setTabGroupCollapsed(group.id, collapsed); // the model change redraws the list and animates it
	}

	private createTab(editor: EditorInput, filterMatches: IVerticalTabsFilterMatches | undefined): HTMLElement {
		const row = $('.vertical-tab', { role: 'treeitem', tabindex: -1, draggable: true });
		const disposables = this.registerRow(row);
		const tabGroup = this.groupsView.partOptions.tabGroups.enabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
		row.setAttribute('aria-level', tabGroup ? '2' : '1');
		if (tabGroup) {
			row.classList.add('in-tab-group');
			row.style.setProperty('--tab-group-color', getEditorTabGroupColor(tabGroup.color));
		}

		const label = disposables.add(this.tabResourceLabels.create(row, { hoverTargetOverride: row, supportHighlights: true, supportDescriptionHighlights: true }));
		const fallbackIcon = $('span.vertical-tab-fallback-icon', { 'aria-hidden': 'true' });
		row.appendChild(fallbackIcon);
		// The row is the only Tab stop: its actions are reached with the keyboard through
		// the Delete key and the context menu, so they stay out of the focus order and
		// are not announced as nested controls.
		const actionsContainer = $('.vertical-tab-actions', { 'aria-hidden': 'true' });
		row.appendChild(actionsContainer);
		const dirtyDot = $('.vertical-tab-dirty-dot', { 'aria-hidden': 'true' }); // only shown by the compact rendering
		dirtyDot.classList.add(...ThemeIcon.asClassNameArray(Codicon.circleFilled));
		row.appendChild(dirtyDot);
		const that = this;
		const actionRunner = disposables.add(new EditorCommandsContextActionRunner({
			groupId: this.groupView.id,
			get editorIndex() { return that.groupView.getIndexOfEditor(editor); }
		}));
		const actionBar = disposables.add(new ActionBar(actionsContainer, {
			ariaLabel: localize('verticalTabs.tabActions', "Tab actions"),
			actionRunner
		}));
		actionBar.setFocusable(false);

		const tab: IVerticalTab = { element: row, label, fallbackIcon, actionBar, filterMatches };
		this.tabs.set(editor, tab);
		this.renderTabLabel(editor, tab);
		this.renderTabActions(editor, tab);
		this.updateTabState(editor, row);
		this.registerTabListeners(editor, row, actionsContainer, disposables);

		return row;
	}

	private renderTabLabel(editor: EditorInput, tab: IVerticalTab): void {
		tab.label.setResource({
			resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }),
			name: editor.getName(),
			description: tab.filterMatches ? editor.getDescription(Verbosity.MEDIUM) : undefined // the path shows while filtering, to tell why a tab matched
		}, {
			matches: tab.filterMatches?.name,
			descriptionMatches: tab.filterMatches?.description,
			title: this.getHoverTitle(editor),
			italic: !this.tabsModel.isPinned(editor),
			extraClasses: ['vertical-tab-label', ...editor.getLabelExtraClasses()],
			fileDecorations: {
				colors: this.groupsView.partOptions.decorations.colors,
				badges: this.groupsView.partOptions.decorations.badges
			},
			icon: editor.getIcon(),
			hideIcon: !this.groupsView.partOptions.showIcons && !this.compact // the compact rendering has nothing but the icon to identify a tab
		});

		// Without a file icon theme that has file icons the label paints no icon, which would leave
		// compact rows blank. The fallback shows the icon of the editor, or a plain file.
		const editorIcon = editor.getIcon();
		tab.fallbackIcon.className = `vertical-tab-fallback-icon ${ThemeIcon.asClassName(ThemeIcon.isThemeIcon(editorIcon) ? editorIcon : Codicon.file)}`;

		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			tab.element.dataset.resourceName = basenameOrAuthority(resource);
		} else {
			delete tab.element.dataset.resourceName;
		}
	}

	private renderTabActions(editor: EditorInput, tab: IVerticalTab): void {
		tab.actionBar.clear();
		const action = this.tabsModel.isSticky(editor) && this.groupsView.partOptions.tabActionUnpinVisibility ? this.unpinEditorAction : this.closeEditorAction;
		if ((action === this.unpinEditorAction || !editor.hasCapability(EditorInputCapabilities.CannotClose)) && (action === this.unpinEditorAction || this.groupsView.partOptions.tabActionCloseVisibility)) {
			tab.actionBar.push(action, { icon: true, label: false, keybinding: this.getKeybindingLabel(action) });
		}
	}

	/**
	 * Refreshes a single row after a non-structural change (dirty, label, pinned,
	 * capabilities) without recreating it, so hovers and keyboard focus survive.
	 */
	private updateTab(editor: EditorInput): void {
		const tab = this.tabs.get(editor);
		if (!tab) {
			if (this.getVisibleEditors().includes(editor)) {
				this.redraw(); // an editor that should be listed has no row yet
			}
			return;
		}

		this.renderTabLabel(editor, tab);
		this.renderTabActions(editor, tab);
		this.updateTabState(editor, tab.element);
	}

	private updateTabState(editor: EditorInput, row: HTMLElement): void {
		const active = this.tabsModel.isActive(editor);
		const selected = this.tabsModel.isSelected(editor);
		row.classList.toggle('active', active);
		row.classList.toggle('selected', selected);
		row.classList.toggle('dirty', editor.isDirty() && !editor.isSaving());
		row.classList.toggle('sticky', this.tabsModel.isSticky(editor));
		row.classList.toggle('actions-left', this.groupsView.partOptions.tabActionLocation === 'left');
		row.setAttribute('aria-selected', String(selected));

		// Tell screen readers which tab group a tab is in, and whether it is the one tab of a collapsed group that remains listed
		const ariaLabel = computeEditorAriaLabel(editor, this.groupView.getIndexOfEditor(editor), this.groupView, this.editorPartsView.count);
		const tabGroup = this.groupsView.partOptions.tabGroups.enabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
		row.setAttribute('aria-label', tabGroup ? getTabGroupTabAriaLabel(ariaLabel, tabGroup, this.isTabGroupCollapsedInList(tabGroup)) : ariaLabel);
	}

	/**
	 * Gives every item its position within its level of the tree, which is the set screen
	 * readers count in: tab group headers and the tabs outside of groups form the first level,
	 * the tabs of a group form the second level below its header (including the tabs that a
	 * collapsed group hides, but not the ones that a filter leaves out). Positions only change
	 * with the structure, i.e. on a redraw.
	 */
	private updateItemPositions(): void {
		const tabGroupMembers = new Map<string, EditorInput[]>();
		if (this.groupsView.partOptions.tabGroups.enabled) {
			const editors = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL);
			const filter = this.getFilterResult(editors);
			editors.forEach((editor, index) => {
				const tabGroup = this.tabsModel.getTabGroupForEditor(editor);
				if (tabGroup && (!filter || filter.tabs.has(index))) { // the members that the filter leaves out are not in the list
					const members = tabGroupMembers.get(tabGroup.id) ?? [];
					members.push(editor);
					tabGroupMembers.set(tabGroup.id, members);
				}
			});
		}

		const topLevelItems = this.getItems().filter(item => !item.classList.contains('in-tab-group'));
		for (let index = 0; index < topLevelItems.length; index++) {
			topLevelItems[index].setAttribute('aria-posinset', String(index + 1));
			topLevelItems[index].setAttribute('aria-setsize', String(topLevelItems.length));
		}

		for (const [editor, tab] of this.tabs) {
			const members = tab.element.classList.contains('in-tab-group') ? tabGroupMembers.get(this.tabsModel.getTabGroupForEditor(editor)?.id ?? '') : undefined;
			if (members) {
				tab.element.setAttribute('aria-posinset', String(members.indexOf(editor) + 1));
				tab.element.setAttribute('aria-setsize', String(members.length));
			}
		}
	}

	private refreshTabStates(): void {
		const visibleEditors = this.getVisibleEditors();
		if (visibleEditors.length !== this.tabs.size || visibleEditors.some(editor => !this.tabs.has(editor))) {
			this.redraw();
			return;
		}

		for (const [editor, tab] of this.tabs) {
			this.updateTabState(editor, tab.element);
		}
		this.updateTabStop();
		this.updateEditorActionsToolbar();
		this.revealActiveTab();
	}

	private registerTabListeners(editor: EditorInput, row: HTMLElement, actionsContainer: HTMLElement, disposables: DisposableStore): void {
		let openOnMouseUp = false;

		disposables.add(addDisposableListener(row, EventType.DBLCLICK, event => {
			if (actionsContainer.contains(event.target as Node)) {
				return;
			}
			EventHelper.stop(event, true);
			if (!this.tabsModel.isPinned(editor)) {
				this.groupView.pinEditor(editor);
				return;
			}
			switch (this.groupsView.partOptions.doubleClickTabToToggleEditorGroupSizes) {
				case 'maximize':
					this.groupsView.toggleMaximizeGroup(this.groupView);
					break;
				case 'expand':
					this.groupsView.toggleExpandGroup(this.groupView);
					break;
			}
		}));
		disposables.add(addDisposableListener(actionsContainer, EventType.MOUSE_DOWN, event => EventHelper.stop(event, false)));
		disposables.add(addDisposableListener(row, EventType.MOUSE_DOWN, async event => {
			openOnMouseUp = false;
			if (event.button !== 0 || actionsContainer.contains(event.target as Node)) {
				return;
			}
			event.stopPropagation();
			if (event.shiftKey) {
				const anchor = this.lastSingleSelectSelectedEditor && this.tabsModel.isSelected(this.lastSingleSelectSelectedEditor) ? this.lastSingleSelectSelectedEditor : assertReturnsDefined(this.groupView.activeEditor);
				this.lastSingleSelectSelectedEditor = anchor;
				await this.selectEditorsBetween(editor, anchor);
			} else if ((event.ctrlKey && !isMacintosh) || (event.metaKey && isMacintosh)) {
				if (this.tabsModel.isSelected(editor)) {
					await this.unselectEditor(editor);
				} else {
					await this.selectEditor(editor);
					this.lastSingleSelectSelectedEditor = editor;
				}
			} else {
				openOnMouseUp = true;
			}
		}));
		disposables.add(addDisposableListener(row, EventType.MOUSE_UP, async event => {
			if (event.button !== 0 || (isMacintosh && event.ctrlKey) || actionsContainer.contains(event.target as Node)) {
				return;
			}
			if (openOnMouseUp) {
				openOnMouseUp = false;
				const inactiveSelection = this.tabsModel.isSelected(editor) ? this.groupView.selectedEditors.filter(selectedEditor => !selectedEditor.matches(editor)) : [];
				await this.groupView.openEditor(editor, { activation: EditorActivation.ACTIVATE }, { inactiveSelection, focusTabControl: true });
			}
			const isCtrlCmd = (event.ctrlKey && !isMacintosh) || (event.metaKey && isMacintosh);
			if (!isCtrlCmd && !event.shiftKey) {
				await this.unselectAllEditors();
			}
		}));
		disposables.add(addDisposableListener(row, EventType.AUXCLICK, event => {
			if (event.button !== 1 || editor.hasCapability(EditorInputCapabilities.CannotClose) || preventEditorClose(this.tabsModel, editor, EditorCloseMethod.MOUSE, this.groupsView.partOptions)) {
				return;
			}
			EventHelper.stop(event, true);
			void this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) });
		}));
		disposables.add(addDisposableListener(row, EventType.CONTEXT_MENU, event => {
			EventHelper.stop(event, true);
			this.onTabContextMenu(editor, event, row);
		}));
		disposables.add(new DragAndDropObserver(row, {
			onDragStart: event => {
				openOnMouseUp = false;
				this.onTabDragStart(editor, row, event);
			},
			onDragEnter: event => this.onTabDragOver(editor, row, event),
			onDragOver: event => this.onTabDragOver(editor, row, event),
			onDragLeave: () => this.clearDropTarget(),
			onDrop: event => {
				const location = this.getTabDragOverLocation(event, row);
				const targetIndex = this.groupView.getIndexOfEditor(editor) + (location === 'after' ? 1 : 0);
				void this.drop(event, targetIndex, this.getTargetTabGroupId(editor), this.tabsModel.isSticky(editor));
			},
			onDragEnd: () => {
				row.classList.remove('dragged');
				this.clearDropTarget();
				this.verticalEditorTransfer.clearData(DraggedVerticalEditorIdentifier.prototype);
			}
		}));
	}

	private onTabDragStart(editor: EditorInput, row: HTMLElement, event: DragEvent): void {
		const editors = this.tabsModel.isSelected(editor) ? this.groupView.selectedEditors : [editor];
		this.verticalEditorTransfer.setData(editors.map(draggedEditor => new DraggedVerticalEditorIdentifier({ editor: draggedEditor, groupId: this.groupView.id })), DraggedVerticalEditorIdentifier.prototype);
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('application/x-vscode-vertical-tab', editor.getName());
			const rect = row.getBoundingClientRect();
			event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
		}
		row.classList.add('dragged');
	}

	private onTabDragOver(editor: EditorInput, row: HTMLElement, event: DragEvent): void {
		const draggedGroup = this.getDraggedTabGroup();
		if (draggedGroup) {
			const targetGroup = this.tabsModel.getTabGroupForEditor(editor);
			if (draggedGroup.sourceGroupId === this.groupView.id && targetGroup?.id === draggedGroup.tabGroup.id) {
				event.stopPropagation();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move';
			}
			this.setDropTarget(row, this.getTabDragOverLocation(event, row));
			return;
		}

		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (!Array.isArray(data) || data.length === 0) {
				return;
			}
			if (data[0].identifier === this.groupView.id) {
				event.stopPropagation();
				if (event.dataTransfer) {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = this.isMoveOperation(event, data[0].identifier) ? 'move' : 'copy';
			}
			this.setDropTarget(row, this.getTabDragOverLocation(event, row));
			return;
		}

		const data = this.getDraggedEditors();
		if (Array.isArray(data) && data.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = this.isMoveOperation(event, data[0].identifier.groupId, data[0].identifier.editor) ? 'move' : 'copy';
			}
			this.setDropTarget(row, this.getTabDragOverLocation(event, row));
			return;
		}

		if (event.dataTransfer && event.dataTransfer.types.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = 'copy';
			this.setDropTarget(row, this.getTabDragOverLocation(event, row));
		}
	}

	private isSupportedDropTransfer(event: DragEvent): boolean {
		if (this.getDraggedTabGroup() || this.getDraggedEditors()?.length) {
			return true;
		}

		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			return Array.isArray(data) && data.length > 0;
		}

		return !!event.dataTransfer?.types.length;
	}

	private getTabDragOverLocation(event: DragEvent, row: HTMLElement): 'before' | 'after' {
		const rect = row.getBoundingClientRect();
		return event.clientY - rect.top <= rect.height / 2 ? 'before' : 'after';
	}

	private getTargetTabGroupId(editor: EditorInput): string | null {
		if (!this.groupsView.partOptions.tabGroups.enabled) {
			return null;
		}

		const tabGroup = this.tabsModel.getTabGroupForEditor(editor);
		return tabGroup && !tabGroup.locked ? tabGroup.id : null;
	}

	private getBackgroundDropTarget(event: DragEvent): { index: number; sticky: boolean; row?: HTMLElement; location?: 'before' | 'after' } {
		for (const [editor, { element: row }] of this.tabs) {
			const rect = row.getBoundingClientRect();
			if (event.clientY >= rect.bottom) {
				continue;
			}

			const group = this.groupsView.partOptions.tabGroups.enabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
			if (group) {
				const members = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).filter(candidate => this.tabsModel.getTabGroupForEditor(candidate)?.id === group.id);
				const memberRows = members.map(member => this.tabs.get(member)?.element).filter((candidate): candidate is HTMLElement => !!candidate);
				const firstRow = memberRows[0];
				const lastRow = memberRows.at(-1);
				const before = event.clientY < ((firstRow?.getBoundingClientRect().top ?? rect.top) + (lastRow?.getBoundingClientRect().bottom ?? rect.bottom)) / 2;
				const index = before ? this.groupView.getIndexOfEditor(members[0]) : this.groupView.getIndexOfEditor(members[members.length - 1]) + 1;
				return { index, sticky: false, row: before ? firstRow : lastRow, location: before ? 'before' : 'after' };
			}

			const before = event.clientY < rect.top + rect.height / 2;
			const index = this.groupView.getIndexOfEditor(editor) + (before ? 0 : 1);
			return { index, sticky: this.tabsModel.isSticky(editor), row, location: before ? 'before' : 'after' };
		}

		return { index: this.groupView.count, sticky: false };
	}

	private setDropTarget(target: HTMLElement, location: 'before' | 'after' | 'into'): void {
		this.tabsContainer?.classList.remove('drop-target-end');
		if (this.dropTarget !== target) {
			this.clearDropTarget();
			this.dropTarget = target;
		}
		target.classList.toggle('drop-target-before', location === 'before');
		target.classList.toggle('drop-target-after', location === 'after');
		target.classList.toggle('drop-target-into', location === 'into');
	}

	private clearDropTarget(): void {
		this.dropTarget?.classList.remove('drop-target-before', 'drop-target-after', 'drop-target-into');
		this.dropTarget = undefined;
	}

	private getDraggedTabGroup(): { sourceGroupId: number; tabGroup: IEditorTabGroup } | undefined {
		const data = this.tabGroupTransfer.getData(DraggedEditorTabGroupIdentifier.prototype);
		return Array.isArray(data) ? data[0]?.identifier : undefined;
	}

	private getDraggedEditors(): DraggedEditorIdentifier[] | undefined {
		return this.verticalEditorTransfer.getData(DraggedVerticalEditorIdentifier.prototype) ?? this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
	}

	private clearDraggedEditors(): void {
		this.verticalEditorTransfer.clearData(DraggedVerticalEditorIdentifier.prototype);
		this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
	}

	private async drop(event: DragEvent, targetEditorIndex: number, targetTabGroupId: string | null, sticky?: boolean): Promise<void> {
		if (this.getDraggedTabGroup()) {
			return this.dropTabGroup(event, targetEditorIndex);
		}

		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			return this.dropEditorGroup(event, targetEditorIndex);
		}

		if (this.getDraggedEditors()?.length) {
			return this.dropEditors(event, targetEditorIndex, targetTabGroupId, sticky);
		}

		EventHelper.stop(event, true);
		this.clearDropTarget();
		const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false });
		await dropHandler.handleDrop(event, getWindow(this.parent), () => this.groupView, () => this.groupView.focus(), { index: targetEditorIndex, sticky });
	}

	private async dropEditorGroup(event: DragEvent, targetEditorIndex: number): Promise<void> {
		EventHelper.stop(event, true);
		this.clearDropTarget();
		const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
		if (!Array.isArray(data) || data.length === 0) {
			return;
		}

		const sourceGroup = this.editorPartsView.getGroup(data[0].identifier);
		if (sourceGroup && sourceGroup !== this.groupView) {
			const options: IMergeGroupOptions = { index: targetEditorIndex };
			if (!this.isMoveOperation(event, sourceGroup.id)) {
				options.mode = MergeGroupMode.COPY_EDITORS;
			}
			this.groupsView.mergeGroup(sourceGroup, this.groupView, options);
		}

		this.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
		this.groupView.focus();
	}

	private async dropTabGroup(event: DragEvent, targetEditorIndex: number): Promise<void> {
		EventHelper.stop(event, true);
		this.clearDropTarget();
		const draggedGroup = this.getDraggedTabGroup();
		if (!draggedGroup || draggedGroup.tabGroup.locked) {
			this.tabGroupTransfer.clearData(DraggedEditorTabGroupIdentifier.prototype);
			return;
		}

		const sourceGroup = this.editorPartsView.getGroup(draggedGroup.sourceGroupId);
		if (!sourceGroup || !isEditorGroupView(sourceGroup)) {
			this.tabGroupTransfer.clearData(DraggedEditorTabGroupIdentifier.prototype);
			return;
		}

		if (sourceGroup === this.groupView) {
			this.groupView.moveTabGroup(draggedGroup.tabGroup.id, targetEditorIndex);
		} else {
			const members = getTabGroupMembers(sourceGroup, draggedGroup.tabGroup.id);
			const moved = sourceGroup.moveEditors(prepareMoveCopyEditors(sourceGroup, members).map((entry, index) => ({ ...entry, options: { ...entry.options, index: targetEditorIndex + index } })), this.groupView);
			if (moved) {
				this.groupView.createTabGroup(members, draggedGroup.tabGroup.name, draggedGroup.tabGroup.color, {
					id: draggedGroup.tabGroup.id,
					collapsed: draggedGroup.tabGroup.collapsed,
					saved: draggedGroup.tabGroup.saved,
					locked: draggedGroup.tabGroup.locked,
					icon: draggedGroup.tabGroup.icon,
					metadata: draggedGroup.tabGroup.metadata
				});
			}
		}

		this.tabGroupTransfer.clearData(DraggedEditorTabGroupIdentifier.prototype);
		this.groupView.focus();
	}

	private async dropEditors(event: DragEvent, targetEditorIndex: number, targetTabGroupId: string | null, sticky?: boolean): Promise<void> {
		EventHelper.stop(event, true);
		this.clearDropTarget();

		const data = this.getDraggedEditors();
		if (!Array.isArray(data) || data.length === 0) {
			return;
		}

		const sourceGroup = this.editorPartsView.getGroup(data[0].identifier.groupId);
		if (!sourceGroup) {
			this.clearDraggedEditors();
			return;
		}

		// Tab groups are hidden while they are disabled: they must not limit or change a drop
		const tabGroupsEnabled = this.groupsView.partOptions.tabGroups.enabled;
		if (tabGroupsEnabled) {
			const targetGroup = targetTabGroupId ? this.tabsModel.tabGroups.find(group => group.id === targetTabGroupId) : undefined;
			const changesLockedGroup = data.some(item => {
				const itemSourceGroup = this.editorPartsView.getGroup(item.identifier.groupId);
				return !!itemSourceGroup && isEditorGroupView(itemSourceGroup) && itemSourceGroup.getTabGroupForEditor(item.identifier.editor)?.locked && itemSourceGroup.getTabGroupForEditor(item.identifier.editor)?.id !== targetTabGroupId;
			});
			if (changesLockedGroup || (targetGroup?.locked && data.some(item => this.tabsModel.getTabGroupForEditor(item.identifier.editor)?.id !== targetTabGroupId))) {
				this.clearDraggedEditors();
				return;
			}
		}

		const droppedEditors: EditorInput[] = [];
		for (const draggedEditor of data) {
			if (sourceGroup.id !== draggedEditor.identifier.groupId) {
				continue;
			}

			const editor = draggedEditor.identifier.editor;
			const sourceEditorIndex = sourceGroup.getIndexOfEditor(editor);
			if (sourceGroup === this.groupView && sourceEditorIndex < targetEditorIndex) {
				targetEditorIndex--;
			}

			const options: IEditorOptions = { index: targetEditorIndex, sticky };
			if (this.isMoveOperation(event, draggedEditor.identifier.groupId, editor)) {
				if (sourceGroup.moveEditor(editor, this.groupView, options)) {
					droppedEditors.push(editor);
				}
			} else {
				sourceGroup.copyEditor(editor, this.groupView, options);
				droppedEditors.push(editor);
			}

			// The next editor goes right after this one. A tab group can place an editor elsewhere than
			// requested (for example past a locked group), so continue from where it ended up.
			const droppedEditorIndex = this.groupView.getIndexOfEditor(editor);
			targetEditorIndex = droppedEditorIndex >= 0 ? droppedEditorIndex + 1 : targetEditorIndex + 1;
		}

		if (tabGroupsEnabled) {
			if (targetTabGroupId) {
				this.groupView.addToTabGroup(targetTabGroupId, droppedEditors);
			} else {
				this.groupView.removeFromTabGroup(droppedEditors);
			}
		}
		this.clearDraggedEditors();
		this.groupView.focus();
	}

	private async selectEditor(editor: EditorInput): Promise<void> {
		if (!this.groupView.isActive(editor)) {
			await this.groupView.setSelection(editor, this.groupView.selectedEditors);
		}
	}

	private async selectEditorsBetween(target: EditorInput, anchor: EditorInput): Promise<void> {
		const editorIndex = this.groupView.getIndexOfEditor(target);
		const anchorEditorIndex = this.groupView.getIndexOfEditor(anchor);
		if (editorIndex === -1 || anchorEditorIndex === -1) {
			throw new BugIndicatingError();
		}

		let selection = this.groupView.selectedEditors;
		let currentEditorIndex = anchorEditorIndex;
		while (currentEditorIndex >= 0 && currentEditorIndex < this.groupView.count) {
			currentEditorIndex = anchorEditorIndex < editorIndex ? currentEditorIndex - 1 : currentEditorIndex + 1;
			const currentEditor = this.groupView.getEditorByIndex(currentEditorIndex);
			if (!currentEditor || !this.groupView.isSelected(currentEditor)) {
				break;
			}
			selection = selection.filter(selectedEditor => !selectedEditor.matches(currentEditor));
		}

		const fromEditorIndex = Math.min(anchorEditorIndex, editorIndex);
		const toEditorIndex = Math.max(anchorEditorIndex, editorIndex);
		for (const editor of this.groupView.getEditors(EditorsOrder.SEQUENTIAL).slice(fromEditorIndex, toEditorIndex + 1)) {
			if (!this.groupView.isSelected(editor)) {
				selection.push(editor);
			}
		}

		await this.groupView.setSelection(target, selection.filter(editor => !editor.matches(target)));
	}

	private async unselectEditor(editor: EditorInput): Promise<void> {
		const isUnselectingActiveEditor = this.groupView.isActive(editor);
		if (isUnselectingActiveEditor && this.groupView.selectedEditors.length === 1) {
			return;
		}

		let newActiveEditor = assertReturnsDefined(this.groupView.activeEditor);
		if (isUnselectingActiveEditor) {
			for (const recentEditor of this.groupView.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).slice(1)) {
				if (this.groupView.isSelected(recentEditor)) {
					newActiveEditor = recentEditor;
					break;
				}
			}
		}

		const inactiveSelectedEditors = this.groupView.selectedEditors.filter(selectedEditor => !selectedEditor.matches(editor) && !selectedEditor.matches(newActiveEditor));
		await this.groupView.setSelection(newActiveEditor, inactiveSelectedEditors);
	}

	private async unselectAllEditors(): Promise<void> {
		if (this.groupView.selectedEditors.length > 1) {
			await this.groupView.setSelection(assertReturnsDefined(this.groupView.activeEditor), []);
		}
	}

	/** The rows and headers of the list in visual order, i.e. everything keyboard navigation moves across. */
	private getItems(): HTMLElement[] {
		return Array.from(this.tabsContainer?.children ?? []).filter((child): child is HTMLElement => child.matches('.vertical-tab:not(.exiting), .vertical-tab-group-header'));
	}

	private getItem(target: EventTarget | null): HTMLElement | undefined {
		const item = isHTMLElement(target) ? target.closest<HTMLElement>('.vertical-tab, .vertical-tab-group-header') : null;
		return item && item.parentElement === this.tabsContainer ? item : undefined;
	}

	/**
	 * Keeps exactly one item in the Tab order (roving tabindex), so the list is a single
	 * Tab stop and the arrow keys move within it. The item holding focus wins, otherwise
	 * the active editor's row, otherwise the first item.
	 */
	private updateTabStop(): void {
		const items = this.getItems();
		const activeElement = this.tabsContainer ? getWindow(this.tabsContainer).document.activeElement : null;
		const activeEditorRow = this.tabsModel.activeEditor ? this.tabs.get(this.tabsModel.activeEditor)?.element : undefined;
		this.tabStop = undefined;
		this.setTabStop(items.find(item => activeElement && item.contains(activeElement)) ?? activeEditorRow ?? items[0]);
	}

	private setTabStop(item: HTMLElement | undefined): void {
		if (item === this.tabStop && item?.isConnected) {
			return;
		}

		for (const candidate of this.getItems()) {
			candidate.tabIndex = candidate === item ? 0 : -1;
		}
		this.tabStop = item;
	}

	private onListKeyDown(event: KeyboardEvent): void {
		const item = this.getItem(event.target);
		if (!item || item !== event.target) {
			return; // keys pressed on nested controls are theirs
		}

		const keyboardEvent = new StandardKeyboardEvent(event);
		const editor = this.getEditorOfRow(item);
		const tabGroup = editor ? undefined : this.tabsModel.tabGroups.find(group => group.id === item.dataset.tabGroupId);

		if (keyboardEvent.shiftKey && keyboardEvent.keyCode === KeyCode.F10) {
			EventHelper.stop(event, true);
			if (editor) {
				this.onTabContextMenu(editor, event, item);
			} else if (tabGroup) {
				this.showTabGroupContextMenu(tabGroup, item, event);
			}
			return;
		}

		const items = this.getItems();
		const index = items.indexOf(item);
		let target: HTMLElement | undefined;
		if (keyboardEvent.equals(KeyCode.Escape) && this.isFilterVisible()) {
			EventHelper.stop(event, true);
			this.closeFilter();
			return;
		} else if (keyboardEvent.equals(KeyCode.UpArrow)) {
			target = items[index - 1];
			if (!target && this.filterInput && this.isFilterVisible()) {
				EventHelper.stop(event, true);
				this.filterInput.focus(); // back out of the results
				return;
			}
		} else if (keyboardEvent.equals(KeyCode.DownArrow)) {
			target = items[index + 1];
		} else if (keyboardEvent.equals(KeyCode.Home)) {
			target = items[0];
		} else if (keyboardEvent.equals(KeyCode.End)) {
			target = items[items.length - 1];
		} else if (tabGroup && keyboardEvent.equals(KeyCode.LeftArrow) && !this.isTabGroupCollapsedInList(tabGroup)) {
			EventHelper.stop(event, true);
			this.setTabGroupCollapsed(tabGroup, true);
			return;
		} else if (tabGroup && keyboardEvent.equals(KeyCode.RightArrow)) {
			EventHelper.stop(event, true);
			if (this.isTabGroupCollapsedInList(tabGroup)) {
				this.setTabGroupCollapsed(tabGroup, false);
			} else {
				this.focusItem(items[index + 1]); // into the group, as in a tree
			}
			return;
		} else if (editor && keyboardEvent.equals(KeyCode.LeftArrow) && this.groupsView.partOptions.tabGroups.enabled) {
			const header = this.tabGroupHeaders.get(this.tabsModel.getTabGroupForEditor(editor)?.id ?? '')?.element;
			if (header) {
				EventHelper.stop(event, true);
				header.focus(); // out to the parent, as in a tree
			}
			return;
		} else if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
			EventHelper.stop(event, true);
			if (tabGroup) {
				if (!event.repeat) {
					this.toggleTabGroup(tabGroup);
				}
			} else if (editor) {
				void this.groupView.openEditor(editor);
			}
			return;
		} else if (editor && keyboardEvent.equals(KeyCode.Delete)) {
			if (!editor.hasCapability(EditorInputCapabilities.CannotClose) && !preventEditorClose(this.tabsModel, editor, EditorCloseMethod.KEYBOARD, this.groupsView.partOptions)) {
				EventHelper.stop(event, true);
				void this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) }).then(() => {
					if (this.tabsModel.activeEditor) {
						this.tabs.get(this.tabsModel.activeEditor)?.element.focus();
					}
				});
			}
			return;
		} else {
			return;
		}

		EventHelper.stop(event, true);
		this.focusItem(target);
	}

	/**
	 * Moves focus to a row or header. Moving onto a tab also opens its editor, keeping focus
	 * in the list so that the arrow keys can continue.
	 */
	private focusItem(item: HTMLElement | undefined): void {
		if (!item) {
			return;
		}

		item.focus();
		this.setTabStop(item);
		const editor = this.getEditorOfRow(item);
		if (editor) {
			void this.groupView.openEditor(editor, { preserveFocus: true }, { focusTabControl: true });
		}
	}

	private getEditorOfRow(row: HTMLElement): EditorInput | undefined {
		for (const [editor, tab] of this.tabs) {
			if (tab.element === row) {
				return editor;
			}
		}

		return undefined;
	}

	private getVisibleEditors(): EditorInput[] {
		const editors = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL);
		const filter = this.getFilterResult(editors);
		const tabGroupsEnabled = this.groupsView.partOptions.tabGroups.enabled;

		return editors.filter((editor, index) => {
			if (filter && !filter.tabs.has(index)) {
				return false; // the filter leaves the tab out
			}

			const group = tabGroupsEnabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
			return !group || !this.isTabGroupCollapsedInList(group) || this.tabsModel.isActive(editor);
		});
	}

	private layoutScrollbar(): void {
		if (!this.root || !this.toolbar || !this.tabsContainer || !this.tabsScrollbar || this.dimensions === Dimension.None) {
			return;
		}

		const toolbarHeight = this.toolbar.offsetHeight + (this.filterBar && !this.filterBar.hidden ? this.filterBar.offsetHeight : 0);
		const listHeight = Math.max(0, this.dimensions.height - toolbarHeight);
		const scrollbarNode = this.tabsScrollbar.getDomNode();
		scrollbarNode.style.width = `${this.dimensions.width}px`;
		scrollbarNode.style.height = `${listHeight}px`;
		this.tabsScrollbar.setScrollDimensions({
			width: this.dimensions.width,
			height: listHeight,
			scrollWidth: this.dimensions.width,
			scrollHeight: this.tabsContainer.scrollHeight
		});
	}

	private revealActiveTab(): void {
		if (!this.tabsContainer || !this.tabsScrollbar || !this.tabsModel.activeEditor) {
			return;
		}

		const row = this.tabs.get(this.tabsModel.activeEditor)?.element;
		if (!row) {
			return;
		}

		const { scrollTop } = this.tabsScrollbar.getScrollPosition();
		const viewportHeight = this.tabsScrollbar.getScrollDimensions().height;
		if (row.offsetTop < scrollTop) {
			this.tabsScrollbar.setScrollPosition({ scrollTop: row.offsetTop });
		} else if (row.offsetTop + row.offsetHeight > scrollTop + viewportHeight) {
			this.tabsScrollbar.setScrollPosition({ scrollTop: row.offsetTop + row.offsetHeight - viewportHeight });
		}
	}

	openEditor(editor: EditorInput, options?: IInternalEditorOpenOptions): boolean {
		this.refreshTabStates();
		if (options?.focusTabControl) {
			this.tabs.get(editor)?.element.focus();
		}
		return true;
	}

	openEditors(editors: EditorInput[]): boolean {
		this.redraw();
		return true;
	}

	beforeCloseEditor(editor: EditorInput): void { }
	closeEditor(editor: EditorInput): void { this.redraw(); }
	closeEditors(editors: EditorInput[]): void { this.redraw(); }
	moveEditor(editor: EditorInput, fromIndex: number, targetIndex: number): void { this.redraw(); }
	pinEditor(editor: EditorInput): void { this.updateTab(editor); }
	stickEditor(editor: EditorInput): void { this.redraw(); }
	unstickEditor(editor: EditorInput): void { this.redraw(); }
	setActive(isActive: boolean): void { this.refreshTabStates(); }
	updateEditorSelections(): void { this.refreshTabStates(); }
	updateEditorLabel(editor: EditorInput): void {
		if (this.isFiltering) {
			this.redraw(); // a different label can change whether the tab matches the filter
		} else {
			this.updateTab(editor);
		}
	}

	updateEditorCapabilities(editor: EditorInput): void { this.updateTab(editor); }

	updateEditorDirty(editor: EditorInput): void {
		this.updateTab(editor);
		const tabGroup = this.tabsModel.getTabGroupForEditor(editor);
		if (tabGroup) {
			this.tabGroupHeaders.get(tabGroup.id)?.updateStatus();
		}
	}

	override updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {
		super.updateOptions(oldOptions, newOptions);
		this.redraw();
	}

	override updateStyles(): void {
		this.redraw();
	}

	protected override prepareEditorActions(editorActions: IToolbarActions): IToolbarActions {
		if (this.groupsView.activeGroup === this.groupView) {
			return editorActions;
		}
		return {
			primary: this.groupsView.partOptions.alwaysShowEditorActions ? editorActions.primary : editorActions.primary.filter(action => action.id === UNLOCK_GROUP_COMMAND_ID),
			secondary: editorActions.secondary
		};
	}

	protected override prepareEditorLayoutActions(editorActions: IToolbarActions): IToolbarActions {
		return editorActions;
	}

	protected override updateEditorActionsToolbar(): void {
		super.updateEditorActionsToolbar();
		if (this.compact) {
			this.layoutScrollbar(); // the compact toolbar stacks its actions, so they change the height left for the list
		}
	}

	protected override get tabHeight(): 28 | 32 {
		return this.groupsView.partOptions.tabHeight === 'compact' ? 28 : 32;
	}

	getHeight(): number {
		return 0;
	}

	/**
	 * Switches between the labeled rendering and the compact icons-only one (file icon,
	 * unsaved dot and group color rail). Names stay available through the row hovers.
	 */
	private updateCompact(compact: boolean): void {
		if (compact === this.compact) {
			return;
		}

		this.compact = compact;
		if (compact) {
			this.closeFilter(); // the rail has no room for the filter
		}
		this.root?.classList.toggle('compact', compact);
		this.root?.classList.toggle('show-file-icons', compact); // the icon theme only paints file icons within this class, which the group sets only while icons are shown
		if (!this.groupsView.partOptions.showIcons) {
			for (const [editor, tab] of this.tabs) {
				this.renderTabLabel(editor, tab); // icons are always shown while compact
			}
		}
	}

	layout(dimensions: IEditorTitleControlDimensions): Dimension {
		this.dimensions = dimensions.container;
		if (this.root) {
			this.root.style.width = `${this.dimensions.width}px`;
			this.root.style.height = `${this.dimensions.height}px`;
		}
		this.updateCompact(isVerticalTabsWidthCompact(this.dimensions.width, this.compact));
		this.layoutScrollbar();
		this.revealActiveTab();
		return this.dimensions;
	}
}
