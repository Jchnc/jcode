/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { getPersonalizationValue } from '../../common/personalizationSettings.js';

suite('Personalization settings', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('User controls do not display a workspace override', () => {
		assert.strictEqual(getPersonalizationValue({ defaultValue: 'top', userValue: 'left', workspaceValue: 'right', value: 'right' }, ConfigurationTarget.USER), 'left');
	});

	test('Workspace controls inherit user settings until explicitly configured', () => {
		assert.deepStrictEqual([
			getPersonalizationValue({ defaultValue: 'top', userValue: 'left' }, ConfigurationTarget.WORKSPACE),
			getPersonalizationValue({ defaultValue: 'top', userValue: 'left', workspaceValue: 'right' }, ConfigurationTarget.WORKSPACE),
			getPersonalizationValue({ defaultValue: true, userValue: true, workspaceValue: false }, ConfigurationTarget.WORKSPACE)
		], ['left', 'right', false]);
	});

	test('Policy takes precedence in both scopes', () => {
		const setting = { defaultValue: true, userValue: true, workspaceValue: true, policyValue: false };
		assert.deepStrictEqual([ConfigurationTarget.USER, ConfigurationTarget.WORKSPACE].map(target => getPersonalizationValue(setting, target)), [false, false]);
	});

	test('Defaults preserve false and zero and include application settings', () => {
		assert.deepStrictEqual([
			getPersonalizationValue({ defaultValue: false }, ConfigurationTarget.USER),
			getPersonalizationValue({ defaultValue: 0 }, ConfigurationTarget.USER),
			getPersonalizationValue({ defaultValue: 'default', applicationValue: 'compact' }, ConfigurationTarget.USER),
			getPersonalizationValue(undefined, ConfigurationTarget.USER)
		], [false, 0, 'compact', undefined]);
	});
});
