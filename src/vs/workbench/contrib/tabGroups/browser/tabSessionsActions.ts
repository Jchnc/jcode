/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { escapeIcons } from '../../../../base/common/iconLabels.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputButton, IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import Severity from '../../../../base/common/severity.js';
import { ITabSession, ITabSessionSummary, summarizeTabSession, TabSessionNameProblem, validateTabSessionName } from '../common/tabSessions.js';
import { ITabSessionsService } from '../common/tabSessionsService.js';

export const SAVE_TAB_SESSION_COMMAND_ID = 'workbench.action.editor.saveTabSession';
export const OPEN_TAB_SESSION_COMMAND_ID = 'workbench.action.editor.openTabSession';
export const DELETE_TAB_SESSION_COMMAND_ID = 'workbench.action.editor.deleteTabSession';

/** The number of editors that are listed by name to give an idea of what is in a session. */
const MAX_PREVIEW_EDITORS = 4;

//#region Quick Pick Items

export interface ITabSessionPick extends IQuickPickItem {
	readonly sessionId: string;
}

/** Describes what a session contains, for example "2 editor groups, 7 tabs, 1 tab group". */
export function describeTabSessionSummary(summary: ITabSessionSummary): string {
	const groups = summary.groupCount === 1 ? localize('tabSession.oneGroup', "1 editor group") : localize('tabSession.groupCount', "{0} editor groups", summary.groupCount);
	const tabs = summary.editorCount === 1 ? localize('tabSession.oneTab', "1 tab") : localize('tabSession.tabCount', "{0} tabs", summary.editorCount);
	if (summary.tabGroupCount === 0) {
		return localize('tabSession.summary', "{0}, {1}", groups, tabs);
	}

	const tabGroups = summary.tabGroupCount === 1 ? localize('tabSession.oneTabGroup', "1 tab group") : localize('tabSession.tabGroupCount', "{0} tab groups", summary.tabGroupCount);
	return localize('tabSession.summaryWithTabGroups', "{0}, {1}, {2}", groups, tabs, tabGroups);
}

/** Creates the quick pick items for sessions in the order they are given. */
export function createTabSessionPicks(sessions: readonly ITabSession[], buttons: readonly IQuickInputButton[]): ITabSessionPick[] {
	return sessions.map(session => {
		const summary = describeTabSessionSummary(summarizeTabSession(session));
		const names = session.groups.flatMap(group => group.editors.map(editor => editor.name)).filter(name => name.length > 0);
		const detail = names.length > MAX_PREVIEW_EDITORS
			? localize('tabSession.moreEditors', "{0}, +{1} more", names.slice(0, MAX_PREVIEW_EDITORS).join(', '), names.length - MAX_PREVIEW_EDITORS)
			: names.join(', ');

		return {
			sessionId: session.id,
			label: escapeIcons(session.name),
			description: summary,
			detail: detail || undefined,
			ariaLabel: localize('tabSession.ariaLabel', "{0}, {1}", session.name, summary),
			iconClass: ThemeIcon.asClassName(Codicon.layout),
			buttons
		};
	});
}

//#endregion

//#region Picking and Naming

function createTabSessionButtons(): { readonly rename: IQuickInputButton; readonly delete: IQuickInputButton } {
	return {
		rename: { iconClass: ThemeIcon.asClassName(Codicon.edit), tooltip: localize('tabSession.rename', "Rename Tab Session") },
		delete: { iconClass: ThemeIcon.asClassName(Codicon.trash), tooltip: localize('tabSession.delete', "Delete Tab Session") }
	};
}

type TabSessionSelection = { readonly action: 'open' | 'rename'; readonly sessionId: string };

/**
 * Shows the sessions until the user opens or renames one. Deleting a session updates
 * the list in place and keeps the focus where it was.
 */
async function pickTabSession(quickInputService: IQuickInputService, sessionsService: ITabSessionsService, activeSessionId?: string): Promise<TabSessionSelection | undefined> {
	const disposables = new DisposableStore();
	const buttons = createTabSessionButtons();
	const picker = disposables.add(quickInputService.createQuickPick<ITabSessionPick>());
	picker.title = localize('openTabSession.title', "Open Tab Session");
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;
	picker.sortByLabel = false;

	const updatePicks = (activePick: (picks: readonly ITabSessionPick[]) => ITabSessionPick | undefined) => {
		const picks = createTabSessionPicks(sessionsService.getSessions(), [buttons.rename, buttons.delete]);
		picker.items = picks;
		picker.placeholder = picks.length ? localize('openTabSession.placeholder', "Select a tab session to open") : localize('noTabSessions', "There are no saved tab sessions");
		const active = activePick(picks);
		if (active) {
			picker.activeItems = [active];
		}
	};
	updatePicks(picks => picks.find(pick => pick.sessionId === activeSessionId));

	let selection: TabSessionSelection | undefined;
	disposables.add(picker.onDidAccept(() => {
		const [pick] = picker.selectedItems;
		if (pick) {
			selection = { action: 'open', sessionId: pick.sessionId };
			picker.hide();
		}
	}));
	disposables.add(picker.onDidTriggerItemButton(({ button, item }) => {
		if (button === buttons.rename) {
			selection = { action: 'rename', sessionId: item.sessionId };
			picker.hide();
		} else if (button === buttons.delete) {
			const index = picker.items.indexOf(item);
			sessionsService.deleteSession(item.sessionId);
			updatePicks(picks => picks.at(Math.min(Math.max(index, 0), picks.length - 1)));
		}
	}));

	await new Promise<void>(resolve => {
		disposables.add(picker.onDidHide(() => resolve()));
		picker.show();
	});
	disposables.dispose();

	return selection;
}

/** Asks for the new name of a session until it is valid. */
async function pickTabSessionName(quickInputService: IQuickInputService, sessions: readonly ITabSession[], session: ITabSession): Promise<string | undefined> {
	return quickInputService.input({
		title: localize('renameTabSession.title', "Rename Tab Session"),
		prompt: localize('renameTabSession.prompt', "Enter a new name for the tab session"),
		value: session.name,
		validateInput: async value => {
			switch (validateTabSessionName(value, sessions.filter(candidate => candidate !== session))) {
				case TabSessionNameProblem.Empty: return localize('tabSession.nameRequired', "A name is required");
				case TabSessionNameProblem.Exists: return localize('tabSession.nameExists', "A tab session with this name already exists");
				default: return undefined;
			}
		}
	});
}

/** Suggests a name that is not in use, such as "Session 3". */
function suggestTabSessionName(sessions: readonly ITabSession[]): string {
	for (let number = sessions.length + 1; ; number++) {
		const name = localize('tabSession.defaultName', "Session {0}", number);
		if (!validateTabSessionName(name, sessions)) {
			return name;
		}
	}
}

//#endregion

//#region Actions

registerAction2(class SaveTabSessionAction extends Action2 {
	constructor() {
		super({
			id: SAVE_TAB_SESSION_COMMAND_ID,
			title: localize2('saveTabSession', "Save Tab Session…"),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const sessionsService = accessor.get(ITabSessionsService);
		const notificationService = accessor.get(INotificationService);

		const sessions = sessionsService.getSessions();
		const name = await quickInputService.input({
			title: localize('saveTabSession.title', "Save Tab Session"),
			prompt: localize('saveTabSession.prompt', "Enter a name for the tab session. It stores the editor groups and tabs of this window."),
			value: suggestTabSessionName(sessions),
			validateInput: async value => {
				switch (validateTabSessionName(value, sessions)) {
					case TabSessionNameProblem.Empty: return localize('tabSession.nameRequired', "A name is required");
					case TabSessionNameProblem.Exists: return { content: localize('tabSession.nameReplaced', "A tab session with this name exists and is replaced"), severity: Severity.Warning };
					default: return undefined;
				}
			}
		});

		const session = name !== undefined ? sessionsService.saveSession(name) : undefined;
		if (session) {
			notificationService.status(localize('tabSession.saved', "Saved tab session \"{0}\"", session.name), { hideAfter: 4000 });
		}
	}
});

registerAction2(class OpenTabSessionAction extends Action2 {
	constructor() {
		super({
			id: OPEN_TAB_SESSION_COMMAND_ID,
			title: localize2('openTabSession', "Open Tab Session…"),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const sessionsService = accessor.get(ITabSessionsService);

		let selection = await pickTabSession(quickInputService, sessionsService);
		while (selection?.action === 'rename') {
			const { sessionId } = selection;
			const session = sessionsService.getSessions().find(candidate => candidate.id === sessionId);
			const name = session && await pickTabSessionName(quickInputService, sessionsService.getSessions(), session);
			if (name) {
				sessionsService.renameSession(sessionId, name);
			}

			selection = await pickTabSession(quickInputService, sessionsService, sessionId);
		}

		if (selection) {
			await sessionsService.restoreSession(selection.sessionId);
		}
	}
});

registerAction2(class DeleteTabSessionAction extends Action2 {
	constructor() {
		super({
			id: DELETE_TAB_SESSION_COMMAND_ID,
			title: localize2('deleteTabSession', "Delete Tab Session…"),
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const sessionsService = accessor.get(ITabSessionsService);

		const picks = createTabSessionPicks(sessionsService.getSessions(), []);
		const pick = await accessor.get(IQuickInputService).pick(picks, {
			placeHolder: picks.length ? localize('deleteTabSession.placeholder', "Select a tab session to delete") : localize('noTabSessions', "There are no saved tab sessions"),
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (pick) {
			sessionsService.deleteSession(pick.sessionId);
		}
	}
});

//#endregion
