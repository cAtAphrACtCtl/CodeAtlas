import * as vscode from "vscode";

import { addLogSink } from "../../../core/src/common/debug.js";
import { registerCodeAtlasCommands } from "./commands/register-commands.js";

export function activate(context: vscode.ExtensionContext): void {
	const outputChannel = vscode.window.createOutputChannel("CodeAtlas");
	const disposeSink = addLogSink((_level, line) => {
		outputChannel.appendLine(line);
	});

	context.subscriptions.push({ dispose: disposeSink });
	context.subscriptions.push(outputChannel);

	registerCodeAtlasCommands(context);
}

export function deactivate(): void {}
