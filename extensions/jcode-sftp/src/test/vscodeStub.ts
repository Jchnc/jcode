/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stand-in for the parts of the `vscode` module that pure extension logic uses, so
 * unit tests can run in plain Node without an extension host.
 */

export const l10n = {
	t(message: string, ...args: (string | number | boolean)[]): string {
		return message.replace(/\{(?<index>\d+)\}/g, (match, index: string) => String(args[Number(index)] ?? match));
	}
};

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export enum FileChangeType {
	Changed = 1,
	Created = 2,
	Deleted = 3
}

/** A synchronous event emitter with the shape of the `vscode` one. */
export class EventEmitter<T> {
	private readonly listeners = new Set<(value: T) => unknown>();

	readonly event = (listener: (value: T) => unknown): { dispose(): void } => {
		this.listeners.add(listener);
		return { dispose: () => { this.listeners.delete(listener); } };
	};

	fire(value: T): void {
		for (const listener of [...this.listeners]) {
			listener(value);
		}
	}

	dispose(): void {
		this.listeners.clear();
	}
}

export const window = {
	showWarningMessage: async (): Promise<undefined> => undefined
};
