import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
	assertPiSessionTailPatchedSource,
	patchPiSessionTailSource,
} from "../scripts/lib/pi-session-tail-patch.mjs";
import {
	assertPiRuntimeCorrectnessPatchSource,
	patchPiSessionManagerSource,
} from "../scripts/lib/pi-runtime-correctness-patch.mjs";

const appRoot = process.cwd();
const sessionManagerPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"core",
	"session-manager.js",
);

test("session-tail source, patch, package, and archive gates reject disabled repair control flow", () => {
	const source = readFileSync(sessionManagerPath, "utf8");
	assert.doesNotThrow(() =>
		assertPiSessionTailPatchedSource(source, "installed Pi SessionManager"),
	);
	assert.equal(patchPiSessionTailSource(source), source);
	assert.equal(patchPiSessionManagerSource(source), source);

	const mutations = new Map([
		[
			"pending reset",
			source.replace(
				"    // Feynman Pi 0.84.2 correctness patch: upstream #8345.",
				'    pending = "";\n    // Feynman Pi 0.84.2 correctness patch: upstream #8345.',
			),
		],
		[
			"early return",
			source.replace(
				"    // Feynman Pi 0.84.2 correctness patch: upstream #8345.",
				"    return entries;\n    // Feynman Pi 0.84.2 correctness patch: upstream #8345.",
			),
		],
		[
			"unreachable repair",
			source.replace(
				'    if (pending) appendFileSync(resolvedFilePath, "\\n");',
				'    if (false) {\n        if (pending) appendFileSync(resolvedFilePath, "\\n");\n    }',
			),
		],
	]);

	for (const [label, mutated] of mutations) {
		assert.notEqual(mutated, source, `${label} mutation did not apply`);
		for (const [surface, verify] of [
			[
				"source assertion",
				() => assertPiSessionTailPatchedSource(mutated, label),
			],
			["source patch", () => patchPiSessionTailSource(mutated)],
			[
				"package/archive assertion",
				() =>
					assertPiRuntimeCorrectnessPatchSource(
						mutated,
						"sessionManager",
						label,
					),
			],
			["package/archive patch", () => patchPiSessionManagerSource(mutated)],
		] as const) {
			assert.throws(
				verify,
				/Incomplete Pi session tail repair/,
				`${surface} accepted ${label}`,
			);
		}
	}
});

test("resuming an unterminated valid Pi session repairs its append boundary", async (t) => {
	const tempRoot = mkdtempSync(resolve(tmpdir(), "feynman-pi-session-tail-"));
	t.after(() => {
		if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
	});
	const source = readFileSync(sessionManagerPath, "utf8");
	assert.doesNotThrow(() =>
		assertPiSessionTailPatchedSource(source, "installed Pi SessionManager"),
	);

	const { loadEntriesFromFile, SessionManager } = (await import(
		`${pathToFileURL(sessionManagerPath).href}?session-tail=${Date.now()}`
	)) as {
		loadEntriesFromFile: (filePath: string) => unknown[];
		SessionManager: {
			open(
				path: string,
				sessionDir: string,
				cwdOverride: string,
			): {
				appendCustomEntry(customType: string, data: unknown): string;
			};
		};
	};
	const header =
		'{"type":"session","id":"abc","timestamp":"2026-08-26T00:00:00Z","cwd":"/tmp"}';
	const finalMessage =
		'{"type":"message","id":"1","parentId":null,"timestamp":"2026-08-26T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}';
	const validPath = resolve(tempRoot, "unterminated-valid.jsonl");
	const validContent = `${header}\n${finalMessage}`;
	writeFileSync(validPath, validContent, "utf8");
	assert.equal(loadEntriesFromFile(validPath).length, 2);
	assert.equal(readFileSync(validPath, "utf8"), `${validContent}\n`);

	const malformedPath = resolve(tempRoot, "unterminated-malformed.jsonl");
	const malformedContent = `${header}\n{"type":"message"`;
	writeFileSync(malformedPath, malformedContent, "utf8");
	assert.equal(loadEntriesFromFile(malformedPath).length, 1);
	assert.equal(readFileSync(malformedPath, "utf8"), `${malformedContent}\n`);

	const invalidPath = resolve(tempRoot, "unterminated-non-session.jsonl");
	const invalidContent = '{"type":"message","id":"1"}';
	writeFileSync(invalidPath, invalidContent, "utf8");
	assert.deepEqual(loadEntriesFromFile(invalidPath), []);
	assert.equal(readFileSync(invalidPath, "utf8"), invalidContent);

	const appendPath = resolve(tempRoot, "append-boundary.jsonl");
	writeFileSync(appendPath, validContent, "utf8");
	const session = SessionManager.open(appendPath, tempRoot, tempRoot);
	session.appendCustomEntry("session-tail-test", { verified: true });
	const appendedLines = readFileSync(appendPath, "utf8")
		.split("\n")
		.filter(Boolean);
	assert.equal(appendedLines.length, 3);
	assert.deepEqual(
		appendedLines.map((line) => JSON.parse(line).type),
		["session", "message", "custom"],
	);
});
