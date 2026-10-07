/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import picomatch from 'picomatch';
import { utils, type FileEntryWithStats, type SFTPWrapper, type Stats } from 'ssh2';
import { EventEmitter, FileChangeType, FileSystemError, FileSystemProvider, FileStat, FileType, l10n, Uri, workspace, type Disposable, type FileChangeEvent, type LogOutputChannel } from 'vscode';
import { SftpConnections } from './connection';

interface SnapshotEntry {
	type: FileType;
	mtime: number;
	size: number;
}

function fileType(stat: Stats): FileType {
	return stat.isDirectory() ? FileType.Directory : stat.isSymbolicLink() ? FileType.SymbolicLink : FileType.File;
}

function fileStat(stat: Stats, type = fileType(stat)): FileStat {
	return { type, ctime: stat.mtime * 1000, mtime: stat.mtime * 1000, size: stat.size };
}

function asFileSystemError(error: Error): Error {
	const code = String((error as NodeJS.ErrnoException).code);
	if (code === 'ENOENT' || code === '2') {
		return FileSystemError.FileNotFound(error.message);
	}
	if (code === 'EACCES' || code === 'EPERM' || code === '3') {
		return FileSystemError.NoPermissions(error.message);
	}
	if (code === 'EEXIST' || code === '11') {
		return FileSystemError.FileExists(error.message);
	}
	return error;
}

function operation<T>(invoke: (callback: (error: Error | null | undefined, result: T) => void) => void): Promise<T> {
	return new Promise<T>((resolve, reject) => invoke((error, result) => error ? reject(asFileSystemError(error)) : resolve(result)));
}

/** Identifies transport failures without retrying permission or file errors. */
function isConnectionError(error: Error): boolean {
	const code = String((error as NodeJS.ErrnoException).code);
	return code === String(utils.sftp.STATUS_CODE.NO_CONNECTION) || code === String(utils.sftp.STATUS_CODE.CONNECTION_LOST) ||
		/^(?:ECONN|EPIPE|ETIMEDOUT)/.test(code) ||
		/not connected|connection lost|connection (?:closed|ended)|no response from server|channel (?:is not open|closed)|socket (?:closed|ended)/i.test(error.message);
}

/** Resolves link targets, retaining link metadata for missing or inaccessible directory entries. */
async function resolveStat(sftp: SFTPWrapper, path: string, attrs?: Stats): Promise<{ stat: Stats; type: FileType }> {
	const stat = attrs ?? await operation<Stats>(callback => sftp.lstat(path, callback));
	if (!stat.isSymbolicLink()) {
		return { stat, type: fileType(stat) };
	}
	try {
		const target = await operation<Stats>(callback => sftp.stat(path, callback));
		return { stat: target, type: fileType(target) | FileType.SymbolicLink };
	} catch (error) {
		if (error instanceof FileSystemError && (error.code === 'FileNotFound' || (attrs && error.code === 'NoPermissions'))) {
			return { stat, type: FileType.SymbolicLink };
		}
		throw error;
	}
}

/** Checks existence without hiding permission or connection errors. */
async function existingStat(sftp: SFTPWrapper, path: string): Promise<Stats | undefined> {
	try {
		return await operation<Stats>(callback => sftp.lstat(path, callback));
	} catch (error) {
		if (error instanceof FileSystemError && error.code === 'FileNotFound') {
			return undefined;
		}
		throw error;
	}
}

/** Creates a unique sibling on the same remote filesystem. */
function siblingPath(path: string, extension: 'tmp' | 'bak'): string {
	return posix.join(posix.dirname(path), `.jcode-sftp-${randomUUID()}.${extension}`);
}

export class SftpFileSystemProvider implements FileSystemProvider {
	private readonly changes = new EventEmitter<FileChangeEvent[]>();
	readonly onDidChangeFile = this.changes.event;
	private readonly watchers = new Set<Disposable>();
	private readonly mutations = new Map<string, Promise<void>>();

	constructor(private readonly connections: SftpConnections, private readonly log: LogOutputChannel) { }

	private async run<T>(uri: Uri, action: (sftp: SFTPWrapper) => Promise<T>, retry = false): Promise<T> {
		try {
			return await action(await this.connections.sftp(uri.authority));
		} catch (error) {
			if (retry && error instanceof Error && isConnectionError(error)) {
				this.connections.reconnect(uri.authority);
				return action(await this.connections.sftp(uri.authority));
			}
			throw error;
		}
	}

	/** Serializes mutations so a replacement and its rollback cannot race another save. */
	private async mutate<T>(uri: Uri, action: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
		const result = (this.mutations.get(uri.authority) ?? Promise.resolve()).then(() => this.run(uri, action));
		const completion = result.then(() => undefined, () => undefined);
		this.mutations.set(uri.authority, completion);
		try {
			return await result;
		} finally {
			if (this.mutations.get(uri.authority) === completion) {
				this.mutations.delete(uri.authority);
			}
		}
	}

	async stat(uri: Uri): Promise<FileStat> {
		return this.run(uri, async sftp => {
			const { stat, type } = await resolveStat(sftp, uri.path);
			return fileStat(stat, type);
		}, true);
	}

	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		return this.run(uri, async sftp => {
			const entries: [string, FileType][] = [];
			for (const entry of await operation<FileEntryWithStats[]>(callback => sftp.readdir(uri.path, callback))) {
				if (entry.filename !== '.' && entry.filename !== '..') {
					const { type } = await resolveStat(sftp, posix.join(uri.path, entry.filename), entry.attrs);
					entries.push([entry.filename, type]);
				}
			}
			return entries;
		}, true);
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		return this.run(uri, async sftp => {
			const content = await operation<Buffer | string>(callback => sftp.readFile(uri.path, callback));
			return typeof content === 'string' ? Buffer.from(content) : content;
		}, true);
	}

	async writeFile(uri: Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		const created = await this.mutate(uri, async sftp => {
			const entry = await existingStat(sftp, uri.path);
			if (entry && !options.overwrite) {
				throw FileSystemError.FileExists(uri);
			}
			if (!entry && !options.create) {
				throw FileSystemError.FileNotFound(uri);
			}
			// Resolve the target before staging so saving through a link preserves the link.
			const path = entry?.isSymbolicLink() ? await operation<string>(callback => sftp.realpath(uri.path, callback)) : uri.path;
			const target = entry?.isSymbolicLink() ? await operation<Stats>(callback => sftp.stat(path, callback)) : entry;
			if (target?.isDirectory()) {
				throw FileSystemError.FileIsADirectory(uri);
			}
			if (target) {
				// Replacing an inode must not bypass the existing file's write permissions.
				const writable = await operation<Buffer>(callback => sftp.open(path, utils.sftp.OPEN_MODE.WRITE, callback));
				await operation<void>(callback => sftp.close(writable, callback));
			}
			const temporary = siblingPath(path, 'tmp');
			let handle: Buffer | undefined;
			let staged = false;
			let published = false;
			try {
				handle = await operation<Buffer>(callback => sftp.open(temporary, 'wx', target ? 0o600 : 0o666, callback));
				staged = true;
				const buffer = Buffer.from(content);
				for (let offset = 0; offset < buffer.length;) {
					const length = Math.min(64 * 1024, buffer.length - offset);
					await operation<void>(callback => sftp.write(handle!, buffer, offset, length, offset, callback));
					offset += length;
				}
				if (target) {
					const attrs = await operation<Stats>(callback => sftp.fstat(handle!, callback));
					if (attrs.uid !== target.uid || attrs.gid !== target.gid) {
						await operation<void>(callback => sftp.fchown(handle!, target.uid, target.gid, callback));
					}
					await operation<void>(callback => sftp.fchmod(handle!, target.mode & 0o7777, callback));
				}
				await operation<void>(callback => sftp.close(handle!, callback));
				handle = undefined;
				await this.replace(sftp, temporary, path, target);
				published = true;
			} finally {
				if (handle) {
					try {
						await operation<void>(callback => sftp.close(handle!, callback));
					} catch (error) {
						this.log.warn(`Could not close staged upload ${temporary}: ${String(error)}`);
					}
				}
				if (staged && !published) {
					try {
						await operation<void>(callback => sftp.unlink(temporary, callback));
					} catch (error) {
						this.log.warn(`Could not remove staged upload ${temporary}: ${String(error)}`);
					}
				}
			}
			return !entry;
		});
		this.changes.fire([{ type: created ? FileChangeType.Created : FileChangeType.Changed, uri }]);
	}

	async createDirectory(uri: Uri): Promise<void> {
		await this.mutate(uri, sftp => operation<void>(callback => sftp.mkdir(uri.path, callback)));
		this.changes.fire([{ type: FileChangeType.Created, uri }]);
	}

	async delete(uri: Uri, options: { recursive: boolean }): Promise<void> {
		await this.mutate(uri, async sftp => {
			const remove = async (path: string): Promise<void> => {
				const stat = await operation<Stats>(callback => sftp.lstat(path, callback));
				if (!stat.isDirectory()) {
					await operation<void>(callback => sftp.unlink(path, callback));
					return;
				}
				if (options.recursive) {
					for (const entry of await operation<FileEntryWithStats[]>(callback => sftp.readdir(path, callback))) {
						if (entry.filename !== '.' && entry.filename !== '..') {
							await remove(posix.join(path, entry.filename));
						}
					}
				}
				await operation<void>(callback => sftp.rmdir(path, callback));
			};
			await remove(uri.path);
		});
		this.changes.fire([{ type: FileChangeType.Deleted, uri }]);
	}

	async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
		if (oldUri.authority !== newUri.authority) {
			throw FileSystemError.Unavailable(l10n.t('Moving files between SSH connections is not supported.'));
		}
		await this.mutate(oldUri, async sftp => {
			if (oldUri.path === newUri.path) {
				await operation<Stats>(callback => sftp.lstat(oldUri.path, callback));
				return;
			}
			const target = await existingStat(sftp, newUri.path);
			if (target && !options.overwrite) {
				throw FileSystemError.FileExists(newUri);
			}
			await this.replace(sftp, oldUri.path, newUri.path, target);
		});
		if (oldUri.path === newUri.path) { return; }
		this.changes.fire([{ type: FileChangeType.Deleted, uri: oldUri }, { type: FileChangeType.Created, uri: newUri }]);
	}

	/** Uses atomic replacement when available and retains the original if fallback recovery fails. */
	private async replace(sftp: SFTPWrapper, source: string, target: string, attrs?: Stats): Promise<void> {
		if (!attrs) {
			await operation<void>(callback => sftp.rename(source, target, callback));
			return;
		}
		try {
			await operation<void>(callback => sftp.ext_openssh_rename(source, target, callback));
			return;
		} catch (error) {
			if (String((error as NodeJS.ErrnoException).code) !== String(utils.sftp.STATUS_CODE.OP_UNSUPPORTED) && !(error instanceof Error && error.message === 'Server does not support this extended request')) {
				throw error;
			}
		}
		const sourceStat = await operation<Stats>(callback => sftp.lstat(source, callback));
		if (sourceStat.isDirectory() !== attrs.isDirectory()) {
			throw attrs.isDirectory() ? FileSystemError.FileIsADirectory(target) : FileSystemError.FileNotADirectory(target);
		}
		if (attrs.isDirectory()) {
			const entries = await operation<FileEntryWithStats[]>(callback => sftp.readdir(target, callback));
			if (entries.some(entry => entry.filename !== '.' && entry.filename !== '..')) {
				throw FileSystemError.NoPermissions(l10n.t('Cannot replace a non-empty directory: {0}', target));
			}
		}
		const backup = siblingPath(target, 'bak');
		try {
			await operation<void>(callback => sftp.rename(target, backup, callback));
		} catch (error) {
			if (error instanceof Error && isConnectionError(error)) {
				// The server may have moved the file before the connection dropped.
				throw FileSystemError.Unavailable(l10n.t('Could not confirm the backup of {0}. If the destination is missing, check for the original at {1} after reconnecting. {2}', target, backup, String(error)));
			}
			throw error;
		}
		try {
			await operation<void>(callback => sftp.rename(source, target, callback));
		} catch (error) {
			try {
				await operation<void>(callback => sftp.rename(backup, target, callback));
			} catch (recoveryError) {
				this.log.error(`Replacement failed: ${String(error)}. Recovery failed: ${String(recoveryError)}. Original preserved at ${backup}.`);
				throw FileSystemError.Unavailable(l10n.t('Could not replace {0}. The original is preserved at {1}; restore it after reconnecting. {2}', target, backup, String(error)));
			}
			throw error;
		}
		try {
			await operation<void>(callback => attrs.isDirectory() ? sftp.rmdir(backup, callback) : sftp.unlink(backup, callback));
		} catch (error) {
			this.log.warn(`Replacement succeeded, but the original backup could not be removed at ${backup}: ${String(error)}`);
		}
	}

	watch(uri: Uri, options: { recursive: boolean; excludes: readonly string[] }): Disposable {
		const matchers = options.excludes.map(pattern => picomatch(pattern, { dot: true, nonegate: true }));
		const excluded = (path: string): boolean => matchers.some(matches => matches(path) || matches(posix.relative(uri.path, path)));
		let disposed = false;
		let polling = false;
		let previous: Map<string, SnapshotEntry> | undefined;
		const poll = async (): Promise<void> => {
			if (disposed || polling) {
				return;
			}
			polling = true;
			try {
				const current = await this.snapshot(uri, options.recursive, excluded);
				if (disposed) {
					return;
				}
				if (previous) {
					const events: FileChangeEvent[] = [];
					for (const [path, entry] of current) {
						const before = previous.get(path);
						if (!before || before.type !== entry.type) {
							events.push({ type: FileChangeType.Created, uri: uri.with({ path }) });
						} else if (before.mtime !== entry.mtime || before.size !== entry.size) {
							events.push({ type: FileChangeType.Changed, uri: uri.with({ path }) });
						}
					}
					for (const path of previous.keys()) {
						if (!current.has(path)) {
							events.push({ type: FileChangeType.Deleted, uri: uri.with({ path }) });
						}
					}
					if (events.length) {
						this.changes.fire(events);
					}
				}
				previous = current;
			} catch (error) {
				this.log.warn(`SSH/SFTP polling failed for ${uri.toString()}: ${String(error)}`);
			} finally {
				polling = false;
			}
		};
		const interval = setInterval(() => void poll(), workspace.getConfiguration('jcodeSftp').get('pollInterval', 10000));
		void poll();
		const watcher: Disposable = { dispose: () => { disposed = true; clearInterval(interval); this.watchers.delete(watcher); } };
		this.watchers.add(watcher);
		return watcher;
	}

	private async snapshot(uri: Uri, recursive: boolean, excluded: (path: string) => boolean): Promise<Map<string, SnapshotEntry>> {
		return this.run(uri, async sftp => {
			const result = new Map<string, SnapshotEntry>();
			if (excluded(uri.path)) { return result; }
			let root: { stat: Stats; type: FileType };
			try {
				root = await resolveStat(sftp, uri.path);
			} catch (error) {
				if (error instanceof FileSystemError && error.code === 'FileNotFound') {
					return result;
				}
				throw error;
			}
			result.set(uri.path, { type: root.type, mtime: root.stat.mtime, size: root.stat.size });
			if (!root.stat.isDirectory()) {
				return result;
			}
			const queue = [uri.path];
			while (queue.length) {
				const directory = queue.shift()!;
				for (const entry of await operation<FileEntryWithStats[]>(callback => sftp.readdir(directory, callback))) {
					if (entry.filename === '.' || entry.filename === '..') {
						continue;
					}
					const path = posix.join(directory, entry.filename);
					if (excluded(path)) { continue; }
					const { stat, type } = await resolveStat(sftp, path, entry.attrs);
					result.set(path, { type, mtime: stat.mtime, size: stat.size });
					// Watch a linked directory directly rather than following possible cycles here.
					if (recursive && type === FileType.Directory) {
						queue.push(path);
					}
					if (result.size > 5000) {
						throw new Error(l10n.t('Remote poll exceeded 5000 entries. Change detection paused for this workspace.'));
					}
				}
			}
			return result;
		}, true);
	}

	dispose(): void {
		for (const watcher of [...this.watchers]) {
			watcher.dispose();
		}
		this.changes.dispose();
	}
}
