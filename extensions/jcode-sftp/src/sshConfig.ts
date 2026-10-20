/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PlatformPath } from 'node:path';
import type { RemoteProfile } from './connection';

/** A host that an SSH config file defines under a name that can be connected to, with every setting resolved. */
export interface SshConfigHost {
	/** The name after `Host`, which is what `ssh` is given to connect. */
	alias: string;
	/** The `HostName`, or the alias when there is none. */
	hostName: string;
	/** The `User`, or the local user when there is none. */
	user: string;
	port: number;
	/** The first `IdentityFile`, with `~` expanded. */
	identityFile?: string;
	/** The `ProxyJump` value, in the comma separated form `ssh` accepts. Undefined when there is none or it is `none`. */
	proxyJump?: string;
	/** Whether the host connects through a `ProxyCommand`, which cannot be reproduced. */
	usesProxyCommand: boolean;
}

/** How the files an SSH config refers to are found, so that tests can use an in-memory file system. */
export interface SshConfigEnvironment {
	/** The home directory: `~` stands for it, and relative `Include` paths are relative to its `.ssh` folder. */
	home: string;
	/** The local user name, which `ssh` connects as when a host has no `User`. */
	user: string;
	/** The path functions of the system the files are on. */
	path: PlatformPath;
	/** Resolves a file's text, or undefined when it is missing or unreadable. */
	readFile(path: string): Promise<string | undefined>;
	/** Resolves the names in a folder, or undefined when it is missing or unreadable. */
	readDirectory(path: string): Promise<string[] | undefined>;
}

/** One setting line: the lowercase keyword and its arguments. */
export interface ConfigLine {
	keyword: string;
	args: string[];
}

/** The settings under one `Host` line. The settings before the first one have no patterns and apply to every host. */
interface ConfigBlock {
	patterns: string[] | undefined;
	/** The arguments of the first line for each keyword, because the first value obtained for a setting wins. */
	options: Map<string, string[]>;
}

/** How deeply `Include` may nest, which is also what `ssh` allows. */
const maxIncludeDepth = 16;
/** The most lines read from all files together, so that a pathological or cyclic config cannot run away. */
const maxLines = 50_000;

/**
 * Splits the arguments of a line like `ssh` does: they are separated by whitespace, quotes group
 * words, a backslash escapes a quote, a backslash or (outside quotes) a space, and a `#` that starts
 * an argument begins a comment. Returns undefined when a quote is never closed.
 */
function splitArguments(text: string): string[] | undefined {
	const args: string[] = [];
	for (let index = 0; index < text.length;) {
		if (text[index] === ' ' || text[index] === '\t') {
			index++;
			continue;
		}
		if (text[index] === '#') {
			break;
		}
		let value = '';
		let quote = '';
		for (; index < text.length; index++) {
			const char = text[index];
			if (char === '\\') {
				const next = text[index + 1];
				if (next === '"' || next === `'` || next === '\\' || (quote === '' && next === ' ')) {
					value += next;
					index++;
				} else {
					value += char;
				}
			} else if (quote === '' && (char === ' ' || char === '\t')) {
				break;
			} else if (quote === '' && (char === '"' || char === `'`)) {
				quote = char;
			} else if (quote !== '' && char === quote) {
				quote = '';
			} else {
				value += char;
			}
		}
		if (quote !== '') {
			return undefined;
		}
		args.push(value);
	}
	return args;
}

/**
 * Reads one line of an SSH config. The keyword is case-insensitive and is separated from its
 * arguments by whitespace, an equals sign, or both. Returns undefined for blank lines, comments and
 * lines that cannot be read.
 */
export function parseConfigLine(line: string): ConfigLine | undefined {
	const match = /^\s*(?<keyword>[^\s=#]+)\s*(?:=\s*)?(?<rest>.*)$/.exec(line);
	if (!match?.groups) {
		return undefined;
	}
	const args = splitArguments(match.groups.rest);
	return args ? { keyword: match.groups.keyword.toLowerCase(), args } : undefined;
}

/** Turns a pattern with `*` and `?` wildcards into a regular expression for the whole text. */
function patternToRegExp(pattern: string, caseSensitive: boolean): RegExp {
	const source = Array.from(pattern, char => char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
	return new RegExp(`^${source}$`, caseSensitive ? '' : 'i');
}

function hasWildcard(pattern: string): boolean {
	return /[*?]/.test(pattern);
}

/** Replaces a leading `~` with the home directory. */
function expandHome(value: string, env: SshConfigEnvironment): string {
	return value === '~' ? env.home : /^~[/\\]/.test(value) ? env.path.join(env.home, value.slice(2)) : value;
}

/** Lists the files a glob pattern matches, in the order `ssh` reads them. Wildcards apply to one path segment each. */
async function expandGlob(pattern: string, env: SshConfigEnvironment): Promise<string[]> {
	const { root } = env.path.parse(pattern);
	const caseSensitive = env.path.sep === '/';
	let candidates = [root];
	for (const segment of pattern.slice(root.length).split(/[\\/]+/).filter(part => part)) {
		const next: string[] = [];
		if (hasWildcard(segment)) {
			const matches = patternToRegExp(segment, caseSensitive);
			for (const directory of candidates) {
				const names = (await env.readDirectory(directory)) ?? [];
				// As in a shell, a wildcard does not match names that start with a dot unless the pattern does too.
				next.push(...names.filter(name => matches.test(name) && (segment.startsWith('.') || !name.startsWith('.'))).sort().map(name => env.path.join(directory, name)));
			}
		} else {
			next.push(...candidates.map(directory => env.path.join(directory, segment)));
		}
		candidates = next;
	}
	return candidates;
}

/** Resolves the files an `Include` argument names. Relative paths are relative to the `.ssh` folder in the home directory. */
async function expandInclude(argument: string, env: SshConfigEnvironment): Promise<string[]> {
	const expanded = expandHome(argument, env);
	const path = env.path.isAbsolute(expanded) ? expanded : env.path.join(env.home, '.ssh', expanded);
	return hasWildcard(path) ? expandGlob(path, env) : [path];
}

/**
 * Reads the lines of a config, putting the lines of every `Include`d file where its directive is,
 * which is how `ssh` treats them: an included file continues whichever `Host` block was open.
 */
async function collectLines(text: string, env: SshConfigEnvironment, depth: number, reading: ReadonlySet<string>, lines: ConfigLine[]): Promise<void> {
	for (const raw of (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).split(/\r?\n/)) {
		if (lines.length >= maxLines) {
			return;
		}
		const line = parseConfigLine(raw);
		if (!line) {
			continue;
		}
		if (line.keyword !== 'include') {
			lines.push(line);
			continue;
		}
		if (depth >= maxIncludeDepth) {
			continue;
		}
		for (const argument of line.args) {
			for (const file of await expandInclude(argument, env)) {
				const included = reading.has(file) ? undefined : await env.readFile(file);
				if (included !== undefined) {
					await collectLines(included, env, depth + 1, new Set(reading).add(file), lines);
				}
			}
		}
	}
}

/**
 * Groups the lines by `Host` line. Settings under a `Match` line are dropped: its conditions
 * cannot be evaluated without connecting, so they apply to no host.
 */
function groupBlocks(lines: readonly ConfigLine[]): ConfigBlock[] {
	const blocks: ConfigBlock[] = [{ patterns: undefined, options: new Map() }];
	let current: ConfigBlock | undefined = blocks[0];
	for (const { keyword, args } of lines) {
		if (keyword === 'host') {
			current = { patterns: args, options: new Map() };
			blocks.push(current);
		} else if (keyword === 'match') {
			current = undefined;
		} else if (current && !current.options.has(keyword)) {
			current.options.set(keyword, args);
		}
	}
	return blocks;
}

/** Whether a `Host` line applies to a name: one of its patterns matches and none of the negated ones do. */
function appliesTo(alias: string, patterns: readonly string[]): boolean {
	let matched = false;
	for (const pattern of patterns) {
		if (pattern.startsWith('!')) {
			if (patternToRegExp(pattern.slice(1), false).test(alias)) {
				return false;
			}
		} else if (patternToRegExp(pattern, false).test(alias)) {
			matched = true;
		}
	}
	return matched;
}

/** Replaces the `%` tokens that `ssh` expands in a value. Tokens it does not know are left alone. */
function expandTokens(value: string, tokens: Readonly<Record<string, string>>): string {
	return value.replace(/%(?<token>.)/g, (match, token: string) => token === '%' ? '%' : tokens[token] ?? match);
}

/** Resolves the settings of every host with a name of its own, in the order the names first appear. */
function resolveHosts(blocks: readonly ConfigBlock[], env: SshConfigEnvironment): SshConfigHost[] {
	const aliases = new Set(blocks.flatMap(block => block.patterns ?? []).filter(pattern => pattern && !pattern.startsWith('!') && !hasWildcard(pattern)));
	return Array.from(aliases, alias => {
		const applicable = blocks.filter(block => !block.patterns || appliesTo(alias, block.patterns));
		const first = (keyword: string): string | undefined => applicable.find(block => block.options.get(keyword)?.length)?.options.get(keyword)?.[0];
		const hostName = expandTokens(first('hostname') ?? alias, { h: alias });
		const user = first('user') ?? env.user;
		const configuredPort = Number(first('port'));
		const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 22;
		const identity = first('identityfile');
		const identityFile = identity && identity.toLowerCase() !== 'none'
			? expandHome(expandTokens(identity, { d: env.home, u: env.user, r: user, h: hostName, n: alias, p: String(port) }), env)
			: undefined;
		const jump = applicable.find(block => block.options.get('proxyjump')?.length)?.options.get('proxyjump');
		const hops = (jump ?? []).join(',').split(',').map(hop => hop.trim()).filter(hop => hop).join(',');
		const proxyJump = hops && hops.toLowerCase() !== 'none' ? hops : undefined;
		const command = first('proxycommand');
		return { alias, hostName, user, port, identityFile, proxyJump, usesProxyCommand: !proxyJump && command !== undefined && command.toLowerCase() !== 'none' };
	});
}

/**
 * Reads the hosts an SSH config defines, following its `Include` directives. Hosts whose name is a
 * pattern (`Host *`, `Host *.example.com`) are not hosts to connect to, but the settings they hold
 * still apply to the hosts they match, as they do for `ssh`. Returns undefined when the file cannot be read.
 */
export async function readSshConfig(configPath: string, env: SshConfigEnvironment): Promise<SshConfigHost[] | undefined> {
	const text = await env.readFile(configPath);
	if (text === undefined) {
		return undefined;
	}
	const lines: ConfigLine[] = [];
	await collectLines(text, env, 0, new Set([configPath]), lines);
	return resolveHosts(groupBlocks(lines), env);
}

/** Drops the hosts that are already saved as connections, which have the same name, host, user and port. */
export function hostsToImport(hosts: readonly SshConfigHost[], existing: readonly RemoteProfile[]): SshConfigHost[] {
	return hosts.filter(host => !existing.some(profile => profile.name === host.alias && profile.host === host.hostName && profile.username === host.user && profile.port === host.port));
}

/** Builds the connection for a host. No password or passphrase is involved: the user enters one when connecting. */
export function profileFromHost(host: SshConfigHost, options: { id: string; agentAvailable: boolean }): RemoteProfile {
	return {
		id: options.id,
		name: host.alias,
		host: host.hostName,
		port: host.port,
		username: host.user,
		root: '/',
		authentication: host.identityFile ? 'privateKey' : options.agentAvailable ? 'agent' : 'password',
		privateKeyPath: host.identityFile
	};
}
