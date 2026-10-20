/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { posix, win32, type PlatformPath } from 'node:path';
import { describe, test } from 'node:test';
import type { RemoteProfile } from '../connection';
import { hostsToImport, parseConfigLine, profileFromHost, readSshConfig, type SshConfigHost } from '../sshConfig';

/** Serves an in-memory set of files, keyed by path in the style of `path`. */
function createEnvironment(files: Record<string, string>, path: PlatformPath = posix, home = '/home/jean') {
	return {
		home,
		user: 'jean',
		path,
		readFile: async (file: string) => files[file],
		readDirectory: async (directory: string) => {
			const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
			const names = new Set(Object.keys(files).filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split(path.sep)[0]));
			return names.size ? [...names] : undefined;
		}
	};
}

const configPath = '/home/jean/.ssh/config';

/** Reads a config that is the only file. */
async function readHosts(text: string, others: Record<string, string> = {}): Promise<SshConfigHost[]> {
	return (await readSshConfig(configPath, createEnvironment({ [configPath]: text, ...others })))!;
}

/** Describes a host in one line, which keeps the expectations readable. */
function describeHost(host: SshConfigHost): string {
	const extras = [host.identityFile && `key=${host.identityFile}`, host.proxyJump && `jump=${host.proxyJump}`, host.unsupportedProxy && `unsupported=${host.unsupportedProxy}`];
	return [`${host.alias} -> ${host.user}@${host.hostName}:${host.port}`, ...extras.filter(extra => extra)].join(' ');
}

describe('parseConfigLine', () => {
	test('reads keywords in any case, with a space, tab or equals sign before the value', () => {
		const lines = ['HostName example.com', 'hostname=example.com', 'HOSTNAME = example.com', '  User\tjean', 'Host', 'PORT 2222 '];
		assert.deepStrictEqual(lines.map(line => parseConfigLine(line)), [
			{ keyword: 'hostname', args: ['example.com'] },
			{ keyword: 'hostname', args: ['example.com'] },
			{ keyword: 'hostname', args: ['example.com'] },
			{ keyword: 'user', args: ['jean'] },
			{ keyword: 'host', args: [] },
			{ keyword: 'port', args: ['2222'] }
		]);
	});

	test('groups quoted words and honors escapes', () => {
		const lines = [
			'IdentityFile "~/my keys/id"',
			`User 'jean doe'`,
			'Host a\\ b c',
			'ProxyCommand ssh -W %h:%p "jump \\"host\\""',
			'IdentityFile "C:\\Users\\Jean\\My Keys\\id"',
			'IdentityFile C:\\Users\\Jean\\id',
			'Host web"-1" web-"2"'
		];
		assert.deepStrictEqual(lines.map(line => parseConfigLine(line)?.args), [
			['~/my keys/id'],
			['jean doe'],
			['a b', 'c'],
			['ssh', '-W', '%h:%p', 'jump "host"'],
			['C:\\Users\\Jean\\My Keys\\id'],
			['C:\\Users\\Jean\\id'],
			['web-1', 'web-2']
		]);
	});

	test('ignores comments, but only where a comment can start', () => {
		const lines = ['# a comment', '   # an indented comment', '', '   ', 'Host web db # the servers', 'HostName host#1', 'HostName "#quoted"', 'User jean #'];
		assert.deepStrictEqual(lines.map(line => parseConfigLine(line)), [
			undefined, undefined, undefined, undefined,
			{ keyword: 'host', args: ['web', 'db'] },
			{ keyword: 'hostname', args: ['host#1'] },
			{ keyword: 'hostname', args: ['#quoted'] },
			{ keyword: 'user', args: ['jean'] }
		]);
	});

	test('gives up on a line with a quote that is never closed', () => {
		assert.deepStrictEqual(['HostName "example.com', `User 'jean`].map(line => parseConfigLine(line)), [undefined, undefined]);
	});
});

describe('readSshConfig', () => {
	test('reads hosts with their settings, and applies the defaults of wildcard blocks without listing them', async () => {
		const hosts = await readHosts([
			'# Defaults for everything that comes before',
			'ServerAliveInterval 30',
			'',
			'Host web',
			'\tHostName web.example.com',
			'\tUser deploy',
			'\tPort 2222',
			'\tIdentityFile ~/.ssh/id_web',
			'',
			'Host db',
			'\tHostName=db.example.com',
			'\tIdentityFile "~/.ssh/my keys/id_db"',
			'',
			'Host build-*',
			'\tUser ci',
			'',
			'Host build-01 build-02',
			'\tHostName %h.example.com',
			'',
			'Host *',
			'\tUser fallback',
			'\tIdentityFile ~/.ssh/id_default',
			'\tPort 22'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), [
			'web -> deploy@web.example.com:2222 key=/home/jean/.ssh/id_web',
			'db -> fallback@db.example.com:22 key=/home/jean/.ssh/my keys/id_db',
			'build-01 -> ci@build-01.example.com:22 key=/home/jean/.ssh/id_default',
			'build-02 -> ci@build-02.example.com:22 key=/home/jean/.ssh/id_default'
		]);
	});

	test('connects as the local user and to the alias when the config says nothing else', async () => {
		assert.deepStrictEqual((await readHosts('Host plain')).map(describeHost), ['plain -> jean@plain:22']);
	});

	test('takes the first value for a setting, as ssh does', async () => {
		const hosts = await readHosts(['Host *', 'User first', 'Host web', 'User second', 'Port 2200', 'Host web', 'Port 2300'].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['web -> first@web:2200']);
	});

	test('skips Match blocks and resumes at the next Host', async () => {
		const hosts = await readHosts([
			'Host a',
			'\tHostName a.example.com',
			'Match host a',
			'\tUser ignored',
			'\tPort 9999',
			'Host b',
			'\tUser b-user',
			'Match all',
			'\tHostName never.example.com',
			'\tIdentityFile ~/never'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['a -> jean@a.example.com:22', 'b -> b-user@b:22']);
	});

	test('honors negated patterns and matches host names without regard to case', async () => {
		const hosts = await readHosts([
			'Host web.example.com SKIP.example.com',
			'Host *.Example.COM !skip.example.com',
			'\tUser ops'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['web.example.com -> ops@web.example.com:22', 'SKIP.example.com -> jean@SKIP.example.com:22']);
	});

	test('accepts keywords in any case', async () => {
		const hosts = await readHosts(['HOST Upper', 'HOSTNAME up.example.com', 'USER Admin', 'PORT 2200', 'IDENTITYFILE ~/k', 'PROXYJUMP gate'].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['Upper -> Admin@up.example.com:2200 key=/home/jean/k jump=jean@gate']);
	});

	test('expands tokens in the host name and the key path', async () => {
		const hosts = await readHosts(['Host web', 'HostName %h.example.com', 'User deploy', 'IdentityFile %d/.ssh/id_%r@%h_100%%'].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['web -> deploy@web.example.com:22 key=/home/jean/.ssh/id_deploy@web.example.com_100%']);
	});

	test('ignores ports that are not valid and lists a name once', async () => {
		const hosts = await readHosts(['Host a b', 'Port 70000', 'Host b c', 'Port abc', 'Host a'].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['a -> jean@a:22', 'b -> jean@b:22', 'c -> jean@c:22']);
	});

	test('spells out jump hosts, which none turns off, and flags hosts that need a proxy command', async () => {
		const hosts = await readHosts([
			'Host inner',
			'\tProxyJump jump1,deploy@jump2:2200',
			'Host spaced',
			'\tProxyJump jump1, jump2',
			'Host direct.corp',
			'\tProxyJump none',
			'Host command',
			'\tProxyCommand ssh -W %h:%p bastion',
			'Host *.corp',
			'\tProxyJump gateway',
			'Host app.corp'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), [
			'inner -> jean@inner:22 jump=jean@jump1,deploy@jump2:2200',
			'spaced -> jean@spaced:22 jump=jean@jump1,jean@jump2',
			'direct.corp -> jean@direct.corp:22',
			'command -> jean@command:22 unsupported=ProxyCommand',
			'app.corp -> jean@app.corp:22 jump=jean@gateway'
		]);
	});

	test('resolves jump host names through the config, unless the jump host gives its own user and port', async () => {
		const hosts = await readHosts([
			'Host bastion',
			'\tHostName bastion.example.com',
			'\tUser admin',
			'\tPort 2200',
			'Host inner',
			'\tHostName 10.0.0.5',
			'\tProxyJump bastion',
			'Host other',
			'\tProxyJump other-user@bastion:2022',
			'Host url',
			'\tProxyJump ssh://gate@gate.example.com:2222',
			'Host six',
			'\tProxyJump [::1]:2200',
			'Host *.lab',
			'\tUser lab-user',
			'Host unlisted',
			'\tProxyJump gate.lab'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), [
			'bastion -> admin@bastion.example.com:2200',
			'inner -> jean@10.0.0.5:22 jump=admin@bastion.example.com:2200',
			'other -> jean@other:22 jump=other-user@bastion.example.com:2022',
			'url -> jean@url:22 jump=gate@gate.example.com:2222',
			'six -> jean@six:22 jump=jean@[::1]:2200',
			'unlisted -> jean@unlisted:22 jump=lab-user@gate.lab'
		]);
	});

	test('puts the jump hosts of a jump host first', async () => {
		const hosts = await readHosts([
			'Host target',
			'\tProxyJump middle',
			'Host middle',
			'\tProxyJump first',
			'Host first',
			'\tHostName first.example.com',
			'\tUser first-user'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), [
			'target -> jean@target:22 jump=first-user@first.example.com,jean@middle',
			'middle -> jean@middle:22 jump=first-user@first.example.com',
			'first -> first-user@first.example.com:22'
		]);
	});

	test('does not import jump hosts that loop back or cannot be read', async () => {
		const hosts = await readHosts([
			'Host a',
			'\tProxyJump b',
			'Host b',
			'\tProxyJump a',
			'Host self',
			'\tProxyJump self',
			'Host broken',
			'\tProxyJump bad host!',
			'Host far',
			'\tProxyJump user@host:99999'
		].join('\n'));
		assert.deepStrictEqual(hosts.map(describeHost), [
			'a -> jean@a:22 unsupported=ProxyJump',
			'b -> jean@b:22 unsupported=ProxyJump',
			'self -> jean@self:22 unsupported=ProxyJump',
			'broken -> jean@broken:22 unsupported=ProxyJump',
			'far -> jean@far:22 unsupported=ProxyJump'
		]);
	});

	test('reads files with a byte order mark and Windows line endings, and skips lines it cannot read', async () => {
		const hosts = await readHosts(['\uFEFFHost web', 'HostName "broken', 'User deploy', '=', 'Host db', '\tPort 2200'].join('\r\n'));
		assert.deepStrictEqual(hosts.map(describeHost), ['web -> deploy@web:22', 'db -> jean@db:2200']);
	});

	test('returns nothing for an empty file and undefined for a missing one', async () => {
		const environment = createEnvironment({ [configPath]: '' });
		assert.deepStrictEqual({ empty: await readSshConfig(configPath, environment), missing: await readSshConfig('/home/jean/.ssh/other', environment) }, { empty: [], missing: undefined });
	});
});

describe('readSshConfig includes', () => {
	test('reads included files where the directive is, relative to the .ssh folder unless the path says otherwise', async () => {
		const hosts = await readHosts([
			'Include conf.d/*.conf',
			'Include "~/shared/extra" /etc/ssh/more missing-file',
			'Host direct',
			'\tHostName direct.example.com'
		].join('\n'), {
			'/home/jean/.ssh/conf.d/10-a.conf': 'Host a\n\tHostName a.example.com',
			'/home/jean/.ssh/conf.d/20-b.conf': 'Host b\n\tHostName b.example.com\nInclude ../nested',
			'/home/jean/.ssh/conf.d/.hidden.conf': 'Host hidden',
			'/home/jean/.ssh/conf.d/notes.txt': 'Host not-a-conf',
			'/home/jean/shared/extra': 'Host extra',
			'/etc/ssh/more': 'Host system',
			'/home/jean/nested': 'Host nested'
		});
		assert.deepStrictEqual(hosts.map(describeHost), [
			'a -> jean@a.example.com:22',
			'b -> jean@b.example.com:22',
			'nested -> jean@nested:22',
			'extra -> jean@extra:22',
			'system -> jean@system:22',
			'direct -> jean@direct.example.com:22'
		]);
	});

	test('continues the open Host block in an included file and lets later settings of the including file apply', async () => {
		const hosts = await readHosts(['Host first', 'Include extra.conf', 'Host second', 'Port 2200'].join('\n'), {
			'/home/jean/.ssh/extra.conf': 'User included\nPort 2022'
		});
		assert.deepStrictEqual(hosts.map(describeHost), ['first -> included@first:2022', 'second -> jean@second:2200']);
	});

	test('stops at files that include each other and at the nesting limit', async () => {
		const chain = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`/home/jean/.ssh/level${index}`, `Host level${index}\nInclude level${index + 1}`]));
		const hosts = await readHosts('Include config\nInclude loop-a\nHost top\nInclude level0', {
			'/home/jean/.ssh/loop-a': 'Host a\nInclude loop-b',
			'/home/jean/.ssh/loop-b': 'Host b\nInclude loop-a',
			...chain
		});
		assert.deepStrictEqual(hosts.map(host => host.alias), ['a', 'b', 'top', ...Array.from({ length: 16 }, (_, index) => `level${index}`)]);
	});

	test('follows Windows paths and expands ~ to the Windows home folder', async () => {
		const home = 'C:\\Users\\Jean';
		const files = {
			[win32.join(home, '.ssh', 'config')]: 'Include conf.d/*\nHost web\nIdentityFile ~/.ssh/id_ed25519',
			[win32.join(home, '.ssh', 'conf.d', 'one')]: 'Host one\nIdentityFile "~\\keys\\one"'
		};
		const hosts = await readSshConfig(win32.join(home, '.ssh', 'config'), createEnvironment(files, win32, home));
		assert.deepStrictEqual(hosts?.map(describeHost), [
			'one -> jean@one:22 key=C:\\Users\\Jean\\keys\\one',
			'web -> jean@web:22 key=C:\\Users\\Jean\\.ssh\\id_ed25519'
		]);
	});
});

describe('hostsToImport', () => {
	test('leaves out hosts that are already connections, and keeps the ones that differ in any detail', () => {
		const host = (alias: string, port = 22): SshConfigHost => ({ alias, hostName: `${alias}.example.com`, user: 'deploy', port });
		const saved: RemoteProfile = { id: 'x', name: 'web', host: 'web.example.com', port: 22, username: 'deploy', root: '/srv', authentication: 'agent' };
		assert.deepStrictEqual(hostsToImport([host('web'), host('web', 2222), host('db')], [saved]).map(describeHost), [
			'web -> deploy@web.example.com:2222',
			'db -> deploy@db.example.com:22'
		]);
	});
});

describe('profileFromHost', () => {
	const host: SshConfigHost = { alias: 'web', hostName: 'web.example.com', user: 'deploy', port: 2222 };

	test('chooses the authentication from the key and the agent, and never carries a secret', () => {
		const profile = (candidate: SshConfigHost, agentAvailable: boolean) => profileFromHost(candidate, { id: 'id', agentAvailable });
		assert.deepStrictEqual([profile({ ...host, identityFile: '/k' }, true), profile(host, true), profile(host, false)], [
			{ id: 'id', name: 'web', host: 'web.example.com', port: 2222, username: 'deploy', root: '/', authentication: 'privateKey', privateKeyPath: '/k', proxyJump: undefined },
			{ id: 'id', name: 'web', host: 'web.example.com', port: 2222, username: 'deploy', root: '/', authentication: 'agent', privateKeyPath: undefined, proxyJump: undefined },
			{ id: 'id', name: 'web', host: 'web.example.com', port: 2222, username: 'deploy', root: '/', authentication: 'password', privateKeyPath: undefined, proxyJump: undefined }
		]);
	});

	test('carries the jump hosts of the host', () => {
		assert.strictEqual(profileFromHost({ ...host, proxyJump: 'ops@bastion:2200' }, { id: 'id', agentAvailable: false }).proxyJump, 'ops@bastion:2200');
	});
});
