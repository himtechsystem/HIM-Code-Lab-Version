/*---------------------------------------------------------------------------------------------
 *  HIM semantic program (HIM-ISA) — disk + runtime types
 *
 *  Normative host rules: see docs/HIM_SEMANTIC_PROGRAM_SPEC.md (pointer/status Runtime-owned,
 *  fixed Compiler/Codegen schemas, atomic rules finalized by post-hoc diff).
 *--------------------------------------------------------------------------------------------*/

export const HIM_SEMANTIC_PROGRAM_VERSION = 1 as const;

/** Host-owned status for each instruction; model may suggest but Runtime writes final transitions. */
export type HimSemanticInstructionStatus =
	| 'PENDING'
	| 'READY'
	| 'RUNNING'
	| 'SUCCEEDED'
	| 'FAILED'
	| 'SKIPPED';

export interface HimSemanticInstruction {
	readonly intent: string;
	readonly next_code: string | null;
	readonly local_constraints?: readonly string[];
	status: HimSemanticInstructionStatus;
}

/** How Runtime verifies atomic rules after each Codegen step (`none` = no automatic check). */
export type HimSemanticAtomicVerifyMode = 'none' | 'git_numstat';

export interface HimSemanticProgramMetadata {
	readonly agent_id?: string;
	readonly global_constraints: readonly string[];
	/**
	 * Author decides whether the host may call git for post-step verification.
	 * Omit or `none`: no git. `git_numstat`: compare `git diff HEAD --numstat` before/after the step.
	 */
	readonly atomic_verify?: HimSemanticAtomicVerifyMode;
}

export interface HimSemanticProgramDocument {
	readonly version: typeof HIM_SEMANTIC_PROGRAM_VERSION;
	readonly session_id: string;
	updated_at: string;
	readonly program_metadata: HimSemanticProgramMetadata;
	instructions: Record<string, HimSemanticInstruction>;
	current_pointer: string;
}

export type HimSemanticCompilerDecision = 'AUDIT_PASS' | 'REFACTOR_PLAN' | 'REJECT';

/** Model output for Compiler role (JSON). */
export interface HimSemanticCompilerResult {
	readonly decision: HimSemanticCompilerDecision;
	readonly reason: string;
	readonly updated_instructions?: Record<string, HimSemanticInstruction> | null;
	/** When decision is REFACTOR_PLAN, Runtime moves pointer here if set. */
	readonly next_current_pointer?: string | null;
	readonly notes_for_runtime?: string | null;
}
