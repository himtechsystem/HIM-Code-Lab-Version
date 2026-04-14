#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_PATH = path.join(__dirname, '..', 'sdk', 'him_sdk.py');

async function test() {
	console.log('=== Minimal Test ===\n');

	const sdkCode = fs.readFileSync(SDK_PATH, 'utf-8');
	let outputBuffer = '';
	let bufferUpdated = 0;

	const proc = spawn('python3', ['-u', '-i', '-q', '-c', sdkCode], {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe'
	});

	proc.stdout.on('data', (data) => {
		const str = data.toString();
		outputBuffer += str;
		bufferUpdated++;
		console.log(`[Event #${bufferUpdated}] Buffer updated, length: ${outputBuffer.length}`);
	});

	proc.stderr.on('data', (data) => {
		process.stderr.write('[STDERR] ' + data);
	});

	await new Promise(r => setTimeout(r, 100));
	console.log('After 100ms, buffer length:', outputBuffer.length);

	await new Promise(r => setTimeout(r, 500));
	console.log('After 500ms, buffer length:', outputBuffer.length);

	const has1 = outputBuffer.includes('HIM_STREAM: ');
	const has2 = outputBuffer.includes('"action": "init"');
	console.log(`\nFinal check: has1=${has1}, has2=${has2}`);

	if (has1 && has2) {
		console.log('✅ Detection works!');
	} else {
		console.log('❌ Detection failed!');
		console.log('Buffer preview:', outputBuffer.substring(0, 300));
	}

	proc.kill();
}

test().catch(console.error);
