/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Target sample rate for whisper.cpp WAV input. */
export const HIM_WHISPER_TARGET_SAMPLE_RATE = 16000;

export function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
	let len = 0;
	for (const c of chunks) {
		len += c.length;
	}
	const out = new Float32Array(len);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

export function resampleTo16kHz(input: Float32Array, inputRate: number): Float32Array {
	if (inputRate === HIM_WHISPER_TARGET_SAMPLE_RATE) {
		return input;
	}
	const ratio = inputRate / HIM_WHISPER_TARGET_SAMPLE_RATE;
	const outLen = Math.max(1, Math.floor(input.length / ratio));
	const out = new Float32Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const srcIdx = Math.min(input.length - 1, Math.floor(i * ratio));
		out[i] = input[srcIdx] ?? 0;
	}
	return out;
}

export function floatTo16BitPCM(float32: Float32Array): Int16Array {
	const out = new Int16Array(float32.length);
	for (let i = 0; i < float32.length; i++) {
		const s = Math.max(-1, Math.min(1, float32[i] ?? 0));
		out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return out;
}

/** RIFF PCM16 mono little-endian WAV. */
export function encodeWavPcm16Mono(pcm16: Int16Array, sampleRate: number): Uint8Array {
	const dataSize = pcm16.length * 2;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeStr = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) {
			view.setUint8(off + i, s.charCodeAt(i));
		}
	};

	writeStr(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeStr(8, 'WAVE');
	writeStr(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, 'data');
	view.setUint32(40, dataSize, true);

	let o = 44;
	for (let i = 0; i < pcm16.length; i++) {
		view.setInt16(o, pcm16[i]!, true);
		o += 2;
	}

	return new Uint8Array(buffer);
}

export function buildWhisperWavFromFloatChunks(chunks: Float32Array[], inputSampleRate: number): Uint8Array {
	const merged = mergeFloat32Chunks(chunks);
	const at16k = resampleTo16kHz(merged, inputSampleRate);
	const pcm = floatTo16BitPCM(at16k);
	return encodeWavPcm16Mono(pcm, HIM_WHISPER_TARGET_SAMPLE_RATE);
}
