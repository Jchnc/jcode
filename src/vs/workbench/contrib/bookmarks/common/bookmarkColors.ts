/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { asCssVariable, ColorIdentifier, darken, registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { registerThemingParticipant } from '../../../../platform/theme/common/themeService.js';
import { WORKBENCH_COLOR_PALETTE } from '../../../common/workbenchColorPalette.js';

/**
 * A color that a bookmark can be tagged with.
 */
export interface IBookmarkColor {
	/**
	 * The id of the color in the shared workbench color palette. This is what is stored with a bookmark.
	 */
	readonly id: string;
	readonly label: string;
	/**
	 * The theme color that the bookmark is shown in, so that it follows the color theme.
	 */
	readonly colorId: ColorIdentifier;
}

/**
 * The colors of the shared workbench color palette, the one that workspaces and editor tab groups use,
 * each as a theme color. The palette colors are bright, so they are darkened by enough to keep a contrast of
 * at least 3 to 1 on a white editor in the light themes, and more in the high contrast ones.
 */
export const BOOKMARK_COLORS: readonly IBookmarkColor[] = WORKBENCH_COLOR_PALETTE.map(({ id, value, label }) => ({
	id,
	label,
	colorId: registerColor(`editorBookmark.${id}Foreground`, { dark: value, light: darken(value, 0.35), hcDark: value, hcLight: darken(value, 0.5) }, localize('bookmarkColorForeground', "Color of the bookmark markers that are tagged with {0}.", label))
}));

/**
 * Finds a bookmark color by its id, which is `undefined` for a bookmark without a color.
 * An id that is not in the palette, such as one that was stored by another version, is not a color.
 */
export function getBookmarkColor(id: string | undefined): IBookmarkColor | undefined {
	return id === undefined ? undefined : BOOKMARK_COLORS.find(color => color.id === id);
}

/**
 * The class name that gives the gutter icon of a bookmark the color with the given id.
 */
export function getBookmarkColorClassName(id: string): string {
	return `jcode-bookmark-color-${id}`;
}

/**
 * The rules that color the gutter icons of bookmarks. The icon is a decoration, which can only be colored by a class,
 * so there is a rule for each color. They follow the theme through the variables of the theme colors.
 */
export function getBookmarkGlyphColorRules(): string[] {
	return BOOKMARK_COLORS.map(({ id, colorId }) => `.monaco-workbench .jcode-bookmark-glyph.codicon.${getBookmarkColorClassName(id)} { color: ${asCssVariable(colorId)}; }`);
}

registerThemingParticipant((_theme, collector) => {
	for (const rule of getBookmarkGlyphColorRules()) {
		collector.addRule(rule);
	}
});
