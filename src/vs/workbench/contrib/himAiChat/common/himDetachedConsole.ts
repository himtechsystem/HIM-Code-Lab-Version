/*---------------------------------------------------------------------------------------------
 *  HIM Detached Console — shared types (main window Agent List ↔ auxiliary window console).
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IHimDetachedConsoleService = createDecorator<IHimDetachedConsoleService>('himDetachedConsoleService');

/** Serializable editor context pushed from main window → detached console. */
export interface IHimDetachedEditorContext {
	readonly resource?: URI;
	readonly selectionText?: string;
	readonly startLine?: number;
	readonly endLine?: number;
}

export interface IHimDetachedConsoleService {
	readonly _serviceBrand: undefined;

	/** True while an auxiliary HIM console window is open. */
	readonly hasDetachedWindow: boolean;

	/** Fired when main window pushes editor/selection context (same JS heap; also mirrored via BroadcastChannel when available). */
	readonly onDidReceiveEditorContext: Event<IHimDetachedEditorContext>;

	/**
	 * Open or focus the detached console for a chat/agent session.
	 * Agent REPL/state lives in IHimPythonReplService + workspace session store — survives closing this window.
	 */
	openForAgentSession(sessionId: string, title?: string): Promise<void>;

	/** Close the detached window if open. */
	close(): void;

	/** Called from main (e.g. editor listeners) to sync selection/files to the detached UI. */
	pushEditorContext(context: IHimDetachedEditorContext): void;

}
