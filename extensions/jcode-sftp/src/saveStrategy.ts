/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FileOwner {
	uid: number;
	gid: number;
}

export type OwnershipPlan =
	| { action: 'keep' }
	| { action: 'restore'; owner: FileOwner }
	| { action: 'unrestorable' };

/**
 * Decides how to give a replacement file the original owner. Only root may hand a file to
 * another user, and other users can at most keep their own uid while restoring a group, so
 * `chown` is attempted only where it can succeed.
 */
export function planOwnership(created: Partial<FileOwner>, original: Partial<FileOwner>): OwnershipPlan {
	if (created.uid === undefined || created.gid === undefined || original.uid === undefined || original.gid === undefined ||
		(created.uid === original.uid && created.gid === original.gid)) {
		return { action: 'keep' };
	}
	if (created.uid === 0 || created.uid === original.uid) {
		return { action: 'restore', owner: { uid: original.uid, gid: original.gid } };
	}
	return { action: 'unrestorable' };
}
