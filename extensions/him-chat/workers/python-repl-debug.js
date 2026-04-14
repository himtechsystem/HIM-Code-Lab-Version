#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_PATH = path.join(__dirname, '..', 'sdk', 'him_sdk.py');

async function test() {
	console.log('=== Debug Test ===\n');

	const sdkCode = fs.readFileSync(SDK_PATH, 'utf-8');
	let output = '';

	const proc = spawn('python3', ['-u', '-i', '-q', '-c', sdkCode], {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe'
	});

	proc.stdout.on('data', (data) => {
		const str = data.toString();
		output += str;
		process.stdout.write('[STDOUT] ' + JSON.stringify(str) + '\n');
	});

	proc.stderr.on('data', (data) => {
		process.stderr.write('[STDERR] ' + data);
	});

	await new Promise(r => setTimeout(r, 1000));

	console.log('\n--- Raw output captured ---');
	console.log(output.substring(0, 500));

	console.log('\n--- Check for HIM_STREAM ---');
	console.log('Contains HIM_STREAM:', output.includes('HIM_STREAM'));
	console.log('Contains "init":', output.includes('"init"'));

	proc.kill();
}

test().catch(console.error);
