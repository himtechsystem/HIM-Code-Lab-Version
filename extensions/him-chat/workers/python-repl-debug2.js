#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SDK_PATH = path.join(__dirname, '..', 'sdk', 'him_sdk.py');

async function test() {
	console.log('=== Debug Test 2 ===\n');

	const sdkCode = fs.readFileSync(SDK_PATH, 'utf-8');
	let outputBuffer = '';
	let checkCount = 0;

	const proc = spawn('python3', ['-u', '-i', '-q', '-c', sdkCode], {
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe'
	});

	proc.stdout.on('data', (data) => {
		const str = data.toString();
		outputBuffer += str;
		process.stdout.write('[STDOUT] ' + str);
	});

	proc.stderr.on('data', (data) => {
		process.stderr.write('[STDERR] ' + data);
	});

	const check = () => {
		checkCount++;
		const has1 = outputBuffer.includes('HIM_STREAM: ');
		const has2 = outputBuffer.includes('"action": "init"');
		console.log(`Check #${checkCount}: has1=${has1}, has2=${has2}`);
		
		if (has1 && has2) {
			console.log('\n✅ Ready detected!');
			proc.kill();
		} else if (checkCount < 20) {
			setTimeout(check, 100);
		} else {
			console.log('\n❌ Timeout!');
			console.log('Buffer preview:', outputBuffer.substring(0, 200));
			proc.kill();
		}
	};

	setTimeout(check, 100);
	await new Promise(r => setTimeout(r, 3000));
}

test().catch(console.error);
