/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecipheriv, randomUUID, scrypt } from 'node:crypto';
import { l10n } from 'vscode';
import { RemoteProfile } from './connection';

interface ExportedConnection extends Omit<RemoteProfile, 'id'> {
	credential?: string;
}

export interface ImportedConnection {
	profile: RemoteProfile;
	credential?: string;
}

const kdfOptions = { cost: 32768, blockSize: 8, parallelization: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, kdfOptions, (error, key) => error ? reject(error) : resolve(key)));
}

function readJson(json: string): Record<string, unknown> {
	const data: unknown = JSON.parse(json);
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new Error(l10n.t('Invalid connection export.'));
	}
	return data as Record<string, unknown>;
}

export function isEncryptedExport(json: string): boolean {
	return readJson(json).version === 2;
}

function decodeBase64(value: unknown, length?: number): Buffer {
	if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw new Error(l10n.t('Invalid data in connection export.'));
	}
	const decoded = Buffer.from(value, 'base64');
	if (decoded.toString('base64') !== value || (length !== undefined && decoded.length !== length)) {
		throw new Error(l10n.t('Invalid data in connection export.'));
	}
	return decoded;
}

function parseConnections(data: Record<string, unknown>, version: 1 | 2 | 3): ImportedConnection[] {
	if (!Array.isArray(data.connections) || data.connections.length > 500) {
		throw new Error(l10n.t('Expected a connection export with at most 500 connections.'));
	}
	return data.connections.map((item: unknown, index: number) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new Error(l10n.t('Connection {0} is invalid.', index + 1));
		}
		const value = item as Record<string, unknown>;
		if (typeof value.host !== 'string' || !value.host.trim() || typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
			typeof value.username !== 'string' || !value.username.trim() || typeof value.root !== 'string' || !value.root.startsWith('/') ||
			!['password', 'privateKey', 'agent'].includes(String(value.authentication)) ||
			(value.name !== undefined && typeof value.name !== 'string') ||
			(value.authentication === 'privateKey' && (typeof value.privateKeyPath !== 'string' || !value.privateKeyPath)) ||
			(version === 2 && value.credential !== undefined && typeof value.credential !== 'string') ||
			(version === 3 && ((value.credential !== undefined && typeof value.credential !== 'string') ||
				(value.credentialBase64 !== undefined && typeof value.credentialBase64 !== 'string')))) {
			throw new Error(l10n.t('Connection {0} has invalid fields.', index + 1));
		}
		const portableCredential = version === 3 ? value.credential ?? value.credentialBase64 : undefined;
		const encodedCredential = portableCredential ? decodeBase64(portableCredential) : undefined;
		if (encodedCredential && encodedCredential.length > 64 * 1024) {
			throw new Error(l10n.t('Connection {0} has an oversized credential.', index + 1));
		}
		const credential = encodedCredential ? new TextDecoder('utf-8', { fatal: true }).decode(encodedCredential) : undefined;
		return {
			profile: {
				id: randomUUID(),
				name: typeof value.name === 'string' ? value.name.trim() : undefined,
				host: value.host.trim(),
				port: value.port,
				username: value.username.trim(),
				root: value.root.replace(/\/+$/, '') || '/',
				authentication: value.authentication as RemoteProfile['authentication'],
				privateKeyPath: value.authentication === 'privateKey' && typeof value.privateKeyPath === 'string' ? value.privateKeyPath : undefined
			},
			credential: value.authentication === 'agent' ? undefined : version === 2 && typeof value.credential === 'string' && value.credential
				? value.credential
				: credential
		};
	});
}

export function exportProfiles(profiles: readonly RemoteProfile[], credentials: ReadonlyMap<string, string>): string {
	const connections: ExportedConnection[] = profiles.map(({ id, name, host, port, username, root, authentication, privateKeyPath }) => {
		const credential = authentication === 'agent' ? undefined : credentials.get(id);
		return {
			name, host, port, username, root, authentication, privateKeyPath,
			credential: credential === undefined ? undefined : Buffer.from(credential, 'utf8').toString('base64')
		};
	});
	return JSON.stringify({ version: 3, connections }, null, 2) + '\n';
}

export async function importProfiles(json: string, passphrase?: string): Promise<ImportedConnection[]> {
	const exportData = readJson(json);
	if (exportData.version === 1) {
		return parseConnections(exportData, 1);
	}
	if (exportData.version === 3) {
		return parseConnections(exportData, 3);
	}
	if (exportData.version !== 2 || exportData.encryption !== 'aes-256-gcm' || exportData.kdf !== 'scrypt' || !passphrase) {
		throw new Error(l10n.t('Unsupported connection export or missing export passphrase.'));
	}
	const salt = decodeBase64(exportData.salt, 16);
	const iv = decodeBase64(exportData.iv, 12);
	const tag = decodeBase64(exportData.tag, 16);
	const data = decodeBase64(exportData.data);
	if (data.length > 10 * 1024 * 1024) {
		throw new Error(l10n.t('Connection export is too large.'));
	}
	const key = await deriveKey(passphrase, salt);
	let decrypted: Buffer;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag);
		decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
	} catch {
		throw new Error(l10n.t('Could not decrypt the connection export. Check the passphrase and file.'));
	} finally {
		key.fill(0);
	}
	return parseConnections(readJson(decrypted.toString('utf8')), 2);
}
