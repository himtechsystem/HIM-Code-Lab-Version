/*---------------------------------------------------------------------------------------------
 *  Parse `<him-org>` blocks or "方案 B：组织规划" blocks from orchestrator replies; validate against org schema.
 *--------------------------------------------------------------------------------------------*/

import { validateOrganizationDocument } from './himOrganizationFileSupport.js';
import { HIM_ORGANIZATION_JSON_VERSION, type HimOrganizationDocument } from './himOrganizationTypes.js';

const ORG_TAG = /<him-org(?:\s[^>]*)?>([\s\S]*?)<\/him-org>/i;
const ORG_TAG_GLOBAL = new RegExp(ORG_TAG.source, 'gi');

/** For streaming: hide the tag and its content if it's currently unclosed at the end of the text. */
const UNCLOSED_ORG_TAG = /<him-org(?:\s[^>]*)?>([\s\S]*)$/i;

/**
 * Looser format: "方案 B：组织规划" or "组织架构方案" followed by a JSON block.
 * Matches common AI plan headers then skips until it finds the first '{'.
 */
const LOOSE_ORG_REGEX = /(?:方案\s*[A-Z]?[:：]\s*)?(?:组织规划|组织架构|Agent\s*规划)[\s\S]*?(\{[\s\S]*\})/i;

/** Remove `<him-org>...</him-org>` or loose organization blocks from assistant text so markdown does not show raw JSON. */
export function stripHimOrgBlockForDisplay(text: string): string {
	let cleaned = text.replace(ORG_TAG_GLOBAL, '');
	// Also strip the loose format
	cleaned = cleaned.replace(LOOSE_ORG_REGEX, '');
	// Hide unclosed tag so it doesn't flash during streaming
	cleaned = cleaned.replace(UNCLOSED_ORG_TAG, '');
	return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function cleanMarkdownFences(code: string): string {
	let res = code.trim();
	res = res.replace(/^\s*```[a-z]*\s*\n?/i, '');
	res = res.replace(/\n?\s*```\s*$/i, '');
	return res.trim();
}

export function extractHimOrgBlock(fullText: string): string | undefined {
	// Try standard tag first
	const m1 = fullText.match(ORG_TAG);
	if (m1) {
		return cleanMarkdownFences(m1[1]);
	}

	// Try loose format
	const m2 = fullText.match(LOOSE_ORG_REGEX);
	if (m2) {
		return cleanMarkdownFences(m2[1]);
	}

	return undefined;
}

/**
 * Sanitize an agent id to match /^[a-z0-9_-]{1,64}$/i.
 */
function sanitizeAgentId(id: unknown): string {
	if (typeof id !== 'string') {
		return '';
	}
	return id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64).toLowerCase();
}

/**
 * Normalize a world value from various LLM formats.
 */
function normalizeWorld(w: unknown): any {
	if (!w || w === 'none' || w === 'null') {
		return { type: 'none' };
	}
	if (typeof w === 'string') {
		// e.g. "**/*.py" or "filesystem" or "browser"
		const lower = w.toLowerCase().trim();
		if (lower === 'filesystem' || lower === 'workspace') {
			return { type: 'filesystem', roots: ['**/*'] };
		}
		if (lower === 'browser' || lower === 'search' || lower === 'web') {
			return { type: 'browser' };
		}
		return { type: 'none' };
	}
	if (typeof w === 'object' && w !== null) {
		const o = w as Record<string, unknown>;
		if (!o.type) {
			if (Array.isArray(o.roots)) {
				return { type: 'filesystem', roots: o.roots.map(String) };
			}
			return { type: 'none' };
		}
		if (o.type === 'filesystem' && !Array.isArray(o.roots)) {
			return { type: 'filesystem', roots: o.roots ? [String(o.roots)] : ['**/*'] };
		}
		return o;
	}
	return { type: 'none' };
}

/**
 * Normalize an agent kind from various LLM strings.
 */
function normalizeAgentKind(k: unknown): string | undefined {
	if (typeof k !== 'string') {
		return undefined;
	}
	const lower = k.toLowerCase().trim();
	if (lower === 'user' || lower === 'orchestrator' || lower === 'worker') {
		return lower;
	}
	// Common LLM variations
	if (lower.includes('user') || lower === 'host' || lower === 'operator' || lower === 'human') {
		return 'user';
	}
	if (lower.includes('orchestrat') || lower.includes('planner') || lower.includes('manager')) {
		return 'orchestrator';
	}
	if (lower.includes('worker') || lower.includes('agent') || lower.includes('actor') || lower.includes('executor')) {
		return 'worker';
	}
	return 'worker'; // Default to worker if it looks like an agent kind at all
}

/**
 * Maps generic LLM keys to strict HIM schema keys.
 * Performs aggressive normalization to handle diverse LLM output formats.
 */
function normalizeHimOrganizationJson(raw: any): any {
	if (!raw || typeof raw !== 'object') {
		return raw;
	}

	const next = { ...raw };

	// Version
	next.version = HIM_ORGANIZATION_JSON_VERSION;
	
	if (!next.updated_at || typeof next.updated_at !== 'string') {
		next.updated_at = new Date().toISOString();
	}

	// Normalize plan_status
	if (next.plan_status && typeof next.plan_status === 'string') {
		const ps = next.plan_status.toLowerCase().replace(/[\s-]/g, '_');
		if (ps === 'draft' || ps === 'pending_consensus' || ps === 'ratified') {
			next.plan_status = ps;
		} else {
			next.plan_status = 'draft';
		}
	}

	// Agents
	if (next.agents && typeof next.agents === 'object' && !Array.isArray(next.agents)) {
		// Convert { "id1": { agents props }, "id2": { ... } } to array
		const agentsArr: any[] = [];
		for (const [key, val] of Object.entries(next.agents)) {
			if (val && typeof val === 'object') {
				const a = { ...(val as any) };
				if (!a.id) { a.id = key; }
				agentsArr.push(a);
			}
		}
		next.agents = agentsArr;
	}

	if (Array.isArray(next.agents)) {
		let agentCounter = 1;
		const seenIds = new Set<string>();

		next.agents = next.agents.map((a: any) => {
			const na = { ...a };
			// id normalization
			if (!na.id) {
				na.id = sanitizeAgentId(na.name || na.display_name || `agent_${agentCounter}`);
			} else {
				na.id = sanitizeAgentId(na.id);
			}
			if (!na.id) {
				na.id = `agent_${agentCounter}`;
			}
			
			// Deduplicate IDs
			let finalId = na.id;
			let idx = 1;
			while (seenIds.has(finalId)) {
				finalId = `${na.id}_${idx++}`;
			}
			seenIds.add(finalId);
			na.id = finalId;
			agentCounter++;

			// display_name
			if (!na.display_name) {
				na.display_name = na.name || na.id || 'Unnamed';
			}
			// kind
			const resolved = normalizeAgentKind(na.kind || na.type || na.role);
			if (resolved) {
				na.kind = resolved;
			}
			// mandate
			if (!na.mandate && na.description) {
				na.mandate = na.description;
			}
			if (!na.mandate && na.role_description) {
				na.mandate = na.role_description;
			}
			if (!na.mandate) {
				na.mandate = na.display_name || '';
			}
			// world
			na.world = normalizeWorld(na.world ?? na.scope ?? na.workspace);
			// immutable: user must be immutable
			if (na.kind === 'user') {
				na.immutable = true;
				if (na.id !== 'user') {
					na.id = 'user';
				}
			}
			return na;
		});

		// Ensure user agent exists
		const hasUser = next.agents.some((a: any) => a.id === 'user' && a.kind === 'user');
		if (!hasUser) {
			const ua = {
				id: 'user',
				display_name: 'User (operator)',
				kind: 'user',
				mandate: 'Human operator. Other agents route questions and missing information here. This row is fixed and cannot be deleted.',
				world: { type: 'none' },
				immutable: true,
			};
			next.agents.unshift(ua);
			seenIds.add('user');
		}
	} else {
		// No agents array at all (and couldn't convert from object) - provide a default array to avoid complete wash-out if possible
		next.agents = [];
	}

	// Edges: ensure it's an array
	if (!Array.isArray(next.edges)) {
		next.edges = [];
	}
	next.edges = next.edges.map((e: any) => {
		const ne = { ...e };
		if (ne.trigger && !ne.when) {
			ne.when = ne.trigger;
		}
		// kind normalization
		const ek = ne.kind || ne.type;
		if (ek) {
			const lower = String(ek).toLowerCase();
			if (lower === 'delegate' || lower === 'inform' || lower === 'request_user') {
				ne.kind = lower;
			} else if (lower === 'request' || lower === 'ask') {
				ne.kind = 'request_user';
			} else if (lower === 'notify' || lower === 'report') {
				ne.kind = 'inform';
			} else {
				ne.kind = 'delegate';
			}
		}
		// sanitize from/to ids
		if (ne.from) { ne.from = sanitizeAgentId(ne.from); }
		if (ne.to) { ne.to = sanitizeAgentId(ne.to); }
		if (!ne.kind) { ne.kind = 'delegate'; }
		return ne;
	});

	// Filter edges that reference non-existent agents
	const agentIds = new Set<string>((next.agents as any[]).map((a: any) => a.id));
	next.edges = next.edges.filter((e: any) => agentIds.has(e.from) && agentIds.has(e.to));

	return next;
}

export function parseHimOrganizationJson(text: string): HimOrganizationDocument | undefined {
	try {
		let raw = JSON.parse(cleanMarkdownFences(text)) as any;
		raw = normalizeHimOrganizationJson(raw);

		const reasons: string[] = [];
		if (!validateOrganizationDocument(raw, reasons)) {
			console.warn('HIM Org: validation failed —', reasons.join('; '), '\nFull document:', JSON.stringify(raw, null, 2));
			return undefined;
		}
		return raw;
	} catch (e) {
		console.error('HIM Org: JSON parse error', e, '\nRaw text:', text.slice(0, 500));
		return undefined;
	}
}

export function extractAndParseOrganizationDocument(fullText: string): HimOrganizationDocument | undefined {
	const block = extractHimOrgBlock(fullText);
	if (!block) {
		return undefined;
	}
	return parseHimOrganizationJson(block);
}

