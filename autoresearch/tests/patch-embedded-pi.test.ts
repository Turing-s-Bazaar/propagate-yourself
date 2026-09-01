import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

test("embedded Pi patch covers nested release-bundle copies before artifact verification", () => {
	const source = readFileSync(resolve("scripts", "patch-embedded-pi.mjs"), "utf8");

	assert.match(source, /patchPiInteractiveUpdateNoticeSource/);
	assert.match(
		source,
		/const nestedAgentLoopPaths = resolveNestedPiFiles\(piPackageRoot, "pi-agent-core"/,
	);
	assert.match(
		source,
		/const workspaceNestedAgentLoopPaths = resolveWorkspaceNestedPiFiles\(/,
	);
	assert.match(source, /const nestedTuiPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(
		source,
		/const nestedTuiMainScreenPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/,
	);
	assert.match(
		source,
		/const workspaceNestedTuiPaths = resolveWorkspaceNestedPiFiles\(workspaceRoot, "pi-tui"/,
	);
	assert.match(source, /const workspaceNestedTuiMainScreenPaths = resolveWorkspaceNestedPiFiles\(/);
	assert.match(source, /const nestedEditorPaths = resolveNestedPiFiles\(piPackageRoot, "pi-tui"/);
	assert.match(source, /const workspaceNestedEditorPaths = workspaceNestedTuiPaths\.map/);
	assert.match(
		source,
		/\[\s*agentLoopPath,\s*\.\.\.nestedAgentLoopPaths,\s*workspaceAgentLoopPath,\s*\.\.\.workspaceNestedAgentLoopPaths,/,
	);
	assert.match(
		source,
		/\[\s*tuiPath,\s*tuiMainScreenPath,\s*\.\.\.nestedTuiPaths,\s*\.\.\.nestedTuiMainScreenPaths,\s*workspaceTuiPath,\s*workspaceTuiMainScreenPath,\s*\.\.\.workspaceNestedTuiPaths,\s*\.\.\.workspaceNestedTuiMainScreenPaths,/,
	);
	assert.match(
		source,
		/patchFilesIfPresent\(\s*\[interactiveModePath, workspaceInteractiveModePath\],\s*patchPiInteractiveUpdateNoticeSource,/,
	);
	assert.match(
		source,
		/\[\s*editorPath,\s*\.\.\.nestedEditorPaths,\s*workspaceEditorPath,\s*\.\.\.workspaceNestedEditorPaths,/,
	);
});
