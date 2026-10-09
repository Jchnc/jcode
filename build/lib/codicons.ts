/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';

const fontPath = 'vs/base/browser/ui/codicons/codicon/codicon.ttf';

/** Restore the generated icon font without rebuilding or rewriting up-to-date assets. */
export async function ensureCodiconFont(repoRoot: string): Promise<void> {
	let font: Buffer;
	try {
		font = await fs.readFile(path.join(repoRoot, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf'));
	} catch (error) {
		throw new Error('Unable to read the Codicon font. Run npm run install-fast to restore dependencies.', { cause: error });
	}

	await Promise.all(['src', 'out'].map(async directory => {
		const destination = path.join(repoRoot, directory, fontPath);
		try {
			if (font.equals(await fs.readFile(destination))) {
				return;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		await fs.mkdir(path.dirname(destination), { recursive: true });
		await fs.writeFile(destination, font);
	}));
}
