/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import {
	IHimWhisperDiagnostics,
	IHimWhisperDownloadResult,
	IHimWhisperService,
	IHimWhisperTranscribeResult,
} from '../../../../platform/himWhisper/common/himWhisper.js';

export class NullHimWhisperService implements IHimWhisperService {
	readonly _serviceBrand: undefined;

	async transcribePcmWav(_wav: VSBuffer): Promise<IHimWhisperTranscribeResult> {
		return { ok: false, error: 'Local whisper is only available in the desktop app.' };
	}

	async getDiagnostics(): Promise<IHimWhisperDiagnostics> {
		return {
			cliResolvedPath: '',
			cliFound: false,
			modelResolvedPath: '',
			modelFound: false,
			whisperHomeDir: '',
		};
	}

	async downloadDefaultModel(): Promise<IHimWhisperDownloadResult> {
		return { ok: false, error: 'Local whisper is only available in the desktop app.' };
	}
}
