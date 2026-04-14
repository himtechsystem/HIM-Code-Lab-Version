"use strict";
/*---------------------------------------------------------------------------------------------
 *  HIM Inspector Webview Provider
 *  Registers and manages the Inspector View in VS Code
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HimInspectorServiceImpl = exports.HimInspectorViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
class HimInspectorViewProvider {
    extensionUri;
    static viewType = 'himInspector.view';
    webviewView;
    _eventEmitter = new vscode.EventEmitter();
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    get onAgentTrace() {
        return this._eventEmitter.event;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'inspector')
            ]
        };
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'inspector', 'him-inspector.html');
        webviewView.webview.html = this.loadHtml(htmlPath, webviewView.webview);
        webviewView.webview.onDidReceiveMessage((message) => {
            console.log('[HimInspector] Received message:', message);
        });
        vscode.commands.registerCommand('himInspector.clear', () => {
            this.postMessage({ type: 'clear', data: null });
        });
    }
    loadHtml(uri, webview) {
        try {
            const filePath = uri.fsPath;
            let html = fs.readFileSync(filePath, 'utf8');
            html = html.replace(/(href|src)="([^"]+)"/g, (_match, attr, src) => {
                if (src.startsWith('http') || src.startsWith('data:')) {
                    return _match;
                }
                const resourceUri = vscode.Uri.joinPath(this.extensionUri, 'inspector', src);
                const webviewUri = webview.asWebviewUri(resourceUri);
                return `${attr}="${webviewUri}"`;
            });
            return html;
        }
        catch (e) {
            console.error('[HimInspector] Failed to load HTML:', e);
            return `<html><body style="background:#0a0a0f;color:#00ff88;font-family:monospace;">
				<h1>HIM Inspector</h1>
				<p>Failed to load inspector UI.</p>
			</body></html>`;
        }
    }
    postMessage(message) {
        if (this.webviewView) {
            this.webviewView.webview.postMessage(message);
        }
    }
    emitEvent(event) {
        this.postMessage({ type: event.type, data: event.data });
        this._eventEmitter.fire(event);
    }
    show() {
        if (this.webviewView) {
            this.webviewView.show();
        }
        else {
            vscode.commands.executeCommand('himInspector.view.focus');
        }
    }
}
exports.HimInspectorViewProvider = HimInspectorViewProvider;
class HimInspectorServiceImpl {
    _onAgentTrace = new vscode.EventEmitter();
    viewProvider;
    onAgentTrace = this._onAgentTrace.event;
    setViewProvider(provider) {
        this.viewProvider = provider;
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
        this.emit({
            type: 'clear',
            data: null
        });
    }
    emit(event) {
        this._onAgentTrace.fire(event);
        this.viewProvider?.emitEvent(event);
    }
    dispose() {
        this._onAgentTrace.dispose();
    }
}
exports.HimInspectorServiceImpl = HimInspectorServiceImpl;
//# sourceMappingURL=himInspectorView.js.map