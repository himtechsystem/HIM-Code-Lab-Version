/*---------------------------------------------------------------------------------------------
 *  Organization file: `<workspaceStorage>/<id>/him-code/organization/org.json`
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import {
	HIM_ORGANIZATION_JSON_VERSION,
	HIM_ORG_ORCHESTRATOR_AGENT_ID,
	HIM_ORG_USER_AGENT_ID,
	type HimOrganizationDocument,
	type HimOrgAgent,
	type HimOrgEdge,
	type HimOrgWorld,
} from './himOrganizationTypes.js';

export const HIM_ORGANIZATION_FILENAME = 'org.json';

/** @param hostDataRoot from {@link getHimCodeHostDataRoot} */
export function getOrganizationFileUri(hostDataRoot: URI): URI {
	return URI.joinPath(hostDataRoot, 'organization', HIM_ORGANIZATION_FILENAME);
}

function validateWorld(x: unknown, reasons?: string[]): x is HimOrgWorld {
	if (!x || typeof x !== 'object') {
		reasons?.push('world: not an object');
		return false;
	}
	const o = x as Record<string, unknown>;
	const t = o.type;
	if (t === 'none') {
		return true;
	}
	if (t === 'filesystem') {
		if (!Array.isArray(o.roots)) {
			reasons?.push('world.roots: not an array');
			return false;
		}
		if (!o.roots.every(r => typeof r === 'string')) {
			reasons?.push('world.roots: contains non-string elements');
			return false;
		}
		return true;
	}
	if (t === 'browser' || t === 'search') {
		return true;
	}
	reasons?.push(`world.type: unknown type "${t}"`);
	return false;
}

function validateAgent(x: unknown, reasons?: string[]): x is HimOrgAgent {
	if (!x || typeof x !== 'object') {
		reasons?.push('agent: not an object');
		return false;
	}
	const o = x as Record<string, unknown>;
	if (typeof o.id !== 'string' || !o.id.trim()) {
		reasons?.push(`agent.id invalid: ${JSON.stringify(o.id)}`);
		return false;
	}
	if (!/^[a-z0-9_-]{1,64}$/i.test(o.id)) {
		reasons?.push(`agent.id format invalid: "${o.id}" (allowed: a-z, 0-9, _, -)`);
		return false;
	}
	if (typeof o.display_name !== 'string') {
		reasons?.push(`agent.display_name missing for "${o.id}"`);
		return false;
	}
	const k = o.kind;
	if (k !== 'user' && k !== 'orchestrator' && k !== 'worker') {
		reasons?.push(`agent.kind invalid: "${k}" (allowed: user, orchestrator, worker)`);
		return false;
	}
	if (typeof o.mandate !== 'string') {
		reasons?.push(`agent.mandate missing or not string for "${o.id}"`);
		return false;
	}
	if (o.immutable !== undefined && typeof o.immutable !== 'boolean') {
		reasons?.push(`agent.immutable invalid for "${o.id}"`);
		return false;
	}
	if (!validateWorld(o.world, reasons)) {
		reasons?.push(`agent.world validation failed for "${o.id}"`);
		return false;
	}
	if (k === 'user' && o.id !== HIM_ORG_USER_AGENT_ID) {
		reasons?.push(`agent.kind=user but id is not "${HIM_ORG_USER_AGENT_ID}"`);
		return false;
	}
	if (k === 'user' && o.immutable !== true) {
		reasons?.push(`agent.kind=user must be immutable: true`);
		return false;
	}
	return true;
}

function validateEdge(x: unknown, agentIds: ReadonlySet<string>, reasons?: string[]): x is HimOrgEdge {
	if (!x || typeof x !== 'object') {
		reasons?.push('edge: not an object');
		return false;
	}
	const o = x as Record<string, unknown>;
	if (typeof o.from !== 'string' || typeof o.to !== 'string' || !o.from.trim() || !o.to.trim()) {
		reasons?.push(`edge.from/to invalid: from=${JSON.stringify(o.from)}, to=${JSON.stringify(o.to)}`);
		return false;
	}
	const ek = o.kind;
	if (ek !== 'delegate' && ek !== 'inform' && ek !== 'request_user') {
		reasons?.push(`edge.kind invalid: "${ek}" (allowed: delegate, inform, request_user)`);
		return false;
	}
	if (o.when !== undefined && typeof o.when !== 'string') {
		reasons?.push(`edge.when must be string: ${JSON.stringify(o.when)}`);
		return false;
	}
	if (!agentIds.has(o.from)) {
		reasons?.push(`edge.from references unknown agent: "${o.from}"`);
		return false;
	}
	if (!agentIds.has(o.to)) {
		reasons?.push(`edge.to references unknown agent: "${o.to}"`);
		return false;
	}
	return true;
}

export function validateOrganizationDocument(x: unknown, reasons?: string[]): x is HimOrganizationDocument {
	if (!x || typeof x !== 'object') {
		reasons?.push('document: not an object');
		return false;
	}
	const o = x as Record<string, unknown>;
	if (o.version !== HIM_ORGANIZATION_JSON_VERSION) {
		reasons?.push(`document.version mismatched: ${o.version} (expected ${HIM_ORGANIZATION_JSON_VERSION})`);
		return false;
	}
	if (typeof o.updated_at !== 'string') {
		reasons?.push('document.updated_at missing or not string');
		return false;
	}
	if (!Array.isArray(o.agents) || o.agents.length === 0) {
		reasons?.push('document.agents missing or empty');
		return false;
	}
	
	const agentReasons: string[] = [];
	if (!o.agents.every(a => validateAgent(a, agentReasons))) {
		reasons?.push(...agentReasons);
		return false;
	}
	
	const ids = new Set<string>();
	for (const a of o.agents as HimOrgAgent[]) {
		if (ids.has(a.id)) {
			reasons?.push(`document.agents: duplicated id "${a.id}"`);
			return false;
		}
		ids.add(a.id);
	}
	if (!ids.has(HIM_ORG_USER_AGENT_ID)) {
		reasons?.push(`document.agents: user agent missing (id: "${HIM_ORG_USER_AGENT_ID}")`);
		return false;
	}
	const userAgent = (o.agents as HimOrgAgent[]).find(a => a.id === HIM_ORG_USER_AGENT_ID);
	if (!userAgent || userAgent.kind !== 'user') {
		reasons?.push(`document.agents: user agent kind mismatch`);
		return false;
	}
	if (!Array.isArray(o.edges)) {
		reasons?.push('document.edges: not an array');
		return false;
	}
	for (const e of o.edges) {
		const edgeReasons: string[] = [];
		if (!validateEdge(e, ids, edgeReasons)) {
			reasons?.push(...edgeReasons);
			return false;
		}
	}
	const ps = o.plan_status;
	if (ps !== undefined && ps !== 'draft' && ps !== 'pending_consensus' && ps !== 'ratified') {
		reasons?.push(`document.plan_status invalid: "${ps}"`);
		return false;
	}
	if (o.ratified_at !== undefined && typeof o.ratified_at !== 'string') {
		reasons?.push('document.ratified_at invalid');
		return false;
	}
	if (o.consensus_note !== undefined && typeof o.consensus_note !== 'string') {
		reasons?.push('document.consensus_note invalid');
		return false;
	}
	return true;
}

/** Host rule: the operator row cannot be removed from org JSON. */
export function isOrganizationUserAgentId(agentId: string): boolean {
	return agentId === HIM_ORG_USER_AGENT_ID;
}

export function createBootstrapOrganization(): HimOrganizationDocument {
	const orchestratorMandate =
		'Plan the multi-agent organization only: agent names, mandates, worlds (scopes), and edges. Do not execute product work or call workspace tools; output changes as structured org updates for the host to persist. ' +
		'A proposed structure is not final until every agent listed acknowledges their mandate and world, agrees the division of work can complete the user task, and the host marks `plan_status` as `ratified` (see `consensus_note`).';
	const user: HimOrgAgent = {
		id: HIM_ORG_USER_AGENT_ID,
		display_name: 'User (operator)',
		kind: 'user',
		mandate:
			'Human operator. Other agents route questions and missing information here. This row is fixed and cannot be deleted.',
		world: { type: 'none' },
		immutable: true,
	};
	const orchestrator: HimOrgAgent = {
		id: HIM_ORG_ORCHESTRATOR_AGENT_ID,
		display_name: 'Orchestrator',
		kind: 'orchestrator',
		mandate: orchestratorMandate,
		world: { type: 'none' },
	};
	return {
		version: HIM_ORGANIZATION_JSON_VERSION,
		updated_at: new Date().toISOString(),
		agents: [user, orchestrator],
		edges: [],
		plan_status: 'draft',
		consensus_note:
			'Orchestrator drafts the org; each worker must explicitly acknowledge mandate + world. The plan becomes executable only when all agents consent and `plan_status` is set to `ratified` (future host checks).',
	};
}

export async function readOrganizationDocument(
	fileService: IFileService,
	uri: URI,
): Promise<HimOrganizationDocument | undefined> {
	try {
		const file = await fileService.readFile(uri);
		const parsed = JSON.parse(file.value.toString()) as unknown;
		if (!validateOrganizationDocument(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export async function writeOrganizationDocument(
	fileService: IFileService,
	uri: URI,
	doc: HimOrganizationDocument,
): Promise<void> {
	await fileService.createFolder(dirname(uri));
	const next: HimOrganizationDocument = {
		...doc,
		updated_at: new Date().toISOString(),
	};
	await fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(next, null, 2)), { atomic: false });
}

/** Ensures org.json exists and passes validation; otherwise writes the bootstrap document. */
export async function ensureWorkspaceOrganizationBootstrap(
	fileService: IFileService,
	hostDataRoot: URI,
): Promise<HimOrganizationDocument> {
	const uri = getOrganizationFileUri(hostDataRoot);
	let doc = await readOrganizationDocument(fileService, uri);
	if (!doc) {
		doc = createBootstrapOrganization();
		await writeOrganizationDocument(fileService, uri, doc);
	}
	return doc;
}
