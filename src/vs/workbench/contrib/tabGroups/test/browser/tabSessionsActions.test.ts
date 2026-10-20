/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { GroupOrientation } from '../../../../services/editor/common/editorGroupsService.js';
import { ITabSession, ITabSessionEditor } from '../../common/tabSessions.js';
import { createTabSessionPicks } from '../../browser/tabSessionsActions.js';

suite('Tab Session Actions', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function editors(...names: string[]): ITabSessionEditor[] {
		return names.map(name => ({ typeId: 'test.editor', value: '{}', name }));
	}

	function createSession(id: string, name: string, groups: ITabSession['groups']): ITabSession {
		return { id, name, savedAt: 1, layout: { orientation: GroupOrientation.HORIZONTAL, groups: groups.map(() => ({})) }, groups, activeGroup: 0 };
	}

	test('session picks describe what the session contains', () => {
		const picks = createTabSessionPicks([
			createSession('big', 'Big $(star)', [
				{ editors: editors('a.ts', 'b.ts', 'c.ts', 'd.ts'), tabGroups: [{ name: 'Docs', color: 'blue', members: [0, 1] }] },
				{ editors: editors('e.ts', 'f.ts', '') }
			]),
			createSession('small', 'Small', [{ editors: editors('readme.md') }]),
			createSession('empty', 'Empty', [{ editors: [] }, { editors: [] }])
		], [{ iconClass: 'rename' }, { iconClass: 'delete' }]);

		assert.deepStrictEqual(picks.map(({ sessionId, label, description, detail, ariaLabel, buttons }) => ({ sessionId, label, description, detail, ariaLabel, buttons: buttons?.map(button => button.iconClass) })), [{
			sessionId: 'big',
			label: 'Big \\$(star)',
			description: '2 editor groups, 7 tabs, 1 tab group',
			detail: 'a.ts, b.ts, c.ts, d.ts, +2 more',
			ariaLabel: 'Big $(star), 2 editor groups, 7 tabs, 1 tab group',
			buttons: ['rename', 'delete']
		}, {
			sessionId: 'small',
			label: 'Small',
			description: '1 editor group, 1 tab',
			detail: 'readme.md',
			ariaLabel: 'Small, 1 editor group, 1 tab',
			buttons: ['rename', 'delete']
		}, {
			sessionId: 'empty',
			label: 'Empty',
			description: '2 editor groups, 0 tabs',
			detail: undefined,
			ariaLabel: 'Empty, 2 editor groups, 0 tabs',
			buttons: ['rename', 'delete']
		}]);
	});
});
