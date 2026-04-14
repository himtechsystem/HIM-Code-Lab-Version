/*---------------------------------------------------------------------------------------------
 *  Persist semantic program under workspace storage `him-code/agents/<id>/agent_program.him`
 *
 *  Author/Compiler output is merged by Runtime; authoritative `current_pointer` / `status`
 *  on disk follow host logic — see docs/HIM_SEMANTIC_PROGRAM_SPEC.md.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { getAgentPlanFolder } from './himPlanFileSupport.js';
import {
	HIM_SEMANTIC_PROGRAM_VERSION,
	type HimSemanticProgramDocument,
	type HimSemanticInstruction,
	type HimSemanticInstructionStatus,
} from './himSemanticProgramTypes.js';

export const HIM_SEMANTIC_PROGRAM_FILENAME = 'agent_program.him';

/** @param hostDataRoot from {@link getHimCodeHostDataRoot} */
export function getSemanticProgramUri(hostDataRoot: URI, sessionId: string): URI {
	return URI.joinPath(getAgentPlanFolder(hostDataRoot, sessionId), HIM_SEMANTIC_PROGRAM_FILENAME);
}

function validateInstruction(x: unknown): x is HimSemanticInstruction {
	if (!x || typeof x !== 'object') {
		return false;
	}
	const o = x as Record<string, unknown>;
	if (typeof o.intent !== 'string' || !o.intent.trim()) {
		return false;
	}
	if (o.next_code !== null && typeof o.next_code !== 'string') {
		return false;
	}
	const st = o.status;
	if (
		st !== 'PENDING' &&
		st !== 'READY' &&
		st !== 'RUNNING' &&
		st !== 'SUCCEEDED' &&
		st !== 'FAILED' &&
		st !== 'SKIPPED'
	) {
		return false;
	}
	if (o.local_constraints !== undefined) {
		if (!Array.isArray(o.local_constraints) || !o.local_constraints.every(s => typeof s === 'string')) {
			return false;
		}
	}
	return true;
}

export function validateSemanticProgramDocument(x: unknown): x is HimSemanticProgramDocument {
	if (!x || typeof x !== 'object') {
		return false;
	}
	const o = x as Record<string, unknown>;
	if (o.version !== HIM_SEMANTIC_PROGRAM_VERSION || typeof o.session_id !== 'string') {
		return false;
	}
	if (typeof o.updated_at !== 'string' || typeof o.current_pointer !== 'string' || !o.current_pointer.trim()) {
		return false;
	}
	if (!o.program_metadata || typeof o.program_metadata !== 'object') {
		return false;
	}
	const pm = o.program_metadata as Record<string, unknown>;
	if (!Array.isArray(pm.global_constraints) || !pm.global_constraints.every(s => typeof s === 'string')) {
		return false;
	}
	if (pm.atomic_verify !== undefined && pm.atomic_verify !== 'none' && pm.atomic_verify !== 'git_numstat') {
		return false;
	}
	if (!o.instructions || typeof o.instructions !== 'object') {
		return false;
	}
	const instr = o.instructions as Record<string, unknown>;
	for (const k of Object.keys(instr)) {
		if (!validateInstruction(instr[k])) {
			return false;
		}
	}
	return true;
}

export async function readSemanticProgram(
	fileService: IFileService,
	uri: URI,
): Promise<HimSemanticProgramDocument | undefined> {
	try {
		const file = await fileService.readFile(uri);
		const raw = file.value.toString();
		const parsed = JSON.parse(raw) as unknown;
		if (!validateSemanticProgramDocument(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writeSemanticProgram(
	fileService: IFileService,
	uri: URI,
	doc: HimSemanticProgramDocument,
): Promise<void> {
	await fileService.createFolder(dirname(uri));
	const next: HimSemanticProgramDocument = {
		...doc,
		updated_at: new Date().toISOString(),
	};
	await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(next, null, 2)), { atomic: false });
}

/**
 * Minimal valid graph on disk before phase 1: Author edits this baseline instead of inventing from empty JSON.
 * `START` → `END` (terminal). Pointer starts at `START`.
 */
export function createBootstrapSemanticProgram(
	sessionId: string,
	globalConstraints: readonly string[],
): HimSemanticProgramDocument {
	const start: HimSemanticInstruction = {
		intent:
			'Refine this stub for the user’s current request: replace this intent with a concrete first atomic step (or split into new instruction ids) and wire `next_code` until `END`.',
		next_code: 'END',
		status: 'PENDING' as HimSemanticInstructionStatus,
	};
	const end: HimSemanticInstruction = {
		intent: 'Session wrap-up: summarize what was done and note follow-ups (keep as the last graph node).',
		next_code: null,
		status: 'PENDING' as HimSemanticInstructionStatus,
	};
	return {
		version: HIM_SEMANTIC_PROGRAM_VERSION,
		session_id: sessionId,
		updated_at: new Date().toISOString(),
		program_metadata: { global_constraints: [...globalConstraints], atomic_verify: 'none' },
		instructions: { START: start, END: end },
		current_pointer: 'START',
	};
}

/** @deprecated Prefer {@link createBootstrapSemanticProgram}. */
export function createEmptySemanticProgram(
	sessionId: string,
	globalConstraints: readonly string[],
): HimSemanticProgramDocument {
	return createBootstrapSemanticProgram(sessionId, globalConstraints);
}

/**
 * Ensures `agent_program.him` exists under host data and parses as a valid program.
 * Missing or invalid files are overwritten with a bootstrap document.
 */
export async function ensureSessionSemanticProgramBootstrap(
	fileService: IFileService,
	hostDataRoot: URI,
	sessionId: string,
	globalConstraints: readonly string[],
): Promise<HimSemanticProgramDocument> {
	const uri = getSemanticProgramUri(hostDataRoot, sessionId);
	let doc = await readSemanticProgram(fileService, uri);
	if (!doc) {
		doc = createBootstrapSemanticProgram(sessionId, globalConstraints);
		await writeSemanticProgram(fileService, uri, doc);
		return doc;
	}
	return {
		...doc,
		session_id: sessionId,
	};
}
