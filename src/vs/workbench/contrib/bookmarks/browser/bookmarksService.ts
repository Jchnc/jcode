/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Range } from '../../../../editor/common/core/range.js';
import { GlyphMarginLane, IModelDeltaDecoration, ITextModel, OverviewRulerLane, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { CONTEXT_CODE_BOOKMARKS_PRESENT, CONTEXT_CODE_BOOKMARKS_STALE_PRESENT, findBookmarkLine, ICodeBookmark, ICodeBookmarkAnchor, ICodeBookmarksService, isBookmarkLineRemoved, mergeDuplicateBookmarks } from '../common/bookmarks.js';

const STORAGE_KEY = 'jcode.codeBookmarks';

registerColor('editorBookmark.foreground', { dark: '#f2c94c', light: '#8a5a00', hcDark: '#f2c94c', hcLight: '#6b4400' }, localize('bookmarkForeground', "Color of bookmark markers in the editor gutter."));
const bookmarkOverviewRuler = registerColor('editorOverviewRuler.bookmarkForeground', { dark: '#f2c94ccc', light: '#8a5a00cc', hcDark: '#f2c94c', hcLight: '#6b4400' }, localize('bookmarkOverviewRuler', "Color of bookmark markers in the editor overview ruler."));

interface IStoredBookmark {
	readonly id: string;
	readonly resource: string;
	readonly lineNumber: number;
	readonly column: number;
	readonly note?: string;
	readonly lineText: string;
	readonly beforeText: string;
	readonly afterText: string;
	readonly stale: boolean;
	readonly createdAt: number;
}

/**
 * Where a bookmark currently is in an open model, as last seen after an edit.
 */
interface ITrackedBookmark {
	readonly decorationId: string;
	readonly lineNumber: number;
	readonly maxColumn: number;
	readonly anchor: ICodeBookmarkAnchor;
}

interface ITrackedModel {
	readonly model: ITextModel;
	readonly disposables: DisposableStore;
	readonly syncScheduler: RunOnceScheduler;
	bookmarks: Map<string, ITrackedBookmark>;
}

function captureModelAnchor(model: ITextModel, lineNumber: number): ICodeBookmarkAnchor {
	return {
		lineText: model.getLineContent(lineNumber),
		beforeText: lineNumber > 1 ? model.getLineContent(lineNumber - 1) : '',
		afterText: lineNumber < model.getLineCount() ? model.getLineContent(lineNumber + 1) : ''
	};
}

export class CodeBookmarksService extends Disposable implements ICodeBookmarksService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeBookmarks = this._register(new Emitter<void>());
	readonly onDidChangeBookmarks = this._onDidChangeBookmarks.event;

	private _bookmarks: ICodeBookmark[];
	private readonly hasBookmarksContext: IContextKey<boolean>;
	private readonly hasStaleBookmarksContext: IContextKey<boolean>;
	private readonly trackedModels = new Map<string, ITrackedModel>();
	private readonly storeScheduler = this._register(new RunOnceScheduler(() => this.store(), 300));

	get bookmarks(): readonly ICodeBookmark[] {
		return this._bookmarks;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IModelService private readonly modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._bookmarks = this.restore();
		this.mergeDuplicates();
		this.hasBookmarksContext = CONTEXT_CODE_BOOKMARKS_PRESENT.bindTo(contextKeyService);
		this.hasStaleBookmarksContext = CONTEXT_CODE_BOOKMARKS_STALE_PRESENT.bindTo(contextKeyService);
		this.updateContextKeys();

		for (const model of this.modelService.getModels()) {
			this.trackModel(model);
		}
		this._register(this.modelService.onModelAdded(model => this.trackModel(model)));
		this._register(this.modelService.onModelRemoved(model => this.untrackModel(model)));
		this._register(toDisposable(() => {
			for (const entry of this.trackedModels.values()) {
				this.clearDecorations(entry);
				entry.disposables.dispose();
			}
			this.trackedModels.clear();
		}));
		this._register(this.storageService.onWillSaveState(() => this.store()));
		this._register(this.fileService.onDidRunOperation(event => {
			if (event.isOperation(FileOperation.MOVE)) {
				this.handleMove(event.resource, event.target.resource);
			} else if (event.isOperation(FileOperation.DELETE)) {
				this.handleDelete(event.resource);
			}
		}));
	}

	toggle(resource: URI, lineNumber: number, column = 1): ICodeBookmark | undefined {
		const model = this.modelService.getModel(resource);
		const safeLineNumber = model ? Math.max(1, Math.min(model.getLineCount(), lineNumber)) : Math.max(1, lineNumber);
		const existing = this.bookmarksOnLine(resource, safeLineNumber);
		if (existing.length > 0) {
			const ids = new Set(existing.map(bookmark => bookmark.id));
			this._bookmarks = this._bookmarks.filter(bookmark => !ids.has(bookmark.id));
			this.changed(resource);
			return undefined;
		}

		const anchor = model ? captureModelAnchor(model, safeLineNumber) : { lineText: '', beforeText: '', afterText: '' };
		const bookmark: ICodeBookmark = {
			id: generateUuid(),
			resource,
			lineNumber: safeLineNumber,
			column: Math.max(1, column),
			...anchor,
			stale: false,
			createdAt: Date.now()
		};
		this._bookmarks = [...this._bookmarks, bookmark];
		this.changed(resource);
		return bookmark;
	}

	updateNote(id: string, note: string | undefined): void {
		const normalized = note?.trim() || undefined;
		let resource: URI | undefined;
		this._bookmarks = this._bookmarks.map(bookmark => {
			if (bookmark.id !== id || bookmark.note === normalized) {
				return bookmark;
			}
			resource = bookmark.resource;
			return { ...bookmark, note: normalized };
		});
		if (resource) {
			this.changed(resource);
		}
	}

	remove(id: string): void {
		const bookmark = this._bookmarks.find(candidate => candidate.id === id);
		if (!bookmark) {
			return;
		}
		this._bookmarks = this._bookmarks.filter(candidate => candidate.id !== id);
		this.changed(bookmark.resource);
	}

	removeAll(): void {
		if (this._bookmarks.length === 0) {
			return;
		}
		const resources = this._bookmarks.map(bookmark => bookmark.resource);
		this._bookmarks = [];
		for (const resource of resources) {
			this.refreshTrackedModel(resource);
		}
		this.fireChanged();
	}

	removeStale(): void {
		if (!this._bookmarks.some(bookmark => bookmark.stale)) {
			return;
		}
		// Stale bookmarks have no decoration, so there is nothing to refresh in the editors.
		this._bookmarks = this._bookmarks.filter(bookmark => !bookmark.stale);
		this.fireChanged();
	}

	relocate(id: string, resource: URI, lineNumber: number, column = 1): ICodeBookmark | undefined {
		const bookmark = this._bookmarks.find(candidate => candidate.id === id);
		if (!bookmark) {
			return undefined;
		}

		this.syncTrackedModel(resource);
		const model = this.modelService.getModel(resource);
		const safeLineNumber = model ? Math.max(1, Math.min(model.getLineCount(), lineNumber)) : Math.max(1, lineNumber);
		const previousResource = bookmark.resource;

		const anchor = model ? captureModelAnchor(model, safeLineNumber) : { lineText: bookmark.lineText, beforeText: bookmark.beforeText, afterText: bookmark.afterText };
		this._bookmarks = this._bookmarks.map(candidate => candidate.id === bookmark.id ? { ...bookmark, resource, lineNumber: safeLineNumber, column: Math.max(1, column), ...anchor, stale: false } : candidate);
		if (!this.uriIdentityService.extUri.isEqual(previousResource, resource)) {
			this.refreshTrackedModel(previousResource);
		}
		// When the line already has a bookmark, the two are merged into one.
		this.changed(resource);
		return this.find(resource, safeLineNumber);
	}

	find(resource: URI, lineNumber: number): ICodeBookmark | undefined {
		return this.bookmarksOnLine(resource, lineNumber)[0];
	}

	private bookmarksOnLine(resource: URI, lineNumber: number): ICodeBookmark[] {
		this.syncTrackedModel(resource);
		return this._bookmarks.filter(bookmark => !bookmark.stale && bookmark.lineNumber === lineNumber && this.uriIdentityService.extUri.isEqual(bookmark.resource, resource));
	}

	private trackModel(model: ITextModel): void {
		const key = model.uri.toString();
		if (this.trackedModels.has(key)) {
			return;
		}

		const disposables = new DisposableStore();
		const entry: ITrackedModel = {
			model,
			disposables,
			syncScheduler: disposables.add(new RunOnceScheduler(() => this.syncModel(entry, true), 150)),
			bookmarks: new Map()
		};
		disposables.add(model.onDidChangeContent(event => this.onDidChangeModelContent(entry, event)));
		this.trackedModels.set(key, entry);
		this.refreshModel(entry);
	}

	private untrackModel(model: ITextModel): void {
		const key = model.uri.toString();
		const entry = this.trackedModels.get(key);
		if (!entry) {
			return;
		}
		this.syncModel(entry, true);
		entry.disposables.dispose();
		this.trackedModels.delete(key);
	}

	private clearDecorations(entry: ITrackedModel): void {
		if (entry.bookmarks.size > 0 && !entry.model.isDisposed()) {
			entry.model.deltaDecorations([...entry.bookmarks.values()].map(tracked => tracked.decorationId), []);
		}
		entry.bookmarks.clear();
	}

	private refreshTrackedModel(resource: URI): void {
		const entry = this.getTrackedModel(resource);
		if (entry) {
			this.refreshModel(entry);
		}
	}

	private syncTrackedModel(resource: URI): void {
		const entry = this.getTrackedModel(resource);
		if (entry) {
			this.syncModel(entry, false);
		}
	}

	private getTrackedModel(resource: URI): ITrackedModel | undefined {
		return [...this.trackedModels.values()].find(entry => this.uriIdentityService.extUri.isEqual(entry.model.uri, resource));
	}

	private onDidChangeModelContent(entry: ITrackedModel, event: IModelContentChangedEvent): void {
		if (event.isFlush) {
			// The model was reset and every decoration is gone, so find each bookmark again from its anchor.
			entry.bookmarks.clear();
			entry.syncScheduler.cancel();
			this.refreshModel(entry);
			return;
		}

		const removed = new Set<string>();
		for (const [id, tracked] of entry.bookmarks) {
			if (event.changes.some(change => isBookmarkLineRemoved(change, tracked.lineNumber, tracked.maxColumn))) {
				removed.add(id);
			}
		}
		this.markStale(removed);
		this.captureTrackedBookmarks(entry);

		if (this.hasBookmarksSharingLine(entry)) {
			// Joining lines moved bookmarks onto the same line, so merge them right away.
			this.syncModel(entry, false);
			this.changed(entry.model.uri);
		} else if (event.isUndoing && this._bookmarks.some(bookmark => bookmark.stale && this.uriIdentityService.extUri.isEqual(bookmark.resource, entry.model.uri))) {
			// Undoing a deletion brings the line back, so let confidently matching stale bookmarks return to it.
			this.refreshModel(entry);
		}
		entry.syncScheduler.schedule();
	}

	private hasBookmarksSharingLine(entry: ITrackedModel): boolean {
		const lineNumbers = new Set<number>();
		for (const tracked of entry.bookmarks.values()) {
			if (lineNumbers.has(tracked.lineNumber)) {
				return true;
			}
			lineNumbers.add(tracked.lineNumber);
		}
		return false;
	}

	/**
	 * Records where each bookmark of the model is right now. Edits are described in the
	 * coordinates of the text before the edit, so this has to happen after every edit.
	 */
	private captureTrackedBookmarks(entry: ITrackedModel): void {
		for (const [id, tracked] of entry.bookmarks) {
			const range = entry.model.getDecorationRange(tracked.decorationId);
			if (!range) {
				continue;
			}
			const lineNumber = range.startLineNumber;
			entry.bookmarks.set(id, {
				decorationId: tracked.decorationId,
				lineNumber,
				maxColumn: entry.model.getLineMaxColumn(lineNumber),
				anchor: captureModelAnchor(entry.model, lineNumber)
			});
		}
	}

	/**
	 * Marks bookmarks as stale and removes their gutter decoration, keeping the last known line and text.
	 */
	private markStale(ids: ReadonlySet<string>): void {
		if (ids.size === 0) {
			return;
		}

		const lastKnown = new Map<string, ITrackedBookmark>();
		for (const entry of this.trackedModels.values()) {
			const decorationIds: string[] = [];
			for (const [id, tracked] of entry.bookmarks) {
				if (ids.has(id)) {
					lastKnown.set(id, tracked);
					decorationIds.push(tracked.decorationId);
					entry.bookmarks.delete(id);
				}
			}
			if (decorationIds.length > 0) {
				entry.model.deltaDecorations(decorationIds, []);
			}
		}

		let didChange = false;
		this._bookmarks = this._bookmarks.map(bookmark => {
			if (!ids.has(bookmark.id) || bookmark.stale) {
				return bookmark;
			}
			didChange = true;
			const tracked = lastKnown.get(bookmark.id);
			return { ...bookmark, ...tracked?.anchor, lineNumber: tracked?.lineNumber ?? bookmark.lineNumber, stale: true };
		});
		if (didChange) {
			this.fireChanged();
		}
	}

	private refreshModel(entry: ITrackedModel): void {
		const model = entry.model;
		let lines: string[] | undefined;
		let didChange = false;
		const resolvedIds = new Set<string>();

		this._bookmarks = this._bookmarks.map(bookmark => {
			if (!this.uriIdentityService.extUri.isEqual(bookmark.resource, model.uri)) {
				return bookmark;
			}

			// A live bookmark with a decoration is exactly where the decoration is. Anything else is
			// searched for by its anchor, and a stale bookmark only returns when its surroundings match too.
			let lineNumber = bookmark.stale ? undefined : entry.bookmarks.get(bookmark.id)?.lineNumber;
			if (lineNumber === undefined) {
				lines ??= model.getLinesContent();
				lineNumber = findBookmarkLine(lines, bookmark.lineNumber, bookmark, bookmark.stale);
			}
			if (!lineNumber) {
				if (!bookmark.stale) {
					didChange = true;
					return { ...bookmark, stale: true };
				}
				return bookmark;
			}

			const anchor = captureModelAnchor(model, lineNumber);
			const updated = { ...bookmark, ...anchor, lineNumber, stale: false };
			resolvedIds.add(updated.id);
			if (bookmark.lineNumber !== lineNumber || bookmark.stale || bookmark.lineText !== anchor.lineText || bookmark.beforeText !== anchor.beforeText || bookmark.afterText !== anchor.afterText) {
				didChange = true;
			}
			return updated;
		});

		// Bookmarks found again on the same line are merged.
		if (this.mergeDuplicates().length > 0) {
			didChange = true;
		}
		const resolved = this._bookmarks.filter(bookmark => resolvedIds.has(bookmark.id));

		const decorations: IModelDeltaDecoration[] = resolved.map(bookmark => ({
			range: new Range(bookmark.lineNumber, 1, bookmark.lineNumber, 1),
			options: {
				description: 'jcode-code-bookmark',
				glyphMarginClassName: `${ThemeIcon.asClassName(Codicon.bookmark)} jcode-bookmark-glyph`,
				glyphMargin: { position: GlyphMarginLane.Center },
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				hoverMessage: new MarkdownString(bookmark.note || localize('bookmarkHover', "Bookmark at line {0}", bookmark.lineNumber)),
				overviewRuler: { color: themeColorFromId(bookmarkOverviewRuler), position: OverviewRulerLane.Center }
			}
		}));
		const decorationIds = model.deltaDecorations([...entry.bookmarks.values()].map(tracked => tracked.decorationId), decorations);
		entry.bookmarks = new Map(resolved.map((bookmark, index) => [bookmark.id, {
			decorationId: decorationIds[index],
			lineNumber: bookmark.lineNumber,
			maxColumn: model.getLineMaxColumn(bookmark.lineNumber),
			anchor: { lineText: bookmark.lineText, beforeText: bookmark.beforeText, afterText: bookmark.afterText }
		}]));

		if (didChange) {
			this.fireChanged();
		}
	}

	private syncModel(entry: ITrackedModel, fire: boolean): void {
		if (entry.bookmarks.size === 0) {
			return;
		}
		let didChange = false;
		this._bookmarks = this._bookmarks.map(bookmark => {
			const tracked = entry.bookmarks.get(bookmark.id);
			if (!tracked) {
				return bookmark;
			}
			const { anchor, lineNumber } = tracked;
			if (bookmark.lineNumber === lineNumber && bookmark.lineText === anchor.lineText && bookmark.beforeText === anchor.beforeText && bookmark.afterText === anchor.afterText) {
				return bookmark;
			}
			didChange = true;
			return { ...bookmark, ...anchor, lineNumber, stale: false };
		});
		if (didChange) {
			this.storeScheduler.schedule();
			if (fire) {
				this._onDidChangeBookmarks.fire();
			}
		}
	}

	private handleMove(source: URI, target: URI): void {
		let didChange = false;
		this._bookmarks = this._bookmarks.map(bookmark => {
			if (!this.uriIdentityService.extUri.isEqualOrParent(bookmark.resource, source)) {
				return bookmark;
			}
			const relativePath = this.uriIdentityService.extUri.relativePath(source, bookmark.resource);
			didChange = true;
			return { ...bookmark, resource: relativePath ? this.uriIdentityService.extUri.joinPath(target, relativePath) : target };
		});
		if (didChange) {
			this.mergeDuplicates();
			this.fireChanged();
		}
	}

	private handleDelete(resource: URI): void {
		this.markStale(new Set(this._bookmarks
			.filter(bookmark => !bookmark.stale && this.uriIdentityService.extUri.isEqualOrParent(bookmark.resource, resource))
			.map(bookmark => bookmark.id)));
	}

	private changed(resource: URI): void {
		const merged = this.mergeDuplicates();
		this.refreshTrackedModel(resource);
		for (const mergedResource of merged) {
			if (!this.uriIdentityService.extUri.isEqual(mergedResource, resource)) {
				this.refreshTrackedModel(mergedResource);
			}
		}
		this.fireChanged();
	}

	/**
	 * Makes sure there is only one bookmark per line.
	 *
	 * @returns The resources that lost a bookmark, whose decorations have to be refreshed.
	 */
	private mergeDuplicates(): URI[] {
		const merged = mergeDuplicateBookmarks(this._bookmarks, resource => this.uriIdentityService.extUri.getComparisonKey(resource));
		if (merged === this._bookmarks) {
			return [];
		}
		const keptIds = new Set(merged.map(bookmark => bookmark.id));
		const resources = this._bookmarks.filter(bookmark => !keptIds.has(bookmark.id)).map(bookmark => bookmark.resource);
		this._bookmarks = [...merged];
		return resources;
	}

	private fireChanged(): void {
		this.updateContextKeys();
		this.storeScheduler.schedule();
		this._onDidChangeBookmarks.fire();
	}

	private updateContextKeys(): void {
		this.hasBookmarksContext.set(this._bookmarks.length > 0);
		this.hasStaleBookmarksContext.set(this._bookmarks.some(bookmark => bookmark.stale));
	}

	private restore(): ICodeBookmark[] {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return [];
		}
		try {
			const stored = JSON.parse(raw) as IStoredBookmark[];
			return stored.filter(bookmark => bookmark.id && bookmark.resource && bookmark.lineNumber > 0).map(bookmark => ({ ...bookmark, resource: URI.parse(bookmark.resource) }));
		} catch {
			return [];
		}
	}

	private store(): void {
		const stored: IStoredBookmark[] = this._bookmarks.map(bookmark => ({ ...bookmark, resource: bookmark.resource.toString() }));
		this.storageService.store(STORAGE_KEY, JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
}
