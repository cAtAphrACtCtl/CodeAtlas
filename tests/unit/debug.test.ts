import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	addLogSink,
	debugLog,
	initializeDebug,
	log,
} from "../../packages/core/src/common/debug.js";

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

	initializeDebug({ level: "debug", scopes: [], trace: false });
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

	initializeDebug({ level: "debug", scopes: [], trace: false });
	process.env.CODEATLAS_DEBUG = "runtime";
	process.env.CODEATLAS_LOG_FILE = logFilePath;

	debugLog("mcp", "handling code_search", { query: "IndexCoordinator" });

	await assert.rejects(() => readFile(logFilePath, "utf8"));
});

test("log writes info-level messages to file when CODEATLAS_LOG_FILE is set", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-debug-"));
	const logFilePath = path.join(tempDir, "logs", "codeatlas.log");
	const originalLogFile = process.env.CODEATLAS_LOG_FILE;
	const originalLogLevel = process.env.CODEATLAS_LOG_LEVEL;

	t.after(async () => {
		if (originalLogFile === undefined) {
			delete process.env.CODEATLAS_LOG_FILE;
		} else {
			process.env.CODEATLAS_LOG_FILE = originalLogFile;
		}

		if (originalLogLevel === undefined) {
			delete process.env.CODEATLAS_LOG_LEVEL;
		} else {
			process.env.CODEATLAS_LOG_LEVEL = originalLogLevel;
		}

		await rm(tempDir, { recursive: true, force: true });
	});

	initializeDebug({ level: "info", scopes: [], trace: false });
	delete process.env.CODEATLAS_LOG_LEVEL;
	process.env.CODEATLAS_LOG_FILE = logFilePath;

	log("info", "mcp", "server started", { port: 3000 });

	const logContent = await readFile(logFilePath, "utf8");
	assert.match(logContent, /\[INFO\]/);
	assert.match(logContent, /\[codeatlas:mcp\] server started/);
	assert.match(logContent, /"port":3000/);
});

test("log suppresses messages below the configured level", (t) => {
	const originalLogLevel = process.env.CODEATLAS_LOG_LEVEL;

	t.after(() => {
		if (originalLogLevel === undefined) {
			delete process.env.CODEATLAS_LOG_LEVEL;
		} else {
			process.env.CODEATLAS_LOG_LEVEL = originalLogLevel;
		}
	});

	const captured: string[] = [];
	const dispose = addLogSink((_level, line) => {
		captured.push(line);
	});
	t.after(dispose);

	initializeDebug({ level: "warn", scopes: [], trace: false });
	delete process.env.CODEATLAS_LOG_LEVEL;

	log("info", "mcp", "this should be suppressed");
	log("debug", "mcp", "this should also be suppressed");
	log("warn", "mcp", "this should appear");
	log("error", "mcp", "this should also appear");

	assert.equal(
		captured.filter((l) => l.includes("this should be suppressed")).length,
		0,
	);
	assert.equal(
		captured.filter((l) => l.includes("this should also be suppressed"))
			.length,
		0,
	);
	assert.ok(captured.some((l) => l.includes("this should appear")));
	assert.ok(captured.some((l) => l.includes("this should also appear")));
});

test("CODEATLAS_LOG_LEVEL env var overrides config level", (t) => {
	const originalLogLevel = process.env.CODEATLAS_LOG_LEVEL;

	t.after(() => {
		if (originalLogLevel === undefined) {
			delete process.env.CODEATLAS_LOG_LEVEL;
		} else {
			process.env.CODEATLAS_LOG_LEVEL = originalLogLevel;
		}
	});

	const captured: string[] = [];
	const dispose = addLogSink((_level, line) => {
		captured.push(line);
	});
	t.after(dispose);

	// Config says error-only but env says info
	initializeDebug({ level: "error", scopes: [], trace: false });
	process.env.CODEATLAS_LOG_LEVEL = "info";

	log("info", "runtime", "env override check");

	assert.ok(captured.some((l) => l.includes("env override check")));
});

test("log writes to config-based file path", async (t) => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "codeatlas-debug-"));
	const configLogFile = path.join(tempDir, "config-logs", "app.log");
	const originalLogFile = process.env.CODEATLAS_LOG_FILE;

	t.after(async () => {
		if (originalLogFile === undefined) {
			delete process.env.CODEATLAS_LOG_FILE;
		} else {
			process.env.CODEATLAS_LOG_FILE = originalLogFile;
		}

		await rm(tempDir, { recursive: true, force: true });
	});

	delete process.env.CODEATLAS_LOG_FILE;
	initializeDebug({ level: "info", file: configLogFile, scopes: [], trace: false });

	log("info", "runtime", "config file test");

	const logContent = await readFile(configLogFile, "utf8");
	assert.match(logContent, /config file test/);
});

test("addLogSink delivers emitted lines to the registered sink", (t) => {
	const originalLogLevel = process.env.CODEATLAS_LOG_LEVEL;

	t.after(() => {
		if (originalLogLevel === undefined) {
			delete process.env.CODEATLAS_LOG_LEVEL;
		} else {
			process.env.CODEATLAS_LOG_LEVEL = originalLogLevel;
		}
	});

	const received: Array<{ level: string; line: string }> = [];
	const dispose = addLogSink((level, line) => {
		received.push({ level, line });
	});
	t.after(dispose);

	initializeDebug({ level: "info", scopes: [], trace: false });
	delete process.env.CODEATLAS_LOG_LEVEL;

	log("warn", "indexer", "index rebuild required");

	assert.ok(received.some((r) => r.level === "warn" && r.line.includes("index rebuild required")));
});

test("removeLogSink stops further delivery", (t) => {
	const originalLogLevel = process.env.CODEATLAS_LOG_LEVEL;

	t.after(() => {
		if (originalLogLevel === undefined) {
			delete process.env.CODEATLAS_LOG_LEVEL;
		} else {
			process.env.CODEATLAS_LOG_LEVEL = originalLogLevel;
		}
	});

	const captured: string[] = [];
	const dispose = addLogSink((_level, line) => {
		captured.push(line);
	});

	initializeDebug({ level: "info", scopes: [], trace: false });
	delete process.env.CODEATLAS_LOG_LEVEL;

	log("info", "runtime", "before removal");
	dispose(); // remove the sink
	log("info", "runtime", "after removal");

	assert.ok(captured.some((l) => l.includes("before removal")));
	assert.equal(
		captured.filter((l) => l.includes("after removal")).length,
		0,
	);
});