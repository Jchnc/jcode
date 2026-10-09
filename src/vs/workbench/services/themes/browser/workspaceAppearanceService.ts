/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceAppearance, IWorkspaceAppearancePreview, IWorkspaceAppearanceService, normalizeWorkspaceColor } from '../common/workspaceAppearance.js';

/** Owns machine-local persistence and reversible workspace color previews. */
class WorkspaceAppearanceService extends Disposable implements IWorkspaceAppearanceService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'workbench.workspaceAppearance';
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChangeAppearance = this.changeEmitter.event;
	private preview: { appearance: IWorkspaceAppearance | undefined } | undefined;
	private workspaceId: string;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) {
		super();
		this.workspaceId = contextService.getWorkspace().id;
		this._register(storageService.onDidChangeValue(StorageScope.WORKSPACE, WorkspaceAppearanceService.STORAGE_KEY, this._store)(() => {
			if (!this.preview) {
				this.changeEmitter.fire();
			}
		}));
		const onWorkspaceChange = () => {
			if (this.workspaceId !== contextService.getWorkspace().id) {
				this.workspaceId = contextService.getWorkspace().id;
				this.preview = undefined;
				this.changeEmitter.fire();
			}
		};
		this._register(contextService.onDidChangeWorkbenchState(onWorkspaceChange));
		this._register(contextService.onDidChangeWorkspaceFolders(onWorkspaceChange));
		this._register(contextService.onDidChangeWorkspaceName(onWorkspaceChange));
	}

	get appearance(): IWorkspaceAppearance | undefined {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return undefined;
		}
		if (this.preview) {
			return this.preview.appearance;
		}
		try {
			const stored = this.storageService.getObject<Partial<IWorkspaceAppearance>>(WorkspaceAppearanceService.STORAGE_KEY, StorageScope.WORKSPACE);
			const color = typeof stored?.color === 'string' ? normalizeWorkspaceColor(stored.color) : undefined;
			return color && (stored?.style === 'subtle' || stored?.style === 'prominent') ? { color, style: stored.style } : undefined;
		} catch {
			// Invalid persisted data must not prevent the theme from loading.
			return undefined;
		}
	}

	beginPreview(): IWorkspaceAppearancePreview {
		const preview = { appearance: this.appearance };
		this.preview = preview;
		return {
			update: appearance => {
				if (this.preview === preview) {
					const color = appearance && normalizeWorkspaceColor(appearance.color);
					const next = color && appearance ? { color, style: appearance.style } : undefined;
					if (next?.color === preview.appearance?.color && next?.style === preview.appearance?.style) {
						return;
					}
					preview.appearance = next;
					this.changeEmitter.fire();
				}
			},
			apply: () => {
				if (this.preview === preview) {
					this.storageService.store(WorkspaceAppearanceService.STORAGE_KEY, preview.appearance, StorageScope.WORKSPACE, StorageTarget.MACHINE);
					this.preview = undefined;
					this.changeEmitter.fire();
				}
			},
			dispose: () => {
				if (this.preview === preview) {
					this.preview = undefined;
					this.changeEmitter.fire();
				}
			}
		};
	}
}

registerSingleton(IWorkspaceAppearanceService, WorkspaceAppearanceService, InstantiationType.Delayed);
