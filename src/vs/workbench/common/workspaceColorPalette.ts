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
		id: 'graphite', label: localize('workspaceColor.graphite', "Graphite"), value: '#8798ad', legacyColors: ['#94a3b8'],
		dark: { subtle: '#242931', prominent: '#303944', marker: '#8798ad' },
		light: { subtle: '#f0f2f5', prominent: '#e3e8ee', marker: '#596b7f' }
	},
	{
		id: 'ocean', label: localize('workspaceColor.ocean', "Ocean"), value: '#7298c8', legacyColors: ['#60a5fa'],
		dark: { subtle: '#202b39', prominent: '#283c55', marker: '#7298c8' },
		light: { subtle: '#eef3f9', prominent: '#dfe9f5', marker: '#4a6e99' }
	},
	{
		id: 'lagoon', label: localize('workspaceColor.lagoon', "Lagoon"), value: '#66a69f', legacyColors: ['#2dd4bf', '#22d3ee'],
		dark: { subtle: '#202e2e', prominent: '#29433f', marker: '#66a69f' },
		light: { subtle: '#edf5f3', prominent: '#dcece8', marker: '#417b74' }
	},
	{
		id: 'forest', label: localize('workspaceColor.forest', "Forest"), value: '#819f7b', legacyColors: ['#34d399'],
		dark: { subtle: '#272e26', prominent: '#354331', marker: '#819f7b' },
		light: { subtle: '#f0f4ee', prominent: '#e2ecdd', marker: '#5a7853' }
	},
	{
		id: 'sand', label: localize('workspaceColor.sand', "Sand"), value: '#c1a06a', legacyColors: ['#fbbf24'],
		dark: { subtle: '#302b23', prominent: '#493e2b', marker: '#c1a06a' },
		light: { subtle: '#f8f4eb', prominent: '#f1e6cf', marker: '#876c3f' }
	},
	{
		id: 'clay', label: localize('workspaceColor.clay', "Clay"), value: '#c59177', legacyColors: ['#fb923c'],
		dark: { subtle: '#302723', prominent: '#49352d', marker: '#c59177' },
		light: { subtle: '#f8f1ed', prominent: '#f1e0d6', marker: '#966348' }
	},
	{
		id: 'rose', label: localize('workspaceColor.rose', "Rose"), value: '#c18691', legacyColors: ['#fb7185', '#f472b6'],
		dark: { subtle: '#30252b', prominent: '#49313b', marker: '#c18691' },
		light: { subtle: '#f8eff2', prominent: '#f0dee5', marker: '#965864' }
	},
	{
		id: 'iris', label: localize('workspaceColor.iris', "Iris"), value: '#9d90bf', legacyColors: ['#a78bfa', '#818cf8'],
		dark: { subtle: '#292632', prominent: '#3c354c', marker: '#9d90bf' },
		light: { subtle: '#f3f0f8', prominent: '#e7e1f1', marker: '#71618f' }
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
	return { ...surface, foreground: dark ? '#e7e9ed' : '#28313f', inactiveForeground: dark ? '#b6bfca' : '#526071' };
}
