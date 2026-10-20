/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { getAutomaticWorkspaceColor } from '../../../common/workspaceColorPalette.js';
import { IWorkspaceAppearance, IWorkspaceAppearancePreview, IWorkspaceAppearanceService, normalizeWorkspaceColor, WORKSPACE_COLOR_AUTO_REMOTE_SETTING, WorkspaceAppearancePreviewEnd } from '../common/workspaceAppearance.js';

/**
 * What the user chose for a workspace color: nothing, which leaves it to the default (the automatic color
 * where the workspace has one), no color at all even where one would be automatic, or a color.
 */
type WorkspaceColorChoice =
	{ readonly kind: 'default' } |
	{ readonly kind: 'none' } |
	{ readonly kind: 'color'; readonly appearance: IWorkspaceAppearance };

const DEFAULT_CHOICE: WorkspaceColorChoice = { kind: 'default' };
const NO_COLOR_CHOICE: WorkspaceColorChoice = { kind: 'none' };

function isSameChoice(a: WorkspaceColorChoice, b: WorkspaceColorChoice): boolean {
	return a.kind === b.kind && (a.kind !== 'color' || (b.kind === 'color' && a.appearance.color === b.appearance.color && a.appearance.style === b.appearance.style));
}

/** What a choice shows: what the user chose, and only if they did not, the automatic color. */
function resolveAppearance(choice: WorkspaceColorChoice, automatic: IWorkspaceAppearance | undefined): IWorkspaceAppearance | undefined {
	switch (choice.kind) {
		case 'color': return choice.appearance;
		case 'none': return undefined;
		default: return automatic;
	}
}

/** What a preview needs from the service that started it. */
interface IWorkspaceAppearancePreviewHost {
	/** The color the workspace gets automatically, which the default choice shows. */
	automaticAppearance(): IWorkspaceAppearance | undefined;
	/** Whether the workspace is one that is given a color automatically, so that choosing none is a choice of its own. */
	canBeAutomatic(): boolean;
	didUpdate(): void;
	save(choice: WorkspaceColorChoice): void;
	didEnd(preview: WorkspaceAppearancePreview): void;
}

/** One owner's reversible preview. It never touches the workspace once it has ended. */
class WorkspaceAppearancePreview implements IWorkspaceAppearancePreview {
	private readonly endEmitter = new Emitter<WorkspaceAppearancePreviewEnd>();
	readonly onDidEnd = this.endEmitter.event;
	private active = true;

	constructor(
		public choice: WorkspaceColorChoice,
		private readonly host: IWorkspaceAppearancePreviewHost
	) { }

	get isActive(): boolean {
		return this.active;
	}

	get appearance(): IWorkspaceAppearance | undefined {
		return resolveAppearance(this.choice, this.host.automaticAppearance());
	}

	get isAutomatic(): boolean {
		return this.choice.kind === 'default' && !!this.host.automaticAppearance();
	}

	update(appearance: IWorkspaceAppearance | undefined): void {
		const color = appearance && normalizeWorkspaceColor(appearance.color);
		// Where no color is ever automatic, choosing none is the same as choosing nothing.
		this.choose(color && appearance ? { kind: 'color', appearance: { color, style: appearance.style } } : this.host.canBeAutomatic() ? NO_COLOR_CHOICE : DEFAULT_CHOICE);
	}

	useDefault(): void {
		this.choose(DEFAULT_CHOICE);
	}

	private choose(next: WorkspaceColorChoice): void {
		if (!this.active || isSameChoice(next, this.choice)) {
			return;
		}
		this.choice = next;
		this.host.didUpdate();
	}

	apply(): boolean {
		if (!this.active) {
			return false;
		}
		this.host.save(this.choice);
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

/** Owns machine-local persistence, the automatic color of remote workspaces, and reversible workspace color previews. */
export class WorkspaceAppearanceService extends Disposable implements IWorkspaceAppearanceService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'workbench.workspaceAppearance';
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChangeAppearance = this.changeEmitter.event;
	private activePreview: WorkspaceAppearancePreview | undefined;
	private workspaceId: string;
	/** The automatic color last shown, to tell when it changes. */
	private automaticColor: string | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.workspaceId = contextService.getWorkspace().id;
		this.automaticColor = this.automaticAppearance?.color;
		this._register(storageService.onDidChangeValue(StorageScope.WORKSPACE, WorkspaceAppearanceService.STORAGE_KEY, this._store)(() => {
			if (!this.activePreview) {
				this.changeEmitter.fire();
			}
		}));
		const onWorkspaceChange = () => {
			if (this.workspaceId !== contextService.getWorkspace().id) {
				this.workspaceId = contextService.getWorkspace().id;
				this.cancelActivePreview();
				this.automaticColor = this.automaticAppearance?.color;
				this.changeEmitter.fire();
			} else {
				// Folders can come and go within the same workspace, which can make it remote or not.
				this.refreshAutomatic();
			}
		};
		this._register(contextService.onDidChangeWorkbenchState(onWorkspaceChange));
		this._register(contextService.onDidChangeWorkspaceFolders(onWorkspaceChange));
		this._register(contextService.onDidChangeWorkspaceName(onWorkspaceChange));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(WORKSPACE_COLOR_AUTO_REMOTE_SETTING)) {
				this.refreshAutomatic();
			}
		}));
	}

	/** Ends the active preview without saving it, and without announcing a change: callers decide whether the shown appearance changed. */
	private cancelActivePreview(): void {
		const preview = this.activePreview;
		this.activePreview = undefined;
		preview?.end(WorkspaceAppearancePreviewEnd.Cancelled);
	}

	override dispose(): void {
		// A preview that outlives its service would keep its end event and listeners alive.
		this.cancelActivePreview();
		super.dispose();
	}

	get appearance(): IWorkspaceAppearance | undefined {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return undefined;
		}
		return this.activePreview ? this.activePreview.appearance : resolveAppearance(this.savedChoice, this.automaticAppearance);
	}

	get isAutomatic(): boolean {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return false;
		}
		return this.activePreview ? this.activePreview.isAutomatic : this.savedChoice.kind === 'default' && !!this.automaticAppearance;
	}

	get hasChoice(): boolean {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return false;
		}
		return (this.activePreview?.choice ?? this.savedChoice).kind !== 'default';
	}

	/** The color a remote workspace is given, whether or not the setting leaves it automatic. */
	private get remoteColor(): string | undefined {
		return getAutomaticWorkspaceColor(this.contextService.getWorkspace().folders.map(folder => folder.uri));
	}

	/** What the workspace shows when the user has not chosen. */
	private get automaticAppearance(): IWorkspaceAppearance | undefined {
		// Only an explicit off turns it off: the setting is registered by a contribution that not every window loads.
		const color = this.configurationService.getValue<boolean | undefined>(WORKSPACE_COLOR_AUTO_REMOTE_SETTING) === false ? undefined : this.remoteColor;
		return color ? { color, style: 'subtle' } : undefined;
	}

	private refreshAutomatic(): void {
		const color = this.automaticAppearance?.color;
		if (color !== this.automaticColor) {
			this.automaticColor = color;
			this.changeEmitter.fire();
		}
	}

	private get savedChoice(): WorkspaceColorChoice {
		try {
			const stored = this.storageService.getObject<Partial<IWorkspaceAppearance> & { readonly none?: boolean }>(WorkspaceAppearanceService.STORAGE_KEY, StorageScope.WORKSPACE);
			if (stored?.none === true) {
				return NO_COLOR_CHOICE;
			}
			const color = typeof stored?.color === 'string' ? normalizeWorkspaceColor(stored.color) : undefined;
			return color && (stored?.style === 'subtle' || stored?.style === 'prominent') ? { kind: 'color', appearance: { color, style: stored.style } } : DEFAULT_CHOICE;
		} catch {
			// Invalid persisted data must not prevent the theme from loading.
			return DEFAULT_CHOICE;
		}
	}

	private save(choice: WorkspaceColorChoice): void {
		if (choice.kind === 'color') {
			this.storageService.store(WorkspaceAppearanceService.STORAGE_KEY, choice.appearance, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else if (choice.kind === 'none' && this.remoteColor) {
			this.storageService.store(WorkspaceAppearanceService.STORAGE_KEY, { none: true }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(WorkspaceAppearanceService.STORAGE_KEY, StorageScope.WORKSPACE);
		}
	}

	beginPreview(): IWorkspaceAppearancePreview {
		const previous = this.activePreview;
		// Start from what is saved: another owner's unsaved preview must not leak into this one.
		const preview = new WorkspaceAppearancePreview(this.savedChoice, {
			automaticAppearance: () => this.automaticAppearance,
			canBeAutomatic: () => !!this.remoteColor,
			didUpdate: () => this.changeEmitter.fire(),
			save: choice => this.save(choice),
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
			const before = previous.appearance;
			const after = preview.appearance;
			if (before?.color !== after?.color || before?.style !== after?.style) {
				this.changeEmitter.fire();
			}
		}
		return preview;
	}
}

registerSingleton(IWorkspaceAppearanceService, WorkspaceAppearanceService, InstantiationType.Delayed);
