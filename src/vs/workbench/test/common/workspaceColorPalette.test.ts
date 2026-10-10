/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Color } from '../../../base/common/color.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { getWorkspaceColorPreset, getWorkspaceColorRamp, WORKSPACE_COLOR_PALETTE } from '../../common/workspaceColorPalette.js';

suite('Workspace color palette', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses distinct identities and migrates previous presets', () => {
		assert.strictEqual(new Set(WORKSPACE_COLOR_PALETTE.map(color => color.id)).size, WORKSPACE_COLOR_PALETTE.length);
		assert.strictEqual(new Set(WORKSPACE_COLOR_PALETTE.map(color => color.value)).size, WORKSPACE_COLOR_PALETTE.length);

		const chromaticHues = WORKSPACE_COLOR_PALETTE.slice(1).map(color => Color.fromHex(color.value).hsla.h);
		for (let index = 0; index < chromaticHues.length; index++) {
			for (let other = index + 1; other < chromaticHues.length; other++) {
				const distance = Math.abs(chromaticHues[index] - chromaticHues[other]);
				assert.ok(Math.min(distance, 360 - distance) >= 30, 'Workspace identity hues must remain visually distinct.');
			}
		}

		for (const legacy of ['#8798ad', '#7298c8', '#66a69f', '#819f7b', '#c1a06a', '#c59177', '#c18691', '#9d90bf']) {
			assert.ok(getWorkspaceColorPreset(legacy), `Expected legacy color ${legacy} to resolve to a current preset.`);
		}
	});

	test('maintains readable text and visible markers on every surface', () => {
		for (const preset of WORKSPACE_COLOR_PALETTE) {
			for (const dark of [true, false]) {
				const ramp = getWorkspaceColorRamp(preset.value, dark);
				const foreground = Color.fromHex(ramp.foreground);
				const marker = Color.fromHex(ramp.marker);
				for (const value of [ramp.subtle, ramp.prominent]) {
					const surface = Color.fromHex(value);
					assert.ok(surface.getContrastRatio(foreground) >= 4.5, `${preset.id} text must meet WCAG AA contrast.`);
					assert.ok(surface.getContrastRatio(marker) >= 3, `${preset.id} marker must remain visible.`);
				}
			}
		}
	});
});
