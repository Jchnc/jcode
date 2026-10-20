/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import '../../browser/personalization.contribution.js';

suite('Personalization contribution', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('is easy to find as Personalize JCode', () => {
		const id = 'jcode.action.openPersonalization';
		const command = MenuRegistry.getCommand(id);
		const placement = (menu: MenuId) => {
			const item = MenuRegistry.getMenuItems(menu).filter(isIMenuItem).find(entry => entry.command.id === id);
			return item && { group: item.group, order: item.order };
		};
		const text = (value: string | { readonly value: string } | undefined) => typeof value === 'string' ? value : value?.value;

		assert.deepStrictEqual({
			title: text(command?.title),
			category: text(command?.category),
			manage: placement(MenuId.GlobalActivity),
			preferences: placement(MenuId.MenubarPreferencesMenu),
			commandPalette: placement(MenuId.CommandPalette) !== undefined,
		}, {
			title: 'Personalize JCode',
			category: 'Preferences',
			manage: { group: '2_configuration', order: 2.1 },
			preferences: { group: '2_configuration', order: 2.1 },
			commandPalette: true,
		});
	});
});
