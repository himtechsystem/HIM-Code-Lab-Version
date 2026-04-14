/*---------------------------------------------------------------------------------------------
 *  HIM Code AI Controller - Global Agent Protocol Implementation
 *  Allows AI models to control VS Code through XML-like tags
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITerminalService, ITerminalInstance } from '../../../contrib/terminal/browser/terminal.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { ITextModel } from '../../../../editor/common/model.js';

export interface IHimCommandResult {
	type: 'read' | 'write' | 'list' | 'terminal';
	success: boolean;
	output: string;
	error?: string;
}

export interface IHimCommand {
	type: 'read' | 'write' | 'list' | 'terminal';
	raw: string;
	args: string;
}

export class HimAiController extends Disposable {
	private static readonly HIM_TAG_REGEX = /<him_(read|write|list|terminal)>([\s\S]*?)<\/him_\1>/gi;

	private readonly _onCommandExecuted = this._register(new Emitter<IHimCommandResult>());
	readonly onCommandExecuted = this._onCommandExecuted.event;

	private himTerminalInstance: ITerminalInstance | undefined;
	private readonly terminalName = 'HIM CODE';
	private outputBuffer: string = '';

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this.setupTerminalOutputListener();
	}

	private setupTerminalOutputListener(): void {
		this._register(this.terminalService.onAnyInstanceData(e => {
			if (this.himTerminalInstance && e.instance.instanceId === this.himTerminalInstance.instanceId) {
				this.outputBuffer += e.data;
			}
		}));
	}

	public parseCommands(text: string): IHimCommand[] {
		const commands: IHimCommand[] = [];
		let match;
		const regex = new RegExp(HimAiController.HIM_TAG_REGEX.source, 'gi');

		while ((match = regex.exec(text)) !== null) {
			commands.push({
				type: match[1] as 'read' | 'write' | 'list' | 'terminal',
				raw: match[0],
				args: match[2].trim(),
			});
		}

		return commands;
	}

	public async executeCommand(command: IHimCommand, token?: CancellationToken): Promise<IHimCommandResult> {
		switch (command.type) {
			case 'read':
				return this.executeRead(command.args, token);
			case 'write':
				return this.executeWrite(command.args, token);
			case 'list':
				return this.executeList(command.args, token);
			case 'terminal':
				return this.executeTerminal(command.args, token);
			default:
				return { type: command.type, success: false, output: '', error: `Unknown command type: ${command.type}` };
		}
	}

	private async executeRead(path: string, token?: CancellationToken): Promise<IHimCommandResult> {
		try {
			const uri = this.resolvePath(path);
			const content = await this.fileService.readFile(uri, undefined, token);
			const text = content.value.toString();
			const preview = text.length > 2000 ? text.slice(0, 2000) + '\n... (truncated)' : text;
			return {
				type: 'read',
				success: true,
				output: `✅ Read file: ${path}\n\`\`\`\n${preview}\n\`\`\``
			};
		} catch (error) {
			return {
				type: 'read',
				success: false,
				output: '',
				error: `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async executeWrite(pathAndContent: string, _token?: CancellationToken): Promise<IHimCommandResult> {
		const lines = pathAndContent.split('\n');
		if (lines.length < 2) {
			return {
				type: 'write',
				success: false,
				output: '',
				error: 'Usage: <him_write>/path/to/file\n<file content here>'
			};
		}

		const filePath = lines[0].trim();
		const content = lines.slice(1).join('\n');

		try {
			const uri = this.resolvePath(filePath);

			await this.fileService.writeFile(uri, VSBuffer.fromString(content), { atomic: false });
			await this.editorService.openEditor({ resource: uri });

			return {
				type: 'write',
				success: true,
				output: `✅ File written: ${filePath} (${content.length} chars)`
			};
		} catch (error) {
			return {
				type: 'write',
				success: false,
				output: '',
				error: `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async executeList(path: string, _token?: CancellationToken): Promise<IHimCommandResult> {
		try {
			const uri = this.resolvePath(path);
			const stat = await this.fileService.resolve(uri);

			if (stat.isDirectory) {
				const entries = (stat as any).children || [];
				const items = entries
					.slice(0, 50)
					.map((entry: any) => {
						const icon = entry.isDirectory ? '📁' : '📄';
						return `${icon} ${entry.name}`;
					})
					.join('\n');
				const truncated = entries.length > 50 ? `\n... and ${entries.length - 50} more items` : '';
				return {
					type: 'list',
					success: true,
					output: `📂 Contents of ${path}:\n\`\`\`\n${items}${truncated}\n\`\`\``
				};
			} else {
				return {
					type: 'list',
					success: false,
					output: '',
					error: `${path} is not a directory`
				};
			}
		} catch (error) {
			return {
				type: 'list',
				success: false,
				output: '',
				error: `Failed to list ${path}: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private async executeTerminal(command: string, _token?: CancellationToken): Promise<IHimCommandResult> {
		try {
			this.outputBuffer = '';

			if (!this.himTerminalInstance) {
				this.himTerminalInstance = await this.terminalService.createTerminal({
					config: { name: this.terminalName },
				});

				this._register({
					dispose: () => {
						this.himTerminalInstance = undefined;
					}
				});
			}

			this.terminalService.setActiveInstance(this.himTerminalInstance);
			await this.terminalService.focusInstance(this.himTerminalInstance);

			await this.himTerminalInstance.sendText(command + '\n', true);

			await new Promise(resolve => setTimeout(resolve, 500));

			const output = this.outputBuffer || '(no output)';
			return {
				type: 'terminal',
				success: true,
				output: `🔧 Command: ${command}\n\`\`\`\n${output}\n\`\`\``
			};
		} catch (error) {
			return {
				type: 'terminal',
				success: false,
				output: '',
				error: `Terminal error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	private resolvePath(path: string): URI {
		if (path.startsWith('/')) {
			return URI.file(path);
		}

		const activeEditor = this.editorService.activeTextEditorControl;
		const model = activeEditor?.getModel();
		if (model) {
			const currentUri = (model as ITextModel).uri;
			if (currentUri) {
				const base = currentUri.with({ path: currentUri.path.replace(/\/[^/]*$/, '/') });
				return URI.joinPath(base, path);
			}
		}

		return URI.file(path);
	}

	public getTerminalInstance(): ITerminalInstance | undefined {
		return this.himTerminalInstance;
	}
}
