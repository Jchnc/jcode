/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { EDITOR_TAB_GROUP_COLORS } from '../../../common/editor/editorTabGroup.js';
import { TAB_AUTO_GROUP_RULES_SETTING } from '../common/tabAutoGroupRules.js';
import { ITabSessionsService } from '../common/tabSessionsService.js';
import { TabAutoGroupContribution } from './tabAutoGroup.js';
import './tabSearchActions.js';
import './tabSessionsActions.js';
import { TabSessionsService } from './tabSessionsService.js';

//#region Tab Sessions

registerSingleton(ITabSessionsService, TabSessionsService, InstantiationType.Delayed);

//#endregion

//#region Auto Grouping

registerWorkbenchContribution2(TabAutoGroupContribution.ID, TabAutoGroupContribution, WorkbenchPhase.AfterRestored);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	...workbenchConfigurationNodeBase,
	properties: {
		[TAB_AUTO_GROUP_RULES_SETTING]: {
			type: 'array',
			default: [],
			markdownDescription: localize('tabGroups.autoGroupRules', "Rules that add editors to tab groups when they are opened. The first rule whose `pattern` matches the file of an editor adds the editor to the tab group with the name of the rule in the editor group it opens in, and creates that tab group if there is none. Preview editors, sticky editors, editors that are in a tab group already and editors that the user removed from a tab group are left as they are, and so are locked tab groups. Applies when {0} is enabled.", '`#workbench.editor.tabGroups.enabled#`'),
			items: {
				type: 'object',
				required: ['name', 'pattern'],
				additionalProperties: false,
				properties: {
					name: {
						type: 'string',
						description: localize('tabGroups.autoGroupRules.name', "The name of the tab group to add the editors to."),
						minLength: 1
					},
					pattern: {
						type: 'string',
						markdownDescription: localize('tabGroups.autoGroupRules.pattern', "A glob pattern for the files to add to the tab group. Patterns are matched against the path of a file in its workspace folder, for example `**/*.test.ts` or `docs/**`, unless they are absolute paths, which are matched against the full path of a file."),
						minLength: 1
					},
					color: {
						type: 'string',
						markdownDescription: localize('tabGroups.autoGroupRules.color', "The color of the tab group when it is created, either the name of a color or a CSS color such as `#ff8800`. Rules without a color give their tab group a color that depends on their name."),
						examples: EDITOR_TAB_GROUP_COLORS.map(color => color.id)
					},
					icon: {
						type: 'string',
						markdownDescription: localize('tabGroups.autoGroupRules.icon', "The icon of the tab group when it is created, the identifier of a codicon such as `beaker`."),
						examples: ['beaker', 'book', 'gear', 'rocket']
					}
				},
				defaultSnippets: [{ body: { name: '$1', pattern: '$2' } }]
			}
		}
	}
});

//#endregion
