/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/personalization.css';
import { $, addDisposableListener, append, Dimension, EventHelper, EventType, getActiveElement, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { getRadioNavigationTarget, IWorkspaceColorSwatch, renderWorkspaceColorSwatch } from '../../../browser/workspaceColorSwatch.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { WORKSPACE_COLOR_PALETTE, getWorkspaceColorPreset } from '../../../common/workspaceColorPalette.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { LayoutSettings, ModernUIEditorTabStyle } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IWorkspaceAppearance, IWorkspaceAppearancePreview, IWorkspaceAppearanceService, parseWorkspaceColorInput, WORKSPACE_COLOR_AUTO_REMOTE_SETTING, WORKSPACE_COLOR_INPUT_MAX_LENGTH, WorkspaceAppearancePreviewEnd } from '../../../services/themes/common/workspaceAppearance.js';
import { TAB_AUTO_GROUP_RULES_SETTING, toTabAutoGroupResource } from '../../tabGroups/common/tabAutoGroupRules.js';
import { getPersonalizationValue, PersonalizationValue } from '../common/personalizationSettings.js';
import { AutoGroupRulesList } from './autoGroupRulesList.js';

interface SettingChoice {
	readonly value: PersonalizationValue;
	readonly label: string;
}

/** Where keyboard focus was before the page refreshed, so a refresh never strands it. */
interface FocusSnapshot {
	readonly element: HTMLElement;
	readonly key: string | undefined;
}

interface PersonalizationSection {
	readonly element: HTMLElement;
	readonly nav: HTMLButtonElement;
	readonly body: HTMLElement;
	readonly title: string;
	readonly reset: HTMLButtonElement;
	/** The settings this section manages, which Reset to Defaults clears at the selected scope. */
	readonly keys: string[];
	/** State kept outside the settings files that Reset to Defaults clears as well. */
	extraReset?: { readonly isModified: () => boolean; readonly reset: () => void };
}

/** What a section's Reset to Defaults cleared, which Undo puts back. */
interface ClearedSection {
	readonly workspaceId: string;
	/** The scope the settings were cleared at. */
	readonly target: ConfigurationTarget;
	/** The value each reset setting held at that scope. */
	readonly settings: ReadonlyMap<string, PersonalizationValue | undefined>;
	/** Whether the workspace color was reset too, and what it was: no color is the choice of none. */
	readonly color: { readonly appearance: IWorkspaceAppearance | undefined } | undefined;
}

interface SettingControl {
	readonly key: string;
	readonly row: HTMLElement;
	readonly hint: HTMLElement;
	readonly reset: HTMLButtonElement;
	/** Every control in the row, including its reset button. */
	readonly elements: readonly HTMLElement[];
	/** The control that takes focus when the focused one can no longer. */
	readonly primary: () => HTMLElement;
	readonly refresh: (value: PersonalizationValue | undefined, disabled: boolean) => void;
	readonly isRelevant?: () => boolean;
	/** Whether something the control depends on is off, which disables it. */
	readonly isUnavailable?: () => boolean;
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
	/** The notification that offers to undo the latest Reset to Defaults. */
	private readonly undoOffer = this._register(new MutableDisposable<DisposableStore>());
	private readonly pendingSettings = new Set<string>();
	/** The newest value chosen on each range control that has not finished saving, which the control keeps showing meanwhile. */
	private readonly unsavedRangeValues = new Map<string, { readonly value: number; readonly target: ConfigurationTarget }>();
	private readonly sections: PersonalizationSection[] = [];
	private readonly targetButtons: HTMLButtonElement[] = [];
	private readonly focusTargets = new Map<string, HTMLElement>();
	private discardColorDraft = () => { };
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
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHoverService private readonly hoverService: IHoverService
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
		const scopeArea = append(sidebar, $('.personalization-scope-area'));
		const scopeLabel = append(scopeArea, $('.personalization-scope-label', { id: `personalization-scope-${this.group.id}` }, localize('personalization.scopeLabel', "Settings scope")));
		const scope = append(scopeArea, $('.personalization-scope', { role: 'group', 'aria-labelledby': scopeLabel.id }));
		for (const [target, name] of [[ConfigurationTarget.USER, localize('personalization.user', "User")], [ConfigurationTarget.WORKSPACE, localize('personalization.workspace', "Workspace")]] as const) {
			const button = this.button(scope, name, () => { this.target = target; this.refresh(); });
			this.targetButtons.push(button);
			if (target === ConfigurationTarget.WORKSPACE) { this.workspaceTarget = button; }
		}
		this.scopeDescription = append(scopeArea, $('.personalization-scope-description'));
		this.content = append(shell, $('main.personalization-content'));
		const pageHeader = append(this.content, $('header.personalization-page-header'));
		append(pageHeader, $('h1', undefined, localize('personalization.heading', "Personalization")));
		append(pageHeader, $('p', undefined, localize('personalization.intro', "Make JCode feel right for the way you work.")));
		this.status = append(pageHeader, $('.personalization-status', { role: 'status', 'aria-live': 'polite' }));
		const appearance = this.section(nav, 'appearance', Codicon.paintcan, localize('personalization.appearance', "Appearance"), localize('personalization.appearanceDescription', "Choose the theme and file icons used across JCode."));
		appearance.keys.push('workbench.colorTheme', 'workbench.iconTheme');
		const themes = append(appearance.body, $('.personalization-theme-grid'));
		this.themeButton(themes, localize('personalization.colorTheme', "Color theme"), 'workbench.action.selectTheme', () => this.workbenchThemeService.getColorTheme().label);
		this.themeButton(themes, localize('personalization.fileIcons', "File icons"), 'workbench.action.selectIconTheme', () => this.workbenchThemeService.getFileIconTheme().label);
		const workspace = this.section(nav, 'workspace', Codicon.symbolColor, localize('personalization.workspaceColor', "Workspace color"), localize('personalization.workspaceDescription', "Give this workspace a recognizable color. Saved locally, without changing its settings files."));
		this.createWorkspaceColors(workspace);
		this.setting(workspace, WORKSPACE_COLOR_AUTO_REMOTE_SETTING, localize('personalization.autoRemoteColor', "Color remote workspaces"), localize('personalization.autoRemoteColorDescription', "Give each workspace on an SFTP connection a color of its own, so that remote windows are easy to recognize. A color you choose always takes priority."));
		const tabs = this.section(nav, 'tabs', Codicon.files, localize('personalization.tabs', "Editor tabs"), localize('personalization.tabsDescription', "Choose where open files appear and how you move through them."));
		this.setting(tabs, 'workbench.editor.tabPosition', localize('personalization.tabPosition', "Tab position"), localize('personalization.tabPositionDescription', "Vertical tabs use file names only and leave more room above the editor."), [
			{ value: 'top', label: localize('personalization.top', "Top") }, { value: 'left', label: localize('personalization.left', "Left") }, { value: 'right', label: localize('personalization.right', "Right") }
		], 'placement');
		this.setting(tabs, 'workbench.editor.verticalTabsWidth', localize('personalization.tabsWidth', "Vertical tab width"), localize('personalization.tabsWidthDescription', "Adjust the width of the file list."), undefined, 'range', [140, 500, 10], () => this.configurationService.getValue('workbench.editor.tabPosition') !== 'top');
		this.tabStylePicker(tabs);
		this.setting(tabs, 'workbench.editor.tabGroups.enabled', localize('personalization.tabGroups', "Tab groups"), localize('personalization.tabGroupsDescription', "Organize related files into named, colored groups."), undefined, undefined, undefined, () => this.configurationService.getValue('workbench.editor.showTabs') === 'multiple');
		this.setting(tabs, 'breadcrumbs.enabled', localize('personalization.breadcrumbs', "Breadcrumbs"), localize('personalization.breadcrumbsDescription', "Navigate the current file's folders and symbols above the editor."));
		const grouping = this.section(nav, 'grouping', Codicon.layers, localize('personalization.grouping', "Auto-grouping"), localize('personalization.groupingDescription', "Put files into tab groups for you as you open them."));
		this.autoGroupRules(grouping);
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

	private button(parent: HTMLElement, label: string, action: () => void, focusKey?: string): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button' }, label)) as HTMLButtonElement;
		if (focusKey) { this.registerFocusTarget(focusKey, button); }
		this.pageDisposables.add(addDisposableListener(button, EventType.CLICK, action));
		return button;
	}

	private section(nav: HTMLElement, id: string, icon: ThemeIcon, title: string, description: string): PersonalizationSection {
		const element = append(this.content, $('section.personalization-section', { 'aria-label': title }));
		element.dataset.section = id;
		const header = append(element, $('.personalization-section-header'));
		const heading = append(header, $('.personalization-section-heading'));
		const headingId = `personalization-section-${this.group.id}-${id}`;
		append(heading, $('h2', { id: headingId }, title));
		append(heading, $('p.personalization-section-description', undefined, description));
		const reset = this.button(header, localize('personalization.resetSectionLabel', "Reset to Defaults"), () => { void this.resetSection(section); }, `section:${id}:reset`);
		reset.className = 'personalization-section-reset';
		reset.setAttribute('aria-describedby', headingId);
		const body = append(element, $('.personalization-section-body'));
		const button = this.button(nav, title, () => {
			element.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.updateActiveSection(element);
		});
		button.className = 'personalization-nav-item';
		button.textContent = '';
		const navIcon = append(button, $('span.personalization-nav-icon', { 'aria-hidden': 'true' }));
		navIcon.classList.add(...ThemeIcon.asClassNameArray(icon));
		append(button, $('span', undefined, title));
		const section: PersonalizationSection = { element, nav: button, body, title, reset, keys: [] };
		this.sections.push(section);
		return section;
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

	private createWorkspaceColors(section: PersonalizationSection): void {
		const parent = section.body;
		section.extraReset = {
			// Choosing no color is a choice too, where a color would be automatic otherwise.
			isModified: () => this.appearanceService.hasChoice,
			reset: () => {
				const preview = this.appearanceService.beginPreview();
				try { preview.useDefault(); preview.apply(); }
				finally { preview.dispose(); }
			}
		};
		// Radios: one tab stop that follows the checked color, arrow keys move focus, and Enter or Space (a click) applies the focused one.
		// The hint below says whether the checked color was chosen automatically, so the group is described by it.
		const hintId = `personalization-color-hint-${this.group.id}`;
		const palette = append(parent, $('.personalization-palette', { role: 'radiogroup', 'aria-label': localize('personalization.palette', "Workspace colors"), 'aria-describedby': hintId }));
		const buttons: { button: HTMLButtonElement; swatch: IWorkspaceColorSwatch; value: string | undefined }[] = [];
		for (const preset of [undefined, ...WORKSPACE_COLOR_PALETTE]) {
			const button = this.button(palette, '', () => {
				const preview = this.appearanceService.beginPreview();
				try { preview.update(preset ? { color: preset.value, style: this.appearanceService.appearance?.style ?? 'subtle' } : undefined); preview.apply(); }
				finally { preview.dispose(); }
				this.status.textContent = localize('personalization.colorSaved', "Workspace color updated.");
			}, `color:${preset?.id ?? 'none'}`);
			button.setAttribute('role', 'radio');
			// The swatch sits on the page, so high contrast themes draw its marker against the editor background.
			buttons.push({ button, swatch: renderWorkspaceColorSwatch(button, preset?.label ?? localize('personalization.none', "None"), editorBackground), value: preset?.value });
		}
		const setFocusable = (focusable: number) => buttons.forEach(({ button }, index) => { button.tabIndex = index === focusable ? 0 : -1; });
		this.pageDisposables.add(addDisposableListener(palette, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			const index = buttons.findIndex(({ button }) => button === event.target);
			// Laid out in as many columns as the page currently fits.
			const columns = getWindow(palette).getComputedStyle(palette).gridTemplateColumns.split(' ').filter(track => track !== '' && track !== 'none').length;
			const next = index < 0 ? undefined : getRadioNavigationTarget(event.key, index, buttons.length, columns);
			if (next !== undefined) {
				EventHelper.stop(event);
				setFocusable(next);
				buttons[next].button.focus();
			}
		}));
		this.createWorkspaceColorInput(parent);
		const actions = append(parent, $('.personalization-color-actions'));
		const hint = append(actions, $('span.personalization-muted', { id: hintId }));
		this.updates.push(() => {
			const available = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
			const appearance = this.appearanceService.appearance;
			const preset = getWorkspaceColorPreset(appearance?.color);
			const theme = this.workbenchThemeService.getColorTheme();
			const checked = buttons.findIndex(item => item.value === (preset?.value ?? appearance?.color));
			// A custom color checks no radio: the tab stop then rests on the first one.
			setFocusable(Math.max(checked, 0));
			for (const [index, item] of buttons.entries()) {
				item.button.disabled = !available;
				item.button.setAttribute('aria-checked', String(index === checked));
				item.swatch.update(item.value, appearance?.style ?? 'subtle', theme);
			}
			hint.textContent = !available ? localize('personalization.openWorkspace', "Open a folder or workspace to choose a color.")
				: this.appearanceService.isAutomatic ? localize('personalization.automaticColor', "Chosen automatically for this remote workspace. Choose a color to replace it, or None to turn it off.")
					: localize('personalization.localColor', "Only this workspace, on this device.");
		});
		this.createWorkspaceColorIntensity(parent);
	}

	/** A hex color previewed live on the workbench while typing, and saved only when applied. */
	private createWorkspaceColorInput(parent: HTMLElement): void {
		const row = append(parent, $('.personalization-color-custom'));
		const text = append(row, $('.personalization-setting-text'));
		const id = `personalization-custom-color-${this.group.id}`;
		append(text, $('span.personalization-control-label', { id: `${id}-label` }, localize('personalization.customColor', "Custom color")));
		append(text, $('p', { id: `${id}-description` }, localize('personalization.customColorDescription', "Type a hex color to preview it live, then apply it.")));
		const error = append(text, $('span.personalization-setting-hint.personalization-color-error', { id: `${id}-error`, role: 'status' }));
		const field = append(row, $('.personalization-field'));
		const input = this.pageDisposables.add(new InputBox(field, undefined, {
			inputBoxStyles: defaultInputBoxStyles,
			placeholder: '#RRGGBB'
		}));
		input.inputElement.maxLength = WORKSPACE_COLOR_INPUT_MAX_LENGTH;
		input.inputElement.spellcheck = false;
		input.inputElement.setAttribute('aria-labelledby', `${id}-label`);
		input.inputElement.setAttribute('aria-describedby', `${id}-description ${id}-error`);
		this.registerFocusTarget('color:hex', input.inputElement);
		const apply = this.button(field, localize('personalization.applyColor', "Apply"), () => commit(), 'color:apply');
		apply.className = 'personalization-primary';

		// The draft is what was typed and not yet applied. Only one preview is shown at a time, and this one is kept until applied, discarded or superseded.
		const previews = this.pageDisposables.add(new MutableDisposable<DisposableStore>());
		let preview: IWorkspaceAppearancePreview | undefined;
		let dirty = false;
		let showError = false;
		let settingValue = false;
		const setValue = (value: string) => {
			settingValue = true;
			try { input.value = value; } finally { settingValue = false; }
		};
		const render = () => {
			const value = input.value.trim();
			const invalid = dirty && showError && value !== '' && !parseWorkspaceColorInput(value);
			error.textContent = invalid ? localize('personalization.invalidColor', "Enter a hex color, such as #3b82f6.") : '';
			if (invalid) { input.inputElement.setAttribute('aria-invalid', 'true'); }
			else { input.inputElement.removeAttribute('aria-invalid'); }
			// Applying stays focusable while there is nothing to apply, so activating it never drops focus.
			if (dirty && value !== '') { apply.removeAttribute('aria-disabled'); }
			else { apply.setAttribute('aria-disabled', 'true'); }
		};
		const endPreview = () => {
			previews.clear();
			preview = undefined;
		};
		const discard = () => {
			endPreview();
			dirty = false;
			showError = false;
			setValue(this.appearanceService.appearance?.color ?? '');
			render();
		};
		const acquirePreview = (): IWorkspaceAppearancePreview => {
			if (!preview?.isActive) {
				const store = new DisposableStore();
				const next = store.add(this.appearanceService.beginPreview());
				store.add(next.onDidEnd(reason => {
					if (reason === WorkspaceAppearancePreviewEnd.Superseded) {
						discard();
					}
				}));
				previews.value = store;
				preview = next;
			}
			return preview;
		};
		const commit = () => {
			const value = input.value.trim();
			if (!dirty || value === '') { return; }
			const color = parseWorkspaceColorInput(value);
			if (!color) {
				showError = true;
				render();
				input.focus();
				return;
			}
			const current = acquirePreview();
			current.update({ color, style: this.appearanceService.appearance?.style ?? 'subtle' });
			current.apply();
			endPreview();
			dirty = false;
			showError = false;
			setValue(color);
			render();
			this.status.textContent = localize('personalization.colorSaved', "Workspace color updated.");
		};
		this.discardColorDraft = () => {
			if (dirty) { discard(); }
		};
		this.pageDisposables.add(input.onDidChange(() => {
			if (settingValue) { return; }
			dirty = true;
			showError = false;
			const color = parseWorkspaceColorInput(input.value);
			if (color) { acquirePreview().update({ color, style: this.appearanceService.appearance?.style ?? 'subtle' }); }
			// A color still being typed keeps the last valid preview, like the title bar picker, so the workbench does not flash back to the saved color.
			else if (input.value.trim() === '') { endPreview(); }
			render();
		}));
		this.pageDisposables.add(addDisposableListener(input.inputElement, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				EventHelper.stop(event);
				commit();
			} else if (event.key === 'Escape' && dirty) {
				EventHelper.stop(event);
				discard();
			}
		}));
		// Leaving the field without applying ends the preview, unless the window itself just lost focus.
		this.pageDisposables.add(addDisposableListener(row, EventType.FOCUS_OUT, (event: FocusEvent) => {
			const next = event.relatedTarget;
			const windowBlurred = !next && !row.ownerDocument.hasFocus();
			if (dirty && !windowBlurred && !(isHTMLElement(next) && row.contains(next))) {
				discard();
			}
		}));
		this.updates.push(() => {
			const available = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
			input.setEnabled(available);
			apply.disabled = !available;
			if (!dirty) { setValue(this.appearanceService.appearance?.color ?? ''); }
			render();
		});
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

	private setting(section: PersonalizationSection, key: string, title: string, description: string, choices?: readonly SettingChoice[], kind?: 'placement' | 'range', range?: readonly [number, number, number], isRelevant?: () => boolean): SettingControl {
		section.keys.push(key);
		const row = append(section.body, $('.personalization-setting'));
		row.dataset.setting = key;
		const text = append(row, $('.personalization-setting-text'));
		const id = `personalization-control-${this.group.id}-${this.nextControlId++}`;
		append(text, $('span.personalization-control-label', { id: `${id}-label` }, title));
		append(text, $('p', { id: `${id}-description` }, description));
		const hint = append(text, $('span.personalization-setting-hint'));
		const field = append(row, $('.personalization-field'));
		let refresh: SettingControl['refresh'];
		let elements: HTMLElement[];
		let primary: SettingControl['primary'];
		if (choices) {
			field.setAttribute('role', 'group'); field.setAttribute('aria-labelledby', `${id}-label`);
			field.classList.add(kind === 'placement' ? 'personalization-placement' : 'personalization-choices');
			const buttons = choices.map(choice => {
				const button = this.button(field, choice.label, () => { void this.updateSetting(key, choice.value); }, `${key}:${choice.value}`);
				if (kind === 'placement') {
					const diagram = $('span.tab-placement-diagram', { 'aria-hidden': 'true' });
					diagram.classList.add(`placement-${choice.value}`); button.prepend(diagram);
				}
				return { choice, button };
			});
			elements = buttons.map(({ button }) => button);
			primary = () => buttons.find(({ button }) => button.getAttribute('aria-pressed') === 'true')?.button ?? buttons[0].button;
			refresh = (value, disabled) => { for (const { choice, button } of buttons) { button.disabled = disabled; button.setAttribute('aria-pressed', String(choice.value === value)); } };
		} else if (kind === 'range' && range) {
			const input = append(field, $('input', { type: 'range', min: range[0], max: range[1], step: range[2], 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-description` })) as HTMLInputElement;
			this.registerFocusTarget(key, input);
			const output = append(field, $('output'));
			this.pageDisposables.add(addDisposableListener(input, EventType.INPUT, () => { output.textContent = localize('personalization.pixels', "{0} px", input.value); }));
			this.pageDisposables.add(addDisposableListener(input, EventType.CHANGE, () => { void this.updateRangeSetting(key, Number(input.value)); }));
			elements = [input];
			primary = () => input;
			refresh = (value, disabled) => { input.value = String(value); input.disabled = disabled; output.textContent = localize('personalization.pixels', "{0} px", Number(value)); };
		} else {
			const toggle = this.button(field, '', () => { void this.updateSetting(key, !(getPersonalizationValue(this.configurationService.inspect<PersonalizationValue>(key), this.target) === true)); }, key);
			toggle.className = 'personalization-toggle'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-labelledby', `${id}-label`); toggle.setAttribute('aria-describedby', `${id}-description`);
			elements = [toggle];
			primary = () => toggle;
			refresh = (value, disabled) => { toggle.disabled = disabled; toggle.setAttribute('aria-checked', String(value === true)); toggle.textContent = value === true ? localize('personalization.on', "On") : localize('personalization.off', "Off"); };
		}
		const reset = this.button(row, localize('personalization.reset', "Reset"), () => { void this.updateSetting(key, undefined); }, `${key}:reset`);
		reset.className = 'personalization-reset'; reset.setAttribute('aria-label', localize('personalization.resetSetting', "Reset {0}", title));
		const control = { key, row, hint, reset, elements: [...elements, reset], primary, refresh, isRelevant };
		this.controls.push(control);
		return control;
	}

	/**
	 * Two cards that show what each modern tab style looks like. They are radios with one tab stop that follows the
	 * checked card, arrow keys that move focus, and a click that applies the style at the selected scope.
	 */
	private tabStylePicker(section: PersonalizationSection): void {
		const key = LayoutSettings.MODERN_UI_EDITOR_TAB_STYLE;
		section.keys.push(key);
		const row = append(section.body, $('.personalization-setting.personalization-setting-stacked'));
		row.dataset.setting = key;
		const text = append(row, $('.personalization-setting-text'));
		const id = `personalization-control-${this.group.id}-${this.nextControlId++}`;
		append(text, $('span.personalization-control-label', { id: `${id}-label` }, localize('personalization.tabStyle', "Editor tab style")));
		append(text, $('p', { id: `${id}-description` }, localize('personalization.tabStyleDescription', "Choose how the tabs of open files look.")));
		const hint = append(text, $('span.personalization-setting-hint'));
		const field = append(row, $('.personalization-field.personalization-style-cards', { role: 'radiogroup', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-description ${id}-note` }));
		const cards: { button: HTMLButtonElement; value: ModernUIEditorTabStyle }[] = [];
		for (const [value, label, description] of [
			[ModernUIEditorTabStyle.Connected, localize('personalization.tabStyleConnected', "Connected"), localize('personalization.tabStyleConnectedDescription', "The active tab joins the editor.")],
			[ModernUIEditorTabStyle.Pill, localize('personalization.tabStylePill', "Pill"), localize('personalization.tabStylePillDescription', "Each tab is a rounded pill.")]
		] as const) {
			const button = this.button(field, '', () => { void this.updateSetting(key, value); }, `${key}:${value}`);
			button.className = 'personalization-style-card';
			button.setAttribute('role', 'radio');
			const preview = append(button, $(`span.personalization-style-preview.style-${value}`, { 'aria-hidden': 'true' }));
			const strip = append(preview, $('span.personalization-style-strip'));
			for (let index = 0; index < 3; index++) {
				append(strip, $(index === 0 ? 'span.personalization-style-tab.active' : 'span.personalization-style-tab'));
			}
			append(preview, $('span.personalization-style-surface'));
			append(button, $('span.personalization-style-name', undefined, label));
			append(button, $('span.personalization-style-description', undefined, description));
			cards.push({ button, value });
		}
		const setFocusable = (focusable: number) => cards.forEach(({ button }, index) => { button.tabIndex = index === focusable ? 0 : -1; });
		this.pageDisposables.add(addDisposableListener(field, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			const index = cards.findIndex(({ button }) => button === event.target);
			const next = index < 0 ? undefined : getRadioNavigationTarget(event.key, index, cards.length, cards.length);
			if (next !== undefined) {
				EventHelper.stop(event);
				setFocusable(next);
				cards[next].button.focus();
			}
		}));
		const note = append(row, $('.personalization-style-note', { id: `${id}-note` }));
		append(note, $('span.personalization-setting-hint', undefined, localize('personalization.tabStyleOff', "Tab styles apply when Modern UI is on.")));
		const turnOn = this.button(note, localize('personalization.turnOnModernUI', "Turn On Modern UI"), () => { void this.updateSetting(LayoutSettings.MODERN_UI, true); }, LayoutSettings.MODERN_UI);
		turnOn.className = 'personalization-primary';
		const reset = this.button(row, localize('personalization.reset', "Reset"), () => { void this.updateSetting(key, undefined); }, `${key}:reset`);
		reset.className = 'personalization-reset'; reset.setAttribute('aria-label', localize('personalization.resetSetting', "Reset {0}", localize('personalization.tabStyle', "Editor tab style")));
		const modernUIOn = () => this.configurationService.getValue(LayoutSettings.MODERN_UI) === true;
		this.controls.push({
			key, row, hint, reset,
			elements: [...cards.map(({ button }) => button), turnOn, reset],
			primary: () => cards.find(({ button }) => button.getAttribute('aria-checked') === 'true')?.button ?? cards[0].button,
			isUnavailable: () => !modernUIOn(),
			refresh: (value, disabled) => {
				const checked = Math.max(cards.findIndex(({ value: card }) => card === (value ?? ModernUIEditorTabStyle.Connected)), 0);
				setFocusable(checked);
				cards.forEach(({ button }, index) => { button.disabled = disabled; button.setAttribute('aria-checked', String(index === checked)); });
				note.hidden = modernUIOn();
			}
		});
	}

	/** The files of the open editors, which is what auto-grouping rules are tried on. */
	private getOpenResources() {
		return this.editorService.editors.flatMap(editor => {
			const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
			return resource ? [toTabAutoGroupResource(resource, this.workspaceService.getWorkspaceFolder(resource)?.uri)] : [];
		});
	}

	/** The rules that put the files of a pattern into a tab group, as a list that is edited in place and saved once it is complete. */
	private autoGroupRules(section: PersonalizationSection): void {
		const key = TAB_AUTO_GROUP_RULES_SETTING;
		section.keys.push(key);
		const row = append(section.body, $('.personalization-setting.personalization-setting-stacked'));
		row.dataset.setting = key;
		const text = append(row, $('.personalization-setting-text'));
		const id = `personalization-control-${this.group.id}-${this.nextControlId++}`;
		append(text, $('span.personalization-control-label', { id: `${id}-label` }, localize('personalization.rules', "Rules")));
		append(text, $('p', { id: `${id}-description` }, localize('personalization.rulesDescription', "Files in a folder or matching a pattern join the tab group named by the rule, including tabs that are already open.")));
		const hint = append(text, $('span.personalization-setting-hint'));
		const field = append(row, $('.personalization-field.personalization-rules', { role: 'group', 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-description ${id}-note` }));
		const list = this.pageDisposables.add(new AutoGroupRulesList(field, id, {
			save: rules => { void this.updateSetting(key, rules.length ? rules : undefined); },
			getResources: () => this.getOpenResources(),
			announce: message => { this.status.textContent = message; }
		}, this.hoverService));
		this.pageDisposables.add(this.editorService.onDidEditorsChange(() => list.refreshMatches()));
		// The note comes before the list, so that it is seen without scrolling past every rule
		const note = row.insertBefore($('.personalization-style-note.personalization-note-leading', { id: `${id}-note` }), field);
		append(note, $('span.personalization-setting-hint', undefined, localize('personalization.rulesOff', "Rules apply when tab groups are on.")));
		const turnOn = this.button(note, localize('personalization.turnOnTabGroups', "Turn On Tab Groups"), () => { void this.updateSetting('workbench.editor.tabGroups.enabled', true); }, 'workbench.editor.tabGroups.enabled:on');
		turnOn.className = 'personalization-primary';
		const reset = this.button(row, localize('personalization.reset', "Reset"), () => { void this.updateSetting(key, undefined); }, `${key}:reset`);
		reset.className = 'personalization-reset'; reset.setAttribute('aria-label', localize('personalization.resetSetting', "Reset {0}", localize('personalization.rules', "Rules")));
		const tabGroupsOn = () => this.configurationService.getValue('workbench.editor.tabGroups.enabled') !== false;
		this.controls.push({
			key, row, hint, reset,
			elements: [turnOn, reset],
			primary: () => list.primary,
			isUnavailable: () => !tabGroupsOn(),
			refresh: (value, disabled) => {
				list.setRules(value, disabled);
				note.hidden = tabGroupsOn();
				turnOn.disabled = false;
			}
		});
	}

	private refresh(): void {
		if (!this.root) { return; }
		const focus = this.captureFocus();
		const hasWorkspace = this.workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
		if (!hasWorkspace) { this.target = ConfigurationTarget.USER; }
		this.workspaceTarget.disabled = !hasWorkspace;
		this.targetButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === (this.target === ConfigurationTarget.USER ? 0 : 1))));
		this.scopeDescription.textContent = this.target === ConfigurationTarget.USER ? localize('personalization.userScopeDescription', "Use these choices in every workspace.") : localize('personalization.workspaceScopeDescription', "Override your choices in this workspace.");
		for (const control of this.controls) {
			const { config, policy, userOnly, disabled: unavailable, ownValue } = this.inspectSetting(control.key);
			const disabled = unavailable || control.isUnavailable?.() === true;
			const unsaved = this.unsavedRangeValues.get(control.key);
			control.refresh(unsaved?.target === this.target ? unsaved.value : getPersonalizationValue(config, this.target), disabled);
			this.setBusy(control, this.pendingSettings.has(control.key));
			control.reset.disabled = disabled || ownValue === undefined;
			control.hint.textContent = policy ? localize('personalization.managed', "Managed by your organization.") : userOnly ? localize('personalization.userOnly', "Available in User settings.") : this.target === ConfigurationTarget.USER && config?.workspaceValue !== undefined ? localize('personalization.overridden', "This workspace has its own value.") : '';
			control.row.hidden = control.isRelevant?.() === false;
		}
		for (const update of this.updates) { update(); }
		for (const section of this.sections) {
			// Stays focusable when there is nothing to reset, so activating it never drops focus.
			if (section.keys.some(key => this.canReset(key)) || section.extraReset?.isModified()) { section.reset.removeAttribute('aria-disabled'); }
			else { section.reset.setAttribute('aria-disabled', 'true'); }
		}
		this.updateActiveSection();
		this.restoreFocus(focus);
	}

	/** What a scope, by default the selected one, allows for a setting, and what it holds there. */
	private inspectSetting(key: string, target = this.target): { readonly config: IConfigurationValue<PersonalizationValue> | undefined; readonly policy: boolean; readonly userOnly: boolean; readonly disabled: boolean; readonly ownValue: PersonalizationValue | undefined } {
		const property = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[key];
		const config = this.configurationService.inspect<PersonalizationValue>(key);
		const scope = property?.scope;
		const userOnly = target === ConfigurationTarget.WORKSPACE && (scope === ConfigurationScope.APPLICATION || scope === ConfigurationScope.MACHINE || scope === ConfigurationScope.APPLICATION_MACHINE);
		const policy = config?.policyValue !== undefined;
		return { config, policy, userOnly, disabled: userOnly || policy || !property, ownValue: target === ConfigurationTarget.WORKSPACE ? config?.workspaceValue : config?.userValue };
	}

	private canReset(key: string): boolean {
		const { disabled, ownValue } = this.inspectSetting(key);
		return !disabled && ownValue !== undefined;
	}

	/**
	 * A saving setting stays focusable: it is marked busy and ignores further input
	 * instead of being disabled, which would drop keyboard focus to the page body.
	 */
	private setBusy(control: SettingControl, busy: boolean): void {
		if (busy) { control.row.setAttribute('aria-busy', 'true'); }
		else { control.row.removeAttribute('aria-busy'); }
		for (const element of control.elements) {
			if (busy) { element.setAttribute('aria-disabled', 'true'); }
			else { element.removeAttribute('aria-disabled'); }
		}
	}

	private captureFocus(): FocusSnapshot | undefined {
		const element = getActiveElement();
		return isHTMLElement(element) && this.root.contains(element)
			? { element, key: element.dataset.focusKey }
			: undefined;
	}

	private registerFocusTarget(key: string, element: HTMLElement): void {
		element.dataset.focusKey = key;
		this.focusTargets.set(key, element);
	}

	/** Put focus back on the control that had it, or its row's main control if that one can no longer take it. */
	private restoreFocus(snapshot: FocusSnapshot | undefined): void {
		if (!snapshot) { return; }
		const active = getActiveElement();
		const lost = !active || active === active.ownerDocument.body || (active === snapshot.element && !this.isFocusable(snapshot.element));
		if (!lost) { return; }
		const sameKey = snapshot.key === undefined ? undefined : this.focusTargets.get(snapshot.key);
		const rowControl = this.controls.find(control => control.elements.includes(snapshot.element))?.primary();
		[snapshot.element, sameKey, rowControl].find(element => !!element && this.isFocusable(element))?.focus();
	}

	private isFocusable(element: HTMLElement): boolean {
		return element.isConnected && !element.matches(':disabled') && !element.closest('[hidden]');
	}

	private async updateSetting(key: string, value: PersonalizationValue | undefined): Promise<void> {
		const target = this.target;
		if (await this.updateSettings(new Map([[key, value]]), target)) {
			this.reportSaved(target);
		}
	}

	/**
	 * Saves a range control's value. It keeps changing while an earlier value is still saving, so the
	 * newest value is kept meanwhile and saved once that save finishes, rather than being ignored.
	 */
	private async updateRangeSetting(key: string, value: number): Promise<void> {
		const request = { value, target: this.target };
		const draining = this.unsavedRangeValues.has(key);
		if (!draining && this.pendingSettings.has(key)) {
			// Something else is saving this setting, such as a reset: it is busy like any other control.
			return;
		}
		this.unsavedRangeValues.set(key, request);
		if (draining) {
			// The save in flight picks this value up when it finishes.
			return;
		}
		let latest: typeof request | undefined = request;
		while (latest) {
			const saved = await this.updateSettings(new Map([[key, latest.value]]), latest.target);
			const next = this.unsavedRangeValues.get(key);
			if (next === latest) {
				this.unsavedRangeValues.delete(key);
				this.refresh();
				if (saved) { this.reportSaved(latest.target); }
				latest = undefined;
			} else {
				latest = next;
			}
		}
	}

	private reportSaved(target: ConfigurationTarget): void {
		this.status.textContent = localize('personalization.saved', "Saved to {0} settings.", target === ConfigurationTarget.USER ? localize('personalization.user', "User") : localize('personalization.workspace', "Workspace"));
	}

	/** Saves settings at a scope, one after another. Settings that are already saving are skipped. */
	private async updateSettings(values: ReadonlyMap<string, PersonalizationValue | undefined>, target = this.target): Promise<boolean> {
		const keys = [...values.keys()].filter(key => !this.pendingSettings.has(key));
		if (!keys.length) { return false; }
		for (const key of keys) { this.pendingSettings.add(key); }
		this.refresh();
		try {
			for (const key of keys) { await this.configurationService.updateValue(key, values.get(key), target); }
			return true;
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error : String(error));
			this.status.textContent = localize('personalization.failed', "Could not save this change. Check the notification for details.");
			return false;
		} finally {
			for (const key of keys) { this.pendingSettings.delete(key); }
			this.refresh();
		}
	}

	/**
	 * Clears what a section manages: its settings at the selected scope, and its state kept outside the settings files.
	 * What was cleared is offered back with an Undo action.
	 */
	private async resetSection(section: PersonalizationSection): Promise<void> {
		// A color that was typed but not applied is not saved, so it is dropped rather than offered back.
		if (section.extraReset) { this.discardColorDraft(); }
		const target = this.target;
		const keys = section.keys.filter(key => this.canReset(key));
		const extra = section.extraReset?.isModified() ? section.extraReset : undefined;
		if (!keys.length && !extra) { return; }
		const cleared: ClearedSection = {
			workspaceId: this.workspaceService.getWorkspace().id,
			target,
			settings: new Map(keys.map(key => [key, this.inspectSetting(key).ownValue] as const)),
			color: extra ? { appearance: this.appearanceService.appearance } : undefined
		};
		extra?.reset();
		if (keys.length && !await this.updateSettings(new Map(keys.map(key => [key, undefined] as const)), target)) { return; }
		const message = localize('personalization.sectionReset', "{0} reset to defaults.", section.title);
		this.status.textContent = message;
		this.offerUndo(section, message, cleared);
	}

	/** Shows what was reset with an action that brings it back. Only the latest reset can be undone. */
	private offerUndo(section: PersonalizationSection, message: string, cleared: ClearedSection): void {
		const offer = new DisposableStore();
		const notification = this.notificationService.prompt(Severity.Info, message, [{
			label: localize('personalization.undoReset', "Undo"),
			run: () => { void this.undoReset(section, cleared); }
		}]);
		// The offer ends with the page, and when the next reset replaces it.
		offer.add(toDisposable(() => notification.close()));
		this.undoOffer.value = offer;
	}

	/**
	 * Puts back what a reset cleared, except anything changed again since: that is newer than what
	 * would be restored, and in another workspace it is not the same setting at all.
	 */
	private async undoReset(section: PersonalizationSection, cleared: ClearedSection): Promise<void> {
		this.undoOffer.clear();
		if (this.workspaceService.getWorkspace().id !== cleared.workspaceId) { return; }
		const settings = new Map([...cleared.settings].filter(([key]) => this.inspectSetting(key, cleared.target).ownValue === undefined));
		const color = this.appearanceService.hasChoice ? undefined : cleared.color;
		if (color) {
			const preview = this.appearanceService.beginPreview();
			try { preview.update(color.appearance); preview.apply(); }
			finally { preview.dispose(); }
		}
		if (settings.size && !await this.updateSettings(settings, cleared.target)) { return; }
		if (settings.size || color) {
			this.status.textContent = localize('personalization.sectionRestored', "{0} restored.", section.title);
		}
	}

	private runCommand(id: string): void {
		void this.commandService.executeCommand(id).catch(error => this.notificationService.error(error instanceof Error ? error : String(error)));
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		if (!visible) { this.discardColorDraft(); }
	}

	layout(dimension: Dimension): void {
		this.root.style.width = `${dimension.width}px`; this.root.style.height = `${dimension.height}px`;
		this.root.classList.toggle('narrow', dimension.width < 760);
		this.root.classList.toggle('compact', dimension.width < 520);
	}

	override focus(): void { super.focus(); this.sections[0]?.nav.focus(); }
}
