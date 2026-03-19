import * as vscode from "vscode";

import { registerCodeAtlasCommands } from "./commands/register-commands.js";

export function activate(context: vscode.ExtensionContext): void {
  registerCodeAtlasCommands(context);
}

export function deactivate(): void {}