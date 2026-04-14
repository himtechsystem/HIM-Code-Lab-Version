/*---------------------------------------------------------------------------------------------
 *  HIM Code Python — per-session ChildProcess pool (`python -u -i`) + exec(wrapper) blocks
 *--------------------------------------------------------------------------------------------*/

import type { ChildProcess } from 'child_process';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { getHimCodeHostDataRoot } from './himHostDataRoot.js';
import { IHimPythonReplService } from '../common/himPythonRepl.js';

const DONE_MARKER = '__HIM_PY_DONE__';
const DONE_LINE_RE = /^\s*__HIM_PY_DONE__\s*$/m;
const BLOCK_NAME = 'him_exec_block.py';
const WRAPPER_NAME = 'him_exec_wrapper.py';

function sanitizeSessionDir(sessionId: string): string {
	return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function buildWrapper(blockPath: string): string {
	return [
		'import traceback as __tb',
		'try:',
		`    exec(compile(open(${JSON.stringify(blockPath)}, encoding="utf-8").read(), ${JSON.stringify(blockPath)}, "exec"))`,
		'except:',
		'    __tb.print_exc()',
		`print(${JSON.stringify(DONE_MARKER)}, flush=True)`,
	].join('\n');
}

function collapseBackspaces(text: string): string {
	let out = '';
	for (const ch of text) {
		if (ch === '\b') {
			out = out.slice(0, -1);
			continue;
		}
		out += ch;
	}
	return out;
}

function stripHimRunnerEcho(plain: string): string {
	const normalized = collapseBackspaces(plain).replace(/\r/g, '');
	const fixed = normalized.split('\n');
	const filtered = fixed.filter(line => {
		const t = line.trim();
		if (t === '' || t === '>>>' || t === '>>> ') {
			return false;
		}
		if (t.includes('exec(compile(open(')) {
			return false;
		}
		if (t.includes(DONE_MARKER)) {
			return false;
		}
		if (t.startsWith('>>> import traceback') || t.startsWith('import traceback')) {
			return false;
		}
		if (t === '... ' || t === '...' || t.startsWith('>>> ...')) {
			return false;
		}
		return true;
	});
	const s = filtered.join('\n');
	return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}

interface PoolEntry {
	readonly proc: ChildProcess;
	readonly cwd: string;
	buf: string;
	/** Serialized execution per session (blocks in one REPL must not interleave). */
	chain: Promise<void>;
}

export class HimPythonReplService extends Disposable implements IHimPythonReplService {
	declare readonly _serviceBrand: undefined;

	private readonly pool = new Map<string, PoolEntry>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super();
		this._register({
			dispose: () => {
				for (const id of [...this.pool.keys()]) {
					this.disposeSession(id);
				}
			},
		});
	}

	disposeSession(sessionId: string): void {
		const e = this.pool.get(sessionId);
		if (!e) {
			return;
		}
		this.pool.delete(sessionId);
		try {
			e.proc.kill('SIGTERM');
		} catch {
			// ignore
		}
	}

	async runBlock(
		code: string,
		onOutput: (chunk: string) => void,
		token: CancellationToken,
		sessionId = 'default',
	): Promise<{ output: string; hadError: boolean }> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			throw new Error('Open a folder workspace so HIM Code can run Python blocks.');
		}

		const sid = sessionId.trim() || 'default';
		const hostRoot = getHimCodeHostDataRoot(this.environmentService, this.workspaceContextService.getWorkspace());
		const sessionDir = URI.joinPath(hostRoot, 'sessions', sanitizeSessionDir(sid));
		await this.fileService.createFolder(sessionDir);

		const blockUri = URI.joinPath(sessionDir, BLOCK_NAME);
		await this.fileService.writeFile(blockUri, VSBuffer.fromString(code));

		const wrapperUri = URI.joinPath(sessionDir, WRAPPER_NAME);
		const wrapperCode = buildWrapper(blockUri.fsPath);
		await this.fileService.writeFile(wrapperUri, VSBuffer.fromString(wrapperCode));

		const wrapperPathLit = JSON.stringify(wrapperUri.fsPath);
		const pyOneLiner = `exec(compile(open(${wrapperPathLit}, encoding='utf-8').read(), ${wrapperPathLit}, 'exec'))`;

		const entry = await this.ensurePoolEntry(sid, folder.uri.fsPath);
		const run = async (): Promise<{ output: string; hadError: boolean }> => {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const startLen = entry.buf.length;
			const stdin = entry.proc.stdin;
			if (!stdin) {
				throw new Error('Python stdin is not available.');
			}

			await new Promise<void>((resolve, reject) => {
				stdin.write(pyOneLiner + '\n', err => (err ? reject(err) : resolve()));
			});

			const deadline = Date.now() + 180_000;
			while (Date.now() < deadline) {
				if (token.isCancellationRequested) {
					throw new CancellationError();
				}
				const slice = entry.buf.slice(startLen);
				const plain = removeAnsiEscapeCodes(slice);
				onOutput(stripHimRunnerEcho(plain));
				if (DONE_LINE_RE.test(removeAnsiEscapeCodes(slice))) {
					break;
				}
				await new Promise(r => setTimeout(r, 40));
			}

			const slice = entry.buf.slice(startLen);
			const plainFull = removeAnsiEscapeCodes(slice);
			const match = DONE_LINE_RE.exec(plainFull);
			if (!match) {
				throw new Error('Python execution timed out or did not emit the completion marker (check for blocking code or your Python environment).');
			}
			const before = stripHimRunnerEcho(plainFull.slice(0, match.index));
			const output = before.trimEnd();
			const hadError =
				/Traceback \(most recent call last\):/i.test(output) ||
				/^Error:/im.test(output) ||
				/SyntaxError:/i.test(output) ||
				/IndentationError:/i.test(output);
			// Trim buffer occasionally to avoid unbounded growth (keep tail for REPL state)
			if (entry.buf.length > 500_000) {
				entry.buf = entry.buf.slice(-200_000);
			}
			return { output, hadError };
		};

		const p = entry.chain.then(run);
		entry.chain = p.then(() => undefined, () => undefined);
		return p;
	}

	private async ensurePoolEntry(sessionId: string, cwd: string): Promise<PoolEntry> {
		let e = this.pool.get(sessionId);
		if (e && e.cwd !== cwd) {
			this.disposeSession(sessionId);
			e = undefined;
		}
		if (e && e.proc.killed) {
			this.pool.delete(sessionId);
			e = undefined;
		}
		if (e) {
			return e;
		}

		const { spawn } = await import('child_process');
		const executable = isWindows ? 'python' : 'python3';
		const proc = spawn(executable, ['-u', '-i'], {
			cwd,
			env: { ...process.env, PYTHONUNBUFFERED: '1' },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const entry: PoolEntry = {
			proc,
			cwd,
			buf: '',
			chain: Promise.resolve(),
		};

		proc.stdout?.on('data', (d: Buffer) => {
			entry.buf += d.toString();
		});
		proc.stderr?.on('data', (d: Buffer) => {
			entry.buf += d.toString();
		});
		proc.on('exit', () => {
			if (this.pool.get(sessionId) === entry) {
				this.pool.delete(sessionId);
			}
		});

		this.pool.set(sessionId, entry);
		await new Promise<void>(r => setTimeout(r, 450));
		return entry;
	}
}
