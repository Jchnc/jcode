/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import { SftpConnections } from '../connection';
import { LinkCounter, type ExecResult, type LinkCountFailure } from '../linkCounter';
import { createStorage, FakeServer } from './fakeSsh';

describe('LinkCounter', () => {
	/** A counter whose commands are answered by `answer`, with a clock that only moves when told to. */
	function create(answer: (path: string) => ExecResult | undefined = () => ({ output: '1\n', code: 0 })) {
		let now = 0;
		const commands: string[] = [];
		const failures: LinkCountFailure[] = [];
		const counter = new LinkCounter(
			async command => {
				commands.push(command);
				return answer(command);
			},
			failure => failures.push(failure),
			() => now,
			1000
		);
		return { counter, commands: () => commands.length, failures, advance: (milliseconds: number) => { now += milliseconds; } };
	}

	test('asks the server once while a count is fresh, and again after it expires', async () => {
		const { counter, commands, advance } = create(() => ({ output: '2\n', code: 0 }));
		const counts = [await counter.count('/srv/a'), await counter.count('/srv/a'), await counter.count('/srv/b')];
		const whileFresh = commands();
		advance(1000);
		counts.push(await counter.count('/srv/a'));
		assert.deepStrictEqual({ counts, whileFresh, afterExpiry: commands() }, { counts: [2, 2, 2, 2], whileFresh: 2, afterExpiry: 3 });
	});

	test('forgets a path and everything below it when told it changed', async () => {
		const { counter, commands } = create();
		for (const path of ['/srv/app', '/srv/app/a.txt', '/srv/app/src/b.txt', '/srv/apple.txt', '/srv/other']) {
			await counter.count(path);
		}
		counter.invalidate('/srv/app');
		const before = commands();
		for (const path of ['/srv/app', '/srv/app/a.txt', '/srv/app/src/b.txt', '/srv/apple.txt', '/srv/other']) {
			await counter.count(path);
		}
		const asked = commands() - before;
		counter.clear();
		await counter.count('/srv/other');
		assert.deepStrictEqual({ asked, afterClear: commands() - before - asked }, { asked: 3, afterClear: 1 });
	});

	test('stops asking once the server refuses to run commands', async () => {
		const { counter, commands, failures } = create(() => undefined);
		const counts = [await counter.count('/srv/a'), await counter.count('/srv/a'), await counter.count('/srv/b')];
		assert.deepStrictEqual({ counts, commands: commands(), failures }, { counts: [undefined, undefined, undefined], commands: 1, failures: ['refused'] });
	});

	test('stops asking after an answer that is not a POSIX link count', async () => {
		const answers: Record<string, ExecResult> = {
			// A Windows OpenSSH server running cmd.exe or PowerShell can exit cleanly without printing a count.
			windows: { output: 'The system cannot find the path specified.\r\n', code: 0 },
			emptyOutput: { output: '', code: 0 },
			commandNotFound: { output: '', code: 127 },
			signal: { output: '', code: null }
		};
		const outcomes: Record<string, object> = {};
		for (const [name, result] of Object.entries(answers)) {
			const { counter, commands, failures } = create(() => result);
			const counts = [await counter.count('/srv/a'), await counter.count('/srv/a')];
			outcomes[name] = { counts, commands: commands(), failures };
		}
		const same = { counts: [undefined, undefined], commands: 1, failures: ['unexpected-result'] };
		assert.deepStrictEqual(outcomes, { windows: same, emptyOutput: same, commandNotFound: same, signal: same });
	});

	test('keeps asking after stat fails for one file on a server that already printed counts', async () => {
		const { counter, commands, failures } = create(command => command.includes('/srv/gone') ? { output: '', code: 1 } : { output: '2\n', code: 0 });
		const counts = [await counter.count('/srv/a'), await counter.count('/srv/gone'), await counter.count('/srv/b')];
		assert.deepStrictEqual({ counts, commands: commands(), failures }, { counts: [2, undefined, 2], commands: 3, failures: [] });
	});
});

describe('SftpConnections link counts', () => {
	async function connect(answer: FakeServer['answer']): Promise<{ connections: SftpConnections; server: FakeServer; notes: string[] }> {
		const server = new FakeServer();
		server.answer = answer;
		const notes: string[] = [];
		const connections = new SftpConnections(createStorage(), { createClient: () => server.client(), log: { info: message => notes.push(message) } });
		await connections.sftp('a');
		return { connections, server, notes };
	}

	test('runs stat once per file until it changes', async () => {
		const { connections, server } = await connect(() => ({ output: '3\n', code: 0 }));
		const counts = [await connections.linkCount('a', '/srv/a.txt'), await connections.linkCount('a', '/srv/a.txt')];
		const cached = server.commands.length;
		connections.invalidateLinkCounts('a', '/srv/a.txt');
		counts.push(await connections.linkCount('a', '/srv/a.txt'));
		assert.deepStrictEqual({ counts, cached, afterChange: server.commands.length }, { counts: [3, 3, 3], cached: 1, afterChange: 2 });
	});

	test('does not run commands again on a server that refuses them, until it connects again', async () => {
		const { connections, server, notes } = await connect(() => 'refuse');
		const counts = [await connections.linkCount('a', '/srv/a.txt'), await connections.linkCount('a', '/srv/b.txt')];
		const refused = server.commands.length;
		server.answer = () => ({ output: '1\n', code: 0 });
		connections.reconnect('a');
		counts.push(await connections.linkCount('a', '/srv/b.txt'));
		assert.deepStrictEqual({ counts, refused, afterReconnect: server.commands.length, notes }, {
			counts: [undefined, undefined, 1],
			refused: 1,
			afterReconnect: 2,
			notes: ['prod.example.com:22 does not run commands, so saves assume that files have a single hard link.']
		});
	});

	test('treats a server that exits cleanly without a count as not POSIX', async () => {
		const { connections, server, notes } = await connect(() => ({ output: 'stat is not recognized as an internal or external command.\r\n', code: 0 }));
		const counts = [await connections.linkCount('a', '/C:/data/a.txt'), await connections.linkCount('a', '/C:/data/a.txt')];
		assert.deepStrictEqual({ counts, commands: server.commands.length, notes }, {
			counts: [undefined, undefined],
			commands: 1,
			notes: ['prod.example.com:22 did not report a hard link count, which suggests it is not a POSIX server, so saves assume that files have a single hard link.']
		});
	});
});
