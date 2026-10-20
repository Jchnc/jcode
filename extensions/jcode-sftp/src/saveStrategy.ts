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

/** Quotes a value as one POSIX shell word. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll(`'`, `'\\''`)}'`;
}

/**
 * Builds a command printing the hard link count of a file. SFTP attributes do not carry it, so
 * it is read with `stat`, trying the GNU and busybox form first and the BSD and macOS form second.
 */
export function linkCountCommand(path: string): string {
	const quoted = shellQuote(path);
	return `stat -c %h -- ${quoted} || stat -f %l -- ${quoted}`;
}

/** Reads the output of {@link linkCountCommand}, returning undefined when it is not a count. */
export function parseLinkCount(output: string | undefined): number | undefined {
	const trimmed = output?.trim();
	return trimmed && /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : undefined;
}
