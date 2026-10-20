/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, Dimension, getWindow, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { Action } from '../../../../../base/common/actions.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { basename, dirname } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { localize } from '../../../../../nls.js';
import { IMenuService, MenuId } from '../../../../../platform/actions/common/actions.js';
import { MenuService } from '../../../../../platform/actions/common/menuService.js';
import { getActionBarActions } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { listErrorForeground, listWarningForeground } from '../../../../../platform/theme/common/colors/listColors.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { ITreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDndService.js';
import { TreeViewsDnDService } from '../../../../../editor/common/services/treeViewsDnd.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, EditorsOrder, IEditorPartOptions, IToolbarActions, Verbosity } from '../../../../common/editor.js';
import { EditorGroupModel } from '../../../../common/editor/editorGroupModel.js';
import { IEditorTabGroupCreateOptions } from '../../../../common/editor/editorTabGroup.js';
import { EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND, EDITOR_GROUP_HEADER_TABS_BACKGROUND } from '../../../../common/theme.js';
import { DEFAULT_EDITOR_PART_OPTIONS, IEditorGroupMenuIds, IEditorGroupsView, IEditorGroupView, IEditorPartsView } from '../../../../browser/parts/editor/editor.js';
import { BreadcrumbsService, IBreadcrumbsService } from '../../../../browser/parts/editor/breadcrumbs.js';
import { EditorTitleControl } from '../../../../browser/parts/editor/editorTitleControl.js';
import { IDecorationData, IDecorationsProvider, IDecorationsService } from '../../../../services/decorations/common/decorations.js';
import { DecorationsService } from '../../../../services/decorations/browser/decorationsService.js';
import '../../../../services/themes/browser/modernTabColorCustomizations.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../../services/notebook/common/notebookDocumentService.js';
import { IOutlineService } from '../../../../services/outline/browser/outline.js';
import { LayoutSettings, ModernUIEditorTabStyle } from '../../../../services/layout/browser/layoutService.js';
import { TestContextService } from '../../../common/workbenchTestServices.js';
import { workbenchInstantiationService } from '../../workbenchTestServices.js';
import { ComponentFixtureContext, createEditorServices, createTextModel, defineComponentFixture, defineThemedFixtureGroup } from '../fixtureUtils.js';
import '../../../../contrib/modernUI/browser/media/tabs.css';
import '../../../../contrib/modernUI/browser/media/editorBorder.css';
import '../../../../contrib/modernUI/browser/connectedEditorTabs.js';
import '../../../../contrib/welcomeGettingStarted/browser/media/gettingStarted.css';

// ============================================================================
// Fixture editor input
// ============================================================================

interface IFixtureEditorInputOptions {
	readonly typeId?: string;
	readonly name?: string;
	readonly dirty?: boolean;
	readonly capabilities?: EditorInputCapabilities;
	readonly icon?: ThemeIcon | URI;
}

/**
 * A lightweight {@link EditorInput} used purely to populate the tab bar for
 * screenshot fixtures. It never resolves a real editor pane; it only provides
 * the label, description (folder path), icon and dirty state that the tab bar
 * renders.
 */
class FixtureEditorInput extends EditorInput {

	constructor(
		readonly resource: URI,
		private readonly _options: IFixtureEditorInputOptions = {}
	) {
		super();
	}

	override get typeId(): string { return this._options.typeId ?? 'workbench.editors.fixtureEditorInput'; }
	override get editorId(): string | undefined { return this.typeId; }

	override get capabilities(): EditorInputCapabilities {
		return this._options.capabilities ?? EditorInputCapabilities.None;
	}

	override getName(): string {
		return this._options.name ?? basename(this.resource);
	}

	/**
	 * Returns a distinct parent-folder label per {@link Verbosity}, matching how
	 * real resource editor inputs vary their description. `MultiEditorTabsControl`
	 * maps `labelFormat` (short/medium/long) to a verbosity, so distinct values
	 * here are what make the label-format fixtures differ.
	 */
	override getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {
		const parent = dirname(this.resource);
		if (parent.path === '/' || parent.path === '.' || parent.path === '') {
			return undefined;
		}
		switch (verbosity) {
			case Verbosity.SHORT:
				return basename(parent); // containing folder name
			case Verbosity.LONG:
				return parent.path; // full absolute path
			case Verbosity.MEDIUM:
			default:
				return parent.path.replace(/^\//, ''); // path relative to root
		}
	}

	override getIcon(): ThemeIcon | URI | undefined {
		return this._options.icon;
	}

	override isDirty(): boolean {
		return !!this._options.dirty;
	}
}

// ============================================================================
// Editor specs used to populate the group model
// ============================================================================

interface IEditorSpec {
	readonly resource: URI;
	readonly typeId?: string;
	readonly name?: string;
	readonly dirty?: boolean;
	readonly icon?: ThemeIcon | URI;
	readonly capabilities?: EditorInputCapabilities;
	readonly pinned?: boolean;
	readonly sticky?: boolean;
	readonly active?: boolean;
	/** Include this editor in the multi-selection (the active editor is always selected). */
	readonly selected?: boolean;
	/** The name of the {@link IEditorTabsFixtureOptions.tabGroups tab group} this editor belongs to. Sticky editors cannot be members. */
	readonly tabGroup?: string;
}

/** A tab group to create from the editors that name it in {@link IEditorSpec.tabGroup}. */
interface IFixtureTabGroup extends IEditorTabGroupCreateOptions {
	readonly name: string;
	/** A preset color identifier (see `EDITOR_TAB_GROUP_COLORS`) or any CSS color. */
	readonly color: string;
}

function file(path: string): URI {
	return URI.file(path);
}

/** A varied set of editors: different input kinds, file names and folder paths. */
function defaultEditorSpecs(): IEditorSpec[] {
	return [
		{ resource: file('/project/src/app/main.ts'), icon: ThemeIcon.fromId(Codicon.symbolFile.id), sticky: true, pinned: true },
		{ resource: file('/project/src/app/index.ts'), pinned: true },
		{ resource: file('/project/README.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true },
		{ resource: file('/project/package.json'), icon: ThemeIcon.fromId(Codicon.json.id), pinned: true, dirty: true, active: true },
		{ resource: URI.from({ scheme: Schemas.untitled, path: 'Untitled-1' }), typeId: 'workbench.editors.untitledFixture', icon: ThemeIcon.fromId(Codicon.file.id), pinned: false /* preview */ },
		{ resource: file('/project/.vscode/settings.json'), icon: ThemeIcon.fromId(Codicon.settingsGear.id), pinned: true },
		{ resource: file('/project/src/app/components/button.tsx'), pinned: true },
		{ resource: file('/project/tests/app/main.test.ts'), pinned: true },
	];
}

/** A larger set of editors, useful for wrapping / scrollbar / label variants. */
function manyEditorSpecs(activeIndex = 0): IEditorSpec[] {
	const names = [
		'main.ts', 'index.ts', 'button.tsx', 'input.tsx', 'list.tsx', 'tree.tsx',
		'model.ts', 'service.ts', 'view.ts', 'controller.ts', 'utils.ts', 'types.ts',
		'app.css', 'theme.css', 'README.md', 'package.json',
	];
	return names.map((name, index) => ({
		resource: file(`/project/src/module${index % 4}/${name}`),
		pinned: true,
		active: index === activeIndex,
		dirty: index % 5 === 0,
	}));
}

/** Sticky (pinned) editors to show the sticky tab styling. */
function stickyEditorSpecs(): IEditorSpec[] {
	return [
		{ resource: file('/project/src/app/main.ts'), icon: ThemeIcon.fromId(Codicon.symbolFile.id), sticky: true, pinned: true },
		{ resource: file('/project/README.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), sticky: true, pinned: true },
		{ resource: file('/project/package.json'), icon: ThemeIcon.fromId(Codicon.json.id), sticky: true, pinned: true },
		{ resource: file('/project/src/app/index.ts'), pinned: true, active: true },
		{ resource: file('/project/src/app/components/button.tsx'), pinned: true },
	];
}

/** Editors with several tabs in the multi-selection (active + additional selected). */
function multiSelectEditorSpecs(): IEditorSpec[] {
	return [
		{ resource: file('/project/src/app/main.ts'), icon: ThemeIcon.fromId(Codicon.symbolFile.id), pinned: true, selected: true },
		{ resource: file('/project/src/app/index.ts'), pinned: true },
		{ resource: file('/project/README.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true, selected: true },
		{ resource: file('/project/package.json'), icon: ThemeIcon.fromId(Codicon.json.id), pinned: true, dirty: true, active: true, selected: true },
		{ resource: file('/project/src/app/components/button.tsx'), pinned: true },
		{ resource: file('/project/tests/app/main.test.ts'), pinned: true, selected: true },
	];
}

/** The tab groups of {@link tabGroupEditorSpecs}: one expanded around the active editor and saved, one collapsed and locked, both with an icon. */
function twoTabGroups(): IFixtureTabGroup[] {
	return [
		{ name: 'Frontend', color: 'blue', icon: 'code', saved: true },
		{ name: 'Docs', color: 'green', icon: 'book', locked: true, collapsed: true },
	];
}

/** Editors in two tab groups, with ungrouped editors before, between and after them. */
function tabGroupEditorSpecs(): IEditorSpec[] {
	return [
		{ resource: file('/project/package.json'), icon: ThemeIcon.fromId(Codicon.json.id), pinned: true },
		{ resource: file('/project/src/app/main.ts'), pinned: true, tabGroup: 'Frontend' },
		{ resource: file('/project/src/app/index.ts'), pinned: true, tabGroup: 'Frontend', active: true },
		{ resource: file('/project/src/app/components/button.tsx'), pinned: true, tabGroup: 'Frontend', dirty: true },
		{ resource: file('/project/tests/app/main.test.ts'), pinned: true },
		{ resource: file('/project/README.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true, tabGroup: 'Docs' },
		{ resource: file('/project/docs/guide.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true, tabGroup: 'Docs' },
		{ resource: file('/project/docs/changelog.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true, tabGroup: 'Docs' },
	];
}

/** Tab group editors with the active tab at the given position: a member, or an ungrouped tab. */
function tabGroupActiveEditorSpecs(active: 'first' | 'middle' | 'last' | 'outside'): IEditorSpec[] {
	const names = ['AuthButton.tsx', 'AuthProvider.tsx', 'FilterBar.tsx'];
	const activeIndex = { first: 0, middle: 1, last: 2, outside: -1 }[active];
	return [
		{ resource: file('/project/package.json'), icon: ThemeIcon.fromId(Codicon.json.id), pinned: true, active: active === 'outside' },
		...names.map((name, index) => ({ resource: file(`/project/src/components/${name}`), pinned: true, tabGroup: 'Components', active: index === activeIndex })),
		{ resource: file('/project/src/index.ts'), pinned: true },
	];
}

/** The single orange tab group of {@link tabGroupActiveEditorSpecs}. */
function componentsTabGroup(collapsed = false): IFixtureTabGroup[] {
	return [{ name: 'Components', color: 'orange', collapsed }];
}

/** Editors with very long names/paths to exercise tab-label truncation and ellipsis. */
function longLabelEditorSpecs(): IEditorSpec[] {
	return [
		{ resource: file('/project/src/features/authentication/providers/veryLongAuthenticationProviderImplementation.ts'), pinned: true, active: true },
		{ resource: file('/project/src/features/authentication/providers/anotherExtremelyLongProviderFactoryModule.ts'), pinned: true },
		{ resource: file('/project/documentation/architecture/decisions/0001-use-a-really-long-descriptive-file-name.md'), icon: ThemeIcon.fromId(Codicon.markdown.id), pinned: true },
	];
}

// ============================================================================
// File decorations
// ============================================================================

/**
 * Deterministic file decorations (badge letter + color) keyed by resource path.
 * These drive the resource-label badges/colors that the `decorations` setting
 * toggles — dirty state alone only affects the separate modified-tab indicator.
 */
const FIXTURE_DECORATIONS = new Map<string, IDecorationData>([
	['/project/package.json', { weight: 10, letter: 'M', color: listWarningForeground, tooltip: 'Modified', bubble: false }],
	['/project/src/app/main.ts', { weight: 20, letter: '2', color: listErrorForeground, tooltip: '2 problems', bubble: false }],
	['/project/src/app/index.ts', { weight: 20, letter: 'U', color: listWarningForeground, tooltip: 'Untracked', bubble: false }],
]);

function registerFixtureDecorations(decorationsService: IDecorationsService, store: DisposableStore): void {
	const provider: IDecorationsProvider = {
		label: 'Fixture Decorations',
		onDidChange: Event.None,
		provideDecorations(uri: URI, _token: CancellationToken): IDecorationData | undefined {
			return FIXTURE_DECORATIONS.get(uri.path);
		},
	};
	store.add(decorationsService.registerDecorationsProvider(provider));
}

// ============================================================================
// Editor-title toolbar actions
// ============================================================================

function createFixtureEditorTitleActions(store: DisposableStore, menuId: MenuId): IToolbarActions {
	if (menuId !== MenuId.EditorTitle) {
		return { primary: [], secondary: [] };
	}

	return {
		primary: [
			store.add(new Action(
				'fixture.splitEditorRight',
				localize('fixtureSplitEditorRight', "Split Editor Right"),
				ThemeIcon.asClassName(Codicon.splitHorizontal)
			))
		],
		secondary: [
			store.add(new Action(
				'fixture.openEditor',
				localize('fixtureOpenEditor', "Open Editor..."),
				ThemeIcon.asClassName(Codicon.goToFile)
			))
		]
	};
}

// ============================================================================
// Rendering
// ============================================================================

export interface IEditorTabsFixtureOptions {
	readonly modernUI: boolean;
	readonly partOptions?: Partial<IEditorPartOptions>;
	readonly editorTabStyle?: ModernUIEditorTabStyle;
	readonly editors?: IEditorSpec[];
	/** Tab groups made of the editors that name them. Only tabs enabled by `partOptions.tabGroups` show them. */
	readonly tabGroups?: readonly IFixtureTabGroup[];
	/** Renders the tabs as a column beside the editor instead of a strip above it. */
	readonly verticalTabs?: {
		/** The width of the column. A column narrower than the labeled minimum renders compact. */
		readonly width: number;
		readonly height?: number;
		readonly position?: 'left' | 'right';
		/** Reveals the quick filter of the tab column with this query typed into it. */
		readonly filter?: string;
	};
	readonly breadcrumbs?: {
		readonly filePath?: 'on' | 'off' | 'last';
		readonly icons?: boolean;
	};
	readonly width?: number;
	/** Whether this group is the active group. Inactive groups exercise the
	 *  `alwaysShowEditorActions` filtering and unfocused tab styling. */
	readonly active?: boolean;
	readonly showHeader?: boolean;
	readonly useModernUITabs?: boolean;
	readonly reserveHeaderSpace?: boolean;
	readonly headerWidth?: number;
	readonly headerMenuIds?: IEditorGroupMenuIds;
	readonly layoutActionsMenu?: MenuId;
	readonly editorContents?: string;
	readonly activeTabClipping?: 'left' | 'right' | 'left-shoulder' | 'right-shoulder';
}

function createPartOptions(overrides?: Partial<IEditorPartOptions>): IEditorPartOptions {
	return {
		...DEFAULT_EDITOR_PART_OPTIONS,
		hasIcons: true,
		...overrides,
	};
}

function populateModel(model: EditorGroupModel, specs: IEditorSpec[], tabGroups: readonly IFixtureTabGroup[], disposableStore: DisposableStore): void {
	// Open sticky editors first so their indices stay at the front.
	const ordered = [...specs].sort((a, b) => (a.sticky === b.sticky) ? 0 : a.sticky ? -1 : 1);
	const inputBySpec = new Map<IEditorSpec, FixtureEditorInput>();
	for (const [index, spec] of ordered.entries()) {
		const input = disposableStore.add(new FixtureEditorInput(spec.resource, {
			typeId: spec.typeId,
			name: spec.name,
			dirty: spec.dirty,
			icon: spec.icon,
			capabilities: spec.capabilities,
		}));
		inputBySpec.set(spec, input);
		model.openEditor(input, {
			index,
			pinned: spec.pinned ?? true,
			sticky: spec.sticky,
			active: spec.active,
		});
	}

	for (const { name, color, ...options } of tabGroups) {
		const members = ordered.filter(spec => spec.tabGroup === name).map(spec => inputBySpec.get(spec)!);
		if (!model.createTabGroup(members, name, color, options)) {
			throw new Error(`The tab group "${name}" of the fixture has no editors to group`);
		}
	}

	// Apply multi-selection: the active editor plus any additionally selected ones.
	const inactiveSelected = ordered.filter(spec => spec.selected && !spec.active).map(spec => inputBySpec.get(spec)!);
	if (inactiveSelected.length && model.activeEditor) {
		model.setSelection(model.activeEditor, inactiveSelected);
	}
}

export function renderEditorTabsFixture(ctx: ComponentFixtureContext, options: IEditorTabsFixtureOptions): void {
	const { container, disposableStore, theme, fileIconTheme } = ctx;

	const width = options.width ?? 820;
	const isGroupActive = options.active ?? true;
	const verticalTabs = options.verticalTabs;
	const partOptions = createPartOptions(verticalTabs ? { showTabs: 'multiple', tabPosition: verticalTabs.position ?? 'left', verticalTabsWidth: verticalTabs.width, ...options.partOptions } : options.partOptions);

	const configurationService = new TestConfigurationService();
	configurationService.setUserConfiguration('breadcrumbs', {
		enabled: Boolean(options.breadcrumbs),
		filePath: options.breadcrumbs?.filePath ?? 'on',
		symbolPath: 'off',
		icons: options.breadcrumbs?.icons ?? true,
	});
	configurationService.setUserConfiguration(LayoutSettings.MODERN_UI, options.modernUI);
	configurationService.setUserConfiguration(LayoutSettings.MODERN_UI_EDITOR_TAB_STYLE, options.editorTabStyle ?? ModernUIEditorTabStyle.Connected);

	const instantiationService = workbenchInstantiationService({
		configurationService: () => configurationService,
	}, disposableStore);

	// Feed the fixture's themes to the shared theme service so tab-bar theme lookups resolve.
	const themeService = instantiationService.get(IThemeService) as TestThemeService;
	themeService.setTheme(theme);
	themeService.setFileIconTheme(fileIconTheme);

	// Services the base workbench harness does not stub but the tab bar needs.
	instantiationService.stub(ITreeViewsDnDService, new TreeViewsDnDService());
	instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());

	const contextKeyService = disposableStore.add(instantiationService.createInstance(ContextKeyService));
	instantiationService.stub(IContextKeyService, contextKeyService);

	if (options.headerMenuIds) {
		instantiationService.stub(IMenuService, disposableStore.add(instantiationService.createInstance(MenuService)));
	}

	if (options.breadcrumbs) {
		instantiationService.stub(IBreadcrumbsService, new BreadcrumbsService());
		instantiationService.stub(IOutlineService, new class extends mock<IOutlineService>() { }());
		instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(file('/project'))));
	}

	// Real decorations service + provider so resource labels get deterministic badges/colors
	// (the `decorations` setting then has something to toggle).
	const decorationsService = disposableStore.add(instantiationService.createInstance(DecorationsService));
	instantiationService.stub(IDecorationsService, decorationsService);
	registerFixtureDecorations(decorationsService, disposableStore);

	// Real editor group model populated with the fixture editors.
	const model = disposableStore.add(instantiationService.createInstance(EditorGroupModel, undefined));
	populateModel(model, options.editors ?? defaultEditorSpecs(), options.tabGroups ?? [], disposableStore);

	const createEditorActions = (disposables: DisposableStore, menuId: MenuId) => {
		const fixtureMenuId = menuId === MenuId.EditorTitleLayout ? options.layoutActionsMenu : menuId !== MenuId.EditorTitle ? menuId : undefined;
		if (fixtureMenuId) {
			const menu = disposables.add(instantiationService.get(IMenuService).createMenu(fixtureMenuId, contextKeyService));
			return { actions: getActionBarActions(menu.getActions({ shouldForwardArgs: true }), 'navigation'), onDidChange: menu.onDidChange };
		}
		return { actions: createFixtureEditorTitleActions(disposables, menuId), onDidChange: Event.None };
	};

	// Lightweight stand-ins for the production `EditorGroupView` / `EditorPart` views.
	const groupView = new class extends mock<IEditorGroupView>() {
		relayoutFn: () => void = () => { };
		override get id() { return model.id; }
		override get count() { return model.count; }
		override get stickyCount() { return model.stickyCount; }
		override get activeEditor() { return model.activeEditor; }
		override get activeEditorPane() { return undefined; }
		override get selectedEditors() { return model.selectedEditors; }
		override get ariaLabel() { return 'Editor Group 1'; }
		override get groupsView(): IEditorGroupsView { return groupsView; }
		override getEditorByIndex(index: number) { return model.getEditorByIndex(index); }
		override getIndexOfEditor(editor: EditorInput) { return model.indexOf(editor); }
		override getEditors(order: EditorsOrder, opts?: { excludeSticky?: boolean }) { return model.getEditors(order, opts); }
		override isActive(editor: EditorInput) { return model.isActive(editor); }
		override isPinned(editorOrIndex: EditorInput | number) { return model.isPinned(editorOrIndex); }
		override isSticky(editorOrIndex: EditorInput | number) { return model.isSticky(editorOrIndex); }
		override isSelected(editorOrIndex: EditorInput | number) { return model.isSelected(editorOrIndex); }
		override get tabGroups() { return model.tabGroups; }
		override getTabGroupForEditor(editor: EditorInput) { return model.getTabGroupForEditor(editor); }
		override createTabGroup(editors: EditorInput[], name?: string, color?: string, createOptions?: IEditorTabGroupCreateOptions) { return model.createTabGroup(editors, name, color, createOptions); }
		override dissolveTabGroup(groupId: string) { model.dissolveTabGroup(groupId); }
		override removeFromTabGroup(editors: EditorInput[]) { model.removeFromTabGroup(editors); }
		override addToTabGroup(groupId: string, editors: EditorInput[]) { model.addToTabGroup(groupId, editors); }
		override setTabGroupCollapsed(groupId: string, collapsed: boolean) { model.setTabGroupCollapsed(groupId, collapsed); }
		override renameTabGroup(groupId: string, name: string) { model.renameTabGroup(groupId, name); }
		override recolorTabGroup(groupId: string, color: string) { model.recolorTabGroup(groupId, color); }
		override setTabGroupIcon(groupId: string, icon: string | undefined) { model.setTabGroupIcon(groupId, icon); }
		override moveTabGroup(groupId: string, toIndex: number) { model.moveTabGroup(groupId, toIndex); }
		override setTabGroupSaved(groupId: string, saved: boolean) { model.setTabGroupSaved(groupId, saved); }
		override setTabGroupLocked(groupId: string, locked: boolean) { model.setTabGroupLocked(groupId, locked); }
		override get canUndoTabGroupAction() { return model.canUndoTabGroupAction; }
		override undoLastTabGroupAction() { return model.undoLastTabGroupAction(); }
		override createEditorActions(disposables: DisposableStore, menuId = MenuId.EditorTitle) { return createEditorActions(disposables, menuId); }
		override relayout() { this.relayoutFn(); }
		override readonly onDidActiveEditorChange = Event.None;
	};

	// Separate reference returned as the active group when this group is inactive, so that
	// `groupsView.activeGroup === groupView` is false and inactive-group behavior is exercised.
	const otherActiveGroup = new class extends mock<IEditorGroupView>() {
		override focus() { }
	};

	const groupsView = new class extends mock<IEditorGroupsView>() {
		override get partOptions() { return partOptions; }
		override get activeGroup(): IEditorGroupView { return isGroupActive ? groupView : otherActiveGroup; }
		override get groups(): IEditorGroupView[] { return [groupView]; }
		override readonly onDidChangeEditorPartOptions = Event.None;
		override readonly onDidVisibilityChange = Event.None;
	};

	const editorPartsView = new class extends mock<IEditorPartsView>() {
		override get count() { return 1; }
		override getGroup() { return groupView; }
	};

	// Recreate the ancestor chain the tab-bar CSS is scoped to; the fixture container already
	// carries `.monaco-workbench` + theme classes.
	const editorPart = $('.part.editor');
	editorPart.classList.toggle('editor-tabs-multiple', partOptions.showTabs === 'multiple');
	const content = $('.content');
	const groupContainer = $(isGroupActive ? '.editor-group-container.active' : '.editor-group-container');
	const titleContainer = $('.title');
	container.classList.toggle('modern-ui', options.modernUI);
	container.classList.toggle('modern-ui-tabs', options.modernUI);
	container.classList.toggle('modern-ui-connected-editor-tabs', options.modernUI && (options.editorTabStyle ?? ModernUIEditorTabStyle.Connected) === ModernUIEditorTabStyle.Connected);
	titleContainer.classList.toggle('tabs', partOptions.showTabs === 'multiple' && !options.verticalTabs);
	titleContainer.classList.toggle('show-file-icons', partOptions.showIcons);

	const headerBackground = theme.getColor(partOptions.showTabs === 'multiple' ? EDITOR_GROUP_HEADER_TABS_BACKGROUND : EDITOR_GROUP_HEADER_NO_TABS_BACKGROUND);
	if (headerBackground) {
		titleContainer.style.backgroundColor = `var(--modern-ui-editor-title-background, ${headerBackground})`;
	}

	const editorContainer = $('.editor-container');
	const verticalTabsContainer = $('.vertical-tabs-container');
	editorContainer.style.height = '96px';
	editorContainer.style.backgroundColor = 'var(--vscode-editor-background)';

	editorPart.appendChild(content);
	content.appendChild(groupContainer);
	groupContainer.appendChild(titleContainer);
	if (verticalTabs) {
		// The column sits beside the editor, as the editor group view lays them out
		const body = $(`.editor-group-body.vertical-tabs-${verticalTabs.position ?? 'left'}`);
		groupContainer.classList.add('vertical-tabs');
		verticalTabsContainer.classList.toggle('show-file-icons', partOptions.showIcons);
		verticalTabsContainer.style.width = `${verticalTabs.width}px`;
		verticalTabsContainer.style.height = `${verticalTabs.height ?? 320}px`;
		verticalTabsContainer.style.backgroundColor = headerBackground?.toString() ?? '';
		editorContainer.style.height = `${verticalTabs.height ?? 320}px`;
		editorContainer.style.flex = '1 1 auto';
		body.append(verticalTabsContainer, editorContainer);
		groupContainer.appendChild(body);
	} else {
		groupContainer.appendChild(editorContainer);
	}
	const grid = $('.monaco-grid-view');
	if (options.modernUI) {
		container.style.backgroundColor = 'transparent';
		grid.style.backgroundColor = 'transparent';
	}
	grid.appendChild(editorPart);
	container.appendChild(grid);

	container.style.width = `${width}px`;
	groupContainer.style.width = '100%';
	const layoutWidth = groupContainer.clientWidth;

	if (options.editorContents !== undefined && model.activeEditor instanceof FixtureEditorInput) {
		editorContainer.style.height = '240px';
		const editorServices = createEditorServices(disposableStore, { colorTheme: theme });
		const textModel = disposableStore.add(createTextModel(editorServices, options.editorContents, model.activeEditor.resource, 'typescript'));
		const editor = disposableStore.add(editorServices.createInstance(CodeEditorWidget, editorContainer, {
			readOnly: true,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			lineNumbers: 'on',
			folding: false,
			renderLineHighlight: 'none',
			padding: { top: 16 },
		}, { contributions: [] }));
		editor.setModel(textModel);
		editor.layout(new Dimension(layoutWidth, 240));
	}

	const titleControl = disposableStore.add(instantiationService.createInstance(
		EditorTitleControl,
		titleContainer,
		verticalTabsContainer,
		editorPartsView,
		groupsView,
		groupView,
		model,
		options.headerMenuIds,
		options.showHeader ?? false,
		options.reserveHeaderSpace ? () => true : undefined,
		options.useModernUITabs ?? false,
	));

	const layout = () => {
		if (verticalTabs) {
			const height = verticalTabs.height ?? 320;
			titleControl.layout({
				container: new Dimension(layoutWidth, height),
				available: new Dimension(layoutWidth, height),
			}, options.headerWidth, verticalTabs.width);
			return;
		}

		titleControl.layout({
			container: new Dimension(layoutWidth, titleControl.getHeight().total),
			available: new Dimension(layoutWidth, 200),
		}, options.headerWidth);
	};
	groupView.relayoutFn = layout;

	titleControl.openEditors(model.getEditors(EditorsOrder.SEQUENTIAL));
	titleControl.setActive(isGroupActive);
	layout();
	if (verticalTabs?.filter !== undefined) {
		titleControl.revealVerticalTabsFilter();
		const filterInput = verticalTabsContainer.querySelector<HTMLInputElement>('.vertical-tabs-filter input');
		if (!filterInput) {
			throw new Error('The filtered tabs fixture requires the filter of the vertical tabs');
		}
		filterInput.value = verticalTabs.filter;
		filterInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}
	if (options.activeTabClipping) {
		disposableStore.add(scheduleAtNextAnimationFrame(getWindow(container), () => {
			const tabsContainer = titleContainer.querySelector<HTMLElement>('.tabs-container');
			const activeTab = tabsContainer?.querySelector<HTMLElement>('.tab.active');
			if (!tabsContainer || !activeTab) {
				throw new Error('The clipped tab fixture requires an active tab');
			}
			tabsContainer.classList.add('scroll');
			switch (options.activeTabClipping) {
				case 'left':
					tabsContainer.scrollLeft = activeTab.offsetLeft + activeTab.offsetWidth / 2;
					break;
				case 'right':
					tabsContainer.scrollLeft = activeTab.offsetLeft + activeTab.offsetWidth / 2 - tabsContainer.clientWidth;
					break;
				case 'left-shoulder':
					tabsContainer.scrollLeft = activeTab.offsetLeft - 4;
					break;
				case 'right-shoulder':
					tabsContainer.scrollLeft = activeTab.offsetLeft + activeTab.offsetWidth - tabsContainer.clientWidth;
					break;
			}
			tabsContainer.dispatchEvent(new UIEvent('scroll'));
		}));
	}
}

function render(modernUI: boolean, options: Omit<IEditorTabsFixtureOptions, 'modernUI'>): (ctx: ComponentFixtureContext) => void {
	return ctx => renderEditorTabsFixture(ctx, { ...options, modernUI });
}

function renderTabStyleDensityComparison(tabHeight: IEditorPartOptions['tabHeight']): (ctx: ComponentFixtureContext) => void {
	return ctx => {
		for (const [name, modernUI, editorTabStyle] of [
			['Legacy', false, undefined],
			['Pill', true, ModernUIEditorTabStyle.Pill],
			['Connected', true, ModernUIEditorTabStyle.Connected],
		] as const) {
			const label = $('div');
			label.textContent = name;
			label.style.paddingBlock = '8px';
			const container = $('div');
			container.className = ctx.container.className;
			ctx.container.append(label, container);
			renderEditorTabsFixture({ ...ctx, container }, {
				modernUI,
				editorTabStyle,
				partOptions: { tabHeight },
				editors: [
					{ resource: file('/project/alpha.ts'), pinned: true },
					{ resource: file('/project/beta.ts'), pinned: true, active: true },
					{ resource: file('/project/gamma.ts'), pinned: true },
				],
			});
		}
	};
}

function renderDensityLayout(layout: 'singleRow' | 'wrapped' | 'wrappedBottomActive', tabHeight: IEditorPartOptions['tabHeight']): (ctx: ComponentFixtureContext) => Promise<void> | void {
	const wrapped = layout === 'wrapped' || layout === 'wrappedBottomActive';
	const bottomActive = layout === 'wrappedBottomActive';
	const renderFixture = render(true, {
		partOptions: { wrapTabs: wrapped, tabHeight, ...(bottomActive ? { editorActionsLocation: 'hidden' } : {}) },
		editors: bottomActive ? manyEditorSpecs(8).slice(0, 10) : wrapped ? manyEditorSpecs() : undefined,
		width: bottomActive ? 820 : wrapped ? 520 : undefined,
	});
	if (!wrapped) {
		return renderFixture;
	}
	return async ctx => {
		renderFixture(ctx);
		let previousLayout: string | undefined;
		for (let attempt = 0; attempt < 10; attempt++) {
			await new Promise<void>(resolve => ctx.disposableStore.add(scheduleAtNextAnimationFrame(getWindow(ctx.container), () => resolve())));
			const strips = Array.from(ctx.container.querySelectorAll<HTMLElement>('.tabs-and-actions-container'));
			const tabs = Array.from(ctx.container.querySelectorAll<HTMLElement>('.tabs-container > .tab'));
			if (!strips.length || !tabs.length) {
				throw new Error('Wrapped tab fixture did not render its tab strip');
			}
			const layout = JSON.stringify({
				heights: strips.map(strip => strip.offsetHeight),
				tabs: tabs.map(tab => [tab.offsetLeft, tab.offsetTop, tab.offsetWidth, tab.offsetHeight]),
			});
			if (layout === previousLayout) {
				if (strips.filter(strip => strip.classList.contains('wrapping')).some(strip => {
					const rowTabs = Array.from(strip.querySelectorAll<HTMLElement>('.tabs-container > .tab'));
					return rowTabs.some((tab, index) => tab.classList.contains('last-in-row') !== (index === rowTabs.length - 1 || tab.offsetTop !== rowTabs[index + 1].offsetTop));
				})) {
					throw new Error('Wrapped tab row markers do not match the rendered rows');
				}
				if (bottomActive && tabs.some(tab => tab.classList.contains('active') && (tab.offsetTop !== Math.max(...tabs.map(tab => tab.offsetTop)) || tab.classList.contains('connected-tab-upper-row')))) {
					throw new Error('The active tab must be connected to the bottom wrapped row');
				}
				return;
			}
			previousLayout = layout;
		}
		throw new Error('Wrapped tab fixture did not reach a stable layout');
	};
}

function createDensityFixtures() {
	return {
		Compact: defineThemedFixtureGroup({
			AcrossTabStyles: defineComponentFixture({
				render: renderTabStyleDensityComparison('compact'),
				expectedVisualDescriptions: ['Legacy, pill, and connected tabs use the same compact tab-height setting, preserving each style and accessible action target.'],
			}),
			SingleRow: defineComponentFixture({
				render: renderDensityLayout('singleRow', 'compact'),
				expectedVisualDescriptions: ['Compact-density tabs preserve the same structure with shorter hitboxes and centered actions.'],
			}),
			SingleTab: defineComponentFixture({
				render: render(true, {
					editors: [{ resource: file('/project/README.md'), pinned: true, active: true }],
					partOptions: { editorActionsLocation: 'hidden', tabHeight: 'compact' },
				}),
				expectedVisualDescriptions: ['A compact single editor retains balanced label spacing without crowding either connected shoulder.'],
			}),
			WrappedBottomActive: defineComponentFixture({
				render: renderDensityLayout('wrappedBottomActive', 'compact'),
				expectedVisualDescriptions: ['Compact bottom-row tabs preserve the same continuous shoulder stroke as default density; upper rows remain separate pills.'],
			}),
			WrappedUpperActive: defineComponentFixture({
				render: renderDensityLayout('wrapped', 'compact'),
				expectedVisualDescriptions: ['Compact-density tabs wrap into equal-height rows while labels and actions remain vertically centered.'],
			}),
		}),
		Default: defineThemedFixtureGroup({
			AcrossTabStyles: defineComponentFixture({
				render: renderTabStyleDensityComparison('default'),
				expectedVisualDescriptions: ['Legacy, pill, and connected tabs use the same default tab-height setting. Painted heights may differ by style; labels and actions remain centered.'],
			}),
			SingleRow: defineComponentFixture({
				render: renderDensityLayout('singleRow', 'default'),
				expectedVisualDescriptions: ['Default-density tabs preserve their standard hitbox height and centered actions.'],
			}),
			SingleTab: defineComponentFixture({
				render: render(true, {
					editors: [{ resource: file('/project/README.md'), pinned: true, active: true }],
					partOptions: { editorActionsLocation: 'hidden' },
				}),
				expectedVisualDescriptions: ['A single editor retains balanced label and Close action spacing without crowding either connected shoulder.'],
			}),
			WrappedBottomActive: defineComponentFixture({
				render: renderDensityLayout('wrappedBottomActive', 'default'),
				expectedVisualDescriptions: ['The active bottom-row tab joins the body separator with a continuous curved stroke on both sides, without changing the height of any row.'],
			}),
			WrappedUpperActive: defineComponentFixture({
				render: renderDensityLayout('wrapped', 'default'),
				expectedVisualDescriptions: ['Default-density tabs wrap into equal-height rows. Upper connected rows remain separate pills and the bottom selected tab joins the editor.'],
			}),
		}),
	};
}

function createLayoutFixtures() {
	return {
		ActionsHidden: defineComponentFixture({
			render: render(true, { partOptions: { tabActionCloseVisibility: false } }),
			expectedVisualDescriptions: ['Hiding Close actions removes their reserved controls without changing tab height or modified indicators.'],
		}),
		ActionsOnLeft: defineComponentFixture({
			render: render(true, { partOptions: { tabActionLocation: 'left' } }),
			expectedVisualDescriptions: ['Leading tab actions mirror the default trailing-action spacing without changing label alignment.'],
		}),
		ActionsUnreserved: defineComponentFixture({
			render: render(true, {
				editors: [
					{ resource: file('/project/main.ts'), pinned: true },
					{ resource: file('/project/README.md'), pinned: true, active: true },
					{ resource: file('/project/package.json'), pinned: true },
				],
				partOptions: { tabActionReserveSpace: false },
			}),
			expectedVisualDescriptions: ['Without reserved action space, the active clean tab keeps its Close action visible while inactive clean tabs hide theirs until hover or focus.'],
		}),
		FileIconsMinimal: defineComponentFixture({
			fileIconTheme: 'vs-minimal',
			render: render(true, {}),
		}),
		FileIconsModernWelcome: defineComponentFixture({
			fileIconTheme: 'vscode-modern-icons',
			render: render(true, {
				editors: [{
					resource: URI.from({ scheme: Schemas.walkThrough, authority: 'vscode_getting_started_page' }),
					name: 'Welcome',
					pinned: true,
					active: true,
				}],
				width: 320,
			}),
			expectedVisualDescriptions: ['The Welcome tab displays one full-color product icon without a generic file mask or overlapping artwork.'],
		}),
		FileIconsNone: defineComponentFixture({
			fileIconTheme: 'none',
			render: render(true, {}),
			expectedVisualDescriptions: ['Tabs without a file icon theme use the same balanced iconless leading spacing as the Show Icons disabled setting.'],
		}),
		LongNamesFit: defineComponentFixture({
			render: render(true, { partOptions: { tabSizing: 'fit' }, editors: longLabelEditorSpecs(), width: 520 }),
			expectedVisualDescriptions: ['Fit-sized long labels use their natural widths and scroll rather than overlap actions.'],
		}),
		LongNamesFixed: defineComponentFixture({
			render: render(true, { partOptions: { tabSizing: 'fixed', tabSizingFixedMinWidth: 120, tabSizingFixedMaxWidth: 120 }, editors: longLabelEditorSpecs(), width: 520 }),
			expectedVisualDescriptions: ['Fixed-size long labels use equal tab widths, real ellipses, and stable action columns.'],
		}),
		LongNamesShrink: defineComponentFixture({
			render: render(true, { partOptions: { tabSizing: 'shrink' }, editors: longLabelEditorSpecs(), width: 520 }),
			expectedVisualDescriptions: ['Shrink-sized long labels ellipsize while preserving extensions and action targets.'],
		}),
		ModifiedAndMultiSelected: defineComponentFixture({
			render: render(true, { editors: multiSelectEditorSpecs() }),
			expectedVisualDescriptions: ['Modified and multi-selected tabs retain their indicators, selected boundaries, and active document connection.'],
		}),
		PinnedIconOnly: defineComponentFixture({
			render: render(true, { partOptions: { pinnedTabSizing: 'compact' }, editors: stickyEditorSpecs() }),
			expectedVisualDescriptions: ['Compact pinned tabs remain distinct from the normal active tab and preserve their icon-only hit targets.'],
		}),
		PinnedSeparateRow: defineComponentFixture({
			render: renderPinnedSeparateRow(),
			expectedVisualDescriptions: ['Pinned tabs appear in a separate row above ordinary tabs with balanced labels and actions.'],
		}),
		TabGroups: defineThemedFixtureGroup({
			Top: defineComponentFixture({
				render: render(true, { editors: tabGroupEditorSpecs(), tabGroups: twoTabGroups(), width: 1000 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['Two tab groups share the strip: Frontend is expanded around the active tab and shows its three tabs, with a thin colored rail under the inactive members that stops at the connected active tab, while the collapsed Docs group shows only its header with a count of three and a sideways chevron. The headers show the chevron, a code or book icon, a bookmark for the saved Frontend group, an unsaved dot for Frontend and a lock for the locked Docs group, all the same size and vertically centered. Ungrouped tabs sit before, between, and after the groups.'],
			}),
			Vertical: defineComponentFixture({
				render: render(true, { editors: tabGroupEditorSpecs(), tabGroups: twoTabGroups(), verticalTabs: { width: 240 } }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The vertical tab list shows the expanded Frontend group header with a downward chevron and its three indented rows (the active one highlighted, one with an unsaved dot), and the collapsed Docs group as a header with a sideways chevron and no rows. The headers show the chevron, a code or book icon, a bookmark for the saved Frontend group, an unsaved dot for Frontend and a lock for the locked Docs group, all the same size and vertically centered. Ungrouped rows sit before, between, and after the groups.'],
			}),
			VerticalFiltered: defineComponentFixture({
				render: render(true, { editors: tabGroupEditorSpecs(), tabGroups: twoTabGroups(), verticalTabs: { width: 240, filter: 'md' } }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The quick filter above the vertical tab list holds "md". Only the Docs group header and its three markdown tabs are listed, with the matching letters of each name highlighted and the folder shown after each name, although the Docs group is collapsed. The Frontend group and the other tabs are left out.'],
			}),
			VerticalCompact: defineComponentFixture({
				render: render(true, { editors: tabGroupEditorSpecs(), tabGroups: twoTabGroups(), verticalTabs: { width: 48 } }),
				expectedVisualDescriptions: ['The icon-only rail shows a file icon per visible tab, the unsaved dot, and each group reduced to a color dot: a filled dot for Frontend and a ring for the collapsed Docs group.'],
			}),
			VerticalCompactWithoutFileIcons: defineComponentFixture({
				fileIconTheme: 'none',
				render: render(true, { editors: tabGroupEditorSpecs(), tabGroups: twoTabGroups(), verticalTabs: { width: 48 }, partOptions: { hasIcons: false } }),
				expectedVisualDescriptions: ['Without a file icon theme the icon-only rail falls back to a codicon per tab instead of blank rows: the editor icon where it has one, a plain file otherwise.'],
			}),
		}),
		ConnectedTabGroups: defineThemedFixtureGroup({
			ActiveFirst: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('first'), tabGroups: componentsTabGroup(false), width: 900 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['Connected tabs: the first Components tab is active and outlined by the orange group stroke, whose sides flow through curved shoulders into the same stroke under the header and the other two members, with no separators.'],
			}),
			ActiveMiddle: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('middle'), tabGroups: componentsTabGroup(false), width: 900 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The middle Components tab is active and outlined by the orange group stroke; its sides flow through curved shoulders into the stroke under the header and both neighbours, with no gap or seam.'],
			}),
			ActiveLast: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('last'), tabGroups: componentsTabGroup(false), width: 900 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The last Components tab is active and outlined by the orange group stroke; its left side flows through a curved shoulder into the stroke under the header and earlier members.'],
			}),
			ActiveOutside: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('outside'), tabGroups: componentsTabGroup(false), width: 900 }),
				expectedVisualDescriptions: ['An ungrouped tab is active; all three Components members show the thin rail, with the header pill aligned to the tabs.'],
			}),
			Collapsed: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('outside'), tabGroups: componentsTabGroup(true), width: 900 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The collapsed Components header pill is aligned with the tabs and carries the orange group rail along its bottom.'],
			}),
			CollapsedActive: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('middle'), tabGroups: componentsTabGroup(true), width: 900 }),
				additionalThemes: ['darkHighContrast', 'lightHighContrast'],
				expectedVisualDescriptions: ['The active Components member is the only visible member of the collapsed group: it is outlined by the orange group stroke, whose left shoulder flows into the header stroke.'],
			}),
			Wrapped: defineComponentFixture({
				render: render(true, { editors: tabGroupActiveEditorSpecs('middle'), tabGroups: componentsTabGroup(false), width: 360, partOptions: { wrapTabs: true, editorActionsLocation: 'hidden' } }),
				expectedVisualDescriptions: ['Wrapped Connected tabs keep the group rail on each row and the active tab connected to the editor.'],
			}),
		}),
		ShowBreadCrumbs: defineComponentFixture({
			render: render(true, {
				partOptions: { titleScrollbarVisibility: 'visible' },
				breadcrumbs: {},
				editors: manyEditorSpecs(5),
				width: 360,
			}),
			expectedVisualDescriptions: ['The horizontal tab scrollbar, connected strip separator, and breadcrumb border remain distinct and aligned while the active tab is revealed within an overflowing strip.'],
		}),
	};
}

function renderPinnedSeparateRow(): (ctx: ComponentFixtureContext) => void {
	const editors = defaultEditorSpecs().slice(0, 3).map((spec, index) => ({
		...spec,
		sticky: index === 0,
		pinned: true,
		dirty: false,
		active: index === 1,
	}));
	return render(true, {
		editors,
		partOptions: {
			editorActionsLocation: 'hidden',
			pinnedTabsOnSeparateRow: true,
			pinnedTabSizing: 'normal',
			tabActionUnpinVisibility: true,
		},
	});
}

export default defineThemedFixtureGroup({ path: 'editor/' }, {
	Density: defineThemedFixtureGroup(createDensityFixtures()),
	Layout: defineThemedFixtureGroup(createLayoutFixtures()),
	Styles: defineThemedFixtureGroup({
		Connected: defineComponentFixture({
			render: render(true, {}),
			additionalThemes: ['darkHighContrast', 'lightHighContrast'],
			expectedVisualDescriptions: [
				'Connected tabs use the dedicated connected strip color while the active tab remains joined to the editor surface.',
			],
		}),
		Legacy: defineComponentFixture({
			render: render(false, {}),
			additionalThemes: ['darkHighContrast', 'lightHighContrast'],
			expectedVisualDescriptions: [
				'With Modern UI disabled, the legacy tab strip and inactive tabs retain the theme legacy background instead of adopting the connected-tab strip color.',
			],
		}),
		Pill: defineComponentFixture({
			render: render(true, { editorTabStyle: ModernUIEditorTabStyle.Pill }),
			additionalThemes: ['darkHighContrast', 'lightHighContrast'],
			expectedVisualDescriptions: [
				'Pill tabs retain their transparent modern surface and separate rounded geometry instead of adopting the connected-tab strip color.',
			],
		}),
		PillMultiSelected: defineComponentFixture({
			render: render(true, { editorTabStyle: ModernUIEditorTabStyle.Pill, editors: multiSelectEditorSpecs() }),
			additionalThemes: ['darkHighContrast', 'lightHighContrast'],
			expectedVisualDescriptions: ['Multi-selected Pill tabs keep a single outer stroke around their fill, including the action area.'],
		}),
		PillMultiSelectedActionsOnLeft: defineComponentFixture({
			render: render(true, { editorTabStyle: ModernUIEditorTabStyle.Pill, editors: multiSelectEditorSpecs(), partOptions: { tabActionLocation: 'left' } }),
			additionalThemes: ['darkHighContrast', 'lightHighContrast'],
			expectedVisualDescriptions: ['Multi-selected Pill tabs with leading actions keep the same outer stroke ownership as trailing actions.'],
		}),
	}),
});
