/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../browser/window.js';
import { toDisposable } from '../../../../common/lifecycle.js';
import { FileAccess } from '../../../../common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('Codicon modifiers', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** Loads the stylesheet itself, so that the test does not depend on when an imported one finishes loading. */
	async function loadStyles(): Promise<void> {
		const link = mainWindow.document.createElement('link');
		link.rel = 'stylesheet';
		link.href = FileAccess.asBrowserUri('vs/base/browser/ui/codicons/codicon/codicon-modifiers.css').toString(true);
		store.add(toDisposable(() => link.remove()));
		const loaded = new Promise<void>((resolve, reject) => {
			link.addEventListener('load', () => resolve());
			link.addEventListener('error', () => reject(new Error('Could not load the codicon modifier styles.')));
		});
		mainWindow.document.head.appendChild(link);
		await loaded;
	}

	/** What animates in a workbench with these classes, and whether the icons are still shown. */
	function spinningIcons(workbenchClasses: string): { readonly animated: string[]; readonly hidden: string[] } {
		const workbench = mainWindow.document.createElement('div');
		workbench.className = workbenchClasses;
		const icons = new Map([
			['sync~spin', 'codicon codicon-sync codicon-modifier-spin'],
			['loading', 'codicon codicon-loading'],
			['loading~spin', 'codicon codicon-loading codicon-modifier-spin'],
			['tree loading', 'codicon codicon-tree-item-loading'],
		]);
		const elements = [...icons].map(([name, className]) => {
			const icon = mainWindow.document.createElement('span');
			icon.className = className;
			workbench.appendChild(icon);
			return { name, icon };
		});
		mainWindow.document.body.appendChild(workbench);
		store.add(toDisposable(() => workbench.remove()));

		const animated: string[] = [];
		const hidden: string[] = [];
		for (const { name, icon } of elements) {
			for (const pseudo of [undefined, '::before']) {
				const style = mainWindow.getComputedStyle(icon, pseudo);
				if (style.animationName !== 'none') {
					animated.push(`${name}${pseudo ?? ''}`);
				}
			}
			const style = mainWindow.getComputedStyle(icon);
			if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
				hidden.push(name);
			}
		}
		return { animated, hidden };
	}

	test('spins icons, and stops them without hiding them when motion is reduced', async () => {
		await loadStyles();

		assert.deepStrictEqual({
			enabled: spinningIcons('monaco-workbench monaco-enable-motion'),
			reduced: spinningIcons('monaco-workbench monaco-reduce-motion'),
		}, {
			enabled: { animated: ['sync~spin', 'loading', 'loading~spin', 'tree loading::before'], hidden: [] },
			reduced: { animated: [], hidden: [] },
		});
	});
});
