import path from "node:path";

import * as vscode from "vscode";

import { createCodeAtlasServices } from "../../../core/src/runtime.js";
import { toDiscoveryQuickPickItems, toRepositoryStatusQuickPickItems } from "../providers/repository-picker.js";

async function getWorkspaceRoot(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("No workspace folder is open.");
  }

  return folder.uri.fsPath;
}

async function getServices() {
  const workspaceRoot = await getWorkspaceRoot();
  return createCodeAtlasServices({
    baseDir: workspaceRoot,
    configFilePath: path.join(workspaceRoot, "config", "codeatlas.example.json"),
  });
}

export function registerCodeAtlasCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codeatlas.registerCurrentWorkspace", async () => {
      const workspaceRoot = await getWorkspaceRoot();
      const services = await getServices();
      const folderName = path.basename(workspaceRoot);

      await services.registry.registerRepository({
        name: folderName,
        rootPath: workspaceRoot,
      });

      await services.indexCoordinator.refreshRepository(folderName);
      vscode.window.showInformationMessage(`CodeAtlas registered workspace '${folderName}'.`);
    }),

    vscode.commands.registerCommand("codeatlas.discoverRepositories", async () => {
      const workspaceRoot = await getWorkspaceRoot();
      const services = await getServices();
      const parentFolder = path.dirname(workspaceRoot);
      const candidates = await services.discoveryService.discoverRepositories(parentFolder);
      const items = toDiscoveryQuickPickItems(candidates);
      const selected = await vscode.window.showQuickPick(items, {
        title: "Select a repository to register with CodeAtlas",
      });

      if (!selected?.description) {
        return;
      }

      await services.registry.registerRepository({
        name: selected.label,
        rootPath: selected.description,
      });

      await services.indexCoordinator.refreshRepository(selected.label);
      vscode.window.showInformationMessage(`CodeAtlas registered '${selected.label}'.`);
    }),

    vscode.commands.registerCommand("codeatlas.showRepositoryStatus", async () => {
      const services = await getServices();
      const repositories = await services.registry.listRepositories();
      const statuses = await services.indexCoordinator.getStatus();

      await vscode.window.showQuickPick(toRepositoryStatusQuickPickItems(repositories, statuses), {
        title: "CodeAtlas repository status",
        canPickMany: false,
      });
    }),

    vscode.commands.registerCommand("codeatlas.openConfig", async () => {
      const services = await getServices();
      const configPath = services.configurationService.resolveConfigPath(path.join(await getWorkspaceRoot(), "config", "codeatlas.example.json"));
      const document = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(document);
    }),
  );
}