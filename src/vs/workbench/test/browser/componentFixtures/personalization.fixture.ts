/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, getWindow } from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationService, IConfigurationUpdateOverrides, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { PersonalizationEditor } from '../../../contrib/personalization/browser/personalizationEditor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { WorkspaceAppearanceService } from '../../../services/themes/browser/workspaceAppearanceService.js';
import { IWorkbenchFileIconTheme, IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IWorkspaceAppearanceService } from '../../../services/themes/common/workspaceAppearance.js';
import { TestContextService, TestStorageService } from '../../common/workbenchTestServices.js';
import { ComponentFixtureContext, createEditorServices, defineComponentFixture, defineThemedFixtureGroup } from './fixtureUtils.js';

/** Keeps the values the page writes in memory, so that the fixture can show a page that is used. */
class FixtureConfigurationService extends TestConfigurationService {
	readonly userValues = new Map<string, unknown>();

	constructor(private readonly defaults: Record<string, unknown>, userValues: Record<string, unknown>) {
		super();
		for (const [key, value] of Object.entries(userValues)) {
			this.userValues.set(key, value);
		}
	}

	override getValue<T>(key?: string | IConfigurationOverrides): T | undefined {
		return typeof key === 'string' ? (this.userValues.get(key) ?? this.defaults[key]) as T : undefined;
	}

	override inspect<T>(key: string): IConfigurationValue<T> {
		const userValue = this.userValues.get(key) as T | undefined;
		const defaultValue = this.defaults[key] as T;
		return { value: userValue ?? defaultValue, defaultValue, userValue };
	}

	override async updateValue(key: string, value: unknown, _target?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides): Promise<void> {
		if (value === undefined) {
			this.userValues.delete(key);
		} else {
			this.userValues.set(key, value);
		}
		this.onDidChangeConfigurationEmitter.fire({ source: ConfigurationTarget.USER, affectedKeys: new Set([key]), change: { keys: [key], overrides: [] }, affectsConfiguration: () => true });
	}
}

const defaults: Record<string, unknown> = {
	'workbench.editor.tabPosition': 'top',
	'workbench.editor.verticalTabsWidth': 240,
	'workbench.editor.tabGroups.enabled': true,
	'workbench.editor.showTabs': 'multiple',
	'breadcrumbs.enabled': true,
	'workbench.sideBar.location': 'left',
	'workbench.activityBar.location': 'default',
	'window.density.layout': 'default',
	'workbench.experimental.modernUI': true,
	'workbench.experimental.modernUIEditorTabStyle': 'connected',
	'workbench.editor.tabGroups.autoGroupRules': []
};

function registerFixtureSettings(): { dispose(): void } {
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const known = registry.getConfigurationProperties();
	const properties: NonNullable<IConfigurationNode['properties']> = {};
	for (const [key, value] of Object.entries(defaults)) {
		if (!known[key]) {
			properties[key] = { type: Array.isArray(value) ? 'array' : typeof value as 'string' | 'number' | 'boolean', default: value, scope: ConfigurationScope.WINDOW };
		}
	}
	const node: IConfigurationNode = { id: 'personalizationFixture', properties };
	registry.registerConfiguration(node);
	return toDisposable(() => registry.deregisterConfigurations([node]));
}

function renderPersonalization({ container, disposableStore, theme }: ComponentFixtureContext, width: number, userValues: Record<string, unknown> = {}): void {
	container.style.width = `${width}px`;
	container.style.height = '1500px';
	disposableStore.add(registerFixtureSettings());

	const configurationService = new FixtureConfigurationService(defaults, userValues);
	const storage = disposableStore.add(new TestStorageService());
	const contextService = new TestContextService(testWorkspace(URI.file('/workspace')));
	const appearanceService = disposableStore.add(new WorkspaceAppearanceService(storage, contextService, configurationService));
	const fileIconTheme = new class extends mock<IWorkbenchFileIconTheme>() { override readonly label = 'Seti (Visual Studio Code)'; }();
	const themeService = new class extends mock<IWorkbenchThemeService>() {
		override readonly onDidColorThemeChange = Event.None;
		override readonly onDidFileIconThemeChange = Event.None;
		override getColorTheme() { return theme; }
		override getFileIconTheme() { return fileIconTheme; }
	}();

	const instantiationService = createEditorServices(disposableStore, {
		colorTheme: theme,
		additionalServices: registration => {
			registration.defineInstance(IWorkbenchThemeService, themeService);
			registration.defineInstance(IStorageService, storage);
			registration.defineInstance(IWorkspaceContextService, contextService);
			registration.defineInstance(IWorkspaceAppearanceService, appearanceService);
			registration.defineInstance(IConfigurationService, configurationService);
		}
	});

	const group = new class extends mock<IEditorGroup>() {
		override readonly id = 1;
		override readonly windowId = getWindow(container).vscodeWindowId;
	}();
	const editor = disposableStore.add(instantiationService.createInstance(PersonalizationEditor, group));
	editor.create(container);
	editor.layout(new Dimension(width, 1500));
}

export default defineThemedFixtureGroup({ path: 'workbench/personalization/' }, {
	Wide: defineComponentFixture({
		labels: { kind: 'screenshot' },
		additionalThemes: ['darkHighContrast', 'lightHighContrast'],
		render: context => renderPersonalization(context, 960, { 'workbench.experimental.modernUIEditorTabStyle': 'pill' }),
	}),
	ModernUIOff: defineComponentFixture({
		labels: { kind: 'screenshot' },
		render: context => renderPersonalization(context, 960, { 'workbench.experimental.modernUI': false }),
	}),
	Narrow: defineComponentFixture({
		labels: { kind: 'screenshot' },
		render: context => renderPersonalization(context, 480),
	}),
});
