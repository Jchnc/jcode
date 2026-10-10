/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IUntypedEditorInput } from '../../../common/editor.js';

export class PersonalizationEditorInput extends EditorInput {
	static readonly ID = 'jcode.input.personalization';
	readonly resource = undefined;

	override get typeId(): string { return PersonalizationEditorInput.ID; }
	override getName(): string { return localize('personalization.name', "Personalization"); }
	override getIcon(): ThemeIcon { return Codicon.paintcan; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || other instanceof PersonalizationEditorInput;
	}
}
