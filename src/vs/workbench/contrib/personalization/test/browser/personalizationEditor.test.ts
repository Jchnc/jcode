/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
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
import { IWorkspaceAppearance, IWorkspaceAppearanceService } from '../../../../services/themes/common/workspaceAppearance.js';
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
		const appearanceService = new class extends mock<IWorkspaceAppearanceService>() {
			override readonly appearance: IWorkspaceAppearance | undefined = undefined;
			override readonly onDidChangeAppearance = new Emitter<void>().event;
		}();
		const editor = store.add(new PersonalizationEditor(
			new class extends mock<IEditorGroup>() {
				override readonly id = 1;
				override readonly windowId = mainWindow.vscodeWindowId;
			}(),
			new NullTelemetryServiceShape(),
			themeService,
			store.add(new TestStorageService()),
			configurationService,
			new class extends mock<ICommandService>() { }(),
			new TestContextService(),
			appearanceService,
			new TestNotificationService()
		));
		editor.create(parent);
		editor.layout(new Dimension(900, 700));
		const control = (key: string) => parent.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`)!;
		return { configurationService, control, row: control(`${tabPosition}:left`).closest('.personalization-setting')! };
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
});
