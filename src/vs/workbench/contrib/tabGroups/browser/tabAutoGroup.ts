/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorGroupView, isEditorGroupView } from '../../../browser/parts/editor/editor.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorResourceAccessor, GroupIdentifier, GroupModelChangeKind, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IGroupModelChangeEvent } from '../../../common/editor/editorGroupModel.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { findEditorsRemovedFromTabGroups, findTabAutoGroupRule, getTabAutoGroupColor, ITabAutoGroupRule, parseTabAutoGroupRules, TAB_AUTO_GROUP_RULES_SETTING, TabAutoGroupRemovals, toTabAutoGroupResource } from '../common/tabAutoGroupRules.js';
import { ITabSessionsService } from '../common/tabSessionsService.js';

/**
 * Adds editors to tab groups when they are opened, as the rules of the
 * `workbench.editor.tabGroups.autoGroupRules` setting say.
 *
 * Rules apply when an editor opens, and to the open editors when the rules change. They leave alone:
 * - editors that are sticky or already in a tab group,
 * - tab groups that are locked, which the rule then does not apply to at all,
 * - files the user removed from the tab groups of the editor group, also when they are opened again later.
 */
export class TabAutoGroupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.jcodeTabAutoGroup';

	private rules: readonly ITabAutoGroupRule[];
	private readonly removals = new TabAutoGroupRemovals();

	private readonly trackers = this._register(new DisposableMap<GroupIdentifier>());

	/** The tab group of the editors that are in one, per editor group, as it was when it last changed. */
	private readonly memberships = new Map<GroupIdentifier, Map<EditorInput, string>>();

	/** The editors of an editor group that were opened and are yet to be looked at. */
	private readonly pending = new Map<GroupIdentifier, Set<EditorInput>>();

	/** The editor groups whose tab groups changed and are yet to be looked at. */
	private readonly pendingMemberships = new Set<GroupIdentifier>();

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITabSessionsService private readonly tabSessionsService: ITabSessionsService
	) {
		super();

		this.rules = this.readRules();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TAB_AUTO_GROUP_RULES_SETTING)) {
				this.rules = this.readRules();
				this.applyToOpenEditors();
			}
		}));

		for (const group of this.editorGroupsService.groups) {
			this.track(group);
		}
		this._register(this.editorGroupsService.onDidAddGroup(group => this.track(group)));
		this._register(this.editorGroupsService.onDidRemoveGroup(group => this.untrack(group)));
	}

	private readRules(): readonly ITabAutoGroupRule[] {
		return parseTabAutoGroupRules(this.configurationService.getValue(TAB_AUTO_GROUP_RULES_SETTING));
	}

	//#region Tracking

	private track(group: IEditorGroup): void {
		if (!isEditorGroupView(group) || this.trackers.has(group.id)) {
			return;
		}

		this.memberships.set(group.id, this.getMemberships(group));
		this.trackers.set(group.id, group.onDidModelChange(e => this.onDidModelChange(group, e)));
	}

	private untrack(group: IEditorGroup): void {
		this.trackers.deleteAndDispose(group.id);
		this.memberships.delete(group.id);
		this.pending.delete(group.id);
		this.pendingMemberships.delete(group.id);
		this.removals.forgetGroup(group.id);
	}

	private onDidModelChange(group: IEditorGroupView, e: IGroupModelChangeEvent): void {
		switch (e.kind) {

			// Editors are looked at once opening them is done, and when they are pinned,
			// which is what puts a preview editor on par with the other editors
			case GroupModelChangeKind.EDITOR_OPEN:
			case GroupModelChangeKind.EDITOR_PIN:
				if (e.editor) {
					this.schedule(group, e.editor);
				}
				break;

			// Editors that were in a tab group and are not anymore, but are still open, were removed by the user.
			// Closing the last editor of a tab group takes it out of the group first and closes it right after,
			// so look at the editors once that is done. Closed editors are let go of as well.
			case GroupModelChangeKind.TAB_GROUP_CREATED:
			case GroupModelChangeKind.TAB_GROUP_CHANGED:
			case GroupModelChangeKind.TAB_GROUP_REMOVED:
			case GroupModelChangeKind.EDITOR_MOVE:
			case GroupModelChangeKind.EDITOR_CLOSE:
				this.scheduleMembershipUpdate(group);
				break;
		}
	}

	private scheduleMembershipUpdate(group: IEditorGroupView): void {
		if (this.pendingMemberships.has(group.id)) {
			return;
		}

		this.pendingMemberships.add(group.id);
		queueMicrotask(() => {
			if (this.pendingMemberships.delete(group.id) && this.trackers.has(group.id)) {
				this.updateMemberships(group);
			}
		});
	}

	private updateMemberships(group: IEditorGroupView): void {
		const previous = this.memberships.get(group.id) ?? new Map<EditorInput, string>();
		const current = new Map(group.editors.map(editor => [editor, group.getTabGroupForEditor(editor)?.id]));

		for (const editor of findEditorsRemovedFromTabGroups(previous, current)) {
			const resource = this.getResource(editor);
			if (resource) {
				this.removals.remember(group.id, resource);
			}
		}

		// Rules never add a file that the user removed, so a file that is in a tab group again was put there by the user
		const memberships = this.getMemberships(group);
		for (const editor of memberships.keys()) {
			const resource = !previous.has(editor) ? this.getResource(editor) : undefined;
			if (resource) {
				this.removals.forget(group.id, resource);
			}
		}

		this.memberships.set(group.id, memberships);
	}

	private getResource(editor: EditorInput): URI | undefined {
		return EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
	}

	private getMemberships(group: IEditorGroupView): Map<EditorInput, string> {
		const memberships = new Map<EditorInput, string>();
		for (const editor of group.editors) {
			const tabGroup = group.getTabGroupForEditor(editor);
			if (tabGroup) {
				memberships.set(editor, tabGroup.id);
			}
		}

		return memberships;
	}

	//#endregion

	//#region Applying Rules

	private schedule(group: IEditorGroupView, editor: EditorInput): void {

		// A session that is restored brings its own tab groups
		if (this.rules.length === 0 || this.tabSessionsService.isRestoring) {
			return;
		}

		const pending = this.pending.get(group.id);
		if (pending) {
			pending.add(editor);
			return;
		}

		// Wait for the editor to be opened: tab groups of its own, such as the one of a reopened
		// saved tab group, are made right after opening it, and these are not to be second guessed
		this.pending.set(group.id, new Set([editor]));
		queueMicrotask(() => {
			const editors = this.pending.get(group.id);
			this.pending.delete(group.id);
			for (const pendingEditor of editors ?? []) {
				this.apply(group, pendingEditor);
			}
		});
	}

	/** Applies the rules to the editors that are open, in their order, so that a new or changed rule takes effect right away. */
	private applyToOpenEditors(): void {
		if (this.rules.length === 0 || this.tabSessionsService.isRestoring) {
			return;
		}

		for (const group of this.editorGroupsService.groups) {
			if (isEditorGroupView(group)) {
				for (const editor of group.editors) {
					this.apply(group, editor);
				}
			}
		}
	}

	private apply(group: IEditorGroupView, editor: EditorInput): void {
		if (group.disposed || !this.editorGroupsService.partOptions.tabGroups.enabled || !group.contains(editor)) {
			return;
		}

		// A preview editor joins too: joining a tab group pins it, as it does every member
		if (group.isSticky(editor) || group.getTabGroupForEditor(editor)) {
			return;
		}

		const resource = this.getResource(editor);
		if (!resource || this.removals.has(group.id, resource)) {
			return;
		}

		const rule = findTabAutoGroupRule(this.rules, toTabAutoGroupResource(resource, this.workspaceContextService.getWorkspaceFolder(resource)?.uri));
		if (!rule) {
			return;
		}

		const tabGroup = group.tabGroups.find(candidate => candidate.name === rule.name);
		if (!tabGroup) {
			group.createTabGroup([editor], rule.name, getTabAutoGroupColor(rule), { icon: rule.icon });
		} else if (!tabGroup.locked) {
			group.addToTabGroup(tabGroup.id, [editor]);
		}
	}

	//#endregion
}
