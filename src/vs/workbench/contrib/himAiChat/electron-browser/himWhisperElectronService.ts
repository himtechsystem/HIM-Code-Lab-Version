/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import {
	HimWhisperChannelName,
	IHimWhisperDiagnostics,
	IHimWhisperDownloadResult,
	IHimWhisperService,
	IHimWhisperTranscribeResult,
} from '../../../../platform/himWhisper/common/himWhisper.js';

export class ElectronHimWhisperService implements IHimWhisperService {

	readonly _serviceBrand: undefined;

	private readonly remote: IHimWhisperService;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this.remote = ProxyChannel.toService<IHimWhisperService>(mainProcessService.getChannel(HimWhisperChannelName));
	}

	transcribePcmWav(wav: VSBuffer): Promise<IHimWhisperTranscribeResult> {
		return this.remote.transcribePcmWav(wav);
	}

	getDiagnostics(): Promise<IHimWhisperDiagnostics> {
		return this.remote.getDiagnostics();
	}

	downloadDefaultModel(): Promise<IHimWhisperDownloadResult> {
		return this.remote.downloadDefaultModel();
	}
}
