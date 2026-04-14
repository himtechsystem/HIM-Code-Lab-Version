/*---------------------------------------------------------------------------------------------
 *  Parse / validate / merge HIM semantic programs and Compiler JSON output
 *--------------------------------------------------------------------------------------------*/

import type {
	HimSemanticCompilerResult,
	HimSemanticProgramDocument,
	HimSemanticInstruction,
} from './himSemanticProgramTypes.js';
import { validateSemanticProgramDocument } from './himSemanticProgramFileSupport.js';
import { HIM_SEMANTIC_CODEGEN_ATOMIC_NOTE } from './himSemanticProgramPrompts.js';

const SEMANTIC_TAG = /<him-semantic-program(?:\s[^>]*)?>([\s\S]*?)<\/him-semantic-program>/i;
const SEMANTIC_TAG_GLOBAL = new RegExp(SEMANTIC_TAG.source, 'gi');

/** Strip `<him-semantic-program>...</him-semantic-program>` from assistant text for chat display. */
export function stripSemanticProgramBlockForDisplay(text: string): string {
	return text.replace(SEMANTIC_TAG_GLOBAL, '').replace(/\n{3,}/g, '\n\n').trim();
}

export const HIM_SEMANTIC_STEP_DONE = 'HIM_SEMANTIC_STEP_DONE';

export function extractSemanticProgramBlock(fullText: string): string | undefined {
	const m = fullText.match(SEMANTIC_TAG);
	return m ? m[1].trim() : undefined;
}

export function parseSemanticProgramJson(text: string): HimSemanticProgramDocument | undefined {
	const raw = tryParseJsonObject(text.trim());
	if (!raw || !validateSemanticProgramDocument(raw)) {
		return undefined;
	}
	return raw as HimSemanticProgramDocument;
}

export function extractAndParseSemanticProgram(fullText: string): HimSemanticProgramDocument | undefined {
	const block = extractSemanticProgramBlock(fullText);
	if (!block) {
		return undefined;
	}
	return parseSemanticProgramJson(block);
}

/** Ensure every next_code references an existing instruction key (or null). */
export function validateInstructionGraph(doc: HimSemanticProgramDocument): boolean {
	const keys = new Set(Object.keys(doc.instructions));
	if (!keys.has(doc.current_pointer)) {
		return false;
	}
	for (const [id, ins] of Object.entries(doc.instructions)) {
		if (ins.next_code !== null && !keys.has(ins.next_code)) {
			return false;
		}
		void id;
	}
	return true;
}

function tryParseJsonObject(text: string): unknown | undefined {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		// try fenced block
		const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fence) {
			try {
				return JSON.parse(fence[1].trim());
			} catch {
				return undefined;
			}
		}
		const start = trimmed.indexOf('{');
		const end = trimmed.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return undefined;
			}
		}
		return undefined;
	}
}

function validateCompilerResult(x: unknown): x is HimSemanticCompilerResult {
	if (!x || typeof x !== 'object') {
		return false;
	}
	const o = x as Record<string, unknown>;
	if (o.decision !== 'AUDIT_PASS' && o.decision !== 'REFACTOR_PLAN' && o.decision !== 'REJECT') {
		return false;
	}
	if (typeof o.reason !== 'string') {
		return false;
	}
	if (o.updated_instructions !== undefined && o.updated_instructions !== null && typeof o.updated_instructions !== 'object') {
		return false;
	}
	return true;
}

export function parseCompilerResult(text: string): HimSemanticCompilerResult | undefined {
	const raw = tryParseJsonObject(text);
	if (!raw || !validateCompilerResult(raw)) {
		return undefined;
	}
	return raw as HimSemanticCompilerResult;
}

/** Apply REFACTOR_PLAN: full replace instructions; optionally move pointer. */
export function applyCompilerRefactor(
	doc: HimSemanticProgramDocument,
	result: HimSemanticCompilerResult,
): HimSemanticProgramDocument | undefined {
	if (result.decision !== 'REFACTOR_PLAN' || !result.updated_instructions) {
		return undefined;
	}
	const merged: HimSemanticProgramDocument = {
		...doc,
		instructions: { ...result.updated_instructions },
		current_pointer: result.next_current_pointer?.trim() || doc.current_pointer,
		updated_at: doc.updated_at,
	};
	if (!validateSemanticProgramDocument(merged) || !validateInstructionGraph(merged)) {
		return undefined;
	}
	return merged;
}

export function mergeInstructionPatch(
	doc: HimSemanticProgramDocument,
	patch: Record<string, HimSemanticInstruction>,
): HimSemanticProgramDocument {
	return {
		...doc,
		instructions: { ...doc.instructions, ...patch },
	};
}

export function buildSemanticStepUserMessage(
	stepId: string,
	inst: HimSemanticInstruction,
	stepIndex: number,
	totalSteps: number,
	opts?: { programFileRelativePath?: string; extraSystemHints?: string },
): string {
	const lines = [
		`[HIM semantic — step ${stepIndex + 1} of ${totalSteps}]`,
		`Instruction ID: \`${stepId}\``,
		'',
		'### Intent',
		inst.intent.trim(),
	];
	if (inst.local_constraints?.length) {
		lines.push('', '### Local constraints', ...inst.local_constraints.map(c => `- ${c}`));
	}
	if (opts?.programFileRelativePath) {
		lines.push('', `Canonical program file: \`${opts.programFileRelativePath}\``);
	}
	if (opts?.extraSystemHints?.trim()) {
		lines.push('', opts.extraSystemHints.trim());
	}
	lines.push('', HIM_SEMANTIC_CODEGEN_ATOMIC_NOTE);
	lines.push(
		'',
		'Execute **only** this step using <him-python> / <him-shell> as needed.',
		`When finished, end with a single line: ${HIM_SEMANTIC_STEP_DONE}`,
	);
	return lines.join('\n');
}
