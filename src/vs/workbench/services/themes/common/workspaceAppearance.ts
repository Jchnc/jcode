/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const WORKSPACE_COLOR_COMMAND_ID = 'workbench.action.workspaceColor';
export const IWorkspaceAppearanceService = createDecorator<IWorkspaceAppearanceService>('workspaceAppearanceService');

/** Local workspace identity, independent of the selected color theme. */
export interface IWorkspaceAppearance {
	readonly color: string;
	readonly style: 'subtle' | 'prominent';
}

/** A preview is rolled back on disposal unless it has been applied. */
export interface IWorkspaceAppearancePreview extends IDisposable {
	update(appearance: IWorkspaceAppearance | undefined): void;
	apply(): void;
}

export interface IWorkspaceAppearanceService {
	readonly _serviceBrand: undefined;
	readonly appearance: IWorkspaceAppearance | undefined;
	readonly onDidChangeAppearance: Event<void>;
	beginPreview(): IWorkspaceAppearancePreview;
}

/** Normalize supported opaque hex colors; reject incomplete input. */
export function normalizeWorkspaceColor(value: string): string | undefined {
	if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
		return undefined;
	}
	return (value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value).toLowerCase();
}
