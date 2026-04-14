/*---------------------------------------------------------------------------------------------
 *  HIM host data root — under VS Code workspace storage (not inside the repository).
 *  Mirrors the former `.him-code/` tree: organization/, agents/, sessions/, tmp/, diff-base/
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../../base/common/resources.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IWorkspace } from '../../../../platform/workspace/common/workspace.js';

/** Folder name under `workspaceStorage/<workspaceId>/`. */
export const HIM_CODE_HOST_FOLDER_NAME = 'him-code';

/**
 * Per-window workspace storage URI for HIM internal JSON and scratch files.
 * Same machine location as other workspace state (e.g. Application Support/.../workspaceStorage on macOS).
 */
export function getHimCodeHostDataRoot(environmentService: IEnvironmentService, workspace: IWorkspace) {
	return joinPath(environmentService.workspaceStorageHome, workspace.id, HIM_CODE_HOST_FOLDER_NAME);
}
