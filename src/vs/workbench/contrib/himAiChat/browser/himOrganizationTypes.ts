/*---------------------------------------------------------------------------------------------
 *  HIM Organization — workspace-level multi-agent org graph (disk JSON).
 *  v1: agents + edges + world scopes. Orchestrator only plans org structure (enforced later).
 *--------------------------------------------------------------------------------------------*/

export const HIM_ORGANIZATION_JSON_VERSION = 1 as const;

/** Reserved id for the human operator; must never be removed from `agents`. */
export const HIM_ORG_USER_AGENT_ID = 'user';

/** Default bootstrap id for the meta planner agent. */
export const HIM_ORG_ORCHESTRATOR_AGENT_ID = 'orchestrator';

export type HimOrgAgentKind = 'user' | 'orchestrator' | 'worker';

export type HimOrgEdgeKind = 'delegate' | 'inform' | 'request_user';

export interface HimOrgWorldNone {
	readonly type: 'none';
}

export interface HimOrgWorldFilesystem {
	readonly type: 'filesystem';
	/** Workspace-relative POSIX-style paths (no `..` segments); host normalizes later. */
	readonly roots: readonly string[];
}

export interface HimOrgWorldBrowser {
	readonly type: 'browser';
}

export interface HimOrgWorldSearch {
	readonly type: 'search';
}

export type HimOrgWorld = HimOrgWorldNone | HimOrgWorldFilesystem | HimOrgWorldBrowser | HimOrgWorldSearch;

export interface HimOrgAgent {
	readonly id: string;
	readonly display_name: string;
	readonly kind: HimOrgAgentKind;
	/** Natural-language responsibility; orchestrator uses this when proposing org changes. */
	readonly mandate: string;
	readonly world: HimOrgWorld;
	/**
	 * When true, host must reject removals (only `user` is immutable in v1).
	 * Orchestrator/worker rows may be edited or removed by future flows.
	 */
	readonly immutable?: boolean;
}

export interface HimOrgEdge {
	readonly from: string;
	readonly to: string;
	readonly kind: HimOrgEdgeKind;
	/** Optional human-readable trigger for routing (structured conditions come later). */
	readonly when?: string;
}

/**
 * Lifecycle of an orchestrator-proposed org structure.
 * `ratified` means every agent has acknowledged mandate/world and agrees the plan can satisfy the task (host-enforced later).
 */
export type HimOrgPlanStatus = 'draft' | 'pending_consensus' | 'ratified';

export interface HimOrganizationDocument {
	readonly version: typeof HIM_ORGANIZATION_JSON_VERSION;
	updated_at: string;
	readonly agents: readonly HimOrgAgent[];
	readonly edges: readonly HimOrgEdge[];
	/** Proposals start as draft; execution unlocks only after ratification workflow. */
	plan_status?: HimOrgPlanStatus;
	/** Set when `plan_status` becomes `ratified` (ISO-8601). */
	ratified_at?: string;
	/** Free-form host or orchestrator notes on consensus state. */
	consensus_note?: string;
}
