/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFoldersChangeEvent, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { Workspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { WorkspaceAppearanceService } from '../../browser/workspaceAppearanceService.js';
import { IWorkspaceAppearance, WorkspaceAppearancePreviewEnd } from '../../common/workspaceAppearance.js';

suite('WorkspaceAppearanceService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const azure: IWorkspaceAppearance = { color: '#3b82f6', style: 'subtle' };
	const jade: IWorkspaceAppearance = { color: '#16a34a', style: 'prominent' };
	const orchid: IWorkspaceAppearance = { color: '#9333ea', style: 'subtle' };

	function createService() {
		const storage = store.add(new TestStorageService());
		const foldersChanged = store.add(new Emitter<IWorkspaceFoldersChangeEvent>());
		let workspace = new Workspace('first', []);
		const contextService = new class extends mock<IWorkspaceContextService>() {
			override readonly onDidChangeWorkbenchState = store.add(new Emitter<WorkbenchState>()).event;
			override readonly onDidChangeWorkspaceFolders = foldersChanged.event;
			override readonly onDidChangeWorkspaceName = store.add(new Emitter<void>()).event;
			override getWorkbenchState() { return WorkbenchState.FOLDER; }
			override getWorkspace(): IWorkspace { return workspace; }
		}();
		const service = store.add(new WorkspaceAppearanceService(storage, contextService));
		let changes = 0;
		store.add(service.onDidChangeAppearance(() => changes++));
		return {
			service,
			saved: () => storage.getObject('workbench.workspaceAppearance', StorageScope.WORKSPACE),
			changes: () => changes,
			switchWorkspace: () => { workspace = new Workspace('second', []); foldersChanged.fire({ added: [], removed: [], changed: [] }); },
		};
	}

	test('a new preview supersedes the previous one without being cancelled or applied for it', () => {
		const { service, saved } = createService();
		const firstEnds: WorkspaceAppearancePreviewEnd[] = [];
		const first = service.beginPreview();
		store.add(first.onDidEnd(reason => firstEnds.push(reason)));
		first.update(azure);
		const second = service.beginPreview();
		const secondEnds: WorkspaceAppearancePreviewEnd[] = [];
		store.add(second.onDidEnd(reason => secondEnds.push(reason)));
		second.update(jade);

		first.update(orchid);
		const staleApply = first.apply();
		first.dispose();
		const whileSecondOwns = { appearance: service.appearance, secondActive: second.isActive, saved: saved() };
		const secondApply = second.apply();

		assert.deepStrictEqual({
			first: { active: first.isActive, ends: firstEnds, applied: staleApply },
			whileSecondOwns,
			second: { active: second.isActive, ends: secondEnds, applied: secondApply },
			appearance: service.appearance,
			saved: saved(),
		}, {
			first: { active: false, ends: [WorkspaceAppearancePreviewEnd.Superseded], applied: false },
			whileSecondOwns: { appearance: jade, secondActive: true, saved: undefined },
			second: { active: false, ends: [WorkspaceAppearancePreviewEnd.Applied], applied: true },
			appearance: jade,
			saved: jade,
		});
	});

	test('a new preview starts from the saved appearance rather than another owner\'s unsaved one', () => {
		const { service, saved } = createService();
		const initial = service.beginPreview();
		initial.update(azure);
		initial.apply();
		const first = service.beginPreview();
		first.update(jade);
		const second = service.beginPreview();
		const shown = service.appearance;
		second.apply();

		assert.deepStrictEqual({ shown, saved: saved() }, { shown: azure, saved: azure });
	});

	test('notifies listeners when a superseding preview changes what is shown', () => {
		const { service, changes } = createService();
		const first = service.beginPreview();
		first.update(azure);
		const afterFirstUpdate = changes();
		const second = service.beginPreview();
		const afterSuperseded = changes();
		second.dispose();
		const afterCancelled = changes();
		const third = service.beginPreview();
		const afterEmptyPreview = changes();
		third.dispose();

		assert.deepStrictEqual({ afterFirstUpdate, afterSuperseded, afterCancelled, afterEmptyPreview, appearance: service.appearance }, {
			afterFirstUpdate: 1,
			afterSuperseded: 2,
			afterCancelled: 3,
			afterEmptyPreview: 3,
			appearance: undefined,
		});
	});

	test('ends an active preview as cancelled when the workspace changes', () => {
		const { service, saved, switchWorkspace } = createService();
		const preview = service.beginPreview();
		const ends: WorkspaceAppearancePreviewEnd[] = [];
		store.add(preview.onDidEnd(reason => ends.push(reason)));
		preview.update(azure);
		switchWorkspace();
		const applied = preview.apply();

		assert.deepStrictEqual({ active: preview.isActive, ends, applied, appearance: service.appearance, saved: saved() }, {
			active: false,
			ends: [WorkspaceAppearancePreviewEnd.Cancelled],
			applied: false,
			appearance: undefined,
			saved: undefined,
		});
	});
});
