/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AutoGroupPatternProblem, AutoGroupRulesModel, validateAutoGroupPattern } from '../../common/autoGroupRulesModel.js';

suite('Auto-grouping rules model', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const names = (model: AutoGroupRulesModel) => model.rules.map(rule => rule.name);

	function createModel(): AutoGroupRulesModel {
		return new AutoGroupRulesModel([
			{ name: 'API', pattern: 'src/api/**', color: 'blue', icon: 'globe' },
			{ name: 'Tests', pattern: '**/*.test.ts' },
			{ name: 'Docs', pattern: 'docs/**' }
		]);
	}

	test('reads the rules of the setting and leaves out what is not a rule', () => {
		const model = new AutoGroupRulesModel([{ name: ' API ', pattern: 'src/api/**' }, { name: '', pattern: 'x' }, 'nope', null, { name: 'Docs' }]);

		assert.deepStrictEqual(model.rules.map(({ name, pattern }) => ({ name, pattern })), [{ name: 'API', pattern: 'src/api/**' }]);
		assert.deepStrictEqual(new AutoGroupRulesModel('not a list').rules, []);
	});

	test('validates names and patterns', () => {
		const model = new AutoGroupRulesModel();
		const { id } = model.add();
		const empty = model.validate(id);
		model.update(id, { name: 'API', pattern: 'src/{api,lib/**' });
		const unbalanced = model.validate(id);
		model.update(id, { pattern: 'src/api/**' });

		assert.deepStrictEqual({
			empty,
			unbalanced,
			valid: model.validate(id),
			canSave: model.canSave,
			patterns: ['', '   ', 'a/**', '**/*.{ts,js}', 'a/[abc].ts', 'a/[abc.ts', 'a/abc].ts', 'a/{b,c', 'a/b}'].map(validateAutoGroupPattern)
		}, {
			empty: { name: true, pattern: AutoGroupPatternProblem.Empty },
			unbalanced: { name: false, pattern: AutoGroupPatternProblem.UnbalancedBraces },
			valid: { name: false, pattern: undefined },
			canSave: true,
			patterns: [
				AutoGroupPatternProblem.Empty, AutoGroupPatternProblem.Empty, undefined, undefined, undefined,
				AutoGroupPatternProblem.UnbalancedBrackets, AutoGroupPatternProblem.UnbalancedBrackets, AutoGroupPatternProblem.UnbalancedBraces, AutoGroupPatternProblem.UnbalancedBraces
			]
		});
	});

	test('cannot be saved while a rule is incomplete', () => {
		const model = createModel();
		const before = model.canSave;
		const added = model.add();

		assert.deepStrictEqual({ before, withEmptyRule: model.canSave, afterRemoving: (model.remove(added.id), model.canSave) }, { before: true, withEmptyRule: false, afterRemoving: true });
	});

	test('moves rules up and down and stops at the ends', () => {
		const model = createModel();
		const [api, tests, docs] = model.rules.map(rule => rule.id);

		model.move(docs, -1);
		const afterUp = names(model);
		model.move(api, -1);
		const atTop = names(model);
		model.move(api, 5);
		const atBottom = names(model);
		model.moveTo(tests, 0);
		const afterMoveTo = names(model);
		model.move(9999, 1);

		assert.deepStrictEqual({ afterUp, atTop, atBottom, afterMoveTo, unknown: names(model) }, {
			afterUp: ['API', 'Docs', 'Tests'],
			atTop: ['API', 'Docs', 'Tests'],
			atBottom: ['Docs', 'Tests', 'API'],
			afterMoveTo: ['Tests', 'Docs', 'API'],
			unknown: ['Tests', 'Docs', 'API']
		});
	});

	test('removes and edits the rule with the id, whatever its place', () => {
		const model = createModel();
		const [api, tests] = model.rules.map(rule => rule.id);

		model.move(api, 2);
		model.remove(tests);
		model.update(api, { name: 'Services', color: undefined, icon: undefined });

		assert.deepStrictEqual(model.rules.map(({ name, color, icon }) => ({ name, color, icon })), [
			{ name: 'Docs', color: undefined, icon: undefined },
			{ name: 'Services', color: undefined, icon: undefined }
		]);
	});

	test('serializes trimmed rules in order, with only the details that are set', () => {
		const model = createModel();
		model.update(model.rules[1].id, { name: '  Tests  ', pattern: ' **/*.test.ts ', color: 'green', icon: '' });
		model.move(model.rules[2].id, -2);

		assert.deepStrictEqual(model.serialize(), [
			{ name: 'Docs', pattern: 'docs/**' },
			{ name: 'API', pattern: 'src/api/**', color: 'blue', icon: 'globe' },
			{ name: 'Tests', pattern: '**/*.test.ts', color: 'green' }
		]);
		assert.deepStrictEqual(new AutoGroupRulesModel(model.serialize()).serialize(), model.serialize());
	});

	test('counts the files of each rule the way they are grouped when opened', () => {
		const model = createModel();
		model.add();
		const resource = (path: string) => ({ absolutePath: `/work/${path}`, relativePath: path });
		const resources = [resource('src/api/user.ts'), resource('src/api/user.test.ts'), resource('docs/a.md'), resource('docs/b.md'), resource('src/main.ts')];

		const counts = model.rules.map(rule => model.countMatches(resources).get(rule.id));
		model.move(model.rules[1].id, -1);
		const reordered = model.rules.map(rule => model.countMatches(resources).get(rule.id));

		assert.deepStrictEqual({ counts, reordered }, {
			counts: [2, 0, 2, 0],
			reordered: [1, 1, 2, 0]
		});
	});
});
