/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventHelper, EventType } from '../../../../base/browser/dom.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { Color } from '../../../../base/common/color.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { isDark, isHighContrast } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_INACTIVE_BACKGROUND, WORKBENCH_BACKGROUND } from '../../../common/theme.js';
import { ensureContrastOnSurfaces, getWorkspaceColorRamp } from '../../../common/workspaceColorPalette.js';
import { IWorkspaceAppearanceService, WORKSPACE_COLOR_COMMAND_ID } from '../../../services/themes/common/workspaceAppearance.js';

/** A separate color target beside the title, leaving Command Center search intact. */
export class WorkspaceColorIndicator extends Disposable {
	readonly element = $('button.workspace-color-marker', { type: 'button' });

	constructor(
		titlebar: HTMLElement,
		hoverDelegate: IHoverDelegate,
		@IWorkspaceAppearanceService appearanceService: IWorkspaceAppearanceService,
		@IHoverService hoverService: IHoverService,
		@ICommandService commandService: ICommandService,
		@IThemeService themeService: IThemeService
	) {
		super();
		const getLabel = () => appearanceService.isAutomatic
			? localize('workspaceColor.markerAutomatic', "Change Workspace Color (Chosen Automatically)")
			: localize('workspaceColor.marker', "Change Workspace Color");
		this._register(hoverService.setupManagedHover(hoverDelegate, this.element, getLabel));
		const update = () => {
			this.element.setAttribute('aria-label', getLabel());
			const appearance = appearanceService.appearance;
			const theme = themeService.getColorTheme();
			this.element.hidden = !appearance;
			titlebar.classList.toggle('workspace-colored', !!appearance && !isHighContrast(theme.type));
			if (appearance) {
				const marker = Color.fromHex(getWorkspaceColorRamp(appearance.color, isDark(theme.type)).marker);
				// Resolved once against both title bar surfaces, so the inactive one can never undo what the active one needs.
				const surfaces = [TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_INACTIVE_BACKGROUND].map(backgroundId => theme.getColor(backgroundId)?.makeOpaque(WORKBENCH_BACKGROUND(theme)) ?? WORKBENCH_BACKGROUND(theme));
				this.element.style.color = ensureContrastOnSurfaces(marker, surfaces, 3).toString();
			} else {
				this.element.style.color = '';
			}
		};
		update();
		this._register(appearanceService.onDidChangeAppearance(update));
		this._register(themeService.onDidColorThemeChange(update));
		this._register(addDisposableListener(this.element, EventType.CLICK, event => {
			EventHelper.stop(event);
			commandService.executeCommand(WORKSPACE_COLOR_COMMAND_ID, this.element).catch(onUnexpectedError);
		}));
	}
}
