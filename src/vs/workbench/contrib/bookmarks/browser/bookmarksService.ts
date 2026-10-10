/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Range } from '../../../../editor/common/core/range.js';
import { GlyphMarginLane, IModelDeltaDecoration, ITextModel, OverviewRulerLane, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { captureBookmarkAnchor, CONTEXT_CODE_BOOKMARKS_PRESENT, findBookmarkLine, ICodeBookmark, ICodeBookmarksService } from '../common/bookmarks.js';

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

interface ITrackedModel {
	readonly model: ITextModel;
	readonly disposables: DisposableStore;
	readonly syncScheduler: RunOnceScheduler;
	decorationIds: Map<string, string>;
}

export class CodeBookmarksService extends Disposable implements ICodeBookmarksService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeBookmarks = this._register(new Emitter<void>());
	readonly onDidChangeBookmarks = this._onDidChangeBookmarks.event;

	private _bookmarks: ICodeBookmark[];
	private readonly hasBookmarksContext: IContextKey<boolean>;
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
		this.hasBookmarksContext = CONTEXT_CODE_BOOKMARKS_PRESENT.bindTo(contextKeyService);
		this.hasBookmarksContext.set(this._bookmarks.length > 0);

		for (const model of this.modelService.getModels()) {
			this.trackModel(model);
		}
		this._register(this.modelService.onModelAdded(model => this.trackModel(model)));
		this._register(this.modelService.onModelRemoved(model => this.untrackModel(model)));
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
		this.syncTrackedModel(resource);
		const existing = this.find(resource, lineNumber);
		if (existing) {
			this.remove(existing.id);
			return undefined;
		}

		const model = this.modelService.getModel(resource);
		const safeLineNumber = model ? Math.max(1, Math.min(model.getLineCount(), lineNumber)) : Math.max(1, lineNumber);
		const anchor = model ? captureBookmarkAnchor(model.getLinesContent(), safeLineNumber) : { lineText: '', beforeText: '', afterText: '' };
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

	find(resource: URI, lineNumber: number): ICodeBookmark | undefined {
		return this._bookmarks.find(bookmark => this.uriIdentityService.extUri.isEqual(bookmark.resource, resource) && bookmark.lineNumber === lineNumber);
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
			decorationIds: new Map()
		};
		disposables.add(model.onDidChangeContent(() => entry.syncScheduler.schedule()));
		this.trackedModels.set(key, entry);
		this.refreshModel(entry);
	}

	private untrackModel(model: ITextModel): void {
		const key = model.uri.toString();
		const entry = this.trackedModels.get(key);
		if (!entry) {
			return;
		}
		this.syncModel(entry, false);
		entry.disposables.dispose();
		this.trackedModels.delete(key);
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

	private refreshModel(entry: ITrackedModel): void {
		const lines = entry.model.getLinesContent();
		const bookmarks = this._bookmarks.filter(bookmark => this.uriIdentityService.extUri.isEqual(bookmark.resource, entry.model.uri));
		let didChange = false;
		const resolved: ICodeBookmark[] = [];

		this._bookmarks = this._bookmarks.map(bookmark => {
			if (!bookmarks.includes(bookmark)) {
				return bookmark;
			}
			const lineNumber = findBookmarkLine(lines, bookmark.lineNumber, bookmark);
			if (!lineNumber) {
				if (!bookmark.stale) {
					didChange = true;
					return { ...bookmark, stale: true };
				}
				return bookmark;
			}
			const anchor = captureBookmarkAnchor(lines, lineNumber);
			const updated = { ...bookmark, ...anchor, lineNumber, stale: false };
			resolved.push(updated);
			if (bookmark.lineNumber !== lineNumber || bookmark.stale || bookmark.lineText !== anchor.lineText || bookmark.beforeText !== anchor.beforeText || bookmark.afterText !== anchor.afterText) {
				didChange = true;
			}
			return updated;
		});

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
		const decorationIds = entry.model.deltaDecorations([...entry.decorationIds.values()], decorations);
		entry.decorationIds = new Map(resolved.map((bookmark, index) => [bookmark.id, decorationIds[index]]));

		if (didChange) {
			this.fireChanged();
		}
	}

	private syncModel(entry: ITrackedModel, fire: boolean): void {
		if (entry.decorationIds.size === 0) {
			return;
		}
		const lines = entry.model.getLinesContent();
		let didChange = false;
		this._bookmarks = this._bookmarks.map(bookmark => {
			const decorationId = entry.decorationIds.get(bookmark.id);
			if (!decorationId) {
				return bookmark;
			}
			const range = entry.model.getDecorationRange(decorationId);
			if (!range) {
				return bookmark;
			}
			const lineNumber = range.startLineNumber;
			const anchor = captureBookmarkAnchor(lines, lineNumber);
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
			this.fireChanged();
		}
	}

	private handleDelete(resource: URI): void {
		let didChange = false;
		this._bookmarks = this._bookmarks.map(bookmark => {
			if (!this.uriIdentityService.extUri.isEqualOrParent(bookmark.resource, resource) || bookmark.stale) {
				return bookmark;
			}
			didChange = true;
			return { ...bookmark, stale: true };
		});
		if (didChange) {
			this.fireChanged();
		}
	}

	private changed(resource: URI): void {
		this.refreshTrackedModel(resource);
		this.fireChanged();
	}

	private fireChanged(): void {
		this.hasBookmarksContext.set(this._bookmarks.length > 0);
		this.storeScheduler.schedule();
		this._onDidChangeBookmarks.fire();
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
