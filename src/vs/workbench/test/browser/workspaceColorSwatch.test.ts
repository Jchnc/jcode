/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../base/browser/window.js';
import { Color } from '../../../base/common/color.js';
import { mock } from '../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { editorBackground } from '../../../platform/theme/common/colorRegistry.js';
import { ColorScheme } from '../../../platform/theme/common/theme.js';
import { IColorTheme } from '../../../platform/theme/common/themeService.js';
import { getRadioNavigationTarget, renderWorkspaceColorSwatch } from '../../browser/workspaceColorSwatch.js';
import { WORKSPACE_COLOR_PALETTE } from '../../common/workspaceColorPalette.js';

suite('Workspace color swatch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createTheme(type: ColorScheme, background?: string): IColorTheme {
		return new class extends mock<IColorTheme>() {
			override readonly type = type;
			override getColor(id: string) { return id === editorBackground && background ? Color.fromHex(background) : undefined; }
		}();
	}

	/** The marker of a swatch drawn in `theme`, and how it contrasts with the surface the swatch sits on. */
	function markerContrast(color: string, style: 'subtle' | 'prominent', theme: IColorTheme, surface: Color): number {
		const container = mainWindow.document.createElement('div');
		renderWorkspaceColorSwatch(container, 'Swatch', editorBackground).update(color, style, theme);
		const marker = Color.Format.CSS.parse(container.querySelector<HTMLElement>('.workspace-color-chip')!.style.backgroundColor)!;
		return surface.getContrastRatio(marker);
	}

	test('keeps the marker at least 3:1 against the background it is drawn on in high contrast themes', () => {
		const colors = [...WORKSPACE_COLOR_PALETTE.map(preset => preset.value), '#fde047', '#808080', '#000000', '#ffffff', '#ff00ff', '#1e3a8a'];
		const backgrounds: readonly (readonly [ColorScheme, string | undefined, string])[] = [
			[ColorScheme.HIGH_CONTRAST_DARK, undefined, '#000000'],
			[ColorScheme.HIGH_CONTRAST_LIGHT, undefined, '#ffffff'],
			// A high contrast theme that paints its own background, which the workbench background cannot predict.
			[ColorScheme.HIGH_CONTRAST_DARK, '#808080', '#808080'],
			[ColorScheme.HIGH_CONTRAST_LIGHT, '#1e3a8a', '#1e3a8a'],
		];
		const hidden: string[] = [];
		for (const [type, background, surface] of backgrounds) {
			for (const color of colors) {
				for (const style of ['subtle', 'prominent'] as const) {
					if (markerContrast(color, style, createTheme(type, background), Color.fromHex(surface)) < 3) {
						hidden.push(`${color} ${style} on ${surface}`);
					}
				}
			}
		}
		assert.deepStrictEqual(hidden, []);
	});

	test('moves between radios by row, column and end, wrapping around', () => {
		const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'];
		const targets = (index: number, count: number, columns?: number) => keys.map(key => getRadioNavigationTarget(key, index, count, columns));

		assert.deepStrictEqual({
			// Right, left, down, up, home, end, then a key that does not navigate.
			grid: { first: targets(0, 9, 3), middle: targets(4, 9, 3), last: targets(8, 9, 3) },
			uneven: { lastColumn: targets(7, 9, 2), lastRow: targets(8, 9, 2) },
			list: { first: targets(0, 2), last: targets(1, 2) },
			singleRow: targets(1, 3, 3),
		}, {
			grid: {
				first: [1, 8, 3, 6, 0, 8, undefined],
				middle: [5, 3, 7, 1, 0, 8, undefined],
				last: [0, 7, 2, 5, 0, 8, undefined],
			},
			uneven: {
				lastColumn: [8, 6, 1, 5, 0, 8, undefined],
				lastRow: [0, 7, 0, 6, 0, 8, undefined],
			},
			list: { first: [1, 1, 1, 1, 0, 1, undefined], last: [0, 0, 0, 0, 0, 1, undefined] },
			singleRow: [2, 0, 2, 0, 0, 2, undefined],
		});
	});
});
