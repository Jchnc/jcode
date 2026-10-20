/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { match } from '../../../../base/common/glob.js';
import { ResourceSet } from '../../../../base/common/map.js';
import { Schemas } from '../../../../base/common/network.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { EDITOR_TAB_GROUP_COLORS } from '../../../common/editor/editorTabGroup.js';

export const TAB_AUTO_GROUP_RULES_SETTING = 'workbench.editor.tabGroups.autoGroupRules';

/** Adds the editors of the files that match a pattern to the tab group with the name of the rule. */
export interface ITabAutoGroupRule {

	/** The name of the tab group. */
	readonly name: string;

	/** A glob pattern that is relative to the workspace folder of a file, or an absolute one. */
	readonly pattern: string;

	/** The color of the tab group when it is created. */
	readonly color?: string;

	/** The icon (a codicon identifier) of the tab group when it is created. */
	readonly icon?: string;
}

/**
 * Reads the rules of the setting without trusting it. Rules that are not an object with a
 * name and a pattern are left out, the others are returned in the order they are listed in.
 */
export function parseTabAutoGroupRules(value: unknown): ITabAutoGroupRule[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const rules: ITabAutoGroupRule[] = [];
	for (const candidate of value as unknown[]) {
		if (typeof candidate !== 'object' || candidate === null) {
			continue;
		}

		const { name, pattern, color, icon } = candidate as Record<string, unknown>;
		if (readText(name) && readText(pattern)) {
			rules.push({ name: readText(name)!, pattern: readText(pattern)!, color: readText(color), icon: readText(icon) });
		}
	}

	return rules;
}

function readText(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

//#region Matching

/** Where a file is, which is what the patterns of the rules are matched against. */
export interface ITabAutoGroupResource {

	/** The full path of the file, separated by slashes. */
	readonly absolutePath: string;

	/** The path of the file in its workspace folder, separated by slashes, or `undefined` when it is not in a workspace folder. */
	readonly relativePath: string | undefined;
}

/** Describes where a file is. */
export function toTabAutoGroupResource(resource: URI, workspaceFolder: URI | undefined): ITabAutoGroupResource {
	return {
		absolutePath: normalizeAbsolutePath(resource.scheme === Schemas.file ? resource.fsPath : resource.path),
		relativePath: workspaceFolder ? relativePath(workspaceFolder, resource) : undefined
	};
}

const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

/** Whether a pattern is for the full path of a file instead of its path in the workspace folder. */
function isAbsolutePattern(pattern: string): boolean {
	return pattern.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(pattern);
}

/** Separates by slashes and ignores the case of the drive letter, so that `C:\work` and `c:/work` are the same. */
function normalizeAbsolutePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, drive => drive.toLowerCase());
}

/**
 * Finds the rule that applies to a file: the first rule, in the order they are listed in,
 * with a pattern that matches. Patterns that start with a drive or a slash are matched
 * against the full path, all others against the path in the workspace folder (or
 * against the full path without its leading slash for files that are not in one).
 */
export function findTabAutoGroupRule(rules: readonly ITabAutoGroupRule[], resource: ITabAutoGroupResource): ITabAutoGroupRule | undefined {
	const absolutePath = normalizeAbsolutePath(resource.absolutePath);

	return rules.find(rule => {
		if (isAbsolutePattern(rule.pattern)) {
			return match(normalizeAbsolutePath(rule.pattern), absolutePath);
		}

		return match(rule.pattern, resource.relativePath ?? absolutePath.replace(/^\//, ''));
	});
}

/** The color of the tab group of a rule that does not have one: the same one for the same name, so that the groups of a rule look alike everywhere. */
export function getTabAutoGroupColor(rule: ITabAutoGroupRule): string {
	if (rule.color) {
		return rule.color;
	}

	let hash = 0;
	for (let index = 0; index < rule.name.length; index++) {
		hash = (hash * 31 + rule.name.charCodeAt(index)) >>> 0;
	}

	return EDITOR_TAB_GROUP_COLORS[hash % EDITOR_TAB_GROUP_COLORS.length].id;
}

//#endregion

//#region Removals

/**
 * Finds the editors that left their tab group without being closed: the ones that were in
 * a tab group before and are open without one now.
 *
 * @param previous The tab group each editor was in, for the editors that were in one.
 * @param current The tab group of every open editor, `undefined` for the ones that are in none.
 */
export function findEditorsRemovedFromTabGroups<T>(previous: ReadonlyMap<T, string>, current: ReadonlyMap<T, string | undefined>): T[] {
	return [...previous.keys()].filter(editor => current.has(editor) && current.get(editor) === undefined);
}

/**
 * Remembers the files that the user removed from the tab groups of an editor group, which
 * rules must not add to a tab group again for as long as the window is open, also after the
 * editor of the file was closed and opened again. Files are forgotten when the user puts them
 * in a tab group again or when the editor group goes away.
 */
export class TabAutoGroupRemovals {

	private readonly removals = new Map<number, ResourceSet>();

	remember(groupId: number, resource: URI): void {
		let resources = this.removals.get(groupId);
		if (!resources) {
			resources = new ResourceSet();
			this.removals.set(groupId, resources);
		}

		resources.add(resource);
	}

	forget(groupId: number, resource: URI): void {
		this.removals.get(groupId)?.delete(resource);
	}

	forgetGroup(groupId: number): void {
		this.removals.delete(groupId);
	}

	has(groupId: number, resource: URI): boolean {
		return !!this.removals.get(groupId)?.has(resource);
	}
}

//#endregion
