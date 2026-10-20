/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMatch } from '../../../../base/common/filters.js';

/** A tab that the quick filter of the vertical tabs looks at. */
export interface IVerticalTabsFilterTab {

	/** The text of the label of the tab, i.e. the name of the file. */
	readonly name: string;

	/** The path shown next to the label, i.e. the folder of the file. */
	readonly description?: string;

	/** The tab group that the tab belongs to. */
	readonly tabGroupId?: string;
}

/** A tab group that the quick filter of the vertical tabs looks at. */
export interface IVerticalTabsFilterTabGroup {
	readonly id: string;
	readonly name: string;
}

/** The parts of a label that match the query, to highlight. */
export interface IVerticalTabsFilterMatches {
	readonly name: readonly IMatch[];
	readonly description: readonly IMatch[];
}

/** What stays in the list of the vertical tabs while it is filtered. */
export interface IVerticalTabsFilterResult {

	/**
	 * The tabs that stay in the list, by their position in the tabs that were filtered, with
	 * the parts of their label and path that match. A tab that stays because its tab group
	 * matches by name has no matches of its own.
	 */
	readonly tabs: ReadonlyMap<number, IVerticalTabsFilterMatches>;

	/**
	 * The tab groups that stay in the list, with the parts of their name that match. A tab
	 * group stays when its name matches or when any of its tabs stays.
	 */
	readonly tabGroups: ReadonlyMap<string, readonly IMatch[]>;
}

/**
 * Splits a query into the terms that all have to match. Terms are separated by whitespace and
 * compared without regard to case or to the kind of slash in paths.
 */
export function parseVerticalTabsFilterQuery(query: string): string[] {
	return normalize(query.trim()).split(/\s+/).filter(term => term.length > 0);
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/\\/g, '/'); // a replaced slash keeps the length, so positions still fit the original text
}

/** Whether every term occurs in at least one of the texts. */
function hasEveryTerm(terms: readonly string[], ...texts: (string | undefined)[]): boolean {
	const haystacks = texts.filter((text): text is string => text !== undefined).map(normalize);
	return terms.every(term => haystacks.some(haystack => haystack.includes(term)));
}

/** Every range of the text that a term occurs in, in order and without overlaps. */
function findOccurrences(terms: readonly string[], text: string | undefined): IMatch[] {
	const haystack = normalize(text ?? '');
	const occurrences: IMatch[] = [];
	for (const term of terms) {
		for (let start = haystack.indexOf(term); start !== -1; start = haystack.indexOf(term, start + term.length)) {
			occurrences.push({ start, end: start + term.length });
		}
	}

	occurrences.sort((a, b) => a.start - b.start || a.end - b.end);

	const merged: IMatch[] = [];
	for (const occurrence of occurrences) {
		const previous = merged.at(-1);
		if (previous && occurrence.start <= previous.end) {
			merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, occurrence.end) };
		} else {
			merged.push(occurrence);
		}
	}

	return merged;
}

/**
 * Filters the tabs of the vertical tab list with a quick filter query. A tab stays when every
 * term of the query occurs in its name or in its path. A tab group stays when every term occurs
 * in its name, in which case all of its tabs stay as well, or when any of its tabs stays.
 *
 * @returns what stays in the list, or `undefined` when the query is empty and nothing is filtered
 */
export function filterVerticalTabs(query: string, tabs: readonly IVerticalTabsFilterTab[], tabGroups: readonly IVerticalTabsFilterTabGroup[]): IVerticalTabsFilterResult | undefined {
	const terms = parseVerticalTabsFilterQuery(query);
	if (terms.length === 0) {
		return undefined;
	}

	const matchedTabGroups = new Map<string, readonly IMatch[]>();
	for (const tabGroup of tabGroups) {
		if (hasEveryTerm(terms, tabGroup.name)) {
			matchedTabGroups.set(tabGroup.id, findOccurrences(terms, tabGroup.name));
		}
	}

	const listedTabs = new Map<number, IVerticalTabsFilterMatches>();
	const listedTabGroups = new Map<string, readonly IMatch[]>();
	tabs.forEach((tab, index) => {
		const matchesItself = hasEveryTerm(terms, tab.name, tab.description);
		const matchesByTabGroup = tab.tabGroupId !== undefined && matchedTabGroups.has(tab.tabGroupId);
		if (!matchesItself && !matchesByTabGroup) {
			return;
		}

		listedTabs.set(index, matchesItself ? { name: findOccurrences(terms, tab.name), description: findOccurrences(terms, tab.description) } : { name: [], description: [] });
		if (tab.tabGroupId !== undefined) {
			listedTabGroups.set(tab.tabGroupId, matchedTabGroups.get(tab.tabGroupId) ?? []);
		}
	});

	for (const [id, matches] of matchedTabGroups) {
		listedTabGroups.set(id, matches);
	}

	return { tabs: listedTabs, tabGroups: listedTabGroups };
}
