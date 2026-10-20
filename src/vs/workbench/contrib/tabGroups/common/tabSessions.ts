/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_EDITOR_TAB_GROUP_COLOR } from '../../../common/editor/editorTabGroup.js';
import { EditorGroupLayout, GroupLayoutArgument, GroupOrientation } from '../../../services/editor/common/editorGroupsService.js';

/**
 * A tab session is a named snapshot of the editor layout of a window: the editor groups
 * and how they are arranged, the editors of each group in order, which of them is active
 * or sticky and the tab groups they are organized in.
 *
 * Everything in here is plain data that can be stored as JSON. Editors are kept in the
 * form their editor serializer produced, so that they come back as the same kind of editor.
 */

/** An editor of a session. */
export interface ITabSessionEditor {

	/** The type identifier of the editor, which selects the serializer to restore it with. */
	readonly typeId: string;

	/** The editor in the serialized form of its serializer. */
	readonly value: string;

	/** The name of the editor, to describe the session without restoring it. */
	readonly name: string;

	/** The description of the editor, usually its path. */
	readonly description?: string;
}

/** A tab group of an editor group of a session. */
export interface ITabSessionTabGroup {
	readonly name: string;
	readonly color: string;
	readonly icon?: string;
	readonly collapsed?: boolean;
	readonly saved?: boolean;
	readonly locked?: boolean;
	readonly metadata?: Record<string, unknown>;

	/** The indexes of the editors that are part of the group, ascending. */
	readonly members: readonly number[];
}

/** An editor group of a session. */
export interface ITabSessionEditorGroup {

	/** The editors of the group in the order of the tab bar. */
	readonly editors: readonly ITabSessionEditor[];

	/** The index of the active editor, if the group has editors. */
	readonly active?: number;

	/** The number of editors in front that are sticky (pinned to the front). */
	readonly stickyCount?: number;

	readonly locked?: boolean;
	readonly tabGroups?: readonly ITabSessionTabGroup[];
}

export interface ITabSession {
	readonly id: string;
	readonly name: string;

	/** When the session was saved, in milliseconds since the epoch. */
	readonly savedAt: number;

	/** How the editor groups are arranged. Its leaves are the entries of `groups`. */
	readonly layout: EditorGroupLayout;

	/** The editor groups in the order of the leaves of the layout. */
	readonly groups: readonly ITabSessionEditorGroup[];

	/** The index of the group that is active. */
	readonly activeGroup: number;
}

/** What the layout of a session tells about its contents, to describe it to the user. */
export interface ITabSessionSummary {
	readonly groupCount: number;
	readonly editorCount: number;
	readonly tabGroupCount: number;
}

//#region Capture

/** An editor group that is captured, in terms of what a session needs from it. */
export interface ITabSessionSourceGroup {
	readonly locked: boolean;

	/** The editors in the order of the tab bar. `editor` is undefined for editors that cannot be part of a session. */
	readonly editors: readonly { readonly editor: ITabSessionEditor | undefined; readonly tabGroupId?: string }[];

	/** The index of the active editor, `-1` for none. */
	readonly activeIndex: number;

	/** The number of editors in front that are sticky. */
	readonly stickyCount: number;

	readonly tabGroups: readonly {
		readonly id: string;
		readonly name: string;
		readonly color: string;
		readonly icon?: string;
		readonly collapsed: boolean;
		readonly saved: boolean;
		readonly locked: boolean;
		readonly metadata?: Record<string, unknown>;
	}[];
}

/**
 * Creates the session representation of an editor group. Editors that cannot be part of
 * a session are left out, which also takes them out of the tab groups and the sticky and
 * active state, like the layout of the window does when it is persisted.
 */
export function createTabSessionEditorGroup(source: ITabSessionSourceGroup): ITabSessionEditorGroup {
	const members = new Map<string, number[]>();
	source.editors.forEach(({ tabGroupId }, index) => {
		if (tabGroupId !== undefined) {
			members.set(tabGroupId, [...members.get(tabGroupId) ?? [], index]);
		}
	});

	const group: IEditorGroupShape = {
		active: source.activeIndex >= 0 ? source.activeIndex : undefined,
		stickyCount: source.stickyCount,
		tabGroups: source.tabGroups.flatMap(tabGroup => {
			const groupMembers = members.get(tabGroup.id);
			return groupMembers ? [{
				name: tabGroup.name,
				color: tabGroup.color,
				icon: tabGroup.icon,
				collapsed: tabGroup.collapsed || undefined,
				saved: tabGroup.saved || undefined,
				locked: tabGroup.locked || undefined,
				metadata: tabGroup.metadata,
				members: groupMembers
			}] : [];
		})
	};

	const { shape, keptIndexes } = compactEditorGroupShape(group, source.editors.length, index => source.editors[index].editor !== undefined);
	return {
		editors: keptIndexes.map(index => source.editors[index].editor!),
		active: shape.active,
		stickyCount: shape.stickyCount || undefined,
		locked: source.locked || undefined,
		tabGroups: shape.tabGroups?.length ? shape.tabGroups : undefined
	};
}

//#endregion

//#region Restore Planning

/** What to restore of an editor group of a session. */
export interface ITabSessionRestoreGroupPlan {

	/** The editor group with only the editors that are restored. */
	readonly group: ITabSessionEditorGroup;

	/** For each editor of `group` its index in the editor group of the session. */
	readonly editorIndexes: readonly number[];
}

export interface ITabSessionRestorePlan {
	readonly layout: EditorGroupLayout;
	readonly groups: readonly ITabSessionRestoreGroupPlan[];
	readonly activeGroup: number;

	/** The number of editors of the session that are not restored. */
	readonly skippedEditorCount: number;
}

/**
 * Plans how to restore a session when only some of its editors can be restored: the
 * others are left out, which moves the active editor, the sticky editors and the tab
 * groups along. Tab groups that lose all their editors are left out as well, editor
 * groups are always kept to preserve the layout.
 *
 * @param isRestorable Tells whether the editor with the given index in the given group
 * of the session can be restored.
 */
export function planTabSessionRestore(session: ITabSession, isRestorable: (groupIndex: number, editorIndex: number) => boolean): ITabSessionRestorePlan {
	let skippedEditorCount = 0;
	const groups = session.groups.map((group, groupIndex): ITabSessionRestoreGroupPlan => {
		const { shape, keptIndexes } = compactEditorGroupShape(group, group.editors.length, editorIndex => isRestorable(groupIndex, editorIndex));
		skippedEditorCount += group.editors.length - keptIndexes.length;
		return {
			group: {
				editors: keptIndexes.map(index => group.editors[index]),
				active: shape.active,
				stickyCount: shape.stickyCount,
				locked: group.locked,
				tabGroups: shape.tabGroups
			},
			editorIndexes: keptIndexes
		};
	});

	return { layout: session.layout, groups, activeGroup: session.activeGroup, skippedEditorCount };
}

//#endregion

//#region Editor Group Shape

/** The parts of an editor group that refer to its editors by index. */
interface IEditorGroupShape {
	readonly active?: number;
	readonly stickyCount?: number;
	readonly tabGroups?: readonly ITabSessionTabGroup[];
}

/**
 * Leaves editors out of an editor group and updates what refers to editors by index.
 *
 * - The active editor moves to the closest editor that is kept when it is left out.
 * - Only editors that are kept count as sticky, and a sticky editor never is a member of a tab group.
 * - An editor is a member of the first tab group that lists it, and groups without members are dropped.
 */
function compactEditorGroupShape(shape: IEditorGroupShape, editorCount: number, keep: (index: number) => boolean): { readonly shape: IEditorGroupShape; readonly keptIndexes: number[] } {
	const keptIndexes: number[] = [];
	const newIndexes = new Map<number, number>();
	for (let index = 0; index < editorCount; index++) {
		if (keep(index)) {
			newIndexes.set(index, keptIndexes.length);
			keptIndexes.push(index);
		}
	}

	const stickyCount = keptIndexes.filter(index => index < (shape.stickyCount ?? 0)).length;

	let active: number | undefined;
	if (keptIndexes.length > 0) {
		const activeIndex = Number.isInteger(shape.active) ? shape.active! : 0;
		active = newIndexes.get(activeIndex) ?? keptIndexes.findIndex(index => index > activeIndex);
		if (active === -1) {
			active = keptIndexes.length - 1;
		}
	}

	const grouped = new Set<number>();
	const tabGroups: ITabSessionTabGroup[] = [];
	for (const tabGroup of shape.tabGroups ?? []) {
		const members: number[] = [];
		for (const member of tabGroup.members) {
			const newIndex = newIndexes.get(member);
			if (newIndex !== undefined && newIndex >= stickyCount && !grouped.has(newIndex)) {
				members.push(newIndex);
			}
		}

		if (members.length > 0) {
			members.sort((first, second) => first - second);
			members.forEach(member => grouped.add(member));
			tabGroups.push({ ...tabGroup, members });
		}
	}

	return { shape: { active, stickyCount: stickyCount || undefined, tabGroups: tabGroups.length ? tabGroups : undefined }, keptIndexes };
}

//#endregion

//#region Describing

export function summarizeTabSession(session: ITabSession): ITabSessionSummary {
	return {
		groupCount: session.groups.length,
		editorCount: session.groups.reduce((count, group) => count + group.editors.length, 0),
		tabGroupCount: session.groups.reduce((count, group) => count + (group.tabGroups?.length ?? 0), 0)
	};
}

export const enum TabSessionNameProblem {
	Empty,
	Exists
}

/**
 * Validates the name for a session that is saved. A name that is in use is a problem
 * that the user can accept, as saving then replaces that session.
 */
export function validateTabSessionName(name: string, sessions: readonly ITabSession[]): TabSessionNameProblem | undefined {
	const trimmed = name.trim();
	if (!trimmed) {
		return TabSessionNameProblem.Empty;
	}

	return findTabSessionByName(sessions, trimmed) ? TabSessionNameProblem.Exists : undefined;
}

/** Finds a session by its name, which is not case sensitive. */
export function findTabSessionByName(sessions: readonly ITabSession[], name: string): ITabSession | undefined {
	const normalized = name.trim().toLowerCase();
	return sessions.find(session => session.name.trim().toLowerCase() === normalized);
}

//#endregion

//#region Storage

const TAB_SESSIONS_VERSION = 1;

interface IStoredTabSessions {
	readonly version: number;
	readonly sessions: readonly ITabSession[];
}

export function stringifyTabSessions(sessions: readonly ITabSession[]): string {
	const stored: IStoredTabSessions = { version: TAB_SESSIONS_VERSION, sessions };
	return JSON.stringify(stored);
}

/**
 * Reads stored sessions without trusting them: what cannot be made sense of is left
 * out, and what is left is made consistent, as in a session that lost an editor.
 */
export function parseTabSessions(raw: string | undefined): ITabSession[] {
	if (!raw) {
		return [];
	}

	let stored: unknown;
	try {
		stored = JSON.parse(raw);
	} catch {
		return [];
	}

	const sessions = isRecord(stored) && Array.isArray(stored.sessions) ? stored.sessions : [];
	const seenIds = new Set<string>();
	const result: ITabSession[] = [];
	for (const candidate of sessions) {
		const session = sanitizeTabSession(candidate);
		if (session && !seenIds.has(session.id)) {
			seenIds.add(session.id);
			result.push(session);
		}
	}

	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeTabSession(value: unknown): ITabSession | undefined {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.groups) || value.groups.length === 0) {
		return undefined;
	}

	const groups = value.groups.map(sanitizeEditorGroup);
	return {
		id: value.id,
		name: value.name.trim(),
		savedAt: typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : 0,
		layout: sanitizeLayout(value.layout, groups.length),
		groups,
		activeGroup: Number.isInteger(value.activeGroup) && Number(value.activeGroup) >= 0 && Number(value.activeGroup) < groups.length ? Number(value.activeGroup) : 0
	};
}

function sanitizeEditorGroup(value: unknown): ITabSessionEditorGroup {
	const group = isRecord(value) ? value : {};
	const editors = Array.isArray(group.editors) ? group.editors.map(sanitizeEditor) : [];

	const { shape, keptIndexes } = compactEditorGroupShape({
		active: typeof group.active === 'number' ? group.active : undefined,
		stickyCount: typeof group.stickyCount === 'number' ? group.stickyCount : undefined,
		tabGroups: Array.isArray(group.tabGroups) ? group.tabGroups.flatMap(sanitizeTabGroup) : undefined
	}, editors.length, index => editors[index] !== undefined);

	return {
		editors: keptIndexes.map(index => editors[index]!),
		active: shape.active,
		stickyCount: shape.stickyCount,
		locked: group.locked === true ? true : undefined,
		tabGroups: shape.tabGroups
	};
}

function sanitizeEditor(value: unknown): ITabSessionEditor | undefined {
	if (!isRecord(value) || typeof value.typeId !== 'string' || !value.typeId || typeof value.value !== 'string') {
		return undefined;
	}

	return {
		typeId: value.typeId,
		value: value.value,
		name: typeof value.name === 'string' ? value.name : '',
		description: typeof value.description === 'string' && value.description ? value.description : undefined
	};
}

function sanitizeTabGroup(value: unknown): ITabSessionTabGroup[] {
	if (!isRecord(value) || !Array.isArray(value.members)) {
		return [];
	}

	return [{
		name: typeof value.name === 'string' ? value.name : '',
		color: typeof value.color === 'string' && value.color ? value.color : DEFAULT_EDITOR_TAB_GROUP_COLOR,
		icon: typeof value.icon === 'string' && value.icon ? value.icon : undefined,
		collapsed: value.collapsed === true ? true : undefined,
		saved: value.saved === true ? true : undefined,
		locked: value.locked === true ? true : undefined,
		metadata: isRecord(value.metadata) ? value.metadata : undefined,
		members: value.members.filter((member): member is number => Number.isInteger(member))
	}];
}

/**
 * A layout is only usable when it has a leaf for each editor group, otherwise the groups
 * are arranged next to each other with the same size.
 */
function sanitizeLayout(value: unknown, groupCount: number): EditorGroupLayout {
	if (isRecord(value) && (value.orientation === GroupOrientation.HORIZONTAL || value.orientation === GroupOrientation.VERTICAL) && Array.isArray(value.groups) && value.groups.length > 0) {
		const groups = value.groups.map(sanitizeLayoutNode);
		if (groups.every(group => group !== undefined) && countLayoutLeaves(groups as GroupLayoutArgument[]) === groupCount) {
			return { orientation: value.orientation, groups: groups as GroupLayoutArgument[] };
		}
	}

	return { orientation: GroupOrientation.HORIZONTAL, groups: Array.from({ length: groupCount }, () => ({})) };
}

function sanitizeLayoutNode(value: unknown): GroupLayoutArgument | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const size = typeof value.size === 'number' && Number.isFinite(value.size) && value.size > 0 ? value.size : undefined;
	if (value.groups === undefined) {
		return { size };
	}
	if (!Array.isArray(value.groups) || value.groups.length === 0) {
		return undefined;
	}

	const groups = value.groups.map(sanitizeLayoutNode);
	return groups.every(group => group !== undefined) ? { size, groups: groups as GroupLayoutArgument[] } : undefined;
}

function countLayoutLeaves(groups: readonly GroupLayoutArgument[]): number {
	return groups.reduce((count, group) => count + (group.groups ? countLayoutLeaves(group.groups) : 1), 0);
}

/**
 * Creates a copy of a layout that can be applied. Applying a layout changes it, which
 * must not happen to the layout of a session.
 */
export function cloneTabSessionLayout(layout: EditorGroupLayout): EditorGroupLayout {
	const cloneNode = (node: GroupLayoutArgument): GroupLayoutArgument => node.groups ? { size: node.size, groups: node.groups.map(cloneNode) } : { size: node.size };
	return { orientation: layout.orientation, groups: layout.groups.map(cloneNode) };
}

//#endregion
