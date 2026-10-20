/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IMatch } from '../../../../../base/common/filters.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { filterVerticalTabs, IVerticalTabsFilterResult, IVerticalTabsFilterTab, IVerticalTabsFilterTabGroup, parseVerticalTabsFilterQuery } from '../../../../browser/parts/editor/verticalTabsFilter.js';

suite('Vertical tabs filter', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const tabs: IVerticalTabsFilterTab[] = [
		{ name: 'main.ts', description: 'src/app' },
		{ name: 'index.ts', description: 'src/app', tabGroupId: 'frontend' },
		{ name: 'button.tsx', description: 'src/app/components', tabGroupId: 'frontend' },
		{ name: 'README.md' },
		{ name: 'guide.md', description: 'docs', tabGroupId: 'docs' },
		{ name: 'changelog.md', description: 'docs', tabGroupId: 'docs' },
		{ name: 'main.test.ts', description: 'tests\\app' },
	];
	const tabGroups: IVerticalTabsFilterTabGroup[] = [
		{ id: 'frontend', name: 'Frontend' },
		{ id: 'docs', name: 'Documentation' },
	];

	/** What is listed after filtering: the labels of the tabs, and the names of the tab groups, with the highlighted text in brackets. */
	function describe(result: IVerticalTabsFilterResult | undefined, filtered: readonly IVerticalTabsFilterTab[] = tabs, groups: readonly IVerticalTabsFilterTabGroup[] = tabGroups) {
		if (!result) {
			return undefined;
		}

		const highlight = (text: string, matches: readonly IMatch[]) => {
			let highlighted = '';
			let position = 0;
			for (const { start, end } of matches) {
				highlighted += `${text.slice(position, start)}[${text.slice(start, end)}]`;
				position = end;
			}
			return highlighted + text.slice(position);
		};

		return {
			tabs: Array.from(result.tabs, ([index, matches]) => {
				const { name, description } = filtered[index];
				return description === undefined ? highlight(name, matches.name) : `${highlight(name, matches.name)} (${highlight(description, matches.description)})`;
			}),
			tabGroups: Array.from(result.tabGroups, ([id, matches]) => highlight(groups.find(group => group.id === id)!.name, matches))
		};
	}

	const filter = (query: string) => describe(filterVerticalTabs(query, tabs, tabGroups));

	test('an empty query does not filter', () => {
		assert.deepStrictEqual({ empty: filter(''), blank: filter('  \t '), terms: parseVerticalTabsFilterQuery('  Src\\App   main ') }, {
			empty: undefined,
			blank: undefined,
			terms: ['src/app', 'main']
		});
	});

	test('tabs match by file name and by path, without regard to case, and highlight what matched', () => {
		assert.deepStrictEqual({
			name: filter('MAIN'),
			path: filter('components'),
			pathAcrossSlash: filter('app/comp'),
			nothing: filter('zzz')
		}, {
			name: { tabs: ['[main].ts (src/app)', '[main].test.ts (tests\\app)'], tabGroups: [] },
			path: { tabs: ['button.tsx (src/app/[components])'], tabGroups: ['Frontend'] },
			pathAcrossSlash: { tabs: ['button.tsx (src/[app/comp]onents)'], tabGroups: ['Frontend'] },
			nothing: { tabs: [], tabGroups: [] }
		});
	});

	test('every term has to match, in the name or in the path, and a path matches with either kind of slash', () => {
		assert.deepStrictEqual({
			nameAndPath: filter('main app'),
			backslash: filter('tests\\app'),
			forwardSlash: filter('tests/app'),
			oneTermMissing: filter('main zzz'),
			overlappingTerms: describe(filterVerticalTabs('ab bc', [{ name: 'abcd' }, { name: 'ab' }], []), [{ name: 'abcd' }, { name: 'ab' }], [])
		}, {
			nameAndPath: { tabs: ['[main].ts (src/[app])', '[main].test.ts (tests\\[app])'], tabGroups: [] },
			backslash: { tabs: ['main.test.ts ([tests\\app])'], tabGroups: [] },
			forwardSlash: { tabs: ['main.test.ts ([tests\\app])'], tabGroups: [] },
			oneTermMissing: { tabs: [], tabGroups: [] },
			overlappingTerms: { tabs: ['[abc]d'], tabGroups: [] }
		});
	});

	test('a tab group stays when any of its tabs match and is left out when none of them do', () => {
		assert.deepStrictEqual({
			oneGroupHasMatches: filter('index'),
			otherGroupHasMatches: filter('md'),
			noGroupHasMatches: filter('main')
		}, {
			oneGroupHasMatches: { tabs: ['[index].ts (src/app)'], tabGroups: ['Frontend'] },
			otherGroupHasMatches: { tabs: ['README.[md]', 'guide.[md] (docs)', 'changelog.[md] (docs)'], tabGroups: ['Documentation'] },
			noGroupHasMatches: { tabs: ['[main].ts (src/app)', '[main].test.ts (tests\\app)'], tabGroups: [] }
		});
	});

	test('a tab group that matches by name stays with all of its tabs, but only when its name has every term', () => {
		assert.deepStrictEqual({
			byName: filter('umentat'),
			partOfName: filter('FRONT'),
			termsSplitOverGroupNameAndTab: filter('end index')
		}, {
			byName: { tabs: ['guide.md (docs)', 'changelog.md (docs)'], tabGroups: ['Doc[umentat]ion'] },
			partOfName: { tabs: ['index.ts (src/app)', 'button.tsx (src/app/components)'], tabGroups: ['[Front]end'] },
			termsSplitOverGroupNameAndTab: { tabs: [], tabGroups: [] }
		});
	});
});
