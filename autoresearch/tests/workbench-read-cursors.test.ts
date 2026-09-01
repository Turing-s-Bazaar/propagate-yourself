import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	readWorkbenchFrameReadCursors,
	upsertWorkbenchFrameReadCursor,
} from "../src/workbench/read-cursors.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-read-cursors-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "scaling-laws.md"), "# Scaling Laws\n\nFrame content.\n");
	return root;
}

test("workbench frame read cursors persist and appear in state", () => {
	const root = makeWorkspace();
	try {
		const cursor = upsertWorkbenchFrameReadCursor(root, {
			rootFrameId: "scaling-laws",
			messageId: "message-7",
			messageIndex: 7.9,
			messageCount: 12,
			projectId: "workspace",
			runSlug: "scaling-laws",
		});

		assert.equal(cursor.rootFrameId, "scaling-laws");
		assert.equal(cursor.messageId, "message-7");
		assert.equal(cursor.messageIndex, 7);
		assert.equal(cursor.messageCount, 12);
		assert.equal(readWorkbenchFrameReadCursors(root).length, 1);

		const storePath = workbenchDataPath(root, "read-cursors.json");
		assert.equal(existsSync(storePath), true);
		assert.match(readFileSync(storePath, "utf8"), /feynman\.workbenchReadCursors\.v1/);
		assert.equal(existsSync(join(root, ".feynman", "workbench", "read-cursors.json")), false);

		const state = buildWorkbenchState({ workingDir: root });
		assert.equal(state.frameReadCursors[0]?.rootFrameId, "scaling-laws");
		assert.equal(state.frameReadCursors[0]?.messageCount, 12);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server updates frame read cursors through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/read-cursor`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				rootFrameId: "scaling-laws",
				messageId: "message-2",
				messageIndex: 2,
				messageCount: 4,
				projectId: "workspace",
				runSlug: "scaling-laws",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			cursor: { rootFrameId: string; messageId?: string; messageIndex: number };
			state: { frameReadCursors: Array<{ rootFrameId: string; messageCount: number }> };
		};
		assert.equal(payload.cursor.rootFrameId, "scaling-laws");
		assert.equal(payload.cursor.messageId, "message-2");
		assert.equal(payload.cursor.messageIndex, 2);
		assert.deepEqual(payload.state.frameReadCursors.map((cursor) => ({
			rootFrameId: cursor.rootFrameId,
			messageCount: cursor.messageCount,
		})), [{ rootFrameId: "scaling-laws", messageCount: 4 }]);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
