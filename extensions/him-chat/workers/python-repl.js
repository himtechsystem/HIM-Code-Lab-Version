#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  HIM Code Python REPL Engine v6 - Fixed Buffer Issue
 *--------------------------------------------------------------------------------------------*/

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_PATH = path.join(__dirname, '..', 'sdk', 'him_sdk.py');

class PythonReplEngine {
	constructor() {
		this.process = null;
		this.outputBuffer = '';
		this.isReady = false;
		this.sdkLoaded = false;
		this.readyResolve = null;
		this.readyReject = null;
		this.initPromise = this.initialize();
		this.eventCallbacks = {
			say: [],
			file_read: [],
			file_written: [],
			execute_start: [],
			execute_done: [],
			dir_list: [],
			cwd_changed: [],
			init: [],
			error: [],
			exception: []
		};
	}

	async initialize() {
		return new Promise((resolve, reject) => {
			try {
				const sdkCode = fs.readFileSync(SDK_PATH, 'utf-8');

				this.process = spawn('python3', ['-u', '-i', '-q', '-c', sdkCode], {
					stdin: 'pipe',
					stdout: 'pipe',
					stderr: 'pipe',
					env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
				});

				this.process.stdout.on('data', (data) => {
					this.handleOutput('stdout', data.toString());
				});

				this.process.stderr.on('data', (data) => {
					this.handleOutput('stderr', data.toString());
				});

				this.process.on('error', (err) => {
					console.error('[PythonRepl] Process error:', err.message);
					reject(err);
				});

				this.process.on('exit', (code) => {
					console.log(`[PythonRepl] Process exited with code ${code}`);
					this.isReady = false;
				});

				this.readyResolve = resolve;
				setTimeout(() => {
					if (!this.isReady) {
						console.log('[PythonRepl] Timeout waiting for init');
						this.isReady = true;
						this.sdkLoaded = true;
						resolve();
					}
				}, 3000);
			} catch (err) {
				reject(err);
			}
		});
	}

	on(event, callback) {
		if (this.eventCallbacks[event]) {
			this.eventCallbacks[event].push(callback);
		}
		return () => {
			const idx = this.eventCallbacks[event].indexOf(callback);
			if (idx > -1) this.eventCallbacks[event].splice(idx, 1);
		};
	}

	emit(event, data) {
		if (this.eventCallbacks[event]) {
			for (const cb of this.eventCallbacks[event]) {
				try {
					cb(data);
				} catch (e) {
					console.error(`[PythonRepl] Event handler error:`, e);
				}
			}
		}
	}

	handleOutput(type, data) {
		this.outputBuffer += data;

		const lines = this.outputBuffer.split('\n');
		this.outputBuffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.trim()) continue;

			if (line.startsWith('HIM_STREAM: ')) {
				try {
					const jsonStr = line.substring('HIM_STREAM: '.length);
					const event = JSON.parse(jsonStr);

					if (event.action === 'init' && !this.isReady) {
						this.isReady = true;
						this.sdkLoaded = true;
						console.log('[PythonRepl] SDK Loaded!');
						this.emit('init', event.data);
						if (this.readyResolve) {
							this.readyResolve();
							this.readyResolve = null;
						}
					} else {
						this.emit(event.action, event.data);
					}
				} catch (e) {
					console.log(`[PythonRepl] Failed to parse: ${line}`);
				}
			} else if (type === 'stderr') {
				if (line.includes('[HIM SDK]')) continue;
				console.log(`  [Python] ${line}`);
			} else {
				console.log(`  ${line}`);
			}
		}
	}

	async ensureReady() {
		if (!this.isReady) {
			await this.initPromise;
		}
	}

	wrapForExec(code) {
		return `exec("""${code.replace(/"""/g, '\\"\\"\\"')}""")`;
	}

	async execute(code) {
		await this.ensureReady();

		this.outputBuffer = '';
		const wrapped = this.wrapForExec(code);
		this.process.stdin.write(wrapped + '\n');
		await this.delay(500);

		return [];
	}

	delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	dispose() {
		if (this.process) {
			try {
				this.process.stdin.write('exit()\n');
			} catch (e) {}
			setTimeout(() => {
				if (this.process) {
					this.process.kill();
					this.process = null;
				}
			}, 100);
		}
	}
}

async function testReplEngine() {
	console.log('=== HIM Code Python REPL Engine v6 ===\n');

	const repl = new PythonReplEngine();

	repl.on('say', (msg) => {
		console.log(`\n💬 him_say: ${msg}`);
	});

	repl.on('file_read', (data) => {
		console.log(`\n📄 file_read: ${data.path}`);
	});

	repl.on('file_written', (data) => {
		console.log(`\n✅ file_written: ${data.path}`);
	});

	repl.on('execute_done', (data) => {
		console.log(`\n⚡ execute_done: ${data.returncode === 0 ? 'OK' : 'FAILED'}`);
	});

	repl.on('dir_list', (data) => {
		console.log(`\n📂 dir_list: ${data.path} (${data.items.length} items)`);
	});

	repl.on('error', (msg) => {
		console.log(`\n❌ error: ${msg}`);
	});

	console.log('Initializing...');
	await repl.initPromise.catch(err => {
		console.error('Failed:', err.message);
		process.exit(1);
	});
	console.log('');

	const tests = [
		{ code: 'him_say("Hello from SDK!")', desc: 'Basic him_say' },
		{ code: 'print(him_get_cwd())', desc: 'Get cwd' },
		{ code: 'him_list_dir(".")', desc: 'List directory' },
		{ code: 'him_write_file("/tmp/him_test.txt", "Hello!")', desc: 'Write file' },
		{ code: 'him_read_file("/tmp/him_test.txt")', desc: 'Read file' },
		{ code: 'him_execute("echo test")', desc: 'Execute shell' },
		{ code: 'def add(a, b):\\n    return a + b\\nhim_say(str(add(3, 5)))', desc: 'Multi-line: function' },
		{ code: 'for i in range(3):\\n    print(i)', desc: 'Multi-line: for loop' },
		{ code: 'him_read_file("/nonexistent/file.txt")', desc: 'Error handling' },
		{ code: 'him_say("Done!")', desc: 'Final message' },
	];

	for (const test of tests) {
		console.log(`\n>>> ${test.desc}`);
		console.log(`    Code: ${test.code.replace(/\\n/g, '\\n')}`);
		
		await repl.execute(test.code);
		await repl.delay(300);
	}

	console.log('\n\n=== Test Complete ===');
	console.log('SDK Loaded:', repl.sdkLoaded);
	console.log('Process alive:', repl.isReady);

	repl.dispose();
}

testReplEngine().catch(console.error);
