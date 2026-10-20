/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { closeTabGroup } from '../../../../browser/parts/editor/editorCommands.js';
import { IEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorTabGroup } from '../../../../common/editor/editorTabGroup.js';
import { IHistoryService } from '../../../../services/history/common/history.js';
import { createEditorPart, registerTestEditor, registerTestFileEditor, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../workbenchTestServices.js';

suite('Tab Group Commands', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTabGroupCommands';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTabGroupCommands';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
		disposables.add(registerTestFileEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	async function createTabGroup(options: { saved: boolean; locked: boolean }): Promise<{ instantiationService: ReturnType<typeof workbenchInstantiationService>; group: IEditorGroupView; tabGroup: IEditorTabGroup; closedGroups: string[]; historyService: IHistoryService }> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		const group = part.activeGroup;

		const editors: EditorInput[] = [];
		for (const name of ['first', 'second', 'other']) {
			const editor = disposables.add(new TestFileEditorInput(URI.parse(`foo://${name}`), TEST_EDITOR_INPUT_ID));
			await group.openEditor(editor, { pinned: true });
			editors.push(editor);
		}
		const tabGroup = group.createTabGroup(editors.slice(0, 2), 'Work', 'blue', options);
		assert.ok(tabGroup);

		const closedGroups: string[] = [];
		const historyService = new class extends mock<IHistoryService>() {
			override saveClosedTabGroup(closedGroup: IEditorTabGroup, closedEditors: readonly { editor: EditorInput; index: number }[]): void {
				closedGroups.push(`${closedGroup.name}: ${closedEditors.map(({ editor, index }) => `${index}=${editor.resource?.authority}`).join(', ')}`);
			}
		};

		return { instantiationService, group, tabGroup, closedGroups, historyService };
	}

	for (const scenario of [
		{ name: 'saved group is closed and recorded', saved: true, locked: false, expected: { editors: ['other'], closedGroups: ['Work: 0=first, 1=second'] } },
		{ name: 'group that is not saved is closed without being recorded', saved: false, locked: false, expected: { editors: ['other'], closedGroups: [] } },
		{ name: 'locked group is left alone', saved: true, locked: true, expected: { editors: ['first', 'second', 'other'], closedGroups: [] } }
	]) {
		test(`close tab group: ${scenario.name}`, async () => {
			const { instantiationService, group, tabGroup, closedGroups, historyService } = await createTabGroup(scenario);

			await closeTabGroup(group, tabGroup, historyService, true);

			assert.deepStrictEqual({ editors: group.editors.map(editor => editor.resource?.authority), closedGroups }, scenario.expected);

			return workbenchTeardown(instantiationService);
		});
	}

	ensureNoDisposablesAreLeakedInTestSuite();
});
