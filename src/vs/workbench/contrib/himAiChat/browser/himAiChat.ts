/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

// Use a new ID to force a fresh registration in the AuxiliaryBar (Right Side)
export const HIM_AI_CHAT_CONTAINER_ID = 'workbench.view.himAiChat.v2';
export const HIM_AI_CHAT_VIEW_ID = 'him.ai.chat.view.v2';

export const himAiChatIcon = registerIcon('him-ai-chat-icon', Codicon.sparkle, localize('himAiChatIcon', 'Icon for HIM CODE.'));
