/*---------------------------------------------------------------------------------------------
 *  Parse / validate / linearize HIM plans for orchestrated execution.
 *--------------------------------------------------------------------------------------------*/

import { HimLinearPlanStep, HimPlanDocument, HimPlanNode, HIM_PLAN_JSON_VERSION } from './himPlanTypes.js';

const PLAN_TAG = /<him-plan(?:\s[^>]*)?>([\s\S]*?)<\/him-plan>/i;
const PLAN_TAG_GLOBAL = new RegExp(PLAN_TAG.source, 'gi');

/** Remove `<him-plan>...</him-plan>` from assistant text so markdown does not show raw JSON. */
export function stripHimPlanBlockForDisplay(text: string): string {
	return text.replace(PLAN_TAG_GLOBAL, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** DFS outline for collapsible Plan summary (plain text). */
export function formatPlanOutline(doc: HimPlanDocument): string {
	const lines: string[] = [];
	const visit = (node: HimPlanNode, depth: number): void => {
		const pad = '  '.repeat(depth);
		switch (node.kind) {
			case 'task': {
				const obj = node.objective.trim().split('\n')[0] ?? '';
				const brief = obj.length > 120 ? `${obj.slice(0, 117)}…` : obj;
				lines.push(`${pad}• ${node.title}${brief ? ` — ${brief}` : ''}`);
				break;
			}
			case 'sequence': {
				lines.push(`${pad}[sequence]${node.title ? ` ${node.title}` : ''}`);
				for (const ch of node.children) {
					visit(ch, depth + 1);
				}
				break;
			}
			case 'for_each': {
				lines.push(`${pad}[for_each ${node.variable}] ${node.items.length} item(s)`);
				visit(node.body, depth + 1);
				break;
			}
			case 'while_loop': {
				lines.push(`${pad}[while ≤${node.maxIterations}] ${node.conditionHint}`);
				visit(node.body, depth + 1);
				break;
			}
			default:
				break;
		}
	};
	const t = doc.title?.trim();
	if (t) {
		lines.push(t);
	}
	visit(doc.root, 0);
	return lines.join('\n');
}

export function extractHimPlanBlock(fullText: string): string | undefined {
	const m = fullText.match(PLAN_TAG);
	return m ? m[1].trim() : undefined;
}

export function parseHimPlanJson(text: string): HimPlanDocument | undefined {
	try {
		const raw = JSON.parse(text) as unknown;
		if (!validatePlanDocument(raw)) {
			return undefined;
		}
		return raw;
	} catch {
		return undefined;
	}
}

export function extractAndParsePlan(fullText: string): HimPlanDocument | undefined {
	const block = extractHimPlanBlock(fullText);
	if (!block) {
		return undefined;
	}
	return parseHimPlanJson(block);
}

function validatePlanDocument(x: unknown): x is HimPlanDocument {
	if (!x || typeof x !== 'object') {
		return false;
	}
	const o = x as Record<string, unknown>;
	if (o.version !== HIM_PLAN_JSON_VERSION) {
		return false;
	}
	if (!o.root || typeof o.root !== 'object') {
		return false;
	}
	return validateNode(o.root as unknown);
}

function validateNode(n: unknown): n is HimPlanNode {
	if (!n || typeof n !== 'object') {
		return false;
	}
	const o = n as Record<string, unknown>;
	if (typeof o.id !== 'string' || !o.id.trim()) {
		return false;
	}
	const kind = o.kind;
	if (kind === 'task') {
		return typeof o.title === 'string' && typeof o.objective === 'string';
	}
	if (kind === 'sequence') {
		return Array.isArray(o.children) && o.children.every(c => validateNode(c));
	}
	if (kind === 'for_each') {
		return (
			typeof o.variable === 'string' &&
			Array.isArray(o.items) &&
			o.items.every(i => typeof i === 'string') &&
			o.items.length > 0 &&
			validateNode(o.body)
		);
	}
	if (kind === 'while_loop') {
		const max = o.maxIterations;
		return (
			typeof max === 'number' &&
			max >= 1 &&
			max <= 100 &&
			typeof o.conditionHint === 'string' &&
			validateNode(o.body)
		);
	}
	return false;
}

/** Replace {{var}} in all string leaves. */
export function substitutePlanNode(node: HimPlanNode, variable: string, value: string): HimPlanNode {
	const re = new RegExp(`\\{\\{\\s*${escapeRegExp(variable)}\\s*\\}\\}`, 'g');
	const sub = (s: string) => s.replace(re, value);

	const walk = (x: HimPlanNode): HimPlanNode => {
		switch (x.kind) {
			case 'task':
				return {
					...x,
					title: sub(x.title),
					objective: sub(x.objective),
					constraints: x.constraints !== undefined ? sub(x.constraints) : undefined,
				};
			case 'sequence':
				return { ...x, title: x.title !== undefined ? sub(x.title) : undefined, children: x.children.map(walk) };
			case 'for_each':
				return {
					...x,
					title: x.title !== undefined ? sub(x.title) : undefined,
					items: x.items.map(sub),
					body: walk(x.body),
				};
			case 'while_loop':
				return {
					...x,
					title: x.title !== undefined ? sub(x.title) : undefined,
					conditionHint: sub(x.conditionHint),
					body: walk(x.body),
				};
			default:
				return x;
		}
	};
	return walk(node);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Depth-first expansion into atomic steps. Caps total steps for safety.
 * `pathLabel` for each task is `${path}/${node.id}` so it is unique in the tree.
 * `completedPathLabels` — if set, skip tasks whose pathLabel is in the set (still recurse for structure).
 */
export function linearizePlan(
	doc: HimPlanDocument,
	maxSteps: number,
	completedPathLabels?: ReadonlySet<string>,
): HimLinearPlanStep[] {
	const out: HimLinearPlanStep[] = [];

	const visit = (node: HimPlanNode, path: string, objectivePrefix: string): void => {
		if (out.length >= maxSteps) {
			return;
		}
		const prefix = objectivePrefix ? `${objectivePrefix}\n\n` : '';

		switch (node.kind) {
			case 'task': {
				const pathLabel = `${path}/${node.id}`.replace(/\/+/g, '/');
				if (completedPathLabels?.has(pathLabel)) {
					return;
				}
				out.push({
					id: node.id,
					pathLabel,
					title: node.title,
					objective: `${prefix}${node.objective}`,
					constraints: node.constraints,
				});
				return;
			}
			case 'sequence':
				for (const ch of node.children) {
					visit(ch, `${path}/${node.id}`, '');
					if (out.length >= maxSteps) {
						return;
					}
				}
				return;
			case 'for_each':
				for (const item of node.items) {
					const body = substitutePlanNode(node.body, node.variable, item);
					visit(body, `${path}/${node.id}[${item}]`, '');
					if (out.length >= maxSteps) {
						return;
					}
				}
				return;
			case 'while_loop':
				for (let i = 1; i <= node.maxIterations; i++) {
					const p = `While-loop iteration ${i}/${node.maxIterations}. Stop condition: ${node.conditionHint}
If this condition is already satisfied, reply with a single line: HIM_PLAN_STEP_DONE
Otherwise perform the body using tools, prefer small single-file edits.`;
					visit(node.body, `${path}/${node.id}#${i}`, p);
					if (out.length >= maxSteps) {
						return;
					}
				}
				return;
			default:
				return;
		}
	};

	visit(doc.root, 'root', '');
	return out;
}

export function buildPlanStepUserMessage(
	step: HimLinearPlanStep,
	stepIndex: number,
	totalSteps: number,
	opts?: { planFileRelativePath?: string; extraSystemHints?: string },
): string {
	const lines = [
		`[HIM Plan — step ${stepIndex + 1} of ${totalSteps}]`,
		`Path: ${step.pathLabel}`,
		`Title: ${step.title}`,
	];
	if (opts?.planFileRelativePath) {
		lines.push('', `Canonical plan file (read with tools if needed): \`${opts.planFileRelativePath}\``);
	}
	lines.push(
		'',
		'Execute **only** this step now. Prefer one small <him-python> or <him-shell> change when editing the workspace.',
		'',
		'### Objective',
		step.objective,
	);
	if (step.constraints?.trim()) {
		lines.push('', '### Constraints', step.constraints.trim());
	}
	if (opts?.extraSystemHints?.trim()) {
		lines.push('', opts.extraSystemHints.trim());
	}
	lines.push(
		'',
		'You may emit an updated \`<him-plan>...</him-plan>\` (full JSON) in this reply to revise remaining steps; the IDE will save it to the plan file.',
		'',
		'When this step is finished, summarize briefly. If you used tools, the IDE will send results and may ask you to continue.',
	);
	return lines.join('\n');
}
