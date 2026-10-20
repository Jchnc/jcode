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
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationUpdateOverrides, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationHandle, IPromptChoice, NotificationMessage, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { NullTelemetryServiceShape } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { ColorScheme } from '../../../../../platform/theme/common/theme.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchColorTheme, IWorkbenchFileIconTheme, IWorkbenchThemeService } from '../../../../services/themes/common/workbenchThemeService.js';
import { WorkspaceAppearanceService } from '../../../../services/themes/browser/workspaceAppearanceService.js';
import { StorageScope } from '../../../../../platform/storage/common/storage.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { TestContextService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { PersonalizationEditor } from '../../browser/personalizationEditor.js';

suite('Personalization editor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const tabPosition = 'workbench.editor.tabPosition';
	const sideBarLocation = 'workbench.sideBar.location';
	const verticalTabsWidth = 'workbench.editor.verticalTabsWidth';
	const modernUI = 'workbench.experimental.modernUI';
	const tabStyle = 'workbench.experimental.modernUIEditorTabStyle';

	/** A configuration whose writes stay pending until the test completes them. */
	class PendingConfigurationService extends TestConfigurationService {
		readonly updates: { key: string; value: unknown; target: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides | undefined }[] = [];
		readonly saved = new DeferredPromise<void>();
		/** When set, every write waits for its own entry here instead of for {@link saved}, so a test can finish them one at a time. */
		readonly writes: DeferredPromise<void>[] | undefined;
		readonly userValues = new Map<string, string | number>();
		modernUIEnabled = true;

		constructor(oneWriteAtATime = false) {
			super();
			this.writes = oneWriteAtATime ? [] : undefined;
		}

		override getValue<T>(key?: string | IConfigurationOverrides, overrides?: IConfigurationOverrides): T | undefined {
			return (key === modernUI ? this.modernUIEnabled : super.getValue<T>(key, overrides)) as T | undefined;
		}

		override inspect<T>(key: string): IConfigurationValue<T> {
			const userValue = this.userValues.get(key);
			const defaultValue = key === verticalTabsWidth ? 240 : 'top';
			return { value: (userValue ?? defaultValue) as T, defaultValue: defaultValue as T, userValue: userValue as T };
		}

		override async updateValue(key: string, value: unknown, target?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides): Promise<void> {
			this.updates.push({ key, value, target });
			if (this.writes) {
				const write = new DeferredPromise<void>();
				this.writes.push(write);
				await write.p;
			} else {
				await this.saved.p;
			}
			if (typeof value === 'string' || typeof value === 'number') { this.userValues.set(key, value); }
			else { this.userValues.delete(key); }
			this.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([key]), change: { keys: [key], overrides: [] }, affectsConfiguration: () => true });
		}
	}

	/** Records the prompts it is asked to show, with whether each is still showing. */
	class RecordingNotificationService extends TestNotificationService {
		readonly prompts: { readonly message: string; readonly labels: string[]; readonly choose: () => void; closed: boolean }[] = [];

		override prompt(_severity: Severity, message: NotificationMessage, choices: IPromptChoice[]): INotificationHandle {
			const prompt = { message: String(message), labels: choices.map(choice => choice.label), choose: () => choices[0].run(), closed: false };
			this.prompts.push(prompt);
			return new class extends mock<INotificationHandle>() { override close() { prompt.closed = true; } }();
		}
	}

	function createEditor(userValues: Record<string, string | number> = {}, oneWriteAtATime = false, folders: URI[] = []) {
		const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		const properties: IConfigurationNode['properties'] = {};
		for (const key of [tabPosition, sideBarLocation]) {
			if (!registry.getConfigurationProperties()[key]) {
				properties[key] = { type: 'string', default: 'top', enum: ['top', 'left', 'right'], scope: ConfigurationScope.WINDOW };
			}
		}
		for (const key of [tabStyle]) {
			if (!registry.getConfigurationProperties()[key]) {
				properties[key] = { type: 'string', default: 'connected', enum: ['connected', 'pill'], scope: ConfigurationScope.WINDOW };
			}
		}
		if (!registry.getConfigurationProperties()[modernUI]) {
			properties[modernUI] = { type: 'boolean', default: true, scope: ConfigurationScope.WINDOW };
		}
		if (!registry.getConfigurationProperties()[verticalTabsWidth]) {
			properties[verticalTabsWidth] = { type: 'number', default: 240, minimum: 140, maximum: 500, scope: ConfigurationScope.WINDOW };
		}
		if (Object.keys(properties).length) {
			const node: IConfigurationNode = { id: 'personalizationEditorTest', properties };
			registry.registerConfiguration(node);
			store.add(toDisposable(() => registry.deregisterConfigurations([node])));
		}
		const parent = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(parent);
		store.add(toDisposable(() => parent.remove()));
		const configurationService = new PendingConfigurationService(oneWriteAtATime);
		for (const [key, value] of Object.entries(userValues)) { configurationService.userValues.set(key, value); }
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
		const contextService = new TestContextService(folders.length ? testWorkspace(...folders) : undefined);
		const appearanceService = store.add(new WorkspaceAppearanceService(storage, contextService, configurationService));
		const notificationService = new RecordingNotificationService();
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
			notificationService
		));
		editor.create(parent);
		editor.layout(new Dimension(900, 700));
		const control = <T extends HTMLElement = HTMLButtonElement>(key: string) => parent.querySelector<T>(`[data-focus-key="${key}"]`)!;
		return {
			configurationService,
			appearanceService,
			notificationService,
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

	test('saves the newest vertical tab width chosen while an earlier one is saving', async () => {
		const { configurationService, control, parent } = createEditor({}, true);
		const slider = control<HTMLInputElement>(verticalTabsWidth);
		const drag = (width: number) => {
			slider.value = String(width);
			slider.dispatchEvent(new mainWindow.Event('change', { bubbles: true }));
		};
		const state = () => ({ updates: configurationService.updates.map(update => update.value), shown: slider.value, busy: slider.closest('.personalization-setting')!.getAttribute('aria-busy') });
		const complete = async (index: number) => {
			configurationService.writes![index].complete();
			await timeout(0);
		};

		drag(300);
		drag(350);
		drag(400);
		const whileFirstSaves = state();
		await complete(0);
		const whileLastSaves = state();
		await complete(1);

		assert.deepStrictEqual({ whileFirstSaves, whileLastSaves, afterwards: { ...state(), saved: configurationService.userValues.get(verticalTabsWidth), status: parent.querySelector('.personalization-status')?.textContent } }, {
			whileFirstSaves: { updates: [300], shown: '400', busy: 'true' },
			whileLastSaves: { updates: [300, 400], shown: '400', busy: 'true' },
			afterwards: { updates: [300, 400], shown: '400', busy: null, saved: 400, status: 'Saved to User settings.' },
		});
	});

	test('offers the editor tab styles as radios that apply at once, and asks for Modern UI when it is off', async () => {
		const { configurationService, control, parent } = createEditor({ [tabStyle]: 'pill' });
		const connected = control(`${tabStyle}:connected`);
		const pill = control(`${tabStyle}:pill`);
		const state = () => ({
			checked: [connected, pill].map(card => card.getAttribute('aria-checked')),
			tabStops: [connected, pill].map(card => card.tabIndex),
			disabled: [connected, pill].map(card => card.disabled),
			noteHidden: parent.querySelector<HTMLElement>('.personalization-style-note')!.hidden,
		});
		const initial = state();

		pill.focus();
		press(pill, 'ArrowLeft');
		const focusedAfterArrow = (mainWindow.document.activeElement as HTMLElement).dataset.focusKey;
		connected.click();
		configurationService.saved.complete();
		await timeout(0);
		const afterChoosing = { ...state(), saved: configurationService.userValues.get(tabStyle) };

		configurationService.modernUIEnabled = false;
		configurationService.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([modernUI]), change: { keys: [modernUI], overrides: [] }, affectsConfiguration: () => true });
		const whenOff = state();
		control(modernUI).click();

		assert.deepStrictEqual({ initial, focusedAfterArrow, afterChoosing, whenOff, turnedOn: configurationService.updates.at(-1) }, {
			initial: { checked: ['false', 'true'], tabStops: [-1, 0], disabled: [false, false], noteHidden: true },
			focusedAfterArrow: `${tabStyle}:connected`,
			afterChoosing: { checked: ['true', 'false'], tabStops: [0, -1], disabled: [false, false], noteHidden: true, saved: 'connected' },
			whenOff: { checked: ['true', 'false'], tabStops: [0, -1], disabled: [true, true], noteHidden: false },
			turnedOn: { key: modernUI, value: true, target: ConfigurationTarget.USER },
		});
	});

	test('moves focus to the setting when resetting it disables the reset button', async () => {
		const { configurationService, control } = createEditor({ [tabPosition]: 'left' });
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

	test('resets only the settings a section manages, at the selected scope', async () => {
		const { configurationService, control, parent } = createEditor({ [tabPosition]: 'left', [sideBarLocation]: 'right' });
		const resets = { appearance: control('section:appearance:reset'), tabs: control('section:tabs:reset'), layout: control('section:layout:reset') };
		const inert = () => Object.values(resets).map(reset => reset.getAttribute('aria-disabled') === 'true');
		const before = inert();

		resets.tabs.focus();
		resets.tabs.click();
		configurationService.saved.complete();
		await timeout(0);
		const afterTabs = { updates: configurationService.updates.map(update => update.key), inert: inert(), focusedKey: (mainWindow.document.activeElement as HTMLElement).dataset.focusKey, remaining: [...configurationService.userValues.keys()] };

		parent.querySelectorAll<HTMLElement>('.personalization-scope button')[1].click();

		assert.deepStrictEqual({ before, afterTabs, atWorkspaceScope: inert() }, {
			before: [true, false, false],
			afterTabs: { updates: [tabPosition], inert: [true, true, false], focusedKey: 'section:tabs:reset', remaining: [sideBarLocation] },
			atWorkspaceScope: [true, true, true],
		});
	});

	test('resets the workspace color without touching any setting', () => {
		const { appearanceService, configurationService, control, parent } = createEditor({ [tabPosition]: 'left' });
		const preview = appearanceService.beginPreview();
		preview.update({ color: '#3b82f6', style: 'prominent' });
		preview.apply();
		const reset = control('section:workspace:reset');
		const before = reset.getAttribute('aria-disabled');

		reset.click();

		assert.deepStrictEqual({ before, appearance: appearanceService.appearance, after: reset.getAttribute('aria-disabled'), updates: configurationService.updates, status: parent.querySelector('.personalization-status')?.textContent }, {
			before: null,
			appearance: undefined,
			after: 'true',
			updates: [],
			status: 'Workspace color reset to defaults.',
		});
	});

	test('offers to undo a reset, restoring only the settings it reset that are still at their defaults', async () => {
		const { configurationService, notificationService, control, parent } = createEditor({ [tabPosition]: 'left', [verticalTabsWidth]: 300, [sideBarLocation]: 'right' });
		control('section:tabs:reset').click();
		configurationService.saved.complete();
		await timeout(0);
		const afterReset = { prompts: notificationService.prompts.map(({ message, labels, closed }) => ({ message, labels, closed })), values: Object.fromEntries(configurationService.userValues) };

		// Changed again since the reset, so undoing must leave it alone.
		configurationService.userValues.set(tabPosition, 'right');
		notificationService.prompts[0].choose();
		await timeout(0);

		const undone = {
			updates: configurationService.updates.slice(2),
			values: Object.fromEntries(configurationService.userValues),
			closed: notificationService.prompts[0].closed,
			status: parent.querySelector('.personalization-status')?.textContent,
		};

		assert.deepStrictEqual({ afterReset, undone }, {
			afterReset: {
				prompts: [{ message: 'Editor tabs reset to defaults.', labels: ['Undo'], closed: false }],
				values: { [sideBarLocation]: 'right' },
			},
			undone: {
				updates: [{ key: verticalTabsWidth, value: 300, target: ConfigurationTarget.USER }],
				values: { [sideBarLocation]: 'right', [tabPosition]: 'right', [verticalTabsWidth]: 300 },
				closed: true,
				status: 'Editor tabs restored.',
			},
		});
	});

	test('offers to undo a workspace color reset, and only the latest reset', async () => {
		const { appearanceService, configurationService, notificationService, control, savedColor } = createEditor({ [tabPosition]: 'left' });
		const preview = appearanceService.beginPreview();
		preview.update({ color: '#3b82f6', style: 'prominent' });
		preview.apply();

		control('section:tabs:reset').click();
		configurationService.saved.complete();
		await timeout(0);
		control('section:workspace:reset').click();
		const afterReset = { appearance: appearanceService.appearance, closed: notificationService.prompts.map(prompt => prompt.closed) };
		notificationService.prompts[1].choose();

		assert.deepStrictEqual({ afterReset, restored: { appearance: appearanceService.appearance, saved: savedColor(), closed: notificationService.prompts.map(prompt => prompt.closed) } }, {
			afterReset: { appearance: undefined, closed: [true, false] },
			restored: { appearance: { color: '#3b82f6', style: 'prominent' }, saved: { color: '#3b82f6', style: 'prominent' }, closed: [true, true] },
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

	test('names the hex input after its visible label and has room for a padded paste', () => {
		const { appearanceService, control, parent, savedColor } = createEditor();
		const input = control<HTMLInputElement>('color:hex');
		const padded = ' #3b82f6 ';
		const labelId = input.getAttribute('aria-labelledby');

		type(input, padded);
		press(input, 'Enter');

		assert.deepStrictEqual({
			label: { text: labelId ? parent.querySelector(`#${labelId}`)?.textContent : undefined, ariaLabel: input.getAttribute('aria-label') },
			fitsPaddedPaste: input.maxLength >= padded.length,
			applied: { shown: appearanceService.appearance, saved: savedColor(), input: input.value },
		}, {
			label: { text: 'Custom color', ariaLabel: null },
			fitsPaddedPaste: true,
			applied: { shown: { color: '#3b82f6', style: 'subtle' }, saved: { color: '#3b82f6', style: 'subtle' }, input: '#3b82f6' },
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

	test('offers the palette as radios with one tab stop, arrow keys that only move focus, and a click that applies', () => {
		const { appearanceService, control, parent } = createEditor();
		const palette = parent.querySelector<HTMLElement>('.personalization-palette')!;
		// Whatever the stylesheet does, the palette is three columns wide here.
		palette.style.display = 'grid';
		palette.style.gridTemplateColumns = 'repeat(3, 1fr)';
		const radios = [...palette.querySelectorAll<HTMLElement>('button')];
		const state = () => ({
			checked: radios.findIndex(radio => radio.getAttribute('aria-checked') === 'true'),
			tabStop: radios.findIndex(radio => radio.tabIndex === 0),
			focused: radios.findIndex(radio => radio === mainWindow.document.activeElement),
			applied: appearanceService.appearance?.color,
		});
		const move = (from: number, key: string) => {
			press(radios[from], key);
			return state();
		};

		const initial = { group: palette.getAttribute('role'), roles: new Set(radios.map(radio => radio.getAttribute('role'))), pressed: radios.some(radio => radio.hasAttribute('aria-pressed')), ...state() };
		radios[0].focus();
		const right = move(0, 'ArrowRight');
		const down = move(1, 'ArrowDown');
		const end = move(4, 'End');
		const wrapped = move(8, 'ArrowRight');
		const other = move(0, 'a');
		radios[2].focus();
		radios[2].click();
		const clicked = state();
		const input = control<HTMLInputElement>('color:hex');
		type(input, '#123456');
		press(input, 'Enter');
		const custom = state();

		assert.deepStrictEqual({ initial, right, down, end, wrapped, other, clicked, custom }, {
			initial: { group: 'radiogroup', roles: new Set(['radio']), pressed: false, checked: 0, tabStop: 0, focused: -1, applied: undefined },
			right: { checked: 0, tabStop: 1, focused: 1, applied: undefined },
			down: { checked: 0, tabStop: 4, focused: 4, applied: undefined },
			end: { checked: 0, tabStop: 8, focused: 8, applied: undefined },
			wrapped: { checked: 0, tabStop: 0, focused: 0, applied: undefined },
			other: { checked: 0, tabStop: 0, focused: 0, applied: undefined },
			clicked: { checked: 2, tabStop: 2, focused: 2, applied: '#3b82f6' },
			custom: { checked: -1, tabStop: 0, focused: -1, applied: '#123456' },
		});
	});

	test('shows an automatic remote color as such, which a choice replaces and a reset brings back', () => {
		const { appearanceService, notificationService, control, parent, savedColor } = createEditor({}, false, [URI.from({ scheme: 'jcode-sftp', authority: 'connection-1', path: '/srv' })]);
		const palette = parent.querySelector<HTMLElement>('.personalization-palette')!;
		const radios = [...palette.querySelectorAll<HTMLElement>('button')];
		const state = () => ({
			checked: radios.findIndex(radio => radio.getAttribute('aria-checked') === 'true'),
			// What the palette is described by, so that a screen reader hears it with the checked color.
			hint: parent.querySelector(`#${palette.getAttribute('aria-describedby')}`)?.textContent,
			resetInert: control('section:workspace:reset').getAttribute('aria-disabled') === 'true',
			saved: savedColor(),
		});

		const automatic = state();
		control('color:azure').click();
		const chosen = state();
		control('color:none').click();
		const none = state();
		control('section:workspace:reset').click();
		const reset = state();
		notificationService.prompts.at(-1)!.choose();
		const undone = state();

		assert.deepStrictEqual({ automatic, chosen, none, reset, undone, appearance: appearanceService.appearance }, {
			// Coral, the color the connection is given.
			automatic: { checked: 7, hint: 'Chosen automatically for this remote workspace. Choose a color to replace it, or None to turn it off.', resetInert: true, saved: undefined },
			chosen: { checked: 2, hint: 'Only this workspace, on this device.', resetInert: false, saved: { color: '#3b82f6', style: 'subtle' } },
			none: { checked: 0, hint: 'Only this workspace, on this device.', resetInert: false, saved: { none: true } },
			reset: { checked: 7, hint: 'Chosen automatically for this remote workspace. Choose a color to replace it, or None to turn it off.', resetInert: true, saved: undefined },
			undone: { checked: 0, hint: 'Only this workspace, on this device.', resetInert: false, saved: { none: true } },
			appearance: undefined,
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
