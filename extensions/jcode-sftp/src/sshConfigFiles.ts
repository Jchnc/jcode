/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import type { SshConfigEnvironment } from './sshConfig';

/** The user's SSH config file, `~/.ssh/config`. */
export function userSshConfigPath(): string {
	return path.join(homedir(), '.ssh', 'config');
}

/** The name `ssh` connects as when a host does not set one. */
function localUserName(): string {
	try {
		return userInfo().username;
	} catch {
		return process.env.USERNAME ?? process.env.USER ?? '';
	}
}

/** Reads the SSH config files from this computer. Files and folders that are missing or cannot be read are reported as missing. */
export function localSshConfigEnvironment(): SshConfigEnvironment {
	return {
		home: homedir(),
		user: localUserName(),
		path,
		readFile: async file => {
			try {
				return await readFile(file, 'utf8');
			} catch {
				return undefined;
			}
		},
		readDirectory: async directory => {
			try {
				return await readdir(directory);
			} catch {
				return undefined;
			}
		}
	};
}
