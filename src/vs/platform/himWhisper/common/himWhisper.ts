/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IHimWhisperService = createDecorator<IHimWhisperService>('IHimWhisperService');

/** IPC channel name for main ↔ renderer whisper.cpp bridge. */
export const HimWhisperChannelName = 'himWhisper';

export interface IHimWhisperTranscribeResult {
	readonly ok: boolean;
	readonly text?: string;
	readonly error?: string;
}

export interface IHimWhisperDiagnostics {
	readonly cliResolvedPath: string;
	readonly cliFound: boolean;
	readonly modelResolvedPath: string;
	readonly modelFound: boolean;
	readonly whisperHomeDir: string;
}

export interface IHimWhisperDownloadResult {
	readonly ok: boolean;
	readonly path?: string;
	readonly error?: string;
}

export interface IHimWhisperService {
	readonly _serviceBrand: undefined;

	/** Run whisper.cpp on a mono PCM WAV (any sample rate whisper accepts; we send 16 kHz from the workbench). */
	transcribePcmWav(wav: VSBuffer): Promise<IHimWhisperTranscribeResult>;

	getDiagnostics(): Promise<IHimWhisperDiagnostics>;

	/** Download model from `himCode.chat.whisperModelDownloadUrl` (or built-in default if unset) into the default model path. */
	downloadDefaultModel(): Promise<IHimWhisperDownloadResult>;
}
