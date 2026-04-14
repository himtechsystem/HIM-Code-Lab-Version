/*---------------------------------------------------------------------------------------------
 *  HIM Code — persistent Python REPL for fenced ```python blocks (workbench service)
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IHimPythonReplService {
	readonly _serviceBrand: undefined;

	/**
	 * Run one logical block in a per-session persistent `python -u -i` process (via exec of a temp file).
	 * @param sessionId Isolates REPL state and process; default `default`.
	 * @param onOutput Streaming text (ANSI stripped upstream where applicable).
	 */
	runBlock(
		code: string,
		onOutput: (chunk: string) => void,
		token: CancellationToken,
		sessionId?: string,
	): Promise<{ output: string; hadError: boolean }>;

	/** Kill the Python process for a chat session (e.g. tab closed). */
	disposeSession(sessionId: string): void;
}

export const IHimPythonReplService = createDecorator<IHimPythonReplService>('himPythonReplService');
