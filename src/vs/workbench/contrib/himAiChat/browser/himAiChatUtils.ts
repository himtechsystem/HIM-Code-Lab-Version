/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProviderKind, ProviderMessage } from './himAiChatTypes.js';

export function sanitizeProvider(value: string | undefined): ProviderKind {
	switch (value) {
		case 'openai':
		case 'anthropic':
		case 'gemini':
		case 'minimax':
		case 'openaiCompatible':
			return value;
		default:
			return 'openai';
	}
}

export function normalizeProviderInput(value: string): ProviderKind {
	const normalized = value.trim().toLowerCase();
	switch (normalized) {
		case 'openai':
			return 'openai';
		case 'claude':
		case 'anthropic':
			return 'anthropic';
		case 'gemini':
		case 'google':
			return 'gemini';
		case 'minimax':
		case 'mini max':
			return 'minimax';
		case 'openai-compatible':
		case 'openai compatible':
		case 'compatible':
			return 'openaiCompatible';
		default:
			return 'openaiCompatible';
	}
}

export function providerLabel(provider: ProviderKind): string {
	switch (provider) {
		case 'openai':
			return 'OpenAI';
		case 'anthropic':
			return 'Claude';
		case 'gemini':
			return 'Gemini';
		case 'minimax':
			return 'MiniMax';
		case 'openaiCompatible':
			return 'Compatible';
		default:
			return 'Model';
	}
}

export function resolveBaseUrl(provider: ProviderKind, configuredBaseUrl: string): string {
	if (configuredBaseUrl.trim()) {
		return trimRightSlash(configuredBaseUrl.trim());
	}

	switch (provider) {
		case 'openai':
		case 'openaiCompatible':
			return 'https://api.openai.com/v1';
		case 'anthropic':
			return 'https://api.anthropic.com/v1';
		case 'gemini':
			return 'https://generativelanguage.googleapis.com/v1beta';
		case 'minimax':
			return 'https://api.minimax.chat/v1';
		default:
			return '';
	}
}

export function normalizeGeminiModel(value: string): string {
	const model = value.trim();
	switch (model) {
		case 'gemini-2-flash':
			return 'gemini-2.0-flash';
		case 'gemini-2-pro':
			return 'gemini-2.0-pro';
		default:
			return model;
	}
}

export function resolveModel(provider: ProviderKind, configuredModel: string): string {
	if (configuredModel.trim()) {
		return configuredModel.trim();
	}

	switch (provider) {
		case 'openai':
		case 'openaiCompatible':
			return 'gpt-4.1-mini';
		case 'anthropic':
			return 'claude-3-5-sonnet-latest';
		case 'gemini':
			return 'gemini-2.0-flash';
		case 'minimax':
			return 'abab6.5s-chat';
		default:
			return 'gpt-4.1-mini';
	}
}

export function toProviderMessages(
	historyMessages: Array<{ role: 'user' | 'assistant'; content: string; thinking?: string }>,
	systemPrompt: string,
	latestPrompt: string,
	historyTurns: number,
): ProviderMessage[] {
	const result: ProviderMessage[] = [];
	if (systemPrompt.trim()) {
		result.push({ role: 'system', content: systemPrompt.trim() });
	}

	const turns = Math.max(0, historyTurns);
	const history = turns === 0 ? [] : historyMessages.slice(-(turns * 2));
	for (const message of history) {
		result.push({ role: message.role, content: message.content });
	}

	result.push({ role: 'user', content: latestPrompt });
	return result;
}

export function composeThinkingMarkdown(
	provider: ProviderKind,
	model: string,
	providerMessages: ProviderMessage[],
	providerThinkingRaw: string | undefined,
	elapsedMs: number,
): string {
	const providerThinking = providerThinkingRaw?.trim() ?? '';
	const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
	const runtimeLines: string[] = [
		`- Provider: **${providerLabel(provider)}**`,
		`- Model: \`${model}\``,
		`- Roundtrip: **${elapsedSec}s**`,
		`- Context messages: **${providerMessages.length}**`,
	];
	if (providerThinking) {
		return `### Runtime\n${runtimeLines.join('\n')}\n\n### Model Thinking\n${providerThinking}`;
	}
	return `### Runtime\n${runtimeLines.join('\n')}\n\n_No native thinking channel returned by this provider/model. Showing runtime trace only._`;
}

export function extractErrorText(data: unknown, fallback: string): string {
	const value = data as any;
	const structured = value?.error?.message ?? value?.message ?? value?.detail ?? value?.details?.message;
	if (typeof structured === 'string' && structured.trim()) {
		return structured.trim();
	}
	return fallback || 'Unknown request failure';
}

export function isGeminiThinkingConfigError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return normalized.includes('thinking') &&
		(
			normalized.includes('include_thoughts') ||
			normalized.includes('includethoughts') ||
			normalized.includes('thinkingbudget') ||
			normalized.includes('thinking_budget') ||
			normalized.includes('thinkingconfig') ||
			normalized.includes('invalid_argument')
		);
}

export function safeJsonParse(raw: string): unknown {
	if (!raw) {
		return {};
	}
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

export function ensureStartsWithSlash(pathValue: string): string {
	return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

export function trimRightSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

export function joinUrl(baseUrl: string, requestPath: string): string {
	return `${trimRightSlash(baseUrl)}${ensureStartsWithSlash(requestPath)}`;
}

export function readEnv(name: string): string {
	const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const value = processValue?.env?.[name];
	return typeof value === 'string' ? value.trim() : '';
}

export function normalizeThinkingValue(value: unknown): string {
	if (!value) {
		return '';
	}
	if (typeof value === 'string') {
		return value.trim();
	}
	if (Array.isArray(value)) {
		return value.map(item => normalizeThinkingValue(item)).filter(Boolean).join('\n').trim();
	}
	if (typeof value === 'object') {
		const objectValue = value as Record<string, unknown>;
		const prioritized = [
			objectValue.text,
			objectValue.content,
			objectValue.reasoning,
			objectValue.reasoning_content,
			objectValue.thinking,
			objectValue.summary,
		];
		for (const candidate of prioritized) {
			const text = normalizeThinkingValue(candidate);
			if (text) {
				return text;
			}
		}
	}
	return '';
}

function extractThinkingFromContentArray(content: unknown, thinking: string): string[] {
	if (!Array.isArray(content)) {
		return [];
	}
	const thinkingParts: string[] = [];
	for (const part of content) {
		const partType = typeof part?.type === 'string' ? part.type.toLowerCase() : '';
		const marksThinking = partType.includes('reason') || partType.includes('think') || (part as any)?.thought === true;
		if (!marksThinking) {
			continue;
		}
		const text = normalizeThinkingValue((part as any)?.text ?? (part as any)?.content ?? (part as any)?.reasoning ?? part);
		if (text) {
			thinkingParts.push(text);
		}
	}
	return thinkingParts;
}

export function extractOpenAIThinking(data: unknown): string {
	const value = data as any;
	const choice = value?.choices?.[0];
	const message = choice?.message;
	const directCandidates = [
		message?.reasoning,
		message?.reasoning_content,
		message?.thinking,
		choice?.reasoning,
		choice?.reasoning_content,
		choice?.thinking,
		value?.reasoning,
		value?.reasoning_content,
		value?.thinking,
	];
	for (const candidate of directCandidates) {
		const text = normalizeThinkingValue(candidate);
		if (text) {
			return text;
		}
	}

	const messageContent = message?.content;
	const thinkingParts = extractThinkingFromContentArray(messageContent, '');
	if (thinkingParts.length) {
		return thinkingParts.join('\n\n');
	}
	return '';
}

export function extractOpenAIText(data: unknown, provider?: string): string {
	const value = data as any;
	const content = value?.choices?.[0]?.message?.content;

	if (provider === 'minimax') {
		const thinking = extractOpenAIThinking(data);
		if (thinking) {
			if (typeof content === 'string') {
				const lines = content.split('\n');
				const thinkingLines = thinking.split('\n');
				const filteredLines = lines.filter(line => {
					const trimmedLine = line.trim().toLowerCase();
					for (const tLine of thinkingLines) {
						const trimmedT = tLine.trim().toLowerCase();
						if (trimmedT.length > 10 && trimmedLine.includes(trimmedT.substring(0, Math.min(30, trimmedT.length)))) {
							return false;
						}
					}
					return true;
				});
				return filteredLines.join('\n').trim();
			}
			if (Array.isArray(content)) {
				return content
					.map(part => {
						if (typeof part === 'string') {
							return part;
						}
						if (typeof (part as any)?.text === 'string') {
							const partType = typeof (part as any)?.type === 'string' ? (part as any).type.toLowerCase() : '';
							const marksThinking = partType.includes('reason') || partType.includes('think') || (part as any)?.thought === true;
							if (marksThinking) {
								return '';
							}
						}
						return (part as any)?.text || '';
					})
					.join('\n')
					.trim();
			}
		}
	}

	if (typeof content === 'string') {
		return content.trim();
	}
	if (Array.isArray(content)) {
		return content
			.map(part => {
				if (typeof part === 'string') {
					return part;
				}
				if (typeof (part as any)?.text === 'string') {
					return (part as any).text;
				}
				return '';
			})
			.join('\n')
			.trim();
	}
	return '';
}

export function extractAnthropicText(data: unknown): string {
	const value = data as any;
	if (!Array.isArray(value?.content)) {
		return '';
	}
	return value.content
		.map((part: any) => (part?.type === 'text' && typeof part?.text === 'string') ? part.text : '')
		.join('\n')
		.trim();
}

export function extractAnthropicThinking(data: unknown): string {
	const value = data as any;
	const direct = normalizeThinkingValue(value?.thinking ?? value?.reasoning);
	if (direct) {
		return direct;
	}
	if (!Array.isArray(value?.content)) {
		return '';
	}
	const thinkingParts: string[] = [];
	for (const part of value.content) {
		const partType = typeof part?.type === 'string' ? part.type.toLowerCase() : '';
		const isThinkingType = partType === 'thinking' || partType === 'redacted_thinking' || partType.includes('think');
		if (!isThinkingType) {
			continue;
		}
		const text = normalizeThinkingValue(part?.thinking ?? part?.text ?? part?.content ?? part);
		if (text) {
			thinkingParts.push(text);
		}
	}
	return thinkingParts.join('\n\n').trim();
}

export function extractGeminiText(data: unknown): string {
	const value = data as any;
	const parts = value?.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) {
		const blocked = value?.promptFeedback?.blockReason;
		if (blocked) {
			throw new Error(`Gemini blocked this prompt: ${String(blocked)}`);
		}
		return '';
	}
	return parts
		.map((part: any) => typeof part?.text === 'string' ? part.text : '')
		.join('\n')
		.trim();
}

export function extractGeminiThinking(data: unknown): string {
	const value = data as any;
	const direct = normalizeThinkingValue(
		value?.candidates?.[0]?.reasoningContent
		?? value?.candidates?.[0]?.reasoning
		?? value?.reasoning
	);
	if (direct) {
		return direct;
	}
	const parts = value?.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) {
		return '';
	}
	const thinkingParts: string[] = [];
	for (const part of parts) {
		const type = typeof part?.type === 'string' ? part.type.toLowerCase() : '';
		const isThinking = part?.thought === true || type.includes('think') || type.includes('reason');
		if (!isThinking) {
			continue;
		}
		const text = normalizeThinkingValue(part?.text ?? part?.content ?? part?.thinking ?? part?.reasoning ?? part);
		if (text) {
			thinkingParts.push(text);
		}
	}
	return thinkingParts.join('\n\n').trim();
}

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'Unknown error';
}