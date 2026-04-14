/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { createWriteStream, existsSync, promises as fs } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { tmpdir } from 'os';
import { delimiter, join } from '../../../base/common/path.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILogService } from '../../log/common/log.js';
import {
	IHimWhisperDiagnostics,
	IHimWhisperDownloadResult,
	IHimWhisperService,
	IHimWhisperTranscribeResult,
} from '../common/himWhisper.js';
import { URL } from 'url';

const CONFIG_WHISPER_CLI = 'himCode.chat.whisperCliPath';
const CONFIG_WHISPER_MODEL = 'himCode.chat.whisperModelPath';
const CONFIG_WHISPER_MODEL_URL = 'himCode.chat.whisperModelDownloadUrl';
const CONFIG_WHISPER_EXTRA_ARGS = 'himCode.chat.whisperExtraCliArgs';

/** Same default as `extensions/him-chat/package.json` — main process config may not merge extension defaults. */
const DEFAULT_WHISPER_MODEL_DOWNLOAD_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

export class HimWhisperMainService implements IHimWhisperService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) { }

	private whisperHome(): string {
		return join(this.environmentMainService.userDataPath, 'whisper');
	}

	private modelsDir(): string {
		return join(this.whisperHome(), 'models');
	}

	private defaultModelPath(): string {
		return join(this.modelsDir(), 'ggml-base.bin');
	}

	private binDir(): string {
		return join(this.whisperHome(), 'bin');
	}

	private defaultCliCandidates(): string[] {
		const name = isWindows ? 'whisper-cli.exe' : 'whisper-cli';
		const alt = isWindows ? 'main.exe' : 'main';
		const c: string[] = [];
		c.push(join(this.binDir(), name));
		c.push(join(this.binDir(), alt));
		const rp = typeof process !== 'undefined' ? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath : undefined;
		if (rp) {
			c.push(join(rp, 'whisper', name));
			c.push(join(rp, 'whisper', alt));
		}
		return c;
	}

	/** Typical install locations (Homebrew, etc.) — avoid scanning PATH for generic `main`. */
	private wellKnownCliCandidates(): string[] {
		const name = isWindows ? 'whisper-cli.exe' : 'whisper-cli';
		const alt = isWindows ? 'main.exe' : 'main';
		const c: string[] = [];
		if (isMacintosh) {
			c.push(join('/opt/homebrew/bin', name), join('/opt/homebrew/bin', alt));
			c.push(join('/usr/local/bin', name), join('/usr/local/bin', alt));
		}
		if (isLinux) {
			c.push(join('/usr/bin', name), join('/usr/bin', alt));
			c.push(join('/usr/local/bin', name), join('/usr/local/bin', alt));
		}
		return c;
	}

	/** First `whisper-cli` on PATH (GUI apps on macOS often inherit a minimal PATH). */
	private pathEnvWhisperCliCandidates(): string[] {
		const exe = isWindows ? 'whisper-cli.exe' : 'whisper-cli';
		const raw = process.env.PATH ?? process.env.Path ?? '';
		const out: string[] = [];
		for (const dir of raw.split(delimiter)) {
			const d = dir.trim();
			if (!d) {
				continue;
			}
			const p = join(d, exe);
			if (existsSync(p)) {
				out.push(p);
			}
		}
		return out;
	}

	private allCliCandidatesInOrder(): string[] {
		const out: string[] = [];
		const push = (xs: string[]) => {
			for (const p of xs) {
				if (p && !out.includes(p)) {
					out.push(p);
				}
			}
		};
		push(this.defaultCliCandidates());
		push(this.wellKnownCliCandidates());
		push(this.pathEnvWhisperCliCandidates());
		return out;
	}

	private resolveCliPath(): string {
		const configured = (this.configurationService.getValue<string>(CONFIG_WHISPER_CLI) ?? '').trim();
		if (configured && existsSync(configured)) {
			return configured;
		}
		const envPath = (process.env['HIM_WHISPER_CLI'] ?? '').trim();
		if (envPath && existsSync(envPath)) {
			return envPath;
		}
		for (const p of this.allCliCandidatesInOrder()) {
			if (existsSync(p)) {
				return p;
			}
		}
		const fallback = this.defaultCliCandidates()[0] ?? join(this.binDir(), isWindows ? 'whisper-cli.exe' : 'whisper-cli');
		return configured || fallback;
	}

	private resolveModelPath(): string {
		const configured = (this.configurationService.getValue<string>(CONFIG_WHISPER_MODEL) ?? '').trim();
		if (configured) {
			return configured;
		}
		return this.defaultModelPath();
	}

	async getDiagnostics(): Promise<IHimWhisperDiagnostics> {
		const whisperHomeDir = this.whisperHome();
		const cliResolvedPath = this.resolveCliPath();
		const modelResolvedPath = this.resolveModelPath();
		return {
			cliResolvedPath,
			cliFound: existsSync(cliResolvedPath),
			modelResolvedPath,
			modelFound: existsSync(modelResolvedPath),
			whisperHomeDir,
		};
	}

	async transcribePcmWav(wav: VSBuffer): Promise<IHimWhisperTranscribeResult> {
		const diag = await this.getDiagnostics();
		if (!diag.cliFound) {
			return {
				ok: false,
				error: 'whisper.cpp CLI not found. Set himCode.chat.whisperCliPath or place whisper-cli under userData/whisper/bin/.',
			};
		}
		if (!diag.modelFound) {
			return {
				ok: false,
				error: 'Whisper model not found. Run "HIM CODE: Download Whisper Model" or set himCode.chat.whisperModelPath.',
			};
		}
		if (wav.byteLength < 64) {
			return { ok: false, error: 'Recording too short.' };
		}

		const tmpWav = join(tmpdir(), `him-whisper-${generateUuid()}.wav`);
		try {
			const u8 = wav.buffer;
			await fs.writeFile(tmpWav, Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength));

			const extraArgs = this.parseExtraCliArgs();
			const args = ['-m', diag.modelResolvedPath, '-f', tmpWav, '-nt', ...extraArgs];

			const text = await this.runWhisperCli(diag.cliResolvedPath, args);
			return { ok: true, text: text.trim() };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logService.warn(`[himWhisper] transcribe failed: ${msg}`);
			return { ok: false, error: msg };
		} finally {
			try {
				await fs.unlink(tmpWav);
			} catch {
				// ignore
			}
		}
	}

	private parseExtraCliArgs(): string[] {
		const raw = this.configurationService.getValue<unknown>(CONFIG_WHISPER_EXTRA_ARGS);
		if (Array.isArray(raw)) {
			return raw.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean);
		}
		if (typeof raw === 'string' && raw.trim()) {
			return raw.trim().split(/\s+/).filter(Boolean);
		}
		return [];
	}

	private runWhisperCli(cliPath: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn(cliPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (d: string) => { stdout += d; });
			child.stderr.on('data', (d: string) => { stderr += d; });
			child.on('error', err => reject(err));
			child.on('close', code => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(stderr.trim() || `whisper-cli exited with code ${code}`));
				}
			});
		});
	}

	async downloadDefaultModel(): Promise<IHimWhisperDownloadResult> {
		const configured = (this.configurationService.getValue<string>(CONFIG_WHISPER_MODEL_URL) ?? '').trim();
		const urlStr =
			configured && /^https?:\/\//i.test(configured) ? configured : !configured ? DEFAULT_WHISPER_MODEL_DOWNLOAD_URL : '';
		if (!urlStr) {
			return {
				ok: false,
				error: 'himCode.chat.whisperModelDownloadUrl must be an http(s) URL, or leave it empty to use the default model URL.',
			};
		}
		if (!configured) {
			this.logService.info(`[himWhisper] whisperModelDownloadUrl unset; using default: ${DEFAULT_WHISPER_MODEL_DOWNLOAD_URL}`);
		}
		const dest = this.resolveModelPath();
		try {
			await fs.mkdir(this.modelsDir(), { recursive: true });
			const part = `${dest}.part`;
			await this.downloadToFile(urlStr, part);
			await fs.rename(part, dest);
			return { ok: true, path: dest };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.logService.error(`[himWhisper] model download failed: ${msg}`);
			return { ok: false, error: msg };
		}
	}

	private downloadToFile(urlStr: string, destPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const tryOnce = (href: string, redirects: number): void => {
				if (redirects > 12) {
					reject(new Error('Too many redirects'));
					return;
				}
				let u: URL;
				try {
					u = new URL(href);
				} catch {
					reject(new Error('Bad URL'));
					return;
				}
				const lib = u.protocol === 'https:' ? https : http;
				const req = lib.request(href, {
					method: 'GET',
					headers: { 'User-Agent': 'HIM-Code-Whisper/1.0', 'Accept': '*/*' },
				}, res => {
					const code = res.statusCode ?? 0;
					if (code >= 300 && code < 400 && res.headers.location) {
						res.resume();
						tryOnce(new URL(res.headers.location, href).href, redirects + 1);
						return;
					}
					if (code !== 200) {
						res.resume();
						reject(new Error(`Download failed: HTTP ${code}`));
						return;
					}
					const file = createWriteStream(destPath);
					res.pipe(file);
					file.on('finish', () => file.close(err => (err ? reject(err) : resolve())));
					file.on('error', reject);
				});
				req.on('error', reject);
				req.end();
			};
			tryOnce(urlStr, 0);
		});
	}
}
