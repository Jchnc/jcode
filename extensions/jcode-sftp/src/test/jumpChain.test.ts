/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './registerVscodeStub';
import assert from 'node:assert';
import { describe, test } from 'node:test';
import type { SshClient } from '../connection';
import { JumpHopError, openJumpChain, type JumpChainOptions, type JumpHop } from '../jumpChain';
import { FakeServer, FakeTunnel } from './fakeSsh';

const bastion: JumpHop = { host: 'bastion.example.com', port: 22, username: 'admin' };
const gateway: JumpHop = { host: 'gateway.internal', port: 2200, username: 'ops' };

/** Sets up a chain through the given hops to `target.internal`, and keeps the clients it creates, as the connection does. */
function createChain(server: FakeServer, hops: JumpHop[], overrides: Partial<JumpChainOptions> = {}) {
	const registered: SshClient[] = [];
	const options: JumpChainOptions = {
		hops,
		target: { host: 'target.internal', port: 22 },
		createClient: () => server.client(),
		configure: () => ({ password: 'secret' }),
		register: client => { registered.push(client); },
		signal: new AbortController().signal,
		...overrides
	};
	return { options, registered, run: () => openJumpChain(options) };
}

/** Runs a chain that is expected to fail, and describes the failure. */
async function failure(chain: { run(): Promise<unknown> }): Promise<{ message: string; endpoint?: string; cause?: string; level?: string }> {
	try {
		await chain.run();
	} catch (error) {
		if (error instanceof JumpHopError) {
			return { message: error.message, endpoint: error.endpoint, cause: error.cause.message, level: (error.cause as Error & { level?: string }).level };
		}
		return { message: (error as Error).message };
	}
	return { message: 'connected' };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('openJumpChain', () => {
	test('connects to the first hop directly and to each next hop through the one before it', async () => {
		const server = new FakeServer();
		const chain = createChain(server, [bastion, gateway]);
		const channel = await chain.run();
		assert.deepStrictEqual({ connects: server.connects, forwards: server.forwards, reaches: (channel as FakeTunnel).destination, clients: chain.registered.length }, {
			connects: [
				{ endpoint: 'bastion.example.com:22', username: 'admin', password: 'secret', direct: true },
				{ endpoint: 'gateway.internal:2200', username: 'ops', password: 'secret', direct: false }
			],
			forwards: [
				{ from: 'bastion.example.com:22', to: 'gateway.internal:2200' },
				{ from: 'gateway.internal:2200', to: 'target.internal:22' }
			],
			reaches: 'target.internal:22',
			clients: 2
		});
	});

	test('reaches the target through a single hop, and does nothing without hops', async () => {
		const server = new FakeServer();
		const single = createChain(server, [bastion]);
		const channel = await single.run();
		const none = createChain(new FakeServer(), []);
		assert.deepStrictEqual({ forwards: server.forwards, reaches: (channel as FakeTunnel).destination, withoutHops: await none.run(), clients: none.registered.length }, {
			forwards: [{ from: 'bastion.example.com:22', to: 'target.internal:22' }],
			reaches: 'target.internal:22',
			withoutHops: undefined,
			clients: 0
		});
	});

	test('asks for the settings of each hop, including its host key check', async () => {
		const server = new FakeServer();
		const asked: string[] = [];
		const chain = createChain(server, [bastion, gateway], {
			configure: (hop, handshake) => {
				asked.push(`${hop.username}@${hop.host}:${hop.port} ${typeof handshake.pause}`);
				return { password: 'secret' };
			}
		});
		await chain.run();
		assert.deepStrictEqual(asked, ['admin@bastion.example.com:22 function', 'ops@gateway.internal:2200 function']);
	});

	test('names the hop that could not be reached', async () => {
		const server = new FakeServer();
		server.refusing.add('bastion.example.com:22');
		const chain = createChain(server, [bastion, gateway]);
		assert.deepStrictEqual({ failure: await failure(chain), clients: chain.registered.length, connects: server.connects.length }, {
			failure: {
				message: 'Could not connect through jump host bastion.example.com:22: connect ECONNREFUSED bastion.example.com:22',
				endpoint: 'bastion.example.com:22',
				cause: 'connect ECONNREFUSED bastion.example.com:22',
				level: undefined
			},
			clients: 1,
			connects: 1
		});
	});

	test('keeps the reason a hop refused the credentials, so they can be asked for again', async () => {
		const server = new FakeServer();
		server.rejecting.add('gateway.internal:2200');
		const chain = createChain(server, [bastion, gateway]);
		assert.deepStrictEqual(await failure(chain), {
			message: 'Could not connect through jump host gateway.internal:2200: All configured authentication methods failed',
			endpoint: 'gateway.internal:2200',
			cause: 'All configured authentication methods failed',
			level: 'client-authentication'
		});
	});

	test('names the hop that could not open a channel to the next host', async () => {
		const server = new FakeServer();
		server.refusing.add('target.internal:22');
		assert.deepStrictEqual(await failure(createChain(server, [bastion, gateway])), {
			message: 'Jump host gateway.internal:2200 could not open a connection to target.internal:22: Connection refused',
			endpoint: 'gateway.internal:2200',
			cause: 'Connection refused',
			level: undefined
		});
	});

	test('fails when a hop drops while the chain is being built', async () => {
		const server = new FakeServer();
		server.hold = true;
		const chain = createChain(server, [bastion, gateway]);
		const outcome = failure(chain);
		await tick();
		server.clients[0].emit('close');
		assert.deepStrictEqual(await outcome, {
			message: 'Could not connect through jump host bastion.example.com:22: The connection was closed.',
			endpoint: 'bastion.example.com:22',
			cause: 'The connection was closed.',
			level: undefined
		});
	});

	test('gives up on a hop whose handshake never finishes', async () => {
		const server = new FakeServer();
		server.hold = true;
		const chain = createChain(server, [bastion], { handshakeLimit: 20 });
		assert.deepStrictEqual(await failure(chain), {
			message: 'Could not connect through jump host bastion.example.com:22: Timed out during the SSH handshake.',
			endpoint: 'bastion.example.com:22',
			cause: 'Timed out during the SSH handshake.',
			level: undefined
		});
	});

	test('stops when the attempt is cancelled, leaving the clients it made to be closed', async () => {
		const server = new FakeServer();
		server.hold = true;
		const controller = new AbortController();
		const chain = createChain(server, [bastion, gateway], { signal: controller.signal });
		const outcome = failure(chain);
		await tick();
		controller.abort(new Error('cancelled'));
		const cancelled = { ...(await outcome), clients: chain.registered.length };
		const early = createChain(new FakeServer(), [bastion], { signal: AbortSignal.abort(new Error('already cancelled')) });
		assert.deepStrictEqual({ cancelled, early: await failure(early), earlyClients: early.registered.length }, {
			cancelled: { message: 'cancelled', clients: 1 },
			early: { message: 'already cancelled' },
			earlyClients: 0
		});
	});
});
