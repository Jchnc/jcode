/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color, HSLA, RGBA } from '../../base/common/color.js';
import { hash } from '../../base/common/hash.js';
import { URI } from '../../base/common/uri.js';
import { localize } from '../../nls.js';

interface IWorkspaceColorSurface {
	readonly subtle: string;
	readonly prominent: string;
	readonly marker: string;
}

interface IWorkspaceColorPreset {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly legacyColors: readonly string[];
	readonly dark: IWorkspaceColorSurface;
	readonly light: IWorkspaceColorSurface;
}

/** Handcrafted chrome surfaces; identity markers are intentionally stronger than the window frame. */
export const WORKSPACE_COLOR_PALETTE: readonly IWorkspaceColorPreset[] = [
	{
		id: 'graphite', label: localize('workspaceColor.graphite', "Graphite"), value: '#64748b', legacyColors: ['#8798ad', '#94a3b8'],
		dark: { subtle: '#232831', prominent: '#313946', marker: '#94a3b8' },
		light: { subtle: '#eef1f4', prominent: '#dfe5eb', marker: '#475569' }
	},
	{
		id: 'azure', label: localize('workspaceColor.azure', "Azure"), value: '#3b82f6', legacyColors: ['#7298c8', '#60a5fa'],
		dark: { subtle: '#1d293d', prominent: '#243b5a', marker: '#60a5fa' },
		light: { subtle: '#eef4fc', prominent: '#dce9fa', marker: '#2563eb' }
	},
	{
		id: 'lagoon', label: localize('workspaceColor.lagoon', "Lagoon"), value: '#0d9488', legacyColors: ['#66a69f', '#2dd4bf', '#22d3ee'],
		dark: { subtle: '#162d2c', prominent: '#17443f', marker: '#2dd4bf' },
		light: { subtle: '#eaf7f5', prominent: '#d5eee9', marker: '#0f766e' }
	},
	{
		id: 'jade', label: localize('workspaceColor.jade', "Jade"), value: '#16a34a', legacyColors: ['#819f7b', '#34d399'],
		dark: { subtle: '#1b2d25', prominent: '#244735', marker: '#4ade80' },
		light: { subtle: '#edf7f1', prominent: '#d9efdf', marker: '#15803d' }
	},
	{
		id: 'lime', label: localize('workspaceColor.lime', "Lime"), value: '#65a30d', legacyColors: [],
		dark: { subtle: '#252d18', prominent: '#36451d', marker: '#a3e635' },
		light: { subtle: '#f3f8e9', prominent: '#e5efcc', marker: '#4d7c0f' }
	},
	{
		id: 'amber', label: localize('workspaceColor.amber', "Amber"), value: '#d97706', legacyColors: ['#c1a06a', '#fbbf24'],
		dark: { subtle: '#30291b', prominent: '#4a3920', marker: '#fbbf24' },
		light: { subtle: '#fbf5e8', prominent: '#f5e6c6', marker: '#b45309' }
	},
	{
		id: 'coral', label: localize('workspaceColor.coral', "Coral"), value: '#e11d48', legacyColors: ['#c59177', '#fb923c', '#c18691', '#fb7185'],
		dark: { subtle: '#322127', prominent: '#4c2934', marker: '#fb7185' },
		light: { subtle: '#fbf0f2', prominent: '#f5dce2', marker: '#be123c' }
	},
	{
		id: 'orchid', label: localize('workspaceColor.orchid', "Orchid"), value: '#9333ea', legacyColors: ['#9d90bf', '#a78bfa', '#818cf8', '#f472b6'],
		dark: { subtle: '#2a2238', prominent: '#402d57', marker: '#c084fc' },
		light: { subtle: '#f6f0fb', prominent: '#eadcf6', marker: '#7e22ce' }
	}
];

/** Recognize existing workspace selections without rewriting their stored appearance. */
export function getWorkspaceColorPreset(color: string | undefined): IWorkspaceColorPreset | undefined {
	return WORKSPACE_COLOR_PALETTE.find(preset => preset.value === color || (color !== undefined && preset.legacyColors.includes(color)));
}

/** The scheme the JCode SFTP extension registers its file system under, in extensions/jcode-sftp/src/extension.ts. */
const JCODE_SFTP_SCHEME = 'jcode-sftp';

/**
 * The palette color a workspace gets on its own, so that the window of a remote workspace is recognized
 * at a glance, or `undefined` for a workspace that is not entirely on the JCode SFTP file system.
 *
 * A folder names the connection it is on by its authority, which is all the workbench knows about the
 * remote, so the color follows the connection: stable for as long as the saved connection is, and the same
 * whichever order the folders come in. Of several connections the first by name decides. Graphite, the
 * neutral color, is never chosen, as it would not set a remote window apart.
 */
export function getAutomaticWorkspaceColor(folders: readonly URI[]): string | undefined {
	if (!folders.length || folders.some(folder => folder.scheme !== JCODE_SFTP_SCHEME)) {
		return undefined;
	}
	const remote = folders.map(folder => folder.authority.toLowerCase()).filter(authority => authority).sort()[0];
	if (remote === undefined) {
		return undefined;
	}
	const colors = WORKSPACE_COLOR_PALETTE.filter(preset => preset.id !== 'graphite');
	return colors[(hash(remote) >>> 0) % colors.length].value;
}

const CONTRAST_STEPS = 100;

/** Smallest shift of `foreground` toward white or black, in whole steps, that meets `ratio` on all `surfaces`. */
function shiftForContrast(foreground: Color, surfaces: readonly Color[], ratio: number): Color | undefined {
	const worstContrast = (color: Color) => Math.min(...surfaces.map(surface => surface.getContrastRatio(color)));
	if (worstContrast(foreground) >= ratio) {
		return foreground;
	}
	const { r, g, b } = foreground.rgba;
	let best: { readonly color: Color; readonly step: number; readonly contrast: number } | undefined;
	for (const target of [255, 0]) {
		for (let step = 1; step <= CONTRAST_STEPS; step++) {
			const amount = step / CONTRAST_STEPS;
			const color = new Color(new RGBA(Math.round(r + (target - r) * amount), Math.round(g + (target - g) * amount), Math.round(b + (target - b) * amount)));
			const contrast = worstContrast(color);
			if (contrast >= ratio) {
				if (!best || step < best.step || (step === best.step && contrast > best.contrast)) {
					best = { color, step, contrast };
				}
				break;
			}
		}
	}
	return best?.color;
}

/**
 * Adjust an opaque `foreground` once so that it meets `ratio` on every one of the opaque `surfaces`.
 * Adjusting for one surface after another lets a later pass undo an earlier one, so all of them are
 * solved together. Surfaces are listed by priority: if no color can satisfy all of them, the least
 * important are dropped until one can, which always happens for the first surface alone at the
 * contrast ratios used for text and markers.
 */
export function ensureContrastOnSurfaces(foreground: Color, surfaces: readonly Color[], ratio: number): Color {
	for (let count = surfaces.length; count > 0; count--) {
		const adjusted = shiftForContrast(foreground, surfaces.slice(0, count), ratio);
		if (adjusted) {
			return adjusted;
		}
	}
	if (!surfaces.length) {
		return foreground;
	}
	// The ratio cannot be met at all on the first surface: use whichever extreme comes closest.
	return surfaces[0].getContrastRatio(Color.black) > surfaces[0].getContrastRatio(Color.white) ? Color.black : Color.white;
}

/**
 * The tinted title bar a workspace color produces, and the identity marker that stays visible on it.
 * A swatch that is drawn without the tint, as in high contrast themes, passes the opaque `markerSurface`
 * it is drawn on instead, so that the marker stays visible there rather than on a surface that is not shown.
 */
export function getWorkspaceColorSwatch(color: string, style: 'subtle' | 'prominent', dark: boolean, markerSurface?: Color): { readonly surface: string; readonly foreground: string; readonly marker: string } {
	const ramp = getWorkspaceColorRamp(color, dark);
	const surface = Color.fromHex(ramp[style]);
	return { surface: surface.toString(), foreground: ramp.foreground, marker: ensureContrastOnSurfaces(Color.fromHex(ramp.marker), [markerSurface ?? surface], 3).toString() };
}

export function getWorkspaceColorRamp(color: string, dark: boolean): IWorkspaceColorSurface & { readonly foreground: string; readonly inactiveForeground: string } {
	const preset = getWorkspaceColorPreset(color);
	const { h, s } = Color.fromHex(color).hsla;
	const surface = preset ? dark ? preset.dark : preset.light : {
		subtle: new Color(new HSLA(h, Math.min(s, 0.22), dark ? 0.16 : 0.95, 1)).toString(),
		prominent: new Color(new HSLA(h, Math.min(s, 0.3), dark ? 0.23 : 0.89, 1)).toString(),
		marker: color
	};
	return { ...surface, foreground: dark ? '#f4f6f8' : '#1f2937', inactiveForeground: dark ? '#bdc6d1' : '#526071' };
}
