/*---------------------------------------------------------------------------------------------
 *  HIM Inspector Webview Provider
 *  Registers and manages the Inspector View in VS Code
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { HimInspectorEvent, StreamActionType } from './himInspectorService';

export class HimInspectorViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'himInspector.view';

	private webviewView: vscode.WebviewView | undefined;
	private _eventEmitter = new vscode.EventEmitter<HimInspectorEvent>();

	constructor(
		private readonly extensionUri: vscode.Uri
	) {}

	get onAgentTrace() {
		return this._eventEmitter.event;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void | Thenable<void> {
		this.webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'src', 'inspector')
			]
		};

		webviewView.webview.html = this.getHtmlContent();

		webviewView.webview.onDidReceiveMessage((_message: { type: string; data: unknown }) => {
		});
	}

	private getHtmlContent(): string {
		const nonce = this.getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HIM INSPECTOR</title>
    <style>
        :root {
            --bg-primary: #0a0a0f;
            --bg-secondary: #12121a;
            --bg-panel: #1a1a25;
            --neon-green: #00ff88;
            --neon-orange: #ff8844;
            --neon-cyan: #00ccff;
            --neon-purple: #cc66ff;
            --neon-yellow: #ffcc00;
            --neon-red: #ff4466;
            --text-dim: #556677;
            --border-color: #2a2a3a;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg-primary);
            color: var(--neon-green);
            font-family: 'Courier New', monospace;
            font-size: 12px;
            height: 100vh;
            overflow: hidden;
        }
        body::before {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 136, 0.03) 2px, rgba(0, 255, 136, 0.03) 4px);
            pointer-events: none;
            z-index: 1000;
        }
        .header {
            background: linear-gradient(180deg, var(--bg-secondary), var(--bg-primary));
            border-bottom: 1px solid var(--border-color);
            padding: 10px 15px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .header-title {
            font-size: 14px;
            font-weight: bold;
            color: var(--neon-cyan);
            text-shadow: 0 0 10px var(--neon-cyan);
            letter-spacing: 3px;
        }
        .status-indicator { display: flex; align-items: center; gap: 8px; }
        .status-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: var(--neon-red);
            box-shadow: 0 0 10px var(--neon-red);
            animation: pulse 1s infinite;
        }
        .status-dot.active { background: var(--neon-green); box-shadow: 0 0 10px var(--neon-green); }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .status-text { color: var(--text-dim); font-size: 10px; }
        .container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr 200px;
            gap: 1px;
            background: var(--border-color);
            height: calc(100vh - 40px);
        }
        .panel { background: var(--bg-panel); display: flex; flex-direction: column; overflow: hidden; }
        .panel-header { background: var(--bg-secondary); padding: 8px 12px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px; }
        .panel-icon { color: var(--neon-orange); font-size: 14px; }
        .panel-title { color: var(--neon-orange); font-weight: bold; font-size: 11px; letter-spacing: 1px; }
        .panel-content { flex: 1; overflow-y: auto; padding: 10px; }
        #code-panel { grid-column: 1 / 2; grid-row: 1 / 3; }
        .code-line { display: flex; padding: 2px 0; }
        .code-line.current { background: rgba(0, 255, 136, 0.15); }
        .code-line.executing { background: rgba(255, 136, 68, 0.3); animation: flash 0.3s infinite; }
        @keyframes flash { 0%, 100% { background: rgba(255, 136, 68, 0.3); } 50% { background: rgba(255, 136, 68, 0.5); } }
        .line-number { color: var(--text-dim); width: 40px; text-align: right; padding-right: 10px; }
        .line-indicator { width: 16px; text-align: center; }
        .line-indicator.arrow { color: var(--neon-cyan); animation: blink 0.5s infinite; }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .line-content { flex: 1; color: var(--neon-green); white-space: pre; }
        .line-content.keyword { color: var(--neon-purple); }
        .line-content.string { color: var(--neon-yellow); }
        .line-content.comment { color: var(--text-dim); }
        .line-content.error { color: var(--neon-red); }
        #protocol-panel { grid-column: 2 / 3; grid-row: 1 / 2; }
        .protocol-entry { padding: 4px 0; border-bottom: 1px solid var(--border-color); font-size: 11px; }
        .protocol-time { color: var(--text-dim); margin-right: 8px; }
        .protocol-action { color: var(--neon-cyan); font-weight: bold; }
        .protocol-data { color: var(--neon-green); margin-top: 2px; font-size: 10px; max-height: 60px; overflow: hidden; }
        #output-panel { grid-column: 2 / 3; grid-row: 2 / 3; }
        .output-entry { padding: 6px 0; border-bottom: 1px solid var(--border-color); }
        .output-time { color: var(--text-dim); font-size: 10px; }
        .output-text { color: var(--neon-orange); margin-top: 4px; font-size: 12px; }
        .output-text.error { color: var(--neon-red); }
        #timeline-panel { grid-column: 1 / 3; grid-row: 3 / 4; }
        .timeline { display: flex; gap: 2px; height: 100%; align-items: flex-end; padding: 10px 0; }
        .timeline-bar { flex: 1; background: var(--neon-green); opacity: 0.7; transition: height 0.1s; min-height: 2px; }
        .timeline-bar.thinking { background: var(--neon-cyan); }
        .timeline-bar.executing { background: var(--neon-orange); opacity: 1; }
        .timeline-bar.output { background: var(--neon-purple); }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg-secondary); }
        ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
        .empty-state { color: var(--text-dim); text-align: center; padding: 20px; font-style: italic; }
        .glow-cyan { text-shadow: 0 0 5px var(--neon-cyan), 0 0 10px var(--neon-cyan); }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title glow-cyan">◈ HIM INSPECTOR ◈</div>
        <div class="status-indicator">
            <div class="status-dot" id="status-dot"></div>
            <span class="status-text" id="status-text">IDLE</span>
        </div>
    </div>
    <div class="container">
        <div class="panel" id="code-panel">
            <div class="panel-header"><span class="panel-icon">⌨</span><span class="panel-title">CODE EXECUTOR</span></div>
            <div class="panel-content" id="code-window"><div class="empty-state">Waiting for AI to generate code...</div></div>
        </div>
        <div class="panel" id="protocol-panel">
            <div class="panel-header"><span class="panel-icon">⚡</span><span class="panel-title">HIM_STREAM LOG</span></div>
            <div class="panel-content" id="protocol-window"><div class="empty-state">No protocol events yet...</div></div>
        </div>
        <div class="panel" id="output-panel">
            <div class="panel-header"><span class="panel-icon">💬</span><span class="panel-title">him_say OUTPUT</span></div>
            <div class="panel-content" id="output-window"><div class="empty-state">No output captured...</div></div>
        </div>
        <div class="panel" id="timeline-panel">
            <div class="panel-header"><span class="panel-icon">📊</span><span class="panel-title">ACTIVITY TIMELINE</span></div>
            <div class="panel-content timeline" id="timeline-window"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let codeLines = [], currentLine = -1, executingLine = -1;
        let protocolEntries = [], outputEntries = [], timelineData = [];
        const codeWindow = document.getElementById('code-window');
        const protocolWindow = document.getElementById('protocol-window');
        const outputWindow = document.getElementById('output-window');
        const timelineWindow = document.getElementById('timeline-window');
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        function setStatus(status) {
            statusDot.className = 'status-dot' + (status !== 'IDLE' ? ' active' : '');
            statusText.textContent = status;
        }

        function highlightLine(line) {
            return line
                .replace(/\\b(def|class|return|if|else|elif|for|while|import|from|as|try|except|finally|with|raise|in|and|or|not|is|None|True|False)\\b/g, '<span class="keyword">$1</span>')
                .replace(/(".*?"|'.*?')/g, '<span class="string">$1</span>')
                .replace(/#.*/g, '<span class="comment">$&</span>');
        }

        function renderCode() {
            if (codeLines.length === 0) {
                codeWindow.innerHTML = '<div class="empty-state">Waiting for AI to generate code...</div>';
                return;
            }
            codeWindow.innerHTML = codeLines.map((line, idx) => {
                const isCurrent = idx === currentLine;
                const isExecuting = idx === executingLine;
                const indicator = isCurrent ? '<span class="arrow">▶</span>' : '';
                return '<div class="code-line ' + (isCurrent ? 'current' : '') + ' ' + (isExecuting ? 'executing' : '') + '">' +
                    '<span class="line-number">' + (idx + 1) + '</span>' +
                    '<span class="line-indicator">' + indicator + '</span>' +
                    '<span class="line-content">' + highlightLine(line) + '</span></div>';
            }).join('');
            const currentEl = codeWindow.querySelector('.code-line.current');
            if (currentEl) currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        function addProtocol(action, data) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            protocolEntries.push({ time, action, data });
            const entry = document.createElement('div');
            entry.className = 'protocol-entry';
            entry.innerHTML = '<span class="protocol-time">' + time + '</span><span class="protocol-action">' + action + '</span><div class="protocol-data">' + JSON.stringify(data, null, 2) + '</div>';
            if (protocolEntries.length === 1) protocolWindow.innerHTML = '';
            protocolWindow.appendChild(entry);
            protocolWindow.scrollTop = protocolWindow.scrollHeight;
            addTimelineBar('protocol');
        }

        function addOutput(text, isError = false) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            outputEntries.push({ time, text });
            const entry = document.createElement('div');
            entry.className = 'output-entry';
            entry.innerHTML = '<span class="output-time">' + time + '</span><div class="output-text ' + (isError ? 'error' : '') + '">' + text + '</div>';
            if (outputEntries.length === 1) outputWindow.innerHTML = '';
            outputWindow.appendChild(entry);
            outputWindow.scrollTop = outputWindow.scrollHeight;
            addTimelineBar('output');
        }

        function addTimelineBar(type) {
            const bar = document.createElement('div');
            bar.className = 'timeline-bar ' + type;
            bar.style.height = '20px';
            timelineWindow.appendChild(bar);
            while (timelineWindow.children.length > 100) {
                timelineWindow.removeChild(timelineWindow.firstChild);
                timelineData.shift();
            }
        }

        function clearAll() {
            codeLines = []; currentLine = -1; executingLine = -1;
            protocolEntries = []; outputEntries = []; timelineData = [];
            codeWindow.innerHTML = '<div class="empty-state">Waiting for AI to generate code...</div>';
            protocolWindow.innerHTML = '<div class="empty-state">No protocol events yet...</div>';
            outputWindow.innerHTML = '<div class="empty-state">No output captured...</div>';
            timelineWindow.innerHTML = '';
            setStatus('IDLE');
        }

        window.addEventListener('message', (event) => {
            const { type, data } = event.data;
            switch (type) {
                case 'agent_thinking_start': setStatus('THINKING'); addProtocol('thinking_start', data); addTimelineBar('thinking'); break;
                case 'agent_code_start':
                    setStatus('GENERATING');
                    codeLines = []; currentLine = -1;
                    codeWindow.innerHTML = '';
                    addProtocol('code_start', data);
                    break;
                case 'agent_code_chunk':
                    codeLines.push(data.line);
                    currentLine = codeLines.length - 1;
                    renderCode();
                    break;
                case 'agent_code_complete':
                    setStatus('READY');
                    addProtocol('code_complete', { lines: codeLines.length });
                    renderCode();
                    break;
                case 'exec_start':
                    setStatus('EXECUTING');
                    executingLine = data.lineNumber;
                    currentLine = data.lineNumber;
                    renderCode();
                    addProtocol('exec_start', data);
                    addTimelineBar('executing');
                    break;
                case 'exec_line':
                    executingLine = data.lineNumber;
                    currentLine = data.lineNumber;
                    renderCode();
                    addProtocol('exec_line', data);
                    break;
                case 'exec_complete':
                    executingLine = -1;
                    setStatus('DONE');
                    addProtocol('exec_complete', data);
                    renderCode();
                    break;
                case 'exec_error':
                    setStatus('ERROR');
                    addProtocol('exec_error', data);
                    break;
                case 'stream_event':
                    addProtocol(data.action, data.data);
                    if (data.action === 'say') addOutput(data.data);
                    else if (data.action === 'error') addOutput(data.data, true);
                    break;
                case 'clear': clearAll(); break;
            }
        });

        setStatus('IDLE');
    </script>
</body>
</html>`;
	}

	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 16; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	public postMessage(message: { type: string; data: unknown }): void {
		if (this.webviewView) {
			this.webviewView.webview.postMessage(message);
		}
	}

	public emitEvent(event: HimInspectorEvent): void {
		this.postMessage({ type: event.type, data: event.data });
		this._eventEmitter.fire(event);
	}

	public show(): void {
		if (this.webviewView) {
			this.webviewView.show();
		} else {
			vscode.commands.executeCommand('himInspector.view.focus');
		}
	}
}

export class HimInspectorServiceImpl implements vscode.Disposable {
	private _onAgentTrace = new vscode.EventEmitter<HimInspectorEvent>();
	private viewProvider: HimInspectorViewProvider | undefined;

	readonly onAgentTrace = this._onAgentTrace.event;

	setViewProvider(provider: HimInspectorViewProvider): void {
		this.viewProvider = provider;
	}

	startThinking(message?: string): void {
		this.emit({ type: 'agent_thinking_start', data: { timestamp: Date.now(), message } });
	}

	startCodeGeneration(language = 'python'): void {
		this.emit({ type: 'agent_code_start', data: { timestamp: Date.now(), language } });
	}

	addCodeChunk(line: string, lineNumber: number, totalLines: number, isComplete: boolean): void {
		this.emit({ type: 'agent_code_chunk', data: { line, lineNumber, totalLines, isComplete } });
	}

	completeCodeGeneration(totalLines: number, code: string): void {
		this.emit({ type: 'agent_code_complete', data: { timestamp: Date.now(), totalLines, code } });
	}

	startExecution(lineNumber: number, lineContent: string): void {
		this.emit({ type: 'exec_start', data: { lineNumber, lineContent, timestamp: Date.now() } });
	}

	updateExecution(lineNumber: number, status: 'running' | 'success' | 'error', output?: string, error?: string): void {
		this.emit({ type: 'exec_line', data: { lineNumber, status, output, error } });
	}

	completeExecution(duration: number, linesExecuted: number): void {
		this.emit({ type: 'exec_complete', data: { timestamp: Date.now(), duration, linesExecuted } });
	}

	reportExecutionError(lineNumber: number, error: string, errorType: string): void {
		this.emit({ type: 'exec_error', data: { lineNumber, error, errorType } });
	}

	emitStreamEvent(action: StreamActionType, data: unknown): void {
		this.emit({ type: 'stream_event', data: { action, data, timestamp: Date.now() } });
	}

	clear(): void {
		this.emit({ type: 'clear', data: null });
	}

	private emit(event: HimInspectorEvent): void {
		this._onAgentTrace.fire(event);
		this.viewProvider?.emitEvent(event);
	}

	dispose(): void {
		this._onAgentTrace.dispose();
	}
}
