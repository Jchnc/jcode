/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import this module before any module that imports `vscode`: it redirects that import to the stub.
const stubUrl = pathToFileURL(join(__dirname, 'vscodeStub.js')).href;

registerHooks({
	resolve: (specifier, context, nextResolve) => specifier === 'vscode' ? { url: stubUrl, shortCircuit: true } : nextResolve(specifier, context)
});
