/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workspaceColorSwatch.css';
import { $, append } from '../../base/browser/dom.js';
import { Codicon } from '../../base/common/codicons.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { isDark, isHighContrast } from '../../platform/theme/common/theme.js';
import { menuBackground } from '../../platform/theme/common/colorRegistry.js';
import { ColorIdentifier } from '../../platform/theme/common/colorUtils.js';
import { IColorTheme } from '../../platform/theme/common/themeService.js';
import { WORKBENCH_BACKGROUND } from '../common/theme.js';
import { getWorkspaceColorSwatch } from '../common/workspaceColorPalette.js';
import { IWorkspaceAppearance } from '../services/themes/common/workspaceAppearance.js';

/** A swatch drawn by {@link renderWorkspaceColorSwatch}. */
export interface IWorkspaceColorSwatch {
	/**
	 * Draw the surface `color` tints in `theme`, with its identity marker on top. Without a color
	 * the swatch shows the untinted surface. High contrast themes are never tinted, so only the
	 * marker is drawn, and it stays visible on the plain background the swatch sits on there.
	 */
	update(color: string | undefined, style: IWorkspaceAppearance['style'], theme: IColorTheme): void;
}

/**
 * Render the swatch every workspace color picker shares into `container`: a marker, a name, and a
 * check that appears while `container` is marked `aria-checked` or `aria-pressed`. The container
 * owns its role, state and behavior.
 *
 * `plainBackground` is the color the container is painted with when it is not tinted. It defaults to
 * the menu background, which is what the stylesheet uses unless the host overrides it.
 */
export function renderWorkspaceColorSwatch(container: HTMLElement, label: string, plainBackground: ColorIdentifier = menuBackground): IWorkspaceColorSwatch {
	container.classList.add('workspace-color-swatch');
	const marker = append(container, $('span.workspace-color-chip', { 'aria-hidden': 'true' }));
	append(container, $('span.workspace-color-swatch-name', undefined, label));
	append(container, $('span.workspace-color-check', { 'aria-hidden': 'true' })).classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
	return {
		update: (color, style, theme) => {
			const dark = isDark(theme.type);
			marker.classList.toggle('no-color', !color);
			if (!color) {
				container.style.backgroundColor = '';
				container.style.color = '';
				marker.style.backgroundColor = '';
				return;
			}
			const tinted = !isHighContrast(theme.type);
			const swatch = getWorkspaceColorSwatch(color, style, dark, tinted ? undefined : getPlainSurface(theme, plainBackground));
			container.style.backgroundColor = tinted ? swatch.surface : '';
			container.style.color = tinted ? swatch.foreground : '';
			marker.style.backgroundColor = swatch.marker;
		}
	};
}

/** The opaque surface an untinted swatch is drawn on. */
function getPlainSurface(theme: IColorTheme, background: ColorIdentifier) {
	const fallback = WORKBENCH_BACKGROUND(theme);
	return theme.getColor(background)?.makeOpaque(fallback) ?? fallback;
}

/**
 * Where an arrow, Home or End key moves focus in a group of `count` radios laid out in rows of `columns`,
 * or `undefined` for any other key. Moving past either end wraps around to the other: left and right
 * through the whole group, up and down within the column. A group that fits in a single row moves
 * up and down like left and right.
 */
export function getRadioNavigationTarget(key: string, index: number, count: number, columns = 1): number | undefined {
	const rowLength = columns < count ? Math.max(columns, 1) : 1;
	const column = index % rowLength;
	switch (key) {
		case 'ArrowRight': return (index + 1) % count;
		case 'ArrowLeft': return (index + count - 1) % count;
		case 'ArrowDown': return index + rowLength < count ? index + rowLength : column;
		case 'ArrowUp': return index - rowLength >= 0 ? index - rowLength : column + (Math.ceil((count - column) / rowLength) - 1) * rowLength;
		case 'Home': return 0;
		case 'End': return count - 1;
		default: return undefined;
	}
}
