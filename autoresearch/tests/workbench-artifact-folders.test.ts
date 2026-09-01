import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureWorkbenchChatSession } from "../src/workbench/chat.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-artifact-folders-"));
	mkdirSync(join(root, "outputs", "kinase-screen"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", "kinase-screen", "report.md"), "# Kinase Screen\n\nFinding: CDK genes are enriched.\n");
	ensureWorkbenchChatSession({ workingDir: root }, {
		id: "fresh-hypothesis",
		projectId: "active-plans",
		title: "Fresh hypothesis",
	});
	return root;
}

test("buildWorkbenchState exposes Claude-style artifact folder rows", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.ok(state.artifactFolders.length >= state.projects.length);

		const workspaceUploads = state.artifactFolders.find((folder) =>
			folder.projectId === "workspace" &&
			folder.name === "User Uploads"
		);
		assert.match(workspaceUploads?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(workspaceUploads?.sortOrder, -1000);
		assert.equal(workspaceUploads?.isUserUploadsFolder, true);
		assert.equal(workspaceUploads?.isConversationFolder, false);
		assert.equal(workspaceUploads?.rootFrameId, undefined);

		const artifactFolder = state.artifactFolders.find((folder) =>
			folder.projectId === "workspace" &&
			folder.rootFrameId === "kinase-screen"
		);
		assert.equal(artifactFolder?.name, "Kinase Screen");
		assert.equal(artifactFolder?.isConversationFolder, true);
		assert.equal(artifactFolder?.isUserUploadsFolder, false);
		assert.equal(artifactFolder?.artifactCount, 1);
		assert.ok((artifactFolder?.updatedAtMs ?? 0) > 0);

		const chatFolder = state.artifactFolders.find((folder) =>
			folder.projectId === "active-plans" &&
			folder.rootFrameId === "fresh-hypothesis"
		);
		assert.equal(chatFolder?.name, "Fresh hypothesis");
		assert.equal(chatFolder?.artifactCount, 0);
		assert.equal(chatFolder?.isConversationFolder, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns artifact folders through state", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			artifactFolders: Array<{
				projectId: string;
				name: string;
				rootFrameId?: string;
				isConversationFolder: boolean;
				isUserUploadsFolder: boolean;
			}>;
		};
		assert.equal(payload.artifactFolders.some((folder) =>
			folder.projectId === "workspace" &&
			folder.name === "User Uploads" &&
			folder.isUserUploadsFolder
		), true);
		assert.equal(payload.artifactFolders.some((folder) =>
			folder.projectId === "workspace" &&
			folder.rootFrameId === "kinase-screen" &&
			folder.isConversationFolder
		), true);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
