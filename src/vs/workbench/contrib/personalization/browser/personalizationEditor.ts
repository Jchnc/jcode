/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/personalization.css';
import { $, addDisposableListener, append, Dimension, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { WORKSPACE_COLOR_PALETTE, getWorkspaceColorPreset, getWorkspaceColorRamp } from '../../../common/workspaceColorPalette.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IWorkspaceAppearance, IWorkspaceAppearanceService } from '../../../services/themes/common/workspaceAppearance.js';
import { getPersonalizationValue, PersonalizationValue } from '../common/personalizationSettings.js';

interface SettingChoice {
	readonly value: PersonalizationValue;
	readonly label: string;
}

interface SettingControl {
	readonly key: string;
	readonly row: HTMLElement;
	readonly hint: HTMLElement;
	readonly reset: HTMLButtonElement;
	readonly refresh: (value: PersonalizationValue | undefined, disabled: boolean) => void;
	readonly isRelevant?: () => boolean;
}

export class PersonalizationEditor extends EditorPane {
	static readonly ID = 'jcode.editor.personalization';
	private root!: HTMLElement;
	private content!: HTMLElement;
	private status!: HTMLElement;
	private workspaceTarget!: HTMLButtonElement;
	private scopeDescription!: HTMLElement;
	private target = ConfigurationTarget.USER;
	private readonly controls: SettingControl[] = [];
	private readonly updates: (() => void)[] = [];
	private readonly pageDisposables = this._register(new DisposableStore());
	private readonly pendingSettings = new Set<string>();
	private readonly sections: { element: HTMLElement; nav: HTMLButtonElement }[] = [];
	private readonly targetButtons: HTMLButtonElement[] = [];
	private nextControlId = 0;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IWorkspaceAppearanceService private readonly appearanceService: IWorkspaceAppearanceService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(PersonalizationEditor.ID, group, telemetryService, workbenchThemeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.jcode-personalization', { role: 'region', 'aria-label': localize('personalization.region', "JCode Personalization") }));
		const shell = append(this.root, $('.personalization-shell'));
		const sidebar = append(shell, $('aside.personalization-sidebar'));
		const brand = append(sidebar, $('.personalization-brand', { 'aria-hidden': 'true' }));
		append(brand, $('span.personalization-brand-icon')).classList.add(...ThemeIcon.asClassNameArray(Codicon.paintcan));
		const nav = append(sidebar, $('nav.personalization-nav', { 'aria-label': localize('personalization.sections', "Personalization sections") }));
		const scopeLabel = append(sidebar, $('.personalization-scope-label', { id: `personalization-scope-${this.group.id}` }, localize('personalization.scopeLabel', "Settings scope")));
		const scope = append(sidebar, $('.personalization-scope', { role: 'group', 'aria-labelledby': scopeLabel.id }));
		for (const [target, name] of [[ConfigurationTarget.USER, localize('personalization.user', "User")], [ConfigurationTarget.WORKSPACE, localize('personalization.workspace', "Workspace")]] as const) {
			const button = this.button(scope, name, () => { this.target = target; this.refresh(); });
			this.targetButtons.push(button);
			if (target === ConfigurationTarget.WORKSPACE) { this.workspaceTarget = button; }
		}
		this.scopeDescription = append(sidebar, $('.personalization-scope-description'));
		this.content = append(shell, $('main.personalization-content'));
		const pageHeader = append(this.content, $('header.personalization-page-header'));
		append(pageHeader, $('h1', undefined, localize('personalization.heading', "Personalization")));
		append(pageHeader, $('p', undefined, localize('personalization.intro', "Make JCode feel right for the way you work.")));
		this.status = append(pageHeader, $('.personalization-status', { role: 'status', 'aria-live': 'polite' }));
		const appearance = this.section(nav, 'appearance', Codicon.paintcan, localize('personalization.appearance', "Appearance"), localize('personalization.appearanceDescription', "Choose the theme and file icons used across JCode."));
		const themes = append(appearance, $('.personalization-theme-grid'));
		this.themeButton(themes, localize('personalization.colorTheme', "Color theme"), 'workbench.action.selectTheme', () => this.workbenchThemeService.getColorTheme().label);
		this.themeButton(themes, localize('personalization.fileIcons', "File icons"), 'workbench.action.selectIconTheme', () => this.workbenchThemeService.getFileIconTheme().label);
		const workspace = this.section(nav, 'workspace', Codicon.symbolColor, localize('personalization.workspaceColor', "Workspace color"), localize('personalization.workspaceDescription', "Give this workspace a recognizable color. Saved locally, without changing its settings files."));
		this.createWorkspaceColors(workspace);
		const tabs = this.section(nav, 'tabs', Codicon.files, localize('personalization.tabs', "Editor tabs"), localize('personalization.tabsDescription', "Choose where open files appear and how you move through them."));
		this.setting(tabs, 'workbench.editor.tabPosition', localize('personalization.tabPosition', "Tab position"), localize('personalization.tabPositionDescription', "Vertical tabs use file names only and leave more room above the editor."), [
			{ value: 'top', label: localize('personalization.top', "Top") }, { value: 'left', label: localize('personalization.left', "Left") }, { value: 'right', label: localize('personalization.right', "Right") }
		], 'placement');
		this.setting(tabs, 'workbench.editor.verticalTabsWidth', localize('personalization.tabsWidth', "Vertical tab width"), localize('personalization.tabsWidthDescription', "Adjust the width of the file list."), undefined, 'range', [140, 500, 10], () => this.configurationService.getValue('workbench.editor.tabPosition') !== 'top');
		this.setting(tabs, 'workbench.editor.tabGroups.enabled', localize('personalization.tabGroups', "Tab groups"), localize('personalization.tabGroupsDescription', "Organize related files into named, colored groups."), undefined, undefined, undefined, () => this.configurationService.getValue('workbench.editor.showTabs') === 'multiple');
		this.setting(tabs, 'breadcrumbs.enabled', localize('personalization.breadcrumbs', "Breadcrumbs"), localize('personalization.breadcrumbsDescription', "Navigate the current file's folders and symbols above the editor."));
		const layout = this.section(nav, 'layout', Codicon.layout, localize('personalization.layout', "Workbench layout"), localize('personalization.layoutDescription', "Place the main navigation and choose how much information fits on screen."));
		this.setting(layout, 'workbench.sideBar.location', localize('personalization.sidebar', "Primary sidebar"), localize('personalization.sidebarDescription', "Choose the side for Explorer, Search, and other primary views."), [{ value: 'left', label: localize('personalization.left', "Left") }, { value: 'right', label: localize('personalization.right', "Right") }]);
		this.setting(layout, 'workbench.activityBar.location', localize('personalization.activityBar', "Activity bar"), localize('personalization.activityBarDescription', "Place the view icons beside the sidebar, above it, or below it."), [
			{ value: 'default', label: localize('personalization.side', "Side") }, { value: 'top', label: localize('personalization.top', "Top") }, { value: 'bottom', label: localize('personalization.bottom', "Bottom") }, { value: 'hidden', label: localize('personalization.hidden', "Hidden") }
		]);
		this.setting(layout, 'window.density.layout', localize('personalization.density', "Interface density"), localize('personalization.densityDescription', "Use comfortable spacing or fit more into the JCode layout."), [{ value: 'default', label: localize('personalization.comfortable', "Comfortable") }, { value: 'compact', label: localize('personalization.compact', "Compact") }], undefined, undefined, () => this.configurationService.getValue('workbench.experimental.modernUI') === true);
		const footer = append(this.content, $('footer.personalization-footer'));
		append(footer, $('span', undefined, localize('personalization.more', "Looking for something else?")));
		this.button(footer, localize('personalization.allSettings', "Open All Settings"), () => this.runCommand('workbench.action.openSettings'));
		this.pageDisposables.add(this.configurationService.onDidChangeConfiguration(() => this.refresh()));
		this.pageDisposables.add(this.appearanceService.onDidChangeAppearance(() => this.refresh()));
		this.pageDisposables.add(this.workspaceService.onDidChangeWorkbenchState(() => this.refresh()));
		this.pageDisposables.add(this.workbenchThemeService.onDidColorThemeChange(() => this.refresh()));
		this.pageDisposables.add(this.workbenchThemeService.onDidFileIconThemeChange(() => this.refresh()));
		this.pageDisposables.add(addDisposableListener(this.content, EventType.SCROLL, () => this.updateActiveSection()));
		this.refresh();
	}

	private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button' }, label)) as HTMLButtonElement;
		this.pageDisposables.add(addDisposableListener(button, EventType.CLICK, action));
		return button;
	}

	private section(nav: HTMLElement, id: string, icon: ThemeIcon, title: string, description: string): HTMLElement {
		const element = append(this.content, $('section.personalization-section', { 'aria-label': title }));
		element.dataset.section = id;
		const header = append(element, $('.personalization-section-header'));
		append(header, $('h2', undefined, title));
		append(header, $('p.personalization-section-description', undefined, description));
		const body = append(element, $('.personalization-section-body'));
		const button = this.button(nav, title, () => {
			element.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.updateActiveSection(element);
		});
		button.className = 'personalization-nav-item';
		button.textContent = '';
		const navIcon = append(button, $('span.personalization-nav-icon', { 'aria-hidden': 'true' }));
		navIcon.classList.add(...ThemeIcon.asClassNameArray(icon));
		append(button, $('span', undefined, title));
		this.sections.push({ element, nav: button });
		return body;
	}

	private updateActiveSection(selected?: HTMLElement): void {
		const contentTop = this.content.getBoundingClientRect().top + 40;
		let active = this.sections[0];
		if (this.content.scrollTop + this.content.clientHeight >= this.content.scrollHeight - 2) {
			active = this.sections.at(-1) ?? active;
		} else {
			for (const section of this.sections) {
				if (section.element.getBoundingClientRect().top <= contentTop) {
					active = section;
				}
			}
		}
		if (selected) {
			active = this.sections.find(section => section.element === selected) ?? active;
		}
		for (const section of this.sections) {
			if (section === active) { section.nav.setAttribute('aria-current', 'page'); }
			else { section.nav.removeAttribute('aria-current'); }
		}
	}

	private themeButton(parent: HTMLElement, label: string, command: string, getName: () => string): void {
		const card = this.button(parent, '', () => this.runCommand(command));
		card.className = 'personalization-theme-row';
		append(card, $('span.personalization-control-label', undefined, label));
		const name = append(card, $('span.personalization-theme-name'));
		append(card, $('span.personalization-theme-action', undefined, localize('personalization.choose', "Choose…")));
		this.updates.push(() => { name.textContent = getName(); });
	}

	private createWorkspaceColors(parent: HTMLElement): void {
		const palette = append(parent, $('.personalization-palette', { role: 'group', 'aria-label': localize('personalization.palette', "Workspace colors") }));
		const buttons: { button: HTMLButtonElement; swatch: HTMLElement; value: string | undefined }[] = [];
		for (const preset of [undefined, ...WORKSPACE_COLOR_PALETTE]) {
			const button = this.button(palette, '', () => {
				const preview = this.appearanceService.beginPreview();
				try { preview.update(preset ? { color: preset.value, style: this.appearanceService.appearance?.style ?? 'subtle' } : undefined); preview.apply(); }
				finally { preview.dispose(); }
				this.status.textContent = localize('personalization.colorSaved', "Workspace color updated.");
			});
			const swatch = append(button, $('span.personalization-swatch'));
			if (preset) { swatch.style.backgroundColor = preset.value; }
			else { swatch.classList.add('no-color'); }
			append(button, $('span', undefined, preset?.label ?? localize('personalization.none', "None")));
			buttons.push({ button, swatch, value: preset?.value });
		}
		const actions = append(parent, $('.personalization-color-actions'));
		const hint = append(actions, $('span.personalization-muted'));
		this.updates.push(() => {
			const available = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
			const appearance = this.appearanceService.appearance;
			const preset = getWorkspaceColorPreset(appearance?.color);
			const dark = isDark(this.workbenchThemeService.getColorTheme().type);
			for (const item of buttons) {
				item.button.disabled = !available;
				item.button.setAttribute('aria-pressed', String(item.value === (preset?.value ?? appearance?.color)));
				if (item.value) {
					item.swatch.style.backgroundColor = getWorkspaceColorRamp(item.value, dark).marker;
				}
			}
			hint.textContent = available ? localize('personalization.localColor', "Only this workspace, on this device.") : localize('personalization.openWorkspace', "Open a folder or workspace to choose a color.");
		});
		this.createWorkspaceColorIntensity(parent);
	}

	private createWorkspaceColorIntensity(parent: HTMLElement): void {
		const row = append(parent, $('.personalization-color-intensity'));
		const text = append(row, $('.personalization-setting-text'));
		const labelId = `personalization-intensity-${this.group.id}`;
		append(text, $('span.personalization-control-label', { id: labelId }, localize('personalization.colorIntensity', "Color intensity")));
		append(text, $('p', undefined, localize('personalization.colorIntensityDescription', "Control how strongly the workspace color tints JCode.")));
		const hint = append(text, $('span.personalization-setting-hint'));
		const options = append(row, $('.personalization-intensity-options', { role: 'group', 'aria-labelledby': labelId }));
		const buttons: { button: HTMLButtonElement; value: IWorkspaceAppearance['style'] }[] = [];
		for (const [value, label, description] of [
			['subtle', localize('personalization.subtle', "Subtle"), localize('personalization.subtleDescription', "Soft tint")],
			['prominent', localize('personalization.rich', "Rich"), localize('personalization.richDescription', "Stronger tint")]
		] as const) {
			const button = this.button(options, '', () => this.updateWorkspaceColorIntensity(value));
			append(button, $('span.personalization-intensity-label', undefined, label));
			append(button, $('span.personalization-intensity-description', undefined, description));
			buttons.push({ button, value });
		}
		this.updates.push(() => {
			const available = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
			const appearance = this.appearanceService.appearance;
			for (const { button, value } of buttons) {
				button.disabled = !available || !appearance;
				button.setAttribute('aria-pressed', String(appearance?.style === value));
			}
			hint.textContent = available && !appearance ? localize('personalization.chooseColorFirst', "Choose a workspace color to set its intensity.") : '';
		});
	}

	private updateWorkspaceColorIntensity(style: IWorkspaceAppearance['style']): void {
		const appearance = this.appearanceService.appearance;
		if (!appearance || appearance.style === style) { return; }
		const preview = this.appearanceService.beginPreview();
		try {
			preview.update({ ...appearance, style });
			preview.apply();
		} finally {
			preview.dispose();
		}
		this.status.textContent = localize('personalization.intensitySaved', "Workspace color intensity updated.");
	}

	private setting(parent: HTMLElement, key: string, title: string, description: string, choices?: readonly SettingChoice[], kind?: 'placement' | 'range', range?: readonly [number, number, number], isRelevant?: () => boolean): SettingControl {
		const row = append(parent, $('.personalization-setting'));
		row.dataset.setting = key;
		const text = append(row, $('.personalization-setting-text'));
		const id = `personalization-control-${this.group.id}-${this.nextControlId++}`;
		append(text, $('span.personalization-control-label', { id: `${id}-label` }, title));
		append(text, $('p', { id: `${id}-description` }, description));
		const hint = append(text, $('span.personalization-setting-hint'));
		const field = append(row, $('.personalization-field'));
		let refresh: SettingControl['refresh'];
		if (choices) {
			field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', `${id}-label`);
			field.classList.add(kind === 'placement' ? 'personalization-placement' : 'personalization-choices');
			const buttons = choices.map(choice => {
				const button = this.button(field, choice.label, () => { void this.updateSetting(key, choice.value); });
				if (kind === 'placement') {
					const diagram = $('span.tab-placement-diagram', { 'aria-hidden': 'true' });
					diagram.classList.add(`placement-${choice.value}`); button.prepend(diagram);
				}
				return { choice, button };
			});
			refresh = (value, disabled) => { for (const { choice, button } of buttons) { button.disabled = disabled; button.setAttribute('aria-pressed', String(choice.value === value)); } };
		} else if (kind === 'range' && range) {
			const input = append(field, $('input', { type: 'range', min: range[0], max: range[1], step: range[2], 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-description` })) as HTMLInputElement;
			const output = append(field, $('output'));
			this.pageDisposables.add(addDisposableListener(input, EventType.INPUT, () => { output.textContent = localize('personalization.pixels', "{0} px", input.value); }));
			this.pageDisposables.add(addDisposableListener(input, EventType.CHANGE, () => { void this.updateSetting(key, Number(input.value)); }));
			refresh = (value, disabled) => { input.value = String(value); input.disabled = disabled; output.textContent = localize('personalization.pixels', "{0} px", value); };
		} else {
			const toggle = this.button(field, '', () => { void this.updateSetting(key, !(getPersonalizationValue(this.configurationService.inspect<PersonalizationValue>(key), this.target) === true)); });
			toggle.className = 'personalization-toggle'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-labelledby', `${id}-label`); toggle.setAttribute('aria-describedby', `${id}-description`);
			refresh = (value, disabled) => { toggle.disabled = disabled; toggle.setAttribute('aria-checked', String(value === true)); toggle.textContent = value === true ? localize('personalization.on', "On") : localize('personalization.off', "Off"); };
		}
		const reset = this.button(row, localize('personalization.reset', "Reset"), () => { void this.updateSetting(key, undefined); });
		reset.className = 'personalization-reset'; reset.setAttribute('aria-label', localize('personalization.resetSetting', "Reset {0}", title));
		const control = { key, row, hint, reset, refresh, isRelevant };
		this.controls.push(control);
		return control;
	}

	private refresh(): void {
		if (!this.root) { return; }
		const hasWorkspace = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
		if (!hasWorkspace) { this.target = ConfigurationTarget.USER; }
		this.workspaceTarget.disabled = !hasWorkspace;
		this.targetButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === (this.target === ConfigurationTarget.USER ? 0 : 1))));
		this.scopeDescription.textContent = this.target === ConfigurationTarget.USER ? localize('personalization.userScopeDescription', "Use these choices in every workspace.") : localize('personalization.workspaceScopeDescription', "Override your choices in this workspace.");
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		for (const control of this.controls) {
			const config = this.configurationService.inspect<PersonalizationValue>(control.key);
			const scope = registry[control.key]?.scope;
			const userOnly = this.target === ConfigurationTarget.WORKSPACE && (scope === ConfigurationScope.APPLICATION || scope === ConfigurationScope.MACHINE || scope === ConfigurationScope.APPLICATION_MACHINE);
			const policy = config?.policyValue !== undefined;
			const disabled = userOnly || policy || this.pendingSettings.has(control.key) || !registry[control.key];
			control.refresh(getPersonalizationValue(config, this.target), disabled);
			const ownValue = this.target === ConfigurationTarget.WORKSPACE ? config?.workspaceValue : config?.userValue;
			control.reset.disabled = disabled || ownValue === undefined;
			control.hint.textContent = policy ? localize('personalization.managed', "Managed by your organization.") : userOnly ? localize('personalization.userOnly', "Available in User settings.") : this.target === ConfigurationTarget.USER && config?.workspaceValue !== undefined ? localize('personalization.overridden', "This workspace has its own value.") : '';
			control.row.hidden = control.isRelevant?.() === false;
		}
		for (const update of this.updates) { update(); }
		this.updateActiveSection();
	}

	private async updateSetting(key: string, value: PersonalizationValue | undefined): Promise<void> {
		if (this.pendingSettings.has(key)) { return; }
		const target = this.target;
		this.pendingSettings.add(key); this.refresh();
		try {
			await this.configurationService.updateValue(key, value, target);
			this.status.textContent = localize('personalization.saved', "Saved to {0} settings.", target === ConfigurationTarget.USER ? localize('personalization.user', "User") : localize('personalization.workspace', "Workspace"));
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error : String(error));
			this.status.textContent = localize('personalization.failed', "Could not save this change. Check the notification for details.");
		} finally { this.pendingSettings.delete(key); this.refresh(); }
	}

	private runCommand(id: string): void {
		void this.commandService.executeCommand(id).catch(error => this.notificationService.error(error instanceof Error ? error : String(error)));
	}

	layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`; this.root.style.height = `${dimension.height}px`;
		this.root.classList.toggle('narrow', dimension.width < 760);
	}

	override focus(): void { super.focus(); this.sections[0]?.nav.focus(); }
}
