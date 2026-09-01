import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkbenchState } from "../src/workbench/scan.js";
import { startWorkbenchServer } from "../src/workbench/server.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-routine-schedules-"));
	mkdirSync(join(root, "outputs", ".plans"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "outputs", ".plans", "state-space-models.md"), [
		"# State Space Models Watch",
		"",
		"Watch topic: New developments in state space models",
		"Check frequency: weekly",
		"Scheduling: BLOCKED - schedule_prompt not available",
		"Refresh prompt: /watch \"New developments in state space models\"",
		"",
		"Monitor new papers, code releases, benchmark deltas, and reproduction notes.",
		"",
	].join("\n"));
	writeFileSync(join(root, "outputs", "state-space-models-baseline.md"), [
		"# State Space Models Baseline",
		"",
		"Scheduling: BLOCKED - schedule_prompt not available",
		"",
		"Sources",
		"",
		"- https://example.com/state-space-models",
		"",
	].join("\n"));
	return root;
}

test("buildWorkbenchState exposes Claude-style routine schedule rows for watch plans", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		assert.equal(state.routineSchedules.length, 1);
		const schedule = state.routineSchedules[0];
		assert.match(schedule?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(schedule?.rootFrameId, "state-space-models");
		assert.equal(schedule?.ownerUserId, "local-workbench");
		assert.equal(schedule?.label, "New developments in state space models");
		assert.equal(schedule?.everyMinutes, 10080);
		assert.equal(schedule?.enabled, false);
		assert.equal(schedule?.pausedReason, "schedule_prompt not available");
		assert.ok((schedule?.nextDueMs ?? 0) > (schedule?.updatedAtMs ?? 0));
		assert.equal(schedule?.tickCount, 1);
		assert.equal(schedule?.missedTicks, 0);
		assert.ok((schedule?.lastFireAtMs ?? 0) > 0);
		assert.equal(schedule?.lastFireAt, schedule?.lastOkAt);
		assert.equal(schedule?.idleStreak, 1);
		assert.equal(schedule?.source, "watch-plan");
		assert.equal(schedule?.planPath, "outputs/.plans/state-space-models.md");
		assert.equal(schedule?.baselinePath, "outputs/state-space-models-baseline.md");

		const onTick = JSON.parse(schedule?.onTick ?? "{}") as {
			schema?: string;
			kind?: string;
			prompt?: string;
			planPath?: string;
			baselinePath?: string;
		};
		assert.equal(onTick.schema, "feynman.routineTick.v1");
		assert.equal(onTick.kind, "watch");
		assert.equal(onTick.prompt, "/watch \"New developments in state space models\"");
		assert.equal(onTick.planPath, "outputs/.plans/state-space-models.md");
		assert.equal(onTick.baselinePath, "outputs/state-space-models-baseline.md");

		const lastResults = JSON.parse(schedule?.lastResults ?? "{}") as { status?: string; baselinePath?: string };
		assert.equal(lastResults.status, "baseline-created");
		assert.equal(lastResults.baselinePath, "outputs/state-space-models-baseline.md");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server returns routine schedules through state", async () => {
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
			routineSchedules: Array<{
				rootFrameId: string;
				enabled: boolean;
				pausedReason?: string;
				onTick: string;
				planPath: string;
				baselinePath?: string;
			}>;
		};
		assert.equal(payload.routineSchedules.length, 1);
		assert.equal(payload.routineSchedules[0]?.rootFrameId, "state-space-models");
		assert.equal(payload.routineSchedules[0]?.enabled, false);
		assert.equal(payload.routineSchedules[0]?.pausedReason, "schedule_prompt not available");
		assert.match(payload.routineSchedules[0]?.onTick ?? "", /feynman\.routineTick\.v1/);
		assert.equal(payload.routineSchedules[0]?.planPath, "outputs/.plans/state-space-models.md");
		assert.equal(payload.routineSchedules[0]?.baselinePath, "outputs/state-space-models-baseline.md");
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
