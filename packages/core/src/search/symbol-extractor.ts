import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

import { debugLog, toErrorDetails } from "../common/debug.js";
import type { SymbolKind, SymbolRecord } from "../contracts/search.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";

const supportedExtensions = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
]);
const skippedDirectories = new Set([
	".git",
	"node_modules",
	"dist",
	"data",
	".next",
]);

type ExtractedSymbol = Omit<SymbolRecord, "repo">;

function toPosixPath(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

function getLineRange(
	sourceFile: ts.SourceFile,
	node: ts.Node,
): { startLine: number; endLine: number } {
	const start = sourceFile.getLineAndCharacterOfPosition(
		node.getStart(sourceFile),
	);
	const end = sourceFile.getLineAndCharacterOfPosition(
		Math.max(0, node.getEnd() - 1),
	);

	return {
		startLine: start.line + 1,
		endLine: end.line + 1,
	};
}

function getNameText(name: ts.Node | undefined): string | null {
	if (!name) {
		return null;
	}

	if (
		ts.isIdentifier(name) ||
		ts.isStringLiteral(name) ||
		ts.isNumericLiteral(name) ||
		ts.isPrivateIdentifier(name)
	) {
		return name.text;
	}

	return null;
}

function pushSymbol(
	target: ExtractedSymbol[],
	sourceFile: ts.SourceFile,
	relativePath: string,
	name: string | null,
	kind: SymbolKind,
	node: ts.Node,
	containerName?: string,
): void {
	if (!name) {
		return;
	}

	const { startLine, endLine } = getLineRange(sourceFile, node);
	target.push({
		path: relativePath,
		name,
		kind,
		start_line: startLine,
		end_line: endLine,
		container_name: containerName,
	});
}

export class TypeScriptSymbolExtractor {
	async extractRepository(
		repository: RepositoryRecord,
	): Promise<SymbolRecord[]> {
		debugLog("symbol-extractor", "starting extractRepository", {
			repo: repository.name,
			rootPath: repository.rootPath,
		});
		const files = await this.walkRepository(repository.rootPath);
		const extracted = await Promise.all(
			files.map((filePath) => this.extractFile(repository, filePath)),
		);

		const symbols = extracted.flat().map((symbol) => ({
			repo: repository.name,
			...symbol,
		}));

		debugLog("symbol-extractor", "completed extractRepository", {
			repo: repository.name,
			fileCount: files.length,
			symbolCount: symbols.length,
		});

		return symbols;
	}

	private async extractFile(
		repository: RepositoryRecord,
		filePath: string,
	): Promise<ExtractedSymbol[]> {
		if (!supportedExtensions.has(path.extname(filePath).toLowerCase())) {
			return [];
		}

		const relativePath = toPosixPath(
			path.relative(repository.rootPath, filePath),
		);

		try {
			const content = await readFile(filePath, "utf8");
			const sourceFile = ts.createSourceFile(
				relativePath,
				content,
				ts.ScriptTarget.Latest,
				true,
			);
			const symbols: ExtractedSymbol[] = [];

			const visit = (node: ts.Node, containerName?: string) => {
				if (ts.isFunctionDeclaration(node)) {
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						getNameText(node.name),
						"function",
						node,
						containerName,
					);
				} else if (ts.isClassDeclaration(node)) {
					const name = getNameText(node.name);
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						name,
						"class",
						node,
						containerName,
					);
					containerName = name ?? containerName;
				} else if (ts.isInterfaceDeclaration(node)) {
					const name = getNameText(node.name);
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						name,
						"interface",
						node,
						containerName,
					);
					containerName = name ?? containerName;
				} else if (ts.isEnumDeclaration(node)) {
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						getNameText(node.name),
						"enum",
						node,
						containerName,
					);
				} else if (ts.isTypeAliasDeclaration(node)) {
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						getNameText(node.name),
						"type_alias",
						node,
						containerName,
					);
				} else if (ts.isVariableStatement(node)) {
					for (const declaration of node.declarationList.declarations) {
						pushSymbol(
							symbols,
							sourceFile,
							relativePath,
							getNameText(declaration.name),
							"variable",
							declaration,
							containerName,
						);
					}
				} else if (ts.isMethodDeclaration(node)) {
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						getNameText(node.name),
						"method",
						node,
						containerName,
					);
				} else if (
					ts.isPropertyDeclaration(node) ||
					ts.isPropertySignature(node)
				) {
					pushSymbol(
						symbols,
						sourceFile,
						relativePath,
						getNameText(node.name),
						"property",
						node,
						containerName,
					);
				}

				ts.forEachChild(node, (child) => visit(child, containerName));
			};

			visit(sourceFile);
			debugLog("symbol-extractor", "completed extractFile", {
				repo: repository.name,
				path: relativePath,
				symbolCount: symbols.length,
			});
			return symbols;
		} catch (error) {
			debugLog("symbol-extractor", "extractFile failed", {
				repo: repository.name,
				path: relativePath,
				...toErrorDetails(error),
			});
			throw error;
		}
	}

	private async walkRepository(rootPath: string): Promise<string[]> {
		const results: string[] = [];
		const queue = [rootPath];

		while (queue.length > 0) {
			const currentDirectory = queue.shift();
			if (!currentDirectory) {
				continue;
			}

			const entries = await readdir(currentDirectory, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(currentDirectory, entry.name);
				if (entry.isDirectory()) {
					if (!skippedDirectories.has(entry.name)) {
						queue.push(fullPath);
					}

					continue;
				}

				if (entry.isFile()) {
					results.push(fullPath);
				}
			}
		}

		debugLog("symbol-extractor", "walked repository", {
			rootPath,
			fileCount: results.length,
		});

		return results;
	}
}
