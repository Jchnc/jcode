/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PersonalizationEditorInput } from '../common/personalizationEditorInput.js';
import { PersonalizationEditor } from './personalizationEditor.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(PersonalizationEditor, PersonalizationEditor.ID, localize('personalization.editor', "JCode Personalization")),
	[new SyncDescriptor(PersonalizationEditorInput)]
);

class PersonalizationEditorSerializer implements IEditorSerializer {
	canSerialize(): boolean { return true; }
	serialize(): string { return ''; }
	deserialize(): PersonalizationEditorInput { return new PersonalizationEditorInput(); }
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(PersonalizationEditorInput.ID, PersonalizationEditorSerializer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'jcode.action.openPersonalization',
			title: localize2('personalization.open', "JCode Personalization"),
			f1: true,
			menu: [
				{ id: MenuId.GlobalActivity, group: '2_configuration', order: 2.1 },
				{ id: MenuId.MenubarPreferencesMenu, group: '2_configuration', order: 2.1 }
			]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const input = accessor.get(IInstantiationService).createInstance(PersonalizationEditorInput);
		await accessor.get(IEditorService).openEditor(input, { pinned: true, revealIfOpened: true });
	}
});
