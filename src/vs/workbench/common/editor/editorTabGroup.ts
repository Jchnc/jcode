/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export const EDITOR_TAB_GROUP_COLORS: readonly IEditorTabGroupColor[] = [
	{ id: 'grey', value: '#94a3b8' },
	{ id: 'blue', value: '#60a5fa' },
	{ id: 'cyan', value: '#22d3ee' },
	{ id: 'teal', value: '#2dd4bf' },
	{ id: 'red', value: '#fb7185' },
	{ id: 'yellow', value: '#fbbf24' },
	{ id: 'orange', value: '#fb923c' },
	{ id: 'green', value: '#34d399' },
	{ id: 'pink', value: '#f472b6' },
	{ id: 'purple', value: '#a78bfa' },
	{ id: 'indigo', value: '#818cf8' },
];

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
