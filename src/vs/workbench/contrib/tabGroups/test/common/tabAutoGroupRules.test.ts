/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EDITOR_TAB_GROUP_COLORS } from '../../../../common/editor/editorTabGroup.js';
import { findEditorsRemovedFromTabGroups, findTabAutoGroupRule, getTabAutoGroupColor, ITabAutoGroupResource, parseTabAutoGroupRules, TabAutoGroupRemovals, toTabAutoGroupResource } from '../../common/tabAutoGroupRules.js';

suite('Tab Auto Group Rules', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function file(relativePath: string | undefined, absolutePath = `/work/proj/${relativePath}`): ITabAutoGroupResource {
		return { absolutePath, relativePath };
	}

	suite('parsing', () => {

		test('keeps rules that have a name and a pattern in their order and trims their text', () => {
			assert.deepStrictEqual(parseTabAutoGroupRules([
				{ name: ' Tests ', pattern: ' **/*.test.ts ', color: ' red ', icon: 'beaker' },
				{ name: 'Docs', pattern: 'docs/**', color: '', icon: 7 },
				{ name: 'No pattern' },
				{ pattern: '**/*.md' },
				{ name: '  ', pattern: '**' },
				{ name: 'Not text', pattern: ['**'] },
				null,
				'Docs',
				[],
				{ name: 'Last', pattern: '*.json', extra: true }
			]), [
				{ name: 'Tests', pattern: '**/*.test.ts', color: 'red', icon: 'beaker' },
				{ name: 'Docs', pattern: 'docs/**', color: undefined, icon: undefined },
				{ name: 'Last', pattern: '*.json', color: undefined, icon: undefined }
			]);
		});

		test('ignores a setting that is not a list', () => {
			assert.deepStrictEqual([undefined, null, 'rules', 3, {}, { name: 'a', pattern: 'b' }].map(value => parseTabAutoGroupRules(value)), [[], [], [], [], [], []]);
		});
	});

	suite('matching', () => {

		const rules = parseTabAutoGroupRules([
			{ name: 'Tests', pattern: '**/*.test.ts' },
			{ name: 'Docs', pattern: 'docs/**' },
			{ name: 'Source', pattern: '**/*.ts' },
			{ name: 'Root', pattern: '*.json' },
			{ name: 'Scripts', pattern: '{scripts,build}/**/*.{sh,ps1}' },
			{ name: 'Posix', pattern: '/opt/shared/**' },
			{ name: 'Windows', pattern: 'C:\\shared\\**' }
		]);

		function name(resource: ITabAutoGroupResource): string | undefined {
			return findTabAutoGroupRule(rules, resource)?.name;
		}

		test('matches relative patterns against the path in the workspace folder', () => {
			assert.deepStrictEqual([
				name(file('src/a.test.ts')),
				name(file('docs/guide/intro.md')),
				name(file('src/a.ts')),
				name(file('package.json')),
				name(file('src/package.json')),
				name(file('scripts/ci/run.sh')),
				name(file('build/setup.ps1')),
				name(file('notes/readme.md'))
			], ['Tests', 'Docs', 'Source', 'Root', undefined, 'Scripts', 'Scripts', undefined]);
		});

		test('matches a folder path as written, with either slash, a leading ./, a trailing slash and any case', () => {
			const folderRules = [{ name: 'Components', pattern: 'src\\components' }, { name: 'Lib', pattern: './lib/' }];
			const folderName = (path: string, ignoreCase?: boolean) => findTabAutoGroupRule(folderRules, file(path), ignoreCase)?.name;

			assert.deepStrictEqual([
				folderName('src/components/AuthButton.tsx'),
				folderName('src/components/devtools/DevTools.tsx'),
				folderName('src/components'),
				folderName('src/componentsOld/Button.tsx'),
				folderName('lib/util.ts'),
				folderName('Src/Components/Footer.tsx', true),
				folderName('Src/Components/Footer.tsx', false)
			], ['Components', 'Components', 'Components', undefined, 'Lib', 'Components', undefined]);
		});

		test('applies the first rule that matches, not the most specific one', () => {
			const resource = file('docs/api.test.ts');

			assert.deepStrictEqual({
				listedOrder: findTabAutoGroupRule(rules, resource)?.name,
				reversed: findTabAutoGroupRule([...rules].reverse(), resource)?.name
			}, { listedOrder: 'Tests', reversed: 'Source' });
		});

		test('matches absolute patterns against the full path, ignoring the case of the drive and the kind of slash', () => {
			assert.deepStrictEqual([
				name(file(undefined, '/opt/shared/lib/util.js')),
				name(file(undefined, '/opt/other/util.js')),
				name(file(undefined, 'c:/shared/lib/util.js')),
				name(file(undefined, 'C:/shared/lib/util.js')),
				name(file('shared/lib/util.js', 'd:/shared/lib/util.js'))
			], ['Posix', undefined, 'Windows', 'Windows', undefined]);
		});

		test('matches relative patterns against the path of files that are not in a workspace folder', () => {
			assert.deepStrictEqual([
				name(file(undefined, '/home/me/notes/a.test.ts')),
				name(file(undefined, '/home/me/docs/intro.md'))
			], ['Tests', undefined]);
		});

		test('describes where a file is', () => {
			const workspaceFolder = URI.file('/work/proj');

			assert.deepStrictEqual([
				toTabAutoGroupResource(URI.file('/work/proj/src/a.ts'), workspaceFolder),
				toTabAutoGroupResource(URI.file('/elsewhere/a.ts'), undefined),
				toTabAutoGroupResource(URI.from({ scheme: 'vscode-remote', authority: 'host', path: '/work/proj/b.ts' }), URI.from({ scheme: 'vscode-remote', authority: 'host', path: '/work/proj' }))
			], [
				{ absolutePath: '/work/proj/src/a.ts', relativePath: 'src/a.ts' },
				{ absolutePath: '/elsewhere/a.ts', relativePath: undefined },
				{ absolutePath: '/work/proj/b.ts', relativePath: 'b.ts' }
			]);
		});
	});

	suite('colors', () => {

		test('rules without a color get the same color for the same name, from the colors of tab groups', () => {
			const colors = ['Tests', 'Docs', 'Source', 'Tests'].map(name => getTabAutoGroupColor({ name, pattern: '**' }));

			assert.deepStrictEqual({
				sameNameSameColor: colors[0] === colors[3],
				presets: colors.every(color => EDITOR_TAB_GROUP_COLORS.some(preset => preset.id === color)),
				explicit: getTabAutoGroupColor({ name: 'Tests', pattern: '**', color: '#ff8800' })
			}, { sameNameSameColor: true, presets: true, explicit: '#ff8800' });
		});
	});

	suite('removals', () => {

		test('finds the editors that left their tab group and are still open', () => {
			const previous = new Map([['a', 'group 1'], ['b', 'group 1'], ['c', 'group 2'], ['d', 'group 2'], ['e', 'group 3']]);
			const current = new Map<string, string | undefined>([['a', 'group 1'], ['b', undefined], ['c', 'group 1'], ['d', undefined], ['f', undefined]]);

			assert.deepStrictEqual(findEditorsRemovedFromTabGroups(previous, current), ['b', 'd']); // `e` was closed and `f` was never in a group
		});

		test('remembers removals per file and editor group until they are forgotten', () => {
			const removals = new TabAutoGroupRemovals();
			const first = URI.file('/work/proj/a.ts');
			const second = URI.file('/work/proj/b.ts');
			removals.remember(1, first);
			removals.remember(1, URI.file('/work/proj/a.ts'));
			removals.remember(3, first);
			removals.remember(4, first);
			const remembered = [removals.has(1, first), removals.has(3, first), removals.has(4, first), removals.has(2, first), removals.has(1, second)];

			removals.forget(3, first);
			removals.forgetGroup(4);

			assert.deepStrictEqual({ remembered, afterForgetting: [removals.has(1, first), removals.has(3, first), removals.has(4, first)] }, {
				remembered: [true, true, true, false, false],
				afterForgetting: [true, false, false]
			});
		});
	});
});
