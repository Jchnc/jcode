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

/** Why a preview stopped being the active one. */
export const enum WorkspaceAppearancePreviewEnd {
	/** The owner saved it. */
	Applied,
	/** The owner disposed it without saving, or the workspace changed. */
	Cancelled,
	/** Another preview started and took over. */
	Superseded
}

/**
 * A preview is rolled back on disposal unless it has been applied. It only ever
 * changes its own state: once it has ended, `update`, `apply` and `dispose`
 * leave the workspace and any newer preview alone.
 */
export interface IWorkspaceAppearancePreview extends IDisposable {
	/** Whether this preview is still the one being shown. */
	readonly isActive: boolean;
	/**
	 * Fires once when this preview stops being active, whoever ended it. An owner
	 * that is {@link WorkspaceAppearancePreviewEnd.Superseded} should resync to
	 * {@link IWorkspaceAppearanceService.appearance} and must not answer by starting
	 * another preview on its own, which would take the preview back from the new owner.
	 */
	readonly onDidEnd: Event<WorkspaceAppearancePreviewEnd>;
	update(appearance: IWorkspaceAppearance | undefined): void;
	/** Saves the previewed appearance. Returns `false`, saving nothing, if the preview is no longer active. */
	apply(): boolean;
}

export interface IWorkspaceAppearanceService {
	readonly _serviceBrand: undefined;
	readonly appearance: IWorkspaceAppearance | undefined;
	readonly onDidChangeAppearance: Event<void>;
	/**
	 * Starts a preview from the saved appearance. Only one preview is active at a
	 * time: starting a new one ends the previous one as superseded.
	 */
	beginPreview(): IWorkspaceAppearancePreview;
}

/** Normalize supported opaque hex colors; reject incomplete input. */
export function normalizeWorkspaceColor(value: string): string | undefined {
	if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
		return undefined;
	}
	return (value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value).toLowerCase();
}
