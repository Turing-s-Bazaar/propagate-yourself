import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncBundledAssets } from "../src/bootstrap/sync.js";

function createAppRoot(): string {
	const appRoot = mkdtempSync(join(tmpdir(), "feynman-app-"));
	mkdirSync(join(appRoot, ".feynman", "themes"), { recursive: true });
	mkdirSync(join(appRoot, ".feynman", "agents"), { recursive: true });
	writeFileSync(join(appRoot, ".feynman", "themes", "feynman.json"), '{"theme":"v1"}\n', "utf8");
	writeFileSync(join(appRoot, ".feynman", "agents", "researcher.md"), "# v1\n", "utf8");
	return appRoot;
}

test("syncBundledAssets copies missing bundled files", () => {
	const appRoot = createAppRoot();
	const home = mkdtempSync(join(tmpdir(), "feynman-home-"));
	process.env.FEYNMAN_HOME = home;
	const agentDir = join(home, "agent");
	mkdirSync(agentDir, { recursive: true });

	const result = syncBundledAssets(appRoot, agentDir);

	assert.deepEqual(result.copied.sort(), ["feynman.json", "researcher.md"]);
	assert.equal(readFileSync(join(agentDir, "themes", "feynman.json"), "utf8"), '{"theme":"v1"}\n');
	assert.equal(readFileSync(join(agentDir, "agents", "researcher.md"), "utf8"), "# v1\n");
});

test("syncBundledAssets preserves user-modified files and updates managed files", () => {
	const appRoot = createAppRoot();
	const home = mkdtempSync(join(tmpdir(), "feynman-home-"));
	process.env.FEYNMAN_HOME = home;
	const agentDir = join(home, "agent");
	mkdirSync(agentDir, { recursive: true });

	syncBundledAssets(appRoot, agentDir);

	writeFileSync(join(appRoot, ".feynman", "themes", "feynman.json"), '{"theme":"v2"}\n', "utf8");
	writeFileSync(join(appRoot, ".feynman", "agents", "researcher.md"), "# v2\n", "utf8");
	writeFileSync(join(agentDir, "agents", "researcher.md"), "# user-custom\n", "utf8");

	const result = syncBundledAssets(appRoot, agentDir);

	assert.deepEqual(result.updated, ["feynman.json"]);
	assert.deepEqual(result.skipped, ["researcher.md"]);
	assert.equal(readFileSync(join(agentDir, "themes", "feynman.json"), "utf8"), '{"theme":"v2"}\n');
	assert.equal(readFileSync(join(agentDir, "agents", "researcher.md"), "utf8"), "# user-custom\n");
});

test("syncBundledAssets removes deleted managed files but preserves user-modified stale files", () => {
	const appRoot = createAppRoot();
	const home = mkdtempSync(join(tmpdir(), "feynman-home-"));
	process.env.FEYNMAN_HOME = home;
	const agentDir = join(home, "agent");
	mkdirSync(agentDir, { recursive: true });

	mkdirSync(join(appRoot, "skills", "paper-eli5"), { recursive: true });
	writeFileSync(join(appRoot, "skills", "paper-eli5", "SKILL.md"), "# old skill\n", "utf8");
	syncBundledAssets(appRoot, agentDir);

	rmSync(join(appRoot, "skills", "paper-eli5"), { recursive: true, force: true });
	mkdirSync(join(appRoot, "skills", "eli5"), { recursive: true });
	writeFileSync(join(appRoot, "skills", "eli5", "SKILL.md"), "# new skill\n", "utf8");

	const firstResult = syncBundledAssets(appRoot, agentDir);
	assert.deepEqual(firstResult.copied, ["eli5/SKILL.md"]);
	assert.equal(existsSync(join(agentDir, "skills", "paper-eli5", "SKILL.md")), false);
	assert.equal(readFileSync(join(agentDir, "skills", "eli5", "SKILL.md"), "utf8"), "# new skill\n");

	mkdirSync(join(appRoot, "skills", "legacy"), { recursive: true });
	writeFileSync(join(appRoot, "skills", "legacy", "SKILL.md"), "# managed legacy\n", "utf8");
	syncBundledAssets(appRoot, agentDir);
	writeFileSync(join(agentDir, "skills", "legacy", "SKILL.md"), "# user legacy override\n", "utf8");
	rmSync(join(appRoot, "skills", "legacy"), { recursive: true, force: true });

	const secondResult = syncBundledAssets(appRoot, agentDir);
	assert.deepEqual(secondResult.skipped, ["legacy/SKILL.md"]);
	assert.equal(readFileSync(join(agentDir, "skills", "legacy", "SKILL.md"), "utf8"), "# user legacy override\n");
});

test("syncBundledAssets installs Feynman's Option+Enter newline binding without overriding user config", async () => {
	const appRoot = createAppRoot();
	const home = mkdtempSync(join(tmpdir(), "feynman-home-"));
	process.env.FEYNMAN_HOME = home;
	const agentDir = join(home, "agent");
	const bundledConfigDir = join(appRoot, ".feynman", "config");
	mkdirSync(bundledConfigDir, { recursive: true });
	writeFileSync(join(bundledConfigDir, "keybindings.json"), JSON.stringify({
		"tui.input.newLine": ["ctrl+j", "alt+enter"],
		"app.message.followUp": ["shift+enter"],
	}, null, 2) + "\n");

	const result = syncBundledAssets(appRoot, agentDir);
	const keybindingsPath = join(agentDir, "keybindings.json");
	const { KeybindingsManager } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js");
	const keybindings = KeybindingsManager.create(agentDir);

	assert.ok(result.copied.includes("keybindings.json"));
	assert.deepEqual(keybindings.getKeys("tui.input.newLine"), ["ctrl+j", "alt+enter"]);
	assert.deepEqual(keybindings.getKeys("app.message.followUp"), ["shift+enter"]);
	assert.equal(keybindings.matches("\u001b\r", "tui.input.newLine"), true);
	assert.equal(keybindings.matches("\u001b[13;3u", "tui.input.newLine"), true);
	assert.equal(keybindings.matches("\u001b\r", "app.message.followUp"), false);
	assert.equal(keybindings.matches("\u001b[13;2u", "app.message.followUp"), true);

	writeFileSync(keybindingsPath, '{"tui.input.newLine":["ctrl+j"]}\n');
	writeFileSync(join(bundledConfigDir, "keybindings.json"), '{"tui.input.newLine":["alt+enter"]}\n');
	const updateResult = syncBundledAssets(appRoot, agentDir);
	assert.ok(updateResult.skipped.includes("keybindings.json"));
	assert.equal(readFileSync(keybindingsPath, "utf8"), '{"tui.input.newLine":["ctrl+j"]}\n');
});
