/*---------------------------------------------------------------------------------------------
 *  Split assistant answer into markdown vs <him-python>/<him-shell>/<him-search> regions for UI
 *--------------------------------------------------------------------------------------------*/

const PYTHON_OPEN = '<him-python>';
const PYTHON_CLOSE = '</him-python>';
const SHELL_OPEN = '<him-shell>';
const SHELL_CLOSE = '</him-shell>';
const SEARCH_OPEN = '<him-search>';
const SEARCH_CLOSE = '</him-search>';

export type AnswerSegment =
	| { kind: 'markdown'; text: string }
	| { kind: 'python'; text: string; complete: boolean; blockIndex: number }
	| { kind: 'shell'; text: string; complete: boolean; blockIndex: number }
	| { kind: 'search'; text: string; complete: boolean; blockIndex: number };

export function parseAnswerSegments(raw: string): AnswerSegment[] {
	const out: AnswerSegment[] = [];
	let i = 0;
	let pythonBlockIndex = 0;
	let shellBlockIndex = 0;
	let searchBlockIndex = 0;
	while (i < raw.length) {
		const pyOpen = raw.indexOf(PYTHON_OPEN, i);
		const shOpen = raw.indexOf(SHELL_OPEN, i);
		const srOpen = raw.indexOf(SEARCH_OPEN, i);

		let nextOpen = -1;
		let nextType: 'python' | 'shell' | 'search' = 'python';
		let openTag = PYTHON_OPEN;
		let closeTag = PYTHON_CLOSE;

		const minIdx = (...idx: number[]) => idx.filter(v => v >= 0).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
		const best = minIdx(pyOpen, shOpen, srOpen);
		if (best === Number.POSITIVE_INFINITY) {
			nextOpen = -1;
		} else if (best === pyOpen) {
			nextOpen = pyOpen; nextType = 'python'; openTag = PYTHON_OPEN; closeTag = PYTHON_CLOSE;
		} else if (best === shOpen) {
			nextOpen = shOpen; nextType = 'shell'; openTag = SHELL_OPEN; closeTag = SHELL_CLOSE;
		} else {
			nextOpen = srOpen; nextType = 'search'; openTag = SEARCH_OPEN; closeTag = SEARCH_CLOSE;
		}

		if (nextOpen === -1) {
			out.push({ kind: 'markdown', text: raw.slice(i) });
			break;
		}
		if (nextOpen > i) {
			out.push({ kind: 'markdown', text: raw.slice(i, nextOpen) });
		}
		const j = nextOpen + openTag.length;
		const close = raw.indexOf(closeTag, j);
		if (close === -1) {
			const blockIdx = nextType === 'python' ? pythonBlockIndex : nextType === 'shell' ? shellBlockIndex : searchBlockIndex;
			out.push({ kind: nextType, text: raw.slice(j), complete: false, blockIndex: blockIdx });
			break;
		}
		const body = raw.slice(j, close);
		const blockIdx = nextType === 'python' ? pythonBlockIndex++ : nextType === 'shell' ? shellBlockIndex++ : searchBlockIndex++;
		out.push({ kind: nextType, text: body, complete: true, blockIndex: blockIdx });
		i = close + closeTag.length;
	}
	return out;
}

export function appendStreamCaret(segments: AnswerSegment[], caret: string): AnswerSegment[] {
	if (segments.length === 0) {
		return [{ kind: 'markdown', text: caret }];
	}
	const copy: AnswerSegment[] = segments.map(s => {
		if (s.kind === 'markdown') { return { kind: 'markdown' as const, text: s.text }; }
		return { kind: s.kind, text: s.text, complete: s.complete, blockIndex: s.blockIndex };
	});
	const last = copy[copy.length - 1]!;
	last.text += caret;
	return copy;
}
