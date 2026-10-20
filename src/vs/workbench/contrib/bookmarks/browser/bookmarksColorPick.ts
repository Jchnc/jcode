/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { BOOKMARK_COLORS } from '../common/bookmarkColors.js';

/**
 * A color that can be picked for a bookmark, or the choice to have no color.
 */
export interface IBookmarkColorPick extends IQuickPickItem {
	readonly kind: 'color';
	/**
	 * The id of the color, or `undefined` for no color.
	 */
	readonly color: string | undefined;
}

/**
 * Creates the choices for the color of a bookmark: no color, then each color of the palette. The
 * colors are named, so that picking one does not depend on telling them apart by sight.
 *
 * @param currentColor The id of the color the bookmark has now, which is marked as current.
 */
export function createBookmarkColorPicks(currentColor: string | undefined): IBookmarkColorPick[] {
	const current = localize('bookmarkColorCurrent', "Current");
	return [
		{
			kind: 'color',
			color: undefined,
			label: localize('bookmarkNoColor', "No Color"),
			description: currentColor === undefined ? current : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.circleSlash)
		},
		...BOOKMARK_COLORS.map(({ id, label, colorId }): IBookmarkColorPick => ({
			kind: 'color',
			color: id,
			label,
			description: currentColor === id ? current : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.circleFilled),
			iconColor: themeColorFromId(colorId)
		}))
	];
}

/**
 * The title and the placeholder for picking the color of a bookmark.
 */
export function getBookmarkColorPickStrings(): { readonly title: string; readonly placeholder: string } {
	return {
		title: localize('setBookmarkColorTitle', "Set Bookmark Color"),
		placeholder: localize('setBookmarkColorPlaceholder', "Select a color to tag the bookmark with")
	};
}

/**
 * Lets the user pick the color of a bookmark.
 *
 * @returns The choice, or `undefined` when the user dismissed the picker.
 */
export function pickBookmarkColor(quickInputService: IQuickInputService, currentColor: string | undefined): Promise<IBookmarkColorPick | undefined> {
	const picks = createBookmarkColorPicks(currentColor);
	const { title, placeholder } = getBookmarkColorPickStrings();
	return quickInputService.pick(picks, { title, placeHolder: placeholder, activeItem: picks.find(pick => pick.color === currentColor) });
}
