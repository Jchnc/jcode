/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FolderSummary {
	uri: string;
	name: string;
	/** The connection a remote folder belongs to; undefined for any other folder. */
	connection?: string;
}

export type WorkspacePlan =
	| { action: 'none' }
	| { action: 'open' }
	| { action: 'update'; index: number }
	| { action: 'ask' };

/**
 * Decides how to show a connection's folder among the folders already open. It never removes folders
 * that belong to something else: an empty window opens the folder directly, a folder this connection
 * already contributes is updated in place (for example after its root changed), and anything else needs
 * the user to choose between adding, a new window and replacing.
 */
export function planWorkspaceFolders(folders: readonly FolderSummary[], target: FolderSummary & { connection: string }): WorkspacePlan {
	if (!folders.length) {
		return { action: 'open' };
	}
	const sameUri = folders.findIndex(folder => folder.uri === target.uri);
	if (sameUri >= 0) {
		return folders[sameUri].name === target.name ? { action: 'none' } : { action: 'update', index: sameUri };
	}
	const sameConnection = folders.findIndex(folder => folder.connection === target.connection);
	return sameConnection >= 0 ? { action: 'update', index: sameConnection } : { action: 'ask' };
}
