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
import { getWorkspaceColorRamp } from '../../../common/workspaceColorPalette.js';
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
		const label = localize('workspaceColor.marker', "Change Workspace Color");
		this.element.setAttribute('aria-label', label);
		this._register(hoverService.setupManagedHover(hoverDelegate, this.element, label));
		const update = () => {
			const appearance = appearanceService.appearance;
			const theme = themeService.getColorTheme();
			this.element.hidden = !appearance;
			titlebar.classList.toggle('workspace-colored', !!appearance && !isHighContrast(theme.type));
			if (appearance) {
				let marker = Color.fromHex(getWorkspaceColorRamp(appearance.color, isDark(theme.type)).marker);
				for (const backgroundId of [TITLE_BAR_ACTIVE_BACKGROUND, TITLE_BAR_INACTIVE_BACKGROUND]) {
					const background = theme.getColor(backgroundId)?.makeOpaque(WORKBENCH_BACKGROUND(theme)) ?? WORKBENCH_BACKGROUND(theme);
					marker = background.ensureConstrast(marker, 3);
				}
				this.element.style.color = marker.toString();
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
