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
import { getTabGroupMembers } from './editorCommands.js';
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
				menu.setAttribute('aria-label', localize('tabGroup.contextMenuLabel', 'Edit Tab Group {0}', group.name));

				const identitySection = menu.appendChild($('.tab-group-menu-identity'));
				nameInput = identitySection.appendChild($('input.tab-group-menu-name')) as HTMLInputElement;
				nameInput.type = 'text';
				nameInput.value = group.name;
				nameInput.placeholder = localize('tabGroup.namePlaceholder', 'Tab Group Name');
				nameInput.setAttribute('aria-label', localize('tabGroup.nameAriaLabel', 'Tab Group Name'));
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
				colorPicker.setAttribute('aria-label', localize('tabGroup.colorAriaLabel', 'Tab Group Color'));
				const swatches: HTMLButtonElement[] = [];

				for (const color of EDITOR_TAB_GROUP_COLORS) {
					const swatch = colorPicker.appendChild($('button.tab-group-menu-color')) as HTMLButtonElement;
					swatch.type = 'button';
					swatch.style.backgroundColor = color.value;
					swatch.setAttribute('role', 'radio');
					swatch.setAttribute('aria-label', colorLabels.get(color.id) ?? color.id);
					const selected = color.id === group.color;
					swatch.classList.toggle('selected', selected);
					swatch.setAttribute('aria-checked', String(selected));
					swatch.tabIndex = selected || (!EDITOR_TAB_GROUP_COLORS.some(candidate => candidate.id === group.color) && swatches.length === 0) ? 0 : -1;
					swatches.push(swatch);

					disposables.add(addDisposableListener(swatch, EventType.CLICK, event => {
						EventHelper.stop(event);
						this.groupView.recolorTabGroup(group.id, color.id);
						for (const candidate of swatches) {
							const isSelected = candidate === swatch;
							candidate.classList.toggle('selected', isSelected);
							candidate.setAttribute('aria-checked', String(isSelected));
							candidate.tabIndex = isSelected ? 0 : -1;
						}
					}));
					disposables.add(addDisposableListener(swatch, EventType.KEY_DOWN, event => {
						const keyboardEvent = event as KeyboardEvent;
						const direction = keyboardEvent.key === 'ArrowRight' || keyboardEvent.key === 'ArrowDown' ? 1 : keyboardEvent.key === 'ArrowLeft' || keyboardEvent.key === 'ArrowUp' ? -1 : 0;
						if (direction !== 0) {
							EventHelper.stop(keyboardEvent);
							const nextIndex = (swatches.indexOf(swatch) + direction + swatches.length) % swatches.length;
							swatches[nextIndex].focus();
							swatches[nextIndex].click();
						}
					}));
				}

				const iconOptions: readonly { readonly icon: ThemeIcon | undefined; readonly label: string }[] = [
					{ icon: undefined, label: localize('tabGroup.iconNone', 'No Icon') },
					{ icon: Codicon.folder, label: localize('tabGroup.iconFolder', 'Folder') },
					{ icon: Codicon.code, label: localize('tabGroup.iconCode', 'Code') },
					{ icon: Codicon.terminal, label: localize('tabGroup.iconTerminal', 'Terminal') },
					{ icon: Codicon.repo, label: localize('tabGroup.iconRepository', 'Repository') },
					{ icon: Codicon.database, label: localize('tabGroup.iconDatabase', 'Database') },
					{ icon: Codicon.globe, label: localize('tabGroup.iconGlobe', 'Globe') },
					{ icon: Codicon.beaker, label: localize('tabGroup.iconTest', 'Test') },
					{ icon: Codicon.rocket, label: localize('tabGroup.iconRocket', 'Rocket') },
					{ icon: Codicon.lightbulb, label: localize('tabGroup.iconIdea', 'Idea') },
					{ icon: Codicon.starFull, label: localize('tabGroup.iconStar', 'Star') },
					{ icon: Codicon.heart, label: localize('tabGroup.iconHeart', 'Heart') },
					{ icon: Codicon.briefcase, label: localize('tabGroup.iconWork', 'Work') },
					{ icon: Codicon.tools, label: localize('tabGroup.iconTools', 'Tools') },
					{ icon: Codicon.paintcan, label: localize('tabGroup.iconDesign', 'Design') },
					{ icon: Codicon.zap, label: localize('tabGroup.iconZap', 'Zap') }
				];
				const iconPicker = identitySection.appendChild($('.tab-group-menu-icons'));
				iconPicker.setAttribute('role', 'radiogroup');
				iconPicker.setAttribute('aria-label', localize('tabGroup.iconAriaLabel', 'Tab Group Icon'));
				const iconButtons: HTMLButtonElement[] = [];
				for (const option of iconOptions) {
					const button = iconPicker.appendChild($('button.tab-group-menu-icon')) as HTMLButtonElement;
					button.type = 'button';
					button.setAttribute('role', 'radio');
					button.setAttribute('aria-label', option.label);
					button.title = option.label;
					button.classList.add(...ThemeIcon.asClassNameArray(option.icon ?? Codicon.circleSlash));
					const selected = group.icon === option.icon?.id;
					button.classList.toggle('selected', selected);
					button.setAttribute('aria-checked', String(selected));
					button.tabIndex = selected ? 0 : -1;
					iconButtons.push(button);

					disposables.add(addDisposableListener(button, EventType.CLICK, event => {
						EventHelper.stop(event);
						this.groupView.setTabGroupIcon(group.id, option.icon?.id);
						for (const candidate of iconButtons) {
							const isSelected = candidate === button;
							candidate.classList.toggle('selected', isSelected);
							candidate.setAttribute('aria-checked', String(isSelected));
							candidate.tabIndex = isSelected ? 0 : -1;
						}
					}));
					disposables.add(addDisposableListener(button, EventType.KEY_DOWN, event => {
						const keyboardEvent = event as KeyboardEvent;
						const columns = 8;
						const direction = keyboardEvent.key === 'ArrowRight' ? 1 : keyboardEvent.key === 'ArrowLeft' ? -1 : keyboardEvent.key === 'ArrowDown' ? columns : keyboardEvent.key === 'ArrowUp' ? -columns : 0;
						if (direction !== 0) {
							EventHelper.stop(keyboardEvent);
							const nextIndex = (iconButtons.indexOf(button) + direction + iconButtons.length) % iconButtons.length;
							iconButtons[nextIndex].focus();
						}
					}));
				}

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

				appendAction(localize('newTabInGroup', 'New Tab in Group'), Codicon.newFile, () => this.openNewTabInGroup(group), group.locked);
				appendAction(localize('moveTabGroupToNewWindow', 'Move Group into New Window'), Codicon.emptyWindow, () => this.moveTabGroupToNewWindow(group), group.locked);
				appendAction(group.saved ? localize('unsaveTabGroup', 'Stop Saving Group') : localize('saveTabGroup', 'Save Group'), Codicon.bookmark, () => this.groupView.setTabGroupSaved(group.id, !group.saved));
				appendAction(group.locked ? localize('unlockTabGroup', 'Unlock Group') : localize('lockTabGroup', 'Lock Group'), group.locked ? Codicon.unlock : Codicon.lock, () => this.groupView.setTabGroupLocked(group.id, !group.locked));
				appendAction(localize('closeTabGroup', 'Close Group'), Codicon.closeAll, () => this.closeTabGroup(group), group.locked);

				const separator = actionList.appendChild($('.tab-group-menu-separator'));
				separator.setAttribute('role', 'separator');

				appendAction(localize('undoTabGroupAction', 'Undo Last Group Change'), Codicon.history, () => { this.groupView.undoLastTabGroupAction(); }, !this.groupView.canUndoTabGroupAction);
				appendAction(localize('dissolveTabGroup', 'Ungroup Tabs'), Codicon.ungroupByRefType, () => this.groupView.dissolveTabGroup(group.id), group.locked);

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

	private async closeTabGroup(group: IEditorTabGroup): Promise<void> {
		if (group.locked) {
			return;
		}
		const members = getTabGroupMembers(this.groupView, group.id);
		const savedEditors = members.map(editor => ({ editor, index: this.groupView.getIndexOfEditor(editor) }));
		const closed = await this.groupView.closeEditors(members, { preserveFocus: true });
		if (closed && group.saved) {
			this.historyService.saveClosedTabGroup(group, savedEditors);
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
