import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { debugLog, initializeDebug } from "../../packages/core/src/common/debug.js";

test("debugLog mirrors enabled logs to file when CODEATLAS_LOG_FILE is set", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-debug-"));
	const logFilePath = path.join(tempDir, "logs", "codeatlas.log");
	const originalDebug = process.env.CODEATLAS_DEBUG;
	const originalLogFile = process.env.CODEATLAS_LOG_FILE;

	t.after(async () => {
		if (originalDebug === undefined) {
			delete process.env.CODEATLAS_DEBUG;
		} else {
			process.env.CODEATLAS_DEBUG = originalDebug;
		}

		if (originalLogFile === undefined) {
			delete process.env.CODEATLAS_LOG_FILE;
		} else {
			process.env.CODEATLAS_LOG_FILE = originalLogFile;
		}

		await rm(tempDir, { recursive: true, force: true });
	});

	initializeDebug({ scopes: [], trace: false });
	process.env.CODEATLAS_DEBUG = "mcp";
	process.env.CODEATLAS_LOG_FILE = logFilePath;

	debugLog("mcp", "handling code_search", { query: "IndexCoordinator" });

	const logContent = await readFile(logFilePath, "utf8");
	assert.match(logContent, /\[codeatlas:mcp\] handling code_search/);
	assert.match(logContent, /"query":"IndexCoordinator"/);
});

test("debugLog ignores disabled scopes even when CODEATLAS_LOG_FILE is set", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-debug-"));
	const logFilePath = path.join(tempDir, "logs", "codeatlas.log");
	const originalDebug = process.env.CODEATLAS_DEBUG;
	const originalLogFile = process.env.CODEATLAS_LOG_FILE;

	t.after(async () => {
		if (originalDebug === undefined) {
			delete process.env.CODEATLAS_DEBUG;
		} else {
			process.env.CODEATLAS_DEBUG = originalDebug;
		}

		if (originalLogFile === undefined) {
			delete process.env.CODEATLAS_LOG_FILE;
		} else {
			process.env.CODEATLAS_LOG_FILE = originalLogFile;
		}

		await rm(tempDir, { recursive: true, force: true });
	});

	initializeDebug({ scopes: [], trace: false });
	process.env.CODEATLAS_DEBUG = "runtime";
	process.env.CODEATLAS_LOG_FILE = logFilePath;

	debugLog("mcp", "handling code_search", { query: "IndexCoordinator" });

	await assert.rejects(() => readFile(logFilePath, "utf8"));
});