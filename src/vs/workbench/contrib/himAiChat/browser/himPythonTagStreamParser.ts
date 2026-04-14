/*---------------------------------------------------------------------------------------------
 *  Incremental <him-python>/<him-shell>/<him-search> stream parser
 *--------------------------------------------------------------------------------------------*/

const PY_OPEN = '<him-python>';
const PY_CLOSE = '</him-python>';
const SH_OPEN = '<him-shell>';
const SH_CLOSE = '</him-shell>';
const SR_OPEN = '<him-search>';
const SR_CLOSE = '</him-search>';
const TAIL_KEEP = Math.max(PY_OPEN.length, PY_CLOSE.length, SH_OPEN.length, SH_CLOSE.length, SR_OPEN.length, SR_CLOSE.length) - 1;

export type HimPythonTagEvent =
	| { kind: 'text'; text: string }
	| { kind: 'python_open' }
	| { kind: 'python_chunk'; text: string }
	| { kind: 'python_close'; code: string }
	| { kind: 'shell_open' }
	| { kind: 'shell_chunk'; text: string }
	| { kind: 'shell_close'; command: string }
	| { kind: 'search_open' }
	| { kind: 'search_chunk'; text: string }
	| { kind: 'search_close'; query: string };

export class HimPythonTagStreamParser {
	private carry = '';
	private mode: 'text' | 'python' | 'shell' | 'search' = 'text';
	private codeBuffer = '';

	reset(): void {
		this.carry = '';
		this.mode = 'text';
		this.codeBuffer = '';
	}

	push(chunk: string): HimPythonTagEvent[] {
		this.carry += chunk;
		const out: HimPythonTagEvent[] = [];

		while (true) {
			if (this.mode === 'text') {
				const pyIdx = this.carry.indexOf(PY_OPEN);
				const shIdx = this.carry.indexOf(SH_OPEN);
				const srIdx = this.carry.indexOf(SR_OPEN);
				let tagIdx = -1;
				let tagType: 'python' | 'shell' | 'search' = 'python';
				let tagLen = PY_OPEN.length;

				const minIdx = (...idx: number[]) => idx.filter(i => i >= 0).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
				const best = minIdx(pyIdx, shIdx, srIdx);
				if (best === Number.POSITIVE_INFINITY) {
					tagIdx = -1;
				} else if (best === pyIdx) {
					tagIdx = pyIdx; tagType = 'python'; tagLen = PY_OPEN.length;
				} else if (best === shIdx) {
					tagIdx = shIdx; tagType = 'shell'; tagLen = SH_OPEN.length;
				} else {
					tagIdx = srIdx; tagType = 'search'; tagLen = SR_OPEN.length;
				}

				if (tagIdx === -1) {
					if (this.carry.length <= TAIL_KEEP) { break; }
					const flush = this.carry.slice(0, -TAIL_KEEP);
					this.carry = this.carry.slice(-TAIL_KEEP);
					if (flush) { out.push({ kind: 'text', text: flush }); }
					break;
				}
				const plain = this.carry.slice(0, tagIdx);
				if (plain) { out.push({ kind: 'text', text: plain }); }
				this.carry = this.carry.slice(tagIdx + tagLen);
				this.mode = tagType;
				this.codeBuffer = '';
				out.push({ kind: tagType === 'python' ? 'python_open' : tagType === 'shell' ? 'shell_open' : 'search_open' });
				continue;
			}

			const closeTag = this.mode === 'python' ? PY_CLOSE : this.mode === 'shell' ? SH_CLOSE : SR_CLOSE;
			const closeIdx = this.carry.indexOf(closeTag);
			if (closeIdx === -1) {
				if (this.carry.length <= TAIL_KEEP) { break; }
				const flush = this.carry.slice(0, -TAIL_KEEP);
				this.carry = this.carry.slice(-TAIL_KEEP);
				if (flush) {
					this.codeBuffer += flush;
					out.push({ kind: this.mode === 'python' ? 'python_chunk' : this.mode === 'shell' ? 'shell_chunk' : 'search_chunk', text: flush });
				}
				break;
			}

			const body = this.carry.slice(0, closeIdx);
			if (body) {
				this.codeBuffer += body;
				out.push({ kind: this.mode === 'python' ? 'python_chunk' : this.mode === 'shell' ? 'shell_chunk' : 'search_chunk', text: body });
			}
			const code = this.codeBuffer;
			this.codeBuffer = '';
			this.carry = this.carry.slice(closeIdx + closeTag.length);
			if (this.mode === 'python') {
				out.push({ kind: 'python_close', code });
			} else if (this.mode === 'shell') {
				out.push({ kind: 'shell_close', command: code });
			} else {
				out.push({ kind: 'search_close', query: code });
			}
			this.mode = 'text';
		}

		return out;
	}

	flushRemainder(): HimPythonTagEvent[] {
		const out: HimPythonTagEvent[] = [];
		if (!this.carry) { return out; }
		if (this.mode !== 'text') {
			this.codeBuffer += this.carry;
			out.push({
				kind: this.mode === 'python' ? 'python_chunk' : this.mode === 'shell' ? 'shell_chunk' : 'search_chunk',
				text: this.carry,
			});
			this.carry = '';
		} else {
			out.push({ kind: 'text', text: this.carry });
			this.carry = '';
		}
		return out;
	}
}
