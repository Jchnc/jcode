/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';

/** Shared identity colors for workspaces and editor tab groups. */
export const WORKBENCH_COLOR_PALETTE = [
	{ id: 'grey', value: '#94a3b8', label: localize('color.slate', "Slate") },
	{ id: 'blue', value: '#60a5fa', label: localize('color.blue', "Blue") },
	{ id: 'cyan', value: '#22d3ee', label: localize('color.cyan', "Cyan") },
	{ id: 'teal', value: '#2dd4bf', label: localize('color.teal', "Teal") },
	{ id: 'red', value: '#fb7185', label: localize('color.rose', "Rose") },
	{ id: 'yellow', value: '#fbbf24', label: localize('color.amber', "Amber") },
	{ id: 'orange', value: '#fb923c', label: localize('color.orange', "Orange") },
	{ id: 'green', value: '#34d399', label: localize('color.emerald', "Emerald") },
	{ id: 'pink', value: '#f472b6', label: localize('color.pink', "Pink") },
	{ id: 'purple', value: '#a78bfa', label: localize('color.violet', "Violet") },
	{ id: 'indigo', value: '#818cf8', label: localize('color.indigo', "Indigo") },
] as const;
