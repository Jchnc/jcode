/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Color } from '../../../base/common/color.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { ensureContrastOnSurfaces, getWorkspaceColorPreset, getWorkspaceColorRamp, getWorkspaceColorSwatch, WORKSPACE_COLOR_PALETTE } from '../../common/workspaceColorPalette.js';

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

	test('keeps markers and text readable on every title bar surface for light, dark and saturated colors', () => {
		const colors = ['#fde047', '#f5f5f5', '#1e3a8a', '#111111', '#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffff00', '#808080'];
		const failures: string[] = [];
		for (const color of colors) {
			for (const dark of [true, false]) {
				const workbenchBackground = Color.fromHex(dark ? '#1f1f1f' : '#ffffff');
				const ramp = getWorkspaceColorRamp(color, dark);
				for (const style of ['subtle', 'prominent'] as const) {
					const surfaces = [Color.fromHex(ramp[style]), Color.fromHex(ramp.subtle).transparent(0.7).makeOpaque(workbenchBackground)];
					for (const [name, foreground, ratio] of [['marker', ramp.marker, 3], ['text', ramp.foreground, 4.5]] as const) {
						const adjusted = ensureContrastOnSurfaces(Color.fromHex(foreground), surfaces, ratio);
						if (surfaces.some(surface => surface.getContrastRatio(adjusted) < ratio)) {
							failures.push(`${color} ${dark ? 'dark' : 'light'} ${style} ${name}`);
						}
					}
				}
			}
		}
		assert.deepStrictEqual(failures, []);
	});

	test('draws every swatch marker visibly on the surface it tints', () => {
		const colors = [...WORKSPACE_COLOR_PALETTE.map(preset => preset.value), '#ffff00', '#00ff00', '#ff00ff', '#0000ff', '#f5f5f5', '#111111'];
		const hidden: string[] = [];
		for (const color of colors) {
			for (const dark of [true, false]) {
				for (const style of ['subtle', 'prominent'] as const) {
					const swatch = getWorkspaceColorSwatch(color, style, dark);
					if (Color.fromHex(swatch.surface).getContrastRatio(Color.fromHex(swatch.marker)) < 3 || Color.fromHex(swatch.surface).getContrastRatio(Color.fromHex(swatch.foreground)) < 4.5) {
						hidden.push(`${color} ${dark ? 'dark' : 'light'} ${style}`);
					}
				}
			}
		}
		assert.deepStrictEqual(hidden, []);
	});

	test('draws the marker for the surface a swatch is actually drawn on', () => {
		const plain = Color.fromHex('#808080');
		const tinted = getWorkspaceColorSwatch('#808080', 'subtle', true);
		const untinted = getWorkspaceColorSwatch('#808080', 'subtle', true, plain);

		assert.deepStrictEqual({
			tintedMarkerOnPlain: plain.getContrastRatio(Color.fromHex(tinted.marker)) >= 3,
			untintedMarkerOnPlain: plain.getContrastRatio(Color.fromHex(untinted.marker)) >= 3,
			sameSurface: untinted.surface === tinted.surface,
		}, {
			tintedMarkerOnPlain: false,
			untintedMarkerOnPlain: true,
			sameSurface: true,
		});
	});

	test('resolves contrast against all surfaces at once instead of one pass after another', () => {
		const marker = Color.fromHex('#a3a666');
		const surfaces = [Color.fromHex('#f43384'), Color.fromHex('#e89c03')];
		const meetsAll = (color: Color) => surfaces.every(surface => surface.getContrastRatio(color) >= 3);
		const sequential = surfaces.reduce((color, surface) => surface.ensureConstrast(color, 3), marker);
		const together = ensureContrastOnSurfaces(marker, surfaces, 3);

		assert.deepStrictEqual({
			sequentialMeetsAll: meetsAll(sequential),
			togetherMeetsAll: meetsAll(together),
			sameForAnyOrder: together.equals(ensureContrastOnSurfaces(marker, [...surfaces].reverse(), 3)),
			stableWhenRepeated: together.equals(ensureContrastOnSurfaces(together, surfaces, 3)),
		}, {
			sequentialMeetsAll: false,
			togetherMeetsAll: true,
			sameForAnyOrder: true,
			stableWhenRepeated: true,
		});
	});

	test('leaves compliant colors alone and favors the first surface when none can serve them all', () => {
		const compliant = Color.fromHex('#ffffff');
		const surfaces = [Color.fromHex('#444444'), Color.fromHex('#dddddd')];
		const marker = Color.fromHex('#888888');
		const adjusted = ensureContrastOnSurfaces(marker, surfaces, 3);

		assert.deepStrictEqual({
			compliantUnchanged: ensureContrastOnSurfaces(compliant, [Color.fromHex('#222222')], 3) === compliant,
			firstSurfaceMet: surfaces[0].getContrastRatio(adjusted) >= 3,
			sameAsFirstAlone: adjusted.equals(ensureContrastOnSurfaces(marker, [surfaces[0]], 3)),
			withoutSurfaces: ensureContrastOnSurfaces(marker, [], 3) === marker,
		}, {
			compliantUnchanged: true,
			firstSurfaceMet: true,
			sameAsFirstAlone: true,
			withoutSurfaces: true,
		});
	});
});
