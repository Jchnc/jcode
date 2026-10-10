/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color, HSLA } from '../../base/common/color.js';
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
