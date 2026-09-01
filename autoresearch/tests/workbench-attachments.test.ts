import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-attachments-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	return root;
}

test("workbench server accepts, downloads, prompts with, and removes chat attachments", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async (request) => ({ content: `Attached: ${request.session.attachments[0]?.name}` }),
	});
	try {
		const upload = await fetch(`${handle.url}api/chat/attachment`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				name: "dataset.csv",
				contentType: "text/csv",
				contentBase64: Buffer.from("gene,count\nTP53,42\n").toString("base64"),
			}),
		});
		assert.equal(upload.status, 200);
		const uploadPayload = await upload.json() as {
			session: { attachments: Array<{ id: string; name: string; previewText?: string; storagePath: string }> };
		};
		assert.equal(uploadPayload.session.attachments[0]?.name, "dataset.csv");
		assert.match(uploadPayload.session.attachments[0]?.previewText ?? "", /TP53/);
		const attachmentId = uploadPayload.session.attachments[0]?.id ?? "";
		const storagePath = uploadPayload.session.attachments[0]?.storagePath ?? "";

		const download = await fetch(`${handle.url}api/chat/attachment/download?${new URLSearchParams({
			sessionId: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			attachmentId,
		})}`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(download.status, 200);
		assert.equal(download.headers.get("content-type"), "text/csv");
		assert.match(await download.text(), /TP53,42/);

		const message = await fetch(`${handle.url}api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				message: "read the dataset",
			}),
		});
		assert.equal(message.status, 200);
		const messagePayload = await message.json() as { session: { messages: Array<{ content: string }> } };
		assert.match(messagePayload.session.messages.at(-1)?.content ?? "", /dataset.csv/);

		const deleted = await fetch(`${handle.url}api/chat/attachment/delete`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				attachmentId,
			}),
		});
		assert.equal(deleted.status, 200);
		assert.equal(existsSync(storagePath), false);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
