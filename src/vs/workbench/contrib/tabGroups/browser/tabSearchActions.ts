/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../base/common/arrays.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { FuzzyScorerCache } from '../../../../base/common/fuzzyScorer.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { isEditorGroupView } from '../../../browser/parts/editor/editor.js';
import { EditorResourceAccessor, EditorsOrder, isResourceEditorInput, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { createTabSearchPicks, ITabSearchButtons, ITabSearchEditorPick, ITabSearchGroup, ITabSearchSavedGroup, TabSearchPick } from './tabSearchPicks.js';

export const SEARCH_TABS_COMMAND_ID = 'workbench.action.editor.searchTabs';

export interface ITabSearchServices {
	readonly quickInputService: IQuickInputService;
	readonly editorGroupsService: IEditorGroupsService;
	readonly historyService: IHistoryService;
	readonly modelService: IModelService;
	readonly languageService: ILanguageService;
}

/** Collects the open editors of the window the user is in, and the tab groups that were saved, as input for the picks. */
function collectTabs(services: ITabSearchServices): { readonly groups: ITabSearchGroup<EditorInput>[]; readonly savedGroups: ITabSearchSavedGroup[] } {
	const { editorGroupsService, historyService, modelService, languageService } = services;
	const tabGroupsEnabled = editorGroupsService.partOptions.tabGroups.enabled;
	const activeGroup = editorGroupsService.activeGroup;

	const groups = editorGroupsService.getPart(activeGroup).getGroups(GroupsOrder.GRID_APPEARANCE).map((group): ITabSearchGroup<EditorInput> => ({
		id: group.id,
		label: group.label,
		ariaLabel: group.ariaLabel,
		editors: group.getEditors(EditorsOrder.SEQUENTIAL).map(editor => {
			const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
			const icon = editor.getIcon();
			const tabGroup = tabGroupsEnabled && isEditorGroupView(group) ? group.getTabGroupForEditor(editor) : undefined;

			return {
				editor,
				name: editor.getName(),
				description: editor.getDescription(),
				resource,
				dirty: editor.isDirty() && !editor.isSaving(),
				sticky: group.isSticky(editor),
				preview: !group.isPinned(editor),
				current: group === activeGroup && group.activeEditor === editor,
				tabGroup: tabGroup ? { name: tabGroup.name, color: tabGroup.color } : undefined,
				iconUri: URI.isUri(icon) ? icon : undefined,
				iconClasses: getIconClasses(modelService, languageService, resource, undefined, icon).concat(editor.getLabelExtraClasses())
			};
		})
	}));

	// The most recently closed saved group first
	const savedGroups = tabGroupsEnabled ? historyService.getSavedTabGroups().map((savedGroup): ITabSearchSavedGroup => ({
		id: savedGroup.id,
		name: savedGroup.name,
		color: savedGroup.color,
		icon: savedGroup.icon,
		tabCount: savedGroup.editors.length,
		tabNames: coalesce(savedGroup.editors.map(({ editor }) => isResourceEditorInput(editor) ? basename(editor.resource) : undefined))
	})).reverse() : [];

	return { groups, savedGroups };
}

/**
 * Makes the user see an editor: the editor group it is in becomes the active one and the editor its active
 * editor. The tab group of an editor that is hidden by it being collapsed is expanded to show where it is.
 */
export async function revealTab(editorGroupsService: IEditorGroupsService, pick: ITabSearchEditorPick<EditorInput>): Promise<void> {
	const group = editorGroupsService.getGroup(pick.groupId);
	if (!group?.contains(pick.editor)) {
		return;
	}

	if (isEditorGroupView(group)) {
		const tabGroup = group.getTabGroupForEditor(pick.editor);
		if (tabGroup?.collapsed && !group.isActive(pick.editor)) {
			group.setTabGroupCollapsed(tabGroup.id, false);
		}
	}

	editorGroupsService.activateGroup(group);
	await group.openEditor(pick.editor);
}

/** The pick that is closest to a position in the list: not a separator and not one that cannot be picked. */
function findPickNear<T extends IQuickPickItem>(items: ReadonlyArray<T | IQuickPickSeparator>, position: number): T | undefined {
	let closest: T | undefined;
	let closestDistance = Number.POSITIVE_INFINITY;
	items.forEach((item, index) => {
		if (item.type !== 'separator' && item.pickable !== false && Math.abs(index - position) < closestDistance) {
			closest = item;
			closestDistance = Math.abs(index - position);
		}
	});

	return closest;
}

/**
 * Lets the user search the open tabs of the window and saved tab groups, to go to a tab or to
 * open a saved tab group. Closing a tab keeps the list open.
 *
 * @returns Resolves once the list is closed and what was picked is done.
 */
export function showTabSearch(services: ITabSearchServices): Promise<void> {
	const { quickInputService, editorGroupsService, historyService } = services;

	// Saved tab groups are opened in the editor group that has the focus now
	const targetGroup: IEditorGroup = editorGroupsService.activeGroup;
	const buttons: ITabSearchButtons = {
		close: { iconClass: ThemeIcon.asClassName(Codicon.close), tooltip: localize('tabSearch.closeTab', "Close Tab") },
		closeDirty: { iconClass: `dirty-editor ${ThemeIcon.asClassName(Codicon.closeDirty)}`, tooltip: localize('tabSearch.closeTab', "Close Tab"), alwaysVisible: true }
	};

	return new Promise<void>(resolve => {
		const disposables = new DisposableStore();
		const picker = disposables.add(quickInputService.createQuickPick<TabSearchPick<EditorInput>>({ useSeparators: true }));
		picker.placeholder = localize('tabSearch.placeholder', "Search open tabs by name or path");
		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false; // the picks are searched in createTabSearchPicks
		const cache: FuzzyScorerCache = Object.create(null);

		const showPicks = (activate: (items: typeof picker.items) => TabSearchPick<EditorInput> | undefined) => {
			const { groups, savedGroups } = collectTabs(services);
			picker.items = createTabSearchPicks(groups, savedGroups, picker.value, buttons, cache);
			const active = activate(picker.items);
			if (active) {
				picker.activeItems = [active];
			}
		};

		// Start at the tab the user is on, as the list is in the order of the tab bars
		showPicks(items => items.find((item): item is ITabSearchEditorPick<EditorInput> => item.type !== 'separator' && item.kind === 'editor' && item.current));

		disposables.add(picker.onDidChangeValue(() => showPicks(() => undefined)));

		disposables.add(picker.onDidTriggerItemButton(async ({ item }) => {
			if (item.kind !== 'editor') {
				return;
			}

			const group = editorGroupsService.getGroup(item.groupId);
			const position = picker.items.indexOf(item);
			await group?.closeEditor(item.editor, { preserveFocus: true });

			// Closing can ask the user and the list can be gone by then
			if (!disposables.isDisposed) {
				showPicks(items => findPickNear(items, position));
			}
		}));

		let selection: TabSearchPick<EditorInput> | undefined;
		disposables.add(picker.onDidAccept(() => {
			const [pick] = picker.selectedItems;
			if (pick && pick.kind !== 'noResults') {
				selection = pick;
				picker.hide();
			}
		}));

		disposables.add(picker.onDidHide(async () => {
			try {
				if (selection?.kind === 'editor') {
					await revealTab(editorGroupsService, selection);
				} else if (selection?.kind === 'savedGroup') {
					await historyService.reopenSavedTabGroup(selection.savedGroupId, targetGroup.id);
				}
			} finally {
				disposables.dispose();
				resolve();
			}
		}));

		picker.show();
	});
}

registerAction2(class SearchTabsAction extends Action2 {
	constructor() {
		super({
			id: SEARCH_TABS_COMMAND_ID,
			title: localize2('searchTabs', "Search Open Tabs…"),
			category: Categories.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyA)
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return showTabSearch({
			quickInputService: accessor.get(IQuickInputService),
			editorGroupsService: accessor.get(IEditorGroupsService),
			historyService: accessor.get(IHistoryService),
			modelService: accessor.get(IModelService),
			languageService: accessor.get(ILanguageService)
		});
	}
});
