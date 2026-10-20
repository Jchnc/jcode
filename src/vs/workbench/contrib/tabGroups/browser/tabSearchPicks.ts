/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../base/common/arrays.js';
import { escapeIcons } from '../../../../base/common/iconLabels.js';
import { compareItemsByFuzzyScore, FuzzyScorerCache, IItemAccessor, prepareQuery, scoreItemFuzzy } from '../../../../base/common/fuzzyScorer.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IQuickInputButton, IQuickPickItem, IQuickPickItemWithResource, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { createTabGroupColorIcon } from '../../../browser/parts/editor/editorCommands.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { WORKBENCH_COLOR_PALETTE } from '../../../common/workbenchColorPalette.js';

//#region Input

/** An open editor, as far as searching tabs is concerned. */
export interface ITabSearchEditor<T> {

	/** The editor itself, which is handed back when the editor is picked. */
	readonly editor: T;

	readonly name: string;

	/** The description of the editor, usually where it is. */
	readonly description: string | undefined;

	readonly resource: URI | undefined;

	/** Whether the editor has unsaved changes. */
	readonly dirty: boolean;

	/** Whether the editor is pinned to the front of its tab bar. */
	readonly sticky: boolean;

	/** Whether the editor is a preview, which the next editor replaces. */
	readonly preview: boolean;

	/** Whether the editor is the one that is being looked at, which is the active editor of the active editor group. */
	readonly current: boolean;

	/** The tab group the editor is in. */
	readonly tabGroup: { readonly name: string; readonly color: string } | undefined;

	/** The icon the editor provides, which is shown instead of the color of its tab group. */
	readonly iconUri: URI | undefined;

	/** The classes for the file icon of the editor. */
	readonly iconClasses: readonly string[];
}

export interface ITabSearchGroup<T> {
	readonly id: GroupIdentifier;
	readonly label: string;
	readonly ariaLabel: string;

	/** The editors of the group in the order of the tab bar. */
	readonly editors: readonly ITabSearchEditor<T>[];
}

/** A tab group that was closed and can be opened again. */
export interface ITabSearchSavedGroup {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly icon: string | undefined;

	/** The number of editors of the group. */
	readonly tabCount: number;

	/** The names of the editors of the group that have one. */
	readonly tabNames: readonly string[];
}

//#endregion

//#region Picks

export interface ITabSearchEditorPick<T> extends IQuickPickItemWithResource {
	readonly kind: 'editor';
	readonly groupId: GroupIdentifier;
	readonly editor: T;

	/** Whether the editor is the one that is being looked at. */
	readonly current: boolean;

	/** The text of the label that is searched, without what is added to it to show pinned tabs. */
	readonly searchLabel: string;
}

export interface ITabSearchSavedGroupPick extends IQuickPickItem {
	readonly kind: 'savedGroup';
	readonly savedGroupId: string;
	readonly searchLabel: string;
}

export interface ITabSearchNoResultsPick extends IQuickPickItem {
	readonly kind: 'noResults';
	readonly searchLabel: string;
}

export type TabSearchPick<T> = ITabSearchEditorPick<T> | ITabSearchSavedGroupPick | ITabSearchNoResultsPick;

export interface ITabSearchButtons {
	readonly close: IQuickInputButton;
	readonly closeDirty: IQuickInputButton;
}

/** What is searched of a pick: its name, description and where it is. */
const tabSearchAccessor: IItemAccessor<TabSearchPick<unknown>> = {
	getItemLabel: pick => pick.searchLabel,
	getItemDescription: pick => pick.description,
	getItemPath: pick => {
		const resource = pick.kind === 'editor' ? pick.resource : undefined;
		return resource?.scheme === Schemas.file ? resource.fsPath : resource?.path;
	}
};

/** Escapes what a quick pick would show as an icon in a name, such as `$(star)`. */
function escapeText(text: string): string {
	return escapeIcons(text);
}

function createEditorPick<T>(group: ITabSearchGroup<T>, entry: ITabSearchEditor<T>, multipleGroups: boolean, reserveIconGutter: boolean, buttons: ITabSearchButtons): ITabSearchEditorPick<T> {
	const searchLabel = escapeText(entry.name);
	const description = entry.description ? escapeText(entry.description) : undefined;

	return {
		kind: 'editor',
		groupId: group.id,
		editor: entry.editor,
		current: entry.current,
		resource: entry.resource,
		searchLabel,
		label: entry.sticky ? `${searchLabel} $(pinned)` : searchLabel,
		description: entry.tabGroup ? (description ? localize('tabSearch.tabGroupAndDescription', "{0} · {1}", escapeText(entry.tabGroup.name), description) : escapeText(entry.tabGroup.name)) : description,
		ariaLabel: coalesce([
			entry.description ? localize('tabSearch.nameAndDescription', "{0} {1}", entry.name, entry.description) : entry.name,
			entry.tabGroup ? localize('tabSearch.ariaTabGroup', "tab group {0}", entry.tabGroup.name) : undefined,
			entry.sticky ? localize('tabSearch.ariaPinned', "pinned") : undefined,
			entry.preview ? localize('tabSearch.ariaPreview', "preview") : undefined,
			entry.dirty ? localize('tabSearch.ariaDirty', "unsaved changes") : undefined,
			multipleGroups ? group.ariaLabel : undefined
		]).join(', '),
		iconPath: entry.iconUri ? { dark: entry.iconUri } : entry.tabGroup ? createTabGroupColorIcon(entry.tabGroup.color) : reserveIconGutter ? createTabGroupColorIcon('transparent') : undefined,
		iconClasses: entry.iconClasses.slice(),
		italic: entry.preview,
		buttons: [entry.dirty ? buttons.closeDirty : buttons.close]
	};
}

function createSavedGroupPick(savedGroup: ITabSearchSavedGroup): ITabSearchSavedGroupPick {
	const maxNames = 4;
	const name = escapeText(savedGroup.name);
	const tabCount = savedGroup.tabCount === 1 ? localize('tabSearch.oneSavedTab', "1 tab") : localize('tabSearch.savedTabCount', "{0} tabs", savedGroup.tabCount);
	const colorName = WORKBENCH_COLOR_PALETTE.find(color => color.id === savedGroup.color)?.label ?? savedGroup.color;
	const names = savedGroup.tabNames.map(escapeText);

	return {
		kind: 'savedGroup',
		savedGroupId: savedGroup.id,
		searchLabel: name,
		label: savedGroup.icon ? `$(${savedGroup.icon}) ${name}` : name,
		description: names.length > maxNames ? localize('tabSearch.moreSavedTabs', "{0}, +{1} more", names.slice(0, maxNames).join(', '), names.length - maxNames) : names.join(', '),
		ariaLabel: localize('tabSearch.ariaSavedGroup', "{0}, {1}, {2}, saved tab group", savedGroup.name, tabCount, colorName),
		iconPath: createTabGroupColorIcon(savedGroup.color)
	};
}

/**
 * Creates the items to search the open tabs with: the tabs of each editor group in a section of
 * their own (for more than one editor group), followed by a section with the saved tab groups.
 *
 * Without a filter the tabs are in the order of the editor groups and tab bars. A filter keeps what
 * matches by name, description (where it is, and the name of the tab group) or path, and puts the
 * best match first in its section: sections do not move.
 *
 * @param savedGroups The saved tab groups in the order they are listed in without a filter.
 */
export function createTabSearchPicks<T>(groups: readonly ITabSearchGroup<T>[], savedGroups: readonly ITabSearchSavedGroup[], filter: string, buttons: ITabSearchButtons, cache: FuzzyScorerCache = Object.create(null)): Array<TabSearchPick<T> | IQuickPickSeparator> {
	const query = prepareQuery(filter);
	const multipleGroups = groups.length > 1;
	const reserveIconGutter = groups.some(group => group.editors.some(entry => entry.tabGroup && !entry.iconUri));
	const picks: Array<TabSearchPick<T> | IQuickPickSeparator> = [];

	const search = <P extends TabSearchPick<T>>(candidates: P[]): P[] => {
		if (!query.normalized) {
			return candidates;
		}

		const matches = candidates.filter(candidate => {
			const score = scoreItemFuzzy<TabSearchPick<unknown>>(candidate, query, true, tabSearchAccessor, cache);
			if (!score.score) {
				return false;
			}

			candidate.highlights = { label: score.labelMatch, description: score.descriptionMatch };
			return true;
		});

		return matches.sort((first, second) => compareItemsByFuzzyScore<TabSearchPick<unknown>>(first, second, query, true, tabSearchAccessor, cache));
	};

	for (const group of groups) {
		const editorPicks = search(group.editors.map(entry => createEditorPick(group, entry, multipleGroups, reserveIconGutter, buttons)));
		if (editorPicks.length > 0) {
			if (multipleGroups) {
				picks.push({ type: 'separator', label: group.label });
			}
			picks.push(...editorPicks);
		}
	}

	const savedGroupPicks = search(savedGroups.map(createSavedGroupPick));
	if (savedGroupPicks.length > 0) {
		picks.push({ type: 'separator', label: localize('tabSearch.savedTabGroups', "Saved Tab Groups") }, ...savedGroupPicks);
	}

	if (picks.length === 0) {
		picks.push({
			kind: 'noResults',
			searchLabel: '',
			label: query.normalized ? localize('tabSearch.noResults', "No matching tabs") : localize('tabSearch.noTabs', "There are no open tabs"),
			pickable: false,
			alwaysShow: true
		});
	}

	return picks;
}

//#endregion
