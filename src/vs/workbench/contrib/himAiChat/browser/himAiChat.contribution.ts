/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewsRegistry, IViewDescriptorService, ViewVisibilityState } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { HIM_AI_CHAT_VIEW_ID, HIM_AI_CHAT_CONTAINER_ID, himAiChatIcon } from './himAiChat.js';
import { HimAiChatPane } from './himAiChatPane.js';
import { localize2 } from '../../../../nls.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IHimPythonReplService } from '../common/himPythonRepl.js';
import { HimPythonReplService } from './himPythonReplService.js';
import { IHimWhisperService } from '../../../../platform/himWhisper/common/himWhisper.js';
import { NullHimWhisperService } from './himWhisperNullService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { getHimCodeHostDataRoot } from './himHostDataRoot.js';
import { ensureWorkspaceOrganizationBootstrap, getOrganizationFileUri } from './himOrganizationFileSupport.js';

registerSingleton(IHimPythonReplService, HimPythonReplService, InstantiationType.Delayed);
registerSingleton(IHimWhisperService, NullHimWhisperService, InstantiationType.Delayed);

const HIM_CHAT_SETTINGS_QUERY = 'himCode.chat';

// 1. Register the View Container strictly in the Auxiliary Bar (Right Side)
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: HIM_AI_CHAT_CONTAINER_ID,
	title: localize2('himAiChatTitle', "HIM CODE"),
	icon: himAiChatIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [HIM_AI_CHAT_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: HIM_AI_CHAT_CONTAINER_ID,
	hideIfEmpty: false,
	order: 100,
}, ViewContainerLocation.AuxiliaryBar);

// 2. Register the View
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: HIM_AI_CHAT_VIEW_ID,
	name: localize2('himAiChatTitle2', "HIM CODE"),
	containerIcon: himAiChatIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(HimAiChatPane),
}], VIEW_CONTAINER);

registerAction2(class NewHimChatTabAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.newTab',
			title: localize2('himAiChat.newTab', 'New Chat'),
			f1: true,
			icon: Codicon.plus,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: -1,
				when: ContextKeyExpr.equals('view', HIM_AI_CHAT_VIEW_ID),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const view = viewsService.getActiveViewWithId(HIM_AI_CHAT_VIEW_ID) as HimAiChatPane | undefined;
		if (view) {
			view.createNewTab();
		}
	}
});

registerAction2(class OpenHimAiChatSettingsAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.openUserSettings',
			title: localize2('himAiChat.openUserSettings', 'Open HIM CODE Settings'),
			f1: true,
			icon: Codicon.settingsGear,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 0,
				when: ContextKeyExpr.equals('view', HIM_AI_CHAT_VIEW_ID),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		// Open native Settings filtered to `himCode.chat.*` so keys like `semanticProgramMode` are visible (webview panel omits some).
		await commandService.executeCommand('workbench.action.openSettings', HIM_CHAT_SETTINGS_QUERY);
	}
});

// 3. Register as a Workbench Contribution to ensure it is focused initially
class HimAiChatContribution implements IWorkbenchContribution {
	constructor(
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		void this.init();
	}

	private async init(): Promise<void> {
		// Ensure the view cannot get stranded in another container from stale layout state.
		const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(HIM_AI_CHAT_VIEW_ID);
		const targetContainer = this.viewDescriptorService.getViewContainerById(HIM_AI_CHAT_CONTAINER_ID);
		const currentContainer = this.viewDescriptorService.getViewContainerByViewId(HIM_AI_CHAT_VIEW_ID);
		if (viewDescriptor && targetContainer && (!currentContainer || currentContainer.id !== targetContainer.id)) {
			this.viewDescriptorService.moveViewsToContainer([viewDescriptor], targetContainer, ViewVisibilityState.Expand, 'him-ai-chat-restore');
		}

		// Open the Auxiliary Bar and focus the concrete view so users always see input area.
		await this.paneCompositeService.openPaneComposite(HIM_AI_CHAT_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar, true);
		await this.viewsService.openView(HIM_AI_CHAT_VIEW_ID, true);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(HimAiChatContribution, LifecyclePhase.Restored);

class HimOrganizationBootstrapContribution implements IWorkbenchContribution {
	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		void this.run();
	}

	private async run(): Promise<void> {
		try {
			const hostRoot = getHimCodeHostDataRoot(this.environmentService, this.workspaceContextService.getWorkspace());
			await ensureWorkspaceOrganizationBootstrap(this.fileService, hostRoot);
		} catch {
			// Workspace may be read-only; command path can retry later.
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	HimOrganizationBootstrapContribution,
	LifecyclePhase.Restored,
);

registerAction2(class OpenHimOrganizationFileAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.openOrganizationFile',
			title: localize2('himAiChat.openOrganizationFile', 'HIM CODE: Open Organization (org.json)'),
			f1: true,
			category: localize2('himAiChatCategory', 'HIM CODE'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const environmentService = accessor.get(IEnvironmentService);
		const hostRoot = getHimCodeHostDataRoot(environmentService, workspaceContextService.getWorkspace());
		await ensureWorkspaceOrganizationBootstrap(fileService, hostRoot);
		const uri = getOrganizationFileUri(hostRoot);
		await editorService.openEditor({ resource: uri, options: { pinned: true } });
	}
});

registerAction2(class HimAiChatFocusPanelAction extends Action2 {
	constructor() {
		super({
			id: 'himAiChat.focusPanel',
			title: localize2('himAiChat.focusPanel', 'HIM CODE: Show Chat Panel'),
			f1: true,
			category: localize2('himAiChatCategory', 'HIM CODE'),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const paneCompositeService = accessor.get(IPaneCompositePartService);
		const viewsService = accessor.get(IViewsService);
		await paneCompositeService.openPaneComposite(HIM_AI_CHAT_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar, true);
		await viewsService.openView(HIM_AI_CHAT_VIEW_ID, true);
	}
});
