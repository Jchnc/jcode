/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workspaceColorPicker.css';
import { $, addDisposableListener, append, EventHelper, EventType, getActiveElement, getWindow, isAncestor, isHTMLElement } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Color } from '../../../../base/common/color.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { isDark, isHighContrast } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { WorkbenchStateContext } from '../../../common/contextkeys.js';
import { getWorkspaceColorPreset, getWorkspaceColorRamp, WORKSPACE_COLOR_PALETTE } from '../../../common/workspaceColorPalette.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkspaceAppearance, IWorkspaceAppearanceService, normalizeWorkspaceColor, WORKSPACE_COLOR_COMMAND_ID } from '../../../services/themes/common/workspaceAppearance.js';

/** Native workspace identity picker with a disposable live preview. */
class WorkspaceColorPicker {
	constructor(
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkspaceAppearanceService private readonly appearanceService: IWorkspaceAppearanceService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IThemeService private readonly themeService: IThemeService
	) { }

	show(anchor?: HTMLElement): void {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return;
		}
		// Close the previous view before capturing the saved appearance.
		this.contextViewService.hideContextView();
		const targetContainer = anchor ? this.layoutService.getContainer(getWindow(anchor)) : this.layoutService.activeContainer;
		const focusBefore = getActiveElement();
		const disposables = new DisposableStore();
		const preview = disposables.add(this.appearanceService.beginPreview());
		let selected = this.appearanceService.appearance;
		let style: IWorkspaceAppearance['style'] = selected?.style ?? 'subtle';
		let focus: (() => void) | undefined;
		let restoreFocus = true;
		const workspaceId = this.contextService.getWorkspace().id;
		const onWorkspaceChange = () => {
			if (this.contextService.getWorkspace().id !== workspaceId) {
				this.contextViewService.hideContextView();
			}
		};
		disposables.add(this.contextService.onDidChangeWorkbenchState(onWorkspaceChange));
		disposables.add(this.contextService.onDidChangeWorkspaceFolders(onWorkspaceChange));
		disposables.add(this.contextService.onDidChangeWorkspaceName(onWorkspaceChange));
		this.contextViewService.showContextView({
			getAnchor: () => anchor ?? {
				x: targetContainer.getBoundingClientRect().left + targetContainer.clientWidth / 2 - 156,
				y: targetContainer.getBoundingClientRect().top + this.layoutService.activeContainerOffset.top
			},
			canRelayout: false,
			render: container => {
				const panel = append(container, $('.workspace-color-picker'));
				disposables.add(addDisposableListener(targetContainer, EventType.POINTER_DOWN, (event: PointerEvent) => {
					if (!isAncestor(event.target as Node, panel)) {
						restoreFocus = false;
						this.contextViewService.hideContextView();
					}
				}, true));
				panel.setAttribute('role', 'dialog');
				panel.setAttribute('aria-label', localize('workspaceColor.title', "Workspace Color"));
				append(panel, $('.workspace-color-heading', undefined, localize('workspaceColor.title', "Workspace Color")));
				const workspaceName = append(panel, $('.workspace-color-name', undefined, this.labelService.getWorkspaceLabel(this.contextService.getWorkspace())));
				disposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), workspaceName, localize('workspaceColor.local', "Saved for this workspace on this device.")));
				const paletteLabel = append(panel, $('.workspace-color-label-row'));
				append(paletteLabel, $('span', undefined, localize('workspaceColor.color', "Color")));
				const colorName = append(paletteLabel, $('span.workspace-color-value'));
				const swatchesContainer = append(panel, $('.workspace-color-swatches'));
				swatchesContainer.setAttribute('role', 'radiogroup');
				swatchesContainer.setAttribute('aria-label', localize('workspaceColor.palette', "Workspace color palette"));
				const swatches: HTMLButtonElement[] = [];
				const chips: HTMLElement[] = [];
				const styles: HTMLButtonElement[] = [];
				const stylePreviews: { title: HTMLElement; marker: HTMLElement; search: HTMLElement }[] = [];
				const updatePreviews = () => {
					const theme = this.themeService.getColorTheme();
					for (const [index, button] of swatches.entries()) {
						const ramp = getWorkspaceColorRamp(WORKSPACE_COLOR_PALETTE[index].value, isDark(theme.type));
						const background = Color.fromHex(ramp[style]);
						button.style.backgroundColor = isHighContrast(theme.type) ? '' : background.toString();
						button.style.color = isHighContrast(theme.type) ? '' : ramp.foreground;
						chips[index].style.backgroundColor = background.ensureConstrast(Color.fromHex(ramp.marker), 3).toString();
					}
					const ramp = getWorkspaceColorRamp(selected?.color ?? WORKSPACE_COLOR_PALETTE[0].value, isDark(theme.type));
					for (const [index, sample] of stylePreviews.entries()) {
						const background = Color.fromHex(index === 0 ? ramp.subtle : ramp.prominent);
						sample.title.style.backgroundColor = isHighContrast(theme.type) ? '' : background.toString();
						sample.marker.style.backgroundColor = isHighContrast(theme.type) ? '' : background.ensureConstrast(Color.fromHex(ramp.marker), 3).toString();
						sample.search.style.borderColor = isHighContrast(theme.type) ? '' : Color.fromHex(ramp.foreground).transparent(0.25).toString();
					}
				};
				disposables.add(this.themeService.onDidColorThemeChange(updatePreviews));
				const customRow = append(panel, $('.workspace-color-custom'));
				const customLabel = append(customRow, $('label', undefined, localize('workspaceColor.custom', "Hex Color")));
				const input = disposables.add(new InputBox(customRow, undefined, {
					inputBoxStyles: defaultInputBoxStyles,
					ariaLabel: localize('workspaceColor.hex', "Custom color in hexadecimal"),
					placeholder: '#RRGGBB'
				}));
				input.inputElement.id = 'workspace-color-hex';
				customLabel.setAttribute('for', input.inputElement.id);
				input.inputElement.maxLength = 7;
				input.inputElement.spellcheck = false;
				input.value = selected?.color ?? '';
				const error = append(panel, $('.workspace-color-error'));
				error.setAttribute('role', 'status');
				append(panel, $('.workspace-color-label-row.workspace-color-appearance-label', undefined, localize('workspaceColor.appearanceLabel', "Appearance")));
				const styleContainer = append(panel, $('.workspace-color-styles'));
				styleContainer.setAttribute('role', 'radiogroup');
				styleContainer.setAttribute('aria-label', localize('workspaceColor.appearance', "Color appearance"));
				const note = append(panel, $('.workspace-color-note'));
				const updateNote = () => note.textContent = isHighContrast(this.themeService.getColorTheme().type)
					? localize('workspaceColor.highContrast', "High contrast uses the color marker only.")
					: localize('workspaceColor.description', "Tints the title bar, status bar, and window frame.");
				updateNote();
				disposables.add(this.themeService.onDidColorThemeChange(updateNote));
				const actions = append(panel, $('.workspace-color-actions'));
				const reset = disposables.add(new Button(actions, {
					...defaultButtonStyles,
					secondary: true,
					buttonSecondaryBackground: 'transparent',
					buttonSecondaryForeground: 'var(--vscode-menu-foreground)',
					buttonSecondaryHoverBackground: 'var(--vscode-toolbar-hoverBackground)',
					buttonSecondaryBorder: 'transparent'
				}));
				reset.element.classList.add('workspace-color-reset');
				reset.label = localize('workspaceColor.reset', "Use Theme Color");
				const cancel = disposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
				cancel.label = localize('workspaceColor.cancel', "Cancel");
				const apply = disposables.add(new Button(actions, defaultButtonStyles));
				apply.label = localize('workspaceColor.apply', "Apply");
				const sync = () => {
					const preset = getWorkspaceColorPreset(selected?.color);
					colorName.textContent = selected ? preset?.label ?? localize('workspaceColor.customLabel', "Custom") : localize('workspaceColor.themeLabel', "Theme Default");
					for (const [index, button] of swatches.entries()) {
						const checked = preset === WORKSPACE_COLOR_PALETTE[index];
						button.setAttribute('aria-checked', String(checked));
						button.tabIndex = checked || (!preset && index === 0) ? 0 : -1;
					}
					for (const [index, button] of styles.entries()) {
						const checked = style === (index === 0 ? 'subtle' : 'prominent');
						button.setAttribute('aria-checked', String(checked));
						button.tabIndex = checked ? 0 : -1;
					}
					reset.enabled = !!selected;
					updatePreviews();
					preview.update(selected);
				};
				const selectColor = (color: string) => {
					selected = { color, style };
					input.value = color;
					apply.enabled = true;
					error.textContent = '';
					input.inputElement.removeAttribute('aria-invalid');
					sync();
				};
				const addRadioNavigation = (buttons: HTMLButtonElement[], columns = 1) => {
					for (const [index, button] of buttons.entries()) {
						disposables.add(addDisposableListener(button, EventType.KEY_DOWN, (event: KeyboardEvent) => {
							let next: number;
							switch (event.key) {
								case 'ArrowRight': next = (index + 1) % buttons.length; break;
								case 'ArrowLeft': next = (index + buttons.length - 1) % buttons.length; break;
								case 'ArrowDown': next = (index + columns) % buttons.length; break;
								case 'ArrowUp': next = (index + buttons.length - columns) % buttons.length; break;
								case 'Home': next = 0; break;
								case 'End': next = buttons.length - 1; break;
								default: return;
							}
							EventHelper.stop(event);
							buttons[next].click();
							buttons[next].focus();
						}));
					}
				};
				for (const color of WORKSPACE_COLOR_PALETTE) {
					const button = append(swatchesContainer, $('button.workspace-color-swatch')) as HTMLButtonElement;
					button.type = 'button';
					const chip = append(button, $('span.workspace-color-chip'));
					chips.push(chip);
					append(button, $('span.workspace-color-swatch-name', undefined, color.label));
					const check = append(button, $('span.workspace-color-check'));
					check.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
					check.setAttribute('aria-hidden', 'true');
					button.setAttribute('role', 'radio');
					button.setAttribute('aria-label', color.label);
					swatches.push(button);
					disposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, color.label));
					disposables.add(addDisposableListener(button, EventType.CLICK, () => selectColor(color.value)));
				}
				for (const [value, label, description] of [
					['subtle', localize('workspaceColor.subtle', "Subtle"), localize('workspaceColor.subtleDescription', "A quiet hint of color.")],
					['prominent', localize('workspaceColor.rich', "Rich"), localize('workspaceColor.richDescription', "A more visible workspace color.")]
				] as const) {
					const button = append(styleContainer, $('button.workspace-color-style', { type: 'button', role: 'radio' })) as HTMLButtonElement;
					button.setAttribute('aria-label', label);
					button.setAttribute('aria-description', description);
					const sample = append(button, $('span.workspace-color-style-preview', { 'aria-hidden': 'true' }));
					const title = append(sample, $('span.workspace-color-style-titlebar'));
					const marker = append(title, $('span.workspace-color-style-marker'));
					const search = append(title, $('span.workspace-color-style-search'));
					append(sample, $('span.workspace-color-style-editor'));
					stylePreviews.push({ title, marker, search });
					const caption = append(button, $('span.workspace-color-style-caption'));
					append(caption, $('span', undefined, label));
					const check = append(caption, $('span.workspace-color-check', { 'aria-hidden': 'true' }));
					check.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
					styles.push(button);
					disposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, description));
					disposables.add(addDisposableListener(button, EventType.CLICK, () => {
						style = value;
						if (selected) {
							selected = { ...selected, style };
						}
						sync();
					}));
				}
				addRadioNavigation(swatches, 2);
				addRadioNavigation(styles);
				disposables.add(input.onDidChange(value => {
					const color = normalizeWorkspaceColor(value.trim());
					apply.enabled = !!color;
					input.inputElement.setAttribute('aria-invalid', String(!color));
					error.textContent = color ? '' : localize('workspaceColor.invalid', "Enter a hex color, such as #7298c8.");
					if (color) {
						selected = { color, style };
						sync();
					}
				}));
				disposables.add(reset.onDidClick(() => {
					selected = undefined;
					input.value = '';
					apply.enabled = true;
					input.inputElement.removeAttribute('aria-invalid');
					error.textContent = '';
					sync();
				}));
				const commit = () => {
					if (apply.enabled) {
						preview.apply();
						this.contextViewService.hideContextView();
					}
				};
				disposables.add(apply.onDidClick(commit));
				disposables.add(cancel.onDidClick(() => this.contextViewService.hideContextView()));
				disposables.add(addDisposableListener(panel, EventType.KEY_DOWN, (event: KeyboardEvent) => {
					if (event.key === 'Escape') {
						EventHelper.stop(event);
						this.contextViewService.hideContextView();
					} else if (event.key === 'Enter' && event.target === input.inputElement) {
						EventHelper.stop(event);
						commit();
					} else if (event.key === 'Tab') {
						const focusable = [...swatches, input.inputElement, ...styles, reset.element, cancel.element, apply.element].filter(element => element.tabIndex >= 0 && element.getAttribute('aria-disabled') !== 'true');
						const next = (focusable.indexOf(panel.ownerDocument.activeElement as HTMLElement) + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
						EventHelper.stop(event);
						focusable[next]?.focus();
					}
				}));
				sync();
				focus = () => (swatches.find(button => button.tabIndex === 0) ?? input.inputElement).focus();
				return disposables;
			},
			focus: () => focus?.(),
			onHide: () => {
				disposables.dispose();
				if (restoreFocus) {
					if (isHTMLElement(focusBefore) && focusBefore.isConnected && focusBefore.getClientRects().length > 0) {
						focusBefore.focus();
					} else {
						this.layoutService.focus();
					}
				}
			}
		}, targetContainer);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: WORKSPACE_COLOR_COMMAND_ID,
			title: localize2('workspaceColor.command', "Workspace Color..."),
			category: Categories.Preferences,
			f1: true,
			precondition: WorkbenchStateContext.notEqualsTo('empty'),
			menu: [
				{ id: MenuId.MenubarAppearanceMenu, group: '2_configuration', order: 8 },
				{ id: MenuId.TitleBarContext, group: '3_workspace', order: 1 },
				{ id: MenuId.TitleBarTitleContext, group: '3_workspace', order: 1 }
			]
		});
	}

	run(accessor: ServicesAccessor, anchor?: HTMLElement): void {
		accessor.get(IInstantiationService).createInstance(WorkspaceColorPicker).show(isHTMLElement(anchor) ? anchor : undefined);
	}
});
