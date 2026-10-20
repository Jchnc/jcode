/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFoldersChangeEvent, toWorkspaceFolder, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { Workspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { getAutomaticWorkspaceColor } from '../../../../common/workspaceColorPalette.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { WorkspaceAppearanceService } from '../../browser/workspaceAppearanceService.js';
import { IWorkspaceAppearance, WORKSPACE_COLOR_AUTO_REMOTE_SETTING, WorkspaceAppearancePreviewEnd } from '../../common/workspaceAppearance.js';

suite('WorkspaceAppearanceService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const azure: IWorkspaceAppearance = { color: '#3b82f6', style: 'subtle' };
	const jade: IWorkspaceAppearance = { color: '#16a34a', style: 'prominent' };
	const orchid: IWorkspaceAppearance = { color: '#9333ea', style: 'subtle' };

	const local = URI.file('/project');
	const remote = (connection: string) => URI.from({ scheme: 'jcode-sftp', authority: connection, path: '/srv' });

	function createService(options: { folders?: URI[]; storage?: TestStorageService; configuration?: TestConfigurationService } = {}) {
		const storage = options.storage ?? store.add(new TestStorageService());
		const configuration = options.configuration ?? new TestConfigurationService();
		const foldersChanged = store.add(new Emitter<IWorkspaceFoldersChangeEvent>());
		let workspace = new Workspace('first', (options.folders ?? []).map(toWorkspaceFolder));
		const contextService = new class extends mock<IWorkspaceContextService>() {
			override readonly onDidChangeWorkbenchState = store.add(new Emitter<WorkbenchState>()).event;
			override readonly onDidChangeWorkspaceFolders = foldersChanged.event;
			override readonly onDidChangeWorkspaceName = store.add(new Emitter<void>()).event;
			override getWorkbenchState() { return WorkbenchState.FOLDER; }
			override getWorkspace(): IWorkspace { return workspace; }
		}();
		const service = store.add(new WorkspaceAppearanceService(storage, contextService, configuration));
		let changes = 0;
		store.add(service.onDidChangeAppearance(() => changes++));
		return {
			service,
			storage,
			configuration,
			saved: () => storage.getObject('workbench.workspaceAppearance', StorageScope.WORKSPACE),
			changes: () => changes,
			switchWorkspace: () => { workspace = new Workspace('second', []); foldersChanged.fire({ added: [], removed: [], changed: [] }); },
			setFolders: (folders: URI[]) => { workspace = new Workspace('first', folders.map(toWorkspaceFolder)); foldersChanged.fire({ added: [], removed: [], changed: [] }); },
			setAutoRemote: (enabled: boolean) => {
				void configuration.setUserConfiguration(WORKSPACE_COLOR_AUTO_REMOTE_SETTING, enabled);
				configuration.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([WORKSPACE_COLOR_AUTO_REMOTE_SETTING]), change: { keys: [WORKSPACE_COLOR_AUTO_REMOTE_SETTING], overrides: [] }, affectsConfiguration: key => key === WORKSPACE_COLOR_AUTO_REMOTE_SETTING });
			},
		};
	}

	function shown(service: WorkspaceAppearanceService) {
		return { appearance: service.appearance, automatic: service.isAutomatic, chosen: service.hasChoice };
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

	test('ends an active preview as cancelled when the service is disposed', () => {
		const { service, saved, changes } = createService();
		const preview = service.beginPreview();
		const ends: WorkspaceAppearancePreviewEnd[] = [];
		store.add(preview.onDidEnd(reason => ends.push(reason)));
		preview.update(azure);
		const changesBefore = changes();

		service.dispose();
		const applied = preview.apply();

		assert.deepStrictEqual({ active: preview.isActive, ends, applied, saved: saved(), changesAfterDispose: changes() - changesBefore }, {
			active: false,
			ends: [WorkspaceAppearancePreviewEnd.Cancelled],
			applied: false,
			saved: undefined,
			changesAfterDispose: 0,
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

	suite('automatic color of a remote workspace', () => {

		const automatic: IWorkspaceAppearance = { color: getAutomaticWorkspaceColor([remote('connection-1')])!, style: 'subtle' };

		test('gives a workspace entirely on SFTP a color until the user chooses one, and never overwrites a choice', () => {
			const { service, storage, configuration, saved } = createService({ folders: [remote('connection-1')] });
			const initial = shown(service);

			const choose = (appearance: IWorkspaceAppearance | undefined) => {
				const preview = service.beginPreview();
				preview.update(appearance);
				preview.apply();
				return { ...shown(service), saved: saved() };
			};
			const chosenColor = choose(jade);
			const chosenSameAsAutomatic = choose(automatic);
			const chosenNone = choose(undefined);
			// A window opened later reads the same choices back.
			const reopened = shown(createService({ folders: [remote('connection-1')], storage, configuration }).service);
			const preview = service.beginPreview();
			preview.useDefault();
			preview.apply();
			const defaulted = { ...shown(service), saved: saved() };

			assert.deepStrictEqual({ initial, chosenColor, chosenSameAsAutomatic, chosenNone, reopened, defaulted }, {
				initial: { appearance: automatic, automatic: true, chosen: false },
				chosenColor: { appearance: jade, automatic: false, chosen: true, saved: jade },
				chosenSameAsAutomatic: { appearance: automatic, automatic: false, chosen: true, saved: automatic },
				chosenNone: { appearance: undefined, automatic: false, chosen: true, saved: { none: true } },
				reopened: { appearance: undefined, automatic: false, chosen: true },
				defaulted: { appearance: automatic, automatic: true, chosen: false, saved: undefined },
			});
		});

		test('leaves a workspace that is not entirely on SFTP uncolored, and chooses nothing for it by choosing no color', () => {
			const local1 = createService({ folders: [local] });
			const mixed = createService({ folders: [remote('connection-1'), local] });
			const none = (created: ReturnType<typeof createService>) => {
				const preview = created.service.beginPreview();
				preview.update(undefined);
				preview.apply();
				return { ...shown(created.service), saved: created.saved() };
			};

			assert.deepStrictEqual({ local: shown(local1.service), mixed: shown(mixed.service), localNone: none(local1), mixedNone: none(mixed) }, {
				local: { appearance: undefined, automatic: false, chosen: false },
				mixed: { appearance: undefined, automatic: false, chosen: false },
				localNone: { appearance: undefined, automatic: false, chosen: false, saved: undefined },
				mixedNone: { appearance: undefined, automatic: false, chosen: false, saved: undefined },
			});
		});

		test('previews over the automatic color and goes back to it when the preview is dropped', () => {
			const { service, saved } = createService({ folders: [remote('connection-1')] });
			const preview = service.beginPreview();
			const untouched = shown(service);
			preview.update(orchid);
			const previewing = shown(service);
			preview.useDefault();
			const defaulting = shown(service);
			preview.update(undefined);
			const choosingNone = shown(service);
			preview.dispose();

			assert.deepStrictEqual({ untouched, previewing, defaulting, choosingNone, afterwards: shown(service), saved: saved() }, {
				untouched: { appearance: automatic, automatic: true, chosen: false },
				previewing: { appearance: orchid, automatic: false, chosen: true },
				defaulting: { appearance: automatic, automatic: true, chosen: false },
				choosingNone: { appearance: undefined, automatic: false, chosen: true },
				afterwards: { appearance: automatic, automatic: true, chosen: false },
				saved: undefined,
			});
		});

		test('follows the setting and the folders of the workspace', () => {
			const { service, changes, setAutoRemote, setFolders } = createService({ folders: [remote('connection-1')] });
			const preview = service.beginPreview();
			preview.update(jade);
			preview.apply();
			const explicitWhileOn = shown(service);
			const reset = service.beginPreview();
			reset.useDefault();
			reset.apply();

			const changesBeforeOff = changes();
			setAutoRemote(false);
			const off = { ...shown(service), changes: changes() - changesBeforeOff };
			const changesBeforeOn = changes();
			setAutoRemote(true);
			const on = { ...shown(service), changes: changes() - changesBeforeOn };
			const changesBeforeFolders = changes();
			setFolders([remote('connection-1'), local]);
			const withLocalFolder = { ...shown(service), changes: changes() - changesBeforeFolders };
			const changesBeforeUnrelated = changes();
			setFolders([local, remote('connection-2')]);
			const stillLocal = { ...shown(service), changes: changes() - changesBeforeUnrelated };

			assert.deepStrictEqual({ explicitWhileOn, off, on, withLocalFolder, stillLocal }, {
				explicitWhileOn: { appearance: jade, automatic: false, chosen: true },
				off: { appearance: undefined, automatic: false, chosen: false, changes: 1 },
				on: { appearance: automatic, automatic: true, chosen: false, changes: 1 },
				withLocalFolder: { appearance: undefined, automatic: false, chosen: false, changes: 1 },
				stillLocal: { appearance: undefined, automatic: false, chosen: false, changes: 0 },
			});
		});
	});
});
