/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectReleases, generateFeeds } from './update-feed.ts';

function release(version: string, digit: string) {
	return { version, commit: digit.repeat(40), quality: 'jcode', platform: 'win32-x64-user', sha256hash: 'a'.repeat(64), url: `https://github.com/example/jcode/releases/download/jcode-v${version}/setup.exe` };
}

test('old clients get the newest installer; current and unsupported clients do not update', () => {
	const first = release('1.9.0', '1');
	const middle = release('1.10.0', '2');
	const latest = release('1.11.0', '3');
	const feeds = generateFeeds([middle, latest, first]);
	assert.deepEqual([
		feeds.get(`updates/win32-x64-user/jcode/${first.commit}.json`),
		feeds.get(`updates/win32-x64-user/jcode/${middle.commit}.json`),
		feeds.get(`updates/win32-x64-user/jcode/${latest.commit}.json`),
		feeds.get(`updates/win32-x64-archive/jcode/${first.commit}.json`)
	], [
		{ version: latest.commit, productVersion: '1.11.0-jcode', url: latest.url, sha256hash: latest.sha256hash },
		{ version: latest.commit, productVersion: '1.11.0-jcode', url: latest.url, sha256hash: latest.sha256hash },
		{}, {}
	]);
});

test('refuse ambiguous versions, duplicate commits and invalid metadata', () => {
	for (const releases of [
		[release('1.0.0', '1'), release('1.0.0', '2')],
		[release('1.0.0', '1'), release('1.0.1', '1')],
		[{ ...release('1.0.0', '1'), sha256hash: '' }],
		[{ ...release('1.0.0', '1'), version: '../escape' }]
	]) {
		assert.throws(() => generateFeeds(releases));
	}
});

test('multi-platform releases choose the matching architecture and include Squirrel metadata', () => {
	const platforms = ['win32-x64-user', 'darwin', 'darwin-arm64', 'linux-x64', 'linux-arm64'];
	const entries = ['1.0.0', '1.1.0'].flatMap((version, index) => platforms.map(platform => ({
		...release(version, String(index + 1)), platform,
		url: `https://github.com/example/jcode/releases/download/jcode-v${version}/${platform}.zip`,
		publishedAt: '2026-10-10T00:00:00Z'
	})));
	const feeds = generateFeeds(entries);
	for (const platform of platforms) {
		const feed = feeds.get(`updates/${platform}/jcode/${'1'.repeat(40)}.json`);
		assert.deepEqual(feed, {
			version: '2'.repeat(40), productVersion: '1.1.0-jcode',
			url: `https://github.com/example/jcode/releases/download/jcode-v1.1.0/${platform}.zip`, sha256hash: 'a'.repeat(64),
			...(platform.startsWith('darwin') ? { name: '1.1.0-jcode', notes: '2'.repeat(40), pub_date: '2026-10-10T00:00:00Z' } : {})
		});
		assert.deepEqual(feeds.get(`updates/${platform}/jcode/${'2'.repeat(40)}.json`), {});
	}
});

test('a missing platform build stays on its latest available version', () => {
	const first = release('1.0.0', '1');
	const entries = [first, { ...first, platform: 'linux-arm64' }, release('1.1.0', '2')];
	assert.deepEqual(generateFeeds(entries).get(`updates/linux-arm64/jcode/${first.commit}.json`), {});
});

test('only published stable JCode releases with matching installer checksums enter the feed', async () => {
	const metadata = { ...release('1.0.0', '1'), asset: 'setup.exe' };
	const listing = [{ draft: true }, { prerelease: true }, { tag_name: 'unrelated' }, {
		tag_name: 'jcode-v1.0.0', assets: [
			{ name: 'jcode-update.json', browser_download_url: 'https://github.com/example/metadata' },
			{ name: 'setup.exe', browser_download_url: metadata.url, digest: `sha256:${metadata.sha256hash}` }
		]
	}];
	const fetcher: typeof fetch = async url => new Response(JSON.stringify(String(url).includes('/releases?') ? listing : metadata));
	assert.deepEqual(await collectReleases('example/jcode', fetcher), [metadata]);
	const secondPlatform = { ...metadata, platform: 'linux-x64', asset: 'linux.tar.gz', url: metadata.url.replace('setup.exe', 'linux.tar.gz') };
	listing[3].assets!.push({ name: secondPlatform.asset, browser_download_url: secondPlatform.url, digest: `sha256:${metadata.sha256hash}` });
	const arrayFetcher: typeof fetch = async url => new Response(JSON.stringify(String(url).includes('/releases?') ? listing : [metadata, secondPlatform]));
	assert.deepEqual(await collectReleases('example/jcode', arrayFetcher), [metadata, secondPlatform]);
	listing[3].assets![1].digest = 'sha256:incorrect';
	await assert.rejects(collectReleases('example/jcode', fetcher), /checksum mismatch/);
});
