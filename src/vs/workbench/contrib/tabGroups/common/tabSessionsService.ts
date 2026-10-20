/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITabSession } from './tabSessions.js';

export const ITabSessionsService = createDecorator<ITabSessionsService>('tabSessionsService');

export interface ITabSessionsService {

	readonly _serviceBrand: undefined;

	/** Fires when sessions were saved, renamed or deleted. */
	readonly onDidChangeSessions: Event<void>;

	/**
	 * Whether a session is being restored. Editors that open and tab groups that change
	 * while this is the case belong to the session and are not to be rearranged.
	 */
	readonly isRestoring: boolean;

	/** The sessions of the workspace, the most recently saved first. */
	getSessions(): readonly ITabSession[];

	/**
	 * Saves the editor layout of the window as a session. A session that has the same name
	 * is replaced.
	 *
	 * @returns the session, or `undefined` when the name is empty.
	 */
	saveSession(name: string): ITabSession | undefined;

	/**
	 * Renames a session.
	 *
	 * @returns whether the session was renamed, which it is not when the name is empty or used by another session.
	 */
	renameSession(id: string, name: string): boolean;

	deleteSession(id: string): void;

	/**
	 * Replaces the editor layout of the window by the one of a session. Editors with unsaved
	 * changes are never closed, the user is asked first if there are any. Editors of the session
	 * that can no longer be opened are left out.
	 *
	 * @returns whether the session was restored, which it is not when the user declined.
	 */
	restoreSession(id: string): Promise<boolean>;
}
