/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/verticalEditorTabsControl.css';
import { $, addDisposableListener, clearNode, Dimension, DragAndDropObserver, EventHelper, EventType, getWindow } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { applyDragImage } from '../../../../base/browser/ui/dnd/dnd.js';
import { ScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { combinedDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basenameOrAuthority } from '../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { LocalSelectionTransfer } from '../../../../platform/dnd/browser/dnd.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { localize } from '../../../../nls.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorResolverService } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { IMergeGroupOptions, MergeGroupMode } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorInputCapabilities, EditorResourceAccessor, EditorsOrder, IEditorPartOptions, IToolbarActions, preventEditorClose, EditorCloseMethod, SideBySideEditor, GroupModelChangeKind } from '../../../common/editor.js';
import { getEditorTabGroupColor, IEditorTabGroup } from '../../../common/editor/editorTabGroup.js';
import { IReadonlyEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { computeEditorAriaLabel } from '../../editor.js';
import { DraggedEditorGroupIdentifier, DraggedEditorIdentifier, DraggedEditorTabGroupIdentifier, ResourcesDropHandler } from '../../dnd.js';
import { DEFAULT_LABELS_CONTAINER, ResourceLabels } from '../../labels.js';
import { CloseEditorTabAction, UnpinEditorAction } from './editorActions.js';
import { getTabGroupMembers, UNLOCK_GROUP_COMMAND_ID } from './editorCommands.js';
import { EditorCommandsContextActionRunner, EditorTabsControl } from './editorTabsControl.js';
import { IEditorGroupMenuIds, IEditorGroupsView, IEditorGroupView, IEditorPartsView, IInternalEditorOpenOptions, isEditorGroupView, prepareMoveCopyEditors } from './editor.js';
import { IEditorTitleControlDimensions } from './editorTitleControl.js';
import { TabGroupContextMenu } from './tabGroupContextMenu.js';

class DraggedVerticalEditorIdentifier extends DraggedEditorIdentifier { }

export class VerticalEditorTabsControl extends EditorTabsControl {

	private root: HTMLElement | undefined;
	private toolbar: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;
	private dimensions = Dimension.None;

	private readonly rowDisposables = this._register(new DisposableStore());
	private readonly verticalEditorTransfer = LocalSelectionTransfer.getInstance<DraggedVerticalEditorIdentifier>();
	private readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	private readonly tabRows = new Map<EditorInput, HTMLElement>();
	private readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseEditorTabAction, CloseEditorTabAction.ID, CloseEditorTabAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));
	private lastSingleSelectSelectedEditor: EditorInput | undefined;
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
	) {
		super(parent, editorPartsView, groupsView, groupView, tabsModel, menuIds, breadcrumbsInHeader, useModernUITabs, contextMenuService, instantiationService, contextKeyService, keybindingService, notificationService, quickInputService, themeService, editorResolverService, hostService, menuService);

		this._register(this.tabResourceLabels.onDidChangeDecorations(() => this.redraw()));
		this._register(this.tabsModel.onDidModelChange(event => {
			if (event.kind === GroupModelChangeKind.TAB_GROUP_CREATED || event.kind === GroupModelChangeKind.TAB_GROUP_CHANGED || event.kind === GroupModelChangeKind.TAB_GROUP_REMOVED) {
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
		const newTabButton = $<HTMLButtonElement>('button.vertical-tabs-new-tab');
		newTabButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.add));
		newTabButton.type = 'button';
		newTabButton.title = localize('verticalTabs.newTab', "New Tab");
		newTabButton.setAttribute('aria-label', newTabButton.title);
		this.toolbar.appendChild(newTabButton);
		this._register(addDisposableListener(newTabButton, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.openNewTab();
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

		this.tabsContainer = $('.vertical-tabs-list', {
			role: 'tablist',
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

	private openNewTab(): void {
		void this.editorService.openEditor({
			resource: undefined,
			options: { pinned: true, index: this.groupView.count, override: DEFAULT_EDITOR_ASSOCIATION.id }
		}, this.groupView.id);
	}

	private redraw(): void {
		if (!this.tabsContainer) {
			return;
		}

		this.rowDisposables.clear();
		this.tabResourceLabels.clear();
		this.tabRows.clear();
		clearNode(this.tabsContainer);

		const editors = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL);
		const renderedGroups = new Set<string>();
		const tabGroupsEnabled = this.groupsView.partOptions.tabGroups.enabled;
		const showPinnedSection = this.groupsView.partOptions.pinnedTabsOnSeparateRow && this.tabsModel.stickyCount > 0;
		for (let index = 0; index < editors.length; index++) {
			const editor = editors[index];
			if (showPinnedSection && index === 0) {
				this.tabsContainer.appendChild(this.createSectionLabel(localize('verticalTabs.pinned', "Pinned"), 0, true));
			} else if (showPinnedSection && index === this.tabsModel.stickyCount) {
				this.tabsContainer.appendChild(this.createSectionLabel(localize('verticalTabs.editors', "Editors"), this.tabsModel.stickyCount, false));
			}
			const tabGroup = tabGroupsEnabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
			if (tabGroup && !renderedGroups.has(tabGroup.id)) {
				this.tabsContainer.appendChild(this.createTabGroupHeader(tabGroup, editors));
				renderedGroups.add(tabGroup.id);
			}

			if (tabGroup?.collapsed && !this.tabsModel.isActive(editor)) {
				continue;
			}

			this.tabsContainer.appendChild(this.createTab(editor));
		}

		this.root?.classList.toggle('empty', editors.length === 0);
		this.updateEditorActionsToolbar();
		this.layoutScrollbar();
		this.revealActiveTab();
	}

	private createSectionLabel(label: string, targetEditorIndex: number, sticky: boolean): HTMLElement {
		const element = $('.vertical-tabs-section-label');
		element.textContent = label;
		this.rowDisposables.add(addDisposableListener(element, EventType.DRAG_OVER, event => {
			if (!this.isSupportedDropTransfer(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.setDropTarget(element, 'before');
		}));
		this.rowDisposables.add(addDisposableListener(element, EventType.DRAG_LEAVE, event => {
			if (!element.contains(event.relatedTarget as Node)) {
				this.clearDropTarget();
			}
		}));
		this.rowDisposables.add(addDisposableListener(element, EventType.DROP, event => void this.drop(event, targetEditorIndex, null, sticky)));
		return element;
	}

	private onTabsMouseWheel(event: WheelEvent): void {
		const activeEditor = this.groupView.activeEditor;
		if (!activeEditor || this.groupView.count < 2) {
			return;
		}

		if ((this.groupsView.partOptions.scrollToSwitchTabs && event.shiftKey) || (!this.groupsView.partOptions.scrollToSwitchTabs && !event.shiftKey)) {
			return;
		}

		const now = Date.now();
		if (now - this.lastMouseWheelEventTime < 150 - 2 * (Math.abs(event.deltaX) + Math.abs(event.deltaY)) || Math.abs(event.deltaY) <= 1.5) {
			return;
		}
		this.lastMouseWheelEventTime = now;

		const visibleEditors = this.getVisibleEditors();
		const target = visibleEditors[visibleEditors.indexOf(activeEditor) + (event.deltaY < 0 ? -1 : 1)];
		if (target) {
			EventHelper.stop(event, true);
			void this.groupView.openEditor(target);
		}
	}

	private createTabGroupHeader(group: IEditorTabGroup, editors: readonly EditorInput[]): HTMLElement {
		const members = editors.filter(editor => this.tabsModel.getTabGroupForEditor(editor)?.id === group.id);
		const dirtyCount = members.filter(editor => editor.isDirty() && !editor.isSaving()).length;
		const header = $('.vertical-tab-group-header', {
			role: 'button',
			tabindex: 0,
			draggable: !group.locked,
			'aria-expanded': String(!group.collapsed)
		});
		header.dataset.tabGroupId = group.id;
		header.classList.toggle('collapsed', group.collapsed);
		header.classList.toggle('saved', group.saved);
		header.classList.toggle('locked', group.locked);
		header.style.setProperty('--tab-group-color', getEditorTabGroupColor(group.color));

		const twistie = $('span.vertical-tab-group-twistie');
		twistie.classList.add(...ThemeIcon.asClassNameArray(group.collapsed ? Codicon.chevronRight : Codicon.chevronDown));
		header.appendChild(twistie);
		const colorDot = $('span.vertical-tab-group-color-dot');
		colorDot.setAttribute('aria-hidden', 'true');
		header.appendChild(colorDot);

		if (group.icon) {
			const icon = $('span.vertical-tab-group-icon');
			icon.classList.add('codicon', `codicon-${group.icon}`);
			icon.setAttribute('aria-hidden', 'true');
			header.appendChild(icon);
		}

		if (group.saved) {
			const savedIndicator = $('span.vertical-tab-group-saved');
			savedIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.bookmark));
			savedIndicator.setAttribute('aria-hidden', 'true');
			header.appendChild(savedIndicator);
		}

		if (dirtyCount > 0) {
			const dirtyIndicator = $('span.vertical-tab-group-dirty');
			dirtyIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.circleFilled));
			dirtyIndicator.setAttribute('aria-hidden', 'true');
			dirtyIndicator.title = localize('verticalTabs.groupDirtyCount', "{0} unsaved tabs", dirtyCount);
			header.appendChild(dirtyIndicator);
		}

		if (group.locked) {
			const lockIndicator = $('span.vertical-tab-group-lock');
			lockIndicator.classList.add(...ThemeIcon.asClassNameArray(Codicon.lockSmall));
			lockIndicator.setAttribute('aria-hidden', 'true');
			header.appendChild(lockIndicator);
		}

		const name = $('span.vertical-tab-group-name');
		name.textContent = group.name || localize('verticalTabs.unnamedGroup', "Tab Group");
		header.appendChild(name);

		const count = $('span.vertical-tab-group-count');
		count.textContent = String(members.length);
		header.appendChild(count);

		const label = group.name || localize('verticalTabs.unnamedGroup', "Tab Group");
		const status = dirtyCount > 0 ? localize('verticalTabs.groupStatusDirty', "{0} editors, {1} unsaved", members.length, dirtyCount) : localize('verticalTabs.groupStatus', "{0} editors", members.length);
		const accessibilityStatus = [status, group.saved ? localize('verticalTabs.groupSaved', "saved") : undefined, group.locked ? localize('verticalTabs.groupLocked', "locked") : undefined].filter(Boolean).join(', ');
		header.setAttribute('aria-label', group.collapsed ? localize('verticalTabs.collapsedGroupAria', "{0}, collapsed, {1}", label, accessibilityStatus) : localize('verticalTabs.expandedGroupAria', "{0}, expanded, {1}", label, accessibilityStatus));
		header.title = localize('verticalTabs.groupTitle', "{0} ({1})", label, accessibilityStatus);

		this.rowDisposables.add(addDisposableListener(header, EventType.CLICK, event => {
			EventHelper.stop(event, true);
			this.toggleTabGroup(group, header);
		}));
		this.rowDisposables.add(addDisposableListener(header, EventType.KEY_UP, event => {
			const keyboardEvent = new StandardKeyboardEvent(event);
			if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
				EventHelper.stop(event, true);
				this.toggleTabGroup(group, header);
			}
		}));
		this.rowDisposables.add(addDisposableListener(header, EventType.CONTEXT_MENU, event => {
			EventHelper.stop(event, true);
			this.showTabGroupContextMenu(group, header, event);
		}));
		this.rowDisposables.add(addDisposableListener(header, EventType.KEY_DOWN, event => {
			const keyboardEvent = new StandardKeyboardEvent(event);
			if (keyboardEvent.shiftKey && keyboardEvent.keyCode === KeyCode.F10) {
				EventHelper.stop(event, true);
				this.showTabGroupContextMenu(group, header, event);
			}
		}));
		this.rowDisposables.add(addDisposableListener(header, EventType.DRAG_OVER, event => {
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
		this.rowDisposables.add(addDisposableListener(header, EventType.DRAG_LEAVE, event => {
			if (!header.contains(event.relatedTarget as Node)) {
				this.clearDropTarget();
			}
		}));
		this.rowDisposables.add(addDisposableListener(header, EventType.DROP, event => {
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
		this.rowDisposables.add(addDisposableListener(header, EventType.DRAG_START, event => {
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
		this.rowDisposables.add(addDisposableListener(header, EventType.DRAG_END, () => {
			header.classList.remove('dragged');
			this.clearDropTarget();
			this.tabGroupTransfer.clearData(DraggedEditorTabGroupIdentifier.prototype);
		}));

		return header;
	}

	private showTabGroupContextMenu(group: IEditorTabGroup, header: HTMLElement, event: Event): void {
		new TabGroupContextMenu(this.groupView, this.editorPartsView, this.contextViewService, this.editorService, this.historyService, this.tabsContainer ?? header.parentElement ?? header).show(group, header, event);
	}

	private toggleTabGroup(group: IEditorTabGroup, header: HTMLElement): void {
		const preserveFocus = getWindow(header).document.activeElement === header;
		this.groupView.setTabGroupCollapsed(group.id, !group.collapsed);
		if (preserveFocus) {
			for (const child of Array.from(this.tabsContainer?.children ?? [])) {
				const candidate = child as HTMLElement;
				if (candidate.dataset.tabGroupId === group.id) {
					candidate.focus();
					break;
				}
			}
		}
	}

	private createTab(editor: EditorInput): HTMLElement {
		const row = $('.vertical-tab', { role: 'tab', draggable: true });
		const tabGroup = this.groupsView.partOptions.tabGroups.enabled ? this.tabsModel.getTabGroupForEditor(editor) : undefined;
		if (tabGroup) {
			row.classList.add('in-tab-group');
			row.style.setProperty('--tab-group-color', getEditorTabGroupColor(tabGroup.color));
		}
		this.tabRows.set(editor, row);

		const label = this.tabResourceLabels.create(row, { hoverTargetOverride: row });
		label.setResource({
			resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }),
			name: editor.getName()
		}, {
			title: this.getHoverTitle(editor),
			italic: !this.tabsModel.isPinned(editor),
			extraClasses: ['vertical-tab-label', ...editor.getLabelExtraClasses()],
			fileDecorations: {
				colors: this.groupsView.partOptions.decorations.colors,
				badges: this.groupsView.partOptions.decorations.badges
			},
			icon: editor.getIcon(),
			hideIcon: !this.groupsView.partOptions.showIcons
		});

		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			row.dataset.resourceName = basenameOrAuthority(resource);
		}

		const actionsContainer = $('.vertical-tab-actions');
		row.appendChild(actionsContainer);
		const that = this;
		const actionRunner = new EditorCommandsContextActionRunner({
			groupId: this.groupView.id,
			get editorIndex() { return that.groupView.getIndexOfEditor(editor); }
		});
		const actionBar = new ActionBar(actionsContainer, {
			ariaLabel: localize('verticalTabs.tabActions', "Tab actions"),
			actionRunner
		});
		const action = this.tabsModel.isSticky(editor) && this.groupsView.partOptions.tabActionUnpinVisibility ? this.unpinEditorAction : this.closeEditorAction;
		if ((action === this.unpinEditorAction || !editor.hasCapability(EditorInputCapabilities.CannotClose)) && (action === this.unpinEditorAction || this.groupsView.partOptions.tabActionCloseVisibility)) {
			actionBar.push(action, { icon: true, label: false, keybinding: this.getKeybindingLabel(action) });
		}
		this.rowDisposables.add(combinedDisposable(actionRunner, actionBar, label));

		this.updateTabState(editor, row);
		this.registerTabListeners(editor, row, actionsContainer);

		return row;
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
		row.setAttribute('aria-label', computeEditorAriaLabel(editor, this.groupView.getIndexOfEditor(editor), this.groupView, this.editorPartsView.count));
		row.tabIndex = active ? 0 : -1;
	}

	private refreshTabStates(): void {
		const visibleEditors = this.getVisibleEditors();
		if (visibleEditors.length !== this.tabRows.size || visibleEditors.some(editor => !this.tabRows.has(editor))) {
			this.redraw();
			return;
		}

		for (const [editor, row] of this.tabRows) {
			this.updateTabState(editor, row);
		}
		this.updateEditorActionsToolbar();
		this.revealActiveTab();
	}

	private registerTabListeners(editor: EditorInput, row: HTMLElement, actionsContainer: HTMLElement): void {
		let openOnMouseUp = false;

		this.rowDisposables.add(addDisposableListener(row, EventType.DBLCLICK, event => {
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
		this.rowDisposables.add(addDisposableListener(actionsContainer, EventType.MOUSE_DOWN, event => EventHelper.stop(event, false)));
		this.rowDisposables.add(addDisposableListener(row, EventType.MOUSE_DOWN, async event => {
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
		this.rowDisposables.add(addDisposableListener(row, EventType.MOUSE_UP, async event => {
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
		this.rowDisposables.add(addDisposableListener(row, EventType.AUXCLICK, event => {
			if (event.button !== 1 || editor.hasCapability(EditorInputCapabilities.CannotClose) || preventEditorClose(this.tabsModel, editor, EditorCloseMethod.MOUSE, this.groupsView.partOptions)) {
				return;
			}
			EventHelper.stop(event, true);
			void this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) });
		}));
		this.rowDisposables.add(addDisposableListener(row, EventType.CONTEXT_MENU, event => {
			EventHelper.stop(event, true);
			this.onTabContextMenu(editor, event, row);
		}));
		this.rowDisposables.add(addDisposableListener(row, EventType.KEY_DOWN, event => this.onTabKeyDown(editor, event)));
		this.rowDisposables.add(new DragAndDropObserver(row, {
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
		for (const [editor, row] of this.tabRows) {
			const rect = row.getBoundingClientRect();
			if (event.clientY >= rect.bottom) {
				continue;
			}

			const group = this.tabsModel.getTabGroupForEditor(editor);
			if (group) {
				const members = this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).filter(candidate => this.tabsModel.getTabGroupForEditor(candidate)?.id === group.id);
				const firstRow = members.map(member => this.tabRows.get(member)).find((candidate): candidate is HTMLElement => !!candidate);
				const lastRow = members.map(member => this.tabRows.get(member)).filter((candidate): candidate is HTMLElement => !!candidate).at(-1);
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

		const targetGroup = targetTabGroupId ? this.tabsModel.tabGroups.find(group => group.id === targetTabGroupId) : undefined;
		const changesLockedGroup = data.some(item => {
			const itemSourceGroup = this.editorPartsView.getGroup(item.identifier.groupId);
			return !!itemSourceGroup && isEditorGroupView(itemSourceGroup) && itemSourceGroup.getTabGroupForEditor(item.identifier.editor)?.locked && itemSourceGroup.getTabGroupForEditor(item.identifier.editor)?.id !== targetTabGroupId;
		});
		if (changesLockedGroup || (targetGroup?.locked && data.some(item => this.tabsModel.getTabGroupForEditor(item.identifier.editor)?.id !== targetTabGroupId))) {
			this.clearDraggedEditors();
			return;
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
			targetEditorIndex++;
		}

		if (targetTabGroupId) {
			this.groupView.addToTabGroup(targetTabGroupId, droppedEditors);
		} else {
			this.groupView.removeFromTabGroup(droppedEditors);
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

	private onTabKeyDown(editor: EditorInput, event: KeyboardEvent): void {
		const keyboardEvent = new StandardKeyboardEvent(event);
		if (keyboardEvent.shiftKey && keyboardEvent.keyCode === KeyCode.F10) {
			EventHelper.stop(event, true);
			const row = this.tabRows.get(editor);
			if (row) {
				this.onTabContextMenu(editor, event, row);
			}
			return;
		}

		if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
			EventHelper.stop(event, true);
			void this.groupView.openEditor(editor);
			return;
		}

		if (keyboardEvent.equals(KeyCode.Delete)) {
			if (!editor.hasCapability(EditorInputCapabilities.CannotClose) && !preventEditorClose(this.tabsModel, editor, EditorCloseMethod.KEYBOARD, this.groupsView.partOptions)) {
				EventHelper.stop(event, true);
				void this.closeEditorAction.run({ groupId: this.groupView.id, editorIndex: this.groupView.getIndexOfEditor(editor) }).then(() => {
					if (this.tabsModel.activeEditor) {
						this.tabRows.get(this.tabsModel.activeEditor)?.focus();
					}
				});
			}
			return;
		}

		const visibleEditors = this.getVisibleEditors();
		let targetIndex = visibleEditors.indexOf(editor);
		if (keyboardEvent.equals(KeyCode.UpArrow)) {
			targetIndex--;
		} else if (keyboardEvent.equals(KeyCode.DownArrow)) {
			targetIndex++;
		} else if (keyboardEvent.equals(KeyCode.Home)) {
			targetIndex = 0;
		} else if (keyboardEvent.equals(KeyCode.End)) {
			targetIndex = visibleEditors.length - 1;
		} else {
			return;
		}

		const target = visibleEditors[targetIndex];
		if (target) {
			EventHelper.stop(event, true);
			void this.groupView.openEditor(target, { preserveFocus: true }, { focusTabControl: true });
		}
	}

	private getVisibleEditors(): EditorInput[] {
		if (!this.groupsView.partOptions.tabGroups.enabled) {
			return [...this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL)];
		}

		return this.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).filter(editor => {
			const group = this.tabsModel.getTabGroupForEditor(editor);
			return !group?.collapsed || this.tabsModel.isActive(editor);
		});
	}

	private layoutScrollbar(): void {
		if (!this.root || !this.toolbar || !this.tabsContainer || !this.tabsScrollbar || this.dimensions === Dimension.None) {
			return;
		}

		const toolbarHeight = this.toolbar.offsetHeight;
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

		const row = this.tabRows.get(this.tabsModel.activeEditor);
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
			this.tabRows.get(editor)?.focus();
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
	pinEditor(editor: EditorInput): void { this.redraw(); }
	stickEditor(editor: EditorInput): void { this.redraw(); }
	unstickEditor(editor: EditorInput): void { this.redraw(); }
	setActive(isActive: boolean): void { this.refreshTabStates(); }
	updateEditorSelections(): void { this.refreshTabStates(); }
	updateEditorLabel(editor: EditorInput): void { this.redraw(); }
	updateEditorCapabilities(editor: EditorInput): void { this.redraw(); }
	updateEditorDirty(editor: EditorInput): void { this.redraw(); }

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

	protected override get tabHeight(): 28 | 32 {
		return this.groupsView.partOptions.tabHeight === 'compact' ? 28 : 32;
	}

	getHeight(): number {
		return 0;
	}

	layout(dimensions: IEditorTitleControlDimensions): Dimension {
		this.dimensions = dimensions.container;
		if (this.root) {
			this.root.style.width = `${this.dimensions.width}px`;
			this.root.style.height = `${this.dimensions.height}px`;
		}
		this.layoutScrollbar();
		this.revealActiveTab();
		return this.dimensions;
	}
}
