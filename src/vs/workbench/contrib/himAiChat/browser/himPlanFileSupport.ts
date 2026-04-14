/*---------------------------------------------------------------------------------------------
 *  Plan file on disk — under workspace storage: `.../him-code/agents/<id>/plan.json`.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import type { HimPlanDocument } from './himPlanTypes.js';
import { HIM_PLAN_JSON_VERSION } from './himPlanTypes.js';

/** Logical path string for prompts (on disk: workspaceStorage/.../him-code/agents/...). */
export const HIM_PLAN_PROMPT_RELATIVE_PREFIX = 'him-code/agents';
export const HIM_PLAN_AGENTS_SEGMENT = 'agents';
export const HIM_PLAN_FILENAME = 'plan.json';

export function formatHimPlanPromptPath(sessionId: string, fileName: string): string {
	return `${HIM_PLAN_PROMPT_RELATIVE_PREFIX}/${sanitizeAgentDir(sessionId)}/${fileName}`;
}

export interface HimPlanFileEnvelope {
	readonly version: typeof HIM_PLAN_JSON_VERSION;
	readonly sessionId: string;
	readonly updatedAt: string;
	readonly title?: string;
	/** Completed task path labels (see `linearizePlan` pathLabel). */
	completedStepPathLabels: string[];
	plan: HimPlanDocument;
}

export function sanitizeAgentDir(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

/** @param hostDataRoot from {@link getHimCodeHostDataRoot} */
export function getAgentPlanFolder(hostDataRoot: URI, sessionId: string): URI {
	const dir = sanitizeAgentDir(sessionId);
	return URI.joinPath(hostDataRoot, HIM_PLAN_AGENTS_SEGMENT, dir);
}

export function getPlanFileUri(hostDataRoot: URI, sessionId: string): URI {
	return URI.joinPath(getAgentPlanFolder(hostDataRoot, sessionId), HIM_PLAN_FILENAME);
}

export function createPlanEnvelope(sessionId: string, plan: HimPlanDocument, title?: string): HimPlanFileEnvelope {
	return {
		version: HIM_PLAN_JSON_VERSION,
		sessionId,
		updatedAt: new Date().toISOString(),
		title,
		completedStepPathLabels: [],
		plan,
	};
}

function validateEnvelope(x: unknown): x is HimPlanFileEnvelope {
	if (!x || typeof x !== 'object') {
		return false;
	}
	const o = x as Record<string, unknown>;
	if (o.version !== HIM_PLAN_JSON_VERSION || typeof o.sessionId !== 'string' || typeof o.plan !== 'object') {
		return false;
	}
	if (!Array.isArray(o.completedStepPathLabels) || !o.completedStepPathLabels.every(s => typeof s === 'string')) {
		return false;
	}
	return true;
}

export async function readPlanEnvelope(
	fileService: IFileService,
	planUri: URI,
): Promise<HimPlanFileEnvelope | undefined> {
	try {
		const file = await fileService.readFile(planUri);
		const raw = file.value.toString();
		const parsed = JSON.parse(raw) as unknown;
		if (!validateEnvelope(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writePlanEnvelope(
	fileService: IFileService,
	planUri: URI,
	envelope: HimPlanFileEnvelope,
): Promise<void> {
	await fileService.createFolder(dirname(planUri));
	const next: HimPlanFileEnvelope = {
		...envelope,
		updatedAt: new Date().toISOString(),
	};
	await fileService.writeFile(planUri, VSBuffer.fromString(JSON.stringify(next, null, 2)), { atomic: false });
}

/** Drop completion entries that no longer appear as step path labels in the new plan linearization. */
export function pruneCompletedForNewPlan(completed: string[], validPathLabels: ReadonlySet<string>): string[] {
	return completed.filter(c => validPathLabels.has(c));
}
