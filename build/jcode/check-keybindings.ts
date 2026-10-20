/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Lists the default keyboard shortcuts of every platform, read from the sources and the built-in
// extensions, to find shortcuts that are free on Windows, Linux and macOS alike.
//
//   node build/jcode/check-keybindings.ts query ctrl+alt+p shift+alt+t
//   node build/jcode/check-keybindings.ts free ctrl+alt shift+alt
//   node build/jcode/check-keybindings.ts jcode       (fails when a JCode shortcut conflicts)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

type Platform = 'win' | 'linux' | 'mac';
const platforms: Platform[] = ['win', 'linux', 'mac'];
const root = join(import.meta.dirname, '..', '..');

interface Binding { readonly platform: Platform; readonly key: string; readonly source: string; readonly when: string }

// Shortcuts the operating systems or popular desktops reserve. Normalized like the bindings (sorted modifiers).
const reserved: Record<Platform, Record<string, string>> = {
	win: {
		'alt+f4': 'close window', 'alt+tab': 'switch window', 'alt+space': 'window menu', 'ctrl+shift+escape': 'Task Manager',
		'ctrl+alt+delete': 'security screen', 'alt+shift': 'switch input language', 'ctrl+shift': 'switch keyboard layout',
		'ctrl+alt+up': 'rotate screen (Intel graphics)', 'ctrl+alt+down': 'rotate screen (Intel graphics)', 'ctrl+alt+left': 'rotate screen (Intel graphics)', 'ctrl+alt+right': 'rotate screen (Intel graphics)',
	},
	linux: {
		'alt+tab': 'switch window', 'alt+f2': 'run command', 'alt+f4': 'close window', 'alt+f7': 'move window', 'alt+f8': 'resize window', 'alt+f10': 'maximize', 'alt+space': 'window menu',
		'alt+`': 'switch window of app', 'ctrl+alt+t': 'open terminal (Ubuntu, Mint)', 'ctrl+alt+l': 'lock screen (Ubuntu, Mint, KDE)', 'ctrl+alt+d': 'show desktop (GNOME, Mint)',
		'ctrl+alt+delete': 'log out', 'ctrl+alt+backspace': 'restart X', 'ctrl+alt+up': 'switch workspace', 'ctrl+alt+down': 'switch workspace',
		'ctrl+alt+left': 'switch workspace', 'ctrl+alt+right': 'switch workspace', 'ctrl+shift+u': 'Unicode input (GTK)', 'ctrl+alt+escape': 'kill window (KDE)', 'ctrl+escape': 'system activity (KDE)',
	},
	mac: {
		'cmd+space': 'Spotlight', 'alt+cmd+space': 'Finder search', 'alt+cmd+escape': 'Force Quit', 'alt+cmd+d': 'hide Dock', 'alt+cmd+h': 'hide other apps',
		'alt+cmd+m': 'minimize all windows', 'alt+cmd+w': 'close all windows', 'cmd+shift+3': 'screenshot', 'cmd+shift+4': 'screenshot', 'cmd+shift+5': 'screenshot',
		'cmd+shift+q': 'log out', 'cmd+ctrl+q': 'lock screen', 'cmd+ctrl+f': 'full screen', 'cmd+ctrl+space': 'emoji', 'cmd+shift+/': 'Help menu', 'cmd+tab': 'switch app',
		// allow-any-unicode-next-line
		'cmd+`': 'switch window', 'cmd+h': 'hide app', 'cmd+m': 'minimize', 'cmd+q': 'quit', 'alt+cmd+i': 'Finder info', 'ctrl+up': 'Mission Control', 'ctrl+down': 'App Exposé', 'ctrl+left': 'switch Space', 'ctrl+right': 'switch Space',
	},
};

// Windows treats Ctrl+Alt as AltGr, which types these characters on common layouts.
const altGr: Record<string, string> = {
	// allow-any-unicode-next-line
	a: 'ą (Polish)', c: 'ć (Polish), & (Czech)', e: '€ (most European layouts)', l: 'ł (Polish), Ł (Czech)', n: 'ń (Polish), } (Czech)', o: 'ó (Polish)',
	// allow-any-unicode-next-line
	s: 'ś (Polish), đ (Czech)', x: 'ź (Polish), # (Czech)', z: 'ż (Polish)', q: '@ (German), \\ (Czech)', m: 'µ (German)', w: '| (Czech)', k: 'ł (Czech, Hungarian)',
	// allow-any-unicode-next-line
	f: '[ (Czech, Hungarian)', g: '] (Czech, Hungarian)', v: '@ (Czech)', b: '{ (Czech)', d: 'Đ (Czech)', h: '\' (Czech)', j: 'í (Hungarian)', i: 'Í (Hungarian)', y: '> (Hungarian)', u: '€ (Hungarian)',
	// allow-any-unicode-next-line
	'2': '@ (Spanish, Italian, Nordic)', '3': '# (Spanish), ³ (German)', '4': '~ (Spanish), $ (Nordic)', '5': '€ (Spanish)', '7': '{ (German, Nordic)', '8': '[ (German, Nordic)', '9': '] (German, Nordic)', '0': '} (German, Nordic)',
};

function walk(directory: string, files: string[] = []): string[] {
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) {
			if (name !== 'test' && name !== 'node_modules' && name !== 'fixtures') {
				walk(path, files);
			}
		} else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')) {
			files.push(path);
		}
	}
	return files;
}

// KeyCode and KeyMod values, read from the source so they never drift.
const enums = new Map<string, Map<string, number>>();
{
	const file = join(root, 'src/vs/base/common/keyCodes.ts');
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	source.forEachChild(node => {
		if (ts.isEnumDeclaration(node) && (node.name.text === 'KeyCode' || node.name.text === 'KeyMod')) {
			const members = new Map<string, number>();
			let next = 0;
			for (const member of node.members) {
				const name = member.name.getText(source);
				const value = member.initializer ? Function(`return (${member.initializer.getText(source)})`)() as number : next;
				members.set(name, value);
				next = value + 1;
			}
			enums.set(node.name.text, members);
		}
	});
}
const keyCodeNames = new Map([...enums.get('KeyCode')!].map(([name, value]) => [value, name]));
const KEY_NAMES: Record<string, string> = {
	BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=',
	UpArrow: 'up', DownArrow: 'down', LeftArrow: 'left', RightArrow: 'right', Escape: 'escape', Enter: 'enter', Space: 'space', Tab: 'tab', Backspace: 'backspace', Delete: 'delete',
	PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end', Insert: 'insert',
};

function chordToString(value: number, platform: Platform): string | undefined {
	const keyCode = value & 0xff;
	const name = keyCodeNames.get(keyCode);
	if (!name || name === 'Unknown') {
		return undefined;
	}
	const ctrlCmd = (value & (1 << 11)) !== 0, shift = (value & (1 << 10)) !== 0, alt = (value & (1 << 9)) !== 0, winCtrl = (value & (1 << 8)) !== 0;
	const modifiers: string[] = [];
	if (platform === 'mac') {
		if (winCtrl) { modifiers.push('ctrl'); }
		if (ctrlCmd) { modifiers.push('cmd'); }
	} else {
		if (ctrlCmd) { modifiers.push('ctrl'); }
		if (winCtrl) { modifiers.push('meta'); }
	}
	if (shift) { modifiers.push('shift'); }
	if (alt) { modifiers.push('alt'); }
	const key = KEY_NAMES[name] ?? name.replace(/^Key/, '').replace(/^Digit/, '').toLowerCase();
	return normalize([...modifiers, key].join('+'));
}

function keybindingToStrings(value: number, platform: Platform): string | undefined {
	const first = chordToString(value & 0xffff, platform);
	const second = (value >>> 16) & 0xffff;
	return first && second ? `${first} ${chordToString(second, platform) ?? '?'}` : first;
}

function normalize(key: string): string {
	return key.toLowerCase().split(' ').map(chord => {
		const parts = chord.split('+');
		const last = parts.pop()!;
		const order = ['ctrl', 'meta', 'win', 'cmd', 'shift', 'alt'];
		parts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
		return [...parts.map(part => part === 'win' ? 'meta' : part), last].join('+');
	}).join(' ').replace(/\bcmd\+shift\+alt\b/, 'cmd+shift+alt').replace(/^alt\+cmd/, 'alt+cmd');
}

// Evaluates a keybinding expression to every value it can take (both sides of a condition).
function evaluate(node: ts.Expression, source: ts.SourceFile): number[] {
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
		return evaluate(node.expression, source);
	}
	if (ts.isNumericLiteral(node)) {
		return [Number(node.text)];
	}
	if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
		const value = enums.get(node.expression.text)?.get(node.name.text);
		return value === undefined ? [] : [value];
	}
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarToken) {
		const left = evaluate(node.left, source), right = evaluate(node.right, source);
		return left.flatMap(l => right.map(r => (l | r) >>> 0));
	}
	if (ts.isConditionalExpression(node)) {
		return [...evaluate(node.whenTrue, source), ...evaluate(node.whenFalse, source)];
	}
	if (ts.isCallExpression(node) && node.expression.getText(source) === 'KeyChord' && node.arguments.length === 2) {
		const first = evaluate(node.arguments[0], source), second = evaluate(node.arguments[1], source);
		return first.flatMap(f => second.map(s => (f | ((s & 0xffff) << 16)) >>> 0));
	}
	return [];
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
	for (const element of object.properties) {
		if (ts.isPropertyAssignment(element) && element.name.getText().replace(/['"]/g, '') === name) {
			return element.initializer;
		}
	}
	return undefined;
}

function collectSources(): Binding[] {
	const bindings: Binding[] = [];
	for (const file of walk(join(root, 'src/vs'))) {
		const text = readFileSync(file, 'utf8');
		if (!text.includes('primary')) {
			continue;
		}
		const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node) => {
			if (ts.isObjectLiteralExpression(node) && property(node, 'primary')) {
				const location = `${relative(root, file).replace(/\\/g, '/')}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
				const whenNode = property(node, 'when') ?? (ts.isPropertyAssignment(node.parent) && ts.isObjectLiteralExpression(node.parent.parent) ? property(node.parent.parent, 'when') ?? property(node.parent.parent, 'precondition') : undefined);
				const when = whenNode ? whenNode.getText(source).replace(/\s+/g, ' ').slice(0, 120) : '';
				for (const platform of platforms) {
					const override = property(node, platform);
					const target = override && ts.isObjectLiteralExpression(override) ? override : node;
					const keys = [property(target, 'primary'), ...(() => {
						const secondary = property(target, 'secondary');
						return secondary && ts.isArrayLiteralExpression(secondary) ? [...secondary.elements] : [];
					})()];
					for (const key of keys) {
						for (const value of key ? evaluate(key, source) : []) {
							const shortcut = keybindingToStrings(value, platform);
							if (shortcut) {
								bindings.push({ platform, key: shortcut, source: location, when });
							}
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return bindings;
}

function collectExtensions(): Binding[] {
	const bindings: Binding[] = [];
	for (const name of readdirSync(join(root, 'extensions'))) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(join(root, 'extensions', name, 'package.json'), 'utf8'));
		} catch {
			continue;
		}
		const contributions = manifest.contributes?.keybindings;
		for (const contribution of Array.isArray(contributions) ? contributions : contributions ? [contributions] : []) {
			for (const platform of platforms) {
				const key = contribution[platform] ?? contribution.key;
				if (typeof key === 'string' && key) {
					bindings.push({ platform, key: normalize(key.replace(/\bwin\+/g, 'meta+')), source: `extensions/${name} (${contribution.command})`, when: contribution.when ?? '' });
				}
			}
		}
	}
	return bindings;
}

const all = [...collectSources(), ...collectExtensions()];

function uses(shortcut: string, platform: Platform): Binding[] {
	const wanted = normalize(shortcut);
	return all.filter(binding => binding.platform === platform && (binding.key === wanted || binding.key.startsWith(`${wanted} `)));
}

function toPlatform(shortcut: string, platform: Platform): string {
	// Write shortcuts with ctrl; on macOS that is cmd, like KeyMod.CtrlCmd.
	return normalize(platform === 'mac' ? shortcut.replace(/\bctrl\b/g, 'cmd') : shortcut);
}

function problems(shortcut: string): string[] {
	const found: string[] = [];
	for (const platform of platforms) {
		const key = toPlatform(shortcut, platform);
		for (const binding of uses(key, platform)) {
			found.push(`${platform}: ${key} is used by ${binding.source}${binding.when ? ` when ${binding.when}` : ''}`);
		}
		if (reserved[platform][key]) {
			found.push(`${platform}: ${key} is reserved by the system (${reserved[platform][key]})`);
		}
	}
	const parts = normalize(shortcut).split('+');
	if (parts.includes('ctrl') && parts.includes('alt') && altGr[parts[parts.length - 1]]) {
		found.push(`win: Ctrl+Alt+${parts[parts.length - 1].toUpperCase()} is AltGr and types ${altGr[parts[parts.length - 1]]}`);
	}
	return found;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'query') {
	for (const shortcut of args) {
		const found = problems(shortcut);
		console.log(`${shortcut}: ${found.length ? 'CONFLICTS' : 'free on Windows, Linux and macOS'}`);
		found.forEach(line => console.log(`  ${line}`));
	}
} else if (command === 'free') {
	const keys = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('').concat(['[', ']', ',', '.', '/', ';', '\'', '`', '-', '=', '\\']);
	for (const family of args) {
		const free = keys.filter(key => problems(`${family}+${key}`).length === 0);
		console.log(`${family}: ${free.length ? free.join(' ') : '(none)'}`);
	}
} else if (command === 'jcode') {
	// JCode's default shortcuts (Shift+Option on macOS). Keep in sync with the README.
	const jcodeShortcuts: Record<string, string> = {
		'shift+alt+t': 'Search Open Tabs', 'shift+alt+g': 'New Tab Group from Selected Editors', 'shift+alt+e': 'Toggle Collapse Active Tab Group',
		'shift+alt+n': 'Focus Next Tab Group', 'shift+alt+p': 'Focus Previous Tab Group', 'shift+alt+w': 'Close Tab Group',
		'shift+alt+b': 'Toggle Bookmark', 'shift+alt+l': 'Go to Bookmark', 'shift+alt+j': 'Go to Next Bookmark', 'shift+alt+k': 'Go to Previous Bookmark',
	};
	const jcodeSources = /contrib\/(bookmarks|tabGroups)\/|parts\/editor\/editorCommands\.ts/;
	let failed = false;
	for (const [shortcut, name] of Object.entries(jcodeShortcuts)) {
		const own = platforms.flatMap(platform => uses(toPlatform(shortcut, platform), platform)).filter(binding => jcodeSources.test(binding.source));
		if (own.length === 0) {
			// Shortcuts registered through a variable, such as a loop over actions, are invisible to this reader.
			console.log(`note: ${shortcut} (${name}) is registered through a variable; check it in the running app`);
		}
		for (const problem of problems(shortcut).filter(line => !own.some(binding => line.includes(binding.source)))) {
			failed = true;
			console.log(`${shortcut} (${name}): ${problem}`);
		}
	}
	console.log(failed ? 'JCode shortcuts have conflicts.' : `All ${Object.keys(jcodeShortcuts).length} JCode shortcuts are free on Windows, Linux and macOS.`);
	process.exitCode = failed ? 1 : 0;
} else {
	console.log('Usage: node build/jcode/check-keybindings.ts query <shortcut>... | free <modifier-family>... | jcode');
}
