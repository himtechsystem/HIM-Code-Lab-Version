/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'minimax' | 'openaiCompatible';
export type MessageRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
	role: MessageRole;
	content: string;
}

export interface ResolvedChatConfig {
	provider: ProviderKind;
	apiKey: string;
	baseUrl: string;
	model: string;
	systemPrompt: string;
	temperature: number;
	maxTokens: number;
	timeoutMs: number;
	historyTurns: number;
	requestPath: string;
	anthropicVersion: string;
	minimaxGroupId: string;
}

export interface ProviderResponsePayload {
	text: string;
	thinking?: string;
}

export interface CustomModelConfig {
	id: string;
	provider: ProviderKind;
	baseUrl: string;
	model: string;
	apiKey: string;
}

export interface ViewMessage {
	role: 'user' | 'assistant';
	content: string;
	thinking?: string;
	thinkingDurationMs?: number;
	isError?: boolean;
}

export interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start(): void;
	stop(): void;
	onresult: ((event: any) => void) | null;
	onerror: ((event: any) => void) | null;
	onend: (() => void) | null;
}

export const CONFIG_ROOT = 'himCode.chat';
export const SECRET_KEY_PREFIX = 'himCode.chat.providerKey.';
export const CHAT_PANE_MIN_WIDTH = 440;
export const PROVIDER_PICKER_WIDTH = 120;
export const DEFAULT_CUSTOM_MODEL_ID = 'gemini-default';

export const DEFAULT_CUSTOM_MODELS: ReadonlyArray<CustomModelConfig> = [{
	id: DEFAULT_CUSTOM_MODEL_ID,
	provider: 'gemini',
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
	model: 'gemini-2.5-flash',
	apiKey: '',
}];