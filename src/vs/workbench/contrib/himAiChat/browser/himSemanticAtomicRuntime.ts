/*---------------------------------------------------------------------------------------------
 *  Optional atomic verification via git numstat — only when Author sets
 *  program_metadata.atomic_verify === "git_numstat" (see docs/HIM_SEMANTIC_PROGRAM_SPEC.md).
 *--------------------------------------------------------------------------------------------*/

/** Matches global atomic rules in prompts (lines changed per step). */
export const HIM_ATOMIC_MAX_LINE_CHURN_PER_STEP = 100;

/** Max distinct workspace files touched in one codegen step (non-excluded paths). */
export const HIM_ATOMIC_MAX_WORKSPACE_FILES_PER_STEP = 1;

/** Paths ignored when judging agent file edits (tmp, deps). */
export function isExcludedAtomicPath(relPath: string): boolean {
	const n = relPath.replace(/\\/g, '/');
	return (
		n.startsWith('.him-code/tmp/') ||
		n.includes('/.him-code/tmp/') ||
		n.startsWith('node_modules/') ||
		n.includes('/node_modules/')
	);
}

/**
 * Parse `git diff HEAD --numstat` (or `git diff --numstat` stdout).
 * Binary files appear as `-\\t-\\tpath`; treat as over-limit churn so they cannot bypass.
 */
export function parseGitNumstat(stdout: string): Map<string, { added: number; deleted: number }> {
	const m = new Map<string, { added: number; deleted: number }>();
	for (const line of stdout.split('\n')) {
		const t = line.trim();
		if (!t) {
			continue;
		}
		const tab = t.indexOf('\t');
		if (tab < 0) {
			continue;
		}
		const tab2 = t.indexOf('\t', tab + 1);
		if (tab2 < 0) {
			continue;
		}
		const p1 = t.slice(0, tab);
		const p2 = t.slice(tab + 1, tab2);
		const path = t.slice(tab2 + 1).trim();
		if (!path) {
			continue;
		}
		if (p1 === '-' && p2 === '-') {
			m.set(path, { added: HIM_ATOMIC_MAX_LINE_CHURN_PER_STEP + 1, deleted: 0 });
			continue;
		}
		const added = parseInt(p1, 10);
		const deleted = parseInt(p2, 10);
		if (Number.isNaN(added) || Number.isNaN(deleted)) {
			continue;
		}
		m.set(path, { added: Math.max(0, added), deleted: Math.max(0, deleted) });
	}
	return m;
}

export interface NumstatDelta {
	readonly perPath: readonly { readonly path: string; readonly dAdd: number; readonly dDel: number }[];
	/** Sum of |Δadded| + |Δdeleted| for non-excluded paths only. */
	readonly totalChurnNonExcluded: number;
	/** Distinct non-excluded paths with non-zero delta. */
	readonly touchedWorkspaceRelPaths: readonly string[];
}

export function deltaNumstat(
	before: ReadonlyMap<string, { added: number; deleted: number }>,
	after: ReadonlyMap<string, { added: number; deleted: number }>,
): NumstatDelta {
	const keys = new Set<string>([...before.keys(), ...after.keys()]);
	const perPath: { path: string; dAdd: number; dDel: number }[] = [];
	const touched = new Set<string>();
	let totalChurnNonExcluded = 0;

	for (const path of keys) {
		const b = before.get(path) ?? { added: 0, deleted: 0 };
		const a = after.get(path) ?? { added: 0, deleted: 0 };
		const dAdd = a.added - b.added;
		const dDel = a.deleted - b.deleted;
		if (dAdd === 0 && dDel === 0) {
			continue;
		}
		perPath.push({ path, dAdd, dDel });
		if (!isExcludedAtomicPath(path)) {
			touched.add(path);
			totalChurnNonExcluded += Math.abs(dAdd) + Math.abs(dDel);
		}
	}

	return {
		perPath,
		totalChurnNonExcluded,
		touchedWorkspaceRelPaths: [...touched],
	};
}

export function evaluateAtomicCodegenStep(delta: NumstatDelta): { ok: true } | { ok: false; reason: string } {
	const files = delta.touchedWorkspaceRelPaths.length;
	if (files > HIM_ATOMIC_MAX_WORKSPACE_FILES_PER_STEP) {
		const sample = delta.touchedWorkspaceRelPaths.slice(0, 5).join(', ');
		return {
			ok: false,
			reason: `Atomic rule: more than ${HIM_ATOMIC_MAX_WORKSPACE_FILES_PER_STEP} workspace file(s) changed in this step (${files}: ${sample}).`,
		};
	}
	if (delta.totalChurnNonExcluded > HIM_ATOMIC_MAX_LINE_CHURN_PER_STEP) {
		return {
			ok: false,
			reason: `Atomic rule: line churn (sum of |Δadded|+|Δdeleted| on workspace paths) is ${delta.totalChurnNonExcluded}, limit ${HIM_ATOMIC_MAX_LINE_CHURN_PER_STEP}.`,
		};
	}
	return { ok: true };
}
