/*---------------------------------------------------------------------------------------------
 *  HIM Inspector Service - Event Bus and Types
 *  Centralized event definitions for AI monitoring
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 * Event Types
 *--------------------------------------------------------------------------------------------*/

export type AgentThinkingStartEvent = {
	type: 'agent_thinking_start';
	data: { timestamp: number; message?: string };
};

export type AgentCodeStartEvent = {
	type: 'agent_code_start';
	data: { timestamp: number; language: string };
};

export type AgentCodeChunkEvent = {
	type: 'agent_code_chunk';
	data: { line: string; lineNumber: number; totalLines: number; isComplete: boolean };
};

export type AgentCodeCompleteEvent = {
	type: 'agent_code_complete';
	data: { timestamp: number; totalLines: number; code: string };
};

export type ExecStartEvent = {
	type: 'exec_start';
	data: { lineNumber: number; lineContent: string; timestamp: number };
};

export type ExecLineEvent = {
	type: 'exec_line';
	data: { lineNumber: number; status: 'running' | 'success' | 'error'; output?: string; error?: string };
};

export type ExecCompleteEvent = {
	type: 'exec_complete';
	data: { timestamp: number; duration: number; linesExecuted: number };
};

export type ExecErrorEvent = {
	type: 'exec_error';
	data: { lineNumber: number; error: string; errorType: string };
};

export type StreamActionType = 'init' | 'say' | 'file_read' | 'file_written' | 'execute_start' | 'execute_done' | 'dir_list' | 'cwd_changed' | 'error' | 'exception';

export type StreamEvent = {
	type: 'stream_event';
	data: { action: StreamActionType; data: unknown; timestamp: number };
};

export type ClearEvent = {
	type: 'clear';
	data: null;
};

export type HimInspectorEvent =
	| AgentThinkingStartEvent
	| AgentCodeStartEvent
	| AgentCodeChunkEvent
	| AgentCodeCompleteEvent
	| ExecStartEvent
	| ExecLineEvent
	| ExecCompleteEvent
	| ExecErrorEvent
	| StreamEvent
	| ClearEvent;

/*---------------------------------------------------------------------------------------------
 * HIM Inspector Service Interface
 *--------------------------------------------------------------------------------------------*/

export interface IHimInspectorService {
	readonly onAgentTrace: (listener: (event: HimInspectorEvent) => void) => void;
	startThinking(message?: string): void;
	startCodeGeneration(language?: string): void;
	addCodeChunk(line: string, lineNumber: number, totalLines: number, isComplete: boolean): void;
	completeCodeGeneration(totalLines: number, code: string): void;
	startExecution(lineNumber: number, lineContent: string): void;
	updateExecution(lineNumber: number, status: 'running' | 'success' | 'error', output?: string, error?: string): void;
	completeExecution(duration: number, linesExecuted: number): void;
	reportExecutionError(lineNumber: number, error: string, errorType: string): void;
	emitStreamEvent(action: StreamActionType, data: unknown): void;
	clear(): void;
}
