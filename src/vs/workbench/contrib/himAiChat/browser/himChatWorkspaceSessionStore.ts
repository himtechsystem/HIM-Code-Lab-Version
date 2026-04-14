/*---------------------------------------------------------------------------------------------
 *  HIM Code — workspace-scoped chat session persistence (debounced JSON in IStorageService)
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export const HIM_CHAT_WORKSPACE_SESSIONS_KEY = 'himCode.chat.workspaceSessions.v1';

export interface PersistedChatMessage {
	role: 'user' | 'assistant';
	content: string;
	thinking?: string;
	thinkingDurationMs?: number;
	isError?: boolean;
	pythonExecutions?: { blockIndex: number; code: string; output: string; hadError: boolean }[];
	shellExecutions?: { blockIndex: number; command: string; output: string; exitCode: number | null }[];
	searchExecutions?: { blockIndex: number; query: string; output: string }[];
	attachments?: { type: 'code' | 'file' | 'image'; name: string; range?: string; size?: string }[];
	images?: { mimeType: string; dataBase64: string; name?: string }[];
	/** Optional semantic-program trace (only when `himCode.chat.semanticProgramDebug` was on). */
	semanticProgramDebug?: {
		title: string;
		subtitle?: string;
		turns: { stepLabel: string; inputText: string; outputText: string; outputThinking?: string; notes?: string }[];
		parseHint?: string;
		rawMergedBlobPreview?: string;
		rawTagInnerPreview?: string;
	};
}

export interface PersistedChatSession {
	readonly id: string;
	title: string;
	/** Optional agent role used to build a per-session system prompt. */
	role?: string;
	/** Optional agent rule used to build a per-session system prompt. */
	rule?: string;
	messages: PersistedChatMessage[];
	scrollTop: number;
	queuedMessages: string[];
	conversationSummary: string;
	pythonNotify?: boolean;
	/** Binds this chat tab to an `org.json` agent id (e.g. `orchestrator`, `user`). */
	linkedOrgAgentId?: string;
}

export interface PersistedHimChatWorkspaceV1 {
	version: 1;
	sessions: PersistedChatSession[];
	activeSessionIdx: number;
	/** @deprecated Ignored — agent loop is unlimited until idle or cancel. */
	maxAgentLoops?: number;
}

export class HimChatWorkspaceSessionStore extends Disposable {
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly storageService: IStorageService) {
		super();
	}

	load(): PersistedHimChatWorkspaceV1 | undefined {
		const raw = this.storageService.get(HIM_CHAT_WORKSPACE_SESSIONS_KEY, StorageScope.WORKSPACE);
		if (!raw?.trim()) {
			return undefined;
		}
		try {
			const data = JSON.parse(raw) as PersistedHimChatWorkspaceV1;
			if (data?.version !== 1 || !Array.isArray(data.sessions)) {
				return undefined;
			}
			return data;
		} catch {
			return undefined;
		}
	}

	scheduleSave(payload: PersistedHimChatWorkspaceV1, delayMs = 450): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = undefined;
			try {
				this.storageService.store(
					HIM_CHAT_WORKSPACE_SESSIONS_KEY,
					JSON.stringify(payload),
					StorageScope.WORKSPACE,
					StorageTarget.MACHINE,
				);
			} catch {
				// ignore quota / serialization errors
			}
		}, delayMs);
	}

	override dispose(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		super.dispose();
	}
}
