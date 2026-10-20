/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ITabSessionsService } from '../common/tabSessionsService.js';
import './tabSessionsActions.js';
import { TabSessionsService } from './tabSessionsService.js';

registerSingleton(ITabSessionsService, TabSessionsService, InstantiationType.Delayed);
