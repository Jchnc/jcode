/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { isDark, isHighContrast } from '../../../../platform/theme/common/theme.js';
import { COMMAND_CENTER_ACTIVEBACKGROUND, COMMAND_CENTER_ACTIVEBORDER, COMMAND_CENTER_ACTIVEFOREGROUND, COMMAND_CENTER_BACKGROUND, COMMAND_CENTER_BORDER, COMMAND_CENTER_FOREGROUND, COMMAND_CENTER_INACTIVEBORDER, COMMAND_CENTER_INACTIVEFOREGROUND, MENUBAR_SELECTION_BACKGROUND, MENUBAR_SELECTION_FOREGROUND, MODERN_UI_INACTIVE_SHELL_BACKGROUND, MODERN_UI_SHELL_BACKGROUND, STATUS_BAR_BACKGROUND, STATUS_BAR_FOREGROUND, STATUS_BAR_INACTIVE_BACKGROUND, STATUS_BAR_ITEM_ACTIVE_BACKGROUND, STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND, STATUS_BAR_ITEM_HOVER_BACKGROUND, STATUS_BAR_ITEM_HOVER_FOREGROUND, STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_NO_FOLDER_FOREGROUND, TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_ACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_BACKGROUND, TITLE_BAR_INACTIVE_FOREGROUND, WORKBENCH_BACKGROUND } from '../../../common/theme.js';
import { getWorkspaceColorRamp } from '../../../common/workspaceColorPalette.js';
import { ColorThemeData } from '../common/colorThemeData.js';
import { IColorMap } from '../common/workbenchThemeService.js';
import { IWorkspaceAppearance } from '../common/workspaceAppearance.js';

/** Rebuild the runtime overlay from the underlying theme, never from a previous tint. */
export function updateWorkspaceColors(theme: ColorThemeData, appearance: IWorkspaceAppearance | undefined): void {
	theme.setWorkspaceColors({});
	if (!appearance || isHighContrast(theme.type)) {
		return;
	}
	const dark = isDark(theme.type);
	const ramp = getWorkspaceColorRamp(appearance.color, dark);
	const foreground = Color.fromHex(ramp.foreground);
	const inactiveForeground = Color.fromHex(ramp.inactiveForeground);
	const background = WORKBENCH_BACKGROUND(theme);
	const title = Color.fromHex(ramp[appearance.style]);
	const inactiveTitle = Color.fromHex(ramp.subtle).transparent(0.7).makeOpaque(background);
	const selectionBackground = (dark ? Color.white : Color.black).transparent(dark ? 0.08 : 0.055);
	const colors: IColorMap = {
		[TITLE_BAR_ACTIVE_BACKGROUND]: title,
		[TITLE_BAR_INACTIVE_BACKGROUND]: inactiveTitle,
		[TITLE_BAR_ACTIVE_FOREGROUND]: foreground,
		[TITLE_BAR_INACTIVE_FOREGROUND]: inactiveForeground,
		[STATUS_BAR_BACKGROUND]: title,
		[STATUS_BAR_INACTIVE_BACKGROUND]: inactiveTitle,
		[STATUS_BAR_NO_FOLDER_BACKGROUND]: title,
		[STATUS_BAR_FOREGROUND]: foreground,
		[STATUS_BAR_NO_FOLDER_FOREGROUND]: foreground,
		[STATUS_BAR_ITEM_HOVER_BACKGROUND]: selectionBackground,
		[STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND]: selectionBackground,
		[STATUS_BAR_ITEM_ACTIVE_BACKGROUND]: selectionBackground,
		[STATUS_BAR_ITEM_HOVER_FOREGROUND]: foreground,
		[MODERN_UI_SHELL_BACKGROUND]: title,
		[MODERN_UI_INACTIVE_SHELL_BACKGROUND]: inactiveTitle,
		[COMMAND_CENTER_FOREGROUND]: foreground,
		[COMMAND_CENTER_ACTIVEFOREGROUND]: foreground,
		[COMMAND_CENTER_INACTIVEFOREGROUND]: inactiveForeground,
		// Transparent treatments follow both active and inactive title surfaces and explicit overrides.
		[COMMAND_CENTER_BACKGROUND]: Color.black.transparent(dark ? 0.14 : 0.035),
		[COMMAND_CENTER_ACTIVEBACKGROUND]: (dark ? Color.white : Color.black).transparent(dark ? 0.06 : 0.055),
		[COMMAND_CENTER_BORDER]: foreground.transparent(0.18),
		[COMMAND_CENTER_ACTIVEBORDER]: foreground.transparent(0.3),
		[COMMAND_CENTER_INACTIVEBORDER]: inactiveForeground.transparent(0.22),
		[MENUBAR_SELECTION_FOREGROUND]: foreground,
		[MENUBAR_SELECTION_BACKGROUND]: selectionBackground
	};
	theme.setWorkspaceColors(colors);

	// Resolve the actual surfaces after settings overrides. Never replace a user's explicit ink.
	const activeSurface = theme.getColor(TITLE_BAR_ACTIVE_BACKGROUND)!.makeOpaque(background);
	const inactiveSurface = theme.getColor(TITLE_BAR_INACTIVE_BACKGROUND)!.makeOpaque(background);
	const statusSurface = theme.getColor(STATUS_BAR_BACKGROUND)!.makeOpaque(background);
	const inactiveStatusSurface = theme.getColor(STATUS_BAR_INACTIVE_BACKGROUND)?.makeOpaque(background) ?? statusSurface;
	const noFolderStatusSurface = theme.getColor(STATUS_BAR_NO_FOLDER_BACKGROUND)!.makeOpaque(background);
	const commandSurface = theme.getColor(COMMAND_CENTER_BACKGROUND)!;
	const commandHover = theme.getColor(COMMAND_CENTER_ACTIVEBACKGROUND)!;
	const menuHover = theme.getColor(MENUBAR_SELECTION_BACKGROUND)!;
	const statusHover = theme.getColor(STATUS_BAR_ITEM_HOVER_BACKGROUND)!;
	const statusCompactHover = theme.getColor(STATUS_BAR_ITEM_COMPACT_HOVER_BACKGROUND)!;
	const statusActive = theme.getColor(STATUS_BAR_ITEM_ACTIVE_BACKGROUND)!;
	const statusInteractionSurfaces = [statusSurface, inactiveStatusSurface, noFolderStatusSurface].flatMap(surface => [
		statusHover.makeOpaque(surface),
		statusCompactHover.makeOpaque(statusHover.makeOpaque(surface)),
		statusActive.makeOpaque(surface)
	]);
	for (const [foregroundId, surfaces] of [
		[TITLE_BAR_ACTIVE_FOREGROUND, [activeSurface]],
		[TITLE_BAR_INACTIVE_FOREGROUND, [inactiveSurface]],
		[STATUS_BAR_FOREGROUND, [statusSurface, inactiveStatusSurface]],
		[STATUS_BAR_NO_FOLDER_FOREGROUND, [noFolderStatusSurface]],
		[STATUS_BAR_ITEM_HOVER_FOREGROUND, statusInteractionSurfaces],
		[COMMAND_CENTER_FOREGROUND, [commandSurface.makeOpaque(activeSurface)]],
		[COMMAND_CENTER_ACTIVEFOREGROUND, [commandHover.makeOpaque(activeSurface)]],
		[COMMAND_CENTER_INACTIVEFOREGROUND, [commandSurface.makeOpaque(inactiveSurface), commandHover.makeOpaque(inactiveSurface)]],
		[MENUBAR_SELECTION_FOREGROUND, [menuHover.makeOpaque(activeSurface), menuHover.makeOpaque(inactiveSurface)]]
	] as const) {
		if (!theme.hasColorCustomization(foregroundId)) {
			if (foregroundId === STATUS_BAR_ITEM_HOVER_FOREGROUND) {
				colors[foregroundId] = theme.getColor(STATUS_BAR_FOREGROUND)!;
			}
			for (const surface of surfaces) {
				colors[foregroundId] = surface.ensureConstrast(colors[foregroundId].makeOpaque(surface), 4.5);
			}
		}
	}
	theme.setWorkspaceColors(colors);
}
