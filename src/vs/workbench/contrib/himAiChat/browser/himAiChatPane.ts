/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { asText, IRequestService } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IAccessibleViewInformationService } from '../../../services/accessibility/common/accessibleViewInformationService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { listenStream } from '../../../../base/common/stream.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITerminalService, ITerminalInstance } from '../../../contrib/terminal/browser/terminal.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { getCodeEditor, ICodeEditor, IContentWidget, IContentWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { extractEditorsDropData } from '../../../../platform/dnd/browser/dnd.js';
import { basename } from '../../../../base/common/resources.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { FileChangeType, FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { HIM_ATOMIC_PLAN_RULES, HIM_CORE_SYSTEM_PROMPT } from './himAiCorePrompt.js';
import { stripHimPlanBlockForDisplay } from './himPlanOrchestrator.js';
import { extractHimOrgBlock, parseHimOrganizationJson, stripHimOrgBlockForDisplay } from './himOrganizationApply.js';
import { formatHimPlanPromptPath } from './himPlanFileSupport.js';
import {
	applyCompilerRefactor,
	extractAndParseSemanticProgram,
	extractSemanticProgramBlock,
	buildSemanticStepUserMessage,
	parseCompilerResult,
	stripSemanticProgramBlockForDisplay,
	validateInstructionGraph,
} from './himSemanticProgramOrchestrator.js';
import {
	ensureSessionSemanticProgramBootstrap,
	getSemanticProgramUri,
	HIM_SEMANTIC_PROGRAM_FILENAME,
	validateSemanticProgramDocument,
	writeSemanticProgram,
} from './himSemanticProgramFileSupport.js';
import {
	HIM_SEMANTIC_COMPILER_SYSTEM,
	HIM_SEMANTIC_DEFAULT_GLOBAL_CONSTRAINTS,
	HIM_SEMANTIC_PROGRAM_PHASE1_SUFFIX,
} from './himSemanticProgramPrompts.js';
import {
	deltaNumstat,
	evaluateAtomicCodegenStep,
	parseGitNumstat,
} from './himSemanticAtomicRuntime.js';
import type { HimSemanticInstruction, HimSemanticProgramDocument } from './himSemanticProgramTypes.js';
import { IHimPythonReplService } from '../common/himPythonRepl.js';
import { HimPythonTagEvent, HimPythonTagStreamParser } from './himPythonTagStreamParser.js';
import { appendStreamCaret, parseAnswerSegments } from './himStreamAnswerSegments.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import Severity from '../../../../base/common/severity.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { HimChatWorkspaceSessionStore } from './himChatWorkspaceSessionStore.js';
import { getHimCodeHostDataRoot } from './himHostDataRoot.js';
import {
	ensureWorkspaceOrganizationBootstrap,
	getOrganizationFileUri,
	readOrganizationDocument,
	writeOrganizationDocument,
} from './himOrganizationFileSupport.js';
import { HIM_ORG_ORCHESTRATOR_AGENT_ID, HIM_ORG_USER_AGENT_ID } from './himOrganizationTypes.js';
import type { HimOrgAgent, HimOrganizationDocument } from './himOrganizationTypes.js';
import { buildWhisperWavFromFloatChunks } from './himWhisperAudio.js';
import { localize } from '../../../../nls.js';

type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'minimax' | 'openaiCompatible';
type MessageRole = 'system' | 'user' | 'assistant';

/** OpenAI-style multimodal part (also used as internal interchange for Gemini/Anthropic). */
type ProviderContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

interface ProviderMessage {
	role: MessageRole;
	content: string | ProviderContentPart[];
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

interface ProviderResponsePayload {
	text: string;
	thinking?: string;
}

/** Streaming deltas: answer text and/or model reasoning (e.g. MiniMax reasoning_details). */
interface HimStreamDelta {
	text?: string;
	thinking?: string;
}

interface CustomModelConfig {
	id: string;
	provider: ProviderKind;
	baseUrl: string;
	model: string;
	apiKey: string;
}

interface HimPythonExecRecord {
	readonly blockIndex: number;
	readonly code: string;
	readonly output: string;
	readonly hadError: boolean;
	readonly workspaceDiff?: string;
}

interface HimShellExecRecord {
	readonly blockIndex: number;
	readonly command: string;
	readonly output: string;
	readonly exitCode: number | null;
	readonly workspaceDiff?: string;
}

interface HimSearchExecRecord {
	readonly blockIndex: number;
	readonly query: string;
	readonly output: string;
}

interface ParsedDiffFile {
	readonly path: string;
	readonly added: number;
	readonly removed: number;
	readonly patch: string;
}

/** One provider round captured when `himCode.chat.semanticProgramDebug` is on. */
interface HimSemanticProgramDebugTurn {
	stepLabel: string;
	inputText: string;
	outputText: string;
	outputThinking?: string;
	notes?: string;
}

/** Collapsible trace attached to semantic-mode assistant messages (parse failures or full pipeline). */
interface HimSemanticProgramDebugCard {
	title: string;
	subtitle?: string;
	turns: HimSemanticProgramDebugTurn[];
	parseHint?: string;
	rawMergedBlobPreview?: string;
	rawTagInnerPreview?: string;
}

/** User-attached image persisted on the message (base64) for API replay and bubble display. */
interface HimChatImagePayload {
	mimeType: string;
	dataBase64: string;
	name?: string;
}

interface ViewMessage {
	role: 'user' | 'assistant';
	content: string;
	thinking?: string;
	thinkingDurationMs?: number;
	isError?: boolean;
	pythonExecutions?: HimPythonExecRecord[];
	shellExecutions?: HimShellExecRecord[];
	searchExecutions?: HimSearchExecRecord[];
	attachments?: { type: 'code' | 'file' | 'image'; name: string; range?: string; size?: string }[];
	/** Inline images for vision models (user turns). */
	images?: HimChatImagePayload[];
	semanticProgramDebug?: HimSemanticProgramDebugCard;
}

interface ChatSession {
	readonly id: string;
	title: string;
	/** Optional agent role used to build a per-session system prompt. */
	role?: string;
	/** Optional agent rule used to build a per-session system prompt. */
	rule?: string;
	messages: ViewMessage[];
	scrollTop: number;
	queuedMessages: string[];
	conversationSummary: string;
	/** True: Python finished in this session while another tab was active (show neon on tab). */
	pythonNotify?: boolean;
	/** When set, this tab is the conversation thread for that org agent (`org.json` `agents[].id`). */
	linkedOrgAgentId?: string;
}

type HimRenderState = 'READING' | 'CODING' | 'LOCKED' | 'RESUMING' | 'ERROR' | 'CANCELLED';

/** Per-request streaming + execution state so multiple chat tabs never share parsers, queues, or exec records. */
interface HimAgentRunContext {
	readonly sessionId: string;
	readonly tagParser: HimPythonTagStreamParser;
	pythonExecQueue: Promise<void>;
	pendingPythonExecs: HimPythonExecRecord[];
	streamPythonBlockCounter: number;
	ingestQueue: string[];
	renderState: HimRenderState;
	streamVisibleContent: string;
	agentLoopCount: number;
	pendingShellExecs: HimShellExecRecord[];
	streamShellBlockCounter: number;
	pendingSearchExecs: HimSearchExecRecord[];
	streamSearchBlockCounter: number;
	/** If true: <him-shell> is running in background while we keep processing stream. */
	shellExecInFlight: number;
	/** Wakes the agent loop when background shell execution completes. */
	notifyShellExecDone?: () => void;
	/** Prepended to streamed answer text for multi-step Plan mode UI. */
	planDisplayPrefix?: string;
	/** Current user request token — used to avoid showing LOCKED after Stop cancels the request. */
	activeRequestToken?: CancellationToken;
	/** Plan orchestration: map LOCKED UI to CODING so tools don’t show the lock chrome (tools still run). */
	orchestratedPlanStep?: boolean;
	/** Workspace-relative path to `plan.json` for streaming Plan strip + thin bar. */
	planWorkspaceRelativePath?: string;
}

function createAgentRunContext(sessionId: string): HimAgentRunContext {
	return {
		sessionId,
		tagParser: new HimPythonTagStreamParser(),
		pythonExecQueue: Promise.resolve(),
		pendingPythonExecs: [],
		streamPythonBlockCounter: 0,
		ingestQueue: [],
		renderState: 'READING',
		streamVisibleContent: '',
		agentLoopCount: 0,
		pendingShellExecs: [],
		streamShellBlockCounter: 0,
		pendingSearchExecs: [],
		streamSearchBlockCounter: 0,
		shellExecInFlight: 0,
		planDisplayPrefix: undefined,
		activeRequestToken: undefined,
		orchestratedPlanStep: undefined,
		planWorkspaceRelativePath: undefined,
	};
}

const COMPRESS_THRESHOLD_TURNS = 10;
const COMPRESS_KEEP_RECENT_TURNS = 5;
/** Display cap for “AI memory” meter (UTF-8 estimate of context payload, not GPU RAM). */
const AI_MEMORY_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
/** Cap untracked file diffs per capture to avoid flooding the embedded terminal. */
const MAX_GIT_UNTRACKED_FILE_DIFFS = 48;
/** Max untracked paths to numstat in one batched shell script (file-changes summary / diff capture). */
const MAX_UNTRACKED_PATHS_BATCH = 80;
/** Max rows in the non-git snapshot file-changes list (label still shows full count; footer when truncated). */
const HIM_FILE_CHANGES_SNAPSHOT_LIST_CAP = 200;
/** Debounce workspace file list refresh after tool runs (avoids N× git storms per user turn). */
const HIM_FILE_CHANGES_SUMMARY_DEBOUNCE_MS = 120;
/** File-changes list max height (30% of former min(320px, 45vh)). */
const HIM_FILE_CHANGES_LIST_MAX_CSS = 'min(96px, 13.5vh)';
const CONFIG_ROOT = 'himCode.chat';
/** Max size per pasted/dropped image in composer. */
const HIM_CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const HIM_CHAT_IMAGE_MAX_COUNT = 8;
/** Max chars embedded per @file attachment (must match send-time re-read truncation). */
const HIM_CHAT_FILE_ATTACH_MAX_CHARS = 2000;
/** Per-message content cap inside semantic debug “Input” dumps. */
const HIM_SEMANTIC_DEBUG_MAX_PER_MESSAGE = 28_000;
/** Per-field cap for model output / previews in semantic debug cards. */
const HIM_SEMANTIC_DEBUG_MAX_FIELD_CHARS = 96_000;
/** Dedicated PTY for git/snapshot/diff only — never mix with user `<him-shell>` (avoids stuck shells blocking markers). */
const HIM_INTERNAL_SHELL_SESSION_ID = 'him-code-internal';
const SECRET_KEY_PREFIX = 'himCode.chat.providerKey.';
/** Textarea auto-grow clamp (50% of prior 23–72px band). */
/** Composer grows with content; cap visible height at this many lines then scroll (see `resizeInputArea`). */
const HIM_INPUT_TEXTAREA_MAX_VISIBLE_LINES = 6;

const CHAT_PANE_MIN_WIDTH = 440;
const PROVIDER_PICKER_WIDTH = 118;
const DEFAULT_CUSTOM_MODEL_ID = 'gemini-default';
const DEFAULT_SHELL_OUTPUT_MAX_LINES = 20;
const DEFAULT_CUSTOM_MODELS: ReadonlyArray<CustomModelConfig> = [{
	id: DEFAULT_CUSTOM_MODEL_ID,
	provider: 'gemini',
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
	model: 'gemini-2.5-flash',
	apiKey: '',
}];

export class HimAiChatPane extends ViewPane {

	private messageListElement?: HTMLElement;
	private sessionStackHost?: HTMLElement;
	private readonly sessionPaneById = new Map<string, { root: HTMLElement; messageList: HTMLElement }>();
	private neonStylesInjected = false;
	private readonly workspaceSessionStore: HimChatWorkspaceSessionStore;
	private inputElement?: HTMLTextAreaElement;
	private providerSelectElement?: HTMLButtonElement;
	private providerMenuElement?: HTMLElement;
	private providerMenuListElement?: HTMLElement;
	private providerMenuSearchInput?: HTMLInputElement;
	private inputWrapperElement?: HTMLElement;
	private inputContainerElement?: HTMLElement;
	private controlsElement?: HTMLElement;
	private controlsLeftElement?: HTMLElement;
	private controlsRightElement?: HTMLElement;
	private providerPickerElement?: HTMLElement;
	private sendButtonElement?: HTMLButtonElement;
	private imagePickButtonElement?: HTMLButtonElement;
	private hiddenImageFileInput?: HTMLInputElement;
	private pendingImagesContainer?: HTMLElement;
	private micButtonElement?: HTMLButtonElement;
	/** Composer images before send (object URLs + base64 for API). */
	private readonly pendingComposerImages: Array<{ id: string; name: string; mimeType: string; dataBase64: string; previewUrl: string }> = [];
	private imageLightboxOverlay?: HTMLElement;
	private imageLightboxKeyHandler?: (e: KeyboardEvent) => void;
	private addButtonElement?: HTMLButtonElement;
	private modeBadgeElement?: HTMLElement;
	private agentEditOverlay?: HTMLElement;
	private agentEditPanel?: HTMLElement;
	private agentEditNameInput?: HTMLInputElement;
	private agentEditRoleInput?: HTMLTextAreaElement;
	private agentEditRuleInput?: HTMLTextAreaElement;
	private agentEditSessionId?: string;
	private activeCustomModelId = '';
	private isVoiceListening = false;
	/** Mic capture (ScriptProcessor → PCM → WAV → Whisper API). */
	private voiceWhisperChunks: Float32Array[] = [];
	private voiceWhisperStream?: MediaStream;
	private voiceWhisperContext?: AudioContext;
	private voiceWhisperProcessor?: ScriptProcessorNode;
	private voiceWhisperSource?: MediaStreamAudioSourceNode;
	private voiceWhisperMaxMsTimer?: ReturnType<typeof setTimeout>;
	private voiceWhisperTranscribing = false;
	private static readonly _maxWhisperRecordMs = 120_000;
	/** Extra phase-1 API round(s) when `<him-semantic-program>` parse fails (not added to visible chat). */
	private static readonly _semanticPhase1ExtraRoundsOnParseFail = 1;
	private isSending = false;
	private requestCts: CancellationTokenSource | undefined;
	private readonly renderedMarkdownByBubble = new Map<HTMLElement, IDisposable[]>();
	private readonly codeReferences: { uri: URI; content: string; language: string; range: string; element?: HTMLElement }[] = [];
	private readonly fileReferences: { uri: URI; content: string; element?: HTMLElement }[] = [];
	private attachmentsContainer?: HTMLElement;
	private fileChangesHintElement?: HTMLButtonElement;
	private fileChangesCountLabel?: HTMLElement;
	private fileChangesChevronSpan?: HTMLElement;
	private fileChangesListElement?: HTMLElement;
	private fileChangesListExpanded = false;
	private fileChangesSummaryRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private fileChangesOuterElement?: HTMLElement;
	private fileChangesUndoButton?: HTMLButtonElement;
	private fileChangesKeepButton?: HTMLButtonElement;
	private fileChangesReviewButton?: HTMLButtonElement;
	private fileChangesCardOffsetRaf = 0;
	private fileChangesBarState: { isGit: boolean; hasHead: boolean; fileCount: number } = { isGit: false, hasHead: false, fileCount: 0 };
	/** Bumps on each refresh start so stale async completions do not overwrite the DOM. */
	private fileChangesSummaryGeneration = 0;
	/** Serialize commands on the hidden `changes-summary` PTY so concurrent refreshes never interleave markers/output. */
	private fileChangesSummaryShellChain: Promise<unknown> = Promise.resolve();
	private pythonEditorCounter = 0;
	/** Floating control over the message list; shown when the user has scrolled away from the bottom. */
	private scrollToBottomButtonElement?: HTMLButtonElement;
	private readonly sessions: ChatSession[] = [];
	private activeSessionIdx = 0;
	private tabBarElement?: HTMLElement;
	/** Left nav: organization roster from `org.json` (above chat tabs). */
	private organizationNavHost?: HTMLElement;
	private organizationNavRows?: HTMLElement;
	private organizationChatsLabel?: HTMLElement;
	/** Full-size overlay inside the session stack for org agent detail / user inbox shell. */
	private organizationDetailPane?: HTMLElement;
	private cachedOrgDocument: HimOrganizationDocument | undefined;
	private orgAgentsNavOrder: HimOrgAgent[] = [];
	private leftNavMode: 'chat' | 'org' = 'chat';
	private selectedOrgAgentId: string | undefined;
	private configBarElement?: HTMLElement;
	private configStatusDot?: HTMLElement;
	private queuedMessages: string[] = [];
	private queuedBarElement?: HTMLElement;
	private conversationSummary = '';
	private isCompressing = false;
	private memoryMeterContainer?: HTMLElement;
	private memoryMeterFill?: HTMLElement;
	private memoryMeterHint?: HTMLElement;
	private memoryMeterRefreshScheduled = false;
	private static readonly _memoryTextEncoder = new TextEncoder();
	private backgroundCts = new Map<string, CancellationTokenSource>();
	private readonly shellTerminalBySessionId = new Map<string, ITerminalInstance>();
	/** Serialize web search execution per session to avoid request storms. */
	private readonly searchExecChainBySessionId = new Map<string, Promise<void>>();
	/** Simple per-session circuit breaker for repeated search failures. */
	private readonly searchCircuitBySessionId = new Map<string, { failures: number; windowStartMs: number; openUntilMs: number }>();
	/** Non-git fallback snapshot: path -> first lines content (diff display). */
	private readonly workspaceSnapshotBySessionId = new Map<string, Map<string, string>>();
	/** Non-git file list: path -> mtime+size fingerprint (full-file edits detected; unlike 2k content preview). */
	private readonly workspaceFileFingerprintBySessionId = new Map<string, Map<string, string>>();
	/** Live agent status per chat tab (not persisted). */
	private readonly sessionAgentUiBySessionId = new Map<string, { state: HimRenderState | 'IDLE'; hint?: string }>();
	private tabBarRefreshScheduled = false;
	private inputLockBannerElement?: HTMLElement;
	private leftNavWidth = 220;
	private readonly leftNavMinWidth = 160;
	private readonly leftNavMaxWidth = 420;
	/** Per-session auto-scroll toggle (disabled when user scrolls up). */
	private readonly autoScrollBySessionId = new Map<string, boolean>();
	private readonly autoScrollThresholdPx = 64;
	/** In-flight assistant bubble per session; used to re-attach DOM if the row was detached while streaming. */
	private streamingPendingBubbleBySessionId = new Map<string, HTMLElement>();
	/** When switching back to a tab that is still streaming, repaint from latest ctx (DOM can get out of sync). */
	private streamingUiFlushBySessionId = new Map<string, () => void>();
	private lastCancelledContext?: {
		conversationMessages: ProviderMessage[];
		cfg: ResolvedChatConfig;
		pendingBubble: HTMLElement | undefined;
		streamedThinking: string;
		requestStartedAt: number;
		agentLoopCount: number;
	};
	private continueBarElement?: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService override readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IAccessibleViewInformationService accessibleViewInformationService: IAccessibleViewInformationService,
		@IRequestService private readonly requestService: IRequestService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@ICommandService private readonly commandService: ICommandService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@IHimPythonReplService private readonly himPythonReplService: IHimPythonReplService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService, accessibleViewInformationService);
		this.workspaceSessionStore = this._register(new HimChatWorkspaceSessionStore(storageService));
		this._register(this.fileService.onDidRunOperation(e => {
			if (!this.workspaceContextService.getWorkspaceFolder(e.resource)) {
				return;
			}
			const fsPath = e.resource.fsPath.replace(/\\/g, '/');
			if (fsPath.includes('/node_modules/') || fsPath.includes('/.git/')) {
				return;
			}
			if (
				e.isOperation(FileOperation.WRITE) ||
				e.isOperation(FileOperation.CREATE) ||
				e.isOperation(FileOperation.DELETE) ||
				e.isOperation(FileOperation.MOVE) ||
				e.isOperation(FileOperation.COPY)
			) {
				this.scheduleRefreshWorkspaceFileChangesSummary();
			}
		}));
		this._register(this.fileService.onDidFilesChange(e => {
			const orgUri = getOrganizationFileUri(getHimCodeHostDataRoot(this.environmentService, this.workspaceContextService.getWorkspace()));
			if (e.contains(orgUri, FileChangeType.ADDED, FileChangeType.UPDATED, FileChangeType.DELETED)) {
				void this.refreshOrganizationNavFromWorkspace();
			}
		}));
	}

	private getHimHostDataRoot() {
		return getHimCodeHostDataRoot(this.environmentService, this.workspaceContextService.getWorkspace());
	}

	private stripStructuredBlocksForDisplay(text: string): string {
		return stripSemanticProgramBlockForDisplay(stripHimPlanBlockForDisplay(stripHimOrgBlockForDisplay(text)));
	}

	private activeMessages(): ViewMessage[] {
		return this.sessions[this.activeSessionIdx]?.messages ?? [];
	}

	private persistWorkspaceSessions(): void {
		this.workspaceSessionStore.scheduleSave({
			version: 1,
			activeSessionIdx: this.activeSessionIdx,
			sessions: this.sessions.map(s => ({
				id: s.id,
				title: s.title,
				role: s.role ?? '',
				rule: s.rule ?? '',
				messages: s.messages.map(m => ({ ...m })),
				scrollTop: s.scrollTop,
				queuedMessages: s.queuedMessages.slice(),
				conversationSummary: s.conversationSummary,
				pythonNotify: s.pythonNotify,
				linkedOrgAgentId: s.linkedOrgAgentId,
			})),
		});
		this.scheduleMemoryMeterUpdate();
	}

	private scheduleMemoryMeterUpdate(): void {
		if (this.memoryMeterRefreshScheduled) {
			return;
		}
		this.memoryMeterRefreshScheduled = true;
		requestAnimationFrame(() => {
			this.memoryMeterRefreshScheduled = false;
			this.updateMemoryMeter();
		});
	}

	/** Rough UTF-8 size of what we keep as long-lived context (core prompt + agent fields + summary + messages). */
	private estimateActiveSessionContextBytes(): number {
		const session = this.sessions[this.activeSessionIdx];
		if (!session) {
			return 0;
		}
		const enc = HimAiChatPane._memoryTextEncoder;
		let n = enc.encode(HIM_CORE_SYSTEM_PROMPT).length;
		const agentMeta = `${session.role ?? ''}\n${session.rule ?? ''}`;
		n += enc.encode(agentMeta).length;
		n += enc.encode(session.conversationSummary ?? '').length;
		for (const m of session.messages) {
			n += enc.encode(m.content).length;
			if (m.images?.length) {
				for (const im of m.images) {
					n += im.dataBase64.length + (im.name?.length ?? 0);
				}
			}
			if (m.thinking) {
				n += enc.encode(m.thinking).length;
			}
			if (m.attachments?.length) {
				for (const a of m.attachments) {
					n += enc.encode(`${a.type}:${a.name}:${a.range ?? ''}:${a.size ?? ''}`).length;
				}
			}
		}
		return n;
	}

	private formatHimMemoryBytes(bytes: number): string {
		const gb = 1024 ** 3;
		const mb = 1024 ** 2;
		const kb = 1024;
		if (bytes >= gb) {
			return `${(bytes / gb).toFixed(2)} GB`;
		}
		if (bytes >= mb) {
			return `${(bytes / mb).toFixed(1)} MB`;
		}
		if (bytes >= kb) {
			return `${(bytes / kb).toFixed(1)} KB`;
		}
		return `${Math.max(0, Math.round(bytes))} B`;
	}

	private updateMemoryMeter(): void {
		if (!this.memoryMeterFill || !this.memoryMeterHint) {
			return;
		}
		const used = this.estimateActiveSessionContextBytes();
		const cap = AI_MEMORY_BUDGET_BYTES;
		const pct = Math.min(100, (used / cap) * 100);
		this.memoryMeterHint.textContent = `${this.formatHimMemoryBytes(used)} / ${this.formatHimMemoryBytes(cap)}`;

		if (this.isCompressing) {
			this.memoryMeterFill.style.width = '100%';
			this.memoryMeterFill.classList.remove('him-memory-meter-fill-warn');
			this.memoryMeterFill.classList.add('him-memory-meter-fill-busy');
			return;
		}
		this.memoryMeterFill.classList.remove('him-memory-meter-fill-busy');
		this.memoryMeterFill.style.width = `${pct}%`;
		const over = used > cap;
		this.memoryMeterFill.classList.toggle('him-memory-meter-fill-warn', over);
	}

	private hydrateFromStorageIfAny(): void {
		const data = this.workspaceSessionStore.load();
		if (!data?.sessions?.length) {
			return;
		}
		this.sessions.length = 0;
		for (const s of data.sessions) {
			this.sessions.push({
				id: s.id,
				title: s.title,
				role: s.role ?? '',
				rule: s.rule ?? '',
				messages: (s.messages ?? []) as ViewMessage[],
				scrollTop: s.scrollTop ?? 0,
				queuedMessages: s.queuedMessages ?? [],
				conversationSummary: s.conversationSummary ?? '',
				pythonNotify: !!s.pythonNotify,
				linkedOrgAgentId: s.linkedOrgAgentId,
			});
		}
		this.activeSessionIdx = Math.min(Math.max(0, data.activeSessionIdx), this.sessions.length - 1);
	}

	private ensureSessionPane(sessionId: string): { root: HTMLElement; messageList: HTMLElement } {
		let w = this.sessionPaneById.get(sessionId);
		if (w) {
			return w;
		}
		const host = this.sessionStackHost;
		if (!host) {
			throw new Error('HIM session stack not initialized');
		}
		const root = append(host, $('div.him-session-pane'));
		root.dataset.sessionId = sessionId;
		// Stacked like front-end tabs: every pane stays painted (display:flex + full opacity); only z-index
		// and an opaque background put the active chat “in front”. No visibility:hidden / display:none.
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.position = 'absolute';
		root.style.left = '0';
		root.style.right = '0';
		root.style.top = '0';
		root.style.bottom = '0';
		root.style.overflow = 'hidden';
		root.style.minHeight = '0';
		root.style.visibility = 'visible';
		root.style.opacity = '1';
		root.style.pointerEvents = 'none';
		root.style.zIndex = '1';
		root.style.backgroundColor = 'var(--vscode-editor-background)';

		const messageList = append(root, $('.him-chat-messages'));
		messageList.style.flex = '1';
		messageList.style.overflowY = 'auto';
		messageList.style.padding = '16px';
		messageList.style.display = 'flex';
		messageList.style.flexDirection = 'column';
		messageList.style.gap = '12px';
		messageList.style.backgroundColor = 'var(--vscode-editor-background)';
		const sid = sessionId;
		this.autoScrollBySessionId.set(sid, true);
		messageList.addEventListener('scroll', () => {
			// When user scrolls up, disable auto-scroll until they return to bottom.
			const atBottom = (messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight) <= this.autoScrollThresholdPx;
			this.autoScrollBySessionId.set(sid, atBottom);
			if (this.sessions[this.activeSessionIdx]?.id === sid) {
				this.updateScrollToBottomButtonVisibility();
			}
		});

		w = { root, messageList };
		this.sessionPaneById.set(sessionId, w);
		return w;
	}

	private showSessionPane(sessionId: string): void {
		if (this.organizationDetailPane) {
			this.organizationDetailPane.style.display = 'none';
			this.organizationDetailPane.style.pointerEvents = 'none';
		}
		/** Active layer on top; others stay underneath with same opaque bg (visually “covered”, still laid out). */
		const FRONT = '10';
		const BACK = '1';
		for (const [id, w] of this.sessionPaneById) {
			const active = id === sessionId;
			w.root.style.display = 'flex';
			w.root.style.flexDirection = 'column';
			w.root.style.position = 'absolute';
			w.root.style.left = '0';
			w.root.style.right = '0';
			w.root.style.top = '0';
			w.root.style.bottom = '0';
			w.root.style.overflow = 'hidden';
			w.root.style.minHeight = '0';
			w.root.style.visibility = 'visible';
			w.root.style.opacity = '1';
			w.root.style.backgroundColor = 'var(--vscode-editor-background)';
			w.root.style.pointerEvents = active ? 'auto' : 'none';
			w.root.style.zIndex = active ? FRONT : BACK;
		}
		this.messageListElement = this.sessionPaneById.get(sessionId)?.messageList;
		this.runStreamingUiFlushForSession(sessionId);
		queueMicrotask(() => this.updateScrollToBottomButtonVisibility());
	}

	private sortAgentsForOrgNav(agents: readonly HimOrgAgent[]): HimOrgAgent[] {
		const copy = agents.filter(a => a.kind === 'orchestrator');
		copy.sort((a, b) => {
			const ra = a.id === HIM_ORG_ORCHESTRATOR_AGENT_ID ? 0 : 1;
			const rb = b.id === HIM_ORG_ORCHESTRATOR_AGENT_ID ? 0 : 1;
			const d = ra - rb;
			return d !== 0 ? d : a.display_name.localeCompare(b.display_name);
		});
		return copy;
	}

	private async refreshOrganizationNavFromWorkspace(): Promise<void> {
		if (!this.organizationNavRows || !this.organizationNavHost) {
			return;
		}
		try {
			const hostRoot = this.getHimHostDataRoot();
			await ensureWorkspaceOrganizationBootstrap(this.fileService, hostRoot);
			const uri = getOrganizationFileUri(hostRoot);
			const doc = await readOrganizationDocument(this.fileService, uri);
			this.cachedOrgDocument = doc;
			this.orgAgentsNavOrder = doc ? this.sortAgentsForOrgNav(doc.agents) : [];
		} catch {
			this.cachedOrgDocument = undefined;
			this.orgAgentsNavOrder = [];
		}
		const hasOrg = this.orgAgentsNavOrder.length > 0;
		this.organizationNavHost.style.display = hasOrg ? 'flex' : 'none';
		if (this.organizationChatsLabel) {
			this.organizationChatsLabel.style.display = hasOrg ? 'block' : 'none';
		}
		if (this.leftNavMode === 'org' && this.selectedOrgAgentId && !this.orgAgentsNavOrder.some(a => a.id === this.selectedOrgAgentId)) {
			this.leftNavMode = 'chat';
			this.selectedOrgAgentId = undefined;
			const s = this.sessions[this.activeSessionIdx];
			if (s) {
				this.showSessionPane(s.id);
				this.loadSession(s);
			}
		}
		this.renderOrganizationNavRows();
		this.renderTabBar();
		if (this.leftNavMode === 'org' && this.selectedOrgAgentId) {
			const ag = this.orgAgentsNavOrder.find(a => a.id === this.selectedOrgAgentId);
			if (ag) {
				this.renderOrganizationDetail(ag);
				if (this.organizationDetailPane) {
					this.organizationDetailPane.style.display = 'flex';
					this.organizationDetailPane.style.pointerEvents = 'auto';
				}
				for (const [, w] of this.sessionPaneById) {
					w.root.style.pointerEvents = 'none';
					w.root.style.zIndex = '1';
				}
			}
		}
		for (const session of this.sessions) {
			if (!session.linkedOrgAgentId) {
				continue;
			}
			const ag = this.orgAgentsNavOrder.find(a => a.id === session.linkedOrgAgentId);
			if (ag) {
				session.title = ag.display_name;
				this.applyOrgAgentToSessionMeta(session, ag, this.cachedOrgDocument);
			}
		}
		this.updateComposerForOrgNavMode();
	}

	private renderOrganizationNavRows(): void {
		if (!this.organizationNavRows) {
			return;
		}
		clearNode(this.organizationNavRows);
		for (const ag of this.orgAgentsNavOrder) {
			const row = append(this.organizationNavRows, $('div.him-org-nav-row'));
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.justifyContent = 'space-between';
			row.style.gap = '6px';
			row.style.padding = '5px 10px';
			row.style.borderRadius = '6px';
			row.style.cursor = 'pointer';
			row.style.fontSize = '11px';
			const linkedSid = this.sessions[this.activeSessionIdx]?.linkedOrgAgentId;
			const active =
				(this.leftNavMode === 'org' && this.selectedOrgAgentId === ag.id) ||
				(this.leftNavMode === 'chat' && linkedSid === ag.id);
			row.style.background = active
				? 'color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 85%, transparent)'
				: 'transparent';
			row.style.color = active ? 'var(--vscode-list-activeSelectionForeground)' : 'var(--vscode-foreground)';
			row.style.fontWeight = active ? '600' : '400';
			if (ag.kind === 'orchestrator') {
				row.style.borderLeft = '3px solid var(--vscode-symbolIcon-classForeground)';
			} else {
				row.style.borderLeft = '3px solid transparent';
			}
			const label = append(row, $('span'));
			label.textContent = ag.display_name.length > 22 ? ag.display_name.slice(0, 22) + '…' : ag.display_name;
			label.style.flex = '1';
			label.style.overflow = 'hidden';
			label.style.textOverflow = 'ellipsis';
			label.style.whiteSpace = 'nowrap';
			const badge = append(row, $('span'));
			badge.textContent = ag.kind === 'orchestrator' ? '◎' : '◇';
			badge.style.opacity = '0.75';
			badge.style.fontSize = '10px';
			const chatHint =
				ag.kind === 'orchestrator'
					? localize('himOrgRowOpenChatHint', ' — click to open chat')
					: '';
			row.title = `${ag.display_name} (${ag.id}) · ${ag.kind}${chatHint}`;
			row.addEventListener('click', () => {
				if (ag.kind === 'orchestrator') {
					this.openOrgAgentConversation(ag.id);
				} else {
					this.selectOrganizationAgent(ag.id);
				}
			});
		}
	}

	private selectOrganizationAgent(agentId: string): void {
		this.saveCurrentSession();
		this.leftNavMode = 'org';
		this.selectedOrgAgentId = agentId;
		const agent = this.orgAgentsNavOrder.find(a => a.id === agentId);
		if (!agent || !this.organizationDetailPane) {
			return;
		}
		this.renderOrganizationDetail(agent);
		for (const [, w] of this.sessionPaneById) {
			w.root.style.pointerEvents = 'none';
			w.root.style.zIndex = '1';
		}
		this.organizationDetailPane.style.display = 'flex';
		this.organizationDetailPane.style.pointerEvents = 'auto';
		this.messageListElement = undefined;
		this.renderTabBar();
		this.renderOrganizationNavRows();
		this.updateComposerForOrgNavMode();
		queueMicrotask(() => this.updateScrollToBottomButtonVisibility());
	}

	private renderOrganizationDetail(agent: HimOrgAgent): void {
		if (!this.organizationDetailPane) {
			return;
		}
		clearNode(this.organizationDetailPane);
		const scroll = append(this.organizationDetailPane, $('div'));
		scroll.style.flex = '1';
		scroll.style.overflowY = 'auto';
		scroll.style.minHeight = '0';
		scroll.style.padding = '20px 20px 28px 20px';
		scroll.style.display = 'flex';
		scroll.style.flexDirection = 'column';
		scroll.style.gap = '12px';

		const h = append(scroll, $('h2'));
		h.textContent = agent.display_name;
		h.style.fontSize = '18px';
		h.style.fontWeight = '700';
		h.style.margin = '0';

		const sub = append(scroll, $('div'));
		sub.style.fontSize = '12px';
		sub.style.color = 'var(--vscode-descriptionForeground)';
		sub.textContent = `${localize('himOrgDetailKind', 'Kind')}: ${agent.kind} · id: ${agent.id}`;

		const doc = this.cachedOrgDocument;
		if (doc?.plan_status || doc?.consensus_note) {
			const box = append(scroll, $('div'));
			box.style.border = '1px solid var(--vscode-widget-border)';
			box.style.borderRadius = '8px';
			box.style.padding = '10px 12px';
			box.style.fontSize = '12px';
			box.style.background = 'color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-symbolIcon-classForeground))';
			const statusLine = append(box, $('div'));
			statusLine.style.fontWeight = '600';
			statusLine.style.marginBottom = '6px';
			statusLine.textContent = localize(
				'himOrgPlanStatusLine',
				'Organization plan: {0}',
				doc.plan_status ?? 'draft',
			);
			if (doc.consensus_note) {
				const note = append(box, $('div'));
				note.style.opacity = '0.92';
				note.style.lineHeight = '1.45';
				note.textContent = doc.consensus_note;
			}
			if (doc.ratified_at) {
				const r = append(box, $('div'));
				r.style.marginTop = '6px';
				r.style.fontSize = '11px';
				r.textContent = localize('himOrgRatifiedAt', 'Ratified at: {0}', doc.ratified_at);
			}
		}

		const mlab = append(scroll, $('div'));
		mlab.style.fontSize = '11px';
		mlab.style.fontWeight = '600';
		mlab.style.color = 'var(--vscode-descriptionForeground)';
		mlab.textContent = localize('himOrgMandate', 'Mandate');

		const mp = append(scroll, $('div'));
		mp.style.fontSize = '13px';
		mp.style.lineHeight = '1.5';
		mp.style.whiteSpace = 'pre-wrap';
		mp.textContent = agent.mandate;

		const wlab = append(scroll, $('div'));
		wlab.style.fontSize = '11px';
		wlab.style.fontWeight = '600';
		wlab.style.color = 'var(--vscode-descriptionForeground)';
		wlab.textContent = localize('himOrgWorld', 'World (scope)');

		const pre = append(scroll, $('pre'));
		pre.style.margin = '0';
		pre.style.padding = '10px';
		pre.style.borderRadius = '8px';
		pre.style.fontSize = '11px';
		pre.style.overflow = 'auto';
		pre.style.background = 'var(--vscode-textCodeBlock-background)';
		pre.textContent = JSON.stringify(agent.world, null, 2);

		if (agent.kind === 'user') {
			const inbox = append(scroll, $('div'));
			inbox.style.borderTop = '1px solid var(--vscode-widget-border)';
			inbox.style.paddingTop = '14px';
			inbox.style.fontSize = '12px';
			inbox.style.lineHeight = '1.5';
			inbox.style.color = 'var(--vscode-descriptionForeground)';
			inbox.textContent = localize(
				'himOrgUserInboxHint',
				'Agent questions and requests to you will appear here; mirrored worker threads will sync in a later update.',
			);
		}

		const btnRow = append(scroll, $('div'));
		btnRow.style.display = 'flex';
		btnRow.style.gap = '8px';
		btnRow.style.flexWrap = 'wrap';
		const openJson = append(btnRow, $('button')) as HTMLButtonElement;
		openJson.className = 'secondary';
		openJson.textContent = localize('himOrgOpenOrgJson', 'Open org.json');
		openJson.addEventListener('click', () => void this.commandService.executeCommand('himAiChat.openOrganizationFile'));
	}

	private isOrchestratorLinkedSession(sessionId: string): boolean {
		const s = this.sessions.find(x => x.id === sessionId);
		return s?.linkedOrgAgentId === HIM_ORG_ORCHESTRATOR_AGENT_ID;
	}

	private updateComposerForOrgNavMode(): void {
		const org = this.leftNavMode === 'org';
		if (this.inputElement) {
			this.inputElement.disabled = org;
		}
		const blockChrome = org || this.isSending;
		if (this.providerSelectElement) {
			this.providerSelectElement.disabled = blockChrome;
		}
		if (this.addButtonElement) {
			this.addButtonElement.disabled = blockChrome;
		}
		if (this.micButtonElement) {
			this.micButtonElement.disabled = blockChrome;
		}
		if (this.imagePickButtonElement) {
			this.imagePickButtonElement.disabled = blockChrome;
		}
		this.updateInputLockBanner();
	}

	private buildOrgLinkedWelcomeMessage(agent: HimOrgAgent, doc: HimOrganizationDocument | undefined): string {
		if (agent.kind === 'orchestrator') {
			return [
				localize('himOrgOrchestratorWelcomeTitle', '### Orchestrator thread'),
				'',
				localize(
					'himOrgOrchestratorWelcomeBody',
					'You are in the **dedicated chat** for the Orchestrator. Talk here to steer organization design; the model should propose updates to `org.json` (and `plan_status`: draft → pending_consensus → ratified) rather than doing worker execution itself.',
				),
				'',
				localize(
					'himOrgOrchestratorWelcomeVisibility',
					'**Where to see “organization discussion”?** Worker agents talk in their own **Chats** tabs. Cross-agent reasoning is not yet merged into one feed — you follow it by switching worker tabs (and later: User inbox + shared event log). This Orchestrator tab is mainly **you ↔ orchestrator**.',
				),
				'',
				localize('himOrgMandateFromFile', '**Mandate (from org.json)**'),
				'',
				agent.mandate,
				doc?.consensus_note ? `\n\n**consensus_note:**\n${doc.consensus_note}` : '',
				'',
				localize(
					'himOrgPlanStatusHint',
					'**plan_status:** `{0}`',
					doc?.plan_status ?? 'draft',
				),
			].join('\n');
		}
		if (agent.kind === 'worker') {
			return [
				localize('himOrgWorkerWelcomeTitle', '### Worker thread'),
				'',
				localize(
					'himOrgWorkerWelcomeBody',
					'You are in a **dedicated chat** for this org worker. Follow your mandate and world scope; respect `plan_status` until the organization is ratified.',
				),
				'',
				localize('himOrgMandateFromFile', '**Mandate (from org.json)**'),
				'',
				agent.mandate,
				'',
				localize(
					'himOrgPlanStatusHint',
					'**plan_status:** `{0}`',
					doc?.plan_status ?? 'draft',
				),
			].join('\n');
		}
		return [
			localize('himOrgUserWelcomeTitle', '### User (operator) thread'),
			'',
			localize(
				'himOrgUserWelcomeBody',
				'Use this chat to answer questions directed at you. Agent requests mirrored from worker sessions will land here in a future update.',
			),
			'',
			localize('himOrgMandateFromFile', '**Mandate (from org.json)**'),
			'',
			agent.mandate,
		].join('\n');
	}

	private applyOrgAgentToSessionMeta(
		session: ChatSession,
		agent: HimOrgAgent,
		doc: HimOrganizationDocument | undefined,
	): void {
		if (agent.kind === 'orchestrator') {
			session.role = localize('himOrgOrchestratorSessionRole', 'Orchestrator — organization planning (see org.json)');
			session.rule = [
				agent.mandate,
				'',
				doc?.consensus_note ?? '',
				'',
				localize(
					'himOrgOrchestratorSessionRuleFooter',
					'Host: `plan_status` is `{0}` until every agent acknowledges and the plan is ratified.',
					doc?.plan_status ?? 'draft',
				),
			]
				.join('\n')
				.trim();
		} else if (agent.kind === 'user') {
			session.role = localize('himOrgUserSessionRole', 'User (operator)');
			session.rule = [
				agent.mandate,
				'',
				localize(
					'himOrgUserSessionRuleFooter',
					'Respond to questions addressed to the human operator. Mirrored agent threads: upcoming.',
				),
			].join('\n');
		} else {
			session.role = agent.display_name;
			session.rule = agent.mandate;
		}
	}

	/** Opens or focuses the chat tab bound to the orchestrator agent. */
	private openOrgAgentConversation(agentId: string): void {
		let agent =
			this.orgAgentsNavOrder.find(a => a.id === agentId) ?? this.cachedOrgDocument?.agents.find(a => a.id === agentId);
		if (!agent && this.workspaceContextService.getWorkspace().folders[0]) {
			void this.refreshOrganizationNavFromWorkspace().then(() => {
				const ag2 =
					this.orgAgentsNavOrder.find(a => a.id === agentId) ??
					this.cachedOrgDocument?.agents.find(a => a.id === agentId);
				if (ag2 && ag2.kind === 'orchestrator') {
					this.openOrgAgentConversation(agentId);
				}
			});
			return;
		}
		if (!agent || agent.kind !== 'orchestrator') {
			return;
		}

		this.saveCurrentSession();
		this.leftNavMode = 'chat';
		this.selectedOrgAgentId = undefined;
		if (this.organizationDetailPane) {
			this.organizationDetailPane.style.display = 'none';
			this.organizationDetailPane.style.pointerEvents = 'none';
		}

		let idx = this.sessions.findIndex(s => s.linkedOrgAgentId === agentId);
		if (idx < 0) {
			const doc = this.cachedOrgDocument;
			const welcome = this.buildOrgLinkedWelcomeMessage(agent, doc);
			const newSession: ChatSession = {
				id: generateUuid(),
				title: agent.display_name,
				role: '',
				rule: '',
				messages: [{ role: 'assistant', content: welcome }],
				scrollTop: 0,
				queuedMessages: [],
				conversationSummary: '',
				linkedOrgAgentId: agentId,
			};
			this.applyOrgAgentToSessionMeta(newSession, agent, doc);
			this.sessions.push(newSession);
			this.ensureSessionPane(newSession.id);
			idx = this.sessions.length - 1;
		} else {
			const session = this.sessions[idx]!;
			this.applyOrgAgentToSessionMeta(session, agent, this.cachedOrgDocument);
			session.title = agent.display_name;
		}

		if (this.isSending && this.requestCts) {
			const sessionId = this.sessions[this.activeSessionIdx]?.id;
			if (sessionId) {
				this.backgroundCts.set(sessionId, this.requestCts);
			}
			this.requestCts = undefined;
			this.isSending = false;
		}
		this.activeSessionIdx = idx;
		this.loadSession(this.sessions[idx]!);
		const newSessionId = this.sessions[idx]?.id;
		const hasBgRequest = newSessionId ? this.backgroundCts.has(newSessionId) : false;
		this.setSendingState(hasBgRequest);
		this.renderTabBar();
		this.renderOrganizationNavRows();
		this.updateComposerForOrgNavMode();
		this.persistWorkspaceSessions();
	}

	/** Creates a chat tab for a worker if none exists yet (e.g. after org auto-apply). */
	private ensureWorkerOrgLinkedSession(agentId: string): void {
		if (this.sessions.some(s => s.linkedOrgAgentId === agentId)) {
			return;
		}
		const agent =
			this.orgAgentsNavOrder.find(a => a.id === agentId) ?? this.cachedOrgDocument?.agents.find(a => a.id === agentId);
		if (!agent || agent.kind !== 'worker') {
			return;
		}
		const doc = this.cachedOrgDocument;
		const welcome = this.buildOrgLinkedWelcomeMessage(agent, doc);
		const newSession: ChatSession = {
			id: generateUuid(),
			title: agent.display_name,
			role: '',
			rule: '',
			messages: [{ role: 'assistant', content: welcome }],
			scrollTop: 0,
			queuedMessages: [],
			conversationSummary: '',
			linkedOrgAgentId: agentId,
		};
		this.applyOrgAgentToSessionMeta(newSession, agent, doc);
		this.sessions.push(newSession);
		this.ensureSessionPane(newSession.id);
	}

	private async tryApplyOrganizationFromOrchestratorAssistant(rawContent: string, sessionId: string | undefined): Promise<void> {
		if (!sessionId) {
			return;
		}
		const session = this.sessions.find(s => s.id === sessionId);
		if (session?.linkedOrgAgentId !== HIM_ORG_ORCHESTRATOR_AGENT_ID) {
			return;
		}
		const inner = extractHimOrgBlock(rawContent);
		if (!inner) {
			return;
		}
		const doc = parseHimOrganizationJson(inner);
		if (!doc) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'himOrgApplyInvalid',
					'Orchestrator reply contained `<him-org>` but the JSON did not validate. org.json was not changed.',
				),
			});
			return;
		}
		const uri = getOrganizationFileUri(this.getHimHostDataRoot());
		const beforeWorkers = new Set(
			(this.cachedOrgDocument?.agents ?? []).filter(a => a.kind === 'worker').map(a => a.id),
		);
		try {
			await writeOrganizationDocument(this.fileService, uri, doc);
		} catch {
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('himOrgApplyWriteFailed', 'Could not write organization file (org.json).'),
			});
			return;
		}
		await this.refreshOrganizationNavFromWorkspace();
		const newWorkers = (this.cachedOrgDocument?.agents ?? []).filter(
			a => a.kind === 'worker' && !beforeWorkers.has(a.id),
		);
		for (const w of newWorkers) {
			this.ensureWorkerOrgLinkedSession(w.id);
		}
		this.persistWorkspaceSessions();
		this.renderTabBar();
		this.renderOrganizationNavRows();
		const msg =
			newWorkers.length > 0
				? localize(
					'himOrgAppliedWithWorkers',
					'Organization updated. Opened {0} new worker chat tab(s).',
					String(newWorkers.length),
				)
				: localize('himOrgApplied', 'Organization document updated.');
		this.notificationService.notify({ severity: Severity.Info, message: msg });

		// Auto-dispatch new workers: send their mandate as an initial prompt so they start working immediately
		if (newWorkers.length > 0) {
			// Find original user request from the orchestrator session for context
			const orchSession = this.sessions.find(s => s.id === sessionId);
			const originalUserMsg = orchSession?.messages.find(m => m.role === 'user')?.content ?? '';
			for (const w of newWorkers) {
				const workerSession = this.sessions.find(s => s.linkedOrgAgentId === w.id);
				if (!workerSession) {
					continue;
				}
				const autoPrompt = originalUserMsg
					? localize(
						'himOrgWorkerAutoDispatch',
						'The user requested:\n\n{0}\n\nYour mandate is: {1}\n\nPlease begin working on your assigned task now.',
						originalUserMsg,
						w.mandate,
					)
					: localize(
						'himOrgWorkerAutoDispatchNoCtx',
						'Your mandate is: {0}\n\nPlease begin working on your assigned task now.',
						w.mandate,
					);
				// Queue auto-prompt for the worker session
				workerSession.messages.push({ role: 'user', content: autoPrompt });
				this.autoDispatchWorkerSession(workerSession.id, autoPrompt);
			}
		}
	}

	/**
	 * Auto-dispatch a prompt in a worker session (background execution).
	 * Uses background CTS so the user can continue working in other tabs.
	 */
	private async autoDispatchWorkerSession(workerSessionId: string, _prompt: string): Promise<void> {
		const sessionIdx = this.sessions.findIndex(s => s.id === workerSessionId);
		if (sessionIdx < 0) {
			return;
		}
		const session = this.sessions[sessionIdx]!;
		const w = this.ensureSessionPane(session.id);

		// Render the user message in the worker session pane
		const prevMessageList = this.messageListElement;
		this.messageListElement = w.messageList;
		this.appendMessage({ role: 'user', content: _prompt });

		const pendingBubble = this.appendMessage({ role: 'assistant', content: 'Thinking...' });
		this.messageListElement = prevMessageList;

		const localCts = new CancellationTokenSource();
		this.backgroundCts.set(workerSessionId, localCts);
		const requestToken = localCts.token;

		this.applySessionAgentDisplay(workerSessionId, 'READING');
		this.renderTabBar();

		const ctx = createAgentRunContext(workerSessionId);
		const streamedThinking = { value: '' };
		const requestStartedAt = Date.now();

		if (pendingBubble) {
			this.streamingPendingBubbleBySessionId.set(workerSessionId, pendingBubble);
			this.streamingUiFlushBySessionId.set(workerSessionId, () => {
				if (requestToken.isCancellationRequested) {
					return;
				}
				this.ensureStreamingRowsInSessionMessageList(workerSessionId, pendingBubble);
				this.renderStreamingNow(ctx, pendingBubble, streamedThinking.value, requestStartedAt);
			});
		}

		try {
			const cfg = await this.resolveChatConfig();
			const extraParts: string[] = [];
			if (session.role?.trim()) {
				extraParts.push(`## Agent Role\n${session.role.trim()}`);
			}
			if (session.rule?.trim()) {
				extraParts.push(`## Agent Rule\n${session.rule.trim()}`);
			}
			const systemPrompt = extraParts.length > 0 ? `${cfg.systemPrompt}\n\n${extraParts.join('\n\n')}` : cfg.systemPrompt;

			const conversationMessages = session.messages
				.filter(m => m.role === 'user' || m.role === 'assistant')
				.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

			// Prepend system prompt as the first message (user role) for provider compatibility
			const providerMessages: ProviderMessage[] = [
				{ role: 'user', content: systemPrompt },
				{ role: 'assistant', content: 'Understood.' },
				...conversationMessages,
			];

			const isSessionActive = () => this.sessions[this.activeSessionIdx]?.id === workerSessionId;

			const result = await this.runAgentRequestAndToolLoop(
				ctx,
				cfg,
				providerMessages,
				requestToken,
				pendingBubble!,
				streamedThinking,
				requestStartedAt,
				isSessionActive,
				{ enableToolObservationLoop: true },
			);

			const content = ctx.streamVisibleContent.trim() || (result.roundContent || result.answer.text).trim() || '(Empty response)';
			const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
			const mergedThinkingRaw = (streamedThinking.value || result.answer.thinking || '').trim();
			const finalMsg: ViewMessage = {
				role: 'assistant',
				content,
				thinking: mergedThinkingRaw || undefined,
				thinkingDurationMs: elapsedMs,
				pythonExecutions: ctx.pendingPythonExecs.length > 0 ? [...ctx.pendingPythonExecs] : undefined,
				shellExecutions: ctx.pendingShellExecs.length > 0 ? [...ctx.pendingShellExecs] : undefined,
				searchExecutions: ctx.pendingSearchExecs.length > 0 ? [...ctx.pendingSearchExecs] : undefined,
			};
			session.messages.push(finalMsg);

			if (pendingBubble) {
				const prevMl = this.messageListElement;
				this.messageListElement = w.messageList;
				this.renderMessageInBubble(pendingBubble, finalMsg);
				this.messageListElement = prevMl;
			}
		} catch (e) {
			const errMsg = e instanceof Error ? e.message : String(e);
			const errorMsg: ViewMessage = { role: 'assistant', content: `⚠️ Error: ${errMsg}` };
			session.messages.push(errorMsg);
			if (pendingBubble) {
				const prevMl = this.messageListElement;
				this.messageListElement = w.messageList;
				this.renderMessageInBubble(pendingBubble, errorMsg);
				this.messageListElement = prevMl;
			}
		} finally {
			this.backgroundCts.delete(workerSessionId);
			localCts.dispose();
			this.streamingPendingBubbleBySessionId.delete(workerSessionId);
			this.streamingUiFlushBySessionId.delete(workerSessionId);
			this.applySessionAgentDisplay(workerSessionId, 'IDLE');
			this.renderTabBar();
			this.persistWorkspaceSessions();
		}
	}

	/** Re-apply streaming bubble from live ctx after tab switch / visibility (fixes blank-until-done). */
	private runStreamingUiFlushForSession(sessionId: string): void {
		const flush = this.streamingUiFlushBySessionId.get(sessionId);
		if (!flush) {
			return;
		}
		const run = () => {
			try {
				flush();
			} catch {
				// best-effort repaint
			}
		};
		run();
		queueMicrotask(run);
		requestAnimationFrame(() => {
			run();
			requestAnimationFrame(run);
		});
	}

	private rebuildAllSessionPanesFromModel(): void {
		for (const session of this.sessions) {
			const w = this.ensureSessionPane(session.id);
			clearNode(w.messageList);
			this.messageListElement = w.messageList;
			if (session.messages.length === 0) {
				this.renderWelcomeMessage(session);
			} else {
				for (const msg of session.messages) {
					this.appendMessage(msg);
				}
			}
			w.messageList.scrollTop = session.scrollTop;
		}
		const active = this.sessions[this.activeSessionIdx];
		this.messageListElement = active ? this.sessionPaneById.get(active.id)?.messageList : undefined;
	}

	protected override renderHeaderTitle(container: HTMLElement, title: string): void {
		super.renderHeaderTitle(container, title);
	}

	private updateHeaderState(state: HimRenderState, agentLoopCount = 0): void {
		if (!this.configStatusDot) { return; }
		const colorMap: Record<string, string> = {
			IDLE: '#6b7280',
			READING: '#22c55e',
			CODING: '#3b82f6',
			LOCKED: '#f59e0b',
			RESUMING: '#a855f7',
			ERROR: '#ef4444',
			CANCELLED: '#6b7280',
		};
		const displayState = this.isSending ? state : 'IDLE';
		const c = colorMap[displayState] ?? '#6b7280';
		this.configStatusDot.style.color = c;
		const loopSuffix = agentLoopCount > 0 ? ` (${agentLoopCount})` : '';
		this.configStatusDot.textContent = `● ${displayState}${loopSuffix}`;
	}

	private applySessionAgentDisplay(sessionId: string, state: HimRenderState | 'IDLE', lockHint?: string): void {
		const hint = state === 'LOCKED' ? (lockHint?.trim() || 'A blocking step is running — streaming is paused until it completes.') : undefined;
		this.sessionAgentUiBySessionId.set(sessionId, { state, hint });
		this.scheduleTabBarRefreshForAgent();
		if (sessionId === this.sessions[this.activeSessionIdx]?.id) {
			this.updateInputLockBanner();
		}
	}

	private scheduleTabBarRefreshForAgent(): void {
		if (this.tabBarRefreshScheduled) {
			return;
		}
		this.tabBarRefreshScheduled = true;
		requestAnimationFrame(() => {
			this.tabBarRefreshScheduled = false;
			this.renderTabBar();
		});
	}

	private updateInputLockBanner(): void {
		if (!this.inputLockBannerElement) {
			return;
		}
		if (this.leftNavMode === 'org') {
			this.inputLockBannerElement.textContent = localize(
				'himOrgComposerLocked',
				'Organization view — select a Chat tab below to send prompts.',
			);
			this.inputLockBannerElement.style.display = 'block';
			this.inputLockBannerElement.style.color = 'var(--vscode-textLink-foreground)';
			this.inputLockBannerElement.style.background = 'color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent)';
			this.inputLockBannerElement.style.borderColor = 'color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent)';
			return;
		}
		this.inputLockBannerElement.style.color = 'var(--vscode-editorWarning-foreground)';
		this.inputLockBannerElement.style.background = 'color-mix(in srgb, var(--vscode-editorWarning-foreground) 10%, transparent)';
		this.inputLockBannerElement.style.borderColor = 'color-mix(in srgb, var(--vscode-editorWarning-foreground) 32%, transparent)';
		const sid = this.sessions[this.activeSessionIdx]?.id;
		const ui = sid ? this.sessionAgentUiBySessionId.get(sid) : undefined;
		if (ui?.state === 'LOCKED' && ui.hint) {
			this.inputLockBannerElement.textContent = ui.hint;
			this.inputLockBannerElement.style.display = 'block';
		} else {
			this.inputLockBannerElement.textContent = '';
			this.inputLockBannerElement.style.display = 'none';
		}
	}

	/** Vertical agent row: pale tinted background by runtime state; active tab blends selection color. */
	private agentTabBackgroundVertical(state: HimRenderState | 'IDLE', isActive: boolean): string {
		const side = 'var(--vscode-sideBar-background)';
		const stateTint: Record<string, string> = {
			IDLE: `color-mix(in srgb, var(--vscode-descriptionForeground) 6%, ${side})`,
			READING: `color-mix(in srgb, #22c55e 6%, ${side})`,
			CODING: `color-mix(in srgb, #3b82f6 6%, ${side})`,
			LOCKED: `color-mix(in srgb, #f59e0b 8%, ${side})`,
			RESUMING: `color-mix(in srgb, #a855f7 6%, ${side})`,
			ERROR: `color-mix(in srgb, #ef4444 6%, ${side})`,
			CANCELLED: `color-mix(in srgb, var(--vscode-descriptionForeground) 6%, ${side})`,
		};
		const base = stateTint[state] ?? stateTint.IDLE;
		if (isActive) {
			return `color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 40%, ${base})`;
		}
		return base;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.disposeAllRenderedMarkdown();
		clearNode(container);

		if (!this.neonStylesInjected) {
			this.neonStylesInjected = true;
			const neon = document.createElement('style');
			neon.textContent = `
@keyframes him-chat-neon-pulse {
  0%, 100% { box-shadow: inset 0 0 6px rgba(34, 211, 238, 0.55), 0 0 6px rgba(167, 139, 250, 0.45); }
  50% { box-shadow: inset 0 0 14px rgba(34, 211, 238, 0.9), 0 0 14px rgba(192, 132, 252, 0.75); }
}
.him-tab-neon {
  animation: him-chat-neon-pulse 1.5s ease-in-out infinite;
}
.him-tab-bar[data-orientation="vertical"] {
  gap: 5px;
  padding: 6px 6px 10px 8px;
  box-sizing: border-box;
  background: transparent !important;
}
.him-tab.him-tab--vertical {
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.him-tab.him-tab--vertical.him-tab--active {
  border-color: color-mix(in srgb, var(--vscode-focusBorder) 40%, var(--vscode-widget-border));
}
.him-tab.him-tab--vertical .him-agent-actions {
  gap: 1px;
  flex-shrink: 0;
  align-items: center;
}
/* Reserve layout: no display toggle on hover (avoids row jump). */
.him-tab.him-tab--vertical .him-agent-action-btn {
  display: inline-flex !important;
  width: 14px;
  height: 14px;
  min-width: 14px;
  min-height: 14px;
  padding: 0;
  border-radius: 3px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, background 0.12s ease, border-color 0.12s ease;
}
.him-tab.him-tab--vertical.him-tab--hover .him-agent-action-btn:not(:disabled) {
  opacity: 1;
  pointer-events: auto;
}
.him-tab.him-tab--vertical .him-agent-action-btn .codicon {
  font-size: 6px !important;
  line-height: 6px !important;
}
.him-agent-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  opacity: 0.9;
}
.him-agent-action-btn .codicon {
  font-size: 8px !important;
  line-height: 8px !important;
}
.him-chat-user-copy .codicon {
  font-size: 8px !important;
  line-height: 8px !important;
}
.him-chat-icon-close-sm.codicon {
  font-size: 6px !important;
  line-height: 6px !important;
}
.him-agent-action-btn:hover {
  background: color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent);
  border-color: var(--vscode-widget-border);
  color: var(--vscode-foreground);
}
.him-agent-action-btn:disabled {
  opacity: 0.25;
  cursor: default;
}
.him-agent-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.him-agent-edit-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(0,0,0,0.35);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.him-agent-edit-panel {
  width: min(640px, 92vw);
  max-height: min(80vh, 720px);
  overflow: auto;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 10px;
  background: var(--vscode-editorWidget-background);
  color: var(--vscode-foreground);
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.him-agent-edit-row label {
  display: block;
  font-size: 11px;
  opacity: 0.8;
  margin-bottom: 6px;
  font-weight: 600;
}
.him-agent-edit-row input,
.him-agent-edit-row textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--vscode-font-family);
  outline: none;
}
.him-agent-edit-row textarea {
  min-height: 88px;
  resize: vertical;
  font-family: var(--vscode-editor-font-family);
}
.him-agent-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
}
.him-agent-edit-actions button {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.him-agent-edit-actions .primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-border);
}
.him-agent-edit-actions .secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
@keyframes him-memory-busy-shimmer {
  0% { opacity: 0.45; filter: brightness(0.95); }
  50% { opacity: 1; filter: brightness(1.08); }
  100% { opacity: 0.45; filter: brightness(0.95); }
}
.him-memory-meter {
  flex-shrink: 0;
  border-top: 1px solid var(--vscode-widget-border);
  padding: 8px 10px 10px 10px;
  margin-top: auto;
  background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-widget-border) 6%);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  z-index: 2;
}
.him-memory-meter-bar-wrap {
  flex: 1;
  min-width: 0;
  height: 7px;
  border-radius: 999px;
  background: var(--vscode-input-background);
  border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 85%, transparent);
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.12);
}
.him-memory-meter-bar-fill {
  height: 100%;
  width: 0%;
  min-width: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--vscode-textLink-foreground), var(--vscode-button-background));
  transition: width 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 0 8px color-mix(in srgb, var(--vscode-textLink-foreground) 35%, transparent);
}
.him-memory-meter-bar-fill.him-memory-meter-fill-warn {
  background: linear-gradient(90deg, #d97706, #dc2626);
  box-shadow: 0 0 8px rgba(220, 38, 38, 0.35);
}
.him-memory-meter-bar-fill.him-memory-meter-fill-busy {
  width: 100% !important;
  animation: him-memory-busy-shimmer 1.15s ease-in-out infinite;
  background: linear-gradient(90deg, var(--vscode-symbolIcon-stringForeground), var(--vscode-textLink-foreground));
}
.him-memory-meter-hint {
  flex-shrink: 0;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--vscode-descriptionForeground);
  line-height: 1.2;
  opacity: 0.95;
  white-space: nowrap;
}
/* Cursor-style composer input (chat bottom) */
.him-cursor-composer {
  --him-cursor-blue: #2563eb;
  --him-cursor-blue-hover: #1d4ed8;
  --him-cursor-card-bg: color-mix(in srgb, var(--vscode-input-background) 82%, var(--vscode-sideBar-background));
  --him-cursor-card-edge: color-mix(in srgb, var(--vscode-widget-border) 50%, #d1d5db);
  --him-cursor-pill-edge: color-mix(in srgb, var(--vscode-widget-border) 65%, #e5e7eb);
  background: var(--him-cursor-card-bg) !important;
  border: 1px solid var(--him-cursor-card-edge) !important;
  border-radius: 12px !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06) !important;
  padding: 0 !important;
  gap: 0 !important;
  overflow: hidden;
}
.him-cursor-composer .him-chat-attachments {
  padding: 5px 14px 0 14px;
}
.him-cursor-composer .him-chat-input {
  padding: 7px 16px 4px 16px !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
  color: var(--vscode-input-foreground) !important;
}
.him-cursor-composer .him-chat-input::placeholder {
  color: color-mix(in srgb, var(--vscode-input-foreground) 38%, transparent) !important;
  opacity: 1 !important;
}
.him-cursor-composer-toolbar {
  border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border) 55%, transparent) !important;
  padding: 4px 10px 5px 12px !important;
  margin: 0 !important;
  min-height: 21px !important;
  align-items: center !important;
  gap: 3px !important;
  background: color-mix(in srgb, var(--him-cursor-card-bg) 96%, #ffffff) !important;
}
.him-cursor-composer-toolbar .him-chat-controls-left {
  gap: 3px !important;
}
.him-cursor-composer-toolbar .him-chat-controls-right {
  gap: 3px !important;
}
.him-cursor-ghost-icon {
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  border: none !important;
  background: transparent !important;
  border-radius: 8px !important;
  color: color-mix(in srgb, var(--vscode-foreground) 52%, transparent) !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex-shrink: 0 !important;
  padding: 0 !important;
  cursor: pointer !important;
}
.him-cursor-ghost-icon:hover {
  background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 75%, transparent) !important;
  color: var(--vscode-foreground) !important;
}
.him-cursor-ghost-icon .codicon {
  font-size: 13px !important;
}
.him-cursor-pill,
button.him-cursor-pill {
  height: 22px !important;
  min-height: 22px !important;
  padding: 0 9px !important;
  border-radius: 999px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  letter-spacing: -0.01em !important;
  border: 1px solid var(--him-cursor-pill-edge) !important;
  background: color-mix(in srgb, var(--vscode-input-background) 94%, #ffffff) !important;
  color: color-mix(in srgb, var(--vscode-foreground) 90%, #1f2937) !important;
  box-shadow: none !important;
  opacity: 1 !important;
  cursor: pointer !important;
}
span.him-cursor-pill.him-chat-mode {
  display: inline-flex !important;
  align-items: center !important;
  box-sizing: border-box !important;
  cursor: default !important;
}
.him-cursor-mic-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  border-radius: 50% !important;
  border: none !important;
  background: transparent !important;
  color: color-mix(in srgb, var(--vscode-foreground) 58%, transparent) !important;
  padding: 0 !important;
  cursor: pointer !important;
}
.him-cursor-mic-btn:hover {
  background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent) !important;
  color: var(--vscode-foreground) !important;
}
.him-cursor-mic-btn .codicon {
  font-size: 13px !important;
}
.him-cursor-img-pick-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  border-radius: 50% !important;
  border: none !important;
  background: transparent !important;
  color: color-mix(in srgb, var(--vscode-foreground) 58%, transparent) !important;
  padding: 0 !important;
  cursor: pointer !important;
}
.him-cursor-img-pick-btn:hover {
  background: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent) !important;
  color: var(--vscode-foreground) !important;
}
.him-cursor-img-pick-btn .codicon {
  font-size: 13px !important;
}
.him-chat-pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: flex-start;
}
.him-chat-pending-img-tile {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 80%, transparent);
  background: var(--vscode-editorWidget-background);
  flex-shrink: 0;
}
.him-chat-pending-img-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
  display: block;
}
.him-chat-pending-img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: color-mix(in srgb, var(--vscode-editor-background) 88%, #000);
  color: var(--vscode-foreground);
  box-shadow: 0 1px 3px rgba(0,0,0,0.35);
}
.him-chat-pending-img-remove .codicon {
  font-size: 10px !important;
}
.him-chat-img-lightbox {
  position: fixed;
  inset: 0;
  z-index: 100050;
  background: rgba(0,0,0,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  cursor: zoom-out;
}
.him-chat-img-lightbox img {
  max-width: min(96vw, 1200px);
  max-height: min(92vh, 900px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.55);
  cursor: default;
}
.him-cursor-send-btn {
  width: auto !important;
  min-width: 17px !important;
  height: 22px !important;
  min-height: 22px !important;
  border-radius: 11px !important;
  border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 75%, transparent) !important;
  background: var(--vscode-editor-background) !important;
  color: var(--vscode-foreground) !important;
  padding: 0 9px !important;
  cursor: pointer !important;
  box-shadow: none !important;
  flex-shrink: 0 !important;
}
.him-cursor-send-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--vscode-list-hoverBackground) 55%, var(--vscode-editor-background)) !important;
  border-color: color-mix(in srgb, var(--vscode-widget-border) 90%, transparent) !important;
}
.him-cursor-send-btn:disabled {
  opacity: 0.45 !important;
  cursor: default !important;
}
.him-cursor-send-btn .him-cursor-send-kbd {
  font-family: var(--vscode-font-family);
  font-size: 12px !important;
  font-weight: 600 !important;
  line-height: 1 !important;
  letter-spacing: -0.04em !important;
  user-select: none !important;
  opacity: 0.92 !important;
}
.him-cursor-send-btn .codicon {
  font-size: 13px !important;
  line-height: 1 !important;
}
.him-cursor-send-btn--stop .him-cursor-stop-square {
  display: block;
  width: 8px;
  height: 8px;
  background: #fca5a5;
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(185, 28, 28, 0.45);
}
.him-cursor-composer.him-cursor-composer--drop {
  border-color: var(--vscode-focusBorder) !important;
  box-shadow: 0 0 0 1px var(--vscode-focusBorder) inset !important;
}
`;
			container.appendChild(neon);
		}

		container.style.display = 'flex';
		container.style.flexDirection = 'row';
		container.style.height = '100%';
		container.style.backgroundColor = 'var(--vscode-sideBar-background)';

		const leftNav = append(container, $('div.him-agent-nav'));
		leftNav.style.flex = `0 0 ${this.leftNavWidth}px`;
		leftNav.style.width = `${this.leftNavWidth}px`;
		leftNav.style.display = 'flex';
		leftNav.style.flexDirection = 'column';
		leftNav.style.overflow = 'hidden';
		leftNav.style.borderRight = '1px solid var(--vscode-widget-border)';
		leftNav.style.background = 'var(--vscode-sideBar-background)';
		leftNav.style.position = 'relative';
		const resizeHandle = append(leftNav, $('div.him-agent-nav-resize-handle'));
		resizeHandle.style.position = 'absolute';
		resizeHandle.style.top = '0';
		resizeHandle.style.right = '0';
		resizeHandle.style.bottom = '0';
		resizeHandle.style.width = '6px';
		resizeHandle.style.cursor = 'col-resize';
		resizeHandle.style.zIndex = '5';
		// Do not block agent action buttons; only capture events inside the handle.
		resizeHandle.style.background = 'transparent';
		resizeHandle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startWidth = this.leftNavWidth;
			const onMove = (ev: MouseEvent) => {
				const delta = ev.clientX - startX;
				const next = Math.max(this.leftNavMinWidth, Math.min(this.leftNavMaxWidth, startWidth + delta));
				this.leftNavWidth = next;
				leftNav.style.flex = `0 0 ${next}px`;
				leftNav.style.width = `${next}px`;
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});

		const rightColumn = append(container, $('div.him-chat-right-column'));
		rightColumn.style.flex = '1';
		rightColumn.style.minWidth = '0';
		rightColumn.style.display = 'flex';
		rightColumn.style.flexDirection = 'column';
		rightColumn.style.position = 'relative';
		rightColumn.style.backgroundColor = 'var(--vscode-editor-background)';

		// Modal overlay for editing agent meta (name/role/rule).
		this.agentEditOverlay = append(rightColumn, $('div.him-agent-edit-overlay'));
		this.agentEditOverlay.classList.add('him-agent-edit-overlay');
		this.agentEditOverlay.addEventListener('mousedown', (e) => {
			// click outside closes
			if (e.target === this.agentEditOverlay) {
				this.hideAgentEditModal();
			}
		});
		this.agentEditPanel = append(this.agentEditOverlay, $('div.him-agent-edit-panel'));
		this.agentEditPanel.classList.add('him-agent-edit-panel');

		const titleRow = append(this.agentEditPanel, $('div'));
		titleRow.style.display = 'flex';
		titleRow.style.alignItems = 'center';
		titleRow.style.justifyContent = 'space-between';
		const h = append(titleRow, $('div'));
		h.textContent = 'Edit Agent';
		h.style.fontSize = '14px';
		h.style.fontWeight = '700';
		const closeBtn = append(titleRow, $('button')) as HTMLButtonElement;
		closeBtn.textContent = '×';
		closeBtn.className = 'secondary';
		closeBtn.style.width = '32px';
		closeBtn.style.height = '28px';
		closeBtn.addEventListener('click', () => this.hideAgentEditModal());

		const nameRow = append(this.agentEditPanel, $('div.him-agent-edit-row'));
		const nameLab = append(nameRow, $('label'));
		nameLab.textContent = 'Name';
		this.agentEditNameInput = append(nameRow, $('input')) as HTMLInputElement;

		const roleRow = append(this.agentEditPanel, $('div.him-agent-edit-row'));
		const roleLab = append(roleRow, $('label'));
		roleLab.textContent = 'Role';
		this.agentEditRoleInput = append(roleRow, $('textarea')) as HTMLTextAreaElement;

		const ruleRow = append(this.agentEditPanel, $('div.him-agent-edit-row'));
		const ruleLab = append(ruleRow, $('label'));
		ruleLab.textContent = 'Rule';
		this.agentEditRuleInput = append(ruleRow, $('textarea')) as HTMLTextAreaElement;

		const actionRow = append(this.agentEditPanel, $('div.him-agent-edit-actions'));
		const cancel = append(actionRow, $('button')) as HTMLButtonElement;
		cancel.textContent = 'Cancel';
		cancel.className = 'secondary';
		cancel.addEventListener('click', () => this.hideAgentEditModal());
		const save = append(actionRow, $('button')) as HTMLButtonElement;
		save.textContent = 'Save';
		save.className = 'primary';
		save.addEventListener('click', () => this.saveAgentEditModal());

		const navScroll = append(leftNav, $('div.him-agent-nav-scroll'));
		navScroll.style.flex = '1';
		navScroll.style.minHeight = '0';
		navScroll.style.display = 'flex';
		navScroll.style.flexDirection = 'column';
		navScroll.style.overflow = 'hidden';

		this.organizationNavHost = append(navScroll, $('div.him-org-nav-host'));
		this.organizationNavHost.style.display = 'none';
		this.organizationNavHost.style.flexDirection = 'column';
		this.organizationNavHost.style.flexShrink = '0';
		this.organizationNavHost.style.gap = '4px';
		this.organizationNavHost.style.padding = '8px 0 6px 0';
		this.organizationNavHost.style.borderBottom = '1px solid var(--vscode-widget-border)';
		const orgTitle = append(this.organizationNavHost, $('div.him-org-nav-title'));
		orgTitle.textContent = localize('himOrgNavTitle', 'Organization');
		orgTitle.style.fontSize = '10px';
		orgTitle.style.fontWeight = '700';
		orgTitle.style.letterSpacing = '0.04em';
		orgTitle.style.textTransform = 'uppercase';
		orgTitle.style.color = 'var(--vscode-descriptionForeground)';
		orgTitle.style.paddingLeft = '10px';
		orgTitle.style.paddingRight = '10px';
		this.organizationNavRows = append(this.organizationNavHost, $('div.him-org-nav-rows'));
		this.organizationNavRows.style.display = 'flex';
		this.organizationNavRows.style.flexDirection = 'column';
		this.organizationNavRows.style.gap = '2px';

		this.organizationChatsLabel = append(navScroll, $('div.him-org-chats-label'));
		this.organizationChatsLabel.textContent = localize('himOrgChatsLabel', 'Chats');
		this.organizationChatsLabel.style.display = 'none';
		this.organizationChatsLabel.style.fontSize = '10px';
		this.organizationChatsLabel.style.fontWeight = '700';
		this.organizationChatsLabel.style.letterSpacing = '0.04em';
		this.organizationChatsLabel.style.textTransform = 'uppercase';
		this.organizationChatsLabel.style.color = 'var(--vscode-descriptionForeground)';
		this.organizationChatsLabel.style.padding = '6px 10px 2px 10px';

		this.tabBarElement = append(navScroll, $('div.him-tab-bar'));
		this.tabBarElement.dataset.orientation = 'vertical';
		this.tabBarElement.style.display = 'flex';
		this.tabBarElement.style.flexDirection = 'column';
		this.tabBarElement.style.flex = '1';
		this.tabBarElement.style.minHeight = '0';
		this.tabBarElement.style.borderBottom = 'none';
		this.tabBarElement.style.background = 'transparent';
		this.tabBarElement.style.overflowX = 'hidden';
		this.tabBarElement.style.overflowY = 'auto';
		this.tabBarElement.style.alignItems = 'stretch';
		// Keep content away from the resize handle on the far right.
		this.tabBarElement.style.paddingRight = '10px';
		this.hydrateFromStorageIfAny();
		if (this.sessions.length === 0) {
			this.sessions.push({ id: generateUuid(), title: 'Chat 1', role: '', rule: '', messages: [], scrollTop: 0, queuedMessages: [], conversationSummary: '' });
		}
		this.renderTabBar();

		this.memoryMeterContainer = append(leftNav, $('div.him-memory-meter'));
		const barWrap = append(this.memoryMeterContainer, $('div.him-memory-meter-bar-wrap'));
		this.memoryMeterFill = append(barWrap, $('div.him-memory-meter-bar-fill'));
		this.memoryMeterHint = append(this.memoryMeterContainer, $('div.him-memory-meter-hint'));
		this.memoryMeterHint.textContent = '—';
		this.scheduleMemoryMeterUpdate();

		this.configBarElement = append(rightColumn, $('div.him-config-bar'));
		this.configBarElement.style.display = 'flex';
		this.configBarElement.style.alignItems = 'center';
		this.configBarElement.style.justifyContent = 'flex-end';
		this.configBarElement.style.gap = '10px';
		this.configBarElement.style.padding = '3px 10px';
		this.configBarElement.style.flexShrink = '0';
		this.configBarElement.style.borderBottom = '1px solid var(--vscode-widget-border)';
		this.configBarElement.style.background = 'var(--vscode-editorGroupHeader-tabsBackground)';
		this.configBarElement.style.fontSize = '11px';
		this.configBarElement.style.color = 'var(--vscode-descriptionForeground)';

		this.configStatusDot = append(this.configBarElement, $('span.him-config-status'));
		this.configStatusDot.style.display = 'inline-flex';
		this.configStatusDot.style.alignItems = 'center';
		this.configStatusDot.style.gap = '4px';
		this.configStatusDot.textContent = '● IDLE';
		this.configStatusDot.style.color = 'var(--vscode-descriptionForeground)';

		const chatRegion = append(rightColumn, $('div.him-chat-region'));
		chatRegion.style.flex = '1';
		chatRegion.style.position = 'relative';
		chatRegion.style.overflow = 'hidden';
		chatRegion.style.display = 'flex';
		chatRegion.style.flexDirection = 'column';
		chatRegion.style.backgroundColor = 'var(--vscode-editor-background)';

		this.sessionStackHost = append(chatRegion, $('div.him-session-stack'));
		this.sessionStackHost.style.flex = '1';
		this.sessionStackHost.style.minHeight = '0';
		this.sessionStackHost.style.overflow = 'hidden';
		this.sessionStackHost.style.position = 'relative';
		this.sessionStackHost.style.isolation = 'isolate';
		this.sessionStackHost.style.display = 'flex';
		this.sessionStackHost.style.flexDirection = 'column';
		this.sessionStackHost.style.backgroundColor = 'var(--vscode-editor-background)';

		this.organizationDetailPane = append(this.sessionStackHost, $('div.him-org-detail-pane'));
		this.organizationDetailPane.style.display = 'none';
		this.organizationDetailPane.style.flexDirection = 'column';
		this.organizationDetailPane.style.position = 'absolute';
		this.organizationDetailPane.style.left = '0';
		this.organizationDetailPane.style.right = '0';
		this.organizationDetailPane.style.top = '0';
		this.organizationDetailPane.style.bottom = '0';
		this.organizationDetailPane.style.overflow = 'hidden';
		this.organizationDetailPane.style.minHeight = '0';
		this.organizationDetailPane.style.zIndex = '30';
		this.organizationDetailPane.style.backgroundColor = 'var(--vscode-editor-background)';
		this.organizationDetailPane.style.pointerEvents = 'none';

		for (const s of this.sessions) {
			this.ensureSessionPane(s.id);
		}
		this.rebuildAllSessionPanesFromModel();
		const activeS = this.sessions[this.activeSessionIdx];
		if (activeS) {
			this.showSessionPane(activeS.id);
			requestAnimationFrame(() => {
				if (this.messageListElement) {
					this.messageListElement.scrollTop = activeS.scrollTop;
				}
				this.updateScrollToBottomButtonVisibility();
			});
		}

		this.scrollToBottomButtonElement = append(chatRegion, $('button.him-chat-scroll-bottom')) as HTMLButtonElement;
		this.scrollToBottomButtonElement.type = 'button';
		this.scrollToBottomButtonElement.style.display = 'none';
		this.scrollToBottomButtonElement.style.position = 'absolute';
		this.scrollToBottomButtonElement.style.bottom = '12px';
		this.scrollToBottomButtonElement.style.right = '16px';
		this.scrollToBottomButtonElement.style.zIndex = '20';
		this.scrollToBottomButtonElement.style.width = '32px';
		this.scrollToBottomButtonElement.style.height = '32px';
		this.scrollToBottomButtonElement.style.borderRadius = '50%';
		this.scrollToBottomButtonElement.style.border = '1px solid var(--vscode-widget-border)';
		this.scrollToBottomButtonElement.style.background = 'var(--vscode-button-secondaryBackground)';
		this.scrollToBottomButtonElement.style.color = 'var(--vscode-button-secondaryForeground)';
		this.scrollToBottomButtonElement.style.cursor = 'pointer';
		this.scrollToBottomButtonElement.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
		this.scrollToBottomButtonElement.style.alignItems = 'center';
		this.scrollToBottomButtonElement.style.justifyContent = 'center';
		this.scrollToBottomButtonElement.style.padding = '0';
		this.scrollToBottomButtonElement.title = localize('himChatScrollToBottom', 'Scroll to bottom');
		const scrollToBottomIcon = append(this.scrollToBottomButtonElement, $('span')) as HTMLElement;
		scrollToBottomIcon.className = 'codicon codicon-arrow-down';
		this.scrollToBottomButtonElement.addEventListener('click', (e) => {
			e.stopPropagation();
			this.scrollActiveChatToBottom();
		});
		queueMicrotask(() => this.updateScrollToBottomButtonVisibility());
		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(() => this.updateScrollToBottomButtonVisibility());
			ro.observe(chatRegion);
			this._register({ dispose: () => ro.disconnect() });
		}

		// 3. Queued message bar + Input Container
		this.queuedBarElement = append(rightColumn, $('div.him-queued-bar'));
		this.queuedBarElement.style.display = 'none';
		this.queuedBarElement.style.padding = '6px 16px';
		this.queuedBarElement.style.background = 'var(--vscode-editorWidget-background)';
		this.queuedBarElement.style.fontSize = '12px';
		this.queuedBarElement.style.color = 'var(--vscode-descriptionForeground)';
		this.queuedBarElement.style.cursor = 'pointer';
		this.queuedBarElement.style.overflow = 'hidden';
		this.queuedBarElement.style.whiteSpace = 'nowrap';
		this.queuedBarElement.style.textOverflow = 'ellipsis';
		this.queuedBarElement.style.flexShrink = '0';
		this.queuedBarElement.addEventListener('click', () => {
			// clicking the bar does nothing — use individual × buttons
		});

		const fileChangesOuter = append(rightColumn, $('div.him-chat-file-changes-outer'));
		this.fileChangesOuterElement = fileChangesOuter;
		fileChangesOuter.style.display = 'flex';
		fileChangesOuter.style.flexDirection = 'column';
		fileChangesOuter.style.gap = '2px';
		fileChangesOuter.style.width = 'calc(100% - 32px)';
		fileChangesOuter.style.maxWidth = 'calc(100% - 32px)';
		fileChangesOuter.style.marginLeft = 'auto';
		fileChangesOuter.style.marginRight = 'auto';
		fileChangesOuter.style.marginBottom = '2px';
		fileChangesOuter.style.marginTop = '0px';
		fileChangesOuter.style.boxSizing = 'border-box';
		fileChangesOuter.style.flexShrink = '0';
		fileChangesOuter.style.background = 'var(--vscode-editor-background)';
		fileChangesOuter.style.padding = '2px 4px 3px';
		fileChangesOuter.style.borderRadius = '4px';
		fileChangesOuter.style.border = '0';

		const fileChangesBar = append(fileChangesOuter, $('div.him-chat-file-changes-bar'));
		fileChangesBar.style.display = 'flex';
		fileChangesBar.style.alignItems = 'center';
		fileChangesBar.style.gap = '4px';
		fileChangesBar.style.minWidth = '0';

		const fileChangesHint = append(fileChangesBar, $('button.him-chat-file-changes-toggle')) as HTMLButtonElement;
		this.fileChangesHintElement = fileChangesHint;
		fileChangesHint.type = 'button';
		fileChangesHint.style.flex = '1';
		fileChangesHint.style.minWidth = '0';
		fileChangesHint.style.display = 'flex';
		fileChangesHint.style.alignItems = 'center';
		fileChangesHint.style.gap = '4px';
		fileChangesHint.style.border = '0';
		fileChangesHint.style.borderRadius = '3px';
		fileChangesHint.style.background = 'transparent';
		fileChangesHint.style.color = 'var(--vscode-foreground)';
		fileChangesHint.style.padding = '2px 2px';
		fileChangesHint.style.cursor = 'pointer';
		fileChangesHint.style.fontSize = '11px';
		fileChangesHint.style.textAlign = 'left';

		const chevron = append(fileChangesHint, $('span')) as HTMLElement;
		this.fileChangesChevronSpan = chevron;
		chevron.className = 'codicon codicon-chevron-right';
		chevron.style.flexShrink = '0';
		chevron.style.opacity = '0.9';

		const countLabel = append(fileChangesHint, $('span'));
		this.fileChangesCountLabel = countLabel;
		countLabel.textContent = '0 Files';
		countLabel.style.fontWeight = '600';
		countLabel.style.fontSize = '11px';

		fileChangesHint.addEventListener('click', () => {
			if (this.fileChangesBarState.fileCount <= 0) {
				return;
			}
			this.setWorkspaceFileChangesListExpanded(!this.fileChangesListExpanded);
		});

		const fileChangesActions = append(fileChangesBar, $('div.him-chat-file-changes-actions')) as HTMLElement;
		fileChangesActions.style.display = 'flex';
		fileChangesActions.style.alignItems = 'center';
		fileChangesActions.style.gap = '3px';
		fileChangesActions.style.flexShrink = '0';

		const undoBtn = append(fileChangesActions, $('button.him-chat-file-changes-undo')) as HTMLButtonElement;
		this.fileChangesUndoButton = undoBtn;
		this.styleFileChangesBarActionButton(undoBtn, localize('himFileChangesUndoAll', 'Undo All'));
		undoBtn.addEventListener('click', e => {
			e.stopPropagation();
			void this.onWorkspaceFileChangesUndoAll();
		});

		const keepBtn = append(fileChangesActions, $('button.him-chat-file-changes-keep')) as HTMLButtonElement;
		this.fileChangesKeepButton = keepBtn;
		this.styleFileChangesBarActionButton(keepBtn, localize('himFileChangesKeepAll', 'Keep All'));
		keepBtn.addEventListener('click', e => {
			e.stopPropagation();
			void this.onWorkspaceFileChangesKeepAll();
		});

		const reviewBtn = append(fileChangesActions, $('button.him-chat-file-changes-review')) as HTMLButtonElement;
		this.fileChangesReviewButton = reviewBtn;
		this.styleFileChangesBarActionButton(reviewBtn, localize('himFileChangesReview', 'Review'));
		reviewBtn.addEventListener('click', e => {
			e.stopPropagation();
			if (this.fileChangesBarState.fileCount <= 0) {
				return;
			}
			this.setWorkspaceFileChangesListExpanded(true);
			this.fileChangesListElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});

		if (typeof ResizeObserver !== 'undefined') {
			const ro = new ResizeObserver(() => this.scheduleFileChangesCardVerticalOffset());
			ro.observe(fileChangesOuter);
			this._register({ dispose: () => ro.disconnect() });
		}

		const fileChangesList = append(fileChangesOuter, $('div.him-chat-file-changes-list'));
		this.fileChangesListElement = fileChangesList;
		fileChangesList.style.display = 'none';
		fileChangesList.style.maxHeight = HIM_FILE_CHANGES_LIST_MAX_CSS;
		fileChangesList.style.overflowY = 'auto';
		fileChangesList.style.overflowX = 'hidden';
		fileChangesList.style.border = '0';
		fileChangesList.style.background = 'var(--vscode-editor-background)';
		fileChangesList.style.padding = '1px 0 0 0';
		fileChangesList.style.fontSize = '11px';

		this.inputLockBannerElement = append(rightColumn, $('div.him-input-lock-banner'));
		this.inputLockBannerElement.style.display = 'none';
		this.inputLockBannerElement.style.flexShrink = '0';
		this.inputLockBannerElement.style.margin = '0 16px 8px 16px';
		this.inputLockBannerElement.style.fontSize = '11px';
		this.inputLockBannerElement.style.lineHeight = '1.35';
		this.inputLockBannerElement.style.color = 'var(--vscode-editorWarning-foreground)';
		this.inputLockBannerElement.style.background = 'color-mix(in srgb, var(--vscode-editorWarning-foreground) 10%, transparent)';
		this.inputLockBannerElement.style.border = '1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 32%, transparent)';
		this.inputLockBannerElement.style.borderRadius = '6px';
		this.inputLockBannerElement.style.padding = '6px 10px';

		const inputWrapper = append(rightColumn, $('.him-chat-input-wrapper'));
		this.inputWrapperElement = inputWrapper;
		inputWrapper.style.padding = '4px 16px 4px 16px';
		inputWrapper.style.backgroundColor = 'var(--vscode-editor-background)';
		inputWrapper.style.display = 'flex';
		inputWrapper.style.flexDirection = 'column';
		inputWrapper.style.gap = '4px';

		const inputContainer = append(inputWrapper, $('.him-chat-input-container.him-cursor-composer'));
		this.inputContainerElement = inputContainer;
		inputContainer.style.position = 'relative';
		inputContainer.style.boxSizing = 'border-box';
		inputContainer.style.width = '100%';
		inputContainer.style.display = 'flex';
		inputContainer.style.flexDirection = 'column';
		inputContainer.style.minWidth = '0';
		inputContainer.style.transition = 'border-color 120ms ease, box-shadow 120ms ease';

		this.attachmentsContainer = append(inputContainer, $('.him-chat-attachments'));
		this.attachmentsContainer.style.display = 'flex';
		this.attachmentsContainer.style.flexWrap = 'wrap';
		this.attachmentsContainer.style.gap = '4px';

		this.pendingImagesContainer = append(inputContainer, $('.him-chat-pending-images'));
		this.pendingImagesContainer.style.display = 'none';

		this.hiddenImageFileInput = append(inputContainer, $('input')) as HTMLInputElement;
		this.hiddenImageFileInput.type = 'file';
		this.hiddenImageFileInput.accept = 'image/*';
		this.hiddenImageFileInput.multiple = true;
		this.hiddenImageFileInput.tabIndex = -1;
		this.hiddenImageFileInput.setAttribute('aria-hidden', 'true');
		this.hiddenImageFileInput.style.position = 'absolute';
		this.hiddenImageFileInput.style.width = '0';
		this.hiddenImageFileInput.style.height = '0';
		this.hiddenImageFileInput.style.opacity = '0';
		this.hiddenImageFileInput.style.pointerEvents = 'none';
		this.hiddenImageFileInput.addEventListener('change', () => {
			void this.onHiddenImageFileInputChange();
		});

		this.inputElement = append(inputContainer, $('textarea.him-chat-input')) as HTMLTextAreaElement;
		this.inputElement.rows = 1;
		this.inputElement.style.width = '100%';
		this.inputElement.style.boxSizing = 'border-box';
		this.inputElement.style.border = '0';
		this.inputElement.style.outline = 'none';
		this.inputElement.style.resize = 'none';
		this.inputElement.style.overflowX = 'hidden';
		this.inputElement.style.backgroundColor = 'transparent';
		this.inputElement.style.color = 'var(--vscode-input-foreground)';
		this.inputElement.style.fontSize = '14px';
		this.inputElement.style.fontFamily = 'var(--vscode-font-family)';
		this.inputElement.placeholder = 'Ask anything, @ to mention, / for workflows';
		void this.refreshWorkspaceFileChangesSummary();

		const controls = append(inputContainer, $('.him-chat-controls.him-cursor-composer-toolbar'));
		this.controlsElement = controls;
		controls.style.display = 'flex';
		controls.style.alignItems = 'center';
		controls.style.justifyContent = 'space-between';
		controls.style.flexWrap = 'wrap';

		const controlsLeft = append(controls, $('.him-chat-controls-left'));
		this.controlsLeftElement = controlsLeft;
		controlsLeft.style.display = 'flex';
		controlsLeft.style.alignItems = 'center';
		controlsLeft.style.gap = '8px';
		controlsLeft.style.flexWrap = 'nowrap';
		controlsLeft.style.minWidth = '0';
		controlsLeft.style.flex = '1 1 auto';

		// Create but DO NOT append per user request to hide it + avoid CSS !important overrides
		this.addButtonElement = $('button.him-chat-add.him-cursor-ghost-icon') as HTMLButtonElement;
		this.addButtonElement.type = 'button';
		append(this.addButtonElement, $('span.codicon.codicon-add'));
		this.addButtonElement.title = localize('himChatQuickActions', 'Quick actions');
		this.addButtonElement.style.flex = '0 0 auto';
		this.addButtonElement.style.display = 'none';

		const modeBadge = append(controlsLeft, $('span.him-chat-mode.him-cursor-pill'));
		this.modeBadgeElement = modeBadge;
		modeBadge.textContent = localize('himChatPlanningChip', 'Plan');
		modeBadge.style.flex = '0 0 auto';

		const providerPicker = append(controlsLeft, $('.him-chat-provider-picker'));
		this.providerPickerElement = providerPicker;
		providerPicker.style.position = 'relative';
		providerPicker.style.width = `${PROVIDER_PICKER_WIDTH}px`;
		providerPicker.style.flex = `0 0 ${PROVIDER_PICKER_WIDTH}px`;

		this.providerSelectElement = append(providerPicker, $('button.him-chat-provider.him-cursor-pill')) as HTMLButtonElement;
		this.providerSelectElement.type = 'button';
		this.providerSelectElement.style.width = '100%';
		this.providerSelectElement.style.textAlign = 'left';
		this.providerSelectElement.style.whiteSpace = 'nowrap';
		this.providerSelectElement.style.overflow = 'hidden';
		this.providerSelectElement.style.textOverflow = 'ellipsis';
		this.providerSelectElement.style.display = 'flex';
		this.providerSelectElement.style.alignItems = 'center';
		this.providerSelectElement.style.justifyContent = 'space-between';
		this.providerSelectElement.style.gap = '4px';

		this.providerMenuElement = append(providerPicker, $('.him-chat-provider-menu'));
		this.providerMenuElement.style.position = 'fixed';
		this.providerMenuElement.style.left = '0';
		this.providerMenuElement.style.top = '0';
		this.providerMenuElement.style.width = '320px';
		this.providerMenuElement.style.maxHeight = '320px';
		this.providerMenuElement.style.display = 'none';
		this.providerMenuElement.style.flexDirection = 'column';
		this.providerMenuElement.style.overflow = 'hidden';
		this.providerMenuElement.style.border = '1px solid var(--vscode-widget-border)';
		this.providerMenuElement.style.borderRadius = '10px';
		this.providerMenuElement.style.background = 'var(--vscode-editor-background)';
		this.providerMenuElement.style.zIndex = '10000';
		this.providerMenuElement.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)';

		this.providerMenuSearchInput = append(this.providerMenuElement, $('input.him-chat-provider-search')) as HTMLInputElement;
		this.providerMenuSearchInput.placeholder = 'Search models';
		this.providerMenuSearchInput.style.height = '30px';
		this.providerMenuSearchInput.style.margin = '8px';
		this.providerMenuSearchInput.style.borderRadius = '8px';
		this.providerMenuSearchInput.style.border = '1px solid var(--vscode-input-border)';
		this.providerMenuSearchInput.style.background = 'var(--vscode-input-background)';
		this.providerMenuSearchInput.style.color = 'var(--vscode-input-foreground)';
		this.providerMenuSearchInput.style.padding = '0 10px';
		this.providerMenuSearchInput.style.outline = 'none';

		this.providerMenuListElement = append(this.providerMenuElement, $('.him-chat-provider-list'));
		this.providerMenuListElement.style.flex = '1 1 auto';
		this.providerMenuListElement.style.minHeight = '88px';
		this.providerMenuListElement.style.overflowY = 'auto';
		this.providerMenuListElement.style.padding = '0 4px 4px';

		const addModelsButton = append(this.providerMenuElement, $('button.him-chat-add-models')) as HTMLButtonElement;
		addModelsButton.textContent = 'Add Models';
		addModelsButton.style.height = '34px';
		addModelsButton.style.margin = '0';
		addModelsButton.style.padding = '0 10px';
		addModelsButton.style.border = '0';
		addModelsButton.style.borderTop = '1px solid var(--vscode-widget-border)';
		addModelsButton.style.background = 'transparent';
		addModelsButton.style.color = 'var(--vscode-foreground)';
		addModelsButton.style.textAlign = 'left';
		addModelsButton.style.cursor = 'pointer';
		addModelsButton.style.fontSize = '13px';
		addModelsButton.style.flex = '0 0 auto';

		const controlsRight = append(controls, $('.him-chat-controls-right'));
		this.controlsRightElement = controlsRight;
		controlsRight.style.display = 'flex';
		controlsRight.style.alignItems = 'center';
		controlsRight.style.gap = '8px';
		controlsRight.style.flex = '0 0 auto';
		controlsRight.style.marginLeft = 'auto';

		this.micButtonElement = append(controlsRight, $('button.him-chat-mic.him-cursor-mic-btn')) as HTMLButtonElement;
		this.micButtonElement.type = 'button';
		this.micButtonElement.title = localize('himChatVoiceInput', 'Voice input (Whisper API)');
		this.micButtonElement.style.display = 'flex';
		this.micButtonElement.style.alignItems = 'center';
		this.micButtonElement.style.justifyContent = 'center';

		this.imagePickButtonElement = append(controlsRight, $('button.him-chat-image-pick.him-cursor-img-pick-btn')) as HTMLButtonElement;
		this.imagePickButtonElement.type = 'button';
		append(this.imagePickButtonElement, $('span.codicon.codicon-file-media'));
		this.imagePickButtonElement.title = localize('himChatAttachImage', 'Attach image');
		this.imagePickButtonElement.style.display = 'flex';
		this.imagePickButtonElement.style.alignItems = 'center';
		this.imagePickButtonElement.style.justifyContent = 'center';

		this.sendButtonElement = append(controlsRight, $('button.him-chat-send.him-cursor-send-btn')) as HTMLButtonElement;
		this.sendButtonElement.type = 'button';
		this.sendButtonElement.title = localize(
			'himChatSendStop',
			'Send ({0}) / Stop',
			isMacintosh ? '⌘␣↵' : '^␣↵',
		);
		this.sendButtonElement.style.display = 'flex';
		this.sendButtonElement.style.alignItems = 'center';
		this.sendButtonElement.style.justifyContent = 'center';

		this.inputElement.addEventListener('input', () => this.resizeInputArea());
		this.inputElement.addEventListener('keydown', e => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
				e.preventDefault();
				void this.sendCurrentPrompt();
			}
		});
		this.inputElement.addEventListener('paste', e => {
			void this.onComposerPaste(e);
		});
		// Bind DnD only on the composer container: drops on the textarea bubble here; binding both caused duplicate `drop` → double images.
		const bindComposerDnD = (el: HTMLElement) => {
			el.addEventListener('dragover', event => this.onInputDragOver(event));
			el.addEventListener('dragleave', event => this.onInputDragLeave(event));
			el.addEventListener('drop', event => {
				void this.onInputDrop(event);
			});
		};
		bindComposerDnD(inputContainer);

		this.providerSelectElement.addEventListener('click', () => {
			void this.toggleProviderMenu();
		});

		this.providerMenuElement.addEventListener('click', e => {
			e.stopPropagation();
		});

		this.providerMenuSearchInput.addEventListener('input', () => {
			void this.renderProviderMenuList(this.providerMenuSearchInput?.value ?? '');
		});

		this.micButtonElement.addEventListener('click', () => {
			void this.toggleVoiceInput();
		});

		this.imagePickButtonElement.addEventListener('click', () => {
			void this.pickComposerImagesFromDisk();
		});

		this.sendButtonElement.addEventListener('click', () => {
			if (this.isSending) {
				this.requestCts?.cancel();
				const sessionId = this.sessions[this.activeSessionIdx]?.id;
				if (sessionId) {
					const bgCts = this.backgroundCts.get(sessionId);
					if (bgCts) { bgCts.cancel(); }
				}
				return;
			}
			void this.sendCurrentPrompt();
		});

		this.addButtonElement?.addEventListener('click', () => {
			void this.openQuickActions();
		});

		addModelsButton.addEventListener('click', () => {
			void this.openModelSettings();
		});

		const onDocumentMouseDown = (event: MouseEvent) => {
			const targetNode = event.target as Node | null;
			if (targetNode && providerPicker.contains(targetNode)) {
				return;
			}
			this.hideProviderMenu();
		};
		container.ownerDocument.addEventListener('mousedown', onDocumentMouseDown);
		this._register({
			dispose: () => container.ownerDocument.removeEventListener('mousedown', onDocumentMouseDown)
		});

		this.updateSendButtonVisual();
		this.updateVoiceButtonVisual();
		void this.refreshOrganizationNavFromWorkspace();
		this.updateComposerForOrgNavMode();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CONFIG_ROOT)) {
				void this.refreshConfigDependentUi();
			}
		}));

		this._register(this.onDidChangeBodyVisibility((visible) => {
			if (visible) {
				const sid = this.sessions[this.activeSessionIdx]?.id;
				if (sid) {
					this.runStreamingUiFlushForSession(sid);
				}
				this.initSelectionWidget();
			}
		}));

		void this.refreshConfigDependentUi();
		this.persistWorkspaceSessions();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.applyResponsiveLayout(width);
		this.resizeInputArea();
	}

	override getOptimalWidth(): number {
		return CHAT_PANE_MIN_WIDTH;
	}

	private applyResponsiveLayout(width: number): void {
		const compact = width <= 380;
		if (this.inputWrapperElement) {
			this.inputWrapperElement.style.padding = compact ? '4px' : '8px';
			this.inputWrapperElement.style.gap = compact ? '3px' : '5px';
		}
		if (this.controlsElement) {
			this.controlsElement.style.gap = compact ? '2px' : '3px';
		}
		if (this.controlsLeftElement) {
			this.controlsLeftElement.style.gap = compact ? '3px' : '4px';
		}
		if (this.controlsRightElement) {
			this.controlsRightElement.style.gap = compact ? '3px' : '4px';
		}
		if (this.modeBadgeElement) {
			this.modeBadgeElement.style.display = compact ? 'none' : 'inline-flex';
		}
		if (this.providerPickerElement) {
			const providerWidth = compact ? 90 : PROVIDER_PICKER_WIDTH;
			this.providerPickerElement.style.width = `${providerWidth}px`;
			this.providerPickerElement.style.flex = `0 0 ${providerWidth}px`;
		}
		if (this.providerMenuElement) {
			const menuWidth = Math.max(220, Math.min(320, width - (compact ? 8 : 16)));
			this.providerMenuElement.style.width = `${menuWidth}px`;
		}
	}

	private renderWelcomeMessage(forSession?: ChatSession): void {
		const session = forSession ?? this.sessions[this.activeSessionIdx];
		if (session?.linkedOrgAgentId === HIM_ORG_ORCHESTRATOR_AGENT_ID) {
			const ag =
				this.orgAgentsNavOrder.find(a => a.id === HIM_ORG_ORCHESTRATOR_AGENT_ID) ??
				this.cachedOrgDocument?.agents.find(a => a.id === HIM_ORG_ORCHESTRATOR_AGENT_ID);
			this.appendMessage({
				role: 'assistant',
				content: ag
					? this.buildOrgLinkedWelcomeMessage(ag, this.cachedOrgDocument)
					: localize(
						'himOrgLinkedWelcomeMissingAgent',
						'Organization data is not loaded yet. Open a folder workspace or click **Organization → Orchestrator** again after `org.json` exists.',
					),
			});
			return;
		}
		if (session?.linkedOrgAgentId === HIM_ORG_USER_AGENT_ID) {
			const ag =
				this.orgAgentsNavOrder.find(a => a.id === HIM_ORG_USER_AGENT_ID) ??
				this.cachedOrgDocument?.agents.find(a => a.id === HIM_ORG_USER_AGENT_ID);
			this.appendMessage({
				role: 'assistant',
				content: ag
					? this.buildOrgLinkedWelcomeMessage(ag, this.cachedOrgDocument)
					: localize(
						'himOrgLinkedWelcomeMissingAgent',
						'Organization data is not loaded yet. Open a folder workspace or click **Organization → Orchestrator** again after `org.json` exists.',
					),
			});
			return;
		}
		this.appendMessage({
			role: 'assistant',
			content: 'Welcome to HIM CODE. Configure provider and API key, then start chatting.',
		});
	}

	private appendMessage(message: ViewMessage, displayContent?: string): HTMLElement | undefined {
		if (!this.messageListElement) {
			return undefined;
		}

		const row = append(this.messageListElement, $('.him-chat-message-row'));
		row.style.display = 'flex';
		row.style.justifyContent = message.role === 'user' ? 'flex-end' : 'flex-start';
		row.style.position = 'relative';

		const bubble = append(row, $('.him-chat-message-bubble'));
		bubble.style.maxWidth = '90%';
		bubble.style.padding = '10px 12px';
		bubble.style.borderRadius = '10px';
		bubble.style.lineHeight = '1.45';
		bubble.style.userSelect = 'text';
		if (message.role === 'user') {
			bubble.style.fontSize = '12px';
			bubble.style.whiteSpace = 'normal';
			bubble.style.wordBreak = 'break-word';
			bubble.style.background = 'var(--vscode-editor-background)';
			bubble.style.border = '1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent)';
			bubble.style.display = 'flex';
			bubble.style.flexDirection = 'row';
			bubble.style.gap = '6px';
			bubble.style.alignItems = 'flex-start';
		} else {
			bubble.style.fontSize = '13.5px';
			bubble.style.whiteSpace = 'normal';
			bubble.style.wordBreak = 'break-word';
			// Match message list / chat pane (--vscode-editor-background) instead of widget tint.
			bubble.style.background = 'var(--vscode-editor-background)';
			bubble.style.border = '1px solid color-mix(in srgb, var(--vscode-widget-border) 50%, transparent)';
			bubble.style.letterSpacing = '0.1px';
		}
		if (message.isError) {
			bubble.style.color = 'var(--vscode-errorForeground)';
		}

		if (message.role === 'user') {
			const contentContainer = append(bubble, $('div.him-chat-user-content'));
			contentContainer.style.flex = '1';
			contentContainer.style.minWidth = '0';
			this.renderMessageInBubble(contentContainer, message, displayContent);

			const copyIcon = append(bubble, $('button.him-chat-user-copy.him-chat-icon-edit-wrap')) as HTMLButtonElement;
			copyIcon.type = 'button';
			copyIcon.style.border = '0';
			copyIcon.style.background = 'transparent';
			copyIcon.style.cursor = 'pointer';
			copyIcon.style.display = 'flex';
			copyIcon.style.alignItems = 'center';
			copyIcon.style.justifyContent = 'center';
			copyIcon.style.padding = '2px';
			copyIcon.title = localize('himChatCopyToInput', 'Edit this question');
			const iconSpan = append(copyIcon, $('span codicon codicon-edit')) as HTMLElement;
			iconSpan.className = 'codicon codicon-edit';
			iconSpan.style.opacity = '0.7';

			copyIcon.addEventListener('click', (e) => {
				e.stopPropagation();
				if (!this.inputElement) {
					return;
				}
				this.inputElement.value = message.content;
				this.resizeInputArea();
				this.inputElement.focus();
				this.scrollMessagesToBottom();
			});
		} else {
			this.renderMessageInBubble(bubble, message, displayContent);
		}

		if (message.role === 'user') {
			// no-op: sticky user header removed
		}

		this.scrollMessagesToBottom();
		return bubble;
	}

	private renderMessageInBubble(bubble: HTMLElement, message: ViewMessage, displayContent?: string): void {
		if (message.role === 'assistant' && !message.isError) {
			this.disposeRenderedMarkdownForBubble(bubble);
			clearNode(bubble);
			this.renderAssistantMessageWithThinking(bubble, message);
			return;
		}

		// Error assistant turns used to drop thinking + semanticProgramDebug (only `textContent`), so parse failures
		// looked like the whole reply vanished and debug was invisible.
		if (message.role === 'assistant' && message.isError) {
			this.disposeRenderedMarkdownForBubble(bubble);
			clearNode(bubble);
			const hasRich = !!(message.thinking?.trim() || message.semanticProgramDebug);
			if (hasRich) {
				this.renderAssistantMessageWithThinking(bubble, {
					role: 'assistant',
					content: '',
					thinking: message.thinking,
					thinkingDurationMs: message.thinkingDurationMs,
					semanticProgramDebug: message.semanticProgramDebug,
				});
			}
			const errWrap = append(bubble, $('div.him-chat-assistant-error-text'));
			errWrap.style.color = 'var(--vscode-errorForeground)';
			errWrap.style.marginTop = hasRich ? '8px' : '0';
			errWrap.style.whiteSpace = 'pre-wrap';
			errWrap.style.wordBreak = 'break-word';
			errWrap.textContent = displayContent || message.content;
			return;
		}

		this.disposeRenderedMarkdownForBubble(bubble);
		clearNode(bubble);

		if (message.role === 'user' && (message.attachments?.length || message.images?.length)) {
			const attachmentsDiv = append(bubble, $('div'));
			attachmentsDiv.style.display = 'flex';
			attachmentsDiv.style.flexWrap = 'wrap';
			attachmentsDiv.style.gap = '6px';
			attachmentsDiv.style.alignItems = 'flex-start';

			const attachmentRows = message.attachments?.length
				? message.attachments
				: (message.images?.map((im, i) => ({ type: 'image' as const, name: im.name ?? `image-${i + 1}` })) ?? []);

			let imageIdx = 0;
			for (const att of attachmentRows) {
				if (att.type === 'image') {
					const imgData = message.images?.[imageIdx];
					imageIdx++;
					const tile = append(attachmentsDiv, $('.him-chat-pending-img-tile'));
					if (imgData) {
						const src = `data:${imgData.mimeType};base64,${imgData.dataBase64}`;
						const thumb = append(tile, $('img')) as HTMLImageElement;
						thumb.src = src;
						thumb.alt = att.name;
						thumb.addEventListener('click', e => {
							e.stopPropagation();
							this.showImageLightbox(src);
						});
					} else {
						const ph = append(tile, $('span'));
						ph.textContent = att.name;
						ph.style.cssText = 'font-size:10px;padding:6px;color:var(--vscode-descriptionForeground);';
					}
					continue;
				}

				const chip = append(attachmentsDiv, $('span'));
				chip.style.cssText = `
					display: inline-flex;
					align-items: center;
					gap: 4px;
					background: var(--vscode-textCodeBlock-background, #2d2d2d);
					border: 1px solid var(--vscode-widget-border);
					border-radius: 4px;
					padding: 2px 6px;
					font-size: 11px;
					color: var(--vscode-editor-foreground);
				`;

				if (att.type === 'code') {
					const icon = append(chip, $('span'));
					icon.style.cssText = `
						font-size: 10px;
						font-weight: 600;
						color: #ffffff;
						background: #007acc;
						padding: 1px 3px;
						border-radius: 2px;
					`;
					icon.textContent = '«»';
					const name = append(chip, $('span'));
					name.textContent = att.name;
					name.style.color = 'var(--vscode-textLink-foreground)';
					if (att.range) {
						const range = append(chip, $('span'));
						range.textContent = att.range;
						range.style.color = 'var(--vscode-editorLineNumber-foreground)';
					}
				} else if (att.type === 'file') {
					const ext = att.name.includes('.') ? att.name.split('.').pop()!.toLowerCase() : '';
					const extColors: Record<string, string> = {
						'js': '#f7df1e', 'ts': '#3178c6', 'jsx': '#61dafb', 'tsx': '#61dafb',
						'py': '#3572A5', 'rs': '#dea584', 'go': '#00ADD8', 'java': '#b07219',
						'html': '#e34c26', 'css': '#563d7c', 'json': '#292929',
						'md': '#083fa1', 'sh': '#89e051',
					};
					const color = extColors[ext] || '#6a737d';
					const icon = append(chip, $('span'));
					icon.style.cssText = `
						font-size: 10px;
						font-weight: 600;
						color: #ffffff;
						background: ${color};
						padding: 1px 3px;
						border-radius: 2px;
					`;
					icon.textContent = ext ? `.${ext}` : 'FILE';
					const name = append(chip, $('span'));
					name.textContent = att.name;
					name.style.color = 'var(--vscode-textLink-foreground)';
					if (att.size) {
						const size = append(chip, $('span'));
						size.textContent = att.size;
						size.style.color = 'var(--vscode-editorLineNumber-foreground)';
					}
				}
			}

			if (displayContent) {
				const textDiv = append(bubble, $('div'));
				textDiv.textContent = displayContent;
				textDiv.style.whiteSpace = 'pre-wrap';
				textDiv.style.marginTop = '4px';
			}
		} else {
			bubble.textContent = displayContent || message.content;
		}
	}

	private disposeRenderedMarkdownForBubble(bubble: HTMLElement): void {
		const renderedItems = this.renderedMarkdownByBubble.get(bubble);
		if (renderedItems) {
			for (const rendered of renderedItems) {
				rendered.dispose();
			}
			this.renderedMarkdownByBubble.delete(bubble);
		}
	}

	private disposeAllRenderedMarkdown(): void {
		for (const renderedItems of this.renderedMarkdownByBubble.values()) {
			for (const rendered of renderedItems) {
				rendered.dispose();
			}
		}
		this.renderedMarkdownByBubble.clear();
	}

	private renderAssistantMessageWithThinking(bubble: HTMLElement, message: ViewMessage): void {
		const renderedItems: IDisposable[] = [];
		this.renderedMarkdownByBubble.set(bubble, renderedItems);

		if (message.thinking?.trim()) {
			const thinkingShell = append(bubble, $('.him-chat-thinking-shell'));
			thinkingShell.style.marginBottom = '8px';
			thinkingShell.style.border = '1px solid var(--vscode-widget-border)';
			thinkingShell.style.borderRadius = '8px';
			thinkingShell.style.overflow = 'hidden';
			thinkingShell.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)';

			const thinkingToggle = append(thinkingShell, $('button.him-chat-thinking-toggle')) as HTMLButtonElement;
			thinkingToggle.type = 'button';
			thinkingToggle.style.width = '100%';
			thinkingToggle.style.border = '0';
			thinkingToggle.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 75%, transparent)';
			thinkingToggle.style.color = 'var(--vscode-descriptionForeground)';
			thinkingToggle.style.display = 'flex';
			thinkingToggle.style.alignItems = 'center';
			thinkingToggle.style.justifyContent = 'space-between';
			thinkingToggle.style.padding = '8px 10px';
			thinkingToggle.style.cursor = 'pointer';
			thinkingToggle.style.fontSize = '11px';
			thinkingToggle.style.fontWeight = '600';

			const toggleLabel = append(thinkingToggle, $('span.him-chat-thinking-label'));
			const durationText = message.thinkingDurationMs ? ` · ${Math.max(1, Math.round(message.thinkingDurationMs / 1000))}s` : '';
			toggleLabel.textContent = `Thought${durationText}`;

			const toggleIcon = append(thinkingToggle, $('span.codicon.codicon-chevron-right')) as HTMLElement;
			toggleIcon.style.opacity = '0.85';

			const thinkingBody = append(thinkingShell, $('.him-chat-thinking-body')) as HTMLElement;
			thinkingBody.style.padding = '8px 10px';
			thinkingBody.style.borderTop = '1px solid var(--vscode-widget-border)';
			thinkingBody.style.overflowY = 'auto';
			thinkingBody.style.overflowX = 'hidden';
			thinkingBody.style.maxHeight = '72px';

			const thinkingMarkdown = new MarkdownString(message.thinking, {
				supportThemeIcons: true,
				isTrusted: false,
			});
			const renderedThinking = this.markdownRendererService.render(thinkingMarkdown);
			renderedItems.push(renderedThinking);
			thinkingBody.appendChild(renderedThinking.element);
			renderedThinking.element.style.userSelect = 'text';
			this.tightenRenderedMarkdown(renderedThinking.element);

			let expanded = false;
			thinkingToggle.addEventListener('click', () => {
				expanded = !expanded;
				thinkingBody.style.maxHeight = expanded ? 'min(320px, 50vh)' : '72px';
				toggleIcon.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
			});
		}

		if (message.semanticProgramDebug) {
			this.renderSemanticProgramDebugShell(bubble, message.semanticProgramDebug);
		}

		const displayContent = this.stripStructuredBlocksForDisplay(message.content);
		const segments = parseAnswerSegments(displayContent);
		const hasBlocks = segments.some(s => s.kind === 'python' || s.kind === 'shell' || s.kind === 'search');
		if (!hasBlocks) {
			const answerMarkdown = new MarkdownString(displayContent, {
				supportThemeIcons: true,
				isTrusted: false,
			});
			const renderedAnswer = this.markdownRendererService.render(answerMarkdown);
			renderedItems.push(renderedAnswer);
			bubble.appendChild(renderedAnswer.element);
			renderedAnswer.element.style.userSelect = 'text';
			this.tightenRenderedMarkdown(renderedAnswer.element);
			return;
		}

		const pyExecByIndex = new Map<number, HimPythonExecRecord>();
		for (const ex of message.pythonExecutions ?? []) {
			pyExecByIndex.set(ex.blockIndex, ex);
		}
		const shExecByIndex = new Map<number, HimShellExecRecord>();
		for (const ex of message.shellExecutions ?? []) {
			shExecByIndex.set(ex.blockIndex, ex);
		}
		const srExecByIndex = new Map<number, HimSearchExecRecord>();
		for (const ex of message.searchExecutions ?? []) {
			srExecByIndex.set(ex.blockIndex, ex);
		}

		for (const seg of segments) {
			if (seg.kind === 'markdown' && seg.text.trim()) {
				const answerMarkdown = new MarkdownString(seg.text, {
					supportThemeIcons: true,
					isTrusted: false,
				});
				const renderedAnswer = this.markdownRendererService.render(answerMarkdown);
				renderedItems.push(renderedAnswer);
				bubble.appendChild(renderedAnswer.element);
				renderedAnswer.element.style.userSelect = 'text';
				this.tightenRenderedMarkdown(renderedAnswer.element);
			}
			if (seg.kind === 'python') {
				const row = append(bubble, $('div.him-python-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '8px';
				row.style.marginTop = '8px';
				const shell = this.renderFinalPythonShell(seg.blockIndex, seg.text, seg.complete, renderedItems);
				row.appendChild(shell);
				const ex = pyExecByIndex.get(seg.blockIndex);
				if (ex) {
					const outWrap = append(row, $('div.him-python-final-output'));
					outWrap.style.display = 'flex';
					outWrap.style.flexDirection = 'column';
					outWrap.style.gap = '4px';
					const resultMd = new MarkdownString(ex.output || '', {
						supportThemeIcons: true,
						isTrusted: false,
					});
					const renderedResult = this.markdownRendererService.render(resultMd);
					renderedItems.push(renderedResult);
					outWrap.appendChild(renderedResult.element);
					renderedResult.element.style.userSelect = 'text';
					this.tightenRenderedMarkdown(renderedResult.element);
					if (ex.hadError) {
						renderedResult.element.style.color = 'var(--vscode-errorForeground)';
					}
					outWrap.appendChild(this.renderWorkspaceDiffBox(bubble, `data-him-py-diff-expanded-${seg.blockIndex}`, ex.workspaceDiff ?? ''));
				}
			}
			if (seg.kind === 'shell') {
				const row = append(bubble, $('div.him-shell-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '8px';
				row.style.marginTop = '8px';
				const shellWidget = this.renderFinalShellBlock(seg.blockIndex, seg.text, seg.complete, renderedItems);
				row.appendChild(shellWidget);
				const ex = shExecByIndex.get(seg.blockIndex);
				if (ex) {
					row.appendChild(this.renderCollapsibleTextOutput(
						bubble,
						`data-him-shell-out-expanded-${seg.blockIndex}`,
						ex.output || '(no output)',
						96
					));
					row.appendChild(this.renderWorkspaceDiffBox(bubble, `data-him-sh-diff-expanded-${seg.blockIndex}`, ex.workspaceDiff ?? ''));
				}
			}
			if (seg.kind === 'search') {
				const row = append(bubble, $('div.him-search-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '8px';
				row.style.marginTop = '8px';
				const shell = this.renderFinalSearchBlock(seg.blockIndex, seg.text, seg.complete);
				row.appendChild(shell);
				const ex = srExecByIndex.get(seg.blockIndex);
				if (ex) {
					row.appendChild(this.renderCollapsibleTextOutput(bubble, `data-him-search-out-expanded-${seg.blockIndex}`, ex.output || '(no output)', 180));
				}
			}
		}
	}

	private renderFinalSearchBlock(blockIndex: number, query: string, complete: boolean): HTMLElement {
		const wrap = $('div.him-final-search-block');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 86%, transparent)';

		let expanded = false;
		const head = append(wrap, $('button.him-final-search-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '6px';
		head.style.padding = '6px 10px';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.width = '100%';
		head.style.border = '0';
		head.style.cursor = 'pointer';

		const toggle = append(head, $('span')) as HTMLElement;
		toggle.className = 'codicon codicon-chevron-right';
		toggle.style.opacity = '0.85';
		const icon = append(head, $('span.codicon.codicon-search'));
		icon.style.opacity = '0.7';
		const preview = query.trim().split('\n')[0] || 'Search';
		const lab = append(head, $('span'));
		lab.textContent = `${preview.length > 64 ? preview.slice(0, 64) + '…' : preview}${complete ? '' : ' …'}`;
		lab.style.flex = '1';
		lab.style.fontFamily = 'var(--vscode-editor-font-family)';

		const body = append(wrap, $('div'));
		body.style.padding = '6px 10px';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.fontSize = '12px';
		body.style.whiteSpace = 'pre-wrap';
		body.style.wordBreak = 'break-word';
		body.style.color = 'var(--vscode-editor-foreground)';
		body.style.maxHeight = '150px';
		body.style.overflowY = 'auto';
		body.textContent = query.trim();
		body.style.display = 'none';

		head.addEventListener('click', () => {
			expanded = !expanded;
			body.style.display = expanded ? 'block' : 'none';
			toggle.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});

		return wrap;
	}

	/** Stream: Cursor-like Thought + segmented answer + lock banner while executor is running. */
	private renderStreamingAssistantBubble(
		bubble: HTMLElement,
		thinkingText: string,
		answerText: string,
		elapsedSec: number,
		lockMessage?: string,
		pythonExecs: readonly HimPythonExecRecord[] = [],
		shellExecs: readonly HimShellExecRecord[] = [],
		searchExecs: readonly HimSearchExecRecord[] = [],
		planWorkspaceRelativePath?: string,
	): void {
		this.disposeRenderedMarkdownForBubble(bubble);
		const renderedItems: IDisposable[] = [];
		this.renderedMarkdownByBubble.set(bubble, renderedItems);
		const hasAnswer = answerText.trim().length > 0;
		const thoughtExpanded = bubble.dataset.himThoughtExpanded === '1' || !hasAnswer;
		this.removeStreamingParts(bubble);
		bubble.style.display = 'flex';
		bubble.style.flexDirection = 'column';
		bubble.style.gap = '10px';
		bubble.style.alignItems = 'stretch';

		if (thinkingText.trim().length > 0) {
			bubble.appendChild(this.renderStreamThoughtShell(bubble, thinkingText, elapsedSec, thoughtExpanded));
		}
		if (planWorkspaceRelativePath?.trim()) {
			const planStrip = append(bubble, $('div.him-chat-plan-stream-strip'));
			planStrip.style.display = 'flex';
			planStrip.style.alignItems = 'center';
			planStrip.style.gap = '8px';
			planStrip.style.padding = '6px 10px';
			planStrip.style.border = '1px solid var(--vscode-widget-border)';
			planStrip.style.borderRadius = '8px';
			planStrip.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)';
			const planLab = append(planStrip, $('span.codicon.codicon-list-tree'));
			planLab.style.opacity = '0.85';
			const planTitle = append(planStrip, $('span'));
			planTitle.style.flex = '1';
			planTitle.style.fontSize = '11px';
			planTitle.style.fontWeight = '600';
			planTitle.style.color = 'var(--vscode-descriptionForeground)';
			planTitle.textContent = localize('himChatSemanticStreamLabel', 'Plan');
		}
		if (lockMessage) {
			const lock = append(bubble, $('div.him-stream-lock'));
			lock.style.padding = '8px 10px';
			lock.style.border = '1px solid var(--vscode-widget-border)';
			lock.style.borderRadius = '8px';
			lock.style.background = 'color-mix(in srgb, var(--vscode-editorWarning-foreground) 12%, transparent)';
			lock.style.color = 'var(--vscode-descriptionForeground)';
			lock.style.fontSize = '11px';
			lock.style.fontWeight = '600';
			lock.textContent = lockMessage;
		}
		bubble.appendChild(this.renderStreamAnswerSegments(bubble, answerText, true, renderedItems, pythonExecs, shellExecs, searchExecs));
		this.scrollMessageListContaining(bubble);
	}

	private renderStreamThoughtShell(bubble: HTMLElement, thinkingText: string, elapsedSec: number, expanded: boolean): HTMLElement {
		const thought = $('div.him-stream-thought');
		thought.style.border = '1px solid var(--vscode-widget-border)';
		thought.style.borderRadius = '8px';
		thought.style.overflow = 'hidden';
		thought.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 90%, transparent)';

		const head = append(thought, $('button.him-stream-thought-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.justifyContent = 'space-between';
		head.style.gap = '6px';
		head.style.padding = '8px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const icon = append(head, $('span')) as HTMLElement;
		icon.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		icon.style.opacity = '0.85';
		const ht = append(head, $('span'));
		ht.textContent = `Thought · ${elapsedSec}s`;
		ht.style.flex = '1';
		ht.style.textAlign = 'left';

		const body = append(thought, $('div.him-stream-thought-body')) as HTMLElement;
		body.style.padding = '8px 10px';
		body.style.fontSize = '12px';
		body.style.lineHeight = '1.45';
		body.style.color = 'var(--vscode-editor-foreground)';
		body.style.whiteSpace = 'pre-wrap';
		body.style.wordBreak = 'break-word';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.overflowY = 'auto';
		body.style.overflowX = 'hidden';
		body.style.maxHeight = expanded ? 'min(320px, 50vh)' : '72px';
		body.textContent = thinkingText;
		requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });

		head.addEventListener('click', () => {
			const next = bubble.dataset.himThoughtExpanded !== '1';
			bubble.dataset.himThoughtExpanded = next ? '1' : '0';
			body.style.maxHeight = next ? 'min(320px, 50vh)' : '72px';
			icon.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.dataset.himThoughtExpanded = expanded ? '1' : '0';

		return thought;
	}

	private renderStreamAnswerSegments(
		bubble: HTMLElement,
		answerText: string,
		streamingCaret: boolean,
		renderedItems: IDisposable[],
		pythonExecs: readonly HimPythonExecRecord[] = [],
		shellExecs: readonly HimShellExecRecord[] = [],
		searchExecs: readonly HimSearchExecRecord[] = [],
	): HTMLElement {
		const root = $('div.him-stream-answer');
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.gap = '10px';
		root.style.minWidth = '0';
		root.style.width = '100%';
		root.style.overflow = 'hidden';

		let segments = parseAnswerSegments(answerText);
		if (streamingCaret) {
			segments = appendStreamCaret(segments, '▌');
		}

		for (const seg of segments) {
			if (seg.kind === 'markdown' && seg.text.length > 0) {
				const md = $('div.him-stream-md');
				md.style.fontSize = '13px';
				md.style.lineHeight = '1.35';
				md.style.whiteSpace = 'pre-wrap';
				md.style.wordBreak = 'break-word';
				md.style.color = 'var(--vscode-editor-foreground)';
				md.textContent = seg.text;
				root.appendChild(md);
			}
			if (seg.kind === 'python') {
				const row = append(root, $('div.him-python-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '6px';
				row.style.minWidth = '0';
				row.style.width = '100%';
				const shell = this.renderStreamPythonShell(bubble, seg.blockIndex, seg.text, seg.complete, renderedItems);
				row.appendChild(shell);
				const slot = append(row, $('div.him-python-exec-slot')) as HTMLElement;
				slot.setAttribute('data-block-index', String(seg.blockIndex));
				slot.style.display = 'flex';
				slot.style.flexDirection = 'column';
				slot.style.gap = '4px';
				slot.style.minHeight = '0';

				const prevExec = pythonExecs.find(e => e.blockIndex === seg.blockIndex);
				if (prevExec) {
					if (prevExec.output) {
						const outDiv = append(slot, $('div.him-python-output'));
						outDiv.style.whiteSpace = 'pre-wrap';
						outDiv.style.fontSize = '13px';
						outDiv.style.lineHeight = '1.35';
						outDiv.style.wordBreak = 'break-word';
						outDiv.style.color = prevExec.hadError ? 'var(--vscode-errorForeground)' : 'var(--vscode-editor-foreground)';
						outDiv.style.margin = '0';
						outDiv.style.padding = '4px 0';
						outDiv.textContent = prevExec.output;
					}
					slot.appendChild(this.renderWorkspaceDiffBox(bubble, `data-him-py-diff-expanded-${seg.blockIndex}`, prevExec.workspaceDiff ?? ''));
				}
			}
			if (seg.kind === 'shell') {
				const row = append(root, $('div.him-shell-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '6px';
				row.style.minWidth = '0';
				row.style.width = '100%';
				const shellWidget = this.renderStreamShellBlock(bubble, seg.blockIndex, seg.text, seg.complete, renderedItems);
				row.appendChild(shellWidget);
				const slot = append(row, $('div.him-shell-exec-slot')) as HTMLElement;
				slot.setAttribute('data-shell-index', String(seg.blockIndex));
				slot.style.display = 'flex';
				slot.style.flexDirection = 'column';
				slot.style.gap = '4px';
				slot.style.minHeight = '0';

				const prevExec = shellExecs.find(e => e.blockIndex === seg.blockIndex);
				if (prevExec) {
					if (prevExec.output) {
						slot.appendChild(this.renderCollapsibleTextOutput(
							bubble,
							`data-him-shell-out-expanded-${seg.blockIndex}`,
							prevExec.output,
							80
						));
					}
					slot.appendChild(this.renderWorkspaceDiffBox(bubble, `data-him-sh-diff-expanded-${seg.blockIndex}`, prevExec.workspaceDiff ?? ''));
				}
			}
			if (seg.kind === 'search') {
				const row = append(root, $('div.him-search-block-row'));
				row.style.display = 'flex';
				row.style.flexDirection = 'column';
				row.style.gap = '6px';
				row.style.minWidth = '0';
				row.style.width = '100%';
				const widget = this.renderStreamSearchBlock(bubble, seg.blockIndex, seg.text, seg.complete);
				row.appendChild(widget);

				const slot = append(row, $('div.him-search-exec-slot')) as HTMLElement;
				slot.setAttribute('data-search-index', String(seg.blockIndex));
				slot.style.display = 'flex';
				slot.style.flexDirection = 'column';
				slot.style.gap = '4px';

				const prevExec = searchExecs.find(e => e.blockIndex === seg.blockIndex);
				if (prevExec && prevExec.output) {
					slot.appendChild(this.renderCollapsibleTextOutput(bubble, `data-him-search-out-expanded-${seg.blockIndex}`, prevExec.output, 140));
				}
			}
		}

		return root;
	}

	private renderStreamSearchBlock(bubble: HTMLElement, blockIndex: number, query: string, complete: boolean): HTMLElement {
		const wrap = $('div.him-stream-search-block');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 86%, transparent)';
		wrap.style.width = '100%';
		wrap.style.boxSizing = 'border-box';

		const srAttr = `data-him-sr-expanded-${blockIndex}`;
		const expanded = bubble.getAttribute(srAttr) === '1';

		const head = append(wrap, $('button.him-stream-search-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '6px';
		head.style.padding = '6px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const ic = append(head, $('span')) as HTMLElement;
		ic.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		ic.style.opacity = '0.85';
		const sIcon = append(head, $('span')) as HTMLElement;
		sIcon.className = 'codicon codicon-search';
		sIcon.style.opacity = '0.7';
		const lab = append(head, $('span'));
		const preview = query.trim().split('\n')[0] || 'Search';
		lab.textContent = `${preview.length > 64 ? preview.slice(0, 64) + '…' : preview}${complete ? '' : ' …'}`;
		lab.style.flex = '1';
		lab.style.textAlign = 'left';
		lab.style.fontFamily = 'var(--vscode-editor-font-family)';

		const body = append(wrap, $('div.him-stream-search-body')) as HTMLElement;
		body.style.padding = '6px 10px';
		body.style.maxHeight = expanded ? '160px' : '24px';
		body.style.overflowY = 'auto';
		body.style.overflowX = 'hidden';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.transition = 'max-height 0.15s ease';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.fontSize = '12px';
		body.style.whiteSpace = 'pre-wrap';
		body.style.wordBreak = 'break-word';
		body.style.color = 'var(--vscode-editor-foreground)';
		body.textContent = query.trim();

		head.addEventListener('click', () => {
			const next = bubble.getAttribute(srAttr) !== '1';
			bubble.setAttribute(srAttr, next ? '1' : '0');
			body.style.maxHeight = next ? '160px' : '24px';
			ic.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.setAttribute(srAttr, expanded ? '1' : '0');
		return wrap;
	}

	private renderCollapsibleTextOutput(
		bubble: HTMLElement,
		expandedAttr: string,
		text: string,
		collapsedMaxPx: number,
	): HTMLElement {
		const shell = $('div.him-collapsible-output-shell');
		shell.style.border = '1px solid var(--vscode-widget-border)';
		shell.style.borderRadius = '8px';
		shell.style.overflow = 'hidden';
		shell.style.background = 'color-mix(in srgb, var(--vscode-terminal-background, var(--vscode-editor-background)) 88%, transparent)';

		const expanded = bubble.getAttribute(expandedAttr) === '1';

		const head = append(shell, $('button.him-collapsible-output-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.justifyContent = 'space-between';
		head.style.padding = '6px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const label = append(head, $('span'));
		label.textContent = 'Result';
		const icon = append(head, $('span')) as HTMLElement;
		icon.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		icon.style.opacity = '0.85';

		const body = append(shell, $('div.him-collapsible-output-body')) as HTMLElement;
		body.style.padding = '8px 10px';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.whiteSpace = 'pre-wrap';
		body.style.fontSize = '12px';
		body.style.lineHeight = '1.4';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.color = 'var(--vscode-editor-foreground)';
		body.style.background = 'var(--vscode-terminal-background, var(--vscode-editor-background))';
		body.style.maxHeight = expanded ? 'min(420px, 55vh)' : `${collapsedMaxPx}px`;
		body.style.overflowY = 'auto';
		body.style.wordBreak = 'break-word';
		body.textContent = text;

		head.addEventListener('click', () => {
			const next = bubble.getAttribute(expandedAttr) !== '1';
			bubble.setAttribute(expandedAttr, next ? '1' : '0');
			body.style.maxHeight = next ? 'min(420px, 55vh)' : `${collapsedMaxPx}px`;
			icon.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.setAttribute(expandedAttr, expanded ? '1' : '0');

		return shell;
	}

	private renderWorkspaceDiffBox(bubble: HTMLElement, expandedAttr: string, diffText: string): HTMLElement {
		const shell = $('div.him-workspace-diff-shell');
		shell.style.border = '1px solid var(--vscode-widget-border)';
		shell.style.borderRadius = '8px';
		shell.style.overflow = 'hidden';
		shell.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 86%, transparent)';
		shell.style.marginTop = '6px';

		// Default expanded: first paint uses full height so multiple file hunks are not squeezed into ~132px.
		const expanded = bubble.getAttribute(expandedAttr) !== '0';
		const head = append(shell, $('button.him-workspace-diff-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.justifyContent = 'space-between';
		head.style.padding = '6px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const label = append(head, $('span'));
		label.textContent = 'Workspace changes';
		const icon = append(head, $('span')) as HTMLElement;
		icon.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		icon.style.opacity = '0.85';

		const body = append(shell, $('div.him-workspace-diff-body')) as HTMLElement;
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.maxHeight = expanded ? 'min(480px, 65vh)' : 'min(240px, 36vh)';
		body.style.overflowY = 'auto';
		body.style.overflowX = 'auto';
		body.style.background = 'var(--vscode-editor-background)';
		body.style.padding = '8px';
		body.style.display = 'flex';
		body.style.flexDirection = 'column';
		body.style.gap = '12px';

		const files = this.parseGitDiffByFile(diffText);
		const appendPatchLines = (host: HTMLElement, patch: string) => {
			for (const line of patch.split('\n')) {
				const row = append(host, $('div'));
				row.style.display = 'flex';
				row.style.alignItems = 'stretch';
				row.style.minWidth = '0';

				const bar = append(row, $('span')) as HTMLElement;
				bar.style.width = '3px';
				bar.style.flexShrink = '0';

				const text = append(row, $('span')) as HTMLElement;
				text.style.flex = '1';
				text.style.minWidth = '0';
				text.style.whiteSpace = 'pre-wrap';
				text.style.wordBreak = 'break-word';
				text.style.padding = '2px 8px';
				text.style.fontFamily = 'var(--vscode-editor-font-family)';
				text.style.fontSize = '12px';
				text.style.lineHeight = '1.45';
				text.textContent = line;

				if (line.startsWith('+') && !line.startsWith('+++')) {
					bar.style.background = 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)';
					row.style.background = 'color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground) 88%, transparent)';
					text.style.color = 'var(--vscode-diffEditor-insertedTextForeground, var(--vscode-editor-foreground))';
				} else if (line.startsWith('-') && !line.startsWith('---')) {
					bar.style.background = 'var(--vscode-gitDecoration-deletedResourceForeground, #f85149)';
					row.style.background = 'color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground) 88%, transparent)';
					text.style.color = 'var(--vscode-diffEditor-removedTextForeground, var(--vscode-editor-foreground))';
				} else {
					bar.style.background = 'transparent';
					text.style.color = 'var(--vscode-editor-foreground)';
					if (line.startsWith('@@')) {
						text.style.color = 'var(--vscode-textLink-foreground)';
						text.style.fontWeight = '600';
					} else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
						text.style.opacity = '0.75';
						text.style.fontSize = '11px';
					}
				}
			}
		};

		if (files.length > 0) {
			for (const f of files) {
				const card = append(body, $('div.him-diff-file-card'));
				card.style.border = '1px solid var(--vscode-widget-border)';
				card.style.borderRadius = '8px';
				card.style.overflow = 'hidden';
				card.style.flexShrink = '0';
				card.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 94%, transparent)';

				const fileHead = append(card, $('button.him-diff-file-head')) as HTMLButtonElement;
				fileHead.type = 'button';
				fileHead.style.display = 'flex';
				fileHead.style.alignItems = 'center';
				fileHead.style.gap = '8px';
				fileHead.style.width = '100%';
				fileHead.style.padding = '6px 10px';
				fileHead.style.border = '0';
				fileHead.style.borderBottom = '1px solid var(--vscode-widget-border)';
				fileHead.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 78%, transparent)';
				fileHead.style.cursor = 'pointer';

				fileHead.appendChild(this.renderDiffFileBadge(f.path));
				const baseName = f.path.split(/[/\\]/).pop() ?? f.path;
				const nameEl = append(fileHead, $('span'));
				nameEl.textContent = baseName;
				nameEl.style.flex = '1';
				nameEl.style.textAlign = 'left';
				nameEl.style.fontWeight = '600';
				nameEl.style.fontSize = '12px';
				nameEl.style.overflow = 'hidden';
				nameEl.style.textOverflow = 'ellipsis';
				nameEl.style.whiteSpace = 'nowrap';
				nameEl.style.color = 'var(--vscode-foreground)';

				const statsWrap = append(fileHead, $('span'));
				statsWrap.style.display = 'flex';
				statsWrap.style.gap = '6px';
				statsWrap.style.alignItems = 'center';
				statsWrap.style.fontFamily = 'var(--vscode-editor-font-family)';
				const addSpan = append(statsWrap, $('span'));
				addSpan.textContent = `+${f.added}`;
				addSpan.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)';
				addSpan.style.fontWeight = '600';
				addSpan.style.fontSize = '11px';
				const delSpan = append(statsWrap, $('span'));
				delSpan.textContent = `-${f.removed}`;
				delSpan.style.color = 'var(--vscode-gitDecoration-deletedResourceForeground, #f85149)';
				delSpan.style.fontWeight = '600';
				delSpan.style.fontSize = '11px';

				fileHead.addEventListener('click', () => void this.openFileDiffAgainstHead(f.path));

				const linesHost = append(card, $('div'));
				linesHost.style.margin = '0';
				linesHost.style.maxHeight = 'min(260px, 38vh)';
				linesHost.style.overflowY = 'auto';
				linesHost.style.overflowX = 'auto';
				appendPatchLines(linesHost, f.patch);
			}
		} else if (diffText.trim().length > 0) {
			const hint = append(body, $('div'));
			hint.style.fontSize = '11px';
			hint.style.color = 'var(--vscode-descriptionForeground)';
			hint.style.marginBottom = '4px';
			hint.textContent = 'Could not split this output into per-file hunks; showing the raw patch.';
			const raw = append(body, $('div'));
			raw.style.fontFamily = 'var(--vscode-editor-font-family)';
			raw.style.fontSize = '11px';
			appendPatchLines(raw, diffText);
		} else {
			const empty = append(body, $('div'));
			empty.style.fontSize = '12px';
			empty.style.color = 'var(--vscode-descriptionForeground)';
			empty.textContent = 'No workspace file changes were captured for this step (empty diff).';
		}

		head.addEventListener('click', () => {
			const next = bubble.getAttribute(expandedAttr) !== '1';
			bubble.setAttribute(expandedAttr, next ? '1' : '0');
			body.style.maxHeight = next ? 'min(480px, 65vh)' : 'min(240px, 36vh)';
			icon.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.setAttribute(expandedAttr, expanded ? '1' : '0');
		return shell;
	}

	private renderDiffFileBadge(relPath: string): HTMLElement {
		const base = relPath.split(/[/\\]/).pop() ?? relPath;
		const ext = (base.includes('.') ? base.split('.').pop() : '')?.toLowerCase() ?? '';
		let label = 'FILE';
		let bg = '#6b7280';
		let darkText = false;
		if (ext === 'ts' || ext === 'tsx') {
			label = 'TS';
			bg = '#3178c6';
		} else if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') {
			label = 'JS';
			bg = '#f7df1e';
			darkText = true;
		} else if (ext === 'py') {
			label = 'PY';
			bg = '#3776ab';
		} else if (ext === 'css' || ext === 'scss' || ext === 'less') {
			label = ext.slice(0, 3).toUpperCase();
			bg = '#563d7c';
		} else if (ext === 'json') {
			label = '{}';
			bg = '#cbcb41';
			darkText = true;
		} else if (ext === 'md') {
			label = 'MD';
			bg = '#083fa1';
		} else if (ext) {
			label = ext.length <= 4 ? ext.toUpperCase() : ext.slice(0, 4).toUpperCase();
		}
		const badge = $('span.him-diff-file-badge') as HTMLElement;
		badge.textContent = label;
		badge.style.fontSize = '9px';
		badge.style.fontWeight = '700';
		badge.style.padding = '2px 5px';
		badge.style.borderRadius = '4px';
		badge.style.color = darkText ? '#111' : '#fff';
		badge.style.background = bg;
		badge.style.flexShrink = '0';
		return badge;
	}

	/** Extract `b/` path from the first line of a git diff block. */
	private parseDiffGitLineBPath(firstLine: string): string | undefined {
		if (!firstLine.startsWith('diff --git ')) {
			return undefined;
		}
		const rest = firstLine.slice('diff --git '.length).trim();
		const quoted = rest.match(/^"a\/(.+)"\s+"b\/(.+)"$/);
		if (quoted) {
			return quoted[2].replace(/\\"/g, '"');
		}
		const plain = rest.match(/^a\/(.+?)\s+b\/(.+)$/);
		if (plain) {
			return plain[2];
		}
		return undefined;
	}

	private parseGitDiffByFile(diffText: string): ParsedDiffFile[] {
		const raw = this.sanitizeGitDiffText(diffText);
		if (!raw) {
			return [];
		}
		const chunks = raw.split(/\n(?=diff --git )/);
		const out: ParsedDiffFile[] = [];
		for (const chunk of chunks) {
			const t = chunk.trim();
			if (!t) {
				continue;
			}
			const first = t.split('\n')[0];
			const path = this.parseDiffGitLineBPath(first);
			if (!path) {
				continue;
			}
			const lines = t.split('\n');
			let add = 0;
			let del = 0;
			for (const line of lines) {
				if (line.startsWith('+') && !line.startsWith('+++')) {
					add++;
				}
				if (line.startsWith('-') && !line.startsWith('---')) {
					del++;
				}
			}
			out.push({ path, added: add, removed: del, patch: t });
		}
		return out;
	}

	private async openFileDiffAgainstHead(relPath: string): Promise<void> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) { return; }
		const fileUri = URI.joinPath(folder.uri, relPath);
		const safeRel = relPath.replace(/(["\\$`])/g, '\\$1');
		try {
			const { stdout } = await this.runShellCommand(
				HIM_INTERNAL_SHELL_SESSION_ID,
				`git show HEAD:"${safeRel}"`,
				folder.uri.fsPath,
				CancellationToken.None,
				() => { /* silent */ },
			);
			const baseDir = URI.joinPath(this.getHimHostDataRoot(), 'diff-base');
			await this.fileService.createFolder(baseDir);
			const baseFile = URI.joinPath(baseDir, relPath.replace(/[\/\\:]/g, '__'));
			await this.fileService.writeFile(baseFile, VSBuffer.fromString(stdout || ''));
			await this.commandService.executeCommand('vscode.diff', baseFile, fileUri, `HEAD ↔ ${relPath}`);
		} catch {
			await this.commandService.executeCommand('vscode.open', fileUri);
		}
	}

	private renderStreamPythonShell(bubble: HTMLElement, blockIndex: number, code: string, complete: boolean, renderedItems: IDisposable[]): HTMLElement {
		const wrap = $('div.him-stream-python-shell');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)';
		wrap.style.width = '100%';
		wrap.style.boxSizing = 'border-box';

		const pyAttr = `data-him-py-expanded-${blockIndex}`;
		const expanded = bubble.getAttribute(pyAttr) === '1';

		const head = append(wrap, $('button.him-stream-python-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.justifyContent = 'space-between';
		head.style.padding = '6px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const ic = append(head, $('span')) as HTMLElement;
		ic.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		ic.style.opacity = '0.85';
		const lab = append(head, $('span'));
		lab.textContent = `Action · ${blockIndex + 1}${complete ? '' : ' …'}`;
		lab.style.flex = '1';
		lab.style.textAlign = 'left';

		const body = append(wrap, $('div.him-stream-python-body')) as HTMLElement;
		body.style.padding = '8px 10px';
		body.style.maxHeight = expanded ? 'min(280px, 42vh)' : '96px';
		body.style.overflowY = 'auto';
		body.style.overflowX = 'hidden';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.width = '100%';
		body.style.boxSizing = 'border-box';
		this.renderReadOnlyCodeEditor(body, code, 'python', renderedItems, 3, expanded ? 22 : 6);
		requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });

		head.addEventListener('click', () => {
			const next = bubble.getAttribute(pyAttr) !== '1';
			bubble.setAttribute(pyAttr, next ? '1' : '0');
			body.style.maxHeight = next ? 'min(280px, 42vh)' : '96px';
			ic.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.setAttribute(pyAttr, expanded ? '1' : '0');

		return wrap;
	}

	private renderStreamShellBlock(bubble: HTMLElement, blockIndex: number, command: string, complete: boolean, renderedItems: IDisposable[]): HTMLElement {
		const wrap = $('div.him-stream-shell-block');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-terminal-background, var(--vscode-editor-background)) 88%, transparent)';
		wrap.style.width = '100%';
		wrap.style.boxSizing = 'border-box';

		const shAttr = `data-him-sh-expanded-${blockIndex}`;
		const expanded = bubble.getAttribute(shAttr) === '1';

		const head = append(wrap, $('button.him-stream-shell-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '6px';
		head.style.padding = '6px 10px';
		head.style.border = '0';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.cursor = 'pointer';

		const ic = append(head, $('span')) as HTMLElement;
		ic.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		ic.style.opacity = '0.85';
		const termIcon = append(head, $('span')) as HTMLElement;
		termIcon.className = 'codicon codicon-terminal';
		termIcon.style.opacity = '0.7';
		const lab = append(head, $('span'));
		const cmdPreview = command.trim().split('\n')[0] || 'Shell';
		lab.textContent = cmdPreview.length > 60 ? cmdPreview.slice(0, 60) + '…' : cmdPreview;
		lab.style.flex = '1';
		lab.style.textAlign = 'left';
		lab.style.fontFamily = 'var(--vscode-editor-font-family)';

		const actions = append(head, $('span.him-shell-actions')) as HTMLElement;
		actions.style.display = 'flex';
		actions.style.gap = '6px';
		actions.style.alignItems = 'center';

		const openTermBtn = append(actions, $('span.codicon.codicon-terminal-view-icon')) as HTMLElement;
		openTermBtn.style.cursor = 'pointer';
		openTermBtn.style.opacity = '0.65';
		openTermBtn.title = 'Open in Terminal';
		openTermBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.commandService.executeCommand('workbench.action.terminal.new').then(() => {
				this.commandService.executeCommand('workbench.action.terminal.sendSequence', { text: command.trim() });
			});
		});

		const body = append(wrap, $('div.him-stream-shell-body')) as HTMLElement;
		body.style.padding = '6px 10px';
		body.style.maxHeight = expanded ? '300px' : '24px';
		body.style.overflowY = 'auto';
		body.style.overflowX = 'hidden';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.transition = 'max-height 0.15s ease';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.fontSize = '12px';
		body.style.whiteSpace = 'pre-wrap';
		body.style.color = 'var(--vscode-terminal-foreground, var(--vscode-editor-foreground))';
		body.textContent = command.trim();

		head.addEventListener('click', () => {
			const next = bubble.getAttribute(shAttr) !== '1';
			bubble.setAttribute(shAttr, next ? '1' : '0');
			body.style.maxHeight = next ? '300px' : '24px';
			ic.className = next ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
		bubble.setAttribute(shAttr, expanded ? '1' : '0');

		renderedItems.push({ dispose: () => { } });
		return wrap;
	}

	private renderFinalPythonShell(blockIndex: number, code: string, complete: boolean, renderedItems: IDisposable[]): HTMLElement {
		const wrap = $('div.him-stream-python-shell');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)';

		let expanded = false;
		const head = append(wrap, $('button.him-stream-python-head-static')) as HTMLButtonElement;
		head.type = 'button';
		head.style.width = '100%';
		head.style.border = '0';
		head.style.cursor = 'pointer';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '6px';
		head.style.padding = '6px 10px';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		const toggle = append(head, $('span')) as HTMLElement;
		toggle.className = 'codicon codicon-chevron-right';
		toggle.style.opacity = '0.85';
		const label = append(head, $('span'));
		label.textContent = `Action · ${blockIndex + 1}${complete ? '' : ' …'}`;
		label.style.flex = '1';
		label.style.textAlign = 'left';

		const body = append(wrap, $('div'));
		body.style.padding = '8px 10px';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		this.renderReadOnlyCodeEditor(body, code, 'python', renderedItems, 4, 22);
		body.style.display = 'none';

		head.addEventListener('click', () => {
			expanded = !expanded;
			body.style.display = expanded ? 'block' : 'none';
			toggle.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});

		return wrap;
	}

	private renderFinalShellBlock(blockIndex: number, command: string, _complete: boolean, renderedItems: IDisposable[]): HTMLElement {
		const wrap = $('div.him-final-shell-block');
		wrap.style.border = '1px solid var(--vscode-widget-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.overflow = 'hidden';
		wrap.style.background = 'color-mix(in srgb, var(--vscode-terminal-background, var(--vscode-editor-background)) 88%, transparent)';

		let expanded = false;
		const head = append(wrap, $('button.him-final-shell-head')) as HTMLButtonElement;
		head.type = 'button';
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '6px';
		head.style.padding = '6px 10px';
		head.style.fontSize = '11px';
		head.style.fontWeight = '600';
		head.style.color = 'var(--vscode-descriptionForeground)';
		head.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 72%, transparent)';
		head.style.width = '100%';
		head.style.border = '0';
		head.style.cursor = 'pointer';

		const toggle = append(head, $('span')) as HTMLElement;
		toggle.className = 'codicon codicon-chevron-right';
		toggle.style.opacity = '0.85';
		const termIcon = append(head, $('span.codicon.codicon-terminal'));
		termIcon.style.opacity = '0.7';
		const cmdPreview = command.trim().split('\n')[0] || 'Shell';
		const lab = append(head, $('span'));
		lab.textContent = cmdPreview.length > 60 ? cmdPreview.slice(0, 60) + '…' : cmdPreview;
		lab.style.flex = '1';
		lab.style.fontFamily = 'var(--vscode-editor-font-family)';

		const body = append(wrap, $('div'));
		body.style.padding = '6px 10px';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.fontFamily = 'var(--vscode-editor-font-family)';
		body.style.fontSize = '12px';
		body.style.whiteSpace = 'pre-wrap';
		body.style.color = 'var(--vscode-terminal-foreground, var(--vscode-editor-foreground))';
		body.style.maxHeight = '150px';
		body.style.overflowY = 'auto';
		body.textContent = command.trim();
		body.style.display = 'none';

		head.addEventListener('click', () => {
			expanded = !expanded;
			body.style.display = expanded ? 'block' : 'none';
			toggle.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});

		renderedItems.push({ dispose: () => { } });
		return wrap;
	}

	private renderReadOnlyCodeEditor(
		container: HTMLElement,
		code: string,
		languageId: string,
		renderedItems: IDisposable[],
		minLines: number,
		maxLines: number,
	): void {
		const editorHost = append(container, $('div.him-code-editor-host'));
		editorHost.style.width = '100%';
		editorHost.style.border = '1px solid var(--vscode-widget-border)';
		editorHost.style.borderRadius = '6px';
		editorHost.style.overflow = 'hidden';
		editorHost.style.background = 'var(--vscode-editor-background)';
		const language = this.languageService.createById(languageId);
		const model = this.modelService.createModel(
			code || '',
			language,
			URI.parse(`inmemory://him-code/python-${this.pythonEditorCounter++}.${languageId}`),
			true,
		);
		const editor = this.instantiationService.createInstance(
			CodeEditorWidget,
			editorHost,
			{
				readOnly: true,
				domReadOnly: true,
				wordWrap: 'on',
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				lineNumbers: 'on',
				folding: false,
				renderLineHighlight: 'none',
				glyphMargin: false,
				overviewRulerLanes: 0,
			},
			{ isSimpleWidget: true },
		);
		editor.setModel(model);
		const lineHeight = 18;
		const totalLines = Math.max(1, model.getLineCount());
		const lineCount = Math.max(minLines, Math.min(maxLines, totalLines));
		const height = lineCount * lineHeight + 14;
		editorHost.style.height = `${height}px`;
		const relayout = () => editor.layout({ width: Math.max(80, editorHost.clientWidth), height });
		requestAnimationFrame(() => {
			relayout();
			editor.revealLine(totalLines);
		});
		const observer = new ResizeObserver(() => relayout());
		observer.observe(editorHost);
		renderedItems.push({
			dispose: () => {
				observer.disconnect();
				editor.dispose();
				model.dispose();
			}
		});
	}

	private removeStreamingParts(bubble: HTMLElement): void {
		bubble.querySelector('.him-stream-thought')?.remove();
		bubble.querySelector('.him-stream-answer')?.remove();
		bubble.querySelector('.him-stream-state')?.remove();
		bubble.querySelector('.him-stream-lock')?.remove();
		bubble.querySelector('.him-python-exec-stack')?.remove();
		bubble.querySelector('.him-chat-plan-stream-strip')?.remove();
	}

	private ensurePythonExecStack(bubble: HTMLElement): HTMLElement {
		let stack = bubble.querySelector('.him-python-exec-stack') as HTMLElement | null;
		if (!stack) {
			stack = append(bubble, $('.him-python-exec-stack'));
			stack.style.display = 'flex';
			stack.style.flexDirection = 'column';
			stack.style.gap = '8px';
			stack.style.marginTop = '8px';
			stack.style.borderTop = '1px solid var(--vscode-widget-border)';
			stack.style.paddingTop = '8px';
		}
		return stack;
	}

	private async executePythonFenceBlock(ctx: HimAgentRunContext, code: string, bubble: HTMLElement, token: CancellationToken, blockIndex: number): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		let slot = bubble.querySelector(`.him-python-exec-slot[data-block-index="${blockIndex}"]`) as HTMLElement | null;
		if (!slot) {
			await new Promise<void>(r => requestAnimationFrame(() => r()));
			slot = bubble.querySelector(`.him-python-exec-slot[data-block-index="${blockIndex}"]`) as HTMLElement | null;
		}
		const target = slot ?? this.ensurePythonExecStack(bubble);

		const run = append(target, $('div.him-python-run'));
		run.style.display = 'flex';
		run.style.flexDirection = 'column';
		run.style.gap = '4px';

		const pre = append(run, $('div.him-python-output')) as HTMLElement;
		pre.style.whiteSpace = 'pre-wrap';
		pre.style.fontSize = '13px';
		pre.style.lineHeight = '1.35';
		pre.style.wordBreak = 'break-word';
		pre.style.color = 'var(--vscode-editor-foreground)';
		pre.style.margin = '0';
		pre.style.padding = '0';

		try {
			let output = '';
			let hadError = false;
			try {
				const res = await this.himPythonReplService.runBlock(
					code,
					chunk => {
						pre.textContent = chunk;
						this.scrollMessageListContaining(bubble);
					},
					token,
					ctx.sessionId,
				);
				output = res.output;
				hadError = res.hadError;
			} catch (innerErr) {
				const msg = this.toErrorMessage(innerErr);
				// Fallback path: when renderer cannot resolve node builtin module `child_process`,
				// execute Python block via shell so agent can keep working.
				if (/child_process|module specifier/i.test(msg)) {
					const fallback = await this.runPythonBlockViaShell(ctx.sessionId, code, token, text => {
						pre.textContent = text;
						this.scrollMessageListContaining(bubble);
					});
					output = fallback.output;
					hadError = fallback.hadError;
				} else {
					throw innerErr;
				}
			}
			pre.textContent = output || '';
			if (hadError) {
				pre.style.color = 'var(--vscode-errorForeground)';
				const hint = append(run, $('div.him-python-stderr-hint'));
				hint.style.fontSize = '10px';
				hint.style.color = 'var(--vscode-errorForeground)';
				hint.textContent = 'Possible runtime error detected (PTY may merge stderr into stdout).';
			}
			const workspaceDiff = await this.captureWorkspaceDiffForDisplay(ctx.sessionId, token);
			ctx.pendingPythonExecs.push({ blockIndex, code, output: output || '', hadError, workspaceDiff });
			this.scheduleRefreshWorkspaceFileChangesSummary();
			this.markPythonNotifyIfBackground(ctx.sessionId);
		} catch (err) {
			const msg = this.toErrorMessage(err);
			pre.textContent = msg;
			pre.style.color = 'var(--vscode-errorForeground)';
			const workspaceDiff = await this.captureWorkspaceDiffForDisplay(ctx.sessionId, token);
			ctx.pendingPythonExecs.push({ blockIndex, code, output: msg, hadError: true, workspaceDiff });
			this.scheduleRefreshWorkspaceFileChangesSummary();
			this.markPythonNotifyIfBackground(ctx.sessionId);
		}
	}

	private async runPythonBlockViaShell(
		sessionId: string,
		code: string,
		token: CancellationToken,
		onChunk: (text: string) => void,
	): Promise<{ output: string; hadError: boolean }> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			throw new Error('No workspace folder available for Python fallback.');
		}
		// Avoid heredoc for fallback path: heredoc in PTY can get stuck in `heredoc>` when users/scripts
		// contain EOF-like markers or malformed quotes. Use temp file execution instead.
		const tmpName = `him_py_fallback_${Date.now()}_${Math.random().toString(16).slice(2)}.py`;
		const hostTmp = URI.joinPath(this.getHimHostDataRoot(), 'tmp');
		const tmpUri = URI.joinPath(hostTmp, tmpName);
		await this.fileService.createFolder(hostTmp);
		await this.fileService.writeFile(tmpUri, VSBuffer.fromString(code));
		const escapedPath = tmpUri.fsPath.replace(/(["\\$`])/g, '\\$1');
		const command = `python3 "${escapedPath}"`;
		const { stdout, stderr, exitCode } = await this.runShellCommand(sessionId, command, folder.uri.fsPath, token, onChunk);
		const merged = [stdout, stderr].filter(Boolean).join('\n').trim();
		const hadError = exitCode !== 0 || /Traceback|SyntaxError|IndentationError|NameError|ModuleNotFoundError/i.test(merged);
		try {
			await this.fileService.del(tmpUri);
		} catch {
			// ignore cleanup errors
		}
		return { output: merged, hadError };
	}

	private markPythonNotifyIfBackground(sessionId: string): void {
		const activeId = this.sessions[this.activeSessionIdx]?.id;
		if (sessionId === activeId) {
			return;
		}
		const s = this.sessions.find(x => x.id === sessionId);
		if (s) {
			s.pythonNotify = true;
			this.renderTabBar();
			this.persistWorkspaceSessions();
		}
	}

	private async executeShellCommand(ctx: HimAgentRunContext, command: string, bubble: HTMLElement, token: CancellationToken, blockIndex: number): Promise<void> {
		const cmd = command.trim();
		if (!cmd) { return; }

		let slot = bubble.querySelector(`.him-shell-exec-slot[data-shell-index="${blockIndex}"]`) as HTMLElement | null;
		if (!slot) {
			await new Promise<void>(r => requestAnimationFrame(() => r()));
			slot = bubble.querySelector(`.him-shell-exec-slot[data-shell-index="${blockIndex}"]`) as HTMLElement | null;
		}
		const target = slot ?? this.ensurePythonExecStack(bubble);

		const pre = append(target, $('div.him-shell-output')) as HTMLElement;
		pre.style.whiteSpace = 'pre-wrap';
		pre.style.fontSize = '12px';
		pre.style.lineHeight = '1.35';
		pre.style.wordBreak = 'break-word';
		pre.style.fontFamily = 'var(--vscode-editor-font-family)';
		pre.style.color = 'var(--vscode-editor-foreground)';
		pre.style.background = 'var(--vscode-terminal-background, var(--vscode-editor-background))';
		pre.style.padding = '6px 8px';
		pre.style.borderRadius = '4px';
		pre.style.maxHeight = '300px';
		pre.style.overflowY = 'auto';
		pre.textContent = '⏳ Running...';

		// Fast-path: heredoc+cat/tee redirection to a file.
		// This is intended only for "write a big text file" patterns (not for long-running installs).
		// You can disable it via `himCode.chat.shellHeredocFastPath=false` if you prefer pure terminal behavior.
		const heredocFastPathEnabled = this.configurationService.getValue<boolean>(`${CONFIG_ROOT}.shellHeredocFastPath`) ?? true;
		const heredocMatch = heredocFastPathEnabled
			? cmd.match(/(?:^|\r?\n)\s*(?:cat|tee)\s*>\s*(['"]?)([^'"\s;]+)\1\s*<<\s*(['"]?)([A-Za-z0-9_]+)\3\s*\n([\s\S]*?)\n\s*\4\s*;?/m)
			: null;
		if (heredocMatch) {
			const filePathRaw = heredocMatch[2];
			const content = heredocMatch[5] ?? '';
			try {
				const folder = this.workspaceContextService.getWorkspace().folders[0];
				if (!folder) {
					throw new Error('Open a folder workspace so HIM Code can write files.');
				}

				const targetUri = filePathRaw.startsWith('/')
					? URI.file(filePathRaw)
					: URI.joinPath(folder.uri, ...filePathRaw.split('/'));

				const parentFsPath = filePathRaw.startsWith('/')
					? (filePathRaw.split('/').slice(0, -1).join('/') || '/')
					: filePathRaw.split('/').slice(0, -1).join('/');

				const dirUri = parentFsPath && parentFsPath !== '.'
					? (filePathRaw.startsWith('/') ? URI.file(parentFsPath) : URI.joinPath(folder.uri, ...parentFsPath.split('/').filter(Boolean)))
					: folder.uri;

				if (dirUri) {
					await this.fileService.createFolder(dirUri);
				}

				await this.fileService.writeFile(targetUri, VSBuffer.fromString(content), { atomic: false });
				const shortCmd = cmd.length > 500 ? cmd.slice(0, 500) + '…(truncated)' : cmd;
				const output = `✅ Wrote file via heredoc: ${filePathRaw} (${content.length} chars)`;
				pre.textContent = output;
				ctx.pendingShellExecs.push({ blockIndex, command: shortCmd, output, exitCode: 0 });
				return;
			} catch {
				// If heredoc parsing fails, fall back to terminal execution.
			}
		}

		try {
			const folder = this.workspaceContextService.getWorkspace().folders[0];
			const cwd = folder?.uri.fsPath ?? process.cwd?.() ?? '/';
			const maxLines = this.getShellOutputMaxLines();
			const { stdout, stderr, exitCode } = await this.runShellCommand(ctx.sessionId, cmd, cwd, token, chunk => {
				pre.textContent = this.tailLines(chunk, maxLines);
				this.scrollMessageListContaining(bubble);
			});
			const outputRaw = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
			const output = this.tailLines(outputRaw, maxLines);
			pre.textContent = output || '(no output)';
			if (exitCode !== 0) {
				pre.style.color = 'var(--vscode-errorForeground)';
			}
			const skipScan = this.shellCommandSkipsPostToolWorkspaceScan(cmd);
			const workspaceDiff = skipScan ? undefined : await this.captureWorkspaceDiffForDisplay(ctx.sessionId, token);
			ctx.pendingShellExecs.push({ blockIndex, command: cmd, output: output || '', exitCode, workspaceDiff });
			if (!skipScan) {
				this.scheduleRefreshWorkspaceFileChangesSummary();
			}
		} catch (err) {
			const msg = this.toErrorMessage(err);
			pre.textContent = msg;
			pre.style.color = 'var(--vscode-errorForeground)';
			const skipScan = this.shellCommandSkipsPostToolWorkspaceScan(cmd);
			const workspaceDiff = skipScan ? undefined : await this.captureWorkspaceDiffForDisplay(ctx.sessionId, token);
			ctx.pendingShellExecs.push({ blockIndex, command: cmd, output: msg, exitCode: -1, workspaceDiff });
			if (!skipScan) {
				this.scheduleRefreshWorkspaceFileChangesSummary();
			}
		}
	}

	private async executeWebSearch(ctx: HimAgentRunContext, queryRaw: string, bubble: HTMLElement, token: CancellationToken, blockIndex: number): Promise<void> {
		const queryTrimmed = queryRaw.trim();
		const lowered = queryTrimmed.toLowerCase();
		const wantsGoogle = lowered.startsWith('google:') || lowered.startsWith('google ');
		const wantsWhitelist = lowered.startsWith('whitelist:') || lowered.startsWith('whitelist ');
		const wantsWeb = lowered.startsWith('web:') || lowered.startsWith('web ');
		const query = wantsGoogle ? queryTrimmed.replace(/^google[:\s]+/i, '').trim()
			: wantsWhitelist ? queryTrimmed.replace(/^whitelist[:\s]+/i, '').trim()
				: wantsWeb ? queryTrimmed.replace(/^web[:\s]+/i, '').trim()
				: queryTrimmed;
		if (!query) { return; }
		const defaultProvider = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.search.defaultProvider`) ?? 'auto').trim();
		const askToBroaden = this.configurationService.getValue<boolean>(`${CONFIG_ROOT}.search.askToBroaden`) ?? true;
		const maxLines = Math.max(5, Math.min(400, this.configurationService.getValue<number>(`${CONFIG_ROOT}.search.maxOutputLines`) ?? 60));

		const setExec = (output: string) => {
			ctx.pendingSearchExecs = ctx.pendingSearchExecs.filter(e => e.blockIndex !== blockIndex);
			ctx.pendingSearchExecs.push({ blockIndex, query: queryTrimmed, output });
		};
		const headLines = (text: string, max: number) => text.split('\n').slice(0, max).join('\n');
		if (this.isSearchCircuitOpen(ctx.sessionId)) {
			const until = this.searchCircuitBySessionId.get(ctx.sessionId)?.openUntilMs ?? Date.now();
			const waitSec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
			setExec(`Search temporarily disabled due to repeated failures. Retry in ${waitSec}s.`);
			return;
		}
		const callSearchProvider = async (provider: 'whitelist' | 'google' | 'web'): Promise<string> => {
			const result = await this.commandService.executeCommand<{ ok: boolean; output: string } | undefined>(
				'himChat.searchWeb',
				{ query, provider },
			);
			if (!result?.ok) {
				throw new Error(result?.output || 'Search command failed.');
			}
			return String(result?.output ?? '');
		};

		try {
			const autoProvider = this.detectAutoSearchProvider(query);

			// Provider decision: user directive > setting.
			if (wantsGoogle || defaultProvider === 'google') {
				const out = await callSearchProvider('google');
				setExec(headLines(out, maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}
			if (wantsWeb || defaultProvider === 'web') {
				const out = await callSearchProvider('web');
				setExec(headLines(out || 'Open web search returned no results.', maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}
			if (wantsWhitelist || defaultProvider === 'whitelist') {
				const out = await callSearchProvider('whitelist');
				setExec(headLines(out || 'No whitelist results.', maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}

			// auto: task-aware routing (code/engineering -> whitelist, open-web -> web).
			if (autoProvider === 'web') {
				const webOut = await callSearchProvider('web');
				if (webOut) {
					setExec(headLines(webOut, maxLines));
					this.markSearchSuccess(ctx.sessionId);
					return;
				}
				// fallback for reliability
				const wlFallback = await callSearchProvider('whitelist');
				setExec(headLines(wlFallback || 'No results from open web or whitelist search.', maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}

			// code/engineering default path
			const wlOut = await callSearchProvider('whitelist');
			if (wlOut) {
				setExec(headLines(wlOut, maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}
			// Ask user for permission to broaden.
			if (!askToBroaden) {
				// try open-web once before giving up
				const webOut = await callSearchProvider('web');
				setExec(headLines(webOut || 'No whitelist results. Search stopped (askToBroaden=false).', maxLines));
				return;
			}

			const picked = await this.quickInputService.pick(
				[
					{ id: 'whitelist', label: 'Keep whitelist only', description: 'Do not broaden search scope' },
					{ id: 'web', label: 'Allow Open Web', description: 'Try direct/open web search (best-effort)' },
					{ id: 'google', label: 'Allow Google (CSE)', description: 'Use configured Google Custom Search API' },
					{ id: 'cancel', label: 'Cancel', description: 'Stop searching' },
				],
				{ title: 'Broaden web search?', placeHolder: 'No whitelist results. Allow broader search?', ignoreFocusLost: true }
			);

			if (!picked || picked.id === 'cancel' || picked.id === 'whitelist') {
				const output = 'No whitelist results. Search cancelled.';
				setExec(headLines(output, maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}
			if (picked.id === 'web') {
				const output = await callSearchProvider('web');
				setExec(headLines(output, maxLines));
				this.markSearchSuccess(ctx.sessionId);
				return;
			}

			const output = await callSearchProvider('google');
			setExec(headLines(output, maxLines));
			this.markSearchSuccess(ctx.sessionId);
		} catch (err) {
			const msg = this.toErrorMessage(err);
			setExec(headLines(msg, maxLines));
			this.markSearchFailure(ctx.sessionId);
		}
	}

	private enqueueSearchExecution(sessionId: string, task: () => Promise<void>): Promise<void> {
		const prev = this.searchExecChainBySessionId.get(sessionId) ?? Promise.resolve();
		const next = prev
			.catch(() => undefined)
			.then(task);
		const settle = next.finally(() => {
			if (this.searchExecChainBySessionId.get(sessionId) === settle) {
				this.searchExecChainBySessionId.delete(sessionId);
			}
		});
		this.searchExecChainBySessionId.set(sessionId, settle);
		return settle;
	}

	private isSearchCircuitOpen(sessionId: string): boolean {
		const st = this.searchCircuitBySessionId.get(sessionId);
		return Boolean(st && st.openUntilMs > Date.now());
	}

	private markSearchSuccess(sessionId: string): void {
		this.searchCircuitBySessionId.delete(sessionId);
	}

	private markSearchFailure(sessionId: string): void {
		const now = Date.now();
		const windowMs = 60_000;
		const openMs = 90_000;
		const threshold = 3;
		const prev = this.searchCircuitBySessionId.get(sessionId);
		const inWindow = prev && (now - prev.windowStartMs) <= windowMs;
		const failures = inWindow ? (prev!.failures + 1) : 1;
		const windowStartMs = inWindow ? prev!.windowStartMs : now;
		const openUntilMs = failures >= threshold ? (now + openMs) : 0;
		this.searchCircuitBySessionId.set(sessionId, { failures, windowStartMs, openUntilMs });
	}

	/**
	 * Drop terminal/scrollback junk before the first unified diff header (e.g. `}diff --git` when JSON
	 * and git output were concatenated without a newline, or PTY noise). Git output always contains `diff --git `.
	 */
	private sanitizeGitDiffText(raw: string): string {
		const s = raw.replace(/\r/g, '');
		const idx = s.search(/diff --git /);
		if (idx < 0) {
			return s.trim();
		}
		return s.slice(idx).trim();
	}

	/**
	 * Working tree vs last commit (staged + unstaged) plus untracked file previews.
	 * Plain `git diff` omits staged changes; untracked files never appear — that broke diff UX after `git add` or new files.
	 */
	private async collectGitWorkingTreeDiff(cwd: string, token: CancellationToken): Promise<string> {
		let raw = '';
		const { exitCode: headOk } = await this.runShellCommand(
			HIM_INTERNAL_SHELL_SESSION_ID,
			'git rev-parse --verify HEAD',
			cwd,
			token,
			() => { /* silent */ },
		);
		const hasHead = headOk === 0;
		if (hasHead) {
			const { stdout } = await this.runShellCommand(
				HIM_INTERNAL_SHELL_SESSION_ID,
				'git -c core.quotepath=false diff HEAD --no-color --unified=3 -- .',
				cwd,
				token,
				() => { /* silent */ },
			);
			raw += (stdout || '').replace(/\r/g, '');
		}
		const untrackedDiffScript = [
			`git -c core.quotepath=false ls-files --others --exclude-standard -- . | head -n ${MAX_GIT_UNTRACKED_FILE_DIFFS} | while IFS= read -r p || [ -n "$p" ]; do`,
			'  [ -z "$p" ] && continue',
			'  git -c core.quotepath=false diff --no-index --no-color --unified=3 -- /dev/null -- "$p" 2>/dev/null || true',
			'done',
		].join('\n');
		const { stdout: untrackedChunks } = await this.runShellCommand(
			HIM_INTERNAL_SHELL_SESSION_ID,
			untrackedDiffScript,
			cwd,
			token,
			() => { /* silent */ },
		);
		const c = (untrackedChunks || '').replace(/\r/g, '').trim();
		if (c) {
			raw += (raw && !raw.endsWith('\n') ? '\n' : '') + c;
		}
		return raw.trim();
	}

	private async captureWorkspaceDiffForDisplay(sessionId: string, token: CancellationToken): Promise<string | undefined> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		try {
			const { stdout: inside } = await this.runShellCommand(
				HIM_INTERNAL_SHELL_SESSION_ID,
				'git rev-parse --is-inside-work-tree',
				folder.uri.fsPath,
				token,
				() => { /* silent */ },
			);
			if (!/\btrue\b/i.test(inside)) {
				throw new Error('not-git');
			}
			const combined = await this.collectGitWorkingTreeDiff(folder.uri.fsPath, token);
			const text = this.sanitizeGitDiffText(combined);
			if (!text) {
				return undefined;
			}
			const lines = text.split('\n');
			const maxLines = 500;
			return lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n\n... (diff truncated)` : text;
		} catch {
			// Non-repo or git error: fall back to snapshot diff below.
		}

		const snapshot = await this.captureWorkspaceSnapshotPreview(sessionId, folder.uri.fsPath, token);
		const prev = this.workspaceSnapshotBySessionId.get(sessionId);
		this.workspaceSnapshotBySessionId.set(sessionId, snapshot);
		if (!prev) {
			return undefined;
		}
		const nonGit = this.buildSyntheticDiffFromSnapshots(prev, snapshot);
		return nonGit || undefined;
	}

	private async captureWorkspaceSnapshotPreview(sessionId: string, cwd: string, token: CancellationToken): Promise<Map<string, string>> {
		const script = [
			'import os, json',
			`root = ${JSON.stringify(cwd)}`,
			'out = {}',
			'for d, dirs, files in os.walk(root):',
			'    dirs[:] = [x for x in dirs if x not in {".git", ".him-code", "node_modules", "__pycache__"}]',
			'    for f in files:',
			'        p = os.path.join(d, f)',
			'        rel = os.path.relpath(p, root).replace("\\\\", "/")',
			'        try:',
			'            with open(p, "r", encoding="utf-8", errors="ignore") as fh:',
			'                txt = fh.read(2000)',
			'            out[rel] = txt',
			'        except Exception:',
			'            pass',
			'print(json.dumps(out, ensure_ascii=False))',
		].join('\n');
		const cmd = `python3 -c ${JSON.stringify(script)}`;
		const { stdout } = await this.runShellCommand(HIM_INTERNAL_SHELL_SESSION_ID, cmd, cwd, token, () => { /* silent */ });
		const map = new Map<string, string>();
		try {
			const obj = JSON.parse(stdout || '{}') as Record<string, string>;
			for (const [k, v] of Object.entries(obj)) {
				map.set(k, String(v ?? ''));
			}
		} catch {
			// ignore
		}
		return map;
	}

	/** Walk workspace files and record mtime+size so edits past the first 2k chars still invalidate. */
	private async captureWorkspaceFileFingerprints(cwd: string, token: CancellationToken): Promise<Map<string, string>> {
		const script = [
			'import os, json',
			`root = ${JSON.stringify(cwd)}`,
			'out = {}',
			'for d, dirs, files in os.walk(root):',
			'    dirs[:] = [x for x in dirs if x not in {".git", ".him-code", "node_modules", "__pycache__"}]',
			'    for f in files:',
			'        p = os.path.join(d, f)',
			'        rel = os.path.relpath(p, root).replace("\\\\", "/")',
			'        try:',
			'            st = os.stat(p)',
			'            mns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9))',
			'            out[rel] = f"{mns}:{st.st_size}"',
			'        except Exception:',
			'            pass',
			'print(json.dumps(out, ensure_ascii=False))',
		].join('\n');
		const cmd = `python3 -c ${JSON.stringify(script)}`;
		const { stdout } = await this.runShellCommand(HIM_INTERNAL_SHELL_SESSION_ID, cmd, cwd, token, () => { /* silent */ });
		const map = new Map<string, string>();
		try {
			const obj = JSON.parse(stdout || '{}') as Record<string, string>;
			for (const [k, v] of Object.entries(obj)) {
				map.set(k, String(v ?? ''));
			}
		} catch {
			// ignore
		}
		return map;
	}

	private buildSyntheticDiffFromSnapshots(prev: Map<string, string>, curr: Map<string, string>): string {
		const paths = new Set<string>([...prev.keys(), ...curr.keys()]);
		const blocks: string[] = [];
		for (const p of paths) {
			const a = prev.get(p);
			const b = curr.get(p);
			if (a === b) {
				continue;
			}
			blocks.push(`diff --git a/${p} b/${p}`);
			blocks.push(`--- a/${p}`);
			blocks.push(`+++ b/${p}`);
			blocks.push('@@ preview @@');
			if (typeof a === 'string' && a.length > 0) {
				for (const line of a.split('\n').slice(0, 20)) {
					blocks.push(`-${line}`);
				}
			}
			if (typeof b === 'string' && b.length > 0) {
				for (const line of b.split('\n').slice(0, 20)) {
					blocks.push(`+${line}`);
				}
			}
			blocks.push('');
			if (blocks.length > 1200) {
				break;
			}
		}
		return blocks.join('\n').trim();
	}

	private setWorkspaceFileChangesListExpanded(expanded: boolean): void {
		if (expanded && this.fileChangesBarState.fileCount <= 0) {
			return;
		}
		this.fileChangesListExpanded = expanded;
		if (this.fileChangesListElement) {
			this.fileChangesListElement.style.display = expanded ? 'block' : 'none';
		}
		if (this.fileChangesChevronSpan) {
			this.fileChangesChevronSpan.className = expanded ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		}
	}

	private styleFileChangesBarActionButton(el: HTMLButtonElement, label: string): void {
		el.type = 'button';
		el.textContent = label;
		el.style.flexShrink = '0';
		el.style.fontSize = '10px';
		el.style.padding = '2px 6px';
		el.style.borderRadius = '4px';
		el.style.border = '1px solid color-mix(in srgb, var(--vscode-widget-border) 70%, transparent)';
		el.style.background = 'transparent';
		el.style.color = 'var(--vscode-foreground)';
		el.style.cursor = 'pointer';
	}

	/** Push the file-changes card down by ~50% of its own height (below the message list). */
	private scheduleFileChangesCardVerticalOffset(): void {
		if (this.fileChangesCardOffsetRaf !== 0) {
			cancelAnimationFrame(this.fileChangesCardOffsetRaf);
		}
		this.fileChangesCardOffsetRaf = requestAnimationFrame(() => {
			this.fileChangesCardOffsetRaf = 0;
			const el = this.fileChangesOuterElement;
			if (!el) {
				return;
			}
			if (this.fileChangesBarState.fileCount <= 0) {
				el.style.marginTop = '0px';
				return;
			}
			el.style.marginTop = '0px';
			void el.offsetHeight;
			const h = el.offsetHeight;
			el.style.marginTop = h > 0 ? `${Math.round(h * 0.5)}px` : '0px';
		});
	}

	private refreshFileChangesBarActionsState(): void {
		const { isGit, hasHead, fileCount } = this.fileChangesBarState;
		const hasChanges = fileCount > 0;
		const setDisabled = (btn: HTMLButtonElement | undefined, disabled: boolean) => {
			if (!btn) {
				return;
			}
			btn.disabled = disabled;
			btn.style.opacity = disabled ? '0.45' : '1';
			btn.style.cursor = disabled ? 'default' : 'pointer';
		};
		// Undo: with HEAD → restore tracked; without HEAD (no commits yet) → git clean untracked (handled in onWorkspaceFileChangesUndoAll).
		setDisabled(this.fileChangesUndoButton, !isGit || !hasChanges);
		setDisabled(this.fileChangesKeepButton, !isGit || !hasChanges);
		setDisabled(this.fileChangesReviewButton, !hasChanges);
		if (this.fileChangesUndoButton) {
			if (!isGit) {
				this.fileChangesUndoButton.title = localize('himFileChangesUndoNoGit', 'Open a Git repository in this workspace to use Undo All.');
			} else if (!hasChanges) {
				this.fileChangesUndoButton.title = '';
			} else if (hasHead) {
				this.fileChangesUndoButton.title = localize('himFileChangesUndoTipTracked', 'Discard all tracked changes (staged and unstaged) back to the last commit. Untracked files are not removed.');
			} else {
				this.fileChangesUndoButton.title = localize('himFileChangesUndoTipNoHead', 'No commits yet: Undo All removes untracked files and folders (git clean -fd). Staged files may need SCM or terminal.');
			}
		}
		if (this.fileChangesHintElement) {
			this.fileChangesHintElement.disabled = !hasChanges;
			this.fileChangesHintElement.style.cursor = hasChanges ? 'pointer' : 'default';
			this.fileChangesHintElement.style.opacity = hasChanges ? '1' : '0.85';
		}
	}

	private async onWorkspaceFileChangesUndoAll(): Promise<void> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return;
		}
		const { isGit, hasHead, fileCount } = this.fileChangesBarState;
		if (!isGit || fileCount <= 0) {
			return;
		}
		let cmd: string;
		let message: string;
		let detail: string;
		let primary: string;
		if (hasHead) {
			cmd = 'git restore --source=HEAD --staged --worktree .';
			message = localize('himFileChangesUndoAllConfirm', 'Discard all tracked changes in the workspace? This cannot be undone from here.');
			detail = localize('himFileChangesUndoAllDetail', 'Staged and unstaged edits to tracked files will match the last commit. Untracked files and folders are not removed.');
			primary = localize('himFileChangesUndoAllPrimary', 'Discard all');
		} else {
			cmd = 'git clean -fd';
			message = localize('himFileChangesUndoNoHeadConfirm', 'Remove all untracked files and folders? This cannot be undone from here.');
			detail = localize('himFileChangesUndoNoHeadDetail', 'This repository has no commits yet. git clean -fd deletes untracked files and empty untracked directories. Files already tracked or staged are not removed by this command alone.');
			primary = localize('himFileChangesUndoNoHeadPrimary', 'Remove untracked');
		}
		const { confirmed } = await this.dialogService.confirm({
			type: Severity.Warning,
			message,
			detail,
			primaryButton: primary,
		});
		if (!confirmed) {
			return;
		}
		const { exitCode, stderr } = await this.runShellCommand(
			'file-changes-actions',
			cmd,
			folder.uri.fsPath,
			CancellationToken.None,
			() => { /* silent */ },
		);
		if (exitCode !== 0) {
			const err = (stderr || '').trim() || localize('himFileChangesGitCommandFailed', 'Git command failed.');
			await this.dialogService.info(localize('himFileChangesUndoAllFailedTitle', 'Could not discard changes'), err);
			return;
		}
		void this.refreshWorkspaceFileChangesSummary();
	}

	private async onWorkspaceFileChangesKeepAll(): Promise<void> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return;
		}
		const { isGit, fileCount } = this.fileChangesBarState;
		if (!isGit || fileCount <= 0) {
			return;
		}
		const { exitCode, stderr } = await this.runShellCommand(
			'file-changes-actions',
			'git add -A',
			folder.uri.fsPath,
			CancellationToken.None,
			() => { /* silent */ },
		);
		if (exitCode !== 0) {
			const err = (stderr || '').trim() || localize('himFileChangesGitCommandFailed', 'Git command failed.');
			await this.dialogService.info(localize('himFileChangesKeepAllFailedTitle', 'Could not stage changes'), err);
			return;
		}
		void this.refreshWorkspaceFileChangesSummary();
	}

	private updateFileChangesCountLabel(count: number): void {
		if (this.fileChangesCountLabel) {
			this.fileChangesCountLabel.textContent = count === 1 ? '1 File' : `${count} Files`;
		}
	}

	private appendFileChangeRow(parent: HTMLElement, relPath: string, added?: string, removed?: string): void {
		const row = append(parent, $('button.him-chat-file-change-row')) as HTMLButtonElement;
		row.type = 'button';
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.width = '100%';
		row.style.boxSizing = 'border-box';
		row.style.gap = '4px';
		row.style.padding = '2px 4px';
		row.style.border = '0';
		row.style.borderRadius = '3px';
		row.style.background = 'transparent';
		row.style.cursor = 'pointer';
		row.style.textAlign = 'left';
		row.style.color = 'var(--vscode-foreground)';
		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--vscode-list-hoverBackground)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});
		row.appendChild(this.renderDiffFileBadge(relPath));
		const nameEl = append(row, $('span'));
		nameEl.textContent = relPath.split(/[/\\]/).pop() ?? relPath;
		nameEl.style.flex = '1';
		nameEl.style.minWidth = '0';
		nameEl.style.overflow = 'hidden';
		nameEl.style.textOverflow = 'ellipsis';
		nameEl.style.whiteSpace = 'nowrap';
		nameEl.style.fontSize = '11px';
		const stats = append(row, $('span'));
		stats.style.display = 'flex';
		stats.style.gap = '4px';
		stats.style.flexShrink = '0';
		stats.style.fontSize = '10px';
		stats.style.fontFamily = 'var(--vscode-editor-font-family)';
		if (added !== undefined && removed !== undefined) {
			const a = append(stats, $('span'));
			a.textContent = `+${added}`;
			a.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #3fb950)';
			a.style.fontWeight = '600';
			const d = append(stats, $('span'));
			d.textContent = `-${removed}`;
			d.style.color = 'var(--vscode-gitDecoration-deletedResourceForeground, #f85149)';
			d.style.fontWeight = '600';
		} else {
			stats.textContent = '±';
			stats.style.opacity = '0.75';
		}
		row.addEventListener('click', () => {
			void this.openFileDiffAgainstHead(relPath);
		});
	}

	/** Batched untracked numstat in one shell invocation (avoids N× printf / marker spam). */
	private buildBatchUntrackedNumstatScript(maxFiles: number): string {
		return [
			`git -c core.quotepath=false ls-files --others --exclude-standard -- . | head -n ${maxFiles} | while IFS= read -r p || [ -n "$p" ]; do`,
			'  [ -z "$p" ] && continue',
			'  git -c core.quotepath=false diff --numstat --no-index /dev/null -- "$p" 2>/dev/null || true',
			'done',
		].join('\n');
	}

	private scheduleRefreshWorkspaceFileChangesSummary(): void {
		if (this.fileChangesSummaryRefreshTimer !== undefined) {
			clearTimeout(this.fileChangesSummaryRefreshTimer);
		}
		this.fileChangesSummaryRefreshTimer = setTimeout(() => {
			this.fileChangesSummaryRefreshTimer = undefined;
			void this.refreshWorkspaceFileChangesSummary();
		}, HIM_FILE_CHANGES_SUMMARY_DEBOUNCE_MS);
	}

	/** Cancel pending debounced refresh and run immediately (e.g. when a turn finishes). */
	private flushRefreshWorkspaceFileChangesSummary(): void {
		if (this.fileChangesSummaryRefreshTimer !== undefined) {
			clearTimeout(this.fileChangesSummaryRefreshTimer);
			this.fileChangesSummaryRefreshTimer = undefined;
		}
		void this.refreshWorkspaceFileChangesSummary();
	}

	/** Skip heavy git snapshot/diff after obvious read-only shell commands (e.g. `ls`, `pwd`). */
	private shellCommandSkipsPostToolWorkspaceScan(cmd: string): boolean {
		const t = cmd.trim();
		if (!t) {
			return true;
		}
		if (/^(ls|ll)\b/.test(t)) {
			return true;
		}
		if (/^pwd\b/.test(t)) {
			return true;
		}
		if (/^git\s+(status|diff|log|show|branch|rev-parse)(?:\s|$)/.test(t)) {
			return true;
		}
		return false;
	}

	/** Run one command at a time on the `changes-summary` terminal (shared across refreshes). */
	private enqueueChangesSummaryShell<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.fileChangesSummaryShellChain.then(fn, fn);
		this.fileChangesSummaryShellChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/** Parse `git diff --numstat` lines; skip malformed rows so list length matches the header count. */
	private parseGitNumstatRows(stdout: string): { added: string; removed: string; path: string }[] {
		const out: { added: string; removed: string; path: string }[] = [];
		for (const raw of (stdout || '').replace(/\r/g, '').split('\n')) {
			const line = raw.trim();
			if (!line) {
				continue;
			}
			const parts = line.split('\t');
			if (parts.length < 3) {
				continue;
			}
			let path = parts.slice(2).join('\t').trim();
			if (!path) {
				continue;
			}
			if (path.includes('=>')) {
				path = path.replace(/\{?[^{}]*\s*=>\s*([^}]+)\}?/, '$1').trim();
				if (path.startsWith('/')) {
					path = path.substring(1);
				}
			}
			out.push({ added: parts[0], removed: parts[1], path });
		}
		return out;
	}

	private async refreshWorkspaceFileChangesSummary(): Promise<void> {
		const gen = ++this.fileChangesSummaryGeneration;
		const stale = () => gen !== this.fileChangesSummaryGeneration;

		if (!this.fileChangesHintElement || !this.fileChangesListElement) {
			return;
		}
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			if (stale()) {
				return;
			}
			this.updateFileChangesCountLabel(0);
			clearNode(this.fileChangesListElement);
			this.setWorkspaceFileChangesListExpanded(false);
			this.fileChangesBarState = { isGit: false, hasHead: false, fileCount: 0 };
			this.refreshFileChangesBarActionsState();
			this.scheduleFileChangesCardVerticalOffset();
			return;
		}
		try {
			const { stdout: inside } = await this.enqueueChangesSummaryShell(() =>
				this.runShellCommand('changes-summary', 'git rev-parse --is-inside-work-tree', folder.uri.fsPath, CancellationToken.None, () => { /* silent */ }),
			);
			if (stale()) {
				return;
			}
			if (!/\btrue\b/i.test(inside)) {
				// Non-git fallback: compare file fingerprints (mtime+size), not 2k content preview — otherwise edits deep in a file never appear.
				const sid = this.sessions[this.activeSessionIdx]?.id ?? 'default';
				const snap = await this.captureWorkspaceFileFingerprints(folder.uri.fsPath, CancellationToken.None);
				if (stale()) {
					return;
				}
				const prev = this.workspaceFileFingerprintBySessionId.get(sid);
				this.workspaceFileFingerprintBySessionId.set(sid, snap);
				if (!prev) {
					if (stale()) {
						return;
					}
					this.updateFileChangesCountLabel(0);
					clearNode(this.fileChangesListElement);
					this.setWorkspaceFileChangesListExpanded(false);
					this.fileChangesBarState = { isGit: false, hasHead: false, fileCount: 0 };
					this.refreshFileChangesBarActionsState();
					this.scheduleFileChangesCardVerticalOffset();
					return;
				}
				const changed = new Set<string>();
				for (const p of new Set([...prev.keys(), ...snap.keys()])) {
					if ((prev.get(p) ?? '') !== (snap.get(p) ?? '')) {
						changed.add(p);
					}
				}
				if (stale()) {
					return;
				}
				const pathsSorted = [...changed].sort((a, b) => a.localeCompare(b));
				const listed = pathsSorted.slice(0, HIM_FILE_CHANGES_SNAPSHOT_LIST_CAP);
				this.updateFileChangesCountLabel(changed.size);
				clearNode(this.fileChangesListElement);
				this.setWorkspaceFileChangesListExpanded(false);
				for (const p of listed) {
					this.appendFileChangeRow(this.fileChangesListElement, p);
				}
				if (pathsSorted.length > listed.length) {
					const foot = append(this.fileChangesListElement, $('div.him-chat-file-changes-list-more')) as HTMLElement;
					foot.textContent = localize(
						'himFileChangesListTruncated',
						'…and {0} more not shown',
						pathsSorted.length - listed.length,
					);
					foot.style.fontSize = '10px';
					foot.style.color = 'var(--vscode-descriptionForeground)';
					foot.style.padding = '4px 6px';
					foot.style.lineHeight = '1.3';
				}
				this.fileChangesBarState = { isGit: false, hasHead: false, fileCount: changed.size };
				this.refreshFileChangesBarActionsState();
				this.scheduleFileChangesCardVerticalOffset();
				return;
			}
			const { exitCode: headOk } = await this.enqueueChangesSummaryShell(() =>
				this.runShellCommand('changes-summary', 'git rev-parse --verify HEAD', folder.uri.fsPath, CancellationToken.None, () => { /* silent */ }),
			);
			if (stale()) {
				return;
			}
			const hasHead = headOk === 0;
			let trackedRows: { added: string; removed: string; path: string }[] = [];
			if (hasHead) {
				const { stdout: nsHead } = await this.enqueueChangesSummaryShell(() =>
					this.runShellCommand('changes-summary', 'git -c core.quotepath=false diff --numstat HEAD -- .', folder.uri.fsPath, CancellationToken.None, () => { /* silent */ }),
				);
				if (stale()) {
					return;
				}
				trackedRows = this.parseGitNumstatRows(nsHead);
			}
			const { stdout: untrackedNumstat } = await this.enqueueChangesSummaryShell(() =>
				this.runShellCommand(
					'changes-summary',
					this.buildBatchUntrackedNumstatScript(MAX_UNTRACKED_PATHS_BATCH),
					folder.uri.fsPath,
					CancellationToken.None,
					() => { /* silent */ },
				),
			);
			if (stale()) {
				return;
			}
			const untrackedRows = this.parseGitNumstatRows(untrackedNumstat);
			const byPath = new Map<string, { added: string; removed: string; path: string }>();
			for (const r of trackedRows) {
				byPath.set(r.path, r);
			}
			for (const r of untrackedRows) {
				byPath.set(r.path, r);
			}
			const merged = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
			const n = merged.length;
			if (stale()) {
				return;
			}
			this.updateFileChangesCountLabel(n);
			clearNode(this.fileChangesListElement);
			this.setWorkspaceFileChangesListExpanded(false);
			for (const r of merged) {
				this.appendFileChangeRow(this.fileChangesListElement, r.path, r.added, r.removed);
			}
			this.fileChangesBarState = { isGit: true, hasHead, fileCount: n };
			this.refreshFileChangesBarActionsState();
			this.scheduleFileChangesCardVerticalOffset();
		} catch {
			if (stale()) {
				return;
			}
			this.updateFileChangesCountLabel(0);
			clearNode(this.fileChangesListElement);
			this.setWorkspaceFileChangesListExpanded(false);
			this.fileChangesBarState = { isGit: false, hasHead: false, fileCount: 0 };
			this.refreshFileChangesBarActionsState();
			this.scheduleFileChangesCardVerticalOffset();
		}
	}

	private detectAutoSearchProvider(query: string): 'whitelist' | 'web' {
		const q = query.toLowerCase();
		if (/https?:\/\/|v2ex|x\.com|twitter|reddit|hacker\s*news|news|blog|forum|bing|duckduckgo/i.test(q)) {
			return 'web';
		}

		const codeKeywords = [
			'function', 'class', 'import', 'module', 'stacktrace', 'typescript', 'javascript', 'python',
			'java', 'golang', 'rust', 'c++', 'api', 'endpoint', 'repo', 'git', 'build', 'compile', 'test',
			'bug', 'fix', 'src/', 'package.json', 'tsconfig', 'npm', 'yarn', 'pnpm', 'monorepo', 'linter',
			'代码', '工程', '项目', '函数', '接口', '报错', '编译', '构建', '测试', '仓库'
		];
		const webKeywords = [
			'article', 'post', 'tweet', 'status', 'headline', 'announcement', 'release notes', 'discussion',
			'新闻', '帖子', '博文', '论坛', '社区', '网页', '官网', '谁说了', '观点'
		];

		let codeScore = 0;
		let webScore = 0;
		for (const k of codeKeywords) {
			if (q.includes(k)) { codeScore += 1; }
		}
		for (const k of webKeywords) {
			if (q.includes(k)) { webScore += 1; }
		}

		// Prefer precise engineering sources when code signal is similar or stronger.
		return webScore > codeScore ? 'web' : 'whitelist';
	}

	private runShellCommand(
		sessionId: string,
		cmd: string,
		cwd: string,
		token: CancellationToken,
		onChunk: (text: string) => void,
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise(async (resolve, reject) => {
			if (token.isCancellationRequested) { reject(new CancellationError()); return; }

			// Running shell commands via VS Code Terminal avoids `require('child_process')` in renderer.
			// hideFromUser: no terminal tab spam / focus steal; output is still captured via onAnyInstanceData.
			let inst = this.shellTerminalBySessionId.get(sessionId);
			if (!inst) {
				inst = await this.terminalService.createTerminal({
					config: {
						name: `HIM shell · ${sessionId.slice(0, 8)}`,
						hideFromUser: true,
					},
				});
				this.shellTerminalBySessionId.set(sessionId, inst);
			}

			const doneToken = `HIM_DONE_${Math.random().toString(16).slice(2)}_${Date.now()}`;
			const escapedCwd = cwd.replace(/(["\\$`])/g, '\\$1');
			// Ensure UTF-8 to reduce "????" garbling for large file content.
			// Terminal merges stdout/stderr; we treat it as stdout for UI.
			// Important: keep DONE marker on a new command line.
			// If we append `; echo ...` on the same line, heredoc terminators (EOF-like markers)
			// are no longer alone on their line and shell will stay in `heredoc>` forever.
			// Use printf for the exit marker (not `echo`): some PTY/shell edge cases have been seen
			// where the leading `e` of `echo` was dropped, yielding `cho` and a stuck run.
			// Capture $? on the same line as printf so the marker line never starts with `printf`
			// (some PTYs drop the first character of a new line → `rintf` / `cho`).
			const printfBin = isWindows ? 'printf' : '/usr/bin/printf';
			// Non-interactive defaults: avoid `less`/`git` pagers waiting for keys ("Pattern not found (press RETURN)")
			// so the HIM completion marker can be printed and captured.
			const wrapped = [
				`export LANG=C.UTF-8 LC_ALL=C.UTF-8 PAGER=cat GIT_PAGER=cat MANPAGER=cat; cd "${escapedCwd}"`,
				cmd.replace(/\\\s*$/g, ''),
				`__him_ec=$?; ${printfBin} '\\n__${doneToken}__:%s\\n' "$__him_ec"`,
			].join('\n');

			let full = '';
			let exitCode = 0;
			let finished = false;
			let timeoutId: ReturnType<typeof setTimeout>;
			const markerRe = new RegExp(`__${doneToken}__:(-?\\d+)`);
			const cleanTerminalOutput = (raw: string): string => {
				const normalized = collapseBackspacesInline(removeAnsiEscapeCodes(raw)).replace(/\r/g, '');
				const lines = normalized.split('\n');
				const out: string[] = [];
				for (const line of lines) {
					const t = line.trim();
					if (!t) { continue; }
					if (t.startsWith('heredoc>')) { continue; }
					if (t.startsWith('export LANG=') || t.startsWith('export LC_ALL=')) { continue; }
					if (/^cd\s+"[^"]+"/.test(t)) { continue; }
					if (t.includes(`__${doneToken}__`)) { continue; }
					// zsh/bash prompts like "user@host path %"
					if (/^[^\s]+@[^\s]+ .*[%>$]$/.test(t)) { continue; }
					out.push(line);
				}
				return out.join('\n').trim();
			};

			const disposable = this.terminalService.onAnyInstanceData(e => {
				if (finished) {
					return;
				}
				if (e.instance.instanceId !== inst!.instanceId) {
					return;
				}
				const chunk = removeAnsiEscapeCodes(String(e.data ?? '')).replace(/\r/g, '');
				if (!chunk) {
					return;
				}
				full += chunk;
				// Keep capture bounded to avoid UI freeze on huge heredoc prints.
				const MAX_CAPTURE = 250_000;
				if (full.length > MAX_CAPTURE) {
					full = full.slice(-MAX_CAPTURE);
				}
				onChunk(cleanTerminalOutput(full));

				const m = markerRe.exec(full);
				if (m) {
					exitCode = Number(m[1] ?? 0);
					finished = true;
					clearTimeout(timeoutId!);
					full = full.replace(markerRe, '');
					onChunk(cleanTerminalOutput(full));
					disposable.dispose();
					cancelListener.dispose();
					resolve({ stdout: cleanTerminalOutput(full), stderr: '', exitCode });
				}
			});

			timeoutId = setTimeout(() => {
				if (!finished) {
					finished = true;
					try {
						void inst?.sendText('\x03', false);
					} catch {
						// ignore
					}
					disposable.dispose();
					cancelListener.dispose();
					reject(new Error('Terminal command timeout'));
				}
			}, 120_000);

			const cancelListener = token.onCancellationRequested(() => {
				try {
					void inst?.sendText('\x03', false);
				} catch {
					// ignore
				}
				clearTimeout(timeoutId!);
				disposable.dispose();
				reject(new CancellationError());
				cancelListener.dispose();
			});

			try {
				await inst.sendText(wrapped + '\n', true);
			} catch (e) {
				clearTimeout(timeoutId);
				disposable.dispose();
				cancelListener.dispose();
				reject(e);
			}
		});
	}

	private tightenRenderedMarkdown(root: HTMLElement): void {
		root.style.lineHeight = '1.2';
		root.style.fontSize = '12px';
		root.style.margin = '0';
		const blocks = root.querySelectorAll('p, ul, ol, pre, blockquote, h1, h2, h3, h4, h5, h6, li');
		for (const block of blocks) {
			const element = block as HTMLElement;
			element.style.marginTop = '2px';
			element.style.marginBottom = '2px';
			element.style.lineHeight = '1.2';
		}
	}

	private scrollMessagesToBottom(): void {
		const list = this.messageListElement;
		if (!list) { return; }
		const sid = this.sessions[this.activeSessionIdx]?.id;
		const autoScroll = sid ? (this.autoScrollBySessionId.get(sid) ?? true) : true;
		if (!autoScroll) {
			this.updateScrollToBottomButtonVisibility();
			return;
		}
		requestAnimationFrame(() => {
			if (!list) { return; }
			const currentSid = this.sessions[this.activeSessionIdx]?.id;
			const currentAuto = currentSid ? (this.autoScrollBySessionId.get(currentSid) ?? true) : true;
			if (!currentAuto) {
				this.updateScrollToBottomButtonVisibility();
				return;
			}
			list.scrollTop = list.scrollHeight;
			this.updateScrollToBottomButtonVisibility();
		});
	}

	/** Re-enable follow mode and scroll the active session list to the latest messages. */
	private scrollActiveChatToBottom(): void {
		if (this.leftNavMode === 'org') {
			return;
		}
		const list = this.messageListElement;
		const sid = this.sessions[this.activeSessionIdx]?.id;
		if (!list || !sid) {
			return;
		}
		this.autoScrollBySessionId.set(sid, true);
		list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
		window.setTimeout(() => this.updateScrollToBottomButtonVisibility(), 320);
	}

	private updateScrollToBottomButtonVisibility(): void {
		const btn = this.scrollToBottomButtonElement;
		if (!btn) {
			return;
		}
		if (this.leftNavMode === 'org') {
			btn.style.display = 'none';
			return;
		}
		const list = this.messageListElement;
		if (!list) {
			btn.style.display = 'none';
			return;
		}
		const gap = list.scrollHeight - list.scrollTop - list.clientHeight;
		const atBottom = gap <= this.autoScrollThresholdPx;
		const overflow = list.scrollHeight > list.clientHeight + 1;
		btn.style.display = !atBottom && overflow ? 'flex' : 'none';
	}

	/** Scroll the `.him-chat-messages` list that contains `node` (for background-tab streaming). */
	private scrollMessageListContaining(node: HTMLElement): void {
		const list = node.closest('.him-chat-messages') as HTMLElement | null;
		const target = list ?? this.messageListElement;
		if (!target) { return; }
		const pane = node.closest('.him-session-pane') as HTMLElement | null;
		const sid = pane?.dataset.sessionId;
		const autoScroll = sid ? (this.autoScrollBySessionId.get(sid) ?? true) : true;
		if (!autoScroll) { return; }
		requestAnimationFrame(() => {
			target.scrollTop = target.scrollHeight;
			const pane = target.closest('.him-session-pane') as HTMLElement | null;
			if (pane?.dataset.sessionId === this.sessions[this.activeSessionIdx]?.id) {
				this.updateScrollToBottomButtonVisibility();
			}
		});
	}

	private getShellOutputMaxLines(): number {
		const configured = this.configurationService.getValue<number>(`${CONFIG_ROOT}.shellOutputMaxLines`);
		const n = typeof configured === 'number' ? configured : DEFAULT_SHELL_OUTPUT_MAX_LINES;
		return Math.max(1, Math.min(200, Math.floor(n)));
	}

	private tailLines(text: string, maxLines: number): string {
		const normalized = text.replace(/\r/g, '');
		if (maxLines <= 0) { return ''; }
		const lines = normalized.split('\n');
		if (lines.length <= maxLines) {
			return normalized;
		}
		return lines.slice(-maxLines).join('\n');
	}

	/**
	 * Keep the streaming assistant (and its user row) under this session's `.him-chat-messages`.
	 * If the row was detached — e.g. `loadSession` rebuilt from `session.messages` without the
	 * in-flight assistant, or the view was rebuilt — updates would paint to an orphan node and the tab looks empty.
	 */
	private ensureStreamingRowsInSessionMessageList(sessionId: string, bubble: HTMLElement): void {
		const w = this.sessionPaneById.get(sessionId);
		if (!w) {
			return;
		}
		const list = w.messageList;
		if (list.contains(bubble)) {
			return;
		}
		const assistantRow = bubble.closest('.him-chat-message-row') as HTMLElement | null;
		if (!assistantRow) {
			return;
		}
		const userRow = assistantRow.previousElementSibling as HTMLElement | null;
		const userIsRow = userRow?.classList.contains('him-chat-message-row') ?? false;

		if (userIsRow) {
			if (list.contains(userRow!)) {
				if (!list.contains(assistantRow)) {
					userRow!.insertAdjacentElement('afterend', assistantRow);
				}
				return;
			}
			if (!list.contains(assistantRow)) {
				list.appendChild(userRow!);
				userRow!.insertAdjacentElement('afterend', assistantRow);
			}
			return;
		}
		if (!list.contains(assistantRow)) {
			list.appendChild(assistantRow);
		}
	}

	private renderTabBar(): void {
		if (!this.tabBarElement) { return; }
		clearNode(this.tabBarElement);
		const vertical = this.tabBarElement.dataset.orientation === 'vertical';
		for (let i = 0; i < this.sessions.length; i++) {
			const s = this.sessions[i];
			const isActive = this.leftNavMode === 'chat' && i === this.activeSessionIdx;
			const ui = this.sessionAgentUiBySessionId.get(s.id);
			let agentState: HimRenderState | 'IDLE' = ui?.state ?? 'IDLE';
			if (agentState === 'IDLE' && this.backgroundCts.has(s.id)) {
				agentState = 'READING';
			}
			const tab = append(this.tabBarElement, $('div.him-tab'));
			tab.style.display = 'flex';
			tab.style.alignItems = 'center';
			tab.style.gap = '4px';
			tab.style.padding = vertical ? '6px 10px' : '0 10px';
			if (vertical) {
				tab.style.width = '100%';
				tab.style.justifyContent = 'space-between';
				tab.classList.add('him-tab--vertical');
				if (isActive) {
					tab.classList.add('him-tab--active');
				}
			}
			tab.style.fontSize = '11px';
			tab.style.cursor = 'pointer';
			tab.style.whiteSpace = 'nowrap';
			tab.style.borderRight = vertical ? 'none' : '1px solid var(--vscode-widget-border)';
			tab.style.color = isActive ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)';
			tab.style.fontWeight = isActive ? '600' : '400';
			if (vertical) {
				tab.style.borderBottom = 'none';
				tab.style.background = this.agentTabBackgroundVertical(agentState, isActive);
			} else {
				tab.style.background = isActive ? 'var(--vscode-tab-activeBackground)' : 'transparent';
				tab.style.borderBottom = isActive ? '2px solid var(--vscode-focusBorder)' : '2px solid transparent';
			}
			if (s.pythonNotify && !isActive) { tab.classList.add('him-tab-neon'); }

			const label = append(tab, $('span'));
			const titleText = s.title.length > 18 ? s.title.slice(0, 18) + '…' : s.title;
			if (vertical) {
				tab.title = `${s.title} · ${agentState}`;
			}
			label.textContent = titleText;
			label.style.flex = '1';
			label.style.overflow = 'hidden';
			label.style.textOverflow = 'ellipsis';
			label.style.paddingRight = vertical ? '4px' : '0';

			// Hover actions: edit/delete (vertical agent list — opacity in CSS, no layout jump).
			const canDelete = vertical && this.sessions.length > 1;
			const actions = append(tab, $('div.him-agent-actions'));
			actions.classList.add('him-agent-actions');

			const editBtn = append(actions, $('button')) as HTMLButtonElement;
			editBtn.classList.add('him-agent-action-btn');
			editBtn.title = 'Edit';
			const editIcon = append(editBtn, $('span')) as HTMLElement;
			editIcon.className = 'codicon codicon-edit';
			if (!vertical) {
				editBtn.style.display = 'none';
			}
			editBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.showAgentEditModal(s.id);
			});

			const delBtn = append(actions, $('button')) as HTMLButtonElement;
			delBtn.classList.add('him-agent-action-btn');
			delBtn.title = 'Delete';
			const delIcon = append(delBtn, $('span')) as HTMLElement;
			delIcon.className = 'codicon codicon-trashcan';
			if (!vertical) {
				delBtn.style.display = 'none';
			}
			delBtn.disabled = !canDelete;
			delBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.closeTab(i);
			});

			if (vertical) {
				tab.addEventListener('mouseenter', () => tab.classList.add('him-tab--hover'));
				tab.addEventListener('mouseleave', () => tab.classList.remove('him-tab--hover'));
			} else {
				tab.addEventListener('mouseenter', () => {
					editBtn.style.display = 'inline-flex';
					if (canDelete) { delBtn.style.display = 'inline-flex'; }
				});
				tab.addEventListener('mouseleave', () => {
					editBtn.style.display = 'none';
					delBtn.style.display = 'none';
				});
			}

			const idx = i;
			tab.addEventListener('click', () => this.switchToTab(idx));
		}
	}

	private showAgentEditModal(sessionId: string): void {
		const session = this.sessions.find(s => s.id === sessionId);
		if (!session || !this.agentEditOverlay || !this.agentEditNameInput || !this.agentEditRoleInput || !this.agentEditRuleInput) {
			return;
		}
		this.agentEditSessionId = sessionId;
		this.agentEditNameInput.value = session.title ?? '';
		this.agentEditRoleInput.value = session.role ?? '';
		this.agentEditRuleInput.value = session.rule ?? '';
		this.agentEditOverlay.style.display = 'flex';
		requestAnimationFrame(() => this.agentEditNameInput?.focus());
	}

	private hideAgentEditModal(): void {
		this.agentEditSessionId = undefined;
		if (this.agentEditOverlay) {
			this.agentEditOverlay.style.display = 'none';
		}
	}

	private saveAgentEditModal(): void {
		const sessionId = this.agentEditSessionId;
		if (!sessionId) { return; }
		const session = this.sessions.find(s => s.id === sessionId);
		if (!session || !this.agentEditNameInput || !this.agentEditRoleInput || !this.agentEditRuleInput) { return; }
		const nextTitle = this.agentEditNameInput.value.trim();
		session.title = nextTitle || session.title;
		session.role = this.agentEditRoleInput.value.trim();
		session.rule = this.agentEditRuleInput.value.trim();
		this.persistWorkspaceSessions();
		this.renderTabBar();
		this.hideAgentEditModal();
	}

	/** Used by detached console to bind the same agent session / REPL pool. */
	getActiveSessionIdForDetached(): string | undefined {
		return this.sessions[this.activeSessionIdx]?.id;
	}

	getActiveSessionTitleForDetached(): string | undefined {
		return this.sessions[this.activeSessionIdx]?.title;
	}

	createNewTab(): void {
		if (this.isSending && this.requestCts) {
			const sessionId = this.sessions[this.activeSessionIdx]?.id;
			if (sessionId) {
				this.backgroundCts.set(sessionId, this.requestCts);
			}
			this.requestCts = undefined;
			this.isSending = false;
		}
		this.saveCurrentSession();
		this.leftNavMode = 'chat';
		this.selectedOrgAgentId = undefined;
		if (this.organizationDetailPane) {
			this.organizationDetailPane.style.display = 'none';
			this.organizationDetailPane.style.pointerEvents = 'none';
		}
		this.setSendingState(false);
		const newSession: ChatSession = {
			id: generateUuid(),
			title: `Chat ${this.sessions.length + 1}`,
			role: '',
			rule: '',
			messages: [],
			scrollTop: 0,
			queuedMessages: [],
			conversationSummary: '',
		};
		this.sessions.push(newSession);
		this.ensureSessionPane(newSession.id);
		this.activeSessionIdx = this.sessions.length - 1;
		this.loadSession(newSession);
		this.renderTabBar();
		this.renderOrganizationNavRows();
		this.updateComposerForOrgNavMode();
		this.persistWorkspaceSessions();
	}

	private switchToTab(idx: number): void {
		if (idx === this.activeSessionIdx && this.leftNavMode === 'chat') { return; }
		if (this.isSending && this.requestCts) {
			const sessionId = this.sessions[this.activeSessionIdx]?.id;
			if (sessionId) {
				this.backgroundCts.set(sessionId, this.requestCts);
			}
			this.requestCts = undefined;
			this.isSending = false;
		}
		this.saveCurrentSession();
		this.leftNavMode = 'chat';
		this.selectedOrgAgentId = undefined;
		this.activeSessionIdx = idx;
		this.loadSession(this.sessions[idx]);
		const newSessionId = this.sessions[idx]?.id;
		const hasBgRequest = newSessionId ? this.backgroundCts.has(newSessionId) : false;
		this.setSendingState(hasBgRequest);
		this.renderTabBar();
		this.renderOrganizationNavRows();
		this.updateComposerForOrgNavMode();
		this.persistWorkspaceSessions();
	}


	private closeTab(idx: number): void {
		if (this.sessions.length <= 1 || this.isSending) { return; }
		const victim = this.sessions[idx];
		if (victim) {
			this.himPythonReplService.disposeSession(victim.id);
			const w = this.sessionPaneById.get(victim.id);
			w?.root.remove();
			this.sessionPaneById.delete(victim.id);
		}
		this.sessions.splice(idx, 1);
		if (this.activeSessionIdx >= this.sessions.length) {
			this.activeSessionIdx = this.sessions.length - 1;
		} else if (idx < this.activeSessionIdx) {
			this.activeSessionIdx--;
		} else if (idx === this.activeSessionIdx) {
			this.activeSessionIdx = Math.min(idx, this.sessions.length - 1);
		}
		this.leftNavMode = 'chat';
		this.selectedOrgAgentId = undefined;
		if (this.organizationDetailPane) {
			this.organizationDetailPane.style.display = 'none';
			this.organizationDetailPane.style.pointerEvents = 'none';
		}
		this.loadSession(this.sessions[this.activeSessionIdx]);
		this.renderTabBar();
		this.renderOrganizationNavRows();
		this.updateComposerForOrgNavMode();
		this.persistWorkspaceSessions();
	}

	private saveCurrentSession(): void {
		const session = this.sessions[this.activeSessionIdx];
		if (!session) { return; }
		session.scrollTop = this.messageListElement?.scrollTop ?? 0;
		session.queuedMessages = this.queuedMessages.slice();
		session.conversationSummary = this.conversationSummary;
	}

	private loadSession(session: ChatSession): void {
		this.queuedMessages = session.queuedMessages.slice();
		this.conversationSummary = session.conversationSummary || '';
		session.pythonNotify = false;

		this.showSessionPane(session.id);
		this.messageListElement = this.sessionPaneById.get(session.id)?.messageList;

		const w = this.sessionPaneById.get(session.id);
		if (w && w.messageList.childElementCount === 0) {
			const streamingBubble = this.streamingPendingBubbleBySessionId.get(session.id);
			if (streamingBubble) {
				this.ensureStreamingRowsInSessionMessageList(session.id, streamingBubble);
			}
		}
		if (w && w.messageList.childElementCount === 0) {
			if (session.messages.length === 0) {
				this.messageListElement = w.messageList;
				this.renderWelcomeMessage(session);
			} else {
				this.messageListElement = w.messageList;
				for (const msg of session.messages) {
					this.appendMessage(msg);
				}
			}
		}

		requestAnimationFrame(() => {
			if (this.messageListElement) {
				this.messageListElement.scrollTop = session.scrollTop;
				const atBottom = (this.messageListElement.scrollHeight - this.messageListElement.scrollTop - this.messageListElement.clientHeight) <= this.autoScrollThresholdPx;
				this.autoScrollBySessionId.set(session.id, atBottom);
			}
			this.updateScrollToBottomButtonVisibility();
		});
		this.renderQueuedBar();
		this.hideContinueBar();
		this.scheduleMemoryMeterUpdate();
		this.updateInputLockBanner();
	}

	private renderQueuedBar(): void {
		if (!this.queuedBarElement || this.queuedMessages.length === 0) {
			this.clearQueuedBar();
			return;
		}
		this.queuedBarElement.style.display = 'flex';
		this.queuedBarElement.style.flexDirection = 'column';
		this.queuedBarElement.style.gap = '4px';
		clearNode(this.queuedBarElement);

		for (let i = 0; i < this.queuedMessages.length; i++) {
			const msg = this.queuedMessages[i];
			const row = append(this.queuedBarElement, $('div.him-queued-row'));
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '6px';
			row.style.fontSize = '12px';

			const badge = append(row, $('span'));
			badge.textContent = `#${i + 1}`;
			badge.style.color = 'var(--vscode-badge-foreground)';
			badge.style.background = 'var(--vscode-badge-background)';
			badge.style.borderRadius = '8px';
			badge.style.padding = '0 5px';
			badge.style.fontSize = '10px';
			badge.style.fontWeight = '600';

			const text = append(row, $('span'));
			const preview = msg.length > 50 ? msg.slice(0, 50) + '…' : msg;
			text.textContent = preview;
			text.style.flex = '1';
			text.style.overflow = 'hidden';
			text.style.textOverflow = 'ellipsis';
			text.style.whiteSpace = 'nowrap';

			const removeBtn = append(row, $('span.codicon.codicon-close.him-chat-icon-close-sm'));
			removeBtn.style.cursor = 'pointer';
			removeBtn.style.opacity = '0.6';
			const idx = i;
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.queuedMessages.splice(idx, 1);
				this.renderQueuedBar();
			});
		}
	}

	private clearQueuedBar(): void {
		if (this.queuedBarElement) {
			this.queuedBarElement.style.display = 'none';
			clearNode(this.queuedBarElement);
		}
	}

	private showContinueBar(): void {
		if (!this.continueBarElement) {
			this.continueBarElement = document.createElement('div');
			this.continueBarElement.className = 'him-continue-bar';
			this.continueBarElement.style.padding = '8px 16px';
			this.continueBarElement.style.borderTop = '1px solid var(--vscode-widget-border)';
			this.continueBarElement.style.background = 'var(--vscode-editorWidget-background)';
			this.continueBarElement.style.flexShrink = '0';
			this.queuedBarElement?.parentElement?.insertBefore(this.continueBarElement, this.queuedBarElement);
		}
		this.continueBarElement.style.display = 'flex';
		this.continueBarElement.style.alignItems = 'center';
		this.continueBarElement.style.gap = '8px';
		clearNode(this.continueBarElement);

		const label = append(this.continueBarElement, $('span'));
		label.textContent = `Stopped at loop ${this.lastCancelledContext?.agentLoopCount ?? 0}`;
		label.style.fontSize = '12px';
		label.style.color = 'var(--vscode-descriptionForeground)';
		label.style.flex = '1';

		const continueBtn = append(this.continueBarElement, $('button.him-continue-btn')) as HTMLButtonElement;
		continueBtn.textContent = '▶ Continue';
		continueBtn.style.padding = '4px 12px';
		continueBtn.style.fontSize = '11px';
		continueBtn.style.fontWeight = '600';
		continueBtn.style.border = '1px solid var(--vscode-button-border, transparent)';
		continueBtn.style.borderRadius = '4px';
		continueBtn.style.background = 'var(--vscode-button-background)';
		continueBtn.style.color = 'var(--vscode-button-foreground)';
		continueBtn.style.cursor = 'pointer';
		continueBtn.addEventListener('click', () => {
			this.hideContinueBar();
			void this.resumeAgentLoop();
		});

		const dismissBtn = append(this.continueBarElement, $('button.him-dismiss-btn')) as HTMLButtonElement;
		dismissBtn.textContent = 'Dismiss';
		dismissBtn.style.padding = '4px 12px';
		dismissBtn.style.fontSize = '11px';
		dismissBtn.style.border = '1px solid var(--vscode-widget-border)';
		dismissBtn.style.borderRadius = '4px';
		dismissBtn.style.background = 'transparent';
		dismissBtn.style.color = 'var(--vscode-descriptionForeground)';
		dismissBtn.style.cursor = 'pointer';
		dismissBtn.addEventListener('click', () => {
			this.lastCancelledContext = undefined;
			this.hideContinueBar();
		});
	}

	private hideContinueBar(): void {
		if (this.continueBarElement) {
			this.continueBarElement.style.display = 'none';
		}
	}

	private async resumeAgentLoop(): Promise<void> {
		this.lastCancelledContext = undefined;
		if (this.inputElement) {
			this.inputElement.value = 'Continue from where you stopped.';
		}
		void this.sendCurrentPrompt();
	}

	private resizeInputArea(): void {
		if (!this.inputElement) {
			return;
		}
		const ta = this.inputElement;
		ta.style.height = 'auto';
		const cs = getComputedStyle(ta);
		let lineHeightPx = parseFloat(cs.lineHeight);
		if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
			const fontSize = parseFloat(cs.fontSize) || 14;
			lineHeightPx = Math.round(fontSize * 1.5);
		}
		const padTop = parseFloat(cs.paddingTop) || 0;
		const padBottom = parseFloat(cs.paddingBottom) || 0;
		const minH = Math.max(1, Math.ceil(lineHeightPx + padTop + padBottom));
		const maxH = Math.max(minH, Math.ceil(lineHeightPx * HIM_INPUT_TEXTAREA_MAX_VISIBLE_LINES + padTop + padBottom));
		const needed = ta.scrollHeight;
		const nextH = Math.min(maxH, Math.max(minH, needed));
		ta.style.maxHeight = `${maxH}px`;
		ta.style.minHeight = `${minH}px`;
		ta.style.height = `${nextH}px`;
		ta.style.overflowY = needed > maxH ? 'auto' : 'hidden';
	}

	private onInputDragOver(event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		this.setInputDropActive(true);
	}

	private onInputDragLeave(event: DragEvent): void {
		const nextTarget = event.relatedTarget as Node | null;
		if (nextTarget && this.inputContainerElement?.contains(nextTarget)) {
			return;
		}
		this.setInputDropActive(false);
	}

	/** Clipboard image → pending attachment (files + items for macOS / browser quirks). */
	private async onComposerPaste(event: ClipboardEvent): Promise<void> {
		const cd = event.clipboardData;
		if (!cd) {
			return;
		}
		const imageFiles: File[] = [];
		if (cd.files?.length) {
			for (let i = 0; i < cd.files.length; i++) {
				const f = cd.files.item(i);
				if (f?.type.startsWith('image/')) {
					imageFiles.push(f);
				}
			}
		}
		if (!imageFiles.length && cd.items?.length) {
			for (let i = 0; i < cd.items.length; i++) {
				const it = cd.items[i];
				if (it?.kind === 'file' && it.type.startsWith('image/')) {
					const f = it.getAsFile();
					if (f) {
						imageFiles.push(f);
					}
				}
			}
		}
		if (!imageFiles.length) {
			return;
		}
		event.preventDefault();
		for (const f of imageFiles) {
			await this.addPendingComposerImageFromBrowserFile(f);
		}
	}

	private async onInputDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		this.setInputDropActive(false);
		const dt = event.dataTransfer;
		if (dt?.files?.length) {
			const imageFiles: File[] = [];
			for (let i = 0; i < dt.files.length; i++) {
				const f = dt.files.item(i);
				if (f && f.type.startsWith('image/')) {
					imageFiles.push(f);
				}
			}
			for (const f of imageFiles) {
				await this.addPendingComposerImageFromBrowserFile(f);
			}
		}
		await this.insertDroppedResourceReferences(event);
	}

	private setInputDropActive(active: boolean): void {
		if (!this.inputContainerElement) {
			return;
		}
		this.inputContainerElement.classList.toggle('him-cursor-composer--drop', active);
	}

	private providerSupportsVision(cfg: ResolvedChatConfig): boolean {
		switch (cfg.provider) {
			case 'gemini':
			case 'anthropic':
			case 'openai':
			case 'openaiCompatible':
				return true;
			default:
				return false;
		}
	}

	private viewMessageToProvider(m: ViewMessage, cfg: ResolvedChatConfig): ProviderMessage {
		if (m.role === 'assistant' || !m.images?.length) {
			return { role: m.role, content: m.content };
		}
		const textForApi = m.content.replace(/\n*\[\d+ image\(s\) attached\]\s*$/i, '').trim();
		if (!this.providerSupportsVision(cfg)) {
			const note = localize(
				'himChatVisionSkipped',
				'\n\n[Note: {0} image(s) were attached; this provider may not support vision — switch to Gemini, Anthropic, or OpenAI-compatible vision models.]',
				String(m.images.length),
			);
			return { role: 'user', content: m.content + note };
		}
		const parts: ProviderContentPart[] = [];
		const text = textForApi.trim();
		if (text) {
			parts.push({ type: 'text', text: textForApi });
		}
		for (const img of m.images) {
			const url = `data:${img.mimeType};base64,${img.dataBase64}`;
			parts.push({ type: 'image_url', image_url: { url } });
		}
		if (!parts.length) {
			parts.push({ type: 'text', text: '(image)' });
		}
		return { role: 'user', content: parts };
	}

	private showImageLightbox(imageUrl: string): void {
		this.closeImageLightbox();
		const doc = this.inputElement?.ownerDocument ?? document;
		const overlay = append(doc.body, $('.him-chat-img-lightbox')) as HTMLElement;
		this.imageLightboxOverlay = overlay;
		const img = append(overlay, $('img')) as HTMLImageElement;
		img.src = imageUrl;
		img.alt = '';
		img.draggable = false;
		const close = () => this.closeImageLightbox();
		overlay.addEventListener('click', close);
		img.addEventListener('click', e => e.stopPropagation());
		this.imageLightboxKeyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				close();
			}
		};
		doc.addEventListener('keydown', this.imageLightboxKeyHandler);
	}

	private closeImageLightbox(): void {
		const doc = this.inputElement?.ownerDocument ?? document;
		if (this.imageLightboxKeyHandler) {
			doc.removeEventListener('keydown', this.imageLightboxKeyHandler);
			this.imageLightboxKeyHandler = undefined;
		}
		this.imageLightboxOverlay?.remove();
		this.imageLightboxOverlay = undefined;
	}

	private mimeTypeFromImageFileName(fileName: string): string {
		const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
		switch (ext) {
			case 'png': return 'image/png';
			case 'jpg':
			case 'jpeg': return 'image/jpeg';
			case 'gif': return 'image/gif';
			case 'webp': return 'image/webp';
			case 'bmp': return 'image/bmp';
			case 'svg': return 'image/svg+xml';
			default: return 'image/png';
		}
	}

	private renderPendingComposerImageStrip(): void {
		if (!this.pendingImagesContainer) {
			return;
		}
		clearNode(this.pendingImagesContainer);
		if (!this.pendingComposerImages.length) {
			this.pendingImagesContainer.style.display = 'none';
			return;
		}
		this.pendingImagesContainer.style.display = 'flex';
		for (const item of this.pendingComposerImages) {
			const tile = append(this.pendingImagesContainer, $('.him-chat-pending-img-tile'));
			const thumb = append(tile, $('img')) as HTMLImageElement;
			thumb.src = item.previewUrl;
			thumb.alt = item.name;
			thumb.addEventListener('click', e => {
				e.stopPropagation();
				this.showImageLightbox(item.previewUrl);
			});
			const rm = append(tile, $('button.him-chat-pending-img-remove')) as HTMLButtonElement;
			rm.type = 'button';
			rm.title = localize('himChatRemoveImage', 'Remove image');
			const x = append(rm, $('span.codicon.codicon-close')) as HTMLElement;
			x.className = 'codicon codicon-close';
			rm.addEventListener('click', e => {
				e.stopPropagation();
				this.removePendingComposerImage(item.id);
			});
		}
	}

	private removePendingComposerImage(id: string): void {
		const idx = this.pendingComposerImages.findIndex(x => x.id === id);
		if (idx < 0) {
			return;
		}
		const [removed] = this.pendingComposerImages.splice(idx, 1);
		URL.revokeObjectURL(removed.previewUrl);
		this.renderPendingComposerImageStrip();
	}

	private clearPendingComposerImages(): void {
		for (const x of this.pendingComposerImages) {
			URL.revokeObjectURL(x.previewUrl);
		}
		this.pendingComposerImages.length = 0;
		this.renderPendingComposerImageStrip();
	}

	private async addPendingComposerImageFromBrowserFile(file: File): Promise<void> {
		if (!file.type.startsWith('image/')) {
			return;
		}
		if (this.pendingComposerImages.length >= HIM_CHAT_IMAGE_MAX_COUNT) {
			this.appendMessage({ role: 'assistant', content: localize('himChatTooManyImages', '⚠️ Too many images (max {0}).', String(HIM_CHAT_IMAGE_MAX_COUNT)), isError: true });
			return;
		}
		if (file.size > HIM_CHAT_IMAGE_MAX_BYTES) {
			this.appendMessage({ role: 'assistant', content: localize('himChatImageTooLarge', '⚠️ Image too large (max {0} MB).', String(Math.round(HIM_CHAT_IMAGE_MAX_BYTES / (1024 * 1024)))), isError: true });
			return;
		}
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
			r.onerror = () => reject(new Error('read'));
			r.readAsDataURL(file);
		});
		const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
		if (!m) {
			return;
		}
		const mimeType = m[1] || file.type || 'image/png';
		const dataBase64 = m[2] || '';
		const previewUrl = URL.createObjectURL(file);
		this.pendingComposerImages.push({
			id: generateUuid(),
			name: file.name || 'image',
			mimeType,
			dataBase64,
			previewUrl,
		});
		this.renderPendingComposerImageStrip();
	}

	private async onHiddenImageFileInputChange(): Promise<void> {
		const input = this.hiddenImageFileInput;
		if (!input?.files?.length) {
			return;
		}
		const list = Array.from(input.files);
		input.value = '';
		for (const f of list) {
			await this.addPendingComposerImageFromBrowserFile(f);
		}
	}

	private async pickComposerImagesFromDisk(): Promise<void> {
		const uris = await this.fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectMany: true,
			title: localize('himChatPickImagesTitle', 'Select images'),
			openLabel: localize('himChatPickImagesOpen', 'Select'),
			filters: [{ name: localize('himChatImageFilter', 'Images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
		});
		if (!uris?.length) {
			return;
		}
		for (const uri of uris) {
			if (this.pendingComposerImages.length >= HIM_CHAT_IMAGE_MAX_COUNT) {
				break;
			}
			try {
				const content = await this.fileService.readFile(uri);
				if (content.size > HIM_CHAT_IMAGE_MAX_BYTES) {
					this.appendMessage({ role: 'assistant', content: localize('himChatImageTooLarge', '⚠️ Image too large (max {0} MB).', String(Math.round(HIM_CHAT_IMAGE_MAX_BYTES / (1024 * 1024)))), isError: true });
					continue;
				}
				const name = basename(uri);
				const mimeType = this.mimeTypeFromImageFileName(name);
				const dataBase64 = encodeBase64(content.value);
				const src = content.value.buffer;
				const copy = new Uint8Array(src.byteLength);
				copy.set(src);
				const blob = new Blob([copy], { type: mimeType });
				const previewUrl = URL.createObjectURL(blob);
				this.pendingComposerImages.push({
					id: generateUuid(),
					name,
					mimeType,
					dataBase64,
					previewUrl,
				});
			} catch {
				this.appendMessage({ role: 'assistant', content: localize('himChatImageReadFail', '⚠️ Could not read image file.'), isError: true });
			}
		}
		this.renderPendingComposerImageStrip();
	}

	private insertTextIntoInput(text: string): void {
		if (!this.inputElement || !text.trim()) {
			return;
		}
		const current = this.inputElement.value.trim();
		this.inputElement.value = current ? `${current}\n\n${text.trim()}` : text.trim();
		this.resizeInputArea();
		this.inputElement.focus();
	}

	private async insertSelectedCodeReference(): Promise<void> {
		const codeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!codeEditor || !codeEditor.hasModel()) {
			this.appendMessage({ role: 'assistant', content: '⚠️ No active editor for code selection.', isError: true });
			return;
		}
		const selection = codeEditor.getSelection();
		if (!selection || selection.isEmpty()) {
			this.appendMessage({ role: 'assistant', content: '⚠️ Select some code first, then add reference.', isError: true });
			return;
		}
		const model = codeEditor.getModel();
		if (!model) {
			this.appendMessage({ role: 'assistant', content: '⚠️ Unable to read selected code.', isError: true });
			return;
		}
		const rawCode = model.getValueInRange(selection);
		const code = rawCode.length > 12000 ? `${rawCode.slice(0, 12000)}\n...` : rawCode;
		const language = model.getLanguageId() || 'text';
		const rangeLabel = `${selection.startLineNumber}:${selection.startColumn}-${selection.endLineNumber}:${selection.endColumn}`;

		const reference = { uri: model.uri, content: code, language, range: rangeLabel, element: undefined as HTMLElement | undefined };
		this.codeReferences.push(reference);

		this.createCodeReferenceElement(reference);
	}

	private createCodeReferenceElement(ref: { uri: URI; content: string; language: string; range: string; element?: HTMLElement }): void {
		if (!this.attachmentsContainer) {
			return;
		}

		const fileName = basename(ref.uri);
		const [start, end] = ref.range.split('-');
		const startLine = start.split(':')[0];
		const endLine = end.split(':')[0];
		const lineDisplay = `L${startLine}-L${endLine}`;

		const element = document.createElement('div');
		element.className = 'him-chat-attachment';
		element.style.cssText = `
			display: inline-flex;
			align-items: center;
			gap: 6px;
			background: var(--vscode-textCodeBlock-background, #2d2d2d);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 4px 8px;
			font-size: 12px;
			color: var(--vscode-editor-foreground);
			max-width: 100%;
		`;

		const icon = document.createElement('span');
		icon.style.cssText = `
			font-size: 11px;
			font-weight: 600;
			color: #ffffff;
			background: #007acc;
			padding: 1px 4px;
			border-radius: 3px;
			flex-shrink: 0;
		`;
		icon.textContent = '«»';

		const label = document.createElement('span');
		label.textContent = fileName;
		label.style.cssText = `
			font-weight: 500;
			color: var(--vscode-textLink-foreground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 120px;
		`;

		const preview = document.createElement('span');
		preview.textContent = lineDisplay;
		preview.style.cssText = `
			color: var(--vscode-editorLineNumber-foreground);
			font-size: 11px;
		`;

		const deleteBtn = document.createElement('span');
		deleteBtn.className = 'codicon codicon-close him-chat-icon-close-sm';
		deleteBtn.style.cssText = `
			cursor: pointer;
			padding: 2px;
			border-radius: 3px;
			color: var(--vscode-editorLineNumber-foreground);
			flex-shrink: 0;
		`;
		deleteBtn.title = 'Remove';
		deleteBtn.addEventListener('click', () => {
			element.remove();
			const idx = this.codeReferences.indexOf(ref);
			if (idx > -1) {
				this.codeReferences.splice(idx, 1);
			}
		});

		element.appendChild(icon);
		element.appendChild(label);
		element.appendChild(preview);
		element.appendChild(deleteBtn);
		this.attachmentsContainer.appendChild(element);
		ref.element = element;

		this.resizeInputArea();
	}

	private async insertActiveFileReference(): Promise<void> {
		const codeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		const uri = codeEditor?.getModel()?.uri;
		if (!uri) {
			this.appendMessage({ role: 'assistant', content: '⚠️ No active file to reference.', isError: true });
			return;
		}
		const kind = await this.detectResourceKind(uri);
		const fileLabel = this.toResourceLabel(uri);
		const prefix = kind === 'folder' ? '@folder' : '@file';
		this.insertTextIntoInput(`${prefix} ${fileLabel}`);
	}

	private async insertDroppedResourceReferences(event: DragEvent): Promise<void> {
		const droppedEditors = extractEditorsDropData(event).filter(editor => !!editor.resource);
		const resourceUris = droppedEditors.map(editor => editor.resource!).filter((resource): resource is URI => !!resource);
		if (!resourceUris.length) {
			return;
		}

		const seen = new Set<string>();
		for (const resource of resourceUris) {
			const key = resource.toString();
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);

			const kind = await this.detectResourceKind(resource);
			if (kind === 'folder') {
				continue;
			}

			try {
				const content = await this.fileService.readFile(resource);
				const textContent = content.value.toString();
				const displayContent =
					textContent.length > HIM_CHAT_FILE_ATTACH_MAX_CHARS
						? textContent.slice(0, HIM_CHAT_FILE_ATTACH_MAX_CHARS) + '\n...'
						: textContent;
				const ref = { uri: resource, content: displayContent, element: undefined as HTMLElement | undefined };
				this.fileReferences.push(ref);
				this.createFileReferenceElement(ref);
			} catch {
				const ref = { uri: resource, content: '', element: undefined as HTMLElement | undefined };
				this.fileReferences.push(ref);
				this.createFileReferenceElement(ref);
			}
		}
	}

	private createFileReferenceElement(ref: { uri: URI; content: string; element?: HTMLElement }): void {
		if (!this.attachmentsContainer) {
			return;
		}

		const fileName = basename(ref.uri);
		const element = document.createElement('div');
		element.className = 'him-chat-attachment';
		element.style.cssText = `
			display: inline-flex;
			align-items: center;
			gap: 6px;
			background: var(--vscode-textCodeBlock-background, #2d2d2d);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 4px 8px;
			font-size: 12px;
			color: var(--vscode-editor-foreground);
			max-width: 100%;
		`;

		const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
		const extColors: Record<string, string> = {
			'js': '#f7df1e', 'ts': '#3178c6', 'jsx': '#61dafb', 'tsx': '#61dafb',
			'py': '#3572A5', 'rs': '#dea584', 'go': '#00ADD8', 'java': '#b07219',
			'c': '#555555', 'cpp': '#f34b7d', 'cs': '#178600', 'rb': '#701516',
			'php': '#4F5D95', 'swift': '#F05138', 'kt': '#A97BFF', 'scala': '#dc322f',
			'html': '#e34c26', 'css': '#563d7c', 'scss': '#c6538c', 'json': '#292929',
			'xml': '#0060ac', 'yaml': '#cb171e', 'yml': '#cb171e', 'md': '#083fa1',
			'sh': '#89e051', 'bash': '#89e051', 'zsh': '#89e051',
			'vue': '#41b883', 'svelte': '#ff3e00',
		};
		const color = extColors[ext] || '#6a737d';

		const icon = document.createElement('span');
		icon.style.cssText = `
			font-size: 11px;
			font-weight: 600;
			color: #ffffff;
			background: ${color};
			padding: 1px 4px;
			border-radius: 3px;
			flex-shrink: 0;
		`;
		icon.textContent = ext ? `.${ext}` : 'FILE';

		const label = document.createElement('span');
		label.textContent = fileName;
		label.style.cssText = `
			font-weight: 500;
			color: var(--vscode-textLink-foreground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 120px;
		`;

		const preview = document.createElement('span');
		preview.textContent = ref.content ? `${Math.round(ref.content.length / 100) * 100}B` : '(empty)';
		preview.style.cssText = `
			color: var(--vscode-editorLineNumber-foreground);
			font-size: 11px;
		`;

		const deleteBtn = document.createElement('span');
		deleteBtn.className = 'codicon codicon-close him-chat-icon-close-sm';
		deleteBtn.style.cssText = `
			cursor: pointer;
			padding: 2px;
			border-radius: 3px;
			color: var(--vscode-editorLineNumber-foreground);
			flex-shrink: 0;
		`;
		deleteBtn.title = 'Remove';
		deleteBtn.addEventListener('click', () => {
			element.remove();
			const idx = this.fileReferences.indexOf(ref);
			if (idx > -1) {
				this.fileReferences.splice(idx, 1);
			}
		});

		element.appendChild(icon);
		element.appendChild(label);
		element.appendChild(preview);
		element.appendChild(deleteBtn);
		this.attachmentsContainer.appendChild(element);
		ref.element = element;

		this.resizeInputArea();
	}

	private async detectResourceKind(resource: URI): Promise<'file' | 'folder'> {
		try {
			const stat = await this.fileService.resolve(resource);
			return stat.isDirectory ? 'folder' : 'file';
		} catch {
			return resource.path.endsWith('/') ? 'folder' : 'file';
		}
	}

	private toResourceLabel(resource: URI): string {
		if (resource.scheme === 'file' && resource.fsPath) {
			return resource.fsPath;
		}
		return resource.toString(true);
	}

	private async sendCurrentPrompt(): Promise<void> {
		if (!this.inputElement) { return; }
		if (this.leftNavMode === 'org') {
			return;
		}

		const prompt = this.inputElement.value.trim();
		if (!prompt && this.codeReferences.length === 0 && this.fileReferences.length === 0 && this.pendingComposerImages.length === 0) {
			return;
		}

		if (this.isSending) {
			this.queuedMessages.push(prompt);
			this.inputElement.value = '';
			this.resizeInputArea();
			this.renderQueuedBar();
			return;
		}

		const fullContentParts: string[] = [];
		const displayAttachments: { type: 'code' | 'file' | 'image'; name: string; range?: string; size?: string }[] = [];

		if (this.codeReferences.length > 0) {
			for (const ref of this.codeReferences) {
				const fileName = basename(ref.uri);
				const [start, end] = ref.range.split('-');
				const startLine = start.split(':')[0];
				const endLine = end.split(':')[0];
				displayAttachments.push({
					type: 'code',
					name: fileName,
					range: `L${startLine}-L${endLine}`
				});
				fullContentParts.push(`@selection ${fileName}#${ref.range}\n\`\`\`${ref.language}\n${ref.content}\n\`\`\``);
			}
		}

		if (this.fileReferences.length > 0) {
			for (const ref of this.fileReferences) {
				const fileName = basename(ref.uri);
				const ext = fileName.includes('.') ? fileName.split('.').pop()! : '';
				const language = ext || 'text';
				let snippet = '';
				let readOk = false;
				try {
					const file = await this.fileService.readFile(ref.uri);
					readOk = true;
					const textContent = file.value.toString();
					snippet =
						textContent.length > HIM_CHAT_FILE_ATTACH_MAX_CHARS
							? textContent.slice(0, HIM_CHAT_FILE_ATTACH_MAX_CHARS) + '\n...'
							: textContent;
				} catch {
					snippet = ref.content;
				}
				const size = snippet ? `${Math.round(snippet.length / 100) * 100}B` : '';
				displayAttachments.push({
					type: 'file',
					name: fileName,
					size
				});
				if (readOk || snippet) {
					fullContentParts.push(`@file ${fileName}\n\`\`\`${language}\n${snippet}\n\`\`\``);
				} else {
					fullContentParts.push(`@file ${fileName} (unable to read)`);
				}
			}
		}

		const snapshotImages = this.pendingComposerImages.map(p => ({
			mimeType: p.mimeType,
			dataBase64: p.dataBase64,
			name: p.name,
		}));
		for (const p of this.pendingComposerImages) {
			displayAttachments.push({ type: 'image', name: p.name });
		}

		const textBody = fullContentParts.length > 0
			? (prompt ? `${prompt}\n\n${fullContentParts.join('\n\n')}` : fullContentParts.join('\n\n'))
			: prompt;
		const fullContent = snapshotImages.length
			? (textBody ? `${textBody}\n\n[${snapshotImages.length} image(s) attached]` : `[${snapshotImages.length} image(s) attached]`)
			: textBody;

		this.inputElement.value = '';
		this.resizeInputArea();

		const displayContent = displayAttachments.length > 0 || snapshotImages.length
			? (prompt || '')
			: fullContent;

		const userMessage: ViewMessage = {
			role: 'user',
			content: fullContent,
			attachments: displayAttachments.length > 0 ? displayAttachments : undefined,
			images: snapshotImages.length > 0 ? snapshotImages : undefined,
		};
		this.activeMessages().push(userMessage);
		this.scheduleMemoryMeterUpdate();
		this.appendMessage(userMessage, displayContent);

		if (this.activeMessages().filter(m => m.role === 'user').length === 1) {
			const session = this.sessions[this.activeSessionIdx];
			if (session) {
				session.title = prompt.slice(0, 30) || snapshotImages[0]?.name?.slice(0, 30) || session.title;
				this.renderTabBar();
			}
		}

		this.clearPendingComposerImages();

		for (const ref of this.codeReferences) {
			ref.element?.remove();
		}
		this.codeReferences.length = 0;

		for (const ref of this.fileReferences) {
			ref.element?.remove();
		}
		this.fileReferences.length = 0;

		const pendingBubble = this.appendMessage({ role: 'assistant', content: 'Thinking...' });
		this.setSendingState(true);

		const currentSessionId = this.sessions[this.activeSessionIdx]?.id;
		if (currentSessionId && pendingBubble) {
			this.streamingPendingBubbleBySessionId.set(currentSessionId, pendingBubble);
		}

		this.requestCts?.dispose(true);
		const localCts = new CancellationTokenSource();
		this.requestCts = localCts;
		const requestToken = localCts.token;

		const bgCts = currentSessionId ? this.backgroundCts.get(currentSessionId) : undefined;
		if (bgCts) {
			bgCts.cancel();
			bgCts.dispose(true);
			this.backgroundCts.delete(currentSessionId!);
		}

		const isSessionActive = () => this.sessions[this.activeSessionIdx]?.id === currentSessionId;

		let ctx = createAgentRunContext(currentSessionId ?? 'default');
		if (isSessionActive()) {
			this.updateHeaderState('READING', 0);
		}

		const streamedThinking = { value: '' };
		const requestStartedAt = Date.now();

		if (currentSessionId && pendingBubble) {
			this.streamingUiFlushBySessionId.set(currentSessionId, () => {
				if (requestToken.isCancellationRequested) {
					return;
				}
				this.ensureStreamingRowsInSessionMessageList(currentSessionId, pendingBubble);
				this.renderStreamingNow(ctx, pendingBubble, streamedThinking.value, requestStartedAt);
			});
		}

		try {
			const cfg = await this.resolveChatConfig();
			const session = this.sessions[this.activeSessionIdx];
			const extraParts: string[] = [];
			if (session?.role?.trim()) {
				extraParts.push(`## Agent Role\n${session.role.trim()}`);
			}
			if (session?.rule?.trim()) {
				extraParts.push(`## Agent Rule\n${session.rule.trim()}`);
			}
			if (session?.linkedOrgAgentId === HIM_ORG_ORCHESTRATOR_AGENT_ID) {
				extraParts.push(
					localize(
						'himOrchestratorHostToolLockSystem',
						'## Host — Orchestrator tool lock\nThis thread is **planning-only**. Do **not** emit `<him-python>`, `<him-shell>`, or `<him-search>`; the host will not execute them.\n\nTo **apply** a full organization document, wrap valid JSON (complete `org.json` shape: `version`, `agents` including immutable `user` + `orchestrator`, `edges`, optional `plan_status` / `consensus_note`) inside a single block:\n`<him-org>`\n{ ... }\n`</him-org>`\nThe host validates it, writes workspace `org.json`, refreshes the org list, and opens chat tabs for **new** worker agents.',
					),
				);
			}
			const systemPrompt = extraParts.length > 0 ? `${cfg.systemPrompt}\n\n${extraParts.join('\n\n')}` : cfg.systemPrompt;
			const maxSemanticSteps = Math.max(4, Math.min(256, this.configurationService.getValue<number>(`${CONFIG_ROOT}.maxPlanSteps`) ?? 64));
			const semanticProgramModeBase = this.configurationService.getValue<boolean>(`${CONFIG_ROOT}.semanticProgramMode`) ?? true;
			const semanticProgramMode =
				semanticProgramModeBase && session?.linkedOrgAgentId !== HIM_ORG_ORCHESTRATOR_AGENT_ID;
			const semanticProgramDebug = this.configurationService.getValue<boolean>(`${CONFIG_ROOT}.semanticProgramDebug`) ?? false;

			let conversationMessages: ProviderMessage[];

			if (semanticProgramMode) {
				ctx.orchestratedPlanStep = true;
				const folder0 = this.workspaceContextService.getWorkspace().folders[0];
				const sidPlan = currentSessionId ?? 'default';
				const hostRoot = this.getHimHostDataRoot();
				ctx.planWorkspaceRelativePath =
					folder0 !== undefined
						? formatHimPlanPromptPath(sidPlan, HIM_SEMANTIC_PROGRAM_FILENAME)
						: undefined;
				let baselineProgramJson: string | undefined;
				if (folder0 !== undefined) {
					try {
						const bootDoc = await ensureSessionSemanticProgramBootstrap(
							this.fileService,
							hostRoot,
							sidPlan,
							HIM_SEMANTIC_DEFAULT_GLOBAL_CONSTRAINTS,
						);
						baselineProgramJson = JSON.stringify(bootDoc, null, 2);
					} catch {
						baselineProgramJson = undefined;
					}
				}
				conversationMessages = this.toProviderMessagesSemanticPhase1(
					systemPrompt,
					cfg.historyTurns,
					cfg,
					baselineProgramJson,
				);
				let semanticDebugCard: HimSemanticProgramDebugCard | undefined;
				if (semanticProgramDebug) {
					semanticDebugCard = {
						title: localize('himSemanticDebugTitleGeneric', 'Debug — Semantic program'),
						subtitle: localize(
							'himSemanticDebugSubtitle',
							'Provider `{0}` · model `{1}`. Input dumps may contain API keys — turn debug off before sharing.',
							cfg.provider,
							cfg.model,
						),
						turns: [],
					};
				}
				let phase1Sem = await this.runAgentRequestAndToolLoop(
					ctx,
					cfg,
					conversationMessages,
					requestToken,
					pendingBubble,
					streamedThinking,
					requestStartedAt,
					isSessionActive,
					{ enableToolObservationLoop: false },
				);
				// Models often stream the semantic JSON in the thinking/reasoning channel only; merge all text-bearing fields.
				const mergePhase1Blob = () =>
					[
						streamedThinking.value,
						ctx.streamVisibleContent,
						phase1Sem.roundContent,
						phase1Sem.answer.text ?? '',
						phase1Sem.answer.thinking ?? '',
					].join('\n');
				const recordPhase1DebugTurn = (stepLabel: string) => {
					if (!semanticDebugCard) {
						return;
					}
					const phaseOut = [phase1Sem.roundContent, phase1Sem.answer.text ?? '', ctx.streamVisibleContent]
						.filter(Boolean)
						.join('\n---\n');
					semanticDebugCard.turns.push({
						stepLabel,
						inputText: this.formatMessagesForSemanticDebug(conversationMessages),
						outputText: this.truncateForSemanticDebug(phaseOut),
						outputThinking: this.truncateForSemanticDebug(
							[streamedThinking.value, phase1Sem.answer.thinking ?? ''].filter(Boolean).join('\n---\n'),
						),
						notes: localize(
							'himSemanticDebugPhase1Note',
							'The host merges thinking, visible stream, round buffer, and answer text/thinking to locate and parse the program block.',
						),
					});
				};
				let semParseBlob = mergePhase1Blob();
				recordPhase1DebugTurn(localize('himSemanticDebugPhase1', 'Phase 1 — Author (`<him-semantic-program>`)'));
				let semDoc = extractAndParseSemanticProgram(semParseBlob);
				for (
					let r = 0;
					r < HimAiChatPane._semanticPhase1ExtraRoundsOnParseFail && !semDoc && !requestToken.isCancellationRequested;
					r++
				) {
					this.resetSemanticPhase1StreamState(ctx, streamedThinking);
					conversationMessages.push({
						role: 'user',
						content: localize(
							'himSemanticPhase1ParseRetryUser',
							'[HIM host — same turn, not shown in chat] Your previous assistant message could not be parsed: no valid `<him-semantic-program>`…`</him-semantic-program>` block with valid JSON inside. Respond again with only that required block (raw JSON between tags). Do not answer with general chat, poetry, or tutorials instead of the program JSON.',
						),
					});
					phase1Sem = await this.runAgentRequestAndToolLoop(
						ctx,
						cfg,
						conversationMessages,
						requestToken,
						pendingBubble,
						streamedThinking,
						requestStartedAt,
						isSessionActive,
						{ enableToolObservationLoop: false },
					);
					semParseBlob = mergePhase1Blob();
					recordPhase1DebugTurn(localize('himSemanticDebugPhase1Retry', 'Phase 1 — Author (after parse retry)'));
					semDoc = extractAndParseSemanticProgram(semParseBlob);
				}
				if (!semDoc) {
					const err =
						'Semantic program mode: could not parse `<him-semantic-program>` JSON. Ensure the first reply contains a valid block with `version: 1`, `instructions`, and `current_pointer`.';
					const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
					const parseFailureCard: HimSemanticProgramDebugCard =
						semanticDebugCard ??
						{
							title: localize('himSemanticProgramParseFailTitleShort', 'Semantic program · Parse failure'),
							subtitle: localize(
								'himSemanticParseFailureSubtitleLite',
								'Expand below for raw model output (merged streams). Enable himCode.chat.semanticProgramDebug for full API traces.',
							),
							turns: [],
						};
					const inner = extractSemanticProgramBlock(semParseBlob);
					parseFailureCard.parseHint = inner
						? localize(
							'himSemanticDebugParseBadJson',
							'Found `<him-semantic-program>` inner text ({0} chars) but JSON failed validation.',
							String(inner.length),
						)
						: localize(
							'himSemanticDebugParseNoTag',
							'No `<him-semantic-program>...</him-semantic-program>` block in the merged blob.',
						);
					parseFailureCard.rawTagInnerPreview = inner ? this.truncateForSemanticDebug(inner, 16_000) : undefined;
					parseFailureCard.rawMergedBlobPreview = this.truncateForSemanticDebug(semParseBlob, 24_000);
					if (semanticDebugCard) {
						parseFailureCard.title = localize('himSemanticDebugParseFailTitle', 'Debug — Semantic program · Parse failure');
					}
					const finalMsg: ViewMessage = {
						role: 'assistant',
						content: err,
						thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
						thinkingDurationMs: elapsedMs,
						isError: true,
						semanticProgramDebug: parseFailureCard,
					};
					if (currentSessionId && pendingBubble) {
						this.ensureStreamingRowsInSessionMessageList(currentSessionId, pendingBubble);
					}
					if (isSessionActive()) {
						if (pendingBubble) {
							this.renderMessageInBubble(pendingBubble, finalMsg);
						}
						this.activeMessages().push(finalMsg);
						this.persistWorkspaceSessions();
					} else if (pendingBubble) {
						this.renderMessageInBubble(pendingBubble, finalMsg);
						this.persistWorkspaceSessions();
					}
				} else {
					if (semanticDebugCard) {
						semanticDebugCard.title = localize('himSemanticDebugTitlePipeline', 'Debug — Semantic program · Author + pipeline');
					}
					await this.runSemanticProgramPipeline(
						semDoc,
						cfg,
						conversationMessages,
						ctx,
						streamedThinking,
						requestToken,
						pendingBubble,
						requestStartedAt,
						isSessionActive,
						currentSessionId,
						maxSemanticSteps,
						semanticDebugCard,
					);
				}
			} else {
				conversationMessages = this.toProviderMessages(systemPrompt, cfg.historyTurns, cfg);
				const result = await this.runAgentRequestAndToolLoop(
					ctx,
					cfg,
					conversationMessages,
					requestToken,
					pendingBubble,
					streamedThinking,
					requestStartedAt,
					isSessionActive,
				);
				const answer = result.answer;

				const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
				const content = ctx.streamVisibleContent.trim() || (result.roundContent || answer.text).trim() || '(Empty response)';
				const mergedThinkingRaw = (streamedThinking.value || answer.thinking || '').trim();
				const thinking = this.composeThinkingMarkdown(cfg, conversationMessages, mergedThinkingRaw || undefined, elapsedMs);
				const pythonExecutions = ctx.pendingPythonExecs.length > 0 ? ctx.pendingPythonExecs.slice() : undefined;
				const shellExecutions = ctx.pendingShellExecs.length > 0 ? ctx.pendingShellExecs.slice() : undefined;
				const searchExecutions = ctx.pendingSearchExecs.length > 0 ? ctx.pendingSearchExecs.slice() : undefined;
				const finalMsg: ViewMessage = { role: 'assistant', content, thinking, thinkingDurationMs: elapsedMs, pythonExecutions, shellExecutions, searchExecutions };

				if (currentSessionId && pendingBubble) {
					this.ensureStreamingRowsInSessionMessageList(currentSessionId, pendingBubble);
				}
				if (isSessionActive()) {
					if (pendingBubble) {
						this.renderMessageInBubble(pendingBubble, finalMsg);
					}
					this.activeMessages().push(finalMsg);
					this.persistWorkspaceSessions();
					void this.tryApplyOrganizationFromOrchestratorAssistant(content, currentSessionId);
				} else {
					const targetSession = this.sessions.find(s => s.id === currentSessionId);
					if (targetSession) {
						targetSession.messages.push(finalMsg);
					}
					if (pendingBubble) {
						this.renderMessageInBubble(pendingBubble, finalMsg);
					}
					this.persistWorkspaceSessions();
					void this.tryApplyOrganizationFromOrchestratorAssistant(content, currentSessionId);
				}
			}
		} catch (error) {
			await ctx.pythonExecQueue.catch(() => undefined);
			const active = isSessionActive();
			if (!active) {
				const partialContent = ctx.streamVisibleContent.trim();
				const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
				const mergedThinkingRaw = (streamedThinking.value || '').trim();
				if (partialContent || mergedThinkingRaw) {
					const targetSession = this.sessions.find(s => s.id === currentSessionId);
					if (targetSession) {
						const partial: ViewMessage = {
							role: 'assistant',
							content: partialContent || '(Background request ended)',
							thinking: mergedThinkingRaw || undefined,
							thinkingDurationMs: elapsedMs,
							pythonExecutions: ctx.pendingPythonExecs.length > 0 ? ctx.pendingPythonExecs.slice() : undefined,
							shellExecutions: ctx.pendingShellExecs.length > 0 ? ctx.pendingShellExecs.slice() : undefined,
							searchExecutions: ctx.pendingSearchExecs.length > 0 ? ctx.pendingSearchExecs.slice() : undefined,
						};
						targetSession.messages.push(partial);
						if (pendingBubble) {
							this.renderMessageInBubble(pendingBubble, partial);
						}
					}
				}
				this.persistWorkspaceSessions();
			} else {
				const isCancelled = error instanceof CancellationError ||
					(error instanceof Error && error.message.includes('cancel'));
				if (isCancelled && ctx.agentLoopCount > 0) {
					this.lastCancelledContext = {
						conversationMessages: [],
						cfg: await this.resolveChatConfig().catch(() => undefined as any),
						pendingBubble,
						streamedThinking: streamedThinking.value,
						requestStartedAt,
						agentLoopCount: ctx.agentLoopCount,
					};
				}
				if (!isCancelled) {
					const message = this.toErrorMessage(error);
					if (pendingBubble) {
						this.renderMessageInBubble(pendingBubble, { role: 'assistant', content: message, isError: true });
						pendingBubble.style.color = 'var(--vscode-errorForeground)';
					}
					this.activeMessages().push({ role: 'assistant', content: message, isError: true });
				} else {
					const content = ctx.streamVisibleContent.trim() || '(Stopped by user)';
					this.activeMessages().push({ role: 'assistant', content });
				}
			}
		} finally {
			const active = isSessionActive();

			this.backgroundCts.delete(currentSessionId!);
			if (currentSessionId) {
				this.streamingPendingBubbleBySessionId.delete(currentSessionId);
				this.streamingUiFlushBySessionId.delete(currentSessionId);
			}
			localCts.dispose(true);
			if (this.requestCts === localCts) {
				this.requestCts = undefined;
			}

			// Refresh as soon as the turn ends so the file list matches git (don’t wait on debounce only).
			this.flushRefreshWorkspaceFileChangesSummary();

			if (active) {
				this.setSendingState(false);
				if (currentSessionId) {
					this.applySessionAgentDisplay(currentSessionId, 'IDLE');
				}

				if (this.lastCancelledContext) {
					this.showContinueBar();
				}

				if (this.queuedMessages.length > 0) {
					const queued = this.queuedMessages.shift()!;
					this.renderQueuedBar();
					if (this.inputElement) {
						this.inputElement.value = queued;
					}
					this.sendCurrentPrompt();
				} else {
					this.maybeCompressConversation();
				}
				this.persistWorkspaceSessions();
			} else {
				if (currentSessionId) {
					this.applySessionAgentDisplay(currentSessionId, 'IDLE');
				}
				this.persistWorkspaceSessions();
			}
		}
	}

	private async processIngestionQueue(
		ctx: HimAgentRunContext,
		pendingBubble: HTMLElement,
		token: CancellationToken,
		getThinking: () => string,
		requestStartedAt: number,
		isSessionActive: () => boolean,
	): Promise<void> {
		while (ctx.ingestQueue.length > 0) {
			if (token.isCancellationRequested) {
				ctx.renderState = 'CANCELLED';
				if (isSessionActive()) {
					this.updateHeaderState('CANCELLED', ctx.agentLoopCount);
				}
				return;
			}
			const chunk = ctx.ingestQueue.shift() ?? '';
			const events = ctx.tagParser.push(chunk);
			await this.processTagEvents(ctx, events, pendingBubble, token, getThinking, requestStartedAt, isSessionActive);
		}
	}

	private async processTagEvents(
		ctx: HimAgentRunContext,
		events: HimPythonTagEvent[],
		pendingBubble: HTMLElement,
		token: CancellationToken,
		getThinking: () => string,
		requestStartedAt: number,
		isSessionActive: () => boolean,
	): Promise<void> {
		for (const event of events) {
			if (token.isCancellationRequested) {
				ctx.renderState = 'CANCELLED';
				if (isSessionActive()) {
					this.updateHeaderState('CANCELLED', ctx.agentLoopCount);
				}
				return;
			}
			if (event.kind === 'text') {
				ctx.renderState = 'READING';
				ctx.streamVisibleContent += event.text;
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'python_open') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += '<him-python>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'python_chunk') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += event.text;
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'shell_open') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += '<him-shell>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'shell_chunk') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += event.text;
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'shell_close') {
				if (token.isCancellationRequested) {
					ctx.renderState = 'CANCELLED';
					ctx.streamVisibleContent += '</him-shell>';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					continue;
				}
				if (this.isOrchestratorLinkedSession(ctx.sessionId)) {
					ctx.renderState = 'CODING';
					const shBlockIndex = ctx.streamShellBlockCounter++;
					ctx.streamVisibleContent += '</him-shell>';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					const msg = localize(
						'himOrchestratorBlockedShell',
						'Host: Orchestrator threads cannot run `<him-shell>`. Propose organization changes without executing shell.',
					);
					ctx.pendingShellExecs = ctx.pendingShellExecs.filter(e => e.blockIndex !== shBlockIndex);
					ctx.pendingShellExecs.push({
						blockIndex: shBlockIndex,
						command: event.command.trim(),
						output: msg,
						exitCode: -1,
					});
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					ctx.renderState = 'READING';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					continue;
				}
				ctx.renderState = 'LOCKED';
				const shBlockIndex = ctx.streamShellBlockCounter++;
				ctx.streamVisibleContent += '</him-shell>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt, 'Terminal command running — streaming is paused until the shell exits.');
				ctx.shellExecInFlight++;
				void this.executeShellCommand(ctx, event.command, pendingBubble, token, shBlockIndex)
					.finally(() => {
						ctx.shellExecInFlight = Math.max(0, ctx.shellExecInFlight - 1);
						ctx.renderState = 'RESUMING';
						if (isSessionActive()) {
							this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
						}
						this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
						ctx.renderState = 'READING';
						if (isSessionActive()) {
							this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
						}
						ctx.notifyShellExecDone?.();
					});
				continue;
			}
			if (event.kind === 'search_open') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += '<him-search>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'search_chunk') {
				ctx.renderState = 'CODING';
				ctx.streamVisibleContent += event.text;
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				continue;
			}
			if (event.kind === 'search_close') {
				if (token.isCancellationRequested) {
					ctx.renderState = 'CANCELLED';
					ctx.streamVisibleContent += '</him-search>';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					continue;
				}
				if (this.isOrchestratorLinkedSession(ctx.sessionId)) {
					ctx.renderState = 'CODING';
					const blockIndex = ctx.streamSearchBlockCounter++;
					ctx.streamVisibleContent += '</him-search>';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					const msg = localize(
						'himOrchestratorBlockedSearch',
						'Host: Orchestrator threads cannot run `<him-search>`. Describe research needs for workers instead.',
					);
					ctx.pendingSearchExecs = ctx.pendingSearchExecs.filter(e => e.blockIndex !== blockIndex);
					ctx.pendingSearchExecs.push({ blockIndex, query: event.query.trim(), output: msg });
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					ctx.renderState = 'READING';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					continue;
				}
				ctx.renderState = 'LOCKED';
				const blockIndex = ctx.streamSearchBlockCounter++;
				ctx.streamVisibleContent += '</him-search>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				// Show a stable "search result" block in the bubble (like shell/python blocks).
				ctx.pendingSearchExecs = ctx.pendingSearchExecs.filter(e => e.blockIndex !== blockIndex);
				ctx.pendingSearchExecs.push({ blockIndex, query: event.query.trim(), output: 'Searching…' });
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt, 'Web search running — streaming is paused until results return.');
				ctx.shellExecInFlight++;
				void this.enqueueSearchExecution(ctx.sessionId, () => this.executeWebSearch(ctx, event.query, pendingBubble, token, blockIndex))
					.finally(() => {
						ctx.shellExecInFlight = Math.max(0, ctx.shellExecInFlight - 1);
						ctx.renderState = 'RESUMING';
						if (isSessionActive()) {
							this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
						}
						this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
						ctx.renderState = 'READING';
						if (isSessionActive()) {
							this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
						}
						ctx.notifyShellExecDone?.();
					});
				continue;
			}
			if (event.kind === 'python_close') {
				if (token.isCancellationRequested) {
					ctx.renderState = 'CANCELLED';
					ctx.streamVisibleContent += '</him-python>';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					continue;
				}
				// Long-running Python is normal agent work — use CODING, not LOCKED (no lock banner).
				ctx.renderState = 'CODING';
				const blockIndex = ctx.streamPythonBlockCounter++;
				ctx.streamVisibleContent += '</him-python>';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				if (this.isOrchestratorLinkedSession(ctx.sessionId)) {
					const msg = localize(
						'himOrchestratorBlockedPython',
						'Host: Orchestrator threads cannot run `<him-python>`. Propose `org.json` updates in text or JSON only.',
					);
					ctx.pendingPythonExecs = ctx.pendingPythonExecs.filter(e => e.blockIndex !== blockIndex);
					ctx.pendingPythonExecs.push({ blockIndex, code: event.code, output: msg, hadError: true });
					ctx.renderState = 'RESUMING';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					ctx.renderState = 'READING';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					continue;
				}
				await this.executePythonFenceBlock(ctx, event.code, pendingBubble, token, blockIndex);
				if (token.isCancellationRequested) {
					ctx.renderState = 'CANCELLED';
					if (isSessionActive()) {
						this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
					}
					this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
					continue;
				}
				ctx.renderState = 'RESUMING';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				this.renderStreamingNow(ctx, pendingBubble, getThinking(), requestStartedAt);
				ctx.renderState = 'READING';
				if (isSessionActive()) {
					this.updateHeaderState(ctx.renderState, ctx.agentLoopCount);
				}
				continue;
			}
		}
	}

	private renderStreamingNow(
		ctx: HimAgentRunContext,
		pendingBubble: HTMLElement,
		thinking: string,
		requestStartedAt: number,
		lockMessage?: string,
	): void {
		this.ensureStreamingRowsInSessionMessageList(ctx.sessionId, pendingBubble);
		const cancelledWhileLocked = ctx.renderState === 'LOCKED' && ctx.activeRequestToken?.isCancellationRequested === true;
		let uiState: HimRenderState = cancelledWhileLocked ? 'CANCELLED' : ctx.renderState;
		if (!cancelledWhileLocked && ctx.orchestratedPlanStep && uiState === 'LOCKED') {
			uiState = 'CODING';
		}
		pendingBubble.dataset.himRenderState = uiState;
		const elapsedSec = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000));
		const mergedStream = this.stripStructuredBlocksForDisplay((ctx.planDisplayPrefix ?? '') + ctx.streamVisibleContent);
		/** Multi-step semantic/plan runs: avoid flashing per-step text and tool blocks; final message shows complete output. */
		const visibleAnswer = ctx.orchestratedPlanStep ? '' : mergedStream;
		const streamPy = ctx.orchestratedPlanStep ? [] : ctx.pendingPythonExecs;
		const streamSh = ctx.orchestratedPlanStep ? [] : ctx.pendingShellExecs;
		const streamSr = ctx.orchestratedPlanStep ? [] : ctx.pendingSearchExecs;
		const showLockBannerInBubble =
			!!lockMessage && !cancelledWhileLocked && !ctx.orchestratedPlanStep && (ctx.renderState === 'LOCKED');
		this.renderStreamingAssistantBubble(
			pendingBubble,
			ctx.orchestratedPlanStep ? '' : thinking,
			visibleAnswer,
			elapsedSec,
			showLockBannerInBubble ? lockMessage : undefined,
			streamPy,
			streamSh,
			streamSr,
			ctx.orchestratedPlanStep ? ctx.planWorkspaceRelativePath : undefined,
		);
		this.applySessionAgentDisplay(
			ctx.sessionId,
			uiState,
			uiState === 'LOCKED' ? lockMessage : undefined,
		);
	}

	private composeThinkingMarkdown(
		cfg: ResolvedChatConfig,
		providerMessages: ProviderMessage[],
		providerThinkingRaw: string | undefined,
		elapsedMs: number,
	): string {
		const providerThinking = providerThinkingRaw?.trim() ?? '';
		const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
		const runtimeLines: string[] = [
			`- Provider: **${providerLabel(cfg.provider)}**`,
			`- Model: \`${cfg.model}\``,
			`- Roundtrip: **${elapsedSec}s**`,
			`- Context messages: **${providerMessages.length}**`,
		];
		if (providerThinking) {
			return `### Runtime\n${runtimeLines.join('\n')}\n\n### Model Thinking\n${providerThinking}`;
		}
		return `### Runtime\n${runtimeLines.join('\n')}\n\n_No native thinking channel returned by this provider/model. Showing runtime trace only._`;
	}

	private setSendingState(isSending: boolean): void {
		this.isSending = isSending;
		this.scheduleMemoryMeterUpdate();
		this.updateSendButtonVisual();
		if (!isSending) {
			this.updateHeaderState('READING');
		}
		this.updateComposerForOrgNavMode();
	}

	private toProviderMessages(systemPrompt: string, historyTurns: number, cfg: ResolvedChatConfig): ProviderMessage[] {
		const result: ProviderMessage[] = [];

		const sysBase = systemPrompt.trim()
			? HIM_CORE_SYSTEM_PROMPT + '\n\n' + systemPrompt.trim()
			: HIM_CORE_SYSTEM_PROMPT;

		if (this.conversationSummary) {
			result.push({ role: 'system', content: sysBase + '\n\n## Conversation Summary (compressed)\n' + this.conversationSummary });
		} else {
			result.push({ role: 'system', content: sysBase });
		}

		const turns = Math.max(0, historyTurns);
		const history = turns === 0 ? [] : this.activeMessages().slice(-(turns * 2));
		for (const message of history) {
			result.push(this.viewMessageToProvider(message, cfg));
		}
		return result;
	}

	/** Phase 1: model outputs only `<him-semantic-program>` JSON (no tools). */
	private toProviderMessagesSemanticPhase1(
		systemPrompt: string,
		historyTurns: number,
		cfg: ResolvedChatConfig,
		baselineProgramJson?: string,
	): ProviderMessage[] {
		const defaultsBlock = [
			'## Host default global constraints (must appear in `program_metadata.global_constraints`)',
			...HIM_SEMANTIC_DEFAULT_GLOBAL_CONSTRAINTS.map(c => `- ${c}`),
		].join('\n');
		let withSemantic = (systemPrompt.trim()
			? HIM_CORE_SYSTEM_PROMPT + '\n\n' + systemPrompt.trim() + '\n\n' + defaultsBlock + HIM_SEMANTIC_PROGRAM_PHASE1_SUFFIX
			: HIM_CORE_SYSTEM_PROMPT + '\n\n' + defaultsBlock + HIM_SEMANTIC_PROGRAM_PHASE1_SUFFIX);
		if (baselineProgramJson?.trim()) {
			withSemantic +=
				'\n\n## Current program on disk (authoritative baseline)\n\nThe host seeds `agent_program.him` from this JSON before your reply. Return one **complete** updated program object inside `<him-semantic-program>` (not a patch).\n\n```json\n' +
				baselineProgramJson.trim() +
				'\n```';
		}
		const result: ProviderMessage[] = [];
		if (this.conversationSummary) {
			result.push({ role: 'system', content: withSemantic + '\n\n## Conversation Summary (compressed)\n' + this.conversationSummary });
		} else {
			result.push({ role: 'system', content: withSemantic });
		}
		const turns = Math.max(0, historyTurns);
		const history = turns === 0 ? [] : this.activeMessages().slice(-(turns * 2));
		for (const message of history) {
			result.push(this.viewMessageToProvider(message, cfg));
		}
		return result;
	}

	private resetSemanticPhase1StreamState(ctx: HimAgentRunContext, streamedThinking: { value: string }): void {
		streamedThinking.value = '';
		ctx.streamVisibleContent = '';
		ctx.ingestQueue.length = 0;
		ctx.tagParser.reset();
	}

	private normalizeSemanticProgramDocument(raw: HimSemanticProgramDocument, sessionId: string): HimSemanticProgramDocument | undefined {
		let parsed: unknown;
		try {
			parsed = JSON.parse(JSON.stringify(raw).replace(/__SESSION_ID__/g, sessionId));
		} catch {
			return undefined;
		}
		if (!validateSemanticProgramDocument(parsed)) {
			return undefined;
		}
		const doc = parsed as HimSemanticProgramDocument;
		const gc =
			doc.program_metadata.global_constraints.length > 0
				? [...doc.program_metadata.global_constraints]
				: [...HIM_SEMANTIC_DEFAULT_GLOBAL_CONSTRAINTS];
		/** Author output is non-authoritative for status until Runtime runs — normalize to PENDING on first load. */
		const instructions: Record<string, HimSemanticInstruction> = {};
		for (const [k, v] of Object.entries(doc.instructions)) {
			instructions[k] = { ...v, status: 'PENDING' };
		}
		return {
			...doc,
			session_id: sessionId,
			program_metadata: { ...doc.program_metadata, global_constraints: gc },
			instructions,
		};
	}

	private countSemanticChainSteps(doc: HimSemanticProgramDocument, startId: string, maxSteps: number): number {
		let n = 0;
		let id: string | null = startId;
		const seen = new Set<string>();
		while (id !== null && n < maxSteps) {
			if (seen.has(id)) {
				return Math.max(1, n);
			}
			seen.add(id);
			const ins: HimSemanticInstruction | undefined = doc.instructions[id];
			if (!ins) {
				break;
			}
			n++;
			id = ins.next_code;
		}
		return Math.max(1, n);
	}

	private buildSemanticCompilerUserMessage(doc: HimSemanticProgramDocument): string {
		return [
			`current_pointer: \`${doc.current_pointer}\``,
			'',
			'Full program JSON:',
			'```json',
			JSON.stringify(doc, null, 2),
			'```',
			'',
			'Audit only the instruction at `current_pointer` for the next execution step.',
		].join('\n');
	}

	/** Git `diff HEAD --numstat` map — only when `program_metadata.atomic_verify === "git_numstat"`. */
	private async tryGitNumstatVsHead(
		cwd: string,
		token: CancellationToken,
	): Promise<Map<string, { added: number; deleted: number }> | undefined> {
		try {
			const { stdout: inside } = await this.runShellCommand(
				HIM_INTERNAL_SHELL_SESSION_ID,
				'git rev-parse --is-inside-work-tree',
				cwd,
				token,
				() => { /* silent */ },
			);
			if (!/\btrue\b/i.test(inside)) {
				return undefined;
			}
			const { stdout, exitCode } = await this.runShellCommand(
				HIM_INTERNAL_SHELL_SESSION_ID,
				'git -c core.quotepath=false diff HEAD --numstat',
				cwd,
				token,
				() => { /* silent */ },
			);
			if (exitCode !== 0) {
				return undefined;
			}
			return parseGitNumstat(stdout || '');
		} catch {
			return undefined;
		}
	}

	private persistAssistantMessage(
		finalMsg: ViewMessage,
		currentSessionId: string | undefined,
		pendingBubble: HTMLElement | undefined,
		isSessionActive: () => boolean,
		semanticProgramDebugOverlay?: HimSemanticProgramDebugCard,
	): void {
		const msg: ViewMessage =
			semanticProgramDebugOverlay !== undefined
				? { ...finalMsg, semanticProgramDebug: semanticProgramDebugOverlay }
				: finalMsg;
		if (currentSessionId && pendingBubble) {
			this.ensureStreamingRowsInSessionMessageList(currentSessionId, pendingBubble);
		}
		if (isSessionActive()) {
			if (pendingBubble) {
				this.renderMessageInBubble(pendingBubble, msg);
			}
			this.activeMessages().push(msg);
			this.persistWorkspaceSessions();
		} else {
			const targetSession = this.sessions.find(s => s.id === currentSessionId);
			if (targetSession) {
				targetSession.messages.push(msg);
			}
			if (pendingBubble) {
				this.renderMessageInBubble(pendingBubble, msg);
			}
			this.persistWorkspaceSessions();
		}
	}

	private truncateForSemanticDebug(text: string, maxChars = HIM_SEMANTIC_DEBUG_MAX_FIELD_CHARS): string {
		const t = text ?? '';
		if (t.length <= maxChars) {
			return t;
		}
		const head = Math.max(1000, Math.floor(maxChars * 0.45));
		const tail = Math.max(1000, Math.floor(maxChars * 0.45));
		return `${t.slice(0, head)}\n\n… [${t.length - head - tail} chars omitted] …\n\n${t.slice(-tail)}`;
	}

	private formatMessagesForSemanticDebug(messages: ProviderMessage[]): string {
		const cap = HIM_SEMANTIC_DEBUG_MAX_PER_MESSAGE;
		return messages
			.map((m, i) => {
				const c = m.content;
				let body: string;
				if (typeof c === 'string') {
					body = c.length > cap ? `${c.slice(0, cap)}\n\n… [+${c.length - cap} chars omitted]` : c;
				} else {
					const raw = JSON.stringify(c);
					body = raw.length > cap ? `${raw.slice(0, cap)}\n\n… [+${raw.length - cap} chars omitted]` : raw;
				}
				return `### [${i + 1}] ${m.role}\n\n${body}`;
			})
			.join('\n\n---\n\n');
	}

	private appendSemanticDebugPre(parent: HTMLElement, label: string, text: string): void {
		const lab = append(parent, $('div.him-semantic-debug-pre-label')) as HTMLElement;
		lab.textContent = label;
		lab.style.fontSize = '10px';
		lab.style.fontWeight = '600';
		lab.style.color = 'var(--vscode-descriptionForeground)';
		lab.style.marginTop = '6px';
		lab.style.marginBottom = '2px';
		const pre = append(parent, $('pre.him-semantic-debug-pre')) as HTMLElement;
		pre.style.margin = '0';
		pre.style.padding = '6px 8px';
		pre.style.fontSize = '11px';
		pre.style.fontFamily = 'var(--vscode-editor-font-family)';
		pre.style.whiteSpace = 'pre-wrap';
		pre.style.wordBreak = 'break-word';
		pre.style.maxHeight = 'min(220px, 36vh)';
		pre.style.overflow = 'auto';
		pre.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 82%, transparent)';
		pre.style.border = '1px solid var(--vscode-widget-border)';
		pre.style.borderRadius = '4px';
		pre.textContent = text || '(empty)';
	}

	private renderSemanticProgramDebugShell(bubble: HTMLElement, card: HimSemanticProgramDebugCard): void {
		const shell = append(bubble, $('div.him-semantic-debug-shell'));
		shell.style.marginBottom = '8px';
		shell.style.border = '1px solid var(--vscode-widget-border)';
		shell.style.borderRadius = '8px';
		shell.style.overflow = 'hidden';
		shell.style.background = 'color-mix(in srgb, var(--vscode-editor-inactiveSelectionBackground, var(--vscode-list-inactiveSelectionBackground)) 35%, transparent)';

		const headBtn = append(shell, $('button.him-semantic-debug-toggle')) as HTMLButtonElement;
		headBtn.type = 'button';
		headBtn.style.width = '100%';
		headBtn.style.border = '0';
		headBtn.style.background = 'color-mix(in srgb, var(--vscode-editorWidget-background) 70%, transparent)';
		headBtn.style.color = 'var(--vscode-descriptionForeground)';
		headBtn.style.display = 'flex';
		headBtn.style.alignItems = 'center';
		headBtn.style.justifyContent = 'space-between';
		headBtn.style.padding = '8px 10px';
		headBtn.style.cursor = 'pointer';
		headBtn.style.fontSize = '11px';
		headBtn.style.fontWeight = '600';
		const headLabel = append(headBtn, $('span'));
		headLabel.textContent = card.title;
		const headIcon = append(headBtn, $('span.codicon.codicon-chevron-right')) as HTMLElement;
		headIcon.style.opacity = '0.85';

		const body = append(shell, $('div.him-semantic-debug-body')) as HTMLElement;
		body.style.display = 'none';
		body.style.padding = '8px 10px 10px';
		body.style.borderTop = '1px solid var(--vscode-widget-border)';
		body.style.maxHeight = 'min(480px, 62vh)';
		body.style.overflowY = 'auto';

		if (card.subtitle?.trim()) {
			const sub = append(body, $('div.him-semantic-debug-sub'));
			sub.style.fontSize = '10px';
			sub.style.color = 'var(--vscode-descriptionForeground)';
			sub.style.marginBottom = '8px';
			sub.style.lineHeight = '1.35';
			sub.textContent = card.subtitle.trim();
		}
		if (card.parseHint?.trim()) {
			const hint = append(body, $('div.him-semantic-debug-parse-hint'));
			hint.style.fontSize = '11px';
			hint.style.color = 'var(--vscode-errorForeground)';
			hint.style.marginBottom = '8px';
			hint.style.lineHeight = '1.35';
			hint.textContent = card.parseHint.trim();
		}
		if (card.rawTagInnerPreview?.trim()) {
			this.appendSemanticDebugPre(
				body,
				localize('himSemanticDebugInnerTag', 'Extracted `<him-semantic-program>` inner text (preview)'),
				card.rawTagInnerPreview,
			);
		}
		if (card.rawMergedBlobPreview?.trim()) {
			this.appendSemanticDebugPre(
				body,
				localize('himSemanticDebugMergedBlob', 'Merged parse blob (thinking + visible + answer; preview)'),
				card.rawMergedBlobPreview,
			);
		}

		let turnIdx = 0;
		for (const turn of card.turns) {
			turnIdx++;
			const turnWrap = append(body, $('div.him-semantic-debug-turn'));
			turnWrap.style.marginTop = turnIdx > 1 ? '10px' : '4px';
			turnWrap.style.borderTop = turnIdx > 1 ? '1px solid var(--vscode-widget-border)' : '0';
			turnWrap.style.paddingTop = turnIdx > 1 ? '10px' : '0';

			const tBtn = append(turnWrap, $('button.him-semantic-debug-turn-toggle')) as HTMLButtonElement;
			tBtn.type = 'button';
			tBtn.style.width = '100%';
			tBtn.style.border = '0';
			tBtn.style.background = 'transparent';
			tBtn.style.color = 'var(--vscode-foreground)';
			tBtn.style.display = 'flex';
			tBtn.style.alignItems = 'center';
			tBtn.style.justifyContent = 'space-between';
			tBtn.style.padding = '4px 0';
			tBtn.style.cursor = 'pointer';
			tBtn.style.fontSize = '11px';
			tBtn.style.fontWeight = '600';
			const tLab = append(tBtn, $('span'));
			tLab.textContent = turn.stepLabel;
			const tIc = append(tBtn, $('span.codicon.codicon-chevron-right')) as HTMLElement;
			tIc.style.opacity = '0.75';

			const tBody = append(turnWrap, $('div.him-semantic-debug-turn-body')) as HTMLElement;
			tBody.style.display = 'none';
			tBody.style.paddingLeft = '4px';
			if (turn.notes?.trim()) {
				const n = append(tBody, $('div'));
				n.style.fontSize = '10px';
				n.style.color = 'var(--vscode-descriptionForeground)';
				n.style.marginBottom = '6px';
				n.textContent = turn.notes.trim();
			}
			this.appendSemanticDebugPre(tBody, localize('himSemanticDebugInput', 'Model input (messages)'), turn.inputText);
			this.appendSemanticDebugPre(tBody, localize('himSemanticDebugOutput', 'Model output (text)'), turn.outputText);
			if (turn.outputThinking?.trim()) {
				this.appendSemanticDebugPre(
					tBody,
					localize('himSemanticDebugOutputThinking', 'Model output (thinking / reasoning)'),
					turn.outputThinking,
				);
			}

			tBtn.addEventListener('click', () => {
				const open = tBody.style.display === 'none';
				tBody.style.display = open ? 'block' : 'none';
				tIc.className = open ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
			});
		}

		let shellOpen = false;
		headBtn.addEventListener('click', () => {
			shellOpen = !shellOpen;
			body.style.display = shellOpen ? 'block' : 'none';
			headIcon.className = shellOpen ? 'codicon codicon-chevron-down' : 'codicon codicon-chevron-right';
		});
	}

	private async runSemanticProgramPipeline(
		semDoc: HimSemanticProgramDocument,
		cfg: ResolvedChatConfig,
		conversationMessages: ProviderMessage[],
		phase1Ctx: HimAgentRunContext,
		streamedThinking: { value: string },
		requestToken: CancellationToken,
		pendingBubble: HTMLElement | undefined,
		requestStartedAt: number,
		isSessionActive: () => boolean,
		currentSessionId: string | undefined,
		maxSemanticSteps: number,
		debugCard: HimSemanticProgramDebugCard | undefined,
	): Promise<void> {
		const sessionId = currentSessionId ?? 'default';
		const persistSemantic = (m: ViewMessage) =>
			this.persistAssistantMessage(m, currentSessionId, pendingBubble, isSessionActive, debugCard);
		const docNorm = this.normalizeSemanticProgramDocument(semDoc, sessionId);
		if (!docNorm) {
			const err = 'Semantic program: could not normalize session id or validate document.';
			const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
			persistSemantic({
				role: 'assistant',
				content: err,
				thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
				thinkingDurationMs: elapsedMs,
				isError: true,
			});
			return;
		}
		let doc = docNorm;
		if (!validateInstructionGraph(doc)) {
			const err = 'Semantic program: invalid instruction graph (`current_pointer` or `next_code` references).';
			const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
			persistSemantic({
				role: 'assistant',
				content: err,
				thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
				thinkingDurationMs: elapsedMs,
				isError: true,
			});
			return;
		}

		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			const err =
				'Semantic program: open a **folder workspace** (File → Open Folder). The host persists `agent_program.him` under application workspace storage (outside the repository).';
			const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
			persistSemantic({
				role: 'assistant',
				content: err,
				thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
				thinkingDurationMs: elapsedMs,
				isError: true,
			});
			return;
		}

		const programRelPath = formatHimPlanPromptPath(sessionId, HIM_SEMANTIC_PROGRAM_FILENAME);
		const programUri = getSemanticProgramUri(this.getHimHostDataRoot(), sessionId);
		try {
			await writeSemanticProgram(this.fileService, programUri, doc);
		} catch (e) {
			const err = `Semantic program: could not write \`${programRelPath}\`: ${this.toErrorMessage(e)}`;
			const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
			persistSemantic({
				role: 'assistant',
				content: err,
				thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
				thinkingDurationMs: elapsedMs,
				isError: true,
			});
			return;
		}

		const allPy = [...phase1Ctx.pendingPythonExecs];
		const allSh = [...phase1Ctx.pendingShellExecs];
		const allSr = [...phase1Ctx.pendingSearchExecs];
		let displayAccum = this.stripStructuredBlocksForDisplay(
			((phase1Ctx.planDisplayPrefix ?? '') + phase1Ctx.streamVisibleContent).trim(),
		).trim();
		let lastAnswer: ProviderResponsePayload = { text: '' };

		let completedSteps = 0;
		let stoppedByAtomic = false;
		for (let guard = 0; guard < maxSemanticSteps * 6 && !requestToken.isCancellationRequested; guard++) {
			const ptr = doc.current_pointer;
			const inst = doc.instructions[ptr];
			if (!inst) {
				const err = `Semantic program: missing instruction for current_pointer "${ptr}".`;
				const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
				persistSemantic({
					role: 'assistant',
					content: err,
					thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
					thinkingDurationMs: elapsedMs,
					isError: true,
				});
				return;
			}

			let auditPass = false;
			for (let c = 0; c < 16; c++) {
				const compilerMessages: ProviderMessage[] = [
					{ role: 'system', content: HIM_SEMANTIC_COMPILER_SYSTEM },
					{ role: 'user', content: this.buildSemanticCompilerUserMessage(doc) },
				];
				const compilerResp = await this.requestProvider(cfg, compilerMessages, requestToken);
				if (debugCard) {
					debugCard.turns.push({
						stepLabel: localize('himSemanticDebugCompiler', 'Compiler — `{0}` (attempt {1})', ptr, String(c + 1)),
						inputText: this.formatMessagesForSemanticDebug(compilerMessages),
						outputText: this.truncateForSemanticDebug(compilerResp.text ?? ''),
						outputThinking: compilerResp.thinking?.trim()
							? this.truncateForSemanticDebug(compilerResp.thinking)
							: undefined,
						notes: localize(
							'himSemanticDebugCompilerNote',
							'Expect JSON: decision, reason; optional updated_instructions / next_current_pointer.',
						),
					});
				}
				const parsed = parseCompilerResult(compilerResp.text ?? '');
				if (!parsed) {
					const err = 'Semantic program: compiler returned unparsable JSON.';
					const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
					persistSemantic({
						role: 'assistant',
						content: err,
						thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
						thinkingDurationMs: elapsedMs,
						isError: true,
					});
					return;
				}
				if (parsed.decision === 'REJECT') {
					const err = `Semantic program (compiler): ${parsed.reason}`;
					const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
					persistSemantic({
						role: 'assistant',
						content: err,
						thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
						thinkingDurationMs: elapsedMs,
						isError: true,
					});
					return;
				}
				if (parsed.decision === 'REFACTOR_PLAN') {
					const merged = applyCompilerRefactor(doc, parsed);
					if (!merged) {
						const err = 'Semantic program: compiler REFACTOR_PLAN could not be applied.';
						const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
						persistSemantic({
							role: 'assistant',
							content: err,
							thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
							thinkingDurationMs: elapsedMs,
							isError: true,
						});
						return;
					}
					doc = merged;
					if (programUri) {
						try {
							await writeSemanticProgram(this.fileService, programUri, doc);
						} catch {
							// ignore
						}
					}
					continue;
				}
				auditPass = true;
				break;
			}
			if (!auditPass) {
				const err = 'Semantic program: compiler did not reach AUDIT_PASS.';
				const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
				persistSemantic({
					role: 'assistant',
					content: err,
					thinking: this.composeThinkingMarkdown(cfg, conversationMessages, streamedThinking.value || undefined, elapsedMs),
					thinkingDurationMs: elapsedMs,
					isError: true,
				});
				return;
			}

			if (isSessionActive()) {
				this.updateHeaderState('CODING', completedSteps + 1);
			}

			const totalChain = this.countSemanticChainSteps(doc, doc.current_pointer, maxSemanticSteps);
			const stepUser = buildSemanticStepUserMessage(ptr, inst, completedSteps, totalChain, {
				programFileRelativePath: programRelPath,
				extraSystemHints: HIM_ATOMIC_PLAN_RULES,
			});
			conversationMessages.push({ role: 'user', content: stepUser });

			const prefix = displayAccum ? `${displayAccum}\n\n---\n\n` : '';
			let ctx = createAgentRunContext(sessionId);
			ctx.orchestratedPlanStep = true;
			ctx.planDisplayPrefix = prefix;
			ctx.planWorkspaceRelativePath = programRelPath;
			if (currentSessionId && pendingBubble) {
				this.streamingUiFlushBySessionId.set(currentSessionId, () => {
					if (requestToken.isCancellationRequested) {
						return;
					}
					this.ensureStreamingRowsInSessionMessageList(currentSessionId, pendingBubble);
					this.renderStreamingNow(ctx, pendingBubble, streamedThinking.value, requestStartedAt);
				});
			}

			inst.status = 'RUNNING';
			const useGitNumstat = (doc.program_metadata.atomic_verify ?? 'none') === 'git_numstat';
			let numstatBefore: Map<string, { added: number; deleted: number }> | undefined;
			let numstatAfter: Map<string, { added: number; deleted: number }> | undefined;
			if (useGitNumstat && folder !== undefined) {
				numstatBefore = await this.tryGitNumstatVsHead(folder.uri.fsPath, requestToken);
			}

			const stepResult = await this.runAgentRequestAndToolLoop(
				ctx,
				cfg,
				conversationMessages,
				requestToken,
				pendingBubble,
				streamedThinking,
				requestStartedAt,
				isSessionActive,
			);
			lastAnswer = stepResult.answer;
			if (debugCard) {
				const outCombined = [stepResult.roundContent, ctx.streamVisibleContent].filter(Boolean).join('\n---\n');
				debugCard.turns.push({
					stepLabel: localize('himSemanticDebugCodegen', 'Codegen — step {0} · `{1}`', String(completedSteps + 1), ptr),
					inputText: this.formatMessagesForSemanticDebug(conversationMessages),
					outputText: this.truncateForSemanticDebug(outCombined),
					outputThinking: stepResult.answer.thinking?.trim()
						? this.truncateForSemanticDebug(stepResult.answer.thinking)
						: undefined,
					notes: useGitNumstat
						? localize('himSemanticDebugAtomicGit', 'atomic_verify: git_numstat — compared before/after this step.')
						: undefined,
				});
			}
			for (const e of ctx.pendingPythonExecs) {
				allPy.push(e);
			}
			for (const e of ctx.pendingShellExecs) {
				allSh.push(e);
			}
			for (const e of ctx.pendingSearchExecs) {
				allSr.push(e);
			}
			const stepVisible = (ctx.planDisplayPrefix ?? '') + ctx.streamVisibleContent.trim();
			displayAccum = stepVisible;

			if (useGitNumstat && folder !== undefined) {
				numstatAfter = await this.tryGitNumstatVsHead(folder.uri.fsPath, requestToken);
			}

			let atomicOk = true;
			if (useGitNumstat) {
				if (numstatBefore === undefined || numstatAfter === undefined) {
					atomicOk = false;
					inst.status = 'FAILED';
					displayAccum = `${displayAccum}\n\n---\n\n[Runtime] program_metadata.atomic_verify is "git_numstat" but git numstat could not be captured (not a git repository or git failed).`;
				} else {
					const d = deltaNumstat(numstatBefore, numstatAfter);
					const verdict = evaluateAtomicCodegenStep(d);
					if (!verdict.ok) {
						atomicOk = false;
						inst.status = 'FAILED';
						displayAccum = `${displayAccum}\n\n---\n\n[Runtime] ${verdict.reason}`;
					}
				}
			}
			if (atomicOk) {
				inst.status = 'SUCCEEDED';
			}

			const nextPtr = inst.next_code;
			if (programUri) {
				try {
					await writeSemanticProgram(this.fileService, programUri, doc);
				} catch {
					// ignore
				}
			}

			completedSteps++;

			if (!atomicOk) {
				stoppedByAtomic = true;
				break;
			}

			if (nextPtr === null) {
				break;
			}
			doc.current_pointer = nextPtr;
		}

		const elapsedMs = Math.max(0, Date.now() - requestStartedAt);
		const rawContent =
			this.stripStructuredBlocksForDisplay(displayAccum.trim()) ||
			(lastAnswer.text || '').trim() ||
			'(Empty response)';
		const mergedThinkingRaw = (streamedThinking.value || lastAnswer.thinking || '').trim();
		const thinking = this.composeThinkingMarkdown(cfg, conversationMessages, mergedThinkingRaw || undefined, elapsedMs);
		if (debugCard) {
			if (stoppedByAtomic) {
				debugCard.title = localize('himSemanticDebugTitleAtomicStop', 'Debug — Semantic program · Stopped (atomic verify)');
			} else {
				debugCard.title = localize('himSemanticDebugTitleDone', 'Debug — Semantic program · Completed');
			}
		}
		persistSemantic({
			role: 'assistant',
			content: rawContent,
			thinking,
			thinkingDurationMs: elapsedMs,
			pythonExecutions: allPy.length > 0 ? allPy : undefined,
			shellExecutions: allSh.length > 0 ? allSh : undefined,
			searchExecutions: allSr.length > 0 ? allSr : undefined,
			isError: stoppedByAtomic,
		});
	}

	/**
	 * One provider request plus the usual tool-observation loop until idle.
	 * Appends the final assistant reply to `conversationMessages` when the last message is still `user`.
	 * When `enableToolObservationLoop` is false (semantic phase 1: author emits `<him-semantic-program>` only),
	 * runs a single round — no `[HIM Code Execution Result]` follow-up requests.
	 */
	private async runAgentRequestAndToolLoop(
		ctx: HimAgentRunContext,
		cfg: ResolvedChatConfig,
		conversationMessages: ProviderMessage[],
		requestToken: CancellationToken,
		pendingBubble: HTMLElement | undefined,
		streamedThinking: { value: string },
		requestStartedAt: number,
		isSessionActive: () => boolean,
		options?: { enableToolObservationLoop?: boolean },
	): Promise<{ roundContent: string; answer: ProviderResponsePayload }> {
		const enableToolObservationLoop = options?.enableToolObservationLoop !== false;
		ctx.activeRequestToken = requestToken;
		let shellExecWaitPromise: Promise<void> | undefined;
		let shellExecWaitResolve: (() => void) | undefined;
		const wakeShellWaiter = () => {
			if (shellExecWaitResolve) {
				const resolve = shellExecWaitResolve;
				shellExecWaitResolve = undefined;
				shellExecWaitPromise = undefined;
				resolve();
			}
		};
		ctx.notifyShellExecDone = () => {
			wakeShellWaiter();
		};

		let roundContent = '';
		const streamContent = (delta: HimStreamDelta) => {
			if (delta.text) {
				roundContent += delta.text;
				ctx.ingestQueue.push(delta.text);
			}
			if (delta.thinking) {
				streamedThinking.value += delta.thinking ?? '';
			}
			if (pendingBubble && !requestToken.isCancellationRequested) {
				ctx.pythonExecQueue = ctx.pythonExecQueue.then(() =>
					this.processIngestionQueue(
						ctx,
						pendingBubble,
						requestToken,
						() => streamedThinking.value,
						requestStartedAt,
						isSessionActive,
					));
			}
		};

		let answer = await this.requestProvider(cfg, conversationMessages, requestToken, streamContent);
		let tailEvents = ctx.tagParser.flushRemainder();
		if (pendingBubble && !requestToken.isCancellationRequested) {
			ctx.pythonExecQueue = ctx.pythonExecQueue.then(() =>
				this.processTagEvents(
					ctx,
					tailEvents,
					pendingBubble,
					requestToken,
					() => streamedThinking.value,
					requestStartedAt,
					isSessionActive,
				));
		}
		await ctx.pythonExecQueue;

		// Phase 1: no observation follow-ups — still drain in-flight shells from the streamed reply.
		if (!enableToolObservationLoop) {
			while (ctx.shellExecInFlight > 0 && !requestToken.isCancellationRequested) {
				await new Promise<void>(r => setTimeout(r, 40));
			}
		}

		if (enableToolObservationLoop) {
			let prevPyCount = 0;
			let prevShCount = 0;
			let prevSearchCount = 0;
			while (true) {
				if (requestToken.isCancellationRequested) { break; }
				const newPyExecs = ctx.pendingPythonExecs.slice(prevPyCount);
				const newShExecs = ctx.pendingShellExecs.slice(prevShCount);
				const newSearchExecs = ctx.pendingSearchExecs.slice(prevSearchCount);
				if (newPyExecs.length === 0 && newShExecs.length === 0 && newSearchExecs.length === 0) {
					if (ctx.shellExecInFlight > 0) {
						if (!shellExecWaitPromise) {
							shellExecWaitPromise = new Promise<void>(resolve => {
								shellExecWaitResolve = resolve;
							});
						}
						const hasNewSh = ctx.pendingShellExecs.length !== prevShCount;
						const hasNewSearch = ctx.pendingSearchExecs.length !== prevSearchCount;
						if (hasNewSh || hasNewSearch || ctx.shellExecInFlight <= 0) {
							wakeShellWaiter();
						}
						await shellExecWaitPromise;
						continue;
					}
					break;
				}

				ctx.agentLoopCount++;
				prevPyCount = ctx.pendingPythonExecs.length;
				prevShCount = ctx.pendingShellExecs.length;
				prevSearchCount = ctx.pendingSearchExecs.length;

				const parts: string[] = [];
				for (const e of newPyExecs) {
					parts.push(`[Python Block ${e.blockIndex + 1} ${e.hadError ? 'ERROR' : 'OK'}]\n${e.output || '(no output)'}`);
				}
				for (const e of newShExecs) {
					parts.push(`[Shell: ${e.command} → exit ${e.exitCode}]\n${e.output || '(no output)'}`);
				}
				for (const e of newSearchExecs) {
					parts.push(`[Search: ${e.query}]\n${e.output || '(no output)'}`);
				}
				const observation = parts.join('\n\n');

				if (isSessionActive()) {
					this.updateHeaderState('CODING', ctx.agentLoopCount);
				}
				if (pendingBubble) {
					this.renderStreamingNow(ctx, pendingBubble, streamedThinking.value, requestStartedAt);
				}

				conversationMessages.push({ role: 'assistant', content: roundContent });
				conversationMessages.push({
					role: 'user',
					content: `[HIM Code Execution Result]\n${observation}\n\nContinue your task. If complete, respond with a final text summary (no <him-python> or <him-shell>).`,
				});

				roundContent = '';
				ctx.tagParser.reset();
				ctx.ingestQueue = [];

				answer = await this.requestProvider(cfg, conversationMessages, requestToken, streamContent);
				tailEvents = ctx.tagParser.flushRemainder();
				if (pendingBubble && !requestToken.isCancellationRequested) {
					ctx.pythonExecQueue = ctx.pythonExecQueue.then(() =>
						this.processTagEvents(
							ctx,
							tailEvents,
							pendingBubble,
							requestToken,
							() => streamedThinking.value,
							requestStartedAt,
							isSessionActive,
						));
				}
				await ctx.pythonExecQueue;
			}
		}

		const lastMsg = conversationMessages[conversationMessages.length - 1];
		const finalText = ctx.streamVisibleContent.trim() || roundContent.trim();
		if (finalText && lastMsg?.role === 'user') {
			conversationMessages.push({ role: 'assistant', content: finalText });
		}

		return { roundContent, answer };
	}

	private async maybeCompressConversation(): Promise<void> {
		await this.runConversationCompression();
	}

	private async runConversationCompression(): Promise<void> {
		const session = this.sessions[this.activeSessionIdx];
		const mv = session?.messages;
		if (!mv) {
			return;
		}
		const totalTurns = Math.floor(mv.length / 2);
		if (totalTurns < COMPRESS_THRESHOLD_TURNS || this.isCompressing) {
			return;
		}

		const keepCount = COMPRESS_KEEP_RECENT_TURNS * 2;
		const messagesToCompress = mv.slice(0, mv.length - keepCount);
		if (messagesToCompress.length < 4) {
			return;
		}

		this.isCompressing = true;
		this.scheduleMemoryMeterUpdate();
		try {
			const cfg = await this.resolveChatConfig();
			const compressPrompt: ProviderMessage[] = [
				{
					role: 'system',
					content: [
						'You are a conversation summarizer. Compress the following conversation history into a concise summary.',
						'Preserve key decisions, code changes, file paths, errors encountered, and their resolutions.',
						'Keep technical details (function names, variable names, file paths) intact.',
						'Output ONLY the summary text, no preamble.',
						'Target length: 300-600 words.',
					].join('\n'),
				},
			];

			let conversationText = '';
			if (this.conversationSummary) {
				conversationText += `[Previous Summary]\n${this.conversationSummary}\n\n[New Messages to Compress]\n`;
			}
			for (const msg of messagesToCompress) {
				const role = msg.role === 'user' ? 'User' : 'Assistant';
				const text = msg.content.length > 2000 ? msg.content.slice(0, 2000) + '…(truncated)' : msg.content;
				conversationText += `${role}: ${text}\n\n`;
			}

			compressPrompt.push({ role: 'user', content: `Summarize this conversation:\n\n${conversationText}` });

			const response = await this.requestProvider(cfg, compressPrompt, CancellationToken.None);
			const summary = (response.text ?? '').trim();

			if (summary.length > 50) {
				this.conversationSummary = summary;
				mv.splice(0, messagesToCompress.length);
				if (session) {
					session.conversationSummary = this.conversationSummary;
				}
				this.persistWorkspaceSessions();
			}
		} catch {
			// Compression failure is non-critical
		} finally {
			this.isCompressing = false;
			this.scheduleMemoryMeterUpdate();
		}
	}

	private async openQuickActions(): Promise<void> {
		const actions: IQuickPickItem[] = [
			{ id: 'quoteSelection', label: 'Quote Selected Code' },
			{ id: 'referenceActiveFile', label: 'Reference Active File' },
			{ id: 'openSettings', label: 'Open HIM CODE Settings' },
			{ id: 'clearChat', label: 'Clear Chat History' },
		];
		const picked = await this.quickInputService.pick(actions, { placeHolder: 'Choose HIM CODE action' });
		switch (picked?.id) {
			case 'quoteSelection':
				await this.insertSelectedCodeReference();
				break;
			case 'referenceActiveFile':
				await this.insertActiveFileReference();
				break;
			case 'openSettings':
				await this.openModelSettings();
				break;
			case 'clearChat':
				this.clearConversation();
				break;
		}
	}

	private clearConversation(): void {
		const session = this.sessions[this.activeSessionIdx];
		if (session) {
			session.messages.length = 0;
			session.conversationSummary = '';
		}
		this.conversationSummary = '';
		this.disposeAllRenderedMarkdown();
		const w = session ? this.sessionPaneById.get(session.id) : undefined;
		if (w) {
			clearNode(w.messageList);
			this.messageListElement = w.messageList;
			this.renderWelcomeMessage(session);
		} else if (this.messageListElement) {
			clearNode(this.messageListElement);
			this.renderWelcomeMessage(this.sessions[this.activeSessionIdx]);
		}
		this.persistWorkspaceSessions();
	}

	private async refreshConfigDependentUi(): Promise<void> {
		const selectedCustomModelId = this.getSelectedCustomModelId();
		const selectedCustomModel = this.getCustomModels().find(model => model.id === selectedCustomModelId);
		this.activeCustomModelId = selectedCustomModel?.id ?? (this.getCustomModels()[0]?.id ?? '');
		this.renderProviderButton(selectedCustomModel ?? this.getCustomModels()[0]);
	}

	private renderProviderButton(activeCustomModel?: CustomModelConfig): void {
		if (!this.providerSelectElement) {
			return;
		}
		clearNode(this.providerSelectElement);
		const label = append(this.providerSelectElement, $('span.him-chat-provider-label'));
		label.textContent = activeCustomModel ? providerLabel(activeCustomModel.provider) : 'Model';
		const chevron = append(this.providerSelectElement, $('span.codicon.codicon-chevron-down'));
		chevron.style.opacity = '0.65';
		chevron.style.flexShrink = '0';
	}

	private async toggleProviderMenu(): Promise<void> {
		if (!this.providerMenuElement) {
			return;
		}
		if (this.providerMenuElement.style.display === 'flex') {
			this.hideProviderMenu();
			return;
		}
		this.positionProviderMenu();
		this.providerMenuElement.style.display = 'flex';
		if (this.providerMenuSearchInput) {
			this.providerMenuSearchInput.value = '';
		}
		await this.renderProviderMenuList('');
		if (this.providerMenuSearchInput) {
			this.providerMenuSearchInput.focus();
		}
	}

	private hideProviderMenu(): void {
		if (this.providerMenuElement) {
			this.providerMenuElement.style.display = 'none';
		}
	}

	private positionProviderMenu(): void {
		if (!this.providerMenuElement) {
			return;
		}
		const anchor = this.providerMenuElement.parentElement as HTMLElement | null;
		if (!anchor) {
			return;
		}
		const anchorRect = anchor.getBoundingClientRect();
		const desiredHeight = 320;
		const minHeight = 180;
		const safeMargin = 12;
		const spaceAbove = Math.max(0, anchorRect.top - safeMargin);
		const spaceBelow = Math.max(0, window.innerHeight - anchorRect.bottom - safeMargin);
		const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
		const available = Math.max(minHeight, Math.min(desiredHeight, openUp ? spaceAbove : spaceBelow));
		this.providerMenuElement.style.maxHeight = `${Math.floor(available)}px`;

		// Horizontal position: align with anchor, clamped to viewport.
		const desiredLeft = anchorRect.left;
		const maxLeft = window.innerWidth - 8 - this.providerMenuElement.offsetWidth;
		const safeLeft = Math.max(8, Math.min(maxLeft, desiredLeft));
		this.providerMenuElement.style.left = `${Math.floor(safeLeft)}px`;

		// Vertical position: open up or down from anchor, in viewport coordinates.
		if (openUp) {
			const bottom = window.innerHeight - anchorRect.top + 6;
			this.providerMenuElement.style.bottom = `${Math.floor(bottom)}px`;
			this.providerMenuElement.style.top = 'auto';
		} else {
			const top = anchorRect.bottom + 6;
			this.providerMenuElement.style.top = `${Math.floor(top)}px`;
			this.providerMenuElement.style.bottom = 'auto';
		}
	}

	private async renderProviderMenuList(filterText: string): Promise<void> {
		if (!this.providerMenuListElement) {
			return;
		}
		clearNode(this.providerMenuListElement);
		const normalizedFilter = filterText.trim().toLowerCase();

		const customModels = this.getCustomModels();
		if (!customModels.length) {
			const emptyRow = append(this.providerMenuListElement, $('div.him-chat-provider-empty'));
			emptyRow.textContent = 'No models configured. Click Add Models.';
			emptyRow.style.fontSize = '12px';
			emptyRow.style.opacity = '0.75';
			emptyRow.style.padding = '10px 8px';
			return;
		}

		for (const customModel of customModels) {
			const searchable = `${customModel.provider} ${customModel.model} ${customModel.baseUrl}`.toLowerCase();
			if (normalizedFilter && !searchable.includes(normalizedFilter)) {
				continue;
			}

			const item = append(this.providerMenuListElement, $('button.him-chat-provider-option')) as HTMLButtonElement;
			item.style.width = '100%';
			item.style.border = '0';
			item.style.borderRadius = '8px';
			item.style.padding = '8px 10px';
			item.style.margin = '2px 0';
			item.style.background = customModel.id === this.activeCustomModelId
				? 'color-mix(in srgb, var(--vscode-editorWidget-background) 80%, transparent)'
				: 'transparent';
			item.style.color = 'var(--vscode-foreground)';
			item.style.textAlign = 'left';
			item.style.cursor = 'pointer';
			item.style.display = 'flex';
			item.style.flexDirection = 'column';
			item.style.gap = '2px';

			const title = append(item, $('span.him-chat-provider-option-title'));
			title.textContent = `${providerLabel(customModel.provider)}  ${customModel.model}`;
			title.style.fontSize = '14px';
			title.style.fontWeight = customModel.id === this.activeCustomModelId ? '600' : '500';

			const detail = append(item, $('span.him-chat-provider-option-detail'));
			const baseUrl = customModel.baseUrl || resolveBaseUrl(customModel.provider, '');
			detail.textContent = `${baseUrl}  ·  ${customModel.apiKey ? 'API key configured' : 'API key missing'}`;
			detail.style.fontSize = '12px';
			detail.style.opacity = '0.8';

			item.addEventListener('click', async () => {
				await this.configurationService.updateValue(`${CONFIG_ROOT}.selectedModelId`, customModel.id);
				await this.configurationService.updateValue(`${CONFIG_ROOT}.provider`, customModel.provider);
				this.activeCustomModelId = customModel.id;
				this.renderProviderButton(customModel);
				this.hideProviderMenu();
			});
		}
	}

	private async openModelSettings(): Promise<void> {
		try {
			await this.commandService.executeCommand('himChat.openModelSettings');
		} catch {
			await this.commandService.executeCommand('workbench.action.openSettings', CONFIG_ROOT);
		}
	}

	private updateSendButtonVisual(): void {
		if (!this.sendButtonElement) {
			return;
		}
		clearNode(this.sendButtonElement);
		this.sendButtonElement.classList.toggle('him-cursor-send-btn--stop', this.isSending);
		if (this.isSending) {
			append(this.sendButtonElement, $('span.him-cursor-stop-square'));
		} else {
			const kbd = append(this.sendButtonElement, $('span.him-cursor-send-kbd')) as HTMLElement;
			kbd.textContent = isMacintosh ? '⌘␣↵' : '^␣↵';
		}
	}

	private updateVoiceButtonVisual(): void {
		if (!this.micButtonElement) {
			return;
		}
		clearNode(this.micButtonElement);
		append(this.micButtonElement, $('span.codicon.codicon-mic'));
		const active = this.isVoiceListening || this.voiceWhisperTranscribing;
		this.micButtonElement.style.background = active
			? 'color-mix(in srgb, var(--vscode-button-background) 28%, transparent)'
			: '';
	}

	private isWhisperApiConfigured(): boolean {
		const url = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionUrl`) ?? '').trim();
		const key = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionApiKey`) ?? '').trim();
		return Boolean(url && key && /^https?:\/\//i.test(url));
	}

	private async promptConfigureWhisperApi(): Promise<void> {
		const { result } = await this.dialogService.prompt<'settings' | undefined>({
			type: Severity.Info,
			message: localize('himChatVoiceApiConfigureTitle', 'Voice input not configured'),
			detail: localize(
				'himChatVoiceApiConfigureDetail',
				'Set {0} and {1}. Example URL: https://api.openai.com/v1/audio/transcriptions',
				'`himCode.chat.voiceTranscriptionUrl`',
				'`himCode.chat.voiceTranscriptionApiKey`',
			),
			buttons: [
				{
					label: localize('himChatVoiceApiOpenSettings', 'Open settings'),
					run: () => 'settings' as const,
				},
			],
			cancelButton: true,
		});
		if (result === 'settings') {
			try {
				await this.commandService.executeCommand('workbench.action.openSettings', `${CONFIG_ROOT}.voiceTranscription`);
			} catch {
				await this.commandService.executeCommand('workbench.action.openSettings', CONFIG_ROOT);
			}
		}
	}

	private async transcribeWavViaWhisperApi(wav: Uint8Array): Promise<{ ok: boolean; text?: string; error?: string }> {
		const url = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionUrl`) ?? '').trim();
		const apiKey = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionApiKey`) ?? '').trim();
		const model = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionModel`) ?? 'whisper-1').trim() || 'whisper-1';
		const language = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.voiceTranscriptionLanguage`) ?? '').trim();
		const timeoutMs = Math.max(10_000, this.configurationService.getValue<number>(`${CONFIG_ROOT}.timeoutMs`) ?? 120_000);
		if (!url || !apiKey) {
			return { ok: false, error: localize('himChatVoiceApiNotConfigured', 'Voice transcription URL or API key is not configured.') };
		}
		try {
			const wavCopy = new Uint8Array(wav.byteLength);
			wavCopy.set(wav);
			const form = new FormData();
			form.append('file', new Blob([wavCopy], { type: 'audio/wav' }), 'audio.wav');
			form.append('model', model);
			if (language) {
				form.append('language', language);
			}
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), timeoutMs);
			const res = await fetch(url, {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
				signal: ac.signal,
			});
			clearTimeout(timer);
			const raw = await res.text();
			if (!res.ok) {
				const snippet = raw.length > 600 ? `${raw.slice(0, 600)}…` : raw;
				return {
					ok: false,
					error: localize('himChatVoiceApiHttpError', 'Transcription failed (HTTP {0}): {1}', String(res.status), snippet || res.statusText),
				};
			}
			let text = '';
			try {
				const j = JSON.parse(raw) as { text?: string };
				text = typeof j.text === 'string' ? j.text : '';
			} catch {
				text = raw.trim();
			}
			if (!text.trim()) {
				return { ok: false, error: localize('himChatVoiceApiEmpty', 'Empty transcription response.') };
			}
			return { ok: true, text: text.trim() };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, error: msg };
		}
	}

	private async toggleVoiceInput(): Promise<void> {
		if (this.isSending) {
			return;
		}
		if (this.voiceWhisperTranscribing) {
			return;
		}
		if (this.isVoiceListening && this.voiceWhisperContext) {
			await this.stopWhisperVoiceAndTranscribe();
			return;
		}
		if (!this.isWhisperApiConfigured()) {
			await this.promptConfigureWhisperApi();
			return;
		}
		await this.startWhisperVoice();
	}

	private async startWhisperVoice(): Promise<void> {
		this.cleanupWhisperVoice();
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			this.appendMessage({ role: 'assistant', content: '⚠️ Microphone permission denied or unavailable.', isError: true });
			return;
		}

		const audioContext = new AudioContext();
		const source = audioContext.createMediaStreamSource(stream);
		const processor = audioContext.createScriptProcessor(4096, 1, 1);
		this.voiceWhisperChunks = [];
		processor.onaudioprocess = (e: AudioProcessingEvent) => {
			const input = e.inputBuffer.getChannelData(0);
			const copy = new Float32Array(input.length);
			copy.set(input);
			this.voiceWhisperChunks.push(copy);
		};

		const mute = audioContext.createGain();
		mute.gain.value = 0;
		source.connect(processor);
		processor.connect(mute);
		mute.connect(audioContext.destination);

		this.voiceWhisperStream = stream;
		this.voiceWhisperContext = audioContext;
		this.voiceWhisperProcessor = processor;
		this.voiceWhisperSource = source;
		this.isVoiceListening = true;
		this.updateVoiceButtonVisual();

		this.voiceWhisperMaxMsTimer = setTimeout(() => {
			void this.stopWhisperVoiceAndTranscribe();
		}, HimAiChatPane._maxWhisperRecordMs);
	}

	private async stopWhisperVoiceAndTranscribe(): Promise<void> {
		if (this.voiceWhisperMaxMsTimer !== undefined) {
			clearTimeout(this.voiceWhisperMaxMsTimer);
			this.voiceWhisperMaxMsTimer = undefined;
		}

		const chunks = this.voiceWhisperChunks.slice();
		const ctx = this.voiceWhisperContext;
		const inputRate = ctx?.sampleRate ?? 48000;
		this.cleanupWhisperVoice();
		this.isVoiceListening = false;
		this.updateVoiceButtonVisual();

		if (!chunks.length) {
			return;
		}

		this.voiceWhisperTranscribing = true;
		this.updateVoiceButtonVisual();
		try {
			const wav = buildWhisperWavFromFloatChunks(chunks, inputRate);
			const result = await this.transcribeWavViaWhisperApi(wav);
			if (result.ok && result.text?.trim()) {
				if (this.inputElement) {
					const base = this.inputElement.value.trim();
					const t = result.text.trim();
					this.inputElement.value = base ? `${base} ${t}` : t;
					this.resizeInputArea();
				}
			} else if (result.error) {
				this.appendMessage({ role: 'assistant', content: `⚠️ ${result.error}`, isError: true });
			}
		} finally {
			this.voiceWhisperTranscribing = false;
			this.updateVoiceButtonVisual();
		}
	}

	private cleanupWhisperVoice(): void {
		if (this.voiceWhisperMaxMsTimer !== undefined) {
			clearTimeout(this.voiceWhisperMaxMsTimer);
			this.voiceWhisperMaxMsTimer = undefined;
		}
		try {
			this.voiceWhisperProcessor?.disconnect();
		} catch { /* ignore */ }
		try {
			this.voiceWhisperSource?.disconnect();
		} catch { /* ignore */ }
		this.voiceWhisperProcessor = undefined;
		this.voiceWhisperSource = undefined;
		if (this.voiceWhisperContext) {
			void this.voiceWhisperContext.close();
		}
		this.voiceWhisperContext = undefined;
		if (this.voiceWhisperStream) {
			for (const t of this.voiceWhisperStream.getTracks()) {
				t.stop();
			}
		}
		this.voiceWhisperStream = undefined;
		this.voiceWhisperChunks = [];
	}

	override dispose(): void {
		this.closeImageLightbox();
		this.clearPendingComposerImages();
		this.cleanupWhisperVoice();
		this.isVoiceListening = false;
		super.dispose();
	}

	private getProviderSecretKey(provider: ProviderKind): string {
		return `${SECRET_KEY_PREFIX}${provider}`;
	}

	private getProviderApiKeysMap(): Record<string, string> {
		const value = this.configurationService.getValue<unknown>(`${CONFIG_ROOT}.providerApiKeys`);
		if (!value || typeof value !== 'object') {
			return {};
		}
		return value as Record<string, string>;
	}

	private getSelectedCustomModelId(): string {
		return (this.configurationService.getValue<string>(`${CONFIG_ROOT}.selectedModelId`) ?? '').trim() || DEFAULT_CUSTOM_MODEL_ID;
	}

	private getCustomModels(): CustomModelConfig[] {
		const value = this.configurationService.getValue<unknown>(`${CONFIG_ROOT}.customModels`);
		if (!Array.isArray(value)) {
			return DEFAULT_CUSTOM_MODELS.map(model => ({ ...model }));
		}

		const result: CustomModelConfig[] = [];
		for (let index = 0; index < value.length; index++) {
			const row = value[index];
			if (!row || typeof row !== 'object') {
				continue;
			}
			const entry = row as Record<string, unknown>;
			const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `custom-${index}`;
			const providerInput = typeof entry.provider === 'string' ? entry.provider : '';
			const provider = normalizeProviderInput(providerInput);
			const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '';
			const model = typeof entry.model === 'string' ? entry.model.trim() : '';
			const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '';
			if (!model) {
				continue;
			}
			result.push({ id, provider, baseUrl, model, apiKey });
		}
		return result.length ? result : DEFAULT_CUSTOM_MODELS.map(model => ({ ...model }));
	}

	private async resolveChatConfig(): Promise<ResolvedChatConfig> {
		const customModels = this.getCustomModels();
		if (!customModels.length) {
			throw new Error('No model configured. Click Add Models and configure one first.');
		}
		const selectedCustomModelId = this.getSelectedCustomModelId();
		const selectedCustomModel = customModels.find(custom => custom.id === selectedCustomModelId) ?? customModels[0];
		let provider = sanitizeProvider(selectedCustomModel.provider);
		let baseUrl = selectedCustomModel.baseUrl ? trimRightSlash(selectedCustomModel.baseUrl) : resolveBaseUrl(provider, '');
		let model = selectedCustomModel.model.trim();
		let apiKey = selectedCustomModel.apiKey.trim() || await this.resolveApiKey(provider);
		const systemPrompt = this.configurationService.getValue<string>(`${CONFIG_ROOT}.systemPrompt`) ?? '';
		const temperature = this.configurationService.getValue<number>(`${CONFIG_ROOT}.temperature`) ?? 0.2;
		const maxTokens = this.configurationService.getValue<number>(`${CONFIG_ROOT}.maxTokens`) ?? 16384;
		const timeoutMs = this.configurationService.getValue<number>(`${CONFIG_ROOT}.timeoutMs`) ?? 120000;
		const historyTurns = this.configurationService.getValue<number>(`${CONFIG_ROOT}.historyTurns`) ?? 8;
		const requestPath = ensureStartsWithSlash((this.configurationService.getValue<string>(`${CONFIG_ROOT}.requestPath`) ?? '/chat/completions').trim() || '/chat/completions');
		const anthropicVersion = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.anthropicVersion`) ?? '2023-06-01').trim() || '2023-06-01';
		const minimaxGroupId = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.minimaxGroupId`) ?? '').trim();

		if (!baseUrl) {
			throw new Error('HIM Chat baseUrl is empty. Configure himCode.chat.baseUrl.');
		}
		if (!model) {
			throw new Error('HIM Chat model is empty. Configure himCode.chat.model.');
		}
		if (!apiKey && provider !== 'openaiCompatible') {
			throw new Error(`HIM Chat API key missing for provider "${provider}".`);
		}

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

	private async resolveApiKey(provider: ProviderKind): Promise<string> {
		const keyMap = this.getProviderApiKeysMap();
		const keyFromMap = typeof keyMap[provider] === 'string' ? keyMap[provider].trim() : '';
		if (keyFromMap) {
			return keyFromMap;
		}

		const providerKey = await this.secretStorageService.get(this.getProviderSecretKey(provider));
		if (providerKey?.trim()) {
			return providerKey.trim();
		}

		const configured = (this.configurationService.getValue<string>(`${CONFIG_ROOT}.apiKey`) ?? '').trim();
		if (configured) {
			return configured;
		}

		switch (provider) {
			case 'openai':
			case 'openaiCompatible':
				return readEnv('OPENAI_API_KEY');
			case 'anthropic':
				return readEnv('ANTHROPIC_API_KEY');
			case 'gemini':
				return readEnv('GEMINI_API_KEY') || readEnv('GOOGLE_API_KEY');
			case 'minimax':
				return readEnv('MINIMAX_API_KEY');
			default:
				return '';
		}
	}

	private async requestProvider(cfg: ResolvedChatConfig, messages: ProviderMessage[], token: CancellationToken, onChunk?: (delta: HimStreamDelta) => void): Promise<ProviderResponsePayload> {
		switch (cfg.provider) {
			case 'openai':
			case 'openaiCompatible':
			case 'minimax':
				return this.requestOpenAICompatible(cfg, messages, token, onChunk);
			case 'anthropic':
				return this.requestAnthropic(cfg, messages, token);
			case 'gemini':
				return this.requestGemini(cfg, messages, token, onChunk);
			default:
				throw new Error(`Unsupported provider: ${cfg.provider}`);
		}
	}

	private openAICompatSerializeMessage(message: ProviderMessage): { role: string; content: string | unknown[] } {
		if (typeof message.content === 'string') {
			return { role: message.role, content: message.content };
		}
		const parts = message.content.map(part =>
			part.type === 'text'
				? { type: 'text', text: part.text }
				: { type: 'image_url', image_url: part.image_url },
		);
		return { role: message.role, content: parts };
	}

	private anthropicSerializeUserContent(message: ProviderMessage): string | unknown[] {
		if (typeof message.content === 'string') {
			return message.content;
		}
		return message.content.map(part => {
			if (part.type === 'text') {
				return { type: 'text', text: part.text };
			}
			const url = part.image_url.url;
			const match = /^data:([^;]+);base64,(.+)$/.exec(url);
			if (match) {
				return {
					type: 'image',
					source: { type: 'base64', media_type: match[1], data: match[2] },
				};
			}
			return { type: 'text', text: '[image]' };
		});
	}

	private geminiSerializeParts(message: ProviderMessage): unknown[] {
		if (typeof message.content === 'string') {
			return [{ text: message.content }];
		}
		const out: unknown[] = [];
		for (const part of message.content) {
			if (part.type === 'text') {
				out.push({ text: part.text });
				continue;
			}
			const url = part.image_url.url;
			const match = /^data:([^;]+);base64,(.+)$/.exec(url);
			if (match) {
				out.push({ inlineData: { mimeType: match[1], data: match[2] } });
			}
		}
		return out.length ? out : [{ text: '' }];
	}

	private async requestOpenAICompatible(cfg: ResolvedChatConfig, messages: ProviderMessage[], token: CancellationToken, onChunk?: (delta: HimStreamDelta) => void): Promise<ProviderResponsePayload> {
		const url = joinUrl(cfg.baseUrl, cfg.requestPath);
		const body: Record<string, any> = {
			model: cfg.model,
			messages: messages.map(message => this.openAICompatSerializeMessage(message)),
			temperature: cfg.temperature,
			max_tokens: cfg.maxTokens,
			stream: !!onChunk,
		};
		// MiniMax M2: official OpenAI-compat uses `reasoning_split` only; thinking is returned via
		// `reasoning_details` / stream deltas (see platform.minimax.io docs). Extra `thinking` objects are ignored.
		if (cfg.provider === 'minimax') {
			body.reasoning_split = true;
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

		if (onChunk) {
			try {
				const result = await this.postJsonStream(url, headers, body, cfg.timeoutMs, token, onChunk, cfg.provider);
				return { text: result.text, thinking: result.thinking };
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const fallback =
					msg.includes('Failed to fetch') ||
					msg.includes('NetworkError') ||
					msg.includes('Network request failed') ||
					msg.includes('Load failed');
				if (fallback) {
					const data = await this.postJson(url, headers, { ...body, stream: false }, cfg.timeoutMs, token);
					const text = extractOpenAIText(data, cfg.provider);
					const thinking = extractOpenAIThinking(data);
					if (text) {
						onChunk({ text });
					}
					return { text, thinking };
				}
				throw e;
			}
		}

		const data = await this.postJson(url, headers, body, cfg.timeoutMs, token);
		const text = extractOpenAIText(data, cfg.provider);
		const thinking = extractOpenAIThinking(data);
		return { text, thinking };
	}

	private async requestAnthropic(cfg: ResolvedChatConfig, messages: ProviderMessage[], token: CancellationToken): Promise<ProviderResponsePayload> {
		const url = joinUrl(cfg.baseUrl, '/messages');
		const systemPrompt = messages
			.filter(message => message.role === 'system')
			.map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
			.join('\n\n')
			.trim();
		const chatMessages = messages.filter(message => message.role !== 'system').map(message => ({
			role: message.role === 'assistant' ? 'assistant' : 'user',
			content: this.anthropicSerializeUserContent(message),
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
		const data = await this.postJson(url, headers, body, cfg.timeoutMs, token);
		const text = extractAnthropicText(data);
		const thinking = extractAnthropicThinking(data);
		return { text, thinking };
	}

	private async requestGemini(cfg: ResolvedChatConfig, messages: ProviderMessage[], token: CancellationToken, onChunk?: (delta: HimStreamDelta) => void): Promise<ProviderResponsePayload> {
		const sanitizedBase = trimRightSlash(cfg.baseUrl);
		const model = encodeURIComponent(normalizeGeminiModel(cfg.model));
		const key = encodeURIComponent(cfg.apiKey);
		const systemPrompt = messages
			.filter(message => message.role === 'system')
			.map(message => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
			.join('\n\n')
			.trim();
		const contents = messages.filter(message => message.role !== 'system').map(message => ({
			role: message.role === 'assistant' ? 'model' : 'user',
			parts: this.geminiSerializeParts(message),
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

		if (onChunk) {
			const streamUrl = `${sanitizedBase}/models/${model}:streamGenerateContent?alt=sse&key=${key}`;
			try {
				return await this.postGeminiStream(streamUrl, headers, bodyWithThinking, cfg.timeoutMs, token, onChunk);
			} catch (error) {
				if (isGeminiThinkingConfigError(error)) {
					return await this.postGeminiStream(streamUrl, headers, bodyWithoutThinking, cfg.timeoutMs, token, onChunk);
				}
				const msg = error instanceof Error ? error.message : String(error);
				const isNetworkErr = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network request failed') || msg.includes('Load failed');
				if (!isNetworkErr) {
					throw error;
				}
			}
		}

		const url = `${sanitizedBase}/models/${model}:generateContent?key=${key}`;
		let data: unknown;
		try {
			data = await this.postJson(url, headers, bodyWithThinking, cfg.timeoutMs, token);
		} catch (error) {
			if (!isGeminiThinkingConfigError(error)) {
				throw error;
			}
			data = await this.postJson(url, headers, bodyWithoutThinking, cfg.timeoutMs, token);
		}
		const text = extractGeminiText(data);
		const thinking = extractGeminiThinking(data);
		if (onChunk && text) {
			if (thinking) { onChunk({ thinking }); }
			onChunk({ text });
		}
		return { text, thinking };
	}

	private async postGeminiStream(
		url: string,
		headers: Record<string, string>,
		body: unknown,
		timeoutMs: number,
		token: CancellationToken,
		onChunk: (delta: HimStreamDelta) => void,
	): Promise<ProviderResponsePayload> {
		const response = await this.requestService.request({
			type: 'POST',
			url,
			data: JSON.stringify(body),
			timeout: timeoutMs,
			disableCache: true,
			headers,
			callSite: 'himAiChatPane.postGeminiStream',
		}, token);

		const statusCode = response.res.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			const rawText = await asText(response) ?? '';
			const data = safeJsonParse(rawText);
			throw new Error(`HTTP ${statusCode}: ${extractErrorText(data, rawText)}`);
		}

		if (!response.stream) {
			const rawText = await asText(response) ?? '';
			const data = safeJsonParse(rawText);
			const text = extractGeminiText(data);
			const thinking = extractGeminiThinking(data);
			if (thinking) { onChunk({ thinking }); }
			if (text) { onChunk({ text }); }
			return { text: text || rawText.trim(), thinking: thinking || undefined };
		}

		let lineBuffer = '';
		let fullText = '';
		let fullThinking = '';

		const processGeminiPayload = (payload: string) => {
			if (payload === '[DONE]') { return; }
			let parsed: unknown;
			try { parsed = JSON.parse(payload); } catch { return; }
			const errorObj = (parsed as any)?.error;
			if (errorObj?.message) {
				throw new Error(String(errorObj.message));
			}
			const candidates = (parsed as any)?.candidates;
			if (!Array.isArray(candidates) || candidates.length === 0) { return; }
			const parts = candidates[0]?.content?.parts;
			if (!Array.isArray(parts)) { return; }
			for (const part of parts) {
				if (typeof part.text !== 'string') { continue; }
				if (part.thought) {
					fullThinking += part.text;
					onChunk({ thinking: part.text });
				} else {
					fullText += part.text;
					onChunk({ text: part.text });
				}
			}
		};

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const fail = (err: Error) => { if (!settled) { settled = true; reject(err); } };
			const done = () => { if (!settled) { settled = true; resolve(); } };
			listenStream(response.stream, {
				onData: (chunk: VSBuffer) => {
					lineBuffer += chunk.toString();
					const lines = lineBuffer.split('\n');
					lineBuffer = lines.pop() ?? '';
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith('data:')) { continue; }
						const payload = trimmed.slice(5).trim();
						try {
							processGeminiPayload(payload);
						} catch (e) {
							fail(e instanceof Error ? e : new Error(String(e)));
							return;
						}
					}
				},
				onError: (err) => fail(err),
				onEnd: () => done(),
			});
		});

		return { text: fullText, thinking: fullThinking || undefined };
	}

	private async postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, token: CancellationToken): Promise<unknown> {
		const response = await this.requestService.request({
			type: 'POST',
			url,
			data: JSON.stringify(body),
			timeout: timeoutMs,
			disableCache: true,
			headers,
			callSite: 'himAiChatPane.postJson',
		}, token);
		const rawText = await asText(response) ?? '';
		const data = safeJsonParse(rawText);
		const statusCode = response.res.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			throw new Error(`HTTP ${statusCode}: ${extractErrorText(data, rawText)}`);
		}
		return data;
	}

	private async postJsonStream(
		url: string,
		headers: Record<string, string>,
		body: unknown,
		timeoutMs: number,
		token: CancellationToken,
		onChunk: (delta: HimStreamDelta) => void,
		provider: ProviderKind,
	): Promise<{ text: string; thinking?: string }> {
		const response = await this.requestService.request({
			type: 'POST',
			url,
			data: JSON.stringify(body),
			timeout: timeoutMs,
			disableCache: true,
			headers,
			callSite: 'himAiChatPane.postJsonStream',
		}, token);

		const statusCode = response.res.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			const rawText = await asText(response) ?? '';
			const data = safeJsonParse(rawText);
			throw new Error(`HTTP ${statusCode}: ${extractErrorText(data, rawText)}`);
		}

		if (!response.stream) {
			const rawText = await asText(response) ?? '';
			const data = safeJsonParse(rawText);
			const text = extractOpenAIText(data, provider);
			const thinking = extractOpenAIThinking(data);
			if (text) {
				onChunk({ text });
			}
			return { text: text || rawText.trim(), thinking: thinking || undefined };
		}

		let lineBuffer = '';
		let fullText = '';
		let thinking = '';
		let minimaxContentCum = '';
		let minimaxReasoningCum = '';

		const processPayload = (payload: string): string | undefined => {
			if (payload === '[DONE]') {
				return undefined;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(payload);
			} catch {
				return undefined;
			}
			const errMsg = extractSSEErrorMessage(parsed);
			if (errMsg) {
				return errMsg;
			}
			if (provider === 'minimax') {
				const m = extractMiniMaxStreamDeltas(parsed, minimaxContentCum, minimaxReasoningCum);
				minimaxContentCum = m.newContentCum;
				minimaxReasoningCum = m.newReasoningCum;
				if (m.thinkingInc) {
					thinking += m.thinkingInc;
				}
				if (m.textInc) {
					fullText = minimaxContentCum;
				}
				if (m.textInc || m.thinkingInc) {
					onChunk({
						text: m.textInc || undefined,
						thinking: m.thinkingInc || undefined,
					});
				}
				return undefined;
			}
			const deltaText = extractOpenAIStreamingDeltaText(parsed);
			if (deltaText) {
				fullText += deltaText;
				onChunk({ text: deltaText });
			}
			const deltaThinking = extractOpenAIStreamingDeltaThinking(parsed);
			if (deltaThinking) {
				thinking += deltaThinking;
				onChunk({ thinking: deltaThinking });
			}
			return undefined;
		};

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const fail = (err: Error) => {
				if (!settled) {
					settled = true;
					reject(err);
				}
			};
			const done = () => {
				if (!settled) {
					settled = true;
					resolve();
				}
			};
			listenStream(response.stream, {
				onData: (chunk: VSBuffer) => {
					lineBuffer += chunk.toString();
					const lines = lineBuffer.split('\n');
					lineBuffer = lines.pop() ?? '';
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed.startsWith('data:')) {
							continue;
						}
						const payload = trimmed.slice(5).trim();
						const errMsg = processPayload(payload);
						if (errMsg) {
							fail(new Error(errMsg));
							return;
						}
					}
				},
				onError: err => fail(err),
				onEnd: () => {
					if (lineBuffer.trim()) {
						const trimmed = lineBuffer.trim();
						if (trimmed.startsWith('data:')) {
							const payload = trimmed.slice(5).trim();
							const errMsg = processPayload(payload);
							if (errMsg) {
								fail(new Error(errMsg));
								return;
							}
						}
					}
					done();
				},
			}, token);
		});

		if (provider === 'minimax' && minimaxContentCum) {
			fullText = minimaxContentCum;
		}
		const synthetic = { choices: [{ message: { content: fullText } }] };
		const text = extractOpenAIText(synthetic, provider) || fullText.trim();
		const thinkingTrim = thinking.trim();
		const thinkingFromMessage = extractOpenAIThinking({
			choices: [{
				message: {
					content: text,
					reasoning_content: thinkingTrim || undefined,
					reasoning: thinkingTrim || undefined,
				},
			}],
		});
		const mergedThinking = thinkingTrim || thinkingFromMessage || undefined;
		return { text, thinking: mergedThinking };
	}

	private toErrorMessage(error: unknown): string {
		if (error instanceof Error) {
			const m = error.message;
			if (m.includes('Failed to fetch') || m.includes('NetworkError')) {
				return `${m} — Check network, API URL, proxy, and TLS. For browser CORS to official APIs, use a gateway or local proxy.`;
			}
			return m;
		}
		if (typeof error === 'string') {
			return error;
		}
		return 'Unknown error';
	}

	private initSelectionWidget(): void {
		const codeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!codeEditor) {
			return;
		}

		let currentWidget: AskHimCodeSelectionWidget | undefined;

		const createWidgetForEditor = (editor: ICodeEditor) => {
			currentWidget?.hide();
			currentWidget?.dispose();
			currentWidget = new AskHimCodeSelectionWidget(editor, () => {
				this.insertSelectedCodeReference();
			});
			this._register(currentWidget);
			const selection = editor.getSelection();
			if (selection && !selection.isEmpty()) {
				currentWidget.show(selection.getStartPosition());
			} else {
				currentWidget.hide();
			}
		};

		createWidgetForEditor(codeEditor);

		this._register(this.editorService.onDidActiveEditorChange(() => {
			currentWidget?.hide();
			const newEditor = getCodeEditor(this.editorService.activeTextEditorControl);
			if (newEditor) {
				createWidgetForEditor(newEditor);
			}
		}));
	}
}

class AskHimCodeSelectionWidget implements IContentWidget {
	private readonly id = 'him-code-ask-widget';
	private domNode: HTMLElement | undefined;
	private isVisible = false;
	private widgetPosition: Position | undefined;
	public readonly allowEditorOverflow = true;
	public readonly suppressMouseDown = false;
	private scrollDisposable: IDisposable | undefined;
	private selectionDisposable: IDisposable | undefined;
	private focusDisposable: IDisposable | undefined;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly onAsk: () => void
	) {
		this.domNode = document.createElement('div');
		this.domNode.className = 'him-code-selection-widget';
		this.domNode.style.cssText = `
			position: absolute;
			background: #ffffff;
			border: 1px solid #007acc;
			border-radius: 4px;
			padding: 2px 6px;
			font-size: 12px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.3);
			z-index: 10000;
			cursor: default;
			display: none;
		`;
		const btn = document.createElement('button');
		btn.style.cssText = 'background: #007acc; color: #ffffff; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;';
		btn.textContent = 'Ask HIM Code';
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onAsk();
			this.hide();
		});
		this.domNode.appendChild(btn);
		document.body.appendChild(this.domNode);

		this.scrollDisposable = this.editor.onDidScrollChange(() => {
			if (this.isVisible) {
				this.updateWidgetPosition();
			}
		});

		this.selectionDisposable = this.editor.onDidChangeCursorSelection(() => {
			const selection = this.editor.getSelection();
			if (selection && !selection.isEmpty()) {
				const position = selection.getStartPosition();
				this.show(position);
			} else {
				this.hide();
			}
		});

		this.focusDisposable = this.editor.onDidBlurEditorWidget(() => {
			this.hide();
		});
	}

	show(position: Position): void {
		this.widgetPosition = position;
		this.updateWidgetPosition();
		if (!this.isVisible) {
			this.domNode!.style.display = 'block';
			this.isVisible = true;
		}
	}

	hide(): void {
		if (this.isVisible && this.domNode) {
			this.domNode.style.display = 'none';
			this.isVisible = false;
		}
		this.widgetPosition = undefined;
	}

	private updateWidgetPosition(): void {
		if (!this.domNode || !this.widgetPosition) {
			return;
		}
		const coords = this.editor.getScrolledVisiblePosition(this.widgetPosition);
		if (!coords) {
			return;
		}
		const editorDomNode = this.editor.getDomNode();
		if (!editorDomNode) {
			return;
		}
		const editorRect = editorDomNode.getBoundingClientRect();
		const scrollTop = this.editor.getScrollTop();
		const scrollLeft = this.editor.getScrollLeft();
		const x = editorRect.left + coords.left - scrollLeft;
		const y = editorRect.top + coords.top - scrollTop - 35;

		this.domNode.style.left = `${x}px`;
		this.domNode.style.top = `${y}px`;
	}

	dispose(): void {
		this.scrollDisposable?.dispose();
		this.selectionDisposable?.dispose();
		this.focusDisposable?.dispose();
		this.domNode?.remove();
	}

	getId(): string { return this.id; }

	getDomNode(): HTMLElement {
		return this.domNode!;
	}

	getPosition(): IContentWidgetPosition | null {
		return null;
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

function collapseBackspacesInline(text: string): string {
	let out = '';
	for (const ch of text) {
		if (ch === '\b') {
			out = out.slice(0, -1);
			continue;
		}
		out += ch;
	}
	return out;
}

function providerLabel(provider: ProviderKind): string {
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

function resolveBaseUrl(provider: ProviderKind, configuredBaseUrl: string): string {
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

/**
 * MiniMax OpenAI-compat streaming sends cumulative `delta.content` and cumulative `reasoning_details[].text`
 * (see platform.minimax.io streaming example). Incremental UI updates must diff against previous cumulative strings.
 */
function extractMiniMaxStreamDeltas(
	parsed: unknown,
	prevContentCum: string,
	prevReasoningCum: string,
): { textInc: string; thinkingInc: string; newContentCum: string; newReasoningCum: string } {
	const value = parsed as any;
	const delta = value?.choices?.[0]?.delta;
	if (!delta) {
		return { textInc: '', thinkingInc: '', newContentCum: prevContentCum, newReasoningCum: prevReasoningCum };
	}
	let newContentCum = prevContentCum;
	let textInc = '';
	const dc = delta.content;
	if (typeof dc === 'string') {
		newContentCum = dc;
		textInc = prevContentCum && dc.startsWith(prevContentCum) ? dc.slice(prevContentCum.length) : dc;
	} else if (Array.isArray(dc)) {
		const textParts: string[] = [];
		for (const part of dc) {
			if (part?.type === 'text' && typeof part?.text === 'string') {
				textParts.push(part.text);
			}
		}
		const joined = textParts.join('');
		if (joined) {
			newContentCum = joined;
			textInc = prevContentCum && joined.startsWith(prevContentCum) ? joined.slice(prevContentCum.length) : joined;
		}
	}

	let newReasoningCum = prevReasoningCum;
	let thinkingInc = '';
	if (Array.isArray(delta.reasoning_details)) {
		for (const detail of delta.reasoning_details) {
			if (detail && typeof detail.text === 'string') {
				newReasoningCum = detail.text;
			}
		}
		if (newReasoningCum !== prevReasoningCum) {
			thinkingInc = newReasoningCum.startsWith(prevReasoningCum)
				? newReasoningCum.slice(prevReasoningCum.length)
				: newReasoningCum;
		}
	}

	return { textInc, thinkingInc, newContentCum, newReasoningCum };
}

function extractSSEErrorMessage(parsed: unknown): string | undefined {
	const value = parsed as { error?: { message?: string }; message?: string };
	const msg = value?.error?.message ?? value?.message;
	if (typeof msg === 'string' && msg.trim()) {
		return msg.trim();
	}
	return undefined;
}

/** SSE chunk: OpenAI-compatible `choices[0].delta`, plus MiniMax-style typed deltas. */
function extractOpenAIStreamingDeltaText(parsed: unknown): string {
	const value = parsed as any;
	const delta = value?.choices?.[0]?.delta;
	if (!delta) {
		return '';
	}
	if (delta.type === 'thinking_delta' || delta.type === 'thinking') {
		return '';
	}
	if (delta.type === 'text_delta' || delta.type === 'text') {
		return String(delta.text ?? delta.text_delta ?? '');
	}
	if (delta.type === 'content_block_delta' && delta.delta) {
		const inner = delta.delta;
		if (inner.type === 'thinking_delta' || inner.type === 'thinking') {
			return '';
		}
		if (inner.type === 'text_delta' || inner.type === 'text') {
			return String(inner.text ?? inner.text_delta ?? '');
		}
	}
	const c = delta.content;
	if (typeof c === 'string') {
		return c;
	}
	if (Array.isArray(c)) {
		return c
			.map((part: any) => {
				if (typeof part === 'string') {
					return part;
				}
				if (typeof part?.text === 'string') {
					const partType = typeof part?.type === 'string' ? part.type.toLowerCase() : '';
					const marksThinking = partType.includes('reason') || partType.includes('think') || part?.thought === true;
					if (marksThinking) {
						return '';
					}
					return part.text;
				}
				return '';
			})
			.join('');
	}
	return '';
}

function extractOpenAIStreamingDeltaThinking(parsed: unknown): string {
	const value = parsed as any;
	const delta = value?.choices?.[0]?.delta;
	if (!delta) {
		return '';
	}
	if (delta.type === 'thinking_delta' || delta.type === 'thinking') {
		return String(delta.thinking ?? delta.thinking_delta ?? '');
	}
	if (delta.type === 'content_block_delta' && delta.delta) {
		const inner = delta.delta;
		if (inner.type === 'thinking_delta' || inner.type === 'thinking') {
			return String(inner.thinking ?? inner.thinking_delta ?? '');
		}
	}
	if (typeof delta.reasoning === 'string') {
		return delta.reasoning;
	}
	if (typeof delta.reasoning_content === 'string') {
		return delta.reasoning_content;
	}
	return '';
}

function extractOpenAIText(data: unknown, provider?: string): string {
	const value = data as any;
	const content = value?.choices?.[0]?.message?.content;

	if (provider === 'minimax' && Array.isArray(content)) {
		const textParts: string[] = [];
		for (const part of content) {
			if (part?.type === 'text' && part?.text) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) {
			return textParts.join('\n').trim();
		}
	}

	if (typeof content === 'string') {
		return content.trim();
	}
	if (Array.isArray(content)) {
		return content
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
	return '';
}

function extractOpenAIThinking(data: unknown): string {
	const value = data as any;
	const content = value?.choices?.[0]?.message?.content;

	if (Array.isArray(content)) {
		const thinkingParts: string[] = [];
		for (const part of content) {
			if (part?.type === 'thinking' && part?.thinking) {
				thinkingParts.push(part.thinking);
			}
		}
		if (thinkingParts.length > 0) {
			return thinkingParts.join('\n');
		}
	}

	const directCandidates = [
		value?.reasoning_details,
		value?.choices?.[0]?.message?.reasoning_details,
		value?.choices?.[0]?.reasoning_details,
		value?.choices?.[0]?.message?.reasoning,
		value?.choices?.[0]?.message?.reasoning_content,
		value?.choices?.[0]?.message?.thinking,
		value?.choices?.[0]?.reasoning,
		value?.choices?.[0]?.reasoning_content,
		value?.choices?.[0]?.thinking,
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

	return '';
}

function extractAnthropicText(data: unknown): string {
	const value = data as any;
	if (!Array.isArray(value?.content)) {
		return '';
	}
	return value.content
		.map((part: any) => (part?.type === 'text' && typeof part?.text === 'string') ? part.text : '')
		.join('\n')
		.trim();
}

function extractAnthropicThinking(data: unknown): string {
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

function extractGeminiText(data: unknown): string {
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
		.filter((part: any) => {
			const type = typeof part?.type === 'string' ? part.type.toLowerCase() : '';
			const isThinking = part?.thought === true || type.includes('think') || type.includes('reason');
			return !isThinking;
		})
		.map((part: any) => typeof part?.text === 'string' ? part.text : '')
		.join('\n')
		.trim();
}

function extractGeminiThinking(data: unknown): string {
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

function normalizeThinkingValue(value: unknown): string {
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

function safeJsonParse(raw: string): unknown {
	if (!raw) {
		return {};
	}
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function extractErrorText(data: unknown, fallback: string): string {
	const value = data as any;
	const structured = value?.error?.message ?? value?.message ?? value?.detail ?? value?.details?.message;
	if (typeof structured === 'string' && structured.trim()) {
		return structured.trim();
	}
	return fallback || 'Unknown request failure';
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

function readEnv(name: string): string {
	const processValue = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
	const value = processValue?.env?.[name];
	return typeof value === 'string' ? value.trim() : '';
}
