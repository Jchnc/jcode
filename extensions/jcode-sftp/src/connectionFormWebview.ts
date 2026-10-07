/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare function acquireVsCodeApi(): { postMessage(message: object): void };

interface FormProfile {
	name?: string;
	host: string;
	port: number;
	username: string;
	root: string;
	authentication: 'password' | 'privateKey' | 'agent';
	privateKeyPath?: string;
}

interface FormLabels {
	password: string;
	passphrase: string;
	existingCredential: string;
	newCredential: string;
	invalidRoot: string;
}

(() => {
	'use strict';
	const vscode = acquireVsCodeApi();
	const form = document.getElementById('connection-form') as HTMLFormElement;
	const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
	const authentication = document.getElementById('authentication') as HTMLSelectElement;
	const error = document.getElementById('error')!;
	let labels: FormLabels = { password: '', passphrase: '', existingCredential: '', newCredential: '', invalidRoot: '' };
	let editing = false;

	function updateMethod(): void {
		const method = authentication.value;
		document.getElementById('key-field')!.hidden = method !== 'privateKey';
		document.getElementById('credential-field')!.hidden = method === 'agent';
		input('privateKeyPath').required = method === 'privateKey';
		document.getElementById('credential-label')!.textContent = method === 'privateKey' ? labels.passphrase : labels.password;
		document.getElementById('credential-hint')!.textContent = editing ? labels.existingCredential : labels.newCredential;
	}

	function clearError(): void {
		error.hidden = true;
		error.textContent = '';
	}

	authentication.addEventListener('change', () => {
		input('credential').value = '';
		updateMethod();
	});
	form.addEventListener('input', clearError);
	input('root').addEventListener('input', () => input('root').setCustomValidity(''));
	document.getElementById('cancel')!.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
	form.addEventListener('submit', event => {
		event.preventDefault();
		if (!form.reportValidity()) { return; }
		const root = input('root');
		if (!root.value.trim().startsWith('/')) {
			root.setCustomValidity(labels.invalidRoot);
			root.reportValidity();
			return;
		}
		root.setCustomValidity('');
		const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
		vscode.postMessage({
			type: 'save',
			connect: submitter?.value === 'connect',
			profile: {
				name: input('name').value,
				host: input('host').value,
				port: input('port').value,
				username: input('username').value,
				root: root.value,
				authentication: authentication.value,
				privateKeyPath: input('privateKeyPath').value
			},
			credential: input('credential').value
		});
	});
	window.addEventListener('message', (event: MessageEvent) => {
		const message = event.data;
		if (message.type === 'init') {
			const profile = message.profile as FormProfile | undefined;
			labels = message.labels as FormLabels;
			editing = Boolean(profile);
			input('name').value = profile?.name ?? '';
			input('host').value = profile?.host ?? '';
			input('port').value = String(profile?.port ?? 22);
			input('username').value = profile?.username ?? message.username ?? '';
			input('root').value = profile?.root ?? '/';
			authentication.value = profile?.authentication ?? 'password';
			input('privateKeyPath').value = profile?.privateKeyPath ?? '';
			updateMethod();
			input('host').focus();
		} else if (message.type === 'error') {
			error.textContent = message.message;
			error.hidden = false;
		}
	});
	vscode.postMessage({ type: 'ready' });
})();
