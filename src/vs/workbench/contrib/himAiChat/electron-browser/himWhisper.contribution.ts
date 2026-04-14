/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IHimWhisperService } from '../../../../platform/himWhisper/common/himWhisper.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ElectronHimWhisperService } from './himWhisperElectronService.js';

registerSingleton(IHimWhisperService, ElectronHimWhisperService, InstantiationType.Delayed);

registerAction2(class HimWhisperDownloadModelAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.downloadWhisperModel',
			title: localize2('himAiChat.downloadWhisperModel', 'Download Whisper Model (local STT)'),
			f1: true,
			category: localize2('himAiChatCategory', 'HIM CODE'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const whisper = accessor.get(IHimWhisperService);
		const notifications = accessor.get(INotificationService);
		const result = await whisper.downloadDefaultModel();
		if (result.ok) {
			notifications.info(localize('himWhisperModelDownloaded', 'Whisper model saved to: {0}', result.path ?? ''));
		} else {
			notifications.error(localize('himWhisperModelDownloadFailed', 'Whisper model download failed: {0}', result.error ?? ''));
		}
	}
});
