/*---------------------------------------------------------------------------------------------
 *  HIM Detached Console — auxiliary BrowserWindow hosting the agent UI (Issue Reporter pattern).
 *  REPL/session: IHimPythonReplService + workspace JSON persist across close/reopen.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AuxiliaryWindowMode, IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IHimDetachedConsoleService, IHimDetachedEditorContext } from '../common/himDetachedConsole.js';

const BROADCAST_NAME = 'him-detached-console-v1';

type ScreenWithInsets = Screen & { availLeft?: number; availTop?: number };

export class HimDetachedConsoleService extends Disposable implements IHimDetachedConsoleService {
	readonly _serviceBrand: undefined;

	private readonly _onDidReceiveEditorContext = new Emitter<IHimDetachedEditorContext>();
	readonly onDidReceiveEditorContext = this._onDidReceiveEditorContext.event;

	private readonly windowDisposables = this._register(new DisposableStore());
	private auxiliary: IAuxiliaryWindow | undefined;
	private sessionId: string | undefined;
	private rootEl: HTMLElement | undefined;
	private contextLogEl: HTMLElement | undefined;
	private broadcast: BroadcastChannel | undefined;

	constructor(
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				this.broadcast = new BroadcastChannel(BROADCAST_NAME);
				this._register(toDisposable(() => this.broadcast?.close()));
				this.broadcast.onmessage = (ev: MessageEvent) => {
					const data = ev.data as { type?: string; payload?: IHimDetachedEditorContext };
					if (data?.type === 'editor-context' && data.payload) {
						this._onDidReceiveEditorContext.fire(data.payload);
					}
				};
			} catch (e) {
				this.logService.warn('[HIM] BroadcastChannel unavailable', e);
			}
		}
		this._register(this.onDidReceiveEditorContext(ctx => this.appendContextLog(ctx)));
	}

	get hasDetachedWindow(): boolean {
		return !!this.auxiliary;
	}

	async openForAgentSession(sessionId: string, title?: string): Promise<void> {
		if (this.auxiliary) {
			this.sessionId = sessionId;
			this.auxiliary.window.document.title = title ?? `HIM ${sessionId.slice(0, 8)}`;
			this.renderHeader(sessionId, title);
			return;
		}

		const scr = window.screen as ScreenWithInsets;
		const w = Math.max(420, Math.floor(scr.availWidth * 0.22));
		const h = scr.availHeight - 80;
		const x = (scr.availLeft ?? 0) + scr.availWidth - w - 24;
		const y = (scr.availTop ?? 0) + 40;

		const aux = await this.auxiliaryWindowService.open({
			mode: AuxiliaryWindowMode.Normal,
			bounds: { x, y, width: w, height: h },
			nativeTitlebar: true,
		});

		this.windowDisposables.clear();
		this.windowDisposables.add(aux);
		this.auxiliary = aux;
		this.sessionId = sessionId;

		await aux.whenStylesHaveLoaded;
		aux.window.document.title = title ?? `HIM ${sessionId.slice(0, 8)}`;

		const platformClass = aux.window.navigator.platform.includes('Win') ? 'windows' : aux.window.navigator.platform.includes('Mac') ? 'mac' : 'linux';
		aux.window.document.body.classList.add('monaco-workbench', platformClass);
		aux.container.remove();

		const wrap = append(aux.window.document.body, $('div.him-detached-console'));
		wrap.style.display = 'flex';
		wrap.style.flexDirection = 'column';
		wrap.style.height = '100%';
		wrap.style.boxSizing = 'border-box';
		wrap.style.padding = '12px';
		wrap.style.gap = '8px';
		wrap.style.backgroundColor = 'var(--vscode-sideBar-background)';
		wrap.style.color = 'var(--vscode-foreground)';
		this.rootEl = wrap;

		this.renderHeader(sessionId, title);

		const hint = append(wrap, $('div.him-detached-hint'));
		hint.style.fontSize = '12px';
		hint.style.opacity = '0.85';
		hint.textContent = `Detached console scaffold. Full chat UI mounts here; Agent List stays in main sidebar. REPL persists for session ${this.sessionId?.slice(0, 8) ?? '—'} when this window closes.`;

		const ctxTitle = append(wrap, $('div'));
		ctxTitle.style.fontSize = '11px';
		ctxTitle.style.fontWeight = '600';
		ctxTitle.textContent = 'Live context (from main window)';

		this.contextLogEl = append(wrap, $('pre.him-detached-context-log'));
		this.contextLogEl.style.flex = '1';
		this.contextLogEl.style.overflow = 'auto';
		this.contextLogEl.style.margin = '0';
		this.contextLogEl.style.padding = '8px';
		this.contextLogEl.style.fontSize = '11px';
		this.contextLogEl.style.fontFamily = 'var(--vscode-editor-font-family)';
		this.contextLogEl.style.background = 'var(--vscode-editor-background)';
		this.contextLogEl.style.border = '1px solid var(--vscode-widget-border)';
		this.contextLogEl.style.borderRadius = '6px';
		this.contextLogEl.style.whiteSpace = 'pre-wrap';
		this.contextLogEl.textContent = '(no editor context yet)';

		this.windowDisposables.add(aux.onUnload(() => {
			this.auxiliary = undefined;
			this.sessionId = undefined;
			this.rootEl = undefined;
			this.contextLogEl = undefined;
		}));
	}

	private renderHeader(sessionId: string, title?: string): void {
		if (!this.rootEl) {
			return;
		}
		let head = this.rootEl.querySelector('.him-detached-head') as HTMLElement | null;
		if (!head) {
			head = append(this.rootEl, $('div.him-detached-head'));
			head.style.display = 'flex';
			head.style.flexDirection = 'column';
			head.style.gap = '4px';
		}
		clearNode(head);
		const t = append(head, $('h2'));
		t.style.margin = '0';
		t.style.fontSize = '16px';
		t.textContent = title ?? 'HIM Agent';
		const sub = append(head, $('span'));
		sub.style.fontSize = '11px';
		sub.style.opacity = '0.8';
		sub.textContent = `sessionId: ${sessionId}`;
	}

	close(): void {
		this.windowDisposables.clear();
		this.auxiliary = undefined;
		this.sessionId = undefined;
		this.rootEl = undefined;
		this.contextLogEl = undefined;
	}

	pushEditorContext(context: IHimDetachedEditorContext): void {
		this._onDidReceiveEditorContext.fire(context);
		try {
			this.broadcast?.postMessage({ type: 'editor-context', payload: context });
		} catch {
			// ignore
		}
	}

	private appendContextLog(ctx: IHimDetachedEditorContext): void {
		if (!this.contextLogEl) {
			return;
		}
		const line = [
			ctx.resource?.toString(true),
			ctx.selectionText ? `selection: ${ctx.selectionText.slice(0, 2000)}${ctx.selectionText.length > 2000 ? '…' : ''}` : '',
			ctx.startLine !== undefined ? `L${ctx.startLine}-${ctx.endLine ?? ctx.startLine}` : '',
		].filter(Boolean).join('\n');
		this.contextLogEl.textContent = line || '(empty)';
	}

}

registerSingleton(IHimDetachedConsoleService, HimDetachedConsoleService, InstantiationType.Delayed);
