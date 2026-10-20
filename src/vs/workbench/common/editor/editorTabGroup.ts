/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon, getAllCodicons } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';
import { WORKBENCH_COLOR_PALETTE } from '../workbenchColorPalette.js';

/**
 * Data model and helpers for Chrome-like tab groups.
 *
 * A tab group is a named, colored, optionally-collapsed collection of
 * non-sticky editors that are rendered as a contiguous, visually distinct
 * segment of the editor tab bar. The model is intentionally kept small and
 * forward-compatible:
 *
 * - `color` may either reference one of the preset {@link EDITOR_TAB_GROUP_COLORS}
 *   identifiers or hold an arbitrary CSS color (`#hex`, `rgb(...)`, ...).
 * - `icon` and `metadata` are optional and currently unused by the core UI, but
 *   are reserved for extensions, themes and future features (custom icons,
 *   styles, context-menu actions, ...) without needing another model change.
 */

export interface IEditorTabGroup {
	readonly id: string;

	/** Human readable group name. */
	name: string;

	/**
	 * The group color. Either a preset identifier (see
	 * {@link EDITOR_TAB_GROUP_COLORS}) or an arbitrary CSS color value
	 * such as `#ff0000` or `rgb(255, 0, 0)`.
	 */
	color: string;

	/** Whether the group is collapsed (its tabs are hidden). */
	collapsed: boolean;

	/** Whether the group should be retained in the saved-groups collection when closed. */
	saved: boolean;

	/** Whether structural changes to the group are currently blocked. */
	locked: boolean;

	/** Optional icon (a codicon identifier) rendered on the group header. */
	icon?: string;

	/**
	 * Optional free-form metadata attached to the group. Reserved for
	 * extensions and future features.
	 */
	metadata?: Record<string, unknown>;
}

export interface IEditorTabGroupCreateOptions {
	readonly id?: string;
	readonly collapsed?: boolean;
	readonly saved?: boolean;
	readonly locked?: boolean;
	readonly icon?: string;
	readonly metadata?: Record<string, unknown>;
	readonly skipUndo?: boolean;
}

export interface IEditorTabGroupColor {
	readonly id: string;
	readonly value: string;
}

export const EDITOR_TAB_GROUP_COLORS: readonly IEditorTabGroupColor[] = WORKBENCH_COLOR_PALETTE;

export const DEFAULT_EDITOR_TAB_GROUP_COLOR = EDITOR_TAB_GROUP_COLORS[1].id; // 'blue'

/**
 * Resolves a group color to a concrete CSS color value. Preset identifiers are
 * looked up in {@link EDITOR_TAB_GROUP_COLORS}; any other string (custom hex,
 * rgb, named color, ...) is returned unchanged.
 */
export function getEditorTabGroupColor(color: string): string {
	const preset = EDITOR_TAB_GROUP_COLORS.find(c => c.id === color);
	return preset?.value ?? color;
}

/** Returns a random preset color identifier. */
export function getRandomEditorTabGroupColor(): string {
	const preset = EDITOR_TAB_GROUP_COLORS[Math.floor(Math.random() * EDITOR_TAB_GROUP_COLORS.length)];
	return preset.id;
}

/** A tab group icon offered in the icon pickers. */
export interface IEditorTabGroupIconOption {
	readonly icon: ThemeIcon;
	readonly label: string;
}

/**
 * The curated set of tab group icons. They all come from the outline codicon
 * family so that they look consistent next to each other at 16px.
 */
export const EDITOR_TAB_GROUP_ICONS: readonly IEditorTabGroupIconOption[] = [
	{ icon: Codicon.code, label: localize('tabGroup.iconCode', "Code") },
	{ icon: Codicon.folder, label: localize('tabGroup.iconFolder', "Folder") },
	{ icon: Codicon.repo, label: localize('tabGroup.iconRepository', "Repository") },
	{ icon: Codicon.globe, label: localize('tabGroup.iconGlobe', "Web") },
	{ icon: Codicon.server, label: localize('tabGroup.iconServer', "Server") },
	{ icon: Codicon.database, label: localize('tabGroup.iconDatabase', "Database") },
	{ icon: Codicon.terminal, label: localize('tabGroup.iconTerminal', "Terminal") },
	{ icon: Codicon.beaker, label: localize('tabGroup.iconTest', "Test") },
	{ icon: Codicon.tools, label: localize('tabGroup.iconTools', "Tools") },
	{ icon: Codicon.book, label: localize('tabGroup.iconDocs', "Docs") },
	{ icon: Codicon.paintcan, label: localize('tabGroup.iconDesign', "Design") },
	{ icon: Codicon.lock, label: localize('tabGroup.iconSecurity', "Security") },
	{ icon: Codicon.star, label: localize('tabGroup.iconStar', "Star") },
	{ icon: Codicon.bookmark, label: localize('tabGroup.iconBookmark', "Bookmark") },
	{ icon: Codicon.rocket, label: localize('tabGroup.iconRocket', "Release") },
	{ icon: Codicon.bug, label: localize('tabGroup.iconBug', "Bug") },
	{ icon: Codicon.settingsGear, label: localize('tabGroup.iconSettings', "Settings") },
	{ icon: Codicon.cloud, label: localize('tabGroup.iconCloud', "Cloud") },
	{ icon: Codicon.lightbulb, label: localize('tabGroup.iconIdea', "Idea") },
	{ icon: Codicon.briefcase, label: localize('tabGroup.iconWork', "Work") }
];

/**
 * Resolves a saved tab group icon identifier to a renderable icon. Identifiers
 * that are no longer part of {@link EDITOR_TAB_GROUP_ICONS} keep rendering as
 * long as they are valid codicons, and unknown identifiers fall back to a folder.
 */
export function resolveEditorTabGroupIcon(id: string): ThemeIcon {
	return getAllCodicons().find(codicon => codicon.id === id) ?? Codicon.folder;
}
