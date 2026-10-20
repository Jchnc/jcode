/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../base/common/arrays.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { isEditorGroupView } from '../../../browser/parts/editor/editor.js';
import { EditorExtensions, EditorInputCapabilities, EditorResourceAccessor, IEditorFactoryRegistry, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { cloneTabSessionLayout, createTabSessionEditorGroup, findTabSessionByName, ITabSession, ITabSessionEditor, ITabSessionEditorGroup, ITabSessionRestorePlan, parseTabSessions, planTabSessionRestore, stringifyTabSessions } from '../common/tabSessions.js';
import { ITabSessionsService } from '../common/tabSessionsService.js';

const TAB_SESSIONS_STORAGE_KEY = 'jcode.tabSessions';

/** The number of editors that are listed by name when asking to keep editors open. */
const MAX_LISTED_EDITORS = 5;

/**
 * Whether closing the editor needs the user to decide something first, such as
 * saving changes. This is what the editor group asks for when closing an editor.
 */
function needsConfirmationToClose(editor: EditorInput): boolean {
	if (editor.closeHandler) {
		try {
			return editor.closeHandler.showConfirm();
		} catch {
			// fall back to the unsaved changes, like the editor group does
		}
	}

	return editor.isDirty() && !editor.isSaving();
}

export class TabSessionsService extends Disposable implements ITabSessionsService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSessions = this._register(new Emitter<void>());
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private sessions: ITabSession[];
	private restoring = false;

	get isRestoring(): boolean {
		return this.restoring;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.sessions = this.sortByRecency(parseTabSessions(this.storageService.get(TAB_SESSIONS_STORAGE_KEY, StorageScope.WORKSPACE)));
	}

	getSessions(): readonly ITabSession[] {
		return this.sessions;
	}

	//#region Saving

	saveSession(name: string): ITabSession | undefined {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return undefined;
		}

		const part = this.editorGroupsService.mainPart;
		const groups = part.getGroups(GroupsOrder.GRID_APPEARANCE);
		const existing = findTabSessionByName(this.sessions, trimmedName);

		const session: ITabSession = {
			id: existing?.id ?? generateUuid(),
			name: trimmedName,
			savedAt: Date.now(),
			layout: part.getLayout(),
			groups: groups.map(group => this.captureGroup(group)),
			activeGroup: Math.max(0, groups.indexOf(part.activeGroup))
		};

		this.updateSessions([session, ...this.sessions.filter(candidate => candidate !== existing)]);

		return session;
	}

	private captureGroup(group: IEditorGroup) {
		const view = isEditorGroupView(group) ? group : undefined;

		return createTabSessionEditorGroup({
			locked: group.isLocked,
			editors: group.editors.map(editor => ({ editor: this.serializeEditor(editor), tabGroupId: view?.getTabGroupForEditor(editor)?.id })),
			activeIndex: group.activeEditor ? group.getIndexOfEditor(group.activeEditor) : -1,
			stickyCount: group.stickyCount,
			tabGroups: view?.tabGroups ?? []
		});
	}

	/** Serializes an editor the way the window does to restore its editors, if the editor can be part of a session. */
	private serializeEditor(editor: EditorInput): ITabSessionEditor | undefined {

		// Untitled editors have nothing that identifies them once they are closed
		if (editor.hasCapability(EditorInputCapabilities.Untitled)) {
			return undefined;
		}

		try {
			const serializer = Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).getEditorSerializer(editor);
			const value = serializer?.canSerialize(editor) ? serializer.serialize(editor) : undefined;
			if (typeof value === 'string') {
				return { typeId: editor.typeId, value, name: editor.getName(), description: editor.getDescription() };
			}
		} catch (error) {
			this.logService.warn(`[tab sessions] Cannot save editor ${editor.typeId}`, error);
		}

		return undefined;
	}

	//#endregion

	//#region Renaming and Deleting

	renameSession(id: string, name: string): boolean {
		const trimmedName = name.trim();
		const session = this.sessions.find(candidate => candidate.id === id);
		const sameName = findTabSessionByName(this.sessions, trimmedName);
		if (!session || !trimmedName || (sameName && sameName !== session)) {
			return false;
		}

		this.updateSessions(this.sessions.map(candidate => candidate === session ? { ...session, name: trimmedName } : candidate));

		return true;
	}

	deleteSession(id: string): void {
		const remaining = this.sessions.filter(session => session.id !== id);
		if (remaining.length !== this.sessions.length) {
			this.updateSessions(remaining);
		}
	}

	private updateSessions(sessions: ITabSession[]): void {
		this.sessions = this.sortByRecency(sessions);
		this.storageService.store(TAB_SESSIONS_STORAGE_KEY, stringifyTabSessions(this.sessions), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._onDidChangeSessions.fire();
	}

	private sortByRecency(sessions: ITabSession[]): ITabSession[] {
		return sessions.slice().sort((first, second) => second.savedAt - first.savedAt);
	}

	//#endregion

	//#region Restoring

	async restoreSession(id: string): Promise<boolean> {
		const session = this.sessions.find(candidate => candidate.id === id);
		if (!session || this.restoring) {
			return false;
		}

		const part = this.editorGroupsService.mainPart;
		if (!await this.confirmRestore(session, part.groups)) {
			return false;
		}

		this.restoring = true;
		try {
			const editors = await Promise.all(session.groups.map(group => Promise.all(group.editors.map(editor => this.resolveEditor(editor)))));
			const plan = planTabSessionRestore(session, (groupIndex, editorIndex) => !!editors[groupIndex][editorIndex]);

			await this.applyPlan(plan, editors);

			if (plan.skippedEditorCount > 0) {
				this.notificationService.warn(plan.skippedEditorCount === 1
					? localize('tabSession.skippedOne', "Restored the tab session \"{0}\" without 1 editor that can no longer be opened.", session.name)
					: localize('tabSession.skippedMany', "Restored the tab session \"{0}\" without {1} editors that can no longer be opened.", session.name, plan.skippedEditorCount));
			}
		} finally {
			this.restoring = false;
		}

		return true;
	}

	/**
	 * Restoring closes the open editors, except for the ones that ask the user first when
	 * closing: those stay open. The user decides whether that is fine.
	 */
	private async confirmRestore(session: ITabSession, groups: readonly IEditorGroup[]): Promise<boolean> {
		const names = groups.flatMap(group => group.editors.filter(needsConfirmationToClose).map(editor => editor.getName()));
		if (names.length === 0) {
			return true;
		}

		const listed = names.slice(0, MAX_LISTED_EDITORS).join(', ');
		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('tabSession.confirmRestore', "Do you want to restore the tab session \"{0}\"?", session.name),
			detail: names.length > MAX_LISTED_EDITORS
				? localize('tabSession.confirmRestoreDetailMore', "The open editors are replaced by the editors of the session. Editors with unsaved changes stay open so that your changes are not lost: {0} and {1} more.", listed, names.length - MAX_LISTED_EDITORS)
				: localize('tabSession.confirmRestoreDetail', "The open editors are replaced by the editors of the session. Editors with unsaved changes stay open so that your changes are not lost: {0}.", listed),
			primaryButton: localize({ key: 'tabSession.restoreButton', comment: ['&& denotes a mnemonic'] }, "&&Restore Session")
		});

		return confirmed;
	}

	/** Creates the editor of a session, unless it can no longer be opened. */
	private async resolveEditor(editor: ITabSessionEditor): Promise<EditorInput | undefined> {
		let input: EditorInput | undefined;
		try {
			input = Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).getEditorSerializer(editor.typeId)?.deserialize(this.instantiationService, editor.value);
		} catch (error) {
			this.logService.warn(`[tab sessions] Cannot restore editor ${editor.typeId}`, error);
		}

		if (input && !await this.exists(input)) {
			this.disposeUnlessOpened(input);
			return undefined;
		}

		return input;
	}

	/**
	 * Disposes an editor that was created for the session but is not used. Serializers can
	 * hand out the instance of an editor that is open already (text file editors are cached
	 * by resource), and disposing that instance would close it, unsaved changes included.
	 */
	private disposeUnlessOpened(input: EditorInput): void {
		if (!this.editorGroupsService.groups.some(group => group.contains(input, { strictEquals: true }))) {
			input.dispose();
		}
	}

	/** Whether the file of an editor still exists. Editors that do not show a file, or one that cannot be looked up, are assumed to exist. */
	private async exists(input: EditorInput): Promise<boolean> {
		const resource = EditorResourceAccessor.getOriginalUri(input, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (!resource || !this.fileService.hasProvider(resource)) {
			return true;
		}

		try {
			return await this.fileService.exists(resource);
		} catch {
			return true;
		}
	}

	private async applyPlan(plan: ITabSessionRestorePlan, editors: readonly (readonly (EditorInput | undefined)[])[]): Promise<void> {
		const part = this.editorGroupsService.mainPart;

		// Editors that ask the user before they close stay where they are. The groups they are in
		// are reused by the layout, and merged into its last group if the layout has fewer groups.
		for (const group of part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			group.closeAllEditors({ excludeConfirming: true });
		}
		part.applyLayout(cloneTabSessionLayout(plan.layout));

		const groups = part.getGroups(GroupsOrder.GRID_APPEARANCE);
		await Promise.all(plan.groups.map(async (groupPlan, groupIndex) => {
			const group = groups.at(groupIndex);
			if (group) {
				await this.restoreGroup(group, groupPlan.group, groupPlan.editorIndexes.map(editorIndex => editors[groupIndex][editorIndex]!));
			}
		}));

		const activeGroup = groups.at(plan.activeGroup) ?? groups[0];
		part.activateGroup(activeGroup);
		activeGroup.focus();
	}

	private async restoreGroup(group: IEditorGroup, plan: ITabSessionEditorGroup, inputs: readonly EditorInput[]): Promise<void> {
		const stickyCount = plan.stickyCount ?? 0;
		const index = group.stickyCount; // editors that stayed open and are sticky remain in front of the ones that are restored

		// The editors are restored pinned and one after the other, which keeps the order of
		// the session and does not leave a preview editor behind that the next one replaces.
		await group.openEditors(inputs.map((editor, position): { editor: EditorInput; options: IEditorOptions } => ({
			editor,
			options: { pinned: true, sticky: position < stickyCount, inactive: true, preserveFocus: true, index: index + position }
		})));

		// An editor that is already open is used instead of the one that was created for the session
		const opened = inputs.map(input => {
			const existing = group.editors.find(editor => editor === input) ?? group.editors.find(editor => editor.matches(input));
			if (existing !== input) {
				this.disposeUnlessOpened(input);
			}

			return existing;
		});

		if (isEditorGroupView(group)) {
			for (const tabGroup of plan.tabGroups ?? []) {
				group.createTabGroup(coalesce(tabGroup.members.map(member => opened[member])), tabGroup.name || undefined, tabGroup.color, {
					collapsed: tabGroup.collapsed,
					saved: tabGroup.saved,
					locked: tabGroup.locked,
					icon: tabGroup.icon,
					metadata: tabGroup.metadata,
					skipUndo: true
				});
			}
		}

		group.lock(!!plan.locked);

		const active = plan.active !== undefined ? opened[plan.active] : undefined;
		if (active) {
			await group.openEditor(active, { pinned: true, preserveFocus: true });
		}
	}

	//#endregion
}
