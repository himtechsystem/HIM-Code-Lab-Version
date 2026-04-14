/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

/** Electron loads package.json#main → out/main.js; out/ alone is not enough. */
async function mainJsPresent() {
	try {
		await fs.stat(path.join(rootDir, 'out', 'main.js'));
		return true;
	} catch {
		return false;
	}
}

/** Vendor .js under src/ must exist in out/; a partial out/ folder skips compile and breaks startup. */
async function vendorRuntimePresent() {
	const sentinel = path.join(rootDir, 'out', 'vs', 'base', 'common', 'semver', 'semver.js');
	try {
		await fs.stat(sentinel);
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	await runProcess(npm, ['run', 'electron']);
}

async function ensureCompiled() {
	if (!(await exists('out')) || !(await mainJsPresent())) {
		await runProcess(npm, ['run', 'compile']);
		return;
	}
	if (!(await vendorRuntimePresent())) {
		// Fast path: out/ exists but vendored plain JS was never copied (common after interrupted or partial builds).
		await runProcess(npm, ['run', 'gulp', '--', 'copy-vendor-js']);
		if (!(await vendorRuntimePresent())) {
			await runProcess(npm, ['run', 'compile']);
		}
	}
}

async function main() {
	await ensureNodeModules();
	await getElectron();
	await ensureCompiled();

	// Can't require this until after dependencies are installed
	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
