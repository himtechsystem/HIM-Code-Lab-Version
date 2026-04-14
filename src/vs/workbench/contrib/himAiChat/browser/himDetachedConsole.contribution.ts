/*---------------------------------------------------------------------------------------------
 *  HIM Detached Console — commands + editor selection sync to auxiliary window.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { localize2 } from '../../../../nls.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IHimDetachedConsoleService } from '../common/himDetachedConsole.js';
import './himDetachedConsoleService.js';
import { HIM_AI_CHAT_VIEW_ID } from './himAiChat.js';
import { HimAiChatPane } from './himAiChatPane.js';

registerAction2(class HimOpenDetachedConsoleAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.openDetachedConsole',
			title: localize2('himAiChat.openDetachedConsole', 'Open HIM Detached Console'),
			category: localize2('himAiChat.category', 'HIM CODE'),
			f1: true,
			icon: Codicon.screenFull,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const detached = accessor.get(IHimDetachedConsoleService);
		const views = accessor.get(IViewsService);
		const view = views.getActiveViewWithId(HIM_AI_CHAT_VIEW_ID) as HimAiChatPane | undefined;
		const sessionId = view?.getActiveSessionIdForDetached?.() ?? generateUuid();
		const title = view?.getActiveSessionTitleForDetached?.() ?? 'HIM Agent';
		await detached.openForAgentSession(sessionId, title);
	}
});

class HimDetachedEditorSyncContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IHimDetachedConsoleService private readonly detached: IHimDetachedConsoleService,
	) {
		super();
		this._register(this.editorService.onDidActiveEditorChange(() => this.sync()));
	}

	private sync(): void {
		if (!this.detached.hasDetachedWindow) {
			return;
		}
		const codeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (!codeEditor) {
			this.detached.pushEditorContext({});
			return;
		}
		const model = codeEditor.getModel();
		const sel = codeEditor.getSelection();
		let selectionText: string | undefined;
		if (model && sel && !sel.isEmpty()) {
			selectionText = model.getValueInRange(sel);
		}
		this.detached.pushEditorContext({
			resource: model?.uri,
			selectionText,
			startLine: sel?.startLineNumber,
			endLine: sel?.endLineNumber,
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	HimDetachedEditorSyncContribution,
	LifecyclePhase.Eventually,
);
