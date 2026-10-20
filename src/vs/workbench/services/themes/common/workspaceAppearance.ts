/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const WORKSPACE_COLOR_COMMAND_ID = 'workbench.action.workspaceColor';

/** Whether a workspace on the JCode SFTP file system gets a color of its own until the user chooses one. */
export const WORKSPACE_COLOR_AUTO_REMOTE_SETTING = 'workbench.workspaceColor.autoRemote';

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
	/**
	 * Previews the color the user chooses: `undefined` is the choice of no color, which keeps a color
	 * that would be given automatically away too.
	 */
	update(appearance: IWorkspaceAppearance | undefined): void;
	/** Previews going back to the default, which is the automatic color for a workspace that has one, and no color otherwise. */
	useDefault(): void;
	/** Saves the previewed appearance. Returns `false`, saving nothing, if the preview is no longer active. */
	apply(): boolean;
}

export interface IWorkspaceAppearanceService {
	readonly _serviceBrand: undefined;
	/**
	 * What the workspace shows: the color the user chose for it, or the automatic one when they have not
	 * chosen, or nothing. While a preview is active, what that previews instead.
	 */
	readonly appearance: IWorkspaceAppearance | undefined;
	/** Whether {@link appearance} is the color given to the workspace automatically, rather than one the user chose. */
	readonly isAutomatic: boolean;
	/** Whether the user has chosen for this workspace, a color or none, instead of leaving it to the default. */
	readonly hasChoice: boolean;
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

/**
 * The most a hex color field accepts. `#rrggbb` is 7 characters, and the rest leaves room for the
 * surrounding space a pasted color often carries, which {@link parseWorkspaceColorInput} ignores.
 */
export const WORKSPACE_COLOR_INPUT_MAX_LENGTH = 16;

/** Read a typed or pasted color: surrounding space and a missing leading `#` are tolerated. */
export function parseWorkspaceColorInput(value: string): string | undefined {
	const trimmed = value.trim();
	return normalizeWorkspaceColor(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
}
