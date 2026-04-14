/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HimInspectorViewProvider, HimInspectorServiceImpl } from './inspector/himInspectorView';

let inspectorService: HimInspectorServiceImpl;

type ProviderKind = string;
type MessageRole = 'system' | 'user' | 'assistant';

interface ChatMessage {
	role: MessageRole;
	content: string;
}

interface ResolvedChatConfig {
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

interface CustomModelConfig {
	id: string;
	provider: ProviderKind;
	baseUrl: string;
	model: string;
	apiKey: string;
}

const CONFIG_ROOT = 'himCode.chat';
const MAX_INPUT_TOKENS = 128_000;
const DEFAULT_CUSTOM_MODEL_ID = 'minimax-m2.7';
const DEFAULT_CUSTOM_MODELS: ReadonlyArray<CustomModelConfig> = [{
	id: DEFAULT_CUSTOM_MODEL_ID,
	provider: 'minimax',
	baseUrl: 'https://api.minimaxi.com/v1',
	model: 'MiniMax-M2.7',
	apiKey: 'sk-cp-z1yGSwaOlmv-usmSf0u6rcqNPJfixGfi9-uTTrx_xY9T4zI9Sa0bWnBxYs1sAPu1lOoQqf2d42pfoN49BtmtS42A2R-lei3NL-Ny6mAaciDwRpG3FSjVeNw',
}, {
	id: 'gemini-default',
	provider: 'gemini',
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
	model: 'gemini-2.5-flash',
	apiKey: '',
}];
const PROVIDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'anthropic', label: 'Claude (Anthropic)' },
	{ value: 'gemini', label: 'Google Gemini' },
	{ value: 'minimax', label: 'MiniMax' },
	{ value: 'siliconflow', label: 'SiliconFlow' },
	{ value: 'deepseek', label: 'DeepSeek' },
	{ value: 'qwen', label: 'Qwen' },
	{ value: 'moonshot', label: 'Moonshot' },
	{ value: 'zhipu', label: 'Zhipu AI' },
	{ value: 'groq', label: 'Groq' },
	{ value: 'ollama', label: 'Ollama (local)' },
	{ value: 'cohere', label: 'Cohere' },
	{ value: 'mistral', label: 'Mistral AI' },
	{ value: 'azure', label: 'Azure OpenAI' },
	{ value: 'openaiCompatible', label: 'OpenAI-Compatible' },
];

const DEFAULT_BASE_URLS: Record<string, string> = {
	openai: 'https://api.openai.com/v1',
	anthropic: 'https://api.anthropic.com/v1',
	gemini: 'https://generativelanguage.googleapis.com/v1beta/',
	minimax: 'https://api.minimax.chat/v1',
	siliconflow: 'https://api.siliconflow.cn/v1',
	deepseek: 'https://api.deepseek.com/v1',
	qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	moonshot: 'https://api.moonshot.cn/v1',
	zhipu: 'https://open.bigmodel.cn/api/paas/v4',
	groq: 'https://api.groq.com/openai/v1',
	ollama: 'http://localhost:11434/v1',
	cohere: 'https://api.cohere.com/v1',
	mistral: 'https://api.mistral.ai/v1',
	azure: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
};

function inferProviderFromUrl(url: string): string {
	if (!url) return 'openaiCompatible';
	const lowerUrl = url.toLowerCase();
	if (lowerUrl.includes('anthropic')) return 'anthropic';
	if (lowerUrl.includes('googleapis') || lowerUrl.includes('generativelanguage')) return 'gemini';
	if (lowerUrl.includes('minimax')) return 'minimax';
	if (lowerUrl.includes('siliconflow')) return 'siliconflow';
	if (lowerUrl.includes('deepseek')) return 'deepseek';
	if (lowerUrl.includes('dashscope') || lowerUrl.includes('qwen')) return 'qwen';
	if (lowerUrl.includes('moonshot') || lowerUrl.includes('moonshot.cn')) return 'moonshot';
	if (lowerUrl.includes('bigmodel') || lowerUrl.includes('zhipu')) return 'zhipu';
	if (lowerUrl.includes('groq')) return 'groq';
	if (lowerUrl.includes('ollama') || lowerUrl.includes('localhost:11434')) return 'ollama';
	if (lowerUrl.includes('cohere')) return 'cohere';
	if (lowerUrl.includes('mistral')) return 'mistral';
	if (lowerUrl.includes('openai.azure') || lowerUrl.includes('azure')) return 'azure';
	if (lowerUrl.includes('openai')) return 'openai';
	return 'openaiCompatible';
}

let modelSettingsPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
	try {
		const languageModelProvider = new HimLanguageModelProvider();
		context.subscriptions.push(languageModelProvider);

		vscode.lm.registerLanguageModelChatProvider('him', languageModelProvider);

		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(CONFIG_ROOT)) {
					languageModelProvider.notifyModelInfoChanged();
				}
			}),
		);

		const participant = vscode.chat.createChatParticipant('him.chat', async (request, chatContext, stream, token) => {
			return handleChatRequest(request, chatContext, stream, token);
		});
		participant.iconPath = new vscode.ThemeIcon('sparkle');
		context.subscriptions.push(participant);

		inspectorService = new HimInspectorServiceImpl();
		context.subscriptions.push(inspectorService);

	const inspectorViewProvider = new HimInspectorViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			HimInspectorViewProvider.viewType,
			inspectorViewProvider
		)
	);
	inspectorService.setViewProvider(inspectorViewProvider);

	context.subscriptions.push(
		vscode.commands.registerCommand('himChat.openSettings', async () => {
			// Native Settings (filtered) — all `himCode.chat.*` keys including semanticProgramMode are listed here.
			await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_ROOT);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('himChat.openModelSettings', async () => {
			// Webview: models, API keys, and extended options (incl. semantic program toggle).
			await openModelSettingsPanel();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('himInspector.show', () => {
			void vscode.commands.executeCommand('himInspector.view.focus');
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('himChat.searchWeb', async (args: { query?: string; provider?: string }) => {
			const query = (args?.query ?? '').trim();
			const provider = (args?.provider ?? 'whitelist').trim();
			if (!query) {
				return { ok: false, output: 'Empty search query.' };
			}
			return runHimWebSearch(query, provider);
		}),
	);

	} catch (error) {
		console.error('[HIM] Activation failed:', error);
	}
}

async function openModelSettingsPanel(): Promise<void> {
	if (modelSettingsPanel) {
		modelSettingsPanel.reveal(vscode.ViewColumn.Active);
		void modelSettingsPanel.webview.postMessage({ type: 'init', payload: getModelSettingsPayload() });
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'himChat.modelSettings',
		'HIM CODE User Settings',
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
		}
	);
	modelSettingsPanel = panel;

	panel.onDidDispose(() => {
		modelSettingsPanel = undefined;
	});

	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			const config = vscode.workspace.getConfiguration(CONFIG_ROOT);
			const customModels = sanitizeCustomModels(message.customModels);
			const selectedModelIdRaw = typeof message.selectedModelId === 'string' ? message.selectedModelId.trim() : '';
			const selectedModelId = customModels.some(model => model.id === selectedModelIdRaw)
				? selectedModelIdRaw
				: (customModels[0]?.id ?? '');

			await config.update('customModels', customModels, vscode.ConfigurationTarget.Global);
			await config.update('selectedModelId', selectedModelId, vscode.ConfigurationTarget.Global);
			if (selectedModelId) {
				const selected = customModels.find(model => model.id === selectedModelId);
				if (selected) {
					await config.update('provider', selected.provider, vscode.ConfigurationTarget.Global);
				}
			}

			// Other (non-model) settings saved from this page.
			const other = message?.otherSettings ?? {};
			if (other && typeof other === 'object') {
				const getStr = (k: string) => typeof other[k] === 'string' ? other[k] : undefined;
				const getNum = (k: string) => typeof other[k] === 'number' ? other[k] : undefined;
				const getBool = (k: string) => typeof other[k] === 'boolean' ? other[k] : undefined;
				const getJsonMap = (k: string): Record<string, string> | undefined => {
					const raw = getStr(k);
					if (typeof raw !== 'string') { return undefined; }
					try {
						const parsed = JSON.parse(raw);
						return sanitizeStringMap(parsed);
					} catch {
						return undefined;
					}
				};

				const provider = getStr('provider');
				if (typeof provider === 'string' && provider.trim()) {
					await config.update('provider', provider.trim(), vscode.ConfigurationTarget.Global);
				}
				const apiKey = getStr('apiKey');
				if (typeof apiKey === 'string') {
					await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
				}
				const baseUrl = getStr('baseUrl');
				if (typeof baseUrl === 'string') {
					await config.update('baseUrl', baseUrl.trim(), vscode.ConfigurationTarget.Global);
				}
				const model = getStr('model');
				if (typeof model === 'string') {
					await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
				}
				const systemPrompt = getStr('systemPrompt');
				if (typeof systemPrompt === 'string') {
					await config.update('systemPrompt', systemPrompt, vscode.ConfigurationTarget.Global);
				}
				const temperature = getNum('temperature');
				if (typeof temperature === 'number') {
					await config.update('temperature', clampNumber(temperature, 0, 2), vscode.ConfigurationTarget.Global);
				}
				const maxTokens = getNum('maxTokens');
				if (typeof maxTokens === 'number') {
					await config.update('maxTokens', clampNumber(maxTokens, 64, 32768), vscode.ConfigurationTarget.Global);
				}
				const timeoutMs = getNum('timeoutMs');
				if (typeof timeoutMs === 'number') {
					await config.update('timeoutMs', clampNumber(timeoutMs, 1000, 600000), vscode.ConfigurationTarget.Global);
				}
				const historyTurns = getNum('historyTurns');
				if (typeof historyTurns === 'number') {
					await config.update('historyTurns', clampNumber(historyTurns, 0, 40), vscode.ConfigurationTarget.Global);
				}
				const semanticProgramMode = getBool('semanticProgramMode');
				if (typeof semanticProgramMode === 'boolean') {
					await config.update('semanticProgramMode', semanticProgramMode, vscode.ConfigurationTarget.Global);
				}
				const semanticProgramDebug = getBool('semanticProgramDebug');
				if (typeof semanticProgramDebug === 'boolean') {
					await config.update('semanticProgramDebug', semanticProgramDebug, vscode.ConfigurationTarget.Global);
				}
				const maxPlanSteps = getNum('maxPlanSteps');
				if (typeof maxPlanSteps === 'number') {
					await config.update('maxPlanSteps', clampNumber(maxPlanSteps, 4, 256), vscode.ConfigurationTarget.Global);
				}
				const requestPath = getStr('requestPath');
				if (typeof requestPath === 'string') {
					await config.update('requestPath', requestPath.trim() || '/chat/completions', vscode.ConfigurationTarget.Global);
				}
				const anthropicVersion = getStr('anthropicVersion');
				if (typeof anthropicVersion === 'string') {
					await config.update('anthropicVersion', anthropicVersion.trim() || '2023-06-01', vscode.ConfigurationTarget.Global);
				}
				const minimaxGroupId = getStr('minimaxGroupId');
				if (typeof minimaxGroupId === 'string') {
					await config.update('minimaxGroupId', minimaxGroupId.trim(), vscode.ConfigurationTarget.Global);
				}
				const providerApiKeys = getJsonMap('providerApiKeysJson');
				if (providerApiKeys) {
					await config.update('providerApiKeys', providerApiKeys, vscode.ConfigurationTarget.Global);
				}
				const providerModels = getJsonMap('providerModelsJson');
				if (providerModels) {
					await config.update('providerModels', providerModels, vscode.ConfigurationTarget.Global);
				}

				const shellOutputMaxLines = getNum('shellOutputMaxLines');
				if (typeof shellOutputMaxLines === 'number') {
					await config.update('shellOutputMaxLines', clampNumber(shellOutputMaxLines, 1, 200), vscode.ConfigurationTarget.Global);
				}
				const shellHeredocFastPath = getBool('shellHeredocFastPath');
				if (typeof shellHeredocFastPath === 'boolean') {
					await config.update('shellHeredocFastPath', shellHeredocFastPath, vscode.ConfigurationTarget.Global);
				}
				const googleCseApiKey = getStr('googleCseApiKey');
				if (typeof googleCseApiKey === 'string') {
					await config.update('googleCseApiKey', googleCseApiKey, vscode.ConfigurationTarget.Global);
				}
				const googleCseCx = getStr('googleCseCx');
				if (typeof googleCseCx === 'string') {
					await config.update('googleCseCx', googleCseCx, vscode.ConfigurationTarget.Global);
				}

				const searchDefaultProvider = getStr('searchDefaultProvider');
				if (typeof searchDefaultProvider === 'string') {
					const allowed = ['auto', 'whitelist', 'google', 'web'];
					await config.update('search.defaultProvider', allowed.includes(searchDefaultProvider) ? searchDefaultProvider : 'auto', vscode.ConfigurationTarget.Global);
				}
				const searchAskToBroaden = getBool('searchAskToBroaden');
				if (typeof searchAskToBroaden === 'boolean') {
					await config.update('search.askToBroaden', searchAskToBroaden, vscode.ConfigurationTarget.Global);
				}
				const searchMaxOutputLines = getNum('searchMaxOutputLines');
				if (typeof searchMaxOutputLines === 'number') {
					await config.update('search.maxOutputLines', clampNumber(searchMaxOutputLines, 5, 400), vscode.ConfigurationTarget.Global);
				}
			}

			void panel.webview.postMessage({ type: 'saved' });
			vscode.window.showInformationMessage('HIM CODE settings saved.');
		}
	});

	panel.webview.html = getModelSettingsHtml(getModelSettingsPayload());
	void panel.webview.postMessage({ type: 'init', payload: getModelSettingsPayload() });
}

function getModelSettingsPayload(): {
	customModels: CustomModelConfig[];
	selectedModelId: string;
	providers: ReadonlyArray<{ value: ProviderKind; label: string }>;
	otherSettings: {
		provider: string;
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
		providerApiKeysJson: string;
		providerModelsJson: string;
		shellOutputMaxLines: number;
		shellHeredocFastPath: boolean;
		searchDefaultProvider: string;
		searchAskToBroaden: boolean;
		searchMaxOutputLines: number;
		googleCseApiKey: string;
		googleCseCx: string;
			semanticProgramMode: boolean;
			semanticProgramDebug: boolean;
			maxPlanSteps: number;
		};
} {
	const config = vscode.workspace.getConfiguration(CONFIG_ROOT);
	const customModels = sanitizeCustomModels(config.get('customModels'));
	const selectedModelId = (config.get<string>('selectedModelId', '') || '').trim();
	return {
		customModels,
		selectedModelId: customModels.some(model => model.id === selectedModelId) ? selectedModelId : (customModels[0]?.id ?? DEFAULT_CUSTOM_MODEL_ID),
		providers: PROVIDER_OPTIONS,
		otherSettings: {
			provider: config.get<string>('provider', 'gemini'),
			apiKey: config.get<string>('apiKey', ''),
			baseUrl: config.get<string>('baseUrl', ''),
			model: config.get<string>('model', ''),
			systemPrompt: config.get<string>('systemPrompt', ''),
			temperature: config.get<number>('temperature', 0.2),
			maxTokens: config.get<number>('maxTokens', 16384),
			timeoutMs: config.get<number>('timeoutMs', 300000),
			historyTurns: config.get<number>('historyTurns', 8),
			requestPath: config.get<string>('requestPath', '/chat/completions'),
			anthropicVersion: config.get<string>('anthropicVersion', '2023-06-01'),
			minimaxGroupId: config.get<string>('minimaxGroupId', ''),
			providerApiKeysJson: JSON.stringify(sanitizeStringMap(config.get('providerApiKeys')), null, 2),
			providerModelsJson: JSON.stringify(sanitizeStringMap(config.get('providerModels')), null, 2),
			shellOutputMaxLines: config.get<number>('shellOutputMaxLines', 20),
			shellHeredocFastPath: config.get<boolean>('shellHeredocFastPath', true),
			searchDefaultProvider: config.get<string>('search.defaultProvider', 'auto'),
			searchAskToBroaden: config.get<boolean>('search.askToBroaden', true),
			searchMaxOutputLines: config.get<number>('search.maxOutputLines', 60),
			googleCseApiKey: config.get<string>('googleCseApiKey', ''),
			googleCseCx: config.get<string>('googleCseCx', ''),
			semanticProgramMode: config.get<boolean>('semanticProgramMode', true),
			semanticProgramDebug: config.get<boolean>('semanticProgramDebug', false),
			maxPlanSteps: config.get<number>('maxPlanSteps', 64),
		},
	};
}

function getModelSettingsHtml(_payload: ReturnType<typeof getModelSettingsPayload>): string {
	const nonce = createNonce();
	const defaultBaseUrlsJson = JSON.stringify(DEFAULT_BASE_URLS);
	const inferProviderFromUrlStr = inferProviderFromUrl.toString();
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>HIM CODE User Settings</title>
	<style>
		body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); margin: 0; padding: 20px; }
		.container { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
		h1 { font-size: 20px; margin: 0 0 4px 0; }
		.hint { opacity: .75; font-size: 12px; margin-bottom: 8px; }
		.panel { border: 1px solid var(--vscode-widget-border); border-radius: 10px; background: var(--vscode-editorWidget-background); padding: 14px; }
		.panel-title { font-size: 15px; font-weight: 600; }
		.custom-row { display: grid; grid-template-columns: 0.8fr 1.2fr 1fr 1fr auto; gap: 10px; align-items: center; margin-bottom: 10px; }
		.custom-row:last-child { margin-bottom: 0; }
		input, select, button, textarea { font-family: inherit; font-size: 13px; }
		input, select, textarea { border-radius: 6px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 0 8px; }
		input, select { height: 30px; }
		textarea { min-height: 80px; padding: 8px; resize: vertical; }
		button.primary { height: 32px; border: 0; border-radius: 6px; padding: 0 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
		button.secondary { height: 30px; border: 1px solid var(--vscode-button-border); border-radius: 6px; padding: 0 12px; background: var(--vscode-editor-background); color: var(--vscode-foreground); cursor: pointer; }
		button.ghost { height: 30px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 0 10px; background: transparent; color: var(--vscode-foreground); cursor: pointer; }
		.top-actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
		.empty { font-size: 12px; opacity: .75; padding: 8px 2px; }
		.bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
		.saved { font-size: 12px; opacity: .8; }
	</style>
</head>
<body>
	<div class="container">
		<div>
			<h1>HIM CODE User Settings</h1>
			<div class="hint">All HIM CODE settings live here. Add your models and tune shell/search behavior.</div>
		</div>
		<div class="panel">
			<div class="top-actions">
				<div class="panel-title">Runtime</div>
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr 1fr 1fr;">
				<input id="provider" type="text" placeholder="Provider (e.g. gemini/openai)" />
				<input id="model" type="text" placeholder="Model override" />
				<input id="baseUrl" type="text" placeholder="Base URL override" />
				<input id="apiKey" type="password" placeholder="Global API Key" />
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr 1fr 1fr;">
				<input id="temperature" type="number" min="0" max="2" step="0.1" placeholder="Temperature" />
				<input id="maxTokens" type="number" min="64" max="32768" placeholder="Max tokens" />
				<input id="timeoutMs" type="number" min="1000" max="600000" placeholder="Timeout ms" />
				<input id="historyTurns" type="number" min="0" max="40" placeholder="History turns" />
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr 1fr;">
				<input id="requestPath" type="text" placeholder="Request path" />
				<input id="anthropicVersion" type="text" placeholder="Anthropic version" />
				<input id="minimaxGroupId" type="text" placeholder="MiniMax GroupId" />
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr;">
				<textarea id="systemPrompt" placeholder="System prompt"></textarea>
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr;">
				<textarea id="providerApiKeysJson" placeholder='providerApiKeys JSON, e.g. {"openai":"sk-..."}'></textarea>
				<textarea id="providerModelsJson" placeholder='providerModels JSON, e.g. {"openai":"gpt-4.1-mini"}'></textarea>
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr 1fr 1fr;">
				<input id="shellOutputMaxLines" type="number" min="1" max="200" placeholder="Shell output max lines" />
				<select id="searchDefaultProvider">
					<option value="auto">Search provider: auto</option>
					<option value="whitelist">Search provider: whitelist</option>
					<option value="web">Search provider: web</option>
					<option value="google">Search provider: google</option>
				</select>
				<input id="searchMaxOutputLines" type="number" min="5" max="400" placeholder="Search max output lines" />
				<label style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:.85;">
					<input id="searchAskToBroaden" type="checkbox" />
					Ask to broaden
				</label>
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr 1fr 1fr;">
				<label style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:.85;">
					<input id="shellHeredocFastPath" type="checkbox" />
					Heredoc fast-path
				</label>
				<input id="googleCseApiKey" type="password" placeholder="Google CSE API Key" />
				<input id="googleCseCx" type="text" placeholder="Google CSE CX" />
				<div class="hint" style="margin:0;">Tip: use <code>google: query</code> in &lt;him-search&gt;.</div>
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr 1fr; align-items: center;">
				<label style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:.9;">
					<input id="semanticProgramMode" type="checkbox" />
					<strong>Semantic program mode</strong> — Author + Compiler + Codegen (<code>&lt;him-semantic-program&gt;</code>)
				</label>
				<input id="maxPlanSteps" type="number" min="4" max="256" placeholder="Max semantic steps per send" title="himCode.chat.maxPlanSteps" />
			</div>
			<div class="custom-row" style="grid-template-columns: 1fr;">
				<label style="display:flex; align-items:center; gap:8px; font-size:12px; opacity:.85;">
					<input id="semanticProgramDebug" type="checkbox" />
					<strong>Semantic program debug</strong> — show a collapsible <strong>Debug</strong> card (model input/output per Author, Compiler, Codegen). May expose API keys in system prompts.
				</label>
			</div>
			<div class="hint" style="margin:-8px 0 0 0;">Also in User Settings: search <code>himCode.chat</code> or use the gear on HIM CODE view (opens Settings filtered).</div>
		</div>
		<div class="panel">
			<div class="top-actions">
				<div class="panel-title">Custom Models</div>
				<button class="secondary" id="addModelBtn">Add Model</button>
			</div>
			<div class="hint">Input 1: Provider (select or type). Input 2: Base URL. Input 3: Model Name. Input 4: API Key.</div>
			<datalist id="providerOptions"></datalist>
			<div id="customModels"></div>
		</div>
		<div class="bottom">
			<div class="saved" id="savedState"></div>
			<button class="primary" id="saveBtn">Save</button>
		</div>
	</div>
	<script nonce="${nonce}">
		const DEFAULT_BASE_URLS = ${defaultBaseUrlsJson};
		${inferProviderFromUrlStr}
		const vscode = acquireVsCodeApi();
		const state = { providers: [], customModels: [], selectedModelId: '', otherSettings: {} };
		const customModelsRoot = document.getElementById('customModels');
		const provider = document.getElementById('provider');
		const apiKey = document.getElementById('apiKey');
		const baseUrl = document.getElementById('baseUrl');
		const model = document.getElementById('model');
		const systemPrompt = document.getElementById('systemPrompt');
		const temperature = document.getElementById('temperature');
		const maxTokens = document.getElementById('maxTokens');
		const timeoutMs = document.getElementById('timeoutMs');
		const historyTurns = document.getElementById('historyTurns');
		const requestPath = document.getElementById('requestPath');
		const anthropicVersion = document.getElementById('anthropicVersion');
		const minimaxGroupId = document.getElementById('minimaxGroupId');
		const providerApiKeysJson = document.getElementById('providerApiKeysJson');
		const providerModelsJson = document.getElementById('providerModelsJson');
		const shellOutputMaxLines = document.getElementById('shellOutputMaxLines');
		const shellHeredocFastPath = document.getElementById('shellHeredocFastPath');
		const searchDefaultProvider = document.getElementById('searchDefaultProvider');
		const searchAskToBroaden = document.getElementById('searchAskToBroaden');
		const searchMaxOutputLines = document.getElementById('searchMaxOutputLines');
		const googleCseApiKey = document.getElementById('googleCseApiKey');
		const googleCseCx = document.getElementById('googleCseCx');
		const semanticProgramMode = document.getElementById('semanticProgramMode');
		const semanticProgramDebug = document.getElementById('semanticProgramDebug');
		const maxPlanSteps = document.getElementById('maxPlanSteps');

		function renderOtherSettings() {
			const o = state.otherSettings || {};
			provider.value = o.provider ?? 'gemini';
			apiKey.value = o.apiKey ?? '';
			baseUrl.value = o.baseUrl ?? '';
			model.value = o.model ?? '';
			systemPrompt.value = o.systemPrompt ?? '';
			temperature.value = o.temperature ?? 0.2;
			maxTokens.value = o.maxTokens ?? 16384;
			timeoutMs.value = o.timeoutMs ?? 300000;
			historyTurns.value = o.historyTurns ?? 8;
			requestPath.value = o.requestPath ?? '/chat/completions';
			anthropicVersion.value = o.anthropicVersion ?? '2023-06-01';
			minimaxGroupId.value = o.minimaxGroupId ?? '';
			providerApiKeysJson.value = o.providerApiKeysJson ?? '{}';
			providerModelsJson.value = o.providerModelsJson ?? '{}';
			shellOutputMaxLines.value = o.shellOutputMaxLines ?? 20;
			shellHeredocFastPath.checked = !!o.shellHeredocFastPath;
			searchDefaultProvider.value = o.searchDefaultProvider ?? 'auto';
			searchAskToBroaden.checked = (o.searchAskToBroaden ?? true) ? true : false;
			searchMaxOutputLines.value = o.searchMaxOutputLines ?? 60;
			googleCseApiKey.value = o.googleCseApiKey ?? '';
			googleCseCx.value = o.googleCseCx ?? '';
			semanticProgramMode.checked = !!o.semanticProgramMode;
			if (semanticProgramDebug) {
				semanticProgramDebug.checked = !!o.semanticProgramDebug;
			}
			maxPlanSteps.value = o.maxPlanSteps ?? 64;
		}
		const providerOptions = document.getElementById('providerOptions');
		const addModelBtn = document.getElementById('addModelBtn');
		const saveBtn = document.getElementById('saveBtn');
		const savedState = document.getElementById('savedState');

		function makeId() {
			return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
		}

		function normalizeCustomModels() {
			state.customModels = state.customModels
				.map(item => ({
					id: typeof item.id === 'string' && item.id ? item.id : makeId(),
					provider: typeof item.provider === 'string' ? item.provider.trim() : '',
					baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '',
					model: typeof item.model === 'string' ? item.model.trim() : '',
					apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : ''
				}))
				.filter(item => item.model)
				.map(item => ({ ...item, provider: item.provider || 'openaiCompatible' }));
			if (!state.customModels.some(item => item.id === state.selectedModelId)) {
				state.selectedModelId = state.customModels[0]?.id || '';
			}
		}

		function render() {
			providerOptions.innerHTML = '';
			for (const provider of state.providers) {
				const option = document.createElement('option');
				option.value = provider.value;
				option.textContent = provider.label;
				providerOptions.appendChild(option);
			}

			customModelsRoot.innerHTML = '';
			if (!state.customModels.length) {
				const empty = document.createElement('div');
				empty.className = 'empty';
				empty.textContent = 'No models yet. Click Add Model.';
				customModelsRoot.appendChild(empty);
			}

			for (const custom of state.customModels) {
				const row = document.createElement('div');
				row.className = 'custom-row';

				const providerInput = document.createElement('input');
				providerInput.placeholder = 'Provider';
				providerInput.setAttribute('list', 'providerOptions');
				providerInput.value = custom.provider || '';
				providerInput.addEventListener('input', () => {
					custom.provider = providerInput.value;
					if (DEFAULT_BASE_URLS[providerInput.value] && !custom.baseUrl) {
						urlInput.value = DEFAULT_BASE_URLS[providerInput.value];
						custom.baseUrl = DEFAULT_BASE_URLS[providerInput.value];
					}
				});

				const urlInput = document.createElement('input');
				urlInput.placeholder = 'Base URL (auto-detects provider)';
				urlInput.value = custom.baseUrl || '';
				urlInput.addEventListener('input', () => {
					custom.baseUrl = urlInput.value;
					if (!custom.provider || custom.provider === 'openaiCompatible') {
						const inferred = inferProviderFromUrl(custom.baseUrl);
						if (inferred !== 'openaiCompatible') {
							custom.provider = inferred;
							providerInput.value = inferred;
						}
					}
				});

				const modelInput = document.createElement('input');
				modelInput.placeholder = 'Model name';
				modelInput.value = custom.model || '';
				modelInput.addEventListener('input', () => {
					custom.model = modelInput.value;
				});

				const keyInput = document.createElement('input');
				keyInput.type = 'password';
				keyInput.placeholder = 'API key';
				keyInput.value = custom.apiKey || '';
				keyInput.addEventListener('input', () => {
					custom.apiKey = keyInput.value;
				});

				const removeBtn = document.createElement('button');
				removeBtn.className = 'ghost';
				removeBtn.textContent = 'Remove';
				removeBtn.addEventListener('click', () => {
					state.customModels = state.customModels.filter(item => item.id !== custom.id);
					if (state.selectedModelId === custom.id) {
						state.selectedModelId = '';
					}
					render();
				});

				row.appendChild(providerInput);
				row.appendChild(urlInput);
				row.appendChild(modelInput);
				row.appendChild(keyInput);
				row.appendChild(removeBtn);
				customModelsRoot.appendChild(row);
			}
		}

		addModelBtn.addEventListener('click', () => {
			state.customModels.push({ id: makeId(), provider: 'openai', baseUrl: '', model: '', apiKey: '' });
			render();
		});

		saveBtn.addEventListener('click', () => {
			savedState.textContent = '';
			normalizeCustomModels();
			vscode.postMessage({
				type: 'save',
				customModels: state.customModels,
				selectedModelId: state.selectedModelId,
				otherSettings: {
					provider: String(provider.value || ''),
					apiKey: String(apiKey.value || ''),
					baseUrl: String(baseUrl.value || ''),
					model: String(model.value || ''),
					systemPrompt: String(systemPrompt.value || ''),
					temperature: Number(temperature.value || 0.2),
					maxTokens: Number(maxTokens.value || 16384),
					timeoutMs: Number(timeoutMs.value || 300000),
					historyTurns: Number(historyTurns.value || 8),
					requestPath: String(requestPath.value || '/chat/completions'),
					anthropicVersion: String(anthropicVersion.value || '2023-06-01'),
					minimaxGroupId: String(minimaxGroupId.value || ''),
					providerApiKeysJson: String(providerApiKeysJson.value || '{}'),
					providerModelsJson: String(providerModelsJson.value || '{}'),
					shellOutputMaxLines: Number(shellOutputMaxLines.value || 20),
					shellHeredocFastPath: !!shellHeredocFastPath.checked,
					searchDefaultProvider: String(searchDefaultProvider.value || 'auto'),
					searchAskToBroaden: !!searchAskToBroaden.checked,
					searchMaxOutputLines: Number(searchMaxOutputLines.value || 60),
					googleCseApiKey: String(googleCseApiKey.value || ''),
					googleCseCx: String(googleCseCx.value || ''),
					semanticProgramMode: !!semanticProgramMode.checked,
					semanticProgramDebug: !!(semanticProgramDebug && semanticProgramDebug.checked),
					maxPlanSteps: Number(maxPlanSteps.value || 64),
				}
			});
		});

		window.addEventListener('message', event => {
			const message = event.data;
			if (message?.type === 'init') {
				state.providers = [...message.payload.providers];
				state.customModels = [...message.payload.customModels];
				state.selectedModelId = message.payload.selectedModelId || '';
				state.otherSettings = message.payload.otherSettings || {};
				render();
				renderOtherSettings();
			} else if (message?.type === 'saved') {
				savedState.textContent = 'Saved';
				setTimeout(() => savedState.textContent = '', 1500);
			}
		});
	</script>
</body>
</html>`;
}

function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) { return min; }
	return Math.max(min, Math.min(max, value));
}

async function runHimWebSearch(query: string, provider: string): Promise<{ ok: boolean; output: string }> {
	const cfg = vscode.workspace.getConfiguration(CONFIG_ROOT);
	const timeoutMs = 12000;

	const getJson = async (url: string, headers?: Record<string, string>): Promise<any> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await (globalThis.fetch as any)(url, { method: 'GET', headers, signal: controller.signal });
			const text = await response.text();
			try { return JSON.parse(text); } catch { return undefined; }
		} finally {
			clearTimeout(timer);
		}
	};

	const format = (title: string, items: Array<{ label: string; url: string; snippet?: string }>): string => {
		const lines: string[] = [`${title} — ${items.length} result(s)`];
		for (const item of items.slice(0, 8)) {
			lines.push(`- ${item.label}`);
			lines.push(`  ${item.url}`);
			if (item.snippet) {
				const s = item.snippet.replace(/\s+/g, ' ').trim();
				lines.push(`  ${s.length > 220 ? s.slice(0, 220) + '…' : s}`);
			}
		}
		return lines.join('\n');
	};

	const whitelistSearch = async (): Promise<Array<{ label: string; url: string; snippet?: string }>> => {
		const out: Array<{ label: string; url: string; snippet?: string }> = [];
		try {
			const so = await getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5`);
			for (const it of (so?.items ?? []) as any[]) {
				if (typeof it?.link === 'string' && typeof it?.title === 'string') {
					out.push({ label: `StackOverflow: ${it.title}`, url: it.link, snippet: it.body_markdown ?? it.body ?? '' });
				}
			}
		} catch { /* ignore */ }
		try {
			const wp = await getJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json&origin=*`);
			const titles = Array.isArray(wp?.[1]) ? wp[1] : [];
			const descs = Array.isArray(wp?.[2]) ? wp[2] : [];
			const urls = Array.isArray(wp?.[3]) ? wp[3] : [];
			for (let i = 0; i < Math.min(titles.length, urls.length); i++) {
				out.push({ label: `Wikipedia: ${titles[i]}`, url: urls[i], snippet: descs[i] ?? '' });
			}
		} catch { /* ignore */ }
		try {
			const gh = await getJson(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=5`, { 'user-agent': 'HIM-CODE' });
			for (const it of (gh?.items ?? []) as any[]) {
				if (typeof it?.html_url === 'string' && typeof it?.title === 'string') {
					out.push({ label: `GitHub: ${it.title}`, url: it.html_url, snippet: it.body ?? '' });
				}
			}
		} catch { /* ignore */ }
		return out;
	};

	const googleSearch = async (): Promise<string> => {
		const apiKey = (cfg.get<string>('googleCseApiKey', '') ?? '').trim();
		const cx = (cfg.get<string>('googleCseCx', '') ?? '').trim();
		if (!apiKey || !cx) {
			return 'Google CSE is not configured. Set himCode.chat.googleCseApiKey and himCode.chat.googleCseCx in HIM CODE User Settings.';
		}
		const g = await getJson(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}`);
		const items = ((g?.items ?? []) as any[]).slice(0, 6).map(it => ({
			label: `Google: ${String(it?.title ?? '').trim()}`,
			url: String(it?.link ?? '').trim(),
			snippet: String(it?.snippet ?? '').trim(),
		})).filter(it => it.url);
		return items.length ? format('Google CSE search', items) : 'Google CSE returned no results.';
	};

	const webSearch = async (): Promise<string> => {
		const urlMatch = query.match(/https?:\/\/\S+/i);
		if (urlMatch) {
			const target = urlMatch[0];
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeoutMs);
				const response = await (globalThis.fetch as any)(target, { method: 'GET', signal: controller.signal });
				const html = String(await response.text() ?? '');
				clearTimeout(timer);
				const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
				const bodyText = html
					.replace(/<script[\s\S]*?<\/script>/gi, ' ')
					.replace(/<style[\s\S]*?<\/style>/gi, ' ')
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim()
					.slice(0, 1200);
				return [
					`Direct fetch — 1 result(s)`,
					`- ${title || target}`,
					`  ${target}`,
					`  ${bodyText || '(no readable body content)'}`,
				].join('\n');
			} catch (err) {
				return `Direct fetch failed for ${target}: ${toErrorMessage(err)}`;
			}
		}

		// Public web search without API key (best-effort)
		try {
			const ddg = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
			const items: Array<{ label: string; url: string; snippet?: string }> = [];
			const abstractUrl = String(ddg?.AbstractURL ?? '').trim();
			const abstractText = String(ddg?.AbstractText ?? '').trim();
			const heading = String(ddg?.Heading ?? '').trim();
			if (abstractUrl) {
				items.push({ label: heading || abstractUrl, url: abstractUrl, snippet: abstractText });
			}
			const related = Array.isArray(ddg?.RelatedTopics) ? ddg.RelatedTopics : [];
			for (const it of related) {
				const firstUrl = String(it?.FirstURL ?? '').trim();
				const text = String(it?.Text ?? '').trim();
				if (firstUrl) {
					items.push({ label: text || firstUrl, url: firstUrl, snippet: text });
				}
				if (Array.isArray(it?.Topics)) {
					for (const sub of it.Topics) {
						const u = String(sub?.FirstURL ?? '').trim();
						const t = String(sub?.Text ?? '').trim();
						if (u) {
							items.push({ label: t || u, url: u, snippet: t });
						}
					}
				}
				if (items.length >= 8) { break; }
			}
			if (items.length > 0) {
				return format('Open web search', items.slice(0, 8));
			}
		} catch {
			// ignore and return clear fallback below
		}
		// Fallback: scrape Bing SERP titles/snippets (best effort, no API key).
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			const resp = await (globalThis.fetch as any)(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { method: 'GET', signal: controller.signal });
			const html = String(await resp.text() ?? '');
			clearTimeout(timer);
			const items: Array<{ label: string; url: string; snippet?: string }> = [];
			const re = /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[\s\S]*?>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p>([\s\S]*?)<\/p>)?/gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) && items.length < 8) {
				const url = String(m[1] ?? '').trim();
				const title = String(m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
				const snippet = String(m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
				if (url) {
					items.push({ label: title || url, url, snippet });
				}
			}
			if (items.length > 0) {
				return format('Open web search (Bing fallback)', items);
			}
		} catch {
			// ignore
		}
		return 'Open web search returned no results.';
	};

	if (provider === 'google') {
		return { ok: true, output: await googleSearch() };
	}
	if (provider === 'web') {
		return { ok: true, output: await webSearch() };
	}
	const wl = await whitelistSearch();
	return { ok: true, output: wl.length ? format('Whitelist search', wl) : '' };
}

function createNonce(length: number = 16): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

class HimLanguageModelProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	notifyModelInfoChanged(): void {
		this._onDidChange.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	async provideLanguageModelChatInformation(_options: vscode.PrepareLanguageModelChatModelOptions, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		const cfg = resolveChatConfig();
		return [{
			id: `him-${cfg.provider}-${cfg.model}`,
			name: `HIM ${cfg.provider}`,
			family: cfg.model,
			version: '1',
			maxInputTokens: MAX_INPUT_TOKENS,
			maxOutputTokens: cfg.maxTokens,
			capabilities: {},
		}];
	}

	async provideLanguageModelChatResponse(_model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], _options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, token: vscode.CancellationToken): Promise<void> {
	
		const cfg = resolveChatConfig();
		validateConfigurationOrThrow(cfg);
		const requestMessages = toProviderMessagesFromLMRequest(messages, cfg.systemPrompt);
		const text = await requestProvider(cfg, requestMessages, token);
		progress.report(new vscode.LanguageModelTextPart(text));
	}

	async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
		const value = typeof text === 'string' ? text : lmMessageToText(text);
		return estimateTokenCount(value);
	}
}

async function handleChatRequest(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<vscode.ChatResult> {
	try {
		const cfg = resolveChatConfig();
		validateConfigurationOrThrow(cfg);

		if (request.command === 'status') {
			stream.markdown(renderStatus(cfg));
			return { metadata: { status: 'ok', provider: cfg.provider, model: cfg.model } };
		}

		stream.progress(`HIM Chat: ${cfg.provider} / ${cfg.model}`);

		inspectorService.startThinking(request.prompt);

		const messages = toProviderMessagesFromChatContext(request, context, cfg.systemPrompt, cfg.historyTurns);

		const text = await requestProvider(cfg, messages, token);

		if (text) {
			inspectorService.startCodeGeneration('python');

			const lines = text.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const isCodeBlock = line.trim().startsWith('```') || line.trim().startsWith('import ') || line.trim().startsWith('def ') || line.trim().startsWith('class ');
				if (isCodeBlock || line.trim().length > 0) {
					inspectorService.addCodeChunk(line, i + 1, lines.length, i === lines.length - 1);
				}
			}

			inspectorService.completeCodeGeneration(lines.length, text);
		}

		stream.markdown(text || '_Provider returned an empty response._');
		return { metadata: { provider: cfg.provider, model: cfg.model } };
	} catch (error) {
		inspectorService.emitStreamEvent('error', toErrorMessage(error));
		return {
			errorDetails: {
				message: toErrorMessage(error),
			},
		};
	}
}

function renderStatus(cfg: ResolvedChatConfig): string {
	const hasKey = cfg.apiKey ? 'configured' : 'missing';
	return [
		'### HIM Chat Status',
		`- Provider: \`${cfg.provider}\``,
		`- Model: \`${cfg.model}\``,
		`- Base URL: \`${cfg.baseUrl}\``,
		`- API key: \`${hasKey}\``,
		`- Timeout: \`${cfg.timeoutMs}ms\``,
	].join('\n');
}

function toProviderMessagesFromChatContext(request: vscode.ChatRequest, context: vscode.ChatContext, systemPrompt: string, historyTurns: number): ChatMessage[] {
	const messages: ChatMessage[] = [];
	if (systemPrompt.trim()) {
		messages.push({ role: 'system', content: systemPrompt.trim() });
	}

	const relevantHistory = context.history.slice(-Math.max(0, historyTurns) * 2);
	for (const turn of relevantHistory) {
		if (turn instanceof vscode.ChatRequestTurn) {
			const text = turn.prompt.trim();
			if (text) {
				messages.push({ role: 'user', content: text });
			}
			continue;
		}

		if (turn instanceof vscode.ChatResponseTurn) {
			const text = chatResponseTurnToText(turn).trim();
			if (text) {
				messages.push({ role: 'assistant', content: text });
			}
		}
	}

	if (request.prompt.trim()) {
		messages.push({ role: 'user', content: request.prompt.trim() });
	}

	return messages;
}

function chatResponseTurnToText(turn: vscode.ChatResponseTurn): string {
	const parts: string[] = [];
	for (const part of turn.response) {
		if (part instanceof vscode.ChatResponseMarkdownPart) {
			parts.push(part.value.value);
		}
	}
	return parts.join('\n').trim();
}

function toProviderMessagesFromLMRequest(messages: readonly vscode.LanguageModelChatRequestMessage[], systemPrompt: string): ChatMessage[] {
	const result: ChatMessage[] = [];
	if (systemPrompt.trim()) {
		result.push({ role: 'system', content: systemPrompt.trim() });
	}

	for (const message of messages) {
		const content = lmMessageToText(message).trim();
		if (!content) {
			continue;
		}
		const role: MessageRole = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
		result.push({ role, content });
	}

	return result;
}

function lmMessageToText(message: vscode.LanguageModelChatRequestMessage): string {
	const parts: string[] = [];
	const textDecoder = new TextDecoder();
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			parts.push(part.value);
		} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('text/')) {
			parts.push(textDecoder.decode(part.data));
		}
	}
	return parts.join('\n');
}

async function requestProvider(cfg: ResolvedChatConfig, messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
	switch (cfg.provider) {
		case 'openai':
		case 'openaiCompatible':
		case 'minimax':
			return requestOpenAICompatible(cfg, messages, token);
		case 'anthropic':
			return requestAnthropic(cfg, messages, token);
		case 'gemini':
			return requestGemini(cfg, messages, token);
		default:
			throw new Error(`Unsupported provider: ${cfg.provider}`);
	}
}

async function requestOpenAICompatible(cfg: ResolvedChatConfig, messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
	const url = joinUrl(cfg.baseUrl, cfg.requestPath);
	const body: any = {
		model: cfg.model,
		messages: messages.map(m => ({ role: m.role, content: m.content })),
		temperature: cfg.temperature,
		max_tokens: cfg.maxTokens,
		stream: false,
	};

	if (cfg.provider === 'minimax') {
		body.thinking = {
			type: "enabled",
			effort: "high",
			budget_tokens: 12000
		};
	}

	const headers: Record<string, string> = {
		'content-type': 'application/json',
	};
	if (cfg.apiKey) {
		headers.authorization = `Bearer ${cfg.apiKey}`;
	}
	if (cfg.provider === 'minimax' && cfg.minimaxGroupId) {
		headers.groupid = cfg.minimaxGroupId;
	}

	const data = await postJson(url, headers, body, token, cfg.timeoutMs);
	return extractOpenAIText(data);
}

async function requestAnthropic(cfg: ResolvedChatConfig, messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
	const url = joinUrl(cfg.baseUrl, '/messages');
	const systemPrompt = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n').trim();
	const chatMessages = messages
		.filter(m => m.role !== 'system')
		.map(m => ({
			role: m.role === 'assistant' ? 'assistant' : 'user',
			content: m.content,
		}));

	const body = {
		model: cfg.model,
		system: systemPrompt || undefined,
		messages: chatMessages,
		temperature: cfg.temperature,
		max_tokens: cfg.maxTokens,
	};

	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-api-key': cfg.apiKey,
		'anthropic-version': cfg.anthropicVersion,
	};

	const data = await postJson(url, headers, body, token, cfg.timeoutMs);
	return extractAnthropicText(data);
}

async function requestGemini(cfg: ResolvedChatConfig, messages: ChatMessage[], token: vscode.CancellationToken): Promise<string> {
	const sanitizedBase = trimRightSlash(cfg.baseUrl);
	const model = encodeURIComponent(normalizeGeminiModel(cfg.model));
	const key = encodeURIComponent(cfg.apiKey);
	const url = `${sanitizedBase}/models/${model}:generateContent?key=${key}`;

	const systemPrompt = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n').trim();
	const contents = messages
		.filter(m => m.role !== 'system')
		.map(m => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }],
		}));

	const bodyWithoutThinking = {
		contents,
		systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
		generationConfig: {
			temperature: cfg.temperature,
			maxOutputTokens: cfg.maxTokens,
		},
	};
	const bodyWithThinking = {
		...bodyWithoutThinking,
		generationConfig: {
			...bodyWithoutThinking.generationConfig,
				thinkingConfig: {
					includeThoughts: true,
					thinkingBudget: 1024,
				},
			},
		};

	const headers: Record<string, string> = {
		'content-type': 'application/json',
	};

	let data: any;
	try {
		data = await postJson(url, headers, bodyWithThinking, token, cfg.timeoutMs);
	} catch (error) {
		if (!isGeminiThinkingConfigError(error)) {
			throw error;
		}
		data = await postJson(url, headers, bodyWithoutThinking, token, cfg.timeoutMs);
	}
	return extractGeminiText(data);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, token: vscode.CancellationToken, timeoutMs: number): Promise<any> {
	const { signal, dispose } = createAbortSignal(token, timeoutMs);
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal,
		});

		const rawText = await response.text();
		const data = safeJsonParse(rawText);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}: ${extractErrorText(data, rawText)}`);
		}

		return data;
	} finally {
		dispose();
	}
}

function createAbortSignal(token: vscode.CancellationToken, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const cancellation = token.onCancellationRequested(() => controller.abort());
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			cancellation.dispose();
		},
	};
}

function safeJsonParse(raw: string): any {
	if (!raw) {
		return {};
	}
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function extractOpenAIText(data: any): string {
	const message = data?.choices?.[0]?.message;

	if (!message) {
		return '';
	}

	let thinking = '';
	if (typeof message.thinking === 'string') {
		thinking = message.thinking;
	}

	const content = message.content;
	let text = '';

	if (typeof content === 'string') {
		text = content.trim();
	} else if (Array.isArray(content)) {
		text = content
			.map((part: any) => {
				if (typeof part === 'string') {
					return part;
				}
				if (typeof part?.text === 'string') {
					return part.text;
				}
				return '';
			})
			.join('\n')
			.trim();
	}

	if (thinking && text) {
		return thinking + '\n\n' + text;
	}

	return (text || thinking).trim();
}

function extractAnthropicText(data: any): string {
	if (!Array.isArray(data?.content)) {
		return '';
	}

	return data.content
		.map((part: any) => (part?.type === 'text' && typeof part?.text === 'string') ? part.text : '')
		.join('\n')
		.trim();
}

function extractGeminiText(data: any): string {
	const parts = data?.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) {
		const blocked = data?.promptFeedback?.blockReason;
		if (blocked) {
			throw new Error(`Gemini blocked the prompt: ${String(blocked)}`);
		}
		return '';
	}

	return parts
		.map((part: any) => {
			if (part?.text && typeof part?.text === 'string') {
				return part.text;
			}
			return '';
		})
		.join('\n')
		.trim();
}

function extractErrorText(data: any, fallback: string): string {
	const structured =
		data?.error?.message ??
		data?.message ??
		data?.detail ??
		data?.details?.message;
	if (typeof structured === 'string' && structured.trim()) {
		return structured.trim();
	}
	return fallback || 'Unknown request failure';
}

function resolveChatConfig(): ResolvedChatConfig {
	const config = vscode.workspace.getConfiguration(CONFIG_ROOT);
	let provider = sanitizeProvider(config.get<string>('provider'));
	const providerModels = sanitizeStringMap(config.get('providerModels'));
	const providerApiKeys = sanitizeStringMap(config.get('providerApiKeys'));
	let apiKey = resolveApiKey(
		provider,
		typeof providerApiKeys[provider] === 'string' ? providerApiKeys[provider] : '',
		config.get<string>('apiKey', '').trim()
	);
	let baseUrl = resolveBaseUrl(provider, config.get<string>('baseUrl', '').trim());
	const providerModel = typeof providerModels[provider] === 'string' ? providerModels[provider] : '';
	let model = resolveModel(provider, providerModel || config.get<string>('model', '').trim());
	const customModels = sanitizeCustomModels(config.get('customModels'));
	const selectedModelId = (config.get<string>('selectedModelId', '') || '').trim();
	const selectedCustom = customModels.find(custom => custom.id === selectedModelId) ?? customModels[0];
	if (selectedCustom) {
		provider = selectedCustom.provider;
		baseUrl = selectedCustom.baseUrl ? trimRightSlash(selectedCustom.baseUrl) : resolveBaseUrl(provider, '');
		model = selectedCustom.model;
		apiKey = selectedCustom.apiKey || apiKey;
	}
	const systemPrompt = config.get<string>('systemPrompt', '').trim();
	const temperature = config.get<number>('temperature', 0.2);
	const maxTokens = config.get<number>('maxTokens', 16384);
	const timeoutMs = config.get<number>('timeoutMs', 300000);
	const historyTurns = config.get<number>('historyTurns', 8);
	const requestPath = ensureStartsWithSlash(config.get<string>('requestPath', '/chat/completions').trim() || '/chat/completions');
	const anthropicVersion = config.get<string>('anthropicVersion', '2023-06-01').trim() || '2023-06-01';
	const minimaxGroupId = config.get<string>('minimaxGroupId', '').trim();

	return {
		provider,
		apiKey,
		baseUrl,
		model,
		systemPrompt,
		temperature,
		maxTokens,
		timeoutMs,
		historyTurns,
		requestPath,
		anthropicVersion,
		minimaxGroupId,
	};
}

function validateConfigurationOrThrow(cfg: ResolvedChatConfig): void {
	if (!cfg.model) {
		throw new Error('HIM Chat model is empty. Please configure himCode.chat.model.');
	}
	if (!cfg.baseUrl) {
		throw new Error('HIM Chat baseUrl is empty. Please configure himCode.chat.baseUrl.');
	}
	if (!cfg.apiKey && cfg.provider !== 'openaiCompatible') {
		throw new Error(`HIM Chat API key is missing for provider "${cfg.provider}".`);
	}
}

function sanitizeProvider(value: string | undefined): ProviderKind {
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

function resolveApiKey(provider: ProviderKind, providerKey: string, configuredKey: string): string {
	if (providerKey) {
		return providerKey;
	}
	if (configuredKey) {
		return configuredKey;
	}

	switch (provider) {
		case 'openai':
			return readEnv('OPENAI_API_KEY');
		case 'anthropic':
			return readEnv('ANTHROPIC_API_KEY');
		case 'gemini':
			return readEnv('GEMINI_API_KEY') || readEnv('GOOGLE_API_KEY');
		case 'minimax':
			return readEnv('MINIMAX_API_KEY');
		case 'openaiCompatible':
			return readEnv('OPENAI_API_KEY');
		default:
			return '';
	}
}

function sanitizeStringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object') {
		return {};
	}

	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === 'string') {
			result[key] = entry.trim();
		}
	}
	return result;
}

function sanitizeCustomModels(value: unknown): CustomModelConfig[] {
	if (!Array.isArray(value)) {
		return DEFAULT_CUSTOM_MODELS.map(model => ({ ...model }));
	}

	const result: CustomModelConfig[] = [];
	for (let index = 0; index < value.length; index++) {
		const item = value[index];
		if (!item || typeof item !== 'object') {
			continue;
		}
		const row = item as Record<string, unknown>;
		const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `custom-${index}`;
		const provider = normalizeProviderInput(typeof row.provider === 'string' ? row.provider : '');
		const baseUrl = typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '';
		const model = typeof row.model === 'string' ? row.model.trim() : '';
		const apiKey = typeof row.apiKey === 'string' ? row.apiKey.trim() : '';
		if (!model) {
			continue;
		}
		result.push({ id, provider, baseUrl, model, apiKey });
	}
	return result.length ? result : DEFAULT_CUSTOM_MODELS.map(model => ({ ...model }));
}

function normalizeProviderInput(value: string): ProviderKind {
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

function resolveBaseUrl(provider: ProviderKind, configuredBaseUrl: string): string {
	if (configuredBaseUrl) {
		return trimRightSlash(configuredBaseUrl);
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

function normalizeGeminiModel(value: string): string {
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

function resolveModel(provider: ProviderKind, configuredModel: string): string {
	if (configuredModel) {
		return configuredModel;
	}

	switch (provider) {
		case 'openai':
		case 'openaiCompatible':
			return 'gpt-4o-mini';
		case 'anthropic':
			return 'claude-3-5-sonnet-latest';
		case 'gemini':
			return 'gemini-2.0-flash';
		case 'minimax':
			return 'abab6.5s-chat';
		default:
			return 'gpt-4o-mini';
	}
}

function readEnv(name: string): string {
	const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const value = processValue?.env?.[name];
	return typeof value === 'string' ? value.trim() : '';
}

function ensureStartsWithSlash(pathValue: string): string {
	return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function trimRightSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, requestPath: string): string {
	return `${trimRightSlash(baseUrl)}${ensureStartsWithSlash(requestPath)}`;
}

function estimateTokenCount(value: string): number {
	if (!value) {
		return 0;
	}
	return Math.ceil(value.length / 4);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return 'Unknown error';
}

function isGeminiThinkingConfigError(error: unknown): boolean {
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
