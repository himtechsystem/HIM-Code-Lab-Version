/*---------------------------------------------------------------------------------------------
 *  Incremental ```python … ``` fence extractor for streaming assistant text
 *--------------------------------------------------------------------------------------------*/

const OPEN = '```python';
const CLOSE = '```';
/** Keep tail when no closing fence yet so a trailing ` is not swallowed. */
const OVERLAP = 12;

export class HimPythonFenceParser {
	private carry = '';
	private inFence = false;
	private codeBuf = '';

	reset(): void {
		this.carry = '';
		this.inFence = false;
		this.codeBuf = '';
	}

	/**
	 * Feed streamed assistant text; returns complete Python code bodies (trimmed) ready to execute.
	 */
	push(chunk: string): string[] {
		this.carry += chunk;
		const complete: string[] = [];
		while (true) {
			if (!this.inFence) {
				const idx = this.carry.indexOf(OPEN);
				if (idx === -1) {
					if (this.carry.length > 100) {
						this.carry = this.carry.slice(-50);
					}
					break;
				}
				let rest = this.carry.slice(idx + OPEN.length);
				if (rest.startsWith('\r')) {
					rest = rest.slice(1);
				}
				if (rest.startsWith('\n')) {
					rest = rest.slice(1);
				}
				this.carry = rest;
				this.inFence = true;
				this.codeBuf = '';
				continue;
			}
			const endIdx = this.carry.indexOf(CLOSE);
			if (endIdx === -1) {
				if (this.carry.length <= OVERLAP) {
					this.codeBuf += this.carry;
					this.carry = '';
				} else {
					this.codeBuf += this.carry.slice(0, -OVERLAP);
					this.carry = this.carry.slice(-OVERLAP);
				}
				break;
			}
			this.codeBuf += this.carry.slice(0, endIdx);
			this.carry = this.carry.slice(endIdx + CLOSE.length);
			const code = this.codeBuf.trim();
			this.codeBuf = '';
			this.inFence = false;
			if (code.length > 0) {
				complete.push(code);
			}
		}
		return complete;
	}
}
