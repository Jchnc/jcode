/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workspaceColorSwatch.css';
import { $, append } from '../../base/browser/dom.js';
import { Codicon } from '../../base/common/codicons.js';
import { ThemeIcon } from '../../base/common/themables.js';
import { isDark, isHighContrast } from '../../platform/theme/common/theme.js';
import { IColorTheme } from '../../platform/theme/common/themeService.js';
import { getWorkspaceColorSwatch } from '../common/workspaceColorPalette.js';
import { IWorkspaceAppearance } from '../services/themes/common/workspaceAppearance.js';

/** A swatch drawn by {@link renderWorkspaceColorSwatch}. */
export interface IWorkspaceColorSwatch {
	/**
	 * Draw the surface `color` tints in `theme`, with its identity marker on top. Without a color
	 * the swatch shows the untinted surface. High contrast themes are never tinted, so only the
	 * marker is drawn.
	 */
	update(color: string | undefined, style: IWorkspaceAppearance['style'], theme: IColorTheme): void;
}

/**
 * Render the swatch every workspace color picker shares into `container`: a marker, a name, and a
 * check that appears while `container` is marked `aria-checked` or `aria-pressed`. The container
 * owns its role, state and behavior.
 */
export function renderWorkspaceColorSwatch(container: HTMLElement, label: string): IWorkspaceColorSwatch {
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
			const swatch = getWorkspaceColorSwatch(color, style, dark);
			const tinted = !isHighContrast(theme.type);
			container.style.backgroundColor = tinted ? swatch.surface : '';
			container.style.color = tinted ? swatch.foreground : '';
			marker.style.backgroundColor = swatch.marker;
		}
	};
}
