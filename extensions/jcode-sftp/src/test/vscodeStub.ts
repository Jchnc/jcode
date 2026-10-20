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

export class Disposable {
	constructor(private readonly callOnDispose: () => void) { }

	static from(...disposables: { dispose(): unknown }[]): Disposable {
		return new Disposable(() => disposables.forEach(disposable => disposable.dispose()));
	}

	dispose(): void {
		this.callOnDispose();
	}
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2
}

export enum ProgressLocation {
	Window = 10,
	Notification = 15
}

export class ThemeColor {
	constructor(readonly id: string) { }
}

/** A status bar item that records what was set on it. */
export class FakeStatusBarItem {
	name: string | undefined;
	command: string | undefined;
	text = '';
	tooltip: string | undefined;
	accessibilityInformation: { label: string; role?: string } | undefined;
	backgroundColor: ThemeColor | undefined;
	visible = false;

	show(): void {
		this.visible = true;
	}

	hide(): void {
		this.visible = false;
	}

	dispose(): void {
		this.visible = false;
	}
}

export interface FakeMessageOptions {
	modal?: boolean;
	detail?: string;
}

/**
 * The parts of `vscode.window` that the extension's logic uses. Tests replace the members they
 * care about, such as the answer to an error dialog.
 */
export const window = {
	statusBarItems: [] as FakeStatusBarItem[],
	showWarningMessage: async (_message: string, _options: FakeMessageOptions, ..._items: string[]): Promise<string | undefined> => undefined,
	showErrorMessage: async (_message: string, _options: FakeMessageOptions, ..._items: string[]): Promise<string | undefined> => undefined,
	createStatusBarItem(): FakeStatusBarItem {
		const item = new FakeStatusBarItem();
		this.statusBarItems.push(item);
		return item;
	},
	withProgress: async <T>(_options: { location: ProgressLocation; title?: string }, task: () => Thenable<T>): Promise<T> => task()
};

export interface FakeWorkspaceFolder {
	uri: { scheme: string; authority: string };
}

export const workspace = {
	workspaceFolders: undefined as FakeWorkspaceFolder[] | undefined,
	onDidChangeWorkspaceFolders: (): { dispose(): void } => ({ dispose: () => undefined })
};
