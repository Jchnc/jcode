/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceAppearance, IWorkspaceAppearancePreview, IWorkspaceAppearanceService, normalizeWorkspaceColor, WorkspaceAppearancePreviewEnd } from '../common/workspaceAppearance.js';

/** What a preview needs from the service that started it. */
interface IWorkspaceAppearancePreviewHost {
	didUpdate(): void;
	save(appearance: IWorkspaceAppearance | undefined): void;
	didEnd(preview: WorkspaceAppearancePreview): void;
}

/** One owner's reversible preview. It never touches the workspace once it has ended. */
class WorkspaceAppearancePreview implements IWorkspaceAppearancePreview {
	private readonly endEmitter = new Emitter<WorkspaceAppearancePreviewEnd>();
	readonly onDidEnd = this.endEmitter.event;
	private active = true;

	constructor(
		public appearance: IWorkspaceAppearance | undefined,
		private readonly host: IWorkspaceAppearancePreviewHost
	) { }

	get isActive(): boolean {
		return this.active;
	}

	update(appearance: IWorkspaceAppearance | undefined): void {
		if (!this.active) {
			return;
		}
		const color = appearance && normalizeWorkspaceColor(appearance.color);
		const next = color && appearance ? { color, style: appearance.style } : undefined;
		if (next?.color === this.appearance?.color && next?.style === this.appearance?.style) {
			return;
		}
		this.appearance = next;
		this.host.didUpdate();
	}

	apply(): boolean {
		if (!this.active) {
			return false;
		}
		this.host.save(this.appearance);
		this.end(WorkspaceAppearancePreviewEnd.Applied);
		return true;
	}

	dispose(): void {
		this.end(WorkspaceAppearancePreviewEnd.Cancelled);
	}

	end(reason: WorkspaceAppearancePreviewEnd): void {
		if (!this.active) {
			return;
		}
		this.active = false;
		this.host.didEnd(this);
		this.endEmitter.fire(reason);
		this.endEmitter.dispose();
	}
}

/** Owns machine-local persistence and reversible workspace color previews. */
export class WorkspaceAppearanceService extends Disposable implements IWorkspaceAppearanceService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'workbench.workspaceAppearance';
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChangeAppearance = this.changeEmitter.event;
	private activePreview: WorkspaceAppearancePreview | undefined;
	private workspaceId: string;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) {
		super();
		this.workspaceId = contextService.getWorkspace().id;
		this._register(storageService.onDidChangeValue(StorageScope.WORKSPACE, WorkspaceAppearanceService.STORAGE_KEY, this._store)(() => {
			if (!this.activePreview) {
				this.changeEmitter.fire();
			}
		}));
		const onWorkspaceChange = () => {
			if (this.workspaceId !== contextService.getWorkspace().id) {
				this.workspaceId = contextService.getWorkspace().id;
				const preview = this.activePreview;
				this.activePreview = undefined;
				preview?.end(WorkspaceAppearancePreviewEnd.Cancelled);
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
		return this.activePreview ? this.activePreview.appearance : this.savedAppearance;
	}

	private get savedAppearance(): IWorkspaceAppearance | undefined {
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
		const previous = this.activePreview;
		// Start from what is saved: another owner's unsaved preview must not leak into this one.
		const preview = new WorkspaceAppearancePreview(this.savedAppearance, {
			didUpdate: () => this.changeEmitter.fire(),
			save: appearance => this.storageService.store(WorkspaceAppearanceService.STORAGE_KEY, appearance, StorageScope.WORKSPACE, StorageTarget.MACHINE),
			didEnd: ended => {
				if (this.activePreview === ended) {
					this.activePreview = undefined;
					this.changeEmitter.fire();
				}
			}
		});
		this.activePreview = preview;
		if (previous) {
			previous.end(WorkspaceAppearancePreviewEnd.Superseded);
			if (previous.appearance?.color !== preview.appearance?.color || previous.appearance?.style !== preview.appearance?.style) {
				this.changeEmitter.fire();
			}
		}
		return preview;
	}
}

registerSingleton(IWorkspaceAppearanceService, WorkspaceAppearanceService, InstantiationType.Delayed);
