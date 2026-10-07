/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, ExtensionContext, l10n, window, workspace } from 'vscode';
import { RemoteProfile, SftpConnections } from './connection';
import { ConnectionManager } from './connectionManager';
import { SftpFileSystemProvider } from './fileSystemProvider';

export function activate(context: ExtensionContext): void {
	const log = window.createOutputChannel(l10n.t('JCode Remote SSH/SFTP'), { log: true });
	const connections = new SftpConnections(context);
	const provider = new SftpFileSystemProvider(connections, log);
	const manager = new ConnectionManager(context, connections, provider, log);
	const run = (action: () => Promise<void>) => manager.run(action);
	context.subscriptions.push(log, { dispose: () => connections.dispose() }, provider,
		workspace.registerFileSystemProvider('jcode-sftp', provider, { isCaseSensitive: true }),
		commands.registerCommand('jcodeSftp.connect', () => run(() => manager.show())),
		commands.registerCommand('jcodeSftp.reconnect', () => run(() => manager.reconnectCurrent())),
		commands.registerCommand('jcodeSftp.new', () => run(() => manager.create())),
		commands.registerCommand('jcodeSftp.open', (target?: string | RemoteProfile) => run(() => manager.open(target))),
		commands.registerCommand('jcodeSftp.edit', (target?: string | RemoteProfile) => run(() => manager.edit(target))),
		commands.registerCommand('jcodeSftp.delete', (target?: string | RemoteProfile) => run(() => manager.delete(target))),
		commands.registerCommand('jcodeSftp.import', () => run(() => manager.import())),
		commands.registerCommand('jcodeSftp.export', () => run(() => manager.export()))
	);
}
