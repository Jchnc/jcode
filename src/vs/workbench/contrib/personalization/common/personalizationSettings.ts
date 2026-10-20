/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { ITabAutoGroupRule } from '../../tabGroups/common/tabAutoGroupRules.js';

export type PersonalizationValue = string | number | boolean | readonly ITabAutoGroupRule[];

/** Display the selected scope, rather than a workspace override in the User controls. */
export function getPersonalizationValue(config: IConfigurationValue<PersonalizationValue> | undefined, target: ConfigurationTarget): PersonalizationValue | undefined {
	if (config?.policyValue !== undefined) {
		return config.policyValue;
	}
	if (target === ConfigurationTarget.WORKSPACE && config?.workspaceValue !== undefined) {
		return config.workspaceValue;
	}
	return config?.userValue ?? config?.applicationValue ?? config?.defaultValue;
}
