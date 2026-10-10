/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const platforms = ['win32-x64-user', 'win32-x64', 'win32-x64-archive', 'win32-arm64-user', 'win32-arm64', 'win32-arm64-archive'];
interface ReleaseMetadata {
	commit: string;
	version: string;
	quality: string;
	platform: string;
	sha256hash: string;
	asset?: string;
	url: string;
}

interface GitHubRelease {
	draft: boolean;
	prerelease: boolean;
	tag_name: string;
	assets: { name: string; browser_download_url: string; digest?: string }[];
}

interface UpdateFeed {
	version?: string;
	productVersion?: string;
	url?: string;
	sha256hash?: string;
}

function compareVersions(a: string, b: string): number {
	const left = a.split('.').map(Number);
	const right = b.split('.').map(Number);
	return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function generateFeeds(releases: ReleaseMetadata[]): Map<string, UpdateFeed> {
	const feeds = new Map<string, UpdateFeed>();
	for (const release of releases) {
		if (!/^[a-f0-9]{40}$/.test(release.commit) || !/^\d+\.\d+\.\d+$/.test(release.version) ||
			release.quality !== 'jcode' || release.platform !== 'win32-x64-user' || !/^[a-f0-9]{64}$/.test(release.sha256hash) ||
			!release.url.startsWith('https://github.com/')) {
			throw new Error('Invalid JCode release metadata.');
		}
		if (releases.some(other => other !== release && (other.commit === release.commit || other.version === release.version))) {
			throw new Error('Each release must have a unique commit and version. Increment package.json before releasing.');
		}
		const newer = releases.filter(other => other.platform === release.platform && compareVersions(other.version, release.version) > 0)
			.sort((a, b) => compareVersions(b.version, a.version))[0];
		for (const platform of platforms) {
			feeds.set(`updates/${platform}/${release.quality}/${release.commit}.json`, platform === release.platform && newer ? {
				version: newer.commit,
				productVersion: `${newer.version}-jcode`,
				url: newer.url,
				sha256hash: newer.sha256hash
			} : {});
		}
	}
	return feeds;
}

export async function collectReleases(repository: string, fetcher: typeof fetch = fetch): Promise<ReleaseMetadata[]> {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
		throw new Error('Expected a GitHub owner/repository.');
	}
	const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	const result: ReleaseMetadata[] = [];
	for (let page = 1; ; page++) {
		const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, { headers });
		if (!response.ok) {
			throw new Error(`GitHub release listing failed: ${response.status}`);
		}
		const releases = await response.json() as GitHubRelease[];
		for (const release of releases) {
			if (release.draft || release.prerelease || !release.tag_name.startsWith('jcode-v')) {
				continue;
			}
			const metadataAsset = release.assets.find(asset => asset.name === 'jcode-update.json');
			if (!metadataAsset) {
				throw new Error(`Missing jcode-update.json on ${release.tag_name}`);
			}
			// Public URLs only: installed clients must not need GitHub credentials.
			const metadataResponse = await fetcher(metadataAsset.browser_download_url);
			if (!metadataResponse.ok) {
				throw new Error(`Cannot download metadata for ${release.tag_name}`);
			}
			const metadata = await metadataResponse.json() as ReleaseMetadata;
			const installer = release.assets.find(asset => asset.name === metadata.asset);
			if (!installer || release.tag_name !== `jcode-v${metadata.version}` || !installer.browser_download_url.startsWith(`https://github.com/${repository}/releases/download/`)) {
				throw new Error(`Invalid installer or tag on ${release.tag_name}`);
			}
			if (installer.digest && installer.digest !== `sha256:${metadata.sha256hash}`) {
				throw new Error(`Installer checksum mismatch on ${release.tag_name}`);
			}
			result.push({ ...metadata, url: installer.browser_download_url });
		}
		if (releases.length < 100) {
			return result;
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [repository, output] = process.argv.slice(2);
	if (!repository || !output) {
		throw new Error('Usage: node build/jcode/update-feed.mjs <owner/repository> <output-directory>');
	}
	const feeds = generateFeeds(await collectReleases(repository));
	if (!feeds.size) {
		throw new Error('No published JCode releases found.');
	}
	for (const [file, content] of feeds) {
		const target = join(output, file);
		await mkdir(join(target, '..'), { recursive: true });
		await writeFile(target, JSON.stringify(content) + '\n');
	}
	await writeFile(join(output, '.nojekyll'), '');
	await writeFile(join(output, 'index.html'), '<!doctype html><title>JCode Updates</title><p>JCode update feed.</p>');
}
