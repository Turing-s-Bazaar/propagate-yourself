import test from "node:test";
import assert from "node:assert/strict";

import { handlePiJsonLine } from "../src/workbench/chat-runtime.js";

test("workbench Pi RPC stream accepts Pi 0.84 delta-only message updates", async () => {
	const toolEvents = new Map();
	const updates: Array<{ contentDelta?: string; status?: string }> = [];
	for (const delta of ["partial ", "answer"]) {
		await handlePiJsonLine(JSON.stringify({
			type: "message_update",
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta,
			},
		}), toolEvents, (update) => {
			updates.push(update);
		});
	}

	assert.deepEqual(updates, [
		{ contentDelta: "partial ", status: "running", toolEvents: [] },
		{ contentDelta: "answer", status: "running", toolEvents: [] },
	]);
});
