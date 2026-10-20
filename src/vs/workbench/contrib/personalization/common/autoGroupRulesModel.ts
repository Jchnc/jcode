/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findTabAutoGroupRule, ITabAutoGroupResource, ITabAutoGroupRule, parseTabAutoGroupRules } from '../../tabGroups/common/tabAutoGroupRules.js';

/** A rule as it is edited, which can be incomplete until its name and pattern are filled in. */
export interface IAutoGroupRuleDraft {

	/** Tells a rule apart from the others as they are added, removed and moved. */
	readonly id: number;
	readonly name: string;
	readonly pattern: string;
	readonly color?: string;
	readonly icon?: string;
}

/** What the user can change about a rule. */
export type AutoGroupRuleEdit = Partial<Pick<IAutoGroupRuleDraft, 'name' | 'pattern' | 'color' | 'icon'>>;

/** Why a pattern can not be saved. */
export const enum AutoGroupPatternProblem {
	Empty = 'empty',
	UnbalancedBrackets = 'unbalancedBrackets',
	UnbalancedBraces = 'unbalancedBraces'
}

export interface IAutoGroupRuleProblems {
	readonly name: boolean;
	readonly pattern: AutoGroupPatternProblem | undefined;
}

/** Finds what is wrong with a glob pattern, if anything. */
export function validateAutoGroupPattern(pattern: string): AutoGroupPatternProblem | undefined {
	const text = pattern.trim();
	if (!text) {
		return AutoGroupPatternProblem.Empty;
	}

	let brackets = 0;
	let braces = 0;
	for (let index = 0; index < text.length; index++) {
		switch (text[index]) {
			case '[': brackets++; break;
			case ']': brackets--; break;
			case '{': braces++; break;
			case '}': braces--; break;
		}
		if (brackets < 0) {
			return AutoGroupPatternProblem.UnbalancedBrackets;
		}
		if (braces < 0) {
			return AutoGroupPatternProblem.UnbalancedBraces;
		}
	}

	if (brackets !== 0) {
		return AutoGroupPatternProblem.UnbalancedBrackets;
	}

	return braces !== 0 ? AutoGroupPatternProblem.UnbalancedBraces : undefined;
}

function toRule({ name, pattern, color, icon }: IAutoGroupRuleDraft): ITabAutoGroupRule {
	return { name: name.trim(), pattern: pattern.trim(), ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
}

/**
 * The list of auto-grouping rules while it is edited: the rules in the order they apply in,
 * which can be added to, removed from, reordered and checked before they are saved.
 */
export class AutoGroupRulesModel {

	private nextId = 0;
	private items: IAutoGroupRuleDraft[] = [];

	/** Reads the rules of the setting, which is not trusted: rules that are not complete are left out. */
	constructor(value?: unknown) {
		this.reset(value);
	}

	get rules(): readonly IAutoGroupRuleDraft[] {
		return this.items;
	}

	/** Replaces all rules with the ones of the setting. */
	reset(value: unknown): void {
		this.items = parseTabAutoGroupRules(value).map(rule => ({ ...rule, id: this.nextId++ }));
	}

	/** Adds an empty rule at the end of the list and returns it. */
	add(): IAutoGroupRuleDraft {
		const rule: IAutoGroupRuleDraft = { id: this.nextId++, name: '', pattern: '' };
		this.items = [...this.items, rule];
		return rule;
	}

	remove(id: number): void {
		this.items = this.items.filter(rule => rule.id !== id);
	}

	update(id: number, edit: AutoGroupRuleEdit): void {
		this.items = this.items.map(rule => rule.id === id ? { ...rule, ...edit } : rule);
	}

	/** Moves a rule up (negative) or down (positive) by a number of places, and stops at the ends of the list. */
	move(id: number, offset: number): void {
		const index = this.items.findIndex(rule => rule.id === id);
		if (index >= 0) {
			this.moveTo(id, index + offset);
		}
	}

	/** Moves a rule to a place in the list, which is kept within the list. */
	moveTo(id: number, target: number): void {
		const index = this.items.findIndex(rule => rule.id === id);
		if (index < 0) {
			return;
		}

		const destination = Math.max(0, Math.min(this.items.length - 1, target));
		if (destination === index) {
			return;
		}

		const items = [...this.items];
		const [rule] = items.splice(index, 1);
		items.splice(destination, 0, rule);
		this.items = items;
	}

	/** What keeps a rule from being saved. */
	validate(id: number): IAutoGroupRuleProblems {
		const rule = this.items.find(candidate => candidate.id === id);
		return {
			name: !rule?.name.trim(),
			pattern: validateAutoGroupPattern(rule?.pattern ?? '')
		};
	}

	isValid(id: number): boolean {
		const problems = this.validate(id);
		return !problems.name && !problems.pattern;
	}

	/** Whether every rule can be saved. */
	get canSave(): boolean {
		return this.items.every(rule => this.isValid(rule.id));
	}

	/** The rules as the setting stores them: trimmed, without the details that are not set. */
	serialize(): ITabAutoGroupRule[] {
		return this.items.map(toRule);
	}

	/**
	 * How many of the files each rule applies to. A file belongs to the first rule that matches it, as
	 * when it is opened, so a rule that comes after one with a pattern that covers the same files gets none.
	 * Rules that can not be saved match nothing.
	 */
	countMatches(resources: readonly ITabAutoGroupResource[]): ReadonlyMap<number, number> {
		const valid = this.items.filter(rule => this.isValid(rule.id));
		const rules = valid.map(toRule);
		const counts = new Map<number, number>(this.items.map(rule => [rule.id, 0]));
		for (const resource of resources) {
			const rule = findTabAutoGroupRule(rules, resource);
			const owner = rule ? valid[rules.indexOf(rule)] : undefined;
			if (owner) {
				counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
			}
		}

		return counts;
	}
}
