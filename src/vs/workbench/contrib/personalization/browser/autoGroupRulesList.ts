/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventHelper, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getRadioNavigationTarget } from '../../../browser/workspaceColorSwatch.js';
import { EDITOR_TAB_GROUP_ICONS } from '../../../common/editor/editorTabGroup.js';
import { WORKBENCH_COLOR_PALETTE } from '../../../common/workbenchColorPalette.js';
import { ITabAutoGroupResource, ITabAutoGroupRule } from '../../tabGroups/common/tabAutoGroupRules.js';
import { AutoGroupPatternProblem, AutoGroupRulesModel, IAutoGroupRuleDraft } from '../common/autoGroupRulesModel.js';

/** What the list needs from the page that shows it. */
export interface IAutoGroupRulesListHost {

	/** Saves the rules, which are all complete. */
	save(rules: readonly ITabAutoGroupRule[]): void;

	/** Where the files of the open editors are, which is what the rules are tried on. */
	getResources(): readonly ITabAutoGroupResource[];

	/** Tells the user what happened, in a way that screen readers read out. */
	announce(message: string): void;
}

interface IRadioOption {
	readonly value: string | undefined;
	readonly label: string;
	/** Draws the option on its button. */
	readonly draw: (button: HTMLButtonElement) => void;
}

interface IRadioGroup {
	readonly element: HTMLElement;
	readonly buttons: readonly HTMLButtonElement[];
	readonly select: (value: string | undefined) => void;
}

interface IRuleRow {
	readonly element: HTMLElement;
	readonly store: DisposableStore;
	readonly name: HTMLInputElement;
	readonly pattern: HTMLInputElement;
	readonly nameError: HTMLElement;
	readonly patternError: HTMLElement;
	readonly status: HTMLElement;
	readonly handle: HTMLElement;
	readonly moveUp: HTMLButtonElement;
	readonly moveDown: HTMLButtonElement;
	readonly remove: HTMLButtonElement;
	readonly colors: IRadioGroup;
	readonly icons: IRadioGroup;
	/** Shows and hides the color and icon choices, which stay folded away until they are wanted. */
	readonly appearanceToggle: HTMLButtonElement;
	/** What the user has finished typing in, which is when mistakes are pointed out. */
	touchedName: boolean;
	touchedPattern: boolean;
}

/** Example patterns that the empty fields suggest, one for each rule. */
const PATTERN_EXAMPLES = ['src/api/**', '**/*.test.ts', 'docs/**/*.md', 'src/components/**'];
const NAME_EXAMPLES = ['API', 'Tests', 'Docs', 'Components'];

/**
 * The editor of the auto-grouping rules: a list of rows, each with the name of the tab group, its color and
 * icon, and the pattern of the files that go into it. Rules are saved as soon as all of them are complete.
 */
export class AutoGroupRulesList extends Disposable {

	readonly element: HTMLElement;

	private readonly model = new AutoGroupRulesModel();
	private readonly rows = new Map<number, IRuleRow>();
	private readonly list: HTMLElement;
	private readonly emptyState: HTMLElement;
	private readonly addButtons: HTMLButtonElement[] = [];
	private readonly footer: HTMLElement;

	/** The rules as they were last saved or read, to tell the changes made elsewhere from the echo of our own. */
	private committed = JSON.stringify([]);
	private disabled = false;
	private nextElementId = 0;
	private draggedId: number | undefined;

	constructor(
		parent: HTMLElement,
		private readonly idPrefix: string,
		private readonly host: IAutoGroupRulesListHost,
		private readonly hoverService: IHoverService
	) {
		super();

		this.element = append(parent, $('.autogroup-rules'));
		this.emptyState = append(this.element, $('.autogroup-empty'));
		append(this.emptyState, $('span.autogroup-empty-icon', { 'aria-hidden': 'true' })).classList.add(...ThemeIcon.asClassNameArray(Codicon.layers));
		append(this.emptyState, $('span.personalization-control-label', undefined, localize('personalization.noRules', "No rules yet")));
		append(this.emptyState, $('p', undefined, localize('personalization.noRulesDescription', "A rule puts the files that match its pattern into a named, colored tab group as you open them. For example, send src/api/** to a group called API.")));
		this.addButtons.push(this.createAddButton(this.emptyState, true));

		this.list = append(this.element, $('.autogroup-list', { role: 'list', 'aria-label': localize('personalization.rulesList', "Auto-grouping rules") }));
		this._register(addDisposableListener(this.list, EventType.DRAG_OVER, event => this.onDragOver(event)));
		this._register(addDisposableListener(this.list, EventType.DROP, event => this.onDrop(event)));

		this.footer = append(this.element, $('.autogroup-footer'));
		this.addButtons.push(this.createAddButton(this.footer, false));
		append(this.footer, $('span.personalization-setting-hint', undefined, localize('personalization.rulesOrder', "The first rule that matches a file wins, so order matters.")));
		this.updateLayout();
	}

	private createAddButton(parent: HTMLElement, primary: boolean): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button' }, localize('personalization.addRule', "Add Rule"))) as HTMLButtonElement;
		button.classList.add(primary ? 'personalization-primary' : 'autogroup-add');
		button.dataset.focusKey = primary ? 'autogroup:add-empty' : 'autogroup:add';
		this._register(addDisposableListener(button, EventType.CLICK, () => this.addRule()));
		return button;
	}

	/** The button that starts a new rule, which takes keyboard focus when the one that had it goes away. */
	get primary(): HTMLElement {
		const first = this.model.rules[0] && this.rows.get(this.model.rules[0].id);
		return first?.name ?? this.addButtons[0];
	}

	/** Every control of the list. */
	private get controls(): (HTMLButtonElement | HTMLInputElement)[] {
		return [...this.addButtons, ...[...this.rows.values()].flatMap(row => [row.name, row.pattern, row.appearanceToggle, row.moveUp, row.moveDown, row.remove, ...row.colors.buttons, ...row.icons.buttons])];
	}

	/**
	 * Shows the rules of the setting. A value that is what the list saved last leaves the list as it is, which
	 * keeps rules that are still being filled in, but a different one was written elsewhere and replaces it.
	 */
	setRules(value: unknown, disabled: boolean): void {
		const incoming = JSON.stringify(new AutoGroupRulesModel(value).serialize());
		if (incoming !== this.committed) {
			this.committed = incoming;
			this.model.reset(value);
			this.disposeRows();
			for (const rule of this.model.rules) {
				this.createRow(rule);
			}
			this.syncOrder();
		}

		this.disabled = disabled;
		for (const control of this.controls) {
			control.disabled = disabled;
		}
		this.syncOrder();
		this.updateLayout();
		this.refreshMatches();
	}

	/** Counts again how many open editors each rule matches, which changes as editors open and close. */
	refreshMatches(): void {
		const counts = this.model.countMatches(this.host.getResources());
		for (const rule of this.model.rules) {
			const row = this.rows.get(rule.id);
			if (row) {
				this.updateStatus(row, rule, counts.get(rule.id) ?? 0);
			}
		}
	}

	//#region Rows

	private createRow(rule: IAutoGroupRuleDraft, expanded = false): IRuleRow {
		const store = new DisposableStore();
		const id = `${this.idPrefix}-rule-${this.nextElementId++}`;
		const element = $('.autogroup-rule', { role: 'listitem' });
		const index = this.model.rules.findIndex(candidate => candidate.id === rule.id);

		const handle = append(element, $('span.autogroup-handle', { 'aria-hidden': 'true' }));
		handle.classList.add(...ThemeIcon.asClassNameArray(Codicon.gripper));
		const fields = append(element, $('.autogroup-fields'));

		const nameField = append(fields, $('.autogroup-field.autogroup-name'));
		append(nameField, $('label', { for: `${id}-name` }, localize('personalization.ruleName', "Group name")));
		const name = append(nameField, $('input', { id: `${id}-name`, type: 'text', placeholder: localize('personalization.ruleNamePlaceholder', "For example, {0}", NAME_EXAMPLES[index % NAME_EXAMPLES.length]), spellcheck: 'false' })) as HTMLInputElement;
		const nameError = append(nameField, $('span.autogroup-error', { id: `${id}-name-error` }));

		const patternField = append(fields, $('.autogroup-field.autogroup-pattern'));
		append(patternField, $('label', { for: `${id}-pattern` }, localize('personalization.rulePattern', "Files that match")));
		const pattern = append(patternField, $('input', { id: `${id}-pattern`, type: 'text', placeholder: PATTERN_EXAMPLES[index % PATTERN_EXAMPLES.length], spellcheck: 'false' })) as HTMLInputElement;
		const patternError = append(patternField, $('span.autogroup-error', { id: `${id}-pattern-error` }));
		name.setAttribute('aria-describedby', nameError.id);
		pattern.setAttribute('aria-describedby', `${patternError.id} ${id}-status`);

		const colorOptions: IRadioOption[] = [
			{ value: undefined, label: localize('personalization.ruleColorAuto', "Automatic color"), draw: button => button.classList.add('autogroup-auto', ...ThemeIcon.asClassNameArray(Codicon.circleSlash)) },
			...WORKBENCH_COLOR_PALETTE.map(color => ({ value: color.id as string | undefined, label: color.label, draw: (button: HTMLButtonElement) => { button.style.backgroundColor = color.value; } }))
		];
		const iconOptions: IRadioOption[] = [
			{ value: undefined, label: localize('personalization.ruleIconNone', "No icon"), draw: button => button.classList.add(...ThemeIcon.asClassNameArray(Codicon.circleSlash)) },
			...EDITOR_TAB_GROUP_ICONS.map(icon => ({ value: icon.icon.id as string | undefined, label: icon.label, draw: (button: HTMLButtonElement) => button.classList.add(...ThemeIcon.asClassNameArray(icon.icon)) }))
		];
		// The color and icon choices fold away behind a button that shows what is chosen, so a list of rules stays calm
		const appearanceToggle = append(fields, $('button.autogroup-appearance-toggle', { type: 'button', 'aria-expanded': String(expanded), 'aria-controls': `${id}-appearance` })) as HTMLButtonElement;
		const previewColor = append(appearanceToggle, $('span.autogroup-preview-color', { 'aria-hidden': 'true' }));
		const previewIcon = append(appearanceToggle, $('span.autogroup-preview-icon', { 'aria-hidden': 'true' }));
		append(appearanceToggle, $('span.autogroup-appearance-label', undefined, localize('personalization.ruleAppearance', "Color and Icon")));
		append(appearanceToggle, $('span.autogroup-appearance-chevron', { 'aria-hidden': 'true' })).classList.add(...ThemeIcon.asClassNameArray(Codicon.chevronDown));
		const appearance = append(fields, $('.autogroup-appearance', { id: `${id}-appearance` }));
		appearance.hidden = !expanded;
		const updatePreview = () => {
			const current = this.model.rules.find(candidate => candidate.id === rule.id);
			const color = WORKBENCH_COLOR_PALETTE.find(candidate => candidate.id === current?.color);
			previewColor.style.backgroundColor = color?.value ?? '';
			previewColor.classList.toggle('automatic', !color);
			const icon = EDITOR_TAB_GROUP_ICONS.find(candidate => candidate.icon.id === current?.icon);
			previewIcon.className = 'autogroup-preview-icon';
			if (icon) {
				previewIcon.classList.add(...ThemeIcon.asClassNameArray(icon.icon));
			}
		};
		store.add(addDisposableListener(appearanceToggle, EventType.CLICK, () => {
			appearance.hidden = !appearance.hidden;
			appearanceToggle.setAttribute('aria-expanded', String(!appearance.hidden));
		}));
		const colors = this.createRadioGroup(append(appearance, $('.autogroup-field.autogroup-colors')), localize('personalization.ruleColor', "Color"), 'autogroup-color', colorOptions, value => { this.edit(rule.id, { color: value }); updatePreview(); }, store);
		const icons = this.createRadioGroup(append(appearance, $('.autogroup-field.autogroup-icons')), localize('personalization.ruleIcon', "Icon"), 'autogroup-icon', iconOptions, value => { this.edit(rule.id, { icon: value }); updatePreview(); }, store);

		const status = append(fields, $('.autogroup-status', { id: `${id}-status` }));
		const actions = append(element, $('.autogroup-actions'));
		const moveUp = this.createActionButton(actions, Codicon.arrowUp, localize('personalization.moveUpHover', "Move Up"), store, () => this.moveRule(rule.id, -1));
		const moveDown = this.createActionButton(actions, Codicon.arrowDown, localize('personalization.moveDownHover', "Move Down"), store, () => this.moveRule(rule.id, 1));
		const remove = this.createActionButton(actions, Codicon.trash, localize('personalization.deleteHover', "Delete"), store, () => this.removeRule(rule.id));

		const row: IRuleRow = { element, store, name, pattern, nameError, patternError, status, handle, moveUp, moveDown, remove, colors, icons, appearanceToggle, touchedName: false, touchedPattern: false };
		this.rows.set(rule.id, row);
		name.value = rule.name;
		pattern.value = rule.pattern;
		colors.select(rule.color);
		icons.select(rule.icon);
		updatePreview();

		for (const [input, key] of [[name, 'name'], [pattern, 'pattern']] as const) {
			store.add(addDisposableListener(input, EventType.INPUT, () => {
				this.model.update(rule.id, { [key]: input.value });
				this.updateAfterEdit(rule.id);
			}));
			store.add(addDisposableListener(input, EventType.CHANGE, () => {
				if (key === 'name') { row.touchedName = true; } else { row.touchedPattern = true; }
				this.updateAfterEdit(rule.id);
				this.commit();
			}));
		}

		// Only the handle starts a drag, so selecting text in the inputs keeps working
		store.add(addDisposableListener(handle, EventType.MOUSE_DOWN, () => { element.draggable = !this.disabled; }));
		store.add(addDisposableListener(handle, EventType.MOUSE_UP, () => { element.draggable = false; }));
		store.add(addDisposableListener(element, EventType.DRAG_START, event => {
			if (event.target !== element) { return; }
			this.draggedId = rule.id;
			element.classList.add('dragging');
			event.dataTransfer?.setData('text/plain', name.value);
			if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; }
		}));
		store.add(addDisposableListener(element, EventType.DRAG_END, () => this.endDrag()));

		this.list.appendChild(element);
		return row;
	}

	private createActionButton(parent: HTMLElement, icon: ThemeIcon, hover: string, store: DisposableStore, run: () => void): HTMLButtonElement {
		const button = append(parent, $('button.autogroup-action', { type: 'button' })) as HTMLButtonElement;
		store.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, hover));
		append(button, $('span', { 'aria-hidden': 'true' })).classList.add(...ThemeIcon.asClassNameArray(icon));
		store.add(addDisposableListener(button, EventType.CLICK, run));
		return button;
	}

	private disposeRows(): void {
		for (const row of this.rows.values()) {
			row.store.dispose();
			row.element.remove();
		}
		this.rows.clear();
	}

	/** Puts the rows in the order of the rules, and numbers them for the people who hear them. */
	private syncOrder(): void {
		const rules = this.model.rules;
		rules.forEach((rule, index) => {
			const row = this.rows.get(rule.id);
			if (!row) { return; }
			this.list.appendChild(row.element);
			row.element.setAttribute('aria-label', localize('personalization.ruleLabel', "Rule {0} of {1}", index + 1, rules.length));
			row.moveUp.setAttribute('aria-label', localize('personalization.ruleMoveUp', "Move Rule {0} Up", index + 1));
			row.moveDown.setAttribute('aria-label', localize('personalization.ruleMoveDown', "Move Rule {0} Down", index + 1));
			row.remove.setAttribute('aria-label', localize('personalization.ruleDelete', "Delete Rule {0}", index + 1));
			// The ends of the list have nowhere to move to
			row.moveUp.disabled = this.disabled || index === 0;
			row.moveDown.disabled = this.disabled || index === rules.length - 1;
		});
	}

	private updateLayout(): void {
		const empty = this.model.rules.length === 0;
		this.emptyState.hidden = !empty;
		this.list.hidden = empty;
		this.footer.hidden = empty;
		this.element.classList.toggle('disabled', this.disabled);
	}

	//#endregion

	//#region Editing

	private addRule(): void {
		if (this.disabled) { return; }
		const rule = this.model.add();
		const row = this.createRow(rule, true);
		this.syncOrder();
		this.updateLayout();
		this.updateAfterEdit(rule.id);
		row.name.focus();
		this.host.announce(localize('personalization.ruleAdded', "Rule {0} added. Enter a group name and a pattern.", this.model.rules.length));
	}

	private removeRule(id: number): void {
		const index = this.model.rules.findIndex(rule => rule.id === id);
		this.model.remove(id);
		const row = this.rows.get(id);
		row?.store.dispose();
		row?.element.remove();
		this.rows.delete(id);
		this.syncOrder();
		this.updateLayout();
		this.refreshMatches();
		const next = this.model.rules[Math.min(index, this.model.rules.length - 1)];
		(next ? this.rows.get(next.id)?.remove : this.addButtons[0])?.focus();
		this.host.announce(localize('personalization.ruleDeleted', "Rule {0} deleted.", index + 1));
		this.commit();
	}

	private moveRule(id: number, offset: -1 | 1): void {
		const before = this.model.rules.findIndex(rule => rule.id === id);
		const row = this.rows.get(id);
		this.model.move(id, offset);
		const after = this.model.rules.findIndex(rule => rule.id === id);
		if (!row || before === after) { return; }
		this.syncOrder();
		this.refreshMatches();
		// Moving a row in the page drops its focus. The button that was used keeps it, unless the rule is at the end of the list it moves towards.
		const atEnd = offset === -1 ? after === 0 : after === this.model.rules.length - 1;
		const [used, other] = offset === -1 ? [row.moveUp, row.moveDown] : [row.moveDown, row.moveUp];
		(atEnd ? other : used).focus();
		this.announceMoved(after);
		this.commit();
	}

	private announceMoved(index: number): void {
		this.host.announce(localize('personalization.ruleMoved', "Rule moved to position {0} of {1}.", index + 1, this.model.rules.length));
	}

	private edit(id: number, edit: { color?: string; icon?: string }): void {
		this.model.update(id, edit);
		this.commit();
	}

	private updateAfterEdit(id: number): void {
		const row = this.rows.get(id);
		const rule = this.model.rules.find(candidate => candidate.id === id);
		if (row && rule) {
			this.updateErrors(row, rule);
		}
		this.refreshMatches();
	}

	/** Points out what is wrong with a field once the user is done with it. */
	private updateErrors(row: IRuleRow, rule: IAutoGroupRuleDraft): void {
		const problems = this.model.validate(rule.id);
		const patternMessage = problems.pattern === AutoGroupPatternProblem.Empty ? localize('personalization.patternEmpty', "Enter a pattern, such as src/api/**.")
			: problems.pattern === AutoGroupPatternProblem.UnbalancedBrackets ? localize('personalization.patternBrackets', "Close every [ with a ].")
				: problems.pattern === AutoGroupPatternProblem.UnbalancedBraces ? localize('personalization.patternBraces', "Close every { with a }.")
					: '';
		const showName = problems.name && row.touchedName;
		const showPattern = !!problems.pattern && (row.touchedPattern || problems.pattern !== AutoGroupPatternProblem.Empty);
		row.nameError.textContent = showName ? localize('personalization.nameEmpty', "Enter a name for the tab group.") : '';
		row.patternError.textContent = showPattern ? patternMessage : '';
		for (const [input, shown] of [[row.name, showName], [row.pattern, showPattern]] as const) {
			if (shown) { input.setAttribute('aria-invalid', 'true'); } else { input.removeAttribute('aria-invalid'); }
		}
	}

	private updateStatus(row: IRuleRow, rule: IAutoGroupRuleDraft, matches: number): void {
		row.status.textContent = !this.model.isValid(rule.id) ? localize('personalization.ruleIncomplete', "Add a name and a pattern to save this rule.")
			: matches === 0 ? localize('personalization.ruleMatchesNone', "No open editors match yet.")
				: matches === 1 ? localize('personalization.ruleMatchesOne', "Matches 1 open editor.")
					: localize('personalization.ruleMatchesMany', "Matches {0} open editors.", matches);
		row.status.classList.toggle('matching', matches > 0 && this.model.isValid(rule.id));
	}

	/** Saves the rules once all of them are complete, so a rule that is still being filled in is never saved half way. */
	private commit(): void {
		if (this.disabled || !this.model.canSave) { return; }
		const rules = this.model.serialize();
		const json = JSON.stringify(rules);
		if (json !== this.committed) {
			this.committed = json;
			this.host.save(rules);
		}
	}

	//#endregion

	//#region Dragging

	private onDragOver(event: DragEvent): void {
		if (this.draggedId === undefined) { return; }
		EventHelper.stop(event);
		if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
		const target = this.getDropIndex(event.clientY);
		const dragged = this.model.rules.findIndex(candidate => candidate.id === this.draggedId);
		for (const [index, rule] of this.model.rules.entries()) {
			const row = this.rows.get(rule.id);
			row?.element.classList.toggle('drop-before', index === target && target <= dragged);
			row?.element.classList.toggle('drop-after', index === target && target > dragged);
		}
	}

	/** The place in the list a row dropped at this height would take. */
	private getDropIndex(clientY: number): number {
		const rules = this.model.rules;
		const hovered = rules.findIndex(rule => {
			const bounds = this.rows.get(rule.id)?.element.getBoundingClientRect();
			return !!bounds && clientY < bounds.top + bounds.height / 2;
		});
		const dragged = rules.findIndex(rule => rule.id === this.draggedId);
		const target = hovered < 0 ? rules.length - 1 : hovered;
		return hovered >= 0 && hovered > dragged ? hovered - 1 : target;
	}

	private onDrop(event: DragEvent): void {
		if (this.draggedId === undefined) { return; }
		EventHelper.stop(event);
		const id = this.draggedId;
		const before = this.model.rules.findIndex(rule => rule.id === id);
		const target = this.getDropIndex(event.clientY);
		this.endDrag();
		this.model.moveTo(id, target);
		if (before !== target) {
			this.syncOrder();
			this.refreshMatches();
			this.announceMoved(target);
			this.commit();
		}
	}

	private endDrag(): void {
		this.draggedId = undefined;
		for (const row of this.rows.values()) {
			row.element.draggable = false;
			row.element.classList.remove('dragging', 'drop-before', 'drop-after');
		}
	}

	//#endregion

	//#region Radio Groups

	/** A group of radios with one tab stop that follows the chosen one, and arrow keys that move focus and choose. */
	private createRadioGroup(parent: HTMLElement, label: string, className: string, options: readonly IRadioOption[], onChange: (value: string | undefined) => void, store: DisposableStore): IRadioGroup {
		const labelElement = append(parent, $('span.autogroup-field-label', { id: `${this.idPrefix}-label-${this.nextElementId++}` }, label));
		const element = append(parent, $(`.autogroup-radios.${className}`, { role: 'radiogroup', 'aria-labelledby': labelElement.id }));
		const buttons = options.map(option => {
			const button = append(element, $('button.autogroup-radio', { type: 'button', role: 'radio', 'aria-label': option.label })) as HTMLButtonElement;
			option.draw(button);
			store.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), button, option.label));
			return button;
		});
		let selected = 0;
		const select = (value: string | undefined) => {
			selected = Math.max(options.findIndex(option => option.value === value), 0);
			buttons.forEach((button, index) => {
				button.setAttribute('aria-checked', String(index === selected));
				button.tabIndex = index === selected ? 0 : -1;
			});
		};
		const choose = (index: number) => {
			select(options[index].value);
			onChange(options[index].value);
		};
		buttons.forEach((button, index) => store.add(addDisposableListener(button, EventType.CLICK, () => choose(index))));
		store.add(addDisposableListener(element, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			const index = isHTMLElement(event.target) ? buttons.indexOf(event.target as HTMLButtonElement) : -1;
			const next = index < 0 ? undefined : getRadioNavigationTarget(event.key, index, buttons.length, buttons.length);
			if (next !== undefined) {
				EventHelper.stop(event);
				choose(next);
				buttons[next].focus();
			}
		}));
		select(undefined);
		return { element, buttons, select };
	}

	//#endregion

	override dispose(): void {
		this.disposeRows();
		super.dispose();
	}
}
