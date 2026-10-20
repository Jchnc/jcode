/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WORKBENCH_COLOR_PALETTE } from '../../../common/workbenchColorPalette.js';
import './media/tabgroups.css';
import { $, addDisposableListener, EventHelper, EventType, getWindow, isMouseEvent, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { localize } from '../../../../nls.js';
import { EDITOR_TAB_GROUP_COLORS, IEditorTabGroup } from '../../../common/editor/editorTabGroup.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { closeTabGroup, getTabGroupMembers } from './editorCommands.js';
import { IEditorGroupView, IEditorPartsView, isEditorGroupView, prepareMoveCopyEditors } from './editor.js';

/** The shared tab group popup for horizontal and vertical editor tabs. */
export class TabGroupContextMenu {
	constructor(
		private readonly groupView: IEditorGroupView,
		private readonly editorPartsView: IEditorPartsView,
		private readonly contextViewService: IContextViewService,
		private readonly editorService: IEditorService,
		private readonly historyService: IHistoryService,
		private readonly tabsContainer: HTMLElement
	) { }

	show(group: IEditorTabGroup, header: HTMLElement, e: Event): void {
		let anchor: HTMLElement | StandardMouseEvent = header;
		if (isMouseEvent(e)) {
			anchor = new StandardMouseEvent(getWindow(header), e);
		}

		let nameInput: HTMLInputElement | undefined;
		let commitName = () => true;

		this.contextViewService.showContextView({
			getAnchor: () => anchor,
			canRelayout: false,
			render: container => {
				container.classList.add('tab-group-context-view');
				const disposables = new DisposableStore();

				const menu = container.appendChild($('.tab-group-context-menu'));
				menu.setAttribute('role', 'dialog');
				menu.setAttribute('aria-label', localize('tabGroup.contextMenuLabel', "Edit Tab Group {0}", group.name));

				const identitySection = menu.appendChild($('.tab-group-menu-identity'));
				nameInput = identitySection.appendChild($('input.tab-group-menu-name')) as HTMLInputElement;
				nameInput.type = 'text';
				nameInput.value = group.name;
				nameInput.placeholder = localize('tabGroup.namePlaceholder', "Tab Group Name");
				nameInput.setAttribute('aria-label', localize('tabGroup.nameAriaLabel', "Tab Group Name"));
				nameInput.spellcheck = false;

				commitName = () => {
					const name = nameInput?.value.trim();
					if (!name) {
						nameInput?.setAttribute('aria-invalid', 'true');
						return false;
					}

					nameInput?.removeAttribute('aria-invalid');
					if (name !== group.name) {
						this.groupView.renameTabGroup(group.id, name);
					}
					return true;
				};

				disposables.add(addDisposableListener(nameInput, EventType.INPUT, () => {
					if (nameInput?.value.trim()) {
						nameInput.removeAttribute('aria-invalid');
					} else {
						nameInput?.setAttribute('aria-invalid', 'true');
					}
				}));
				disposables.add(addDisposableListener(nameInput, EventType.KEY_DOWN, event => {
					const keyboardEvent = event as KeyboardEvent;
					if (keyboardEvent.key === 'Enter' && commitName()) {
						EventHelper.stop(keyboardEvent);
						this.contextViewService.hideContextView();
					}
				}));

				const colorLabels = new Map<string, string>(WORKBENCH_COLOR_PALETTE.map(color => [color.id, color.label]));
				const colorPicker = identitySection.appendChild($('.tab-group-menu-colors'));
				colorPicker.setAttribute('role', 'radiogroup');
				colorPicker.setAttribute('aria-label', localize('tabGroup.colorAriaLabel', "Tab Group Color"));
				const swatches: HTMLButtonElement[] = [];

				for (const color of EDITOR_TAB_GROUP_COLORS) {
					const swatch = colorPicker.appendChild($('button.tab-group-menu-color')) as HTMLButtonElement;
					swatch.type = 'button';
					swatch.style.backgroundColor = color.value;
					swatch.setAttribute('role', 'radio');
					swatch.setAttribute('aria-label', colorLabels.get(color.id) ?? color.id);
					swatches.push(swatch);
				}
				registerRadioGroup(disposables, swatches, EDITOR_TAB_GROUP_COLORS.findIndex(color => color.id === group.color), index => this.groupView.recolorTabGroup(group.id, EDITOR_TAB_GROUP_COLORS[index].id));

				const iconOptions: readonly { readonly icon: ThemeIcon | undefined; readonly label: string }[] = [
					{ icon: undefined, label: localize('tabGroup.iconNone', "No Icon") },
					{ icon: Codicon.folder, label: localize('tabGroup.iconFolder', "Folder") },
					{ icon: Codicon.code, label: localize('tabGroup.iconCode', "Code") },
					{ icon: Codicon.terminal, label: localize('tabGroup.iconTerminal', "Terminal") },
					{ icon: Codicon.repo, label: localize('tabGroup.iconRepository', "Repository") },
					{ icon: Codicon.database, label: localize('tabGroup.iconDatabase', "Database") },
					{ icon: Codicon.globe, label: localize('tabGroup.iconGlobe', "Globe") },
					{ icon: Codicon.beaker, label: localize('tabGroup.iconTest', "Test") },
					{ icon: Codicon.rocket, label: localize('tabGroup.iconRocket', "Rocket") },
					{ icon: Codicon.lightbulb, label: localize('tabGroup.iconIdea', "Idea") },
					{ icon: Codicon.starFull, label: localize('tabGroup.iconStar', "Star") },
					{ icon: Codicon.heart, label: localize('tabGroup.iconHeart', "Heart") },
					{ icon: Codicon.briefcase, label: localize('tabGroup.iconWork', "Work") },
					{ icon: Codicon.tools, label: localize('tabGroup.iconTools', "Tools") },
					{ icon: Codicon.paintcan, label: localize('tabGroup.iconDesign', "Design") },
					{ icon: Codicon.zap, label: localize('tabGroup.iconZap', "Zap") }
				];
				const iconPicker = identitySection.appendChild($('.tab-group-menu-icons'));
				iconPicker.setAttribute('role', 'radiogroup');
				iconPicker.setAttribute('aria-label', localize('tabGroup.iconAriaLabel', "Tab Group Icon"));
				const iconButtons: HTMLButtonElement[] = [];
				for (const option of iconOptions) {
					const button = iconPicker.appendChild($('button.tab-group-menu-icon')) as HTMLButtonElement;
					button.type = 'button';
					button.setAttribute('role', 'radio');
					button.setAttribute('aria-label', option.label);
					button.title = option.label;
					button.classList.add(...ThemeIcon.asClassNameArray(option.icon ?? Codicon.circleSlash));
					iconButtons.push(button);
				}
				registerRadioGroup(disposables, iconButtons, iconOptions.findIndex(option => group.icon === option.icon?.id), index => this.groupView.setTabGroupIcon(group.id, iconOptions[index].icon?.id), ICON_PICKER_COLUMNS);

				const actionList = menu.appendChild($('.tab-group-menu-actions'));
				actionList.setAttribute('role', 'menu');
				const actionButtons: HTMLButtonElement[] = [];
				const appendAction = (label: string, icon: ThemeIcon, run: () => void | Promise<void>, disabled = false) => {
					const button = actionList.appendChild($('button.tab-group-menu-action')) as HTMLButtonElement;
					button.type = 'button';
					button.setAttribute('role', 'menuitem');
					button.disabled = disabled;
					button.setAttribute('aria-disabled', String(disabled));
					if (!disabled) {
						actionButtons.push(button);
					}

					const iconElement = button.appendChild($('span.tab-group-menu-action-icon'));
					iconElement.classList.add(...ThemeIcon.asClassNameArray(icon));
					const labelElement = button.appendChild($('span.tab-group-menu-action-label'));
					labelElement.textContent = label;
					disposables.add(addDisposableListener(button, EventType.CLICK, event => {
						EventHelper.stop(event);
						this.contextViewService.hideContextView();
						try {
							const result = run();
							if (result) {
								void result.catch(onUnexpectedError);
							}
						} catch (error) {
							onUnexpectedError(error);
						}
					}));
					disposables.add(addDisposableListener(button, EventType.KEY_DOWN, event => {
						const keyboardEvent = event as KeyboardEvent;
						const direction = keyboardEvent.key === 'ArrowDown' ? 1 : keyboardEvent.key === 'ArrowUp' ? -1 : 0;
						if (direction !== 0) {
							EventHelper.stop(keyboardEvent);
							const nextIndex = (actionButtons.indexOf(button) + direction + actionButtons.length) % actionButtons.length;
							actionButtons[nextIndex].focus();
						}
					}));
				};

				appendAction(localize('newTabInGroup', "New Tab in Group"), Codicon.newFile, () => this.openNewTabInGroup(group), group.locked);
				appendAction(localize('moveTabGroupToNewWindow', "Move Group into New Window"), Codicon.emptyWindow, () => this.moveTabGroupToNewWindow(group), group.locked);
				appendAction(group.saved ? localize('unsaveTabGroup', "Stop Saving Group") : localize('saveTabGroup', "Save Group"), Codicon.bookmark, () => this.groupView.setTabGroupSaved(group.id, !group.saved));
				appendAction(group.locked ? localize('unlockTabGroup', "Unlock Group") : localize('lockTabGroup', "Lock Group"), group.locked ? Codicon.unlock : Codicon.lock, () => this.groupView.setTabGroupLocked(group.id, !group.locked));
				appendAction(localize('closeTabGroup', "Close Group"), Codicon.closeAll, () => closeTabGroup(this.groupView, group, this.historyService, true), group.locked);

				const separator = actionList.appendChild($('.tab-group-menu-separator'));
				separator.setAttribute('role', 'separator');

				appendAction(localize('undoTabGroupAction', "Undo Last Group Change"), Codicon.history, () => { this.groupView.undoLastTabGroupAction(); }, !this.groupView.canUndoTabGroupAction);
				appendAction(localize('dissolveTabGroup', "Ungroup Tabs"), Codicon.ungroupByRefType, () => this.groupView.dissolveTabGroup(group.id), group.locked);

				disposables.add(addDisposableListener(getWindow(menu).document, EventType.POINTER_DOWN, event => {
					if (!menu.contains(event.target as Node)) {
						this.contextViewService.hideContextView();
					}
				}, true));
				disposables.add(addDisposableListener(menu, EventType.KEY_DOWN, event => {
					if (event.key === 'Escape') {
						EventHelper.stop(event);
						this.contextViewService.hideContextView();
					}
				}));
				disposables.add(addDisposableListener(getWindow(menu), EventType.BLUR, () => this.contextViewService.hideContextView()));
				disposables.add(addDisposableListener(menu, EventType.FOCUS_OUT, event => {
					if (event.relatedTarget && !menu.contains(event.relatedTarget as Node)) {
						this.contextViewService.hideContextView();
					}
				}));
				disposables.add(scheduleAtNextAnimationFrame(getWindow(nameInput), () => {
					nameInput?.focus();
					nameInput?.select();
				}));

				return disposables;
			},
			focus: () => {
				nameInput?.focus();
				nameInput?.select();
			},
			onHide: () => {
				commitName();
				for (const child of Array.from(this.tabsContainer.children)) {
					const candidate = child as HTMLElement;
					if (candidate.dataset.tabGroupId === group.id) {
						candidate.focus();
						return;
					}
				}
				this.groupView.focus();
			}
		});
	}

	private async openNewTabInGroup(group: IEditorTabGroup): Promise<void> {
		const members = getTabGroupMembers(this.groupView, group.id);
		const lastMemberIndex = members.reduce((index, editor) => Math.max(index, this.groupView.getIndexOfEditor(editor)), -1);
		if (group.collapsed) {
			this.groupView.setTabGroupCollapsed(group.id, false);
		}

		const pane = await this.editorService.openEditor({ resource: undefined, options: { pinned: true, index: lastMemberIndex + 1 } }, this.groupView);
		if (pane?.input) {
			this.groupView.addToTabGroup(group.id, [pane.input]);
		}
	}

	private async moveTabGroupToNewWindow(group: IEditorTabGroup): Promise<void> {
		if (group.locked) {
			return;
		}
		const members = getTabGroupMembers(this.groupView, group.id);
		if (members.length === 0) {
			return;
		}

		const auxiliaryEditorPart = await this.editorPartsView.createAuxiliaryEditorPart();
		const moved = this.groupView.moveEditors(prepareMoveCopyEditors(this.groupView, members), auxiliaryEditorPart.activeGroup);
		if (moved && isEditorGroupView(auxiliaryEditorPart.activeGroup)) {
			auxiliaryEditorPart.activeGroup.createTabGroup(members, group.name, group.color, { id: group.id, collapsed: group.collapsed, saved: group.saved, locked: group.locked, icon: group.icon, metadata: group.metadata });
		}

		auxiliaryEditorPart.activeGroup.focus();
	}

}

/** The number of icon buttons per row, which is also how far the Up and Down arrow keys move. */
const ICON_PICKER_COLUMNS = 8;

/**
 * Makes a group of radio buttons keyboard friendly with a roving tab index. The arrow
 * keys, Home and End only move focus so that browsing the options has no side effects,
 * whereas Enter, Space and click select the focused option.
 *
 * @param selectedIndex The index of the initially selected option, or `-1` if there is none.
 * @param onSelect Invoked when the user selects an option.
 * @param columns The number of options per row: Left and Right move by one option, Up and Down by a row.
 */
function registerRadioGroup(disposables: DisposableStore, radios: readonly HTMLButtonElement[], selectedIndex: number, onSelect: (index: number) => void, columns = 1): void {
	let checkedIndex = selectedIndex;
	let focusableIndex = Math.max(0, selectedIndex);

	const updateRadios = () => {
		radios.forEach((radio, index) => {
			radio.classList.toggle('selected', index === checkedIndex);
			radio.setAttribute('aria-checked', String(index === checkedIndex));
			radio.tabIndex = index === focusableIndex ? 0 : -1;
		});
	};
	updateRadios();

	const moveFocus = (index: number) => {
		focusableIndex = index;
		updateRadios();
		radios[index].focus();
	};

	radios.forEach((radio, index) => {
		disposables.add(addDisposableListener(radio, EventType.FOCUS, () => {
			if (focusableIndex !== index) {
				focusableIndex = index;
				updateRadios();
			}
		}));
		disposables.add(addDisposableListener(radio, EventType.CLICK, event => {
			EventHelper.stop(event);
			checkedIndex = index;
			focusableIndex = index;
			updateRadios();
			onSelect(index);
		}));
		disposables.add(addDisposableListener(radio, EventType.KEY_DOWN, event => {
			let targetIndex: number;
			switch (event.key) {
				case 'ArrowRight': targetIndex = index + 1; break;
				case 'ArrowLeft': targetIndex = index - 1; break;
				case 'ArrowDown': targetIndex = index + columns; break;
				case 'ArrowUp': targetIndex = index - columns; break;
				case 'Home': targetIndex = 0; break;
				case 'End': targetIndex = radios.length - 1; break;
				case 'Enter':
				case ' ':
					EventHelper.stop(event);
					radio.click();
					return;
				default:
					return;
			}

			EventHelper.stop(event);
			moveFocus((targetIndex + radios.length) % radios.length);
		}));
	});
}
