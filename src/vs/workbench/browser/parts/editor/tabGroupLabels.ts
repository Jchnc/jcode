/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IEditorTabGroup } from '../../../common/editor/editorTabGroup.js';

/**
 * What a tab group header reports about its group. The top and the vertical tabs share the
 * words that describe a tab group to screen readers and in tooltips, so that both tab
 * controls describe a tab group in the same way.
 */
export interface ITabGroupHeaderDetails {
	/** The number of tabs in the group, including the ones that a collapsed group hides. */
	readonly count: number;
	/** The number of tabs in the group with unsaved changes. */
	readonly dirtyCount: number;
}

/** The name of a tab group, or the generic name for one that has not been named yet. */
export function getTabGroupName(group: IEditorTabGroup): string {
	return group.name || localize('tabGroup.unnamed', "Tab Group");
}

/** Describes the contents and the flags of a tab group, e.g. "3 tabs, 1 unsaved, saved". */
function getTabGroupStatus(group: IEditorTabGroup, { count, dirtyCount }: ITabGroupHeaderDetails): string {
	const tabs = count === 1 ? localize('tabGroup.oneTab', "1 tab") : localize('tabGroup.tabCount', "{0} tabs", count);
	const status = dirtyCount > 0 ? localize('tabGroup.headerStatusDirty', "{0}, {1} unsaved", tabs, dirtyCount) : tabs;

	if (group.saved && group.locked) {
		return localize('tabGroup.statusSavedLocked', "{0}, saved, locked", status);
	}

	if (group.saved) {
		return localize('tabGroup.statusSaved', "{0}, saved", status);
	}

	if (group.locked) {
		return localize('tabGroup.statusLocked', "{0}, locked", status);
	}

	return status;
}

/**
 * The accessible name of a tab group header. It leaves out whether the group is expanded,
 * which headers report through `aria-expanded`.
 */
export function getTabGroupHeaderAriaLabel(group: IEditorTabGroup, details: ITabGroupHeaderDetails): string {
	return localize('tabGroup.headerAria', "{0}, {1}", getTabGroupName(group), getTabGroupStatus(group, details));
}

/** The tooltip of a tab group header. */
export function getTabGroupHeaderTitle(group: IEditorTabGroup, details: ITabGroupHeaderDetails): string {
	return localize('tabGroup.headerTitle', "{0} ({1})", getTabGroupName(group), getTabGroupStatus(group, details));
}

/**
 * Extends the accessible name of a tab with the tab group it belongs to. A collapsed
 * group is mentioned as well because it hides the other tabs of the group.
 */
export function getTabGroupTabAriaLabel(tabAriaLabel: string, group: IEditorTabGroup): string {
	return group.collapsed ?
		localize('tabGroup.tabAriaCollapsed', "{0}, tab group {1}, collapsed", tabAriaLabel, getTabGroupName(group)) :
		localize('tabGroup.tabAria', "{0}, tab group {1}", tabAriaLabel, getTabGroupName(group));
}
