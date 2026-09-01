import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPiCommandResourceGroup, mergePiCommandResourceGroup, normalizePiCommands } from "../src/workbench/pi-commands.js";
import type { WorkbenchResourceGroup } from "../src/workbench/types.js";

test("Pi command discovery normalizes live RPC commands into resources", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-command-resources-"));
	try {
		const commands = normalizePiCommands({
			commands: [
				{
					name: "skill:literature-review",
					description: "Review literature",
					source: "skill",
					sourceInfo: {
						path: join(root, "skills", "literature-review", "SKILL.md"),
						source: "@companion-ai/feynman-research",
						scope: "project",
						origin: "package",
						baseDir: join(root, "skills"),
					},
				},
				{
					name: "fix-tests",
					description: "Fix tests",
					source: "prompt",
					location: "project",
					path: join(root, "prompts", "fix-tests.md"),
				},
				{
					name: "",
					source: "extension",
				},
			],
		});
		assert.deepEqual(commands.map((command) => command.command), ["/fix-tests", "/skill:literature-review"]);
		assert.deepEqual(commands[1]?.sourceInfo, {
			path: join(root, "skills", "literature-review", "SKILL.md"),
			source: "@companion-ai/feynman-research",
			scope: "project",
			origin: "package",
			baseDir: join(root, "skills"),
		});

		const group = buildPiCommandResourceGroup(root, commands);
		assert.equal(group.id, "commands");
		assert.equal(group.resources.length, 2);
		assert.equal(group.resources[0]?.source, "Pi prompt command");
		assert.equal(group.resources[0]?.path, "prompts/fix-tests.md");
		assert.equal(group.resources[1]?.source, "Pi skill command");
		assert.equal(group.resources[1]?.path, "skills/literature-review/SKILL.md");
		assert.equal(group.resources[1]?.detail, "project / package / @companion-ai/feynman-research");
		assert.deepEqual(group.resources[1]?.tags, [
			"live",
			"skill",
			"project",
			"package",
			"@companion-ai/feynman-research",
		]);

		const baseGroups: WorkbenchResourceGroup[] = [
			{ id: "specialists", title: "Specialists", description: "", resources: [] },
			{ id: "skills", title: "Skills", description: "", resources: [] },
			{ id: "connectors", title: "Connectors", description: "", resources: [] },
		];
		const merged = mergePiCommandResourceGroup(baseGroups, group);
		assert.deepEqual(merged.map((item) => item.id), ["specialists", "skills", "commands", "connectors"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
