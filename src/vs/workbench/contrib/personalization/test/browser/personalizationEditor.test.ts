/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationUpdateOverrides, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { NullTelemetryServiceShape } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchColorTheme, IWorkbenchFileIconTheme, IWorkbenchThemeService } from '../../../../services/themes/common/workbenchThemeService.js';
import { WorkspaceAppearanceService } from '../../../../services/themes/browser/workspaceAppearanceService.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { TestContextService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { PersonalizationEditor } from '../../browser/personalizationEditor.js';

suite('Personalization editor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const tabPosition = 'workbench.editor.tabPosition';

	/** A configuration whose writes stay pending until the test completes them. */
	class PendingConfigurationService extends TestConfigurationService {
		readonly updates: { key: string; value: unknown; target: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides | undefined }[] = [];
		readonly saved = new DeferredPromise<void>();
		userValue: string | undefined;

		override inspect<T>(key: string): IConfigurationValue<T> {
			return { value: (this.userValue ?? 'top') as T, defaultValue: 'top' as T, userValue: this.userValue as T };
		}

		override async updateValue(key: string, value: unknown, target?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides): Promise<void> {
			this.updates.push({ key, value, target });
			await this.saved.p;
			this.userValue = typeof value === 'string' ? value : undefined;
			this.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([key]), change: { keys: [key], overrides: [] }, affectsConfiguration: () => true });
		}
	}

	function createEditor(userValue?: string) {
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		if (!registry.getConfigurationProperties()[tabPosition]) {
			const node: IConfigurationNode = {
				id: 'personalizationEditorTest',
				properties: { [tabPosition]: { type: 'string', default: 'top', enum: ['top', 'left', 'right'], scope: ConfigurationScope.WINDOW } }
			};
			registry.registerConfiguration(node);
			store.add(toDisposable(() => registry.deregisterConfigurations([node])));
		}
		const parent = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(parent);
		store.add(toDisposable(() => parent.remove()));
		const configurationService = new PendingConfigurationService();
		configurationService.userValue = userValue;
		const colorTheme = new class extends mock<IWorkbenchColorTheme>() {
			override readonly label = 'Test Theme';
			override readonly type = ColorScheme.DARK;
		}();
		const fileIconTheme = new class extends mock<IWorkbenchFileIconTheme>() {
			override readonly label = 'Test Icons';
		}();
		const themeService = new class extends mock<IWorkbenchThemeService>() {
			override readonly onDidColorThemeChange = Event.None;
			override readonly onDidFileIconThemeChange = Event.None;
			override getColorTheme() { return colorTheme; }
			override getFileIconTheme() { return fileIconTheme; }
		}();
		const storage = store.add(new TestStorageService());
		const contextService = new TestContextService();
		const appearanceService = store.add(new WorkspaceAppearanceService(storage, contextService));
		const editor = store.add(new PersonalizationEditor(
			new class extends mock<IEditorGroup>() {
				override readonly id = 1;
				override readonly windowId = mainWindow.vscodeWindowId;
			}(),
			new NullTelemetryServiceShape(),
			themeService,
			storage,
			configurationService,
			new class extends mock<ICommandService>() { }(),
			contextService,
			appearanceService,
			new TestNotificationService()
		));
		editor.create(parent);
		editor.layout(new Dimension(900, 700));
		const control = <T extends HTMLElement = HTMLButtonElement>(key: string) => parent.querySelector<T>(`[data-focus-key="${key}"]`)!;
		return {
			configurationService,
			appearanceService,
			parent,
			control,
			row: control(`${tabPosition}:left`).closest('.personalization-setting')!,
			savedColor: () => storage.getObject('workbench.workspaceAppearance', StorageScope.WORKSPACE),
		};
	}

	function type(input: HTMLInputElement, value: string): void {
		input.focus();
		input.value = value;
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
	}

	function press(element: HTMLElement, key: string): void {
		element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	}

	test('keeps keyboard focus on a setting while it saves', async () => {
		const { configurationService, control, row } = createEditor();
		const left = control(`${tabPosition}:left`);
		left.focus();
		left.click();
		control(`${tabPosition}:right`).click();
		const whileSaving = {
			focusedKey: (mainWindow.document.activeElement as HTMLElement).dataset.focusKey,
			disabled: left.disabled,
			ariaDisabled: left.getAttribute('aria-disabled'),
			busy: row.getAttribute('aria-busy'),
			updates: configurationService.updates.length,
		};
		configurationService.saved.complete();
		await timeout(0);

		assert.deepStrictEqual({
			whileSaving,
			afterSaving: {
				focusedKey: (mainWindow.document.activeElement as HTMLElement).dataset.focusKey,
				ariaDisabled: left.getAttribute('aria-disabled'),
				busy: row.getAttribute('aria-busy'),
				pressed: control(`${tabPosition}:left`).getAttribute('aria-pressed'),
			}
		}, {
			whileSaving: { focusedKey: `${tabPosition}:left`, disabled: false, ariaDisabled: 'true', busy: 'true', updates: 1 },
			afterSaving: { focusedKey: `${tabPosition}:left`, ariaDisabled: null, busy: null, pressed: 'true' }
		});
	});

	test('moves focus to the setting when resetting it disables the reset button', async () => {
		const { configurationService, control } = createEditor('left');
		const reset = control(`${tabPosition}:reset`);
		reset.focus();
		reset.click();
		configurationService.saved.complete();
		await timeout(0);

		assert.deepStrictEqual({
			updates: configurationService.updates,
			resetDisabled: reset.disabled,
			focusedKey: (mainWindow.document.activeElement as HTMLElement).dataset.focusKey,
		}, {
			updates: [{ key: tabPosition, value: undefined, target: ConfigurationTarget.USER }],
			resetDisabled: true,
			focusedKey: `${tabPosition}:top`,
		});
	});

	test('previews a typed hex color live and saves it only when applied', () => {
		const { appearanceService, control, savedColor } = createEditor();
		const input = control<HTMLInputElement>('color:hex');
		const apply = control('color:apply');
		const idle = { applyAriaDisabled: apply.getAttribute('aria-disabled') };

		type(input, '3B82F6');
		const typed = { shown: appearanceService.appearance, saved: savedColor(), applyAriaDisabled: apply.getAttribute('aria-disabled') };
		type(input, '#3B82');
		const incomplete = { shown: appearanceService.appearance, applyAriaDisabled: apply.getAttribute('aria-disabled') };
		type(input, '');
		const cleared = { shown: appearanceService.appearance, applyAriaDisabled: apply.getAttribute('aria-disabled') };
		type(input, '#16A34A');
		press(input, 'Enter');

		assert.deepStrictEqual({ idle, typed, incomplete, cleared, applied: { shown: appearanceService.appearance, saved: savedColor(), input: input.value, applyAriaDisabled: apply.getAttribute('aria-disabled') } }, {
			idle: { applyAriaDisabled: 'true' },
			typed: { shown: { color: '#3b82f6', style: 'subtle' }, saved: undefined, applyAriaDisabled: null },
			incomplete: { shown: { color: '#3b82f6', style: 'subtle' }, applyAriaDisabled: null },
			cleared: { shown: undefined, applyAriaDisabled: 'true' },
			applied: { shown: { color: '#16a34a', style: 'subtle' }, saved: { color: '#16a34a', style: 'subtle' }, input: '#16a34a', applyAriaDisabled: 'true' },
		});
	});

	test('explains an invalid hex color only when it is applied', () => {
		const { appearanceService, control, parent } = createEditor();
		const input = control<HTMLInputElement>('color:hex');

		type(input, '#12');
		const error = () => parent.querySelector('.personalization-color-error')?.textContent;
		const whileTyping = { error: error(), invalid: input.getAttribute('aria-invalid') };
		press(input, 'Enter');

		assert.deepStrictEqual({ whileTyping, afterEnter: { error: error(), invalid: input.getAttribute('aria-invalid'), focused: mainWindow.document.activeElement === input }, shown: appearanceService.appearance }, {
			whileTyping: { error: '', invalid: null },
			afterEnter: { error: 'Enter a hex color, such as #3b82f6.', invalid: 'true', focused: true },
			shown: undefined,
		});
	});

	test('discards an unapplied hex color on Escape, when focus leaves and when another preview takes over', () => {
		const { appearanceService, control } = createEditor();
		const input = control<HTMLInputElement>('color:hex');
		const outcome = () => ({ shown: appearanceService.appearance?.color, input: input.value });

		type(input, '#3b82f6');
		press(input, 'Escape');
		const escaped = outcome();

		// The window of a test run is not focused, so the focus change is simulated.
		const leaveFor = (target: HTMLElement) => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: target }));
		type(input, '#3b82f6');
		leaveFor(control('color:apply'));
		const toApply = outcome();
		leaveFor(control('color:none'));
		const blurred = outcome();

		type(input, '#3b82f6');
		const other = appearanceService.beginPreview();
		other.update({ color: '#9333ea', style: 'subtle' });
		const superseded = outcome();
		other.dispose();

		assert.deepStrictEqual({ escaped, toApply, blurred, superseded, afterwards: outcome() }, {
			escaped: { shown: undefined, input: '' },
			toApply: { shown: '#3b82f6', input: '#3b82f6' },
			blurred: { shown: undefined, input: '' },
			superseded: { shown: '#9333ea', input: '#9333ea' },
			afterwards: { shown: undefined, input: '' },
		});
	});

	test('draws every palette color as the surface it tints', () => {
		const { parent } = createEditor();
		const swatches = [...parent.querySelectorAll<HTMLElement>('.personalization-palette .workspace-color-swatch')];
		const chip = (swatch: HTMLElement) => swatch.querySelector<HTMLElement>('.workspace-color-chip');

		assert.deepStrictEqual({
			count: swatches.length,
			none: { background: swatches[0].style.backgroundColor, crossedOut: chip(swatches[0])?.classList.contains('no-color') },
			azure: { name: swatches[2].textContent, background: swatches[2].style.backgroundColor, foreground: swatches[2].style.color, marker: chip(swatches[2])?.style.backgroundColor },
		}, {
			count: 9,
			none: { background: '', crossedOut: true },
			azure: { name: 'Azure', background: 'rgb(29, 41, 61)', foreground: 'rgb(244, 246, 248)', marker: 'rgb(96, 165, 250)' },
		});
	});
});
