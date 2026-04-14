#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_PATH = path.join(__dirname, '..', 'sdk', 'him_sdk.py');

async function testSDK() {
	console.log('=== HIM SDK Simple Test ===\n');

	const sdkCode = fs.readFileSync(SDK_PATH, 'utf-8');
	let output = '';

	const proc = spawn('python3', ['-i', '-q', '-c', sdkCode], {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe'
	});

	proc.stdout.on('data', (data) => {
		output += data.toString();
		process.stdout.write(data);
	});

	proc.stderr.on('data', (data) => {
		process.stderr.write(data);
	});

	await new Promise(r => setTimeout(r, 500));

	console.log('\n--- Testing him_say ---');
	proc.stdin.write('him_say("Hello from Python SDK!")\n');

	await new Promise(r => setTimeout(r, 500));

	console.log('\n--- Testing him_get_cwd ---');
	proc.stdin.write('him_say(him_get_cwd())\n');

	await new Promise(r => setTimeout(r, 500));

	console.log('\n--- Testing him_list_dir ---');
	proc.stdin.write('result = him_list_dir(".")\n');

	await new Promise(r => setTimeout(r, 500));

	console.log('\n--- Testing him_execute ---');
	proc.stdin.write('him_execute("echo test123")\n');

	await new Promise(r => setTimeout(r, 1000));

	console.log('\n--- Testing him_write_file ---');
	proc.stdin.write('him_write_file("/tmp/him_test.txt", "Hello from SDK!")\n');

	await new Promise(r => setTimeout(r, 500));

	console.log('\n--- Testing him_read_file ---');
	proc.stdin.write('him_read_file("/tmp/him_test.txt")\n');

	await new Promise(r => setTimeout(r, 500));

	console.log('\n=== Test Complete ===');
	proc.kill();
}

testSDK();
