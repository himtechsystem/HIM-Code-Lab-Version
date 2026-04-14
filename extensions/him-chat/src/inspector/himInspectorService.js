"use strict";
/*---------------------------------------------------------------------------------------------
 *  HIM Inspector Service - Event Bus and Types
 *  Centralized event definitions for AI monitoring
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockHimInspectorService = void 0;
/*---------------------------------------------------------------------------------------------
 * Mock Implementation for Testing
 *--------------------------------------------------------------------------------------------*/
class MockHimInspectorService {
    _onAgentTrace = new Set();
    get onAgentTrace() {
        return (listener) => {
            this._onAgentTrace.add(listener);
            return () => this._onAgentTrace.delete(listener);
        };
    }
    emit(event) {
        for (const listener of this._onAgentTrace) {
            try {
                listener(event);
            }
            catch (e) {
                console.error('[HimInspector] Listener error:', e);
            }
        }
    }
    startThinking(message) {
        this.emit({
            type: 'agent_thinking_start',
            data: { timestamp: Date.now(), message }
        });
    }
    startCodeGeneration(language = 'python') {
        this.emit({
            type: 'agent_code_start',
            data: { timestamp: Date.now(), language }
        });
    }
    addCodeChunk(line, lineNumber, totalLines, isComplete) {
        this.emit({
            type: 'agent_code_chunk',
            data: { line, lineNumber, totalLines, isComplete }
        });
    }
    completeCodeGeneration(totalLines, code) {
        this.emit({
            type: 'agent_code_complete',
            data: { timestamp: Date.now(), totalLines, code }
        });
    }
    startExecution(lineNumber, lineContent) {
        this.emit({
            type: 'exec_start',
            data: { lineNumber, lineContent, timestamp: Date.now() }
        });
    }
    updateExecution(lineNumber, status, output, error) {
        this.emit({
            type: 'exec_line',
            data: { lineNumber, status, output, error }
        });
    }
    completeExecution(duration, linesExecuted) {
        this.emit({
            type: 'exec_complete',
            data: { timestamp: Date.now(), duration, linesExecuted }
        });
    }
    reportExecutionError(lineNumber, error, errorType) {
        this.emit({
            type: 'exec_error',
            data: { lineNumber, error, errorType }
        });
    }
    emitStreamEvent(action, data) {
        this.emit({
            type: 'stream_event',
            data: { action, data, timestamp: Date.now() }
        });
    }
    clear() {
        this.emit({ type: 'clear', data: null });
    }
}
exports.MockHimInspectorService = MockHimInspectorService;
/*---------------------------------------------------------------------------------------------
 * Usage Example
 *--------------------------------------------------------------------------------------------*/
/*
// In your code:

import { IHimInspectorService, MockHimInspectorService } from './himInspectorService';

const inspector = new MockHimInspectorService();

// Subscribe to all events
inspector.onAgentTrace((event) => {
    console.log('[TRACE]', event.type, event.data);
});

// Simulate AI thinking
inspector.startThinking('Analyzing the request...');

// Simulate code generation
inspector.startCodeGeneration('python');
inspector.addCodeChunk('def hello():', 0, 3, false);
inspector.addCodeChunk('    print("Hello!")', 1, 3, false);
inspector.addCodeChunk('hello()', 2, 3, true);
inspector.completeCodeGeneration(3, 'def hello():\n    print("Hello!")\nhello()');

// Simulate execution
inspector.startExecution(0, 'def hello():');
inspector.updateExecution(0, 'success');
inspector.updateExecution(1, 'success', 'Hello!');
inspector.updateExecution(2, 'success');
inspector.completeExecution(150, 3);

// Simulate stream events
inspector.emitStreamEvent('say', 'Hello from Python SDK!');
inspector.emitStreamEvent('file_written', { path: '/tmp/test.txt', size: 100 });

// Clear
inspector.clear();
*/
//# sourceMappingURL=himInspectorService.js.map