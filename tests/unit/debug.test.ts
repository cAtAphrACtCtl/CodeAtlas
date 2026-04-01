import assert from "node:assert/strict";
import test from "node:test";

import { initializeDebug, toErrorDetails } from "../../src/core/common/debug.js";

test("initializeDebug maps debug config to process environment", (t) => {
	const originalDebug = process.env.CODEATLAS_DEBUG;
	const originalDebugTrace = process.env.CODEATLAS_DEBUG_TRACE;

	t.after(() => {
		if (originalDebug === undefined) {
			delete process.env.CODEATLAS_DEBUG;
		} else {
			process.env.CODEATLAS_DEBUG = originalDebug;
		}

		if (originalDebugTrace === undefined) {
			delete process.env.CODEATLAS_DEBUG_TRACE;
		} else {
			process.env.CODEATLAS_DEBUG_TRACE = originalDebugTrace;
		}
	});

	delete process.env.CODEATLAS_DEBUG;
	delete process.env.CODEATLAS_DEBUG_TRACE;
	initializeDebug({ scopes: ["mcp", "runtime"], trace: true });

	const error = Object.assign(new Error("failed"), {
		stderr: "e1\ne2\ne3\ne4\ne5\ne6",
		stdout: "o1\no2\no3\no4\no5\no6",
	});
	const details = toErrorDetails(error);

	assert.deepEqual(details.stderr, ["e2", "e3", "e4", "e5", "e6"]);
	assert.deepEqual(details.stdout, ["o2", "o3", "o4", "o5", "o6"]);
});

test("initializeDebug preserves explicit environment overrides", (t) => {
	const originalDebug = process.env.CODEATLAS_DEBUG;
	const originalDebugTrace = process.env.CODEATLAS_DEBUG_TRACE;

	t.after(() => {
		if (originalDebug === undefined) {
			delete process.env.CODEATLAS_DEBUG;
		} else {
			process.env.CODEATLAS_DEBUG = originalDebug;
		}

		if (originalDebugTrace === undefined) {
			delete process.env.CODEATLAS_DEBUG_TRACE;
		} else {
			process.env.CODEATLAS_DEBUG_TRACE = originalDebugTrace;
		}
	});

	process.env.CODEATLAS_DEBUG = "trace";
	process.env.CODEATLAS_DEBUG_TRACE = "0";
	initializeDebug({ scopes: ["mcp"], trace: false });
	const error = Object.assign(new Error("failed"), {
		stderr: "e1\ne2\ne3\ne4\ne5\ne6",
	});
	const details = toErrorDetails(error);

	assert.equal(process.env.CODEATLAS_DEBUG, "trace");
	assert.equal(process.env.CODEATLAS_DEBUG_TRACE, "0");
	assert.deepEqual(details.stderr, ["e2", "e3", "e4", "e5", "e6"]);
});

test("toErrorDetails captures error tails and metadata", () => {
	initializeDebug({ scopes: [], trace: false });
	const error = Object.assign(new Error("failed"), {
		code: "EFAIL",
		signal: "SIGTERM",
		stderr: "err-1\nerr-2",
		stdout: "out-1\nout-2",
	});
	const details = toErrorDetails(error);

	assert.equal(details.message, "failed");
	assert.equal(details.name, "Error");
	assert.equal(details.code, "EFAIL");
	assert.equal(details.signal, "SIGTERM");
	assert.equal(details.stdout, undefined);
	assert.equal(details.stderr, undefined);
});

test("toErrorDetails handles non-Error values", () => {
	const details = toErrorDetails("plain");

	assert.deepEqual(details, { message: "plain" });
});
