/*---------------------------------------------------------------------------------------------
 *  Structured plan for HIM Plan mode (host-orchestrated steps).
 *--------------------------------------------------------------------------------------------*/

export const HIM_PLAN_JSON_VERSION = 1 as const;

/** One node in the plan tree. */
export type HimPlanNode =
	| HimPlanTaskNode
	| HimPlanSequenceNode
	| HimPlanForEachNode
	| HimPlanWhileNode;

export interface HimPlanTaskNode {
	readonly id: string;
	readonly kind: 'task';
	readonly title: string;
	/** What the model should do in this atomic step (may reference {{var}} inside for_each). */
	readonly objective: string;
	readonly constraints?: string;
	/** Soft hint: prefer at most N tool blocks in one reply (enforced in prompt only). */
	readonly maxToolBlocks?: number;
}

export interface HimPlanSequenceNode {
	readonly id: string;
	readonly kind: 'sequence';
	readonly title?: string;
	readonly children: HimPlanNode[];
}

export interface HimPlanForEachNode {
	readonly id: string;
	readonly kind: 'for_each';
	readonly title?: string;
	/** Placeholder name, e.g. "file" → replaced in body as {{file}}. */
	readonly variable: string;
	readonly items: string[];
	readonly body: HimPlanNode;
}

export interface HimPlanWhileNode {
	readonly id: string;
	readonly kind: 'while_loop';
	readonly title?: string;
	readonly maxIterations: number;
	/** Describes when to stop; host repeats body up to maxIterations (no Python while). */
	readonly conditionHint: string;
	readonly body: HimPlanNode;
}

export interface HimPlanDocument {
	readonly version: typeof HIM_PLAN_JSON_VERSION;
	readonly title?: string;
	readonly root: HimPlanNode;
}

/** Flattened runnable step after expanding for_each / while_loop. */
export interface HimLinearPlanStep {
	readonly id: string;
	readonly pathLabel: string;
	readonly title: string;
	readonly objective: string;
	readonly constraints?: string;
}
