import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { submitWorkbenchChatMessage } from "../src/workbench/chat.js";
import { executeNotebookCell } from "../src/workbench/notebook-execution.js";
import { readArtifactSnapshotRecords } from "../src/workbench/artifact-snapshots.js";
import { buildWorkbenchState } from "../src/workbench/scan.js";
import { createWorkbenchProject } from "../src/workbench/projects.js";

function makeSnapshotWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-snapshots-"));
	mkdirSync(join(root, "outputs"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n");
	writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nbefore\n");
	return root;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

test("notebook execution persists changed artifact snapshots into version history", async () => {
	const root = makeSnapshotWorkspace();
	try {
		const beforeContent = readFileSync(join(root, "outputs", "science.md"), "utf8");
		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "science",
			projectId: "workspace",
			title: "Science",
			runSlug: "science",
			language: "bash",
			executionMode: "isolated",
			purpose: "verification",
			code: "printf '# Science\\n\\nafter notebook\\n' > outputs/science.md\nprintf 'outputs/science.md\\n'",
		});

		assert.equal(executed.status, "complete");
		assert.equal(executed.snapshotIds.length, 1);
		const snapshots = readArtifactSnapshotRecords(root);
		const snapshot = snapshots.find((record) => record.id === executed.snapshotIds[0]);
		assert.ok(snapshot, "expected notebook artifact snapshot record");
		assert.equal(snapshot?.artifactPath, "outputs/science.md");
		assert.equal(snapshot?.source, "notebook");
		assert.equal(snapshot?.producerExecutionId, `notebook:${executed.id}`);
		assert.equal(snapshot?.before.checksum, sha256(beforeContent));
		assert.notEqual(snapshot?.after.checksum, snapshot?.before.checksum);
		assert.ok(snapshot?.before.snapshotPath, "expected before content snapshot");
		assert.ok(snapshot?.after.snapshotPath, "expected after content snapshot");
		assert.match(readFileSync(snapshot!.after.snapshotPath!, "utf8"), /after notebook/);

		const state = buildWorkbenchState({ workingDir: root });
		const version = state.artifactVersions.find((item) =>
			item.artifactPath === "outputs/science.md" &&
			item.producerExecutionId === `notebook:${executed.id}`
		);
		assert.ok(version, "expected snapshot-backed notebook artifact version");
		assert.equal(version?.source, "notebook");
		assert.equal(version?.snapshotId, snapshot?.id);
		assert.equal(version?.previousChecksum, snapshot?.before.checksum);
		assert.equal(version?.checksum, snapshot?.after.checksum);
		assert.equal(version?.contentChanged, true);
		assert.match(version?.code ?? "", /after notebook/);

		const afterContentSnapshot = state.contentSnapshots.find((row) => row.hash === snapshot?.after.checksum);
		assert.equal(afterContentSnapshot?.artifactPath, "outputs/science.md");
		assert.equal(afterContentSnapshot?.snapshotId, snapshot?.id);
		assert.equal(afterContentSnapshot?.stateKind, "after");
		assert.equal(afterContentSnapshot?.sizeBytes, snapshot?.after.sizeBytes);
		assert.equal(afterContentSnapshot?.contentTruncated, false);
		assert.match(afterContentSnapshot?.content ?? "", /after notebook/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench state exposes Claude-style artifact dependency rows from version inputs", async () => {
	const root = makeSnapshotWorkspace();
	try {
		writeFileSync(join(root, "outputs", "source.md"), "# Source\n\ninput evidence\n");
		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "dependency",
			projectId: "workspace",
			title: "Dependency",
			runSlug: "dependency",
			language: "bash",
			executionMode: "isolated",
			purpose: "exploration",
			code: "cat outputs/source.md > outputs/result.md\nprintf 'outputs/result.md\\n'",
		});

		assert.equal(executed.status, "complete");
		const state = buildWorkbenchState({ workingDir: root });
		const resultVersion = state.artifactVersions.find((version) =>
			version.artifactPath === "outputs/result.md" &&
			version.producerExecutionId === `notebook:${executed.id}`
		);
		const sourceVersion = state.artifactVersions.find((version) => version.artifactPath === "outputs/source.md");
		assert.ok(resultVersion, "expected result version");
		assert.ok(sourceVersion, "expected source version");
		const dependency = state.artifactDependencies.find((row) =>
			row.artifactVersionId === resultVersion?.id &&
			row.dependsOnVersionId === sourceVersion?.id
		);
		assert.match(dependency?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(dependency?.referenceName, "outputs/source.md");
		assert.equal(dependency?.createdAt, resultVersion?.createdAt);
		assert.equal(dependency?.createdAtMs, resultVersion?.createdAtMs);

		const hostCall = state.hostCallLog.find((row) =>
			row.executionLogId === `notebook:${executed.id}` &&
			row.method === "artifact_path" &&
			row.argsJson === JSON.stringify(["outputs/source.md"])
		);
		assert.equal(typeof hostCall?.id, "number");
		assert.equal(hostCall?.seq, 0);
		assert.equal(hostCall?.derivable, true);
		assert.equal(hostCall?.bytes, 0);
		assert.equal(hostCall?.createdAt, executed.createdAt);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Pi chat turn snapshots changed artifacts even when the reply omits the path", async () => {
	const root = makeSnapshotWorkspace();
	try {
		const session = await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async () => {
				writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nafter chat\n");
				return { content: "Done." };
			},
		}, {
			id: "science",
			projectId: "workspace",
			title: "Science",
			message: "revise the artifact",
		});
		const assistant = session.messages.at(-1);
		assert.equal(assistant?.role, "assistant");

		const snapshots = readArtifactSnapshotRecords(root);
		const snapshot = snapshots.find((record) => record.producerExecutionId === `chat:science:${assistant?.id}`);
		assert.ok(snapshot, "expected chat artifact snapshot record");
		assert.equal(snapshot?.artifactPath, "outputs/science.md");
		assert.equal(snapshot?.source, "chat");
		assert.match(readFileSync(snapshot!.after.snapshotPath!, "utf8"), /after chat/);

		const state = buildWorkbenchState({ workingDir: root });
		const version = state.artifactVersions.find((item) =>
			item.artifactPath === "outputs/science.md" &&
			item.producerExecutionId === `chat:science:${assistant?.id}`
		);
		assert.ok(version, "expected snapshot-backed chat artifact version");
		assert.equal(version?.source, "chat");
		assert.equal(version?.snapshotPath, snapshot?.after.snapshotPath);
		assert.equal(version?.previousChecksum, snapshot?.before.checksum);
		assert.equal(version?.contentChanged, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("chat execution output paths attach artifacts to their run and project", async () => {
	const root = makeSnapshotWorkspace();
	try {
		const project = createWorkbenchProject(root, {
			name: "Biology Evidence Map",
			description: "Custom project for chat-generated artifacts.",
		});
		const session = await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async () => {
				writeFileSync(join(root, "outputs", "science.md"), "# Science\n\nchat-owned artifact\n");
				return { content: "Wrote the proof artifact." };
			},
		}, {
			id: "active-session",
			projectId: project.id,
			title: "Active Session",
			message: "write the project artifact",
		});
		assert.equal(session.messages.at(-1)?.role, "assistant");

		const state = buildWorkbenchState({ workingDir: root });
		const run = state.runs.find((item) => item.slug === "active-session");
		assert.ok(run, "expected chat run");
		assert.equal(run?.artifactCount, 1);
		assert.deepEqual(run?.artifactPaths, ["outputs/science.md"]);
		assert.deepEqual(run?.lastArtifactNames, ["science.md"]);

		const projectRow = state.projects.find((item) => item.id === project.id);
		assert.ok(projectRow, "expected custom project");
		assert.equal(projectRow?.artifactCount, 1);
		assert.deepEqual(projectRow?.artifactPaths, ["outputs/science.md"]);
		assert.deepEqual(projectRow?.runSlugs, ["active-session"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
