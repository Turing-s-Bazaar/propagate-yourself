import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
	addWorkbenchChatAttachment,
	ensureWorkbenchChatSession,
	removeWorkbenchChatAttachment,
	submitWorkbenchChatMessage,
	updateWorkbenchChatSessionConfig,
} from "../src/workbench/chat.js";
import { attachStrictJsonlLineReader, buildWorkbenchRpcPrompt, handlePiJsonLine } from "../src/workbench/chat-runtime.js";
import { workbenchDataPath } from "../src/workbench/data-root.js";
import { executeNotebookCell, readNotebookExecutionRecords } from "../src/workbench/notebook-execution.js";
import { generateWorkbenchPlan, updateWorkbenchPlanAction, updateWorkbenchPlanStep } from "../src/workbench/plan.js";
import { buildWorkbenchState, readWorkbenchFile, readWorkbenchFileDownload } from "../src/workbench/scan.js";
import { parseWorkbenchPort, startWorkbenchServer } from "../src/workbench/server.js";
import { workbenchPiSessionId } from "../src/workbench/pi-session.js";

function makeWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-"));
	mkdirSync(join(root, "outputs", ".plans"), { recursive: true });
	mkdirSync(join(root, "outputs", ".drafts"), { recursive: true });
	mkdirSync(join(root, "papers"), { recursive: true });
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, ".feynman", "agents"), { recursive: true });
	mkdirSync(join(root, "skills", "literature-review"), { recursive: true });
	mkdirSync(join(root, "prompts"), { recursive: true });
	mkdirSync(join(root, "extensions"), { recursive: true });
	writeFileSync(join(root, "CHANGELOG.md"), [
		"# Changelog",
		"",
		"### 2026-06-30 08:30 PDT - scaling-laws",
		"",
		"- Verified: source and provenance files were checked.",
		"- Next: inspect the brief.",
		"",
	].join("\n"));
	writeFileSync(join(root, "outputs", ".plans", "scaling-laws.md"), "# Scaling Laws Plan\n");
	writeFileSync(join(root, "outputs", ".drafts", "scaling-laws-draft.md"), "# Scaling Laws Draft\n");
	writeFileSync(join(root, "outputs", "scaling-laws.md"), "# Scaling Laws Brief\n\nCited body.\n");
	writeFileSync(join(root, "outputs", "scaling-laws.provenance.md"), "# Scaling Laws Provenance\n");
	writeFileSync(join(root, "notes", "scaling-laws-verification.md"), "# Scaling Laws Verification\n");
	writeFileSync(join(root, "papers", "scaling-laws.pdf"), "%PDF fixture\n");
	writeFileSync(join(root, ".feynman", "agents", "researcher.md"), [
		"---",
		"name: researcher",
		"description: Gather primary evidence for a research question.",
		"---",
		"",
		"# Researcher",
		"",
		"Find source-backed evidence.",
		"",
	].join("\n"));
	writeFileSync(join(root, ".feynman", "agents", "verifier.md"), [
		"---",
		"name: verifier",
		"description: Verify claims against source artifacts.",
		"---",
		"",
		"# Verifier",
		"",
	].join("\n"));
	writeFileSync(join(root, "skills", "literature-review", "SKILL.md"), [
		"---",
		"name: literature-review",
		"description: Run a literature review using paper search and synthesis.",
		"---",
		"",
		"# Literature Review",
		"",
	].join("\n"));
	writeFileSync(join(root, "prompts", "lit.md"), [
		"---",
		"description: Survey papers on a research topic.",
		"---",
		"",
		"Find the literature for $ARGUMENTS.",
		"",
	].join("\n"));
	writeFileSync(join(root, "extensions", "research-tools.ts"), "export default function researchTools() {}\n");
	writeFileSync(join(root, ".feynman", "settings.json"), JSON.stringify({
		packages: ["npm:pi-web-access", "npm:pi-docparser"],
	}, null, 2));
	return root;
}

function makeReactAppRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "feynman-workbench-app-"));
	mkdirSync(join(root, "dist", "workbench-web", "assets"), { recursive: true });
	writeFileSync(join(root, "dist", "workbench-web", "index.html"), [
		"<!doctype html>",
		"<html>",
		"<head><title>Feynman Science</title></head>",
		"<body><div id=\"root\"></div><script type=\"module\" src=\"/app-shell/assets/app.js\"></script></body>",
		"</html>",
	].join(""));
	writeFileSync(join(root, "dist", "workbench-web", "assets", "app.js"), "console.log('react-shell');\n");
	return root;
}

function promptFixture(message: string) {
	return {
		workingDir: "/tmp/feynman",
		message,
		session: {
			id: "session-1",
			projectId: "workspace",
			title: "Workspace",
			createdAt: "2026-07-01T00:00:00.000Z",
			updatedAt: "2026-07-01T00:00:00.000Z",
			status: "complete" as const,
			config: {
				delegation: false,
				autoReview: false,
				memory: false,
				specialist: "None",
				compute: "local" as const,
			},
			piSession: {
				id: "feynman-workbench-session-1",
				status: "active" as const,
				messageCount: 0,
				userMessages: 0,
				assistantMessages: 0,
				toolResults: 0,
				toolCalls: 0,
				bashExecutions: 0,
				customMessages: 0,
				branchCount: 0,
				timeline: [],
				tools: [],
			},
			attachments: [],
			messages: [],
		},
	};
}

test("buildWorkbenchRpcPrompt preserves raw Pi command inputs", () => {
	assert.equal(buildWorkbenchRpcPrompt(promptFixture("/skill:literature-review transformers")), "/skill:literature-review transformers");
	assert.equal(buildWorkbenchRpcPrompt(promptFixture("!pwd")), "!pwd");

	const normal = buildWorkbenchRpcPrompt(promptFixture("read the artifacts"));
	assert.match(normal, /Workbench context for this message:/);
	assert.match(normal, /User message:\nread the artifacts/);
});

test("buildWorkbenchState groups research artifacts into runs", () => {
	const root = makeWorkspace();
	try {
		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const run = state.runs.find((item) => item.slug === "scaling-laws");

		assert.equal(state.version, "0.0.0-test");
		assert.equal(state.summary.artifactCount, 6);
		assert.equal(state.summary.projectCount, 5);
		assert.equal(state.summary.provenanceCount, 1);
		assert.equal(state.summary.verificationCount, 1);
		assert.equal(state.changelog.length, 1);
		assert.ok(state.projects.find((project) => project.id === "workspace"), "expected workspace project");
		assert.ok(state.projects.find((project) => project.id === "seed-workflows" && project.name === "Open Science Seed Workflows"), "expected seed workflows project");
		assert.ok(state.projects.find((project) => project.id === "verification"), "expected verification project");
		assert.ok(state.notebook.find((cell) => cell.path === "outputs/scaling-laws.md"), "expected output notebook cell");
		assert.ok(state.execution.find((record) => record.id === "artifact:outputs/scaling-laws.md"), "expected output execution record");
		assert.equal(state.execution.find((record) => record.id === "artifact:outputs/scaling-laws.provenance.md")?.status, "provenance");
		assert.equal(state.artifactVersions.length, 6);
		assert.ok(state.artifactVersions.every((version) => version.checksum?.length === 64), "expected file checksums for scanned artifact versions");
		assert.equal(state.artifactVersions.find((version) => version.artifactPath === "outputs/scaling-laws.md")?.contentType, "text/plain; charset=utf-8");
		assert.ok(state.compute.find((provider) => provider.id === "pi-subagents"), "expected Pi compute provider");
		assert.ok(state.environments.find((environment) => environment.id === "python"), "expected Python notebook environment");
		assert.ok(state.environments.find((environment) => environment.id === "bash"), "expected Bash notebook environment");
		assert.deepEqual(state.kernels, []);
		assert.ok(state.resources.find((group) => group.id === "specialists")?.resources.some((resource) => resource.name === "researcher"), "expected discovered specialist");
		assert.ok(state.resources.find((group) => group.id === "skills")?.resources.some((resource) => resource.name === "literature-review"), "expected discovered skill");
		assert.ok(state.resources.find((group) => group.id === "skills")?.resources.some((resource) => resource.command === "/lit" && resource.section === "Prompt templates"), "expected discovered prompt template");
		assert.ok(state.resources.find((group) => group.id === "connectors")?.resources.some((resource) => resource.name === "pi-web-access"), "expected discovered Pi package");
		assert.ok(state.resources.find((group) => group.id === "connectors")?.resources.some((resource) => resource.name === "research-tools"), "expected discovered extension");
		assert.ok(state.resources.find((group) => group.id === "compute")?.resources.some((resource) => resource.name === "Pi Research Agents"), "expected compute resource");
		assert.deepEqual(state.resources.map((group) => group.id), ["skills", "connectors", "specialists", "memory", "compute", "network", "permissions", "credentials", "storage", "usage", "general"]);
		assert.ok(state.resources.find((group) => group.id === "network")?.resources.some((resource) => resource.name === "Literature & citations"), "expected science network presets");
		assert.ok(state.resources.find((group) => group.id === "credentials")?.resources.some((resource) => resource.name === "Anthropic API"), "expected credential provider inventory");
		assert.ok(state.resources.find((group) => group.id === "usage")?.resources.some((resource) => resource.name === "Current workspace"), "expected local usage summary");
		assert.ok(state.resources.find((group) => group.id === "general")?.resources.some((resource) => resource.name === "Pi runtime"), "expected runtime diagnostics");
		assert.ok(state.resources.find((group) => group.id === "permissions")?.resources.some((resource) => resource.name === "Pi RPC chat"), "expected Pi RPC permission resource");
		assert.ok(state.resources.find((group) => group.id === "storage")?.resources.some((resource) => resource.name === "Research artifact roots"), "expected storage resource");
		assert.ok(state.resources.find((group) => group.id === "memory")?.resources.some((resource) => resource.name === "Lab notebook"), "expected memory resource");
		assert.ok(state.provenance.find((record) => record.path === "outputs/scaling-laws.provenance.md"), "expected provenance record");
		assert.ok(run, "expected scaling-laws run");
		assert.equal(run?.status, "verified");
		assert.equal(run?.hasPlan, true);
		assert.equal(run?.hasProvenance, true);
		assert.equal(run?.hasVerification, true);
		assert.equal(run?.notebookCellCount, 6);
		assert.equal(run?.primaryArtifact?.path, "outputs/scaling-laws.md");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchState links persisted Pi chat execution to artifacts", () => {
	const root = makeWorkspace();
	try {
		const sessionDir = workbenchDataPath(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(join(sessionDir, "scaling-laws.json"), `${JSON.stringify({
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			createdAt: "2026-06-30T08:30:00.000Z",
			updatedAt: "2026-06-30T08:31:00.000Z",
			status: "complete",
			attachments: [],
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "inspect outputs/scaling-laws.md",
					createdAt: "2026-06-30T08:30:01.000Z",
					status: "complete",
					toolEvents: [],
				},
				{
					id: "assistant-1",
					role: "assistant",
					content: "I checked outputs/scaling-laws.md and wrote outputs/scaling-laws.provenance.md",
					createdAt: "2026-06-30T08:30:02.000Z",
					status: "complete",
					toolEvents: [{
						id: "tool-1",
						label: "write",
						status: "complete",
						output: "outputs/scaling-laws.provenance.md",
					}],
				},
			],
			piSession: {
				id: "feynman-workbench-scaling-laws",
				status: "active",
				timeline: [{
					id: "00000002",
					type: "message",
					timestamp: "2026-06-30T08:30:02.000Z",
					label: "Assistant tool request",
					detail: "write outputs/scaling-laws.provenance.md",
					status: "running",
				}],
				tools: [],
			},
		})}\n`, "utf8");

		const state = buildWorkbenchState({ workingDir: root });
		const toolRecord = state.execution.find((record) => record.id === "tool:scaling-laws:tool-1");
		const piRecord = state.execution.find((record) => record.id === "pi:scaling-laws:00000002");

		assert.ok(toolRecord, "expected persisted chat tool execution record");
		assert.equal(toolRecord?.origin, "pi");
		assert.deepEqual(toolRecord?.outputPaths, ["outputs/scaling-laws.provenance.md"]);
		assert.ok(piRecord, "expected Pi timeline execution record");
		assert.equal(piRecord?.runSlug, "scaling-laws");
		assert.deepEqual(piRecord?.outputPaths, ["outputs/scaling-laws.provenance.md"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildWorkbenchState derives artifact producer records from Pi session JSONL", () => {
	const root = makeWorkspace();
	try {
		const piSessionId = workbenchPiSessionId("scaling-laws");
		const piSessionDir = join(root, ".feynman", "sessions");
		mkdirSync(piSessionDir, { recursive: true });
		const piSessionPath = join(piSessionDir, `2026-06-30T08-30-00-000Z_${piSessionId}.jsonl`);
		writeFileSync(piSessionPath, [
			JSON.stringify({ type: "session", version: 3, id: piSessionId, timestamp: "2026-06-30T08:30:00.000Z", cwd: root }),
			JSON.stringify({ type: "message", id: "00000001", parentId: null, timestamp: "2026-06-30T08:30:01.000Z", message: { role: "user", content: "write provenance", timestamp: 1 } }),
			JSON.stringify({
				type: "message",
				id: "00000002",
				parentId: "00000001",
				timestamp: "2026-06-30T08:30:02.000Z",
				message: {
					role: "assistant",
					content: [{
						type: "toolCall",
						id: "tool-code",
						name: "python",
						arguments: {
							language: "python",
							code: "from pathlib import Path\nPath('outputs/scaling-laws.provenance.md').write_text('# provenance')\n",
						},
					}],
					provider: "anthropic",
					model: "claude-test",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "toolUse",
					timestamp: 2,
				},
			}),
			JSON.stringify({
				type: "message",
				id: "00000003",
				parentId: "00000002",
				timestamp: "2026-06-30T08:30:03.000Z",
				message: {
					role: "toolResult",
					toolCallId: "tool-code",
					toolName: "python",
					content: [{ type: "text", text: "Saved outputs/scaling-laws.provenance.md" }],
					details: { environment: { python: "3.12" } },
					isError: false,
					timestamp: 3,
				},
			}),
		].join("\n") + "\n", "utf8");

		const sessionDir = workbenchDataPath(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(join(sessionDir, "scaling-laws.json"), `${JSON.stringify({
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			createdAt: "2026-06-30T08:30:00.000Z",
			updatedAt: "2026-06-30T08:31:00.000Z",
			status: "complete",
			attachments: [],
			messages: [],
			piSession: {
				id: piSessionId,
				status: "active",
				path: piSessionPath,
				timeline: [],
				tools: [],
			},
		})}\n`, "utf8");

		const state = buildWorkbenchState({ workingDir: root });
		const record = state.execution.find((item) => item.id === "pi-session:scaling-laws:tool-code");

		assert.ok(record, "expected Pi session producer record");
		assert.equal(record?.origin, "pi");
		assert.equal(record?.language, "python");
		assert.match(record?.code ?? "", /scaling-laws\.provenance\.md/);
		assert.match(record?.details ?? "", /3\.12/);
		assert.deepEqual(record?.outputPaths, ["outputs/scaling-laws.provenance.md"]);
		assert.equal(record?.messages?.length, 2);
		assert.match(record?.messages?.[0]?.content ?? "", /write_text/);
		assert.match(record?.messages?.[1]?.content ?? "", /Saved outputs/);
		const version = state.artifactVersions.find((item) => item.artifactPath === "outputs/scaling-laws.provenance.md");
		assert.ok(version, "expected Pi-linked artifact version");
		assert.equal(version?.source, "pi");
		assert.equal(version?.producerExecutionId, "pi-session:scaling-laws:tool-code");
		assert.match(version?.code ?? "", /write_text/);
		assert.match(version?.environmentDetails ?? "", /3\.12/);
		assert.equal(version?.messages.length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("notebook execution persists as replayable execution and verification state", async () => {
	const root = makeWorkspace();
	try {
		const executed = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			runSlug: "scaling-laws",
			taskSummary: "Verify the scaling-law evidence path",
			language: "bash",
			purpose: "verification",
			code: "printf 'checked outputs/scaling-laws.md\\n'",
		});
		assert.equal(executed.status, "complete");
		assert.equal(executed.purpose, "verification");
		assert.equal(executed.executionMode, "session");
		assert.match(executed.kernelId ?? "", /^session:scaling-laws:bash$/);
		assert.match(executed.stdout, /checked outputs\/scaling-laws\.md/);
		assert.deepEqual(readNotebookExecutionRecords(root).map((record) => record.id), [executed.id]);

		const state = buildWorkbenchState({ workingDir: root });
		const record = state.execution.find((item) => item.id === `notebook:${executed.id}`);
		const check = state.checks.find((item) => item.executionId === `notebook:${executed.id}`);
		assert.ok(record, "expected notebook execution record");
		assert.equal(record?.kind, "verification");
		assert.equal(record?.status, "verified");
		assert.equal(record?.language, "bash");
		assert.match(record?.messages?.[1]?.content ?? "", /checked outputs/);
		assert.ok(check, "expected structured verification check");
		assert.equal(check?.status, "pass");
		assert.equal(check?.runSlug, "scaling-laws");
		assert.deepEqual(check?.evidencePaths, ["outputs/scaling-laws.md"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("notebook Python session kernel persists variables across cells", async () => {
	const root = makeWorkspace();
	try {
		const first = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "kernel-memory",
			projectId: "workspace",
			title: "Kernel memory",
			language: "python",
			executionMode: "session",
			purpose: "exploration",
			code: "answer = 41",
		});
		const second = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "kernel-memory",
			projectId: "workspace",
			title: "Kernel memory",
			language: "python",
			executionMode: "session",
			purpose: "exploration",
			code: "print(answer + 1)",
		});
		assert.equal(first.status, "complete");
		assert.equal(second.status, "complete");
		assert.equal(first.executionMode, "session");
		assert.equal(second.executionMode, "session");
		assert.equal(first.kernelId, second.kernelId);
		assert.equal(second.stdout.trim(), "42");

		const records = readNotebookExecutionRecords(root).filter((record) => record.sessionId === "kernel-memory");
		assert.equal(records.length, 2);
		assert.equal(records[0]?.kernelId, "session:kernel-memory:python");
		assert.equal(records[1]?.kernelId, "session:kernel-memory:python");

		const state = buildWorkbenchState({ workingDir: root });
		const rendered = state.execution.find((item) => item.id === `notebook:${second.id}`);
		assert.match(rendered?.environment ?? "", /session kernel/);
		assert.match(rendered?.details ?? "", /session:kernel-memory:python/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("notebook Bash session kernel persists env and cwd across cells", async () => {
	const root = makeWorkspace();
	try {
		const first = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "shell-memory",
			projectId: "workspace",
			title: "Shell memory",
			language: "bash",
			executionMode: "session",
			purpose: "exploration",
			code: "export FEYNMAN_CELL_VALUE=hello\ncd outputs",
		});
		const second = await executeNotebookCell({
			workingDir: root,
			timeoutMs: 5_000,
		}, {
			sessionId: "shell-memory",
			projectId: "workspace",
			title: "Shell memory",
			language: "bash",
			executionMode: "session",
			purpose: "exploration",
			code: "printf '%s %s\\n' \"$FEYNMAN_CELL_VALUE\" \"$(basename \"$PWD\")\"",
		});
		assert.equal(first.status, "complete");
		assert.equal(second.status, "complete");
		assert.equal(first.kernelId, second.kernelId);
		assert.equal(second.stdout.trim(), "hello outputs");
		assert.equal(second.executionMode, "session");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readWorkbenchFile previews workspace research files only", () => {
	const root = makeWorkspace();
	try {
		writeFileSync(join(root, "outputs", "sample.fasta"), ">seq1\nACGTACGT\n");
		writeFileSync(join(root, "outputs", "model.pdb"), "ATOM      1  CA  GLY A   1      11.104  13.207   8.356  1.00 20.00           C\n");
		writeFileSync(join(root, "outputs", "model.cif"), "loop_\n_atom_site.group_PDB\n_atom_site.label_atom_id\n_atom_site.type_symbol\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\nATOM CA C 1.0 2.0 3.0\n");
		writeFileSync(join(root, "outputs", "compound.sdf"), "demo\n  feynman\n\n  2  1  0  0  0  0            999 V2000\n    0.0    0.0    0.0 C   0  0\n    1.2    0.0    0.0 O   0  0\n  1  2  1  0\nM  END\n$$$$\n");
		writeFileSync(join(root, "outputs", "variants.vcf"), "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t10\t.\tA\tG\t60\tPASS\t.\n");
		writeFileSync(join(root, "outputs", "design_report.html"), "<!doctype html><title>CRISPR design report</title><h1>CRISPR design report</h1>");
		writeFileSync(join(root, "outputs", "matrix.tsv"), "gene\tcount\nA\t1\n");
		writeFileSync(join(root, "outputs", "tree.nwk"), "((A:0.1,B:0.2)90:0.3,C:0.4);\n");
		writeFileSync(join(root, "outputs", "array.npy"), Buffer.from("\x93NUMPY\x01\x00", "binary"));
		const preview = readWorkbenchFile(root, "outputs/scaling-laws.md");
		assert.equal(preview.path, "outputs/scaling-laws.md");
		assert.match(preview.content, /Scaling Laws Brief/);
		assert.match(readWorkbenchFile(root, "outputs/sample.fasta").content, /seq1/);
		assert.match(readWorkbenchFile(root, "outputs/model.pdb").content, /^ATOM/);
		assert.match(readWorkbenchFile(root, "outputs/model.cif").content, /_atom_site/);
		assert.match(readWorkbenchFile(root, "outputs/compound.sdf").content, /V2000/);
		assert.match(readWorkbenchFile(root, "outputs/variants.vcf").content, /chr1/);
		assert.equal(readWorkbenchFileDownload(root, "outputs/variants.vcf").contentType, "text/x-vcf; charset=utf-8");
		assert.match(readWorkbenchFile(root, "outputs/design_report.html").content, /CRISPR design report/);
		assert.equal(readWorkbenchFileDownload(root, "outputs/design_report.html").contentType, "text/html; charset=utf-8");
		assert.match(readWorkbenchFile(root, "outputs/matrix.tsv").content, /gene\tcount/);
		assert.match(readWorkbenchFile(root, "outputs/tree.nwk").content, /\(A:0\.1,B:0\.2\)/);
		assert.equal(readWorkbenchFileDownload(root, "outputs/tree.nwk").contentType, "text/x-newick; charset=utf-8");
		assert.equal(readWorkbenchFileDownload(root, "outputs/array.npy").contentType, "application/x-npy");
		assert.throws(
			() => readWorkbenchFile(root, "outputs/array.npy"),
			/not a text preview/,
		);
		assert.throws(
			() => readWorkbenchFile(root, "../secret.txt"),
			/limited to research artifacts|outside the workspace/,
		);
		assert.throws(
			() => readWorkbenchFile(root, "outputs/../package.json"),
			/limited to research artifacts|Artifact not found/,
		);
		assert.throws(
			() => readWorkbenchFile(root, "papers/scaling-laws.pdf"),
			/not a text preview/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readWorkbenchFileDownload returns safe artifact bytes", () => {
	const root = makeWorkspace();
	try {
		const download = readWorkbenchFileDownload(root, "papers/scaling-laws.pdf");
		assert.equal(download.name, "scaling-laws.pdf");
		assert.equal(download.contentType, "application/pdf");
		assert.match(download.buffer.toString("utf8"), /PDF fixture/);
		assert.throws(() => readWorkbenchFileDownload(root, "../secret.txt"), /outside the workspace/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("parseWorkbenchPort validates explicit ports", () => {
	assert.equal(parseWorkbenchPort(undefined), undefined);
	assert.equal(parseWorkbenchPort("0"), 0);
	assert.equal(parseWorkbenchPort("6174"), 6174);
	assert.throws(() => parseWorkbenchPort("nope"), /positive integer/);
	assert.throws(() => parseWorkbenchPort("70000"), /between 0 and 65535/);
});

test("workbench chat persists user and assistant turns", async () => {
	const root = makeWorkspace();
	try {
		const created = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
		});
		assert.equal(created.messages.length, 0);
		assert.equal(created.config.delegation, false);
		assert.equal(created.config.autoReview, false);
		assert.equal(created.config.memory, false);
		assert.equal(created.config.specialist, "None");

		const configured = updateWorkbenchChatSessionConfig({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			config: { autoReview: false, compute: "off", specialist: "Reviewer" },
		});
		assert.equal(configured.config.autoReview, false);
		assert.equal(configured.config.compute, "off");

		const session = await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async (request) => ({
				content: `Answer for ${request.message} with ${request.session.config.specialist}`,
				toolEvents: [{ id: "tool-1", label: "fixture executor", status: "complete", output: request.session.title }],
			}),
		}, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			message: "what should I verify next?",
		});

		assert.equal(session.status, "complete");
		assert.equal(session.messages.length, 2);
		assert.equal(session.messages[0]?.role, "user");
		assert.match(session.messages[1]?.content ?? "", /what should I verify next/);
		assert.match(session.messages[1]?.content ?? "", /Reviewer/);
		assert.equal(session.messages[1]?.toolEvents[0]?.label, "fixture executor");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat normalizes legacy all-on session defaults", () => {
	const root = makeWorkspace();
	try {
		const sessionDir = workbenchDataPath(root, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(join(sessionDir, "scaling-laws.json"), `${JSON.stringify({
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			createdAt: "2026-06-30T08:30:00.000Z",
			updatedAt: "2026-06-30T08:30:00.000Z",
			status: "complete",
			config: {
				delegation: true,
				autoReview: true,
				memory: true,
				specialist: "Default",
				compute: "local",
			},
			piSession: { id: "scaling-laws", status: "pending" },
			attachments: [],
			messages: [],
		})}\n`, "utf8");

		const session = ensureWorkbenchChatSession({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
		});
		assert.equal(session.config.delegation, false);
		assert.equal(session.config.autoReview, false);
		assert.equal(session.config.memory, false);
		assert.equal(session.config.specialist, "None");
		assert.equal(session.config.compute, "local");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat binds to a stable Pi session file", async () => {
	const root = makeWorkspace();
	try {
		const sessionDir = join(root, ".feynman", "sessions");
		mkdirSync(sessionDir, { recursive: true });
		const piSessionId = workbenchPiSessionId("scaling-laws");
		const piSessionPath = join(sessionDir, `2026-06-30T08-30-00-000Z_${piSessionId}.jsonl`);
		writeFileSync(piSessionPath, [
			JSON.stringify({ type: "session", version: 3, id: piSessionId, timestamp: "2026-06-30T08:30:00.000Z", cwd: root }),
			JSON.stringify({ type: "message", id: "00000001", parentId: null, timestamp: "2026-06-30T08:30:01.000Z", message: { role: "user", content: "inspect evidence", timestamp: 1 } }),
			JSON.stringify({
				type: "message",
				id: "00000002",
				parentId: "00000001",
				timestamp: "2026-06-30T08:30:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "outputs/scaling-laws.md" } }],
					provider: "anthropic",
					model: "claude-test",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "toolUse",
					timestamp: 2,
				},
			}),
			JSON.stringify({
				type: "message",
				id: "00000003",
				parentId: "00000002",
				timestamp: "2026-06-30T08:30:03.000Z",
				message: { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "brief" }], isError: false, timestamp: 3 },
			}),
			JSON.stringify({ type: "thinking_level_change", id: "00000004", parentId: "00000003", timestamp: "2026-06-30T08:30:04.000Z", thinkingLevel: "high" }),
		].join("\n") + "\n", "utf8");

		const session = await submitWorkbenchChatMessage({
			workingDir: root,
			sessionDir,
			executor: async (request) => {
				assert.equal(request.session.piSession.id, piSessionId);
				return { content: "bound to pi" };
			},
		}, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			message: "continue inside this session",
		});

		assert.equal(session.piSession.status, "active");
		assert.equal(session.piSession.id, piSessionId);
		assert.equal(session.piSession.path, piSessionPath);
		assert.equal(session.piSession.messageCount, 3);
		assert.equal(session.piSession.userMessages, 1);
		assert.equal(session.piSession.assistantMessages, 1);
		assert.equal(session.piSession.toolResults, 1);
		assert.equal(session.piSession.toolCalls, 1);
		assert.equal(session.piSession.model, "anthropic/claude-test");
		assert.equal(session.piSession.thinkingLevel, "high");
		assert.equal(session.piSession.timeline.at(-1)?.label, "Thinking level");
		assert.match(session.piSession.timeline.find((entry) => entry.label === "read result")?.detail ?? "", /brief/);
		assert.equal(session.piSession.tools[0]?.name, "read");
		assert.equal(session.piSession.tools[0]?.count, 1);
		assert.equal(session.piSession.tools[0]?.lastStatus, "complete");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench chat stores attachments as Pi-visible session context", async () => {
	const root = makeWorkspace();
	try {
		const withAttachment = addWorkbenchChatAttachment({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			name: "notes.txt",
			contentType: "text/plain",
			data: Buffer.from("alpha beta gamma\nthis should be prompt-visible", "utf8"),
		});
		const attachment = withAttachment.attachments[0];
		assert.ok(attachment, "expected stored attachment");
		assert.equal(attachment.name, "notes.txt");
		assert.match(attachment.previewText ?? "", /alpha beta gamma/);
		assert.equal(readFileSync(attachment.storagePath, "utf8"), "alpha beta gamma\nthis should be prompt-visible");

		const session = await submitWorkbenchChatMessage({
			workingDir: root,
			executor: async (request) => {
				assert.equal(request.session.attachments.length, 1);
				assert.equal(request.session.attachments[0]?.name, "notes.txt");
				assert.match(request.session.attachments[0]?.previewText ?? "", /prompt-visible/);
				return { content: `saw ${request.session.attachments[0]?.name}` };
			},
		}, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			message: "use the uploaded notes",
		});
		assert.match(session.messages.at(-1)?.content ?? "", /notes.txt/);

		const removed = removeWorkbenchChatAttachment({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			attachmentId: attachment.id,
		});
		assert.equal(removed.attachments.length, 0);
		assert.equal(existsSync(attachment.storagePath), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench generated plans persist as scannable execution artifacts", () => {
	const root = makeWorkspace();
	try {
		const generated = generateWorkbenchPlan({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			taskSummary: "Verify the scaling-law evidence path",
		});
		assert.equal(generated.plan.status, "awaiting_approval");
		assert.equal(generated.plan.steps.length, 5);
		assert.equal(generated.plan.artifactPath, "outputs/.plans/scaling-laws.workbench-plan.json");
		assert.equal(existsSync(join(root, generated.plan.artifactPath)), true);
		assert.equal(generated.session.messages.at(-1)?.toolEvents[0]?.label, "generate_plan");

		const approved = updateWorkbenchPlanAction({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			action: "approve",
		});
		assert.equal(approved.plan.status, "approved");

		const firstStep = approved.plan.steps[0]?.title ?? "";
		const updated = updateWorkbenchPlanStep({ workingDir: root }, {
			id: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			stepTitle: firstStep,
			status: "complete",
			notes: "checked",
		});
		assert.equal(updated.plan.steps[0]?.status, "complete");
		assert.equal(updated.plan.steps[0]?.notes, "checked");
		assert.equal(updated.session.messages.at(-1)?.toolEvents[0]?.label, "update_step_status");

		const state = buildWorkbenchState({ workingDir: root, version: "0.0.0-test" });
		const scanned = state.plans.find((plan) => plan.sessionId === "scaling-laws");
		const run = state.runs.find((item) => item.slug === "scaling-laws");
		assert.ok(scanned, "expected generated plan in workbench state");
		assert.equal(scanned?.steps[0]?.status, "complete");
		assert.equal(scanned?.artifactPath, "outputs/.plans/scaling-laws.workbench-plan.json");
		assert.equal(run?.hasPlan, true);
		assert.equal(state.artifacts.some((artifact) => artifact.path === "outputs/.plans/scaling-laws.workbench-plan.json"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench Pi JSON stream events map to transcript text, queues, and tools", async () => {
	const toolEvents = new Map();
	const updates: Array<{ content?: string; status?: string; toolEvents?: Array<{ label: string; status: string; toolName?: string; input?: string; output?: string }> }> = [];
	await handlePiJsonLine(JSON.stringify({
		type: "message_update",
		message: { role: "assistant", content: [{ type: "text", text: "partial answer" }] },
	}), toolEvents, (update) => {
		updates.push(update);
	});
	await handlePiJsonLine(JSON.stringify({
		type: "tool_execution_start",
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "outputs/scaling-laws.md" },
	}), toolEvents, (update) => {
		updates.push(update);
	});
	await handlePiJsonLine(JSON.stringify({
		type: "tool_execution_end",
		toolCallId: "tool-1",
		toolName: "read",
		result: { content: [{ type: "text", text: "read output" }] },
		isError: false,
	}), toolEvents, (update) => {
		updates.push(update);
	});
	await handlePiJsonLine(JSON.stringify({
		type: "tool_execution_start",
		toolCallId: "tool-2",
		toolName: "bash",
		args: {
			human_description: "Running ESMFold on IS621 sequence",
			command: "python scripts/fold.py",
			background: true,
		},
	}), toolEvents, (update) => {
		updates.push(update);
	});
	await handlePiJsonLine(JSON.stringify({
		type: "queue_update",
		steering: 1,
		followUp: 0,
	}), toolEvents, (update) => {
		updates.push(update);
	});
	await handlePiJsonLine(JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "stopped answer" }], stopReason: "aborted" },
	}), toolEvents, (update) => {
		updates.push(update);
	});

	assert.equal(updates[0]?.content, "partial answer");
	assert.equal(updates[1]?.toolEvents?.[0]?.label, "read");
	assert.equal(updates[1]?.toolEvents?.[0]?.status, "running");
	assert.equal(updates[1]?.toolEvents?.[0]?.toolName, "read");
	assert.match(updates[1]?.toolEvents?.[0]?.input ?? "", /scaling-laws/);
	assert.equal(updates[2]?.toolEvents?.[0]?.status, "complete");
	assert.equal(updates[2]?.toolEvents?.[0]?.output, "read output");
	assert.equal(updates[3]?.toolEvents?.at(-1)?.label, "Running ESMFold on IS621 sequence");
	assert.equal(updates[3]?.toolEvents?.at(-1)?.toolName, "bash");
	assert.match(updates[3]?.toolEvents?.at(-1)?.input ?? "", /background/);
	assert.equal(updates[4]?.toolEvents?.at(-1)?.label, "Pi message queue");
	assert.equal(updates[5]?.status, "stopped");
	assert.equal(updates[5]?.content, "stopped answer");
});

test("workbench Pi RPC reader uses LF-only JSONL framing", async () => {
	const stream = new PassThrough();
	const lines: string[] = [];
	const stop = attachStrictJsonlLineReader(stream, (line) => {
		lines.push(line);
	});
	const ended = new Promise<void>((resolve) => {
		stream.on("end", resolve);
	});

	stream.end([
		JSON.stringify({ text: "alpha\u2028beta" }),
		`${JSON.stringify({ text: "gamma" })}\r`,
		JSON.stringify({ text: "tail" }),
	].join("\n"));

	await ended;
	stop();
	assert.deepEqual(lines, [
		JSON.stringify({ text: "alpha\u2028beta" }),
		JSON.stringify({ text: "gamma" }),
		JSON.stringify({ text: "tail" }),
	]);
});

test("workbench server requires the launch token for app and API routes", async () => {
	const root = makeWorkspace();
	const appRoot = makeReactAppRoot();
	const handle = await startWorkbenchServer({
		appRoot,
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const unauthorized = await fetch(handle.url);
		assert.equal(unauthorized.status, 401);

		const authorized = await fetch(handle.openUrl);
		assert.equal(authorized.status, 200);
		assert.match(await authorized.text(), /\/app-shell\/assets\/app\.js/);
		const cookie = authorized.headers.get("set-cookie");
		assert.ok(cookie?.includes("feynman_workbench=test-token"));

		const projectRoute = await fetch(`${handle.url}projects/workspace`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(projectRoute.status, 200);
		assert.match(await projectRoute.text(), /\/app-shell\/assets\/app\.js/);

		const asset = await fetch(`${handle.url}app-shell/assets/app.js`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(asset.status, 200);
		assert.match(await asset.text(), /react-shell/);

		const state = await fetch(`${handle.url}api/state`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(state.status, 200);
		const payload = await state.json() as { summary: { artifactCount: number } };
		assert.equal(payload.summary.artifactCount, 6);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
		rmSync(appRoot, { recursive: true, force: true });
	}
});

test("workbench server accepts chat messages through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async (request) => ({ content: `Workbench reply: ${request.message}` }),
	});
	try {
		const response = await fetch(`${handle.url}api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				message: "summarize this frame",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as { session: { messages: Array<{ role: string; content: string }> } };
		assert.equal(payload.session.messages.length, 2);
		assert.equal(payload.session.messages[0]?.role, "user");
		assert.match(payload.session.messages[1]?.content ?? "", /Workbench reply/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server streams chat messages through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
		promptExecutor: async (request) => {
			writeFileSync(join(root, "outputs", "stream-artifact.md"), "# Stream Artifact\n\nowned by the active chat run\n");
			return {
				content: `Streamed reply: ${request.message}`,
				toolEvents: [{ id: "tool-1", label: "fixture stream", status: "complete", output: "stream output" }],
			};
		},
	});
	try {
		const response = await fetch(`${handle.url}api/chat/message/stream`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				message: "stream this frame",
			}),
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
		const text = await response.text();
		assert.match(text, /event: session/);
		assert.match(text, /event: delta/);
		assert.match(text, /event: tool/);
		assert.match(text, /event: done/);
		assert.match(text, /Streamed reply/);
		assert.match(text, /fixture stream/);
		const doneFrame = text.split("\n\n").find((frame) => frame.startsWith("event: done\n"));
		assert.ok(doneFrame, "expected final stream frame");
		const doneLine = doneFrame?.split("\n").find((line) => line.startsWith("data: "));
		const donePayload = JSON.parse(doneLine!.slice(6)) as {
			state: {
				artifacts: Array<{ path: string }>;
				projects: Array<{ id: string; artifactCount: number; artifactPaths: string[] }>;
				runs: Array<{ slug: string; artifactCount: number; artifactPaths: string[] }>;
			};
		};
		assert.equal(donePayload.state.artifacts.some((artifact) => artifact.path === "outputs/stream-artifact.md"), true);
		const streamRun = donePayload.state.runs.find((run) => run.slug === "scaling-laws");
		assert.ok(streamRun?.artifactCount && streamRun.artifactCount >= 1);
		assert.ok(streamRun?.artifactPaths.includes("outputs/stream-artifact.md"));
		const workspaceProject = donePayload.state.projects.find((project) => project.id === "workspace");
		assert.ok(workspaceProject?.artifactPaths.includes("outputs/stream-artifact.md"));

		const sessionResponse = await fetch(`${handle.url}api/chat/sessions`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		const payload = await sessionResponse.json() as { sessions: Array<{ id: string; messages: Array<{ content: string; status: string }> }> };
		const session = payload.sessions.find((item) => item.id === "scaling-laws");
		assert.equal(session?.messages.at(-1)?.status, "complete");
		assert.match(session?.messages.at(-1)?.content ?? "", /Streamed reply/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server mutates generated plans through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const headers = {
			"content-type": "application/json",
			cookie: "feynman_workbench=test-token",
		};
		const baseBody = {
			sessionId: "scaling-laws",
			projectId: "workspace",
			title: "Scaling laws",
			runSlug: "scaling-laws",
		};
		const generated = await fetch(`${handle.url}api/chat/plan/generate`, {
			method: "POST",
			headers,
			body: JSON.stringify(baseBody),
		});
		assert.equal(generated.status, 200);
		const generatedPayload = await generated.json() as {
			plan: { artifactPath: string; status: string; steps: Array<{ title: string }> };
			state: { plans: Array<{ sessionId: string }> };
		};
		assert.equal(generatedPayload.plan.status, "awaiting_approval");
		assert.equal(generatedPayload.plan.artifactPath, "outputs/.plans/scaling-laws.workbench-plan.json");
		assert.equal(generatedPayload.state.plans.some((plan) => plan.sessionId === "scaling-laws"), true);

		const approved = await fetch(`${handle.url}api/chat/plan/action`, {
			method: "POST",
			headers,
			body: JSON.stringify({ ...baseBody, action: "approve" }),
		});
		assert.equal(approved.status, 200);
		const approvedPayload = await approved.json() as { plan: { status: string; steps: Array<{ title: string }> } };
		assert.equal(approvedPayload.plan.status, "approved");

		const completed = await fetch(`${handle.url}api/chat/plan/step`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				...baseBody,
				stepTitle: approvedPayload.plan.steps[0]?.title,
				status: "complete",
				notes: "done through API",
			}),
		});
		assert.equal(completed.status, 200);
		const completedPayload = await completed.json() as { plan: { steps: Array<{ status: string; notes?: string }> } };
		assert.equal(completedPayload.plan.steps[0]?.status, "complete");
		assert.equal(completedPayload.plan.steps[0]?.notes, "done through API");
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server executes notebook cells through the authenticated API", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const response = await fetch(`${handle.url}api/notebook/execute`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				runSlug: "scaling-laws",
				language: "bash",
				purpose: "verification",
				code: "printf 'api check outputs/scaling-laws.md\\n'",
			}),
		});
		assert.equal(response.status, 200);
		const payload = await response.json() as {
			execution: { status: string; stdout: string };
			state: { execution: Array<{ id: string; kind: string }>; checks: Array<{ status: string; evidencePaths: string[] }> };
		};
		assert.equal(payload.execution.status, "complete");
		assert.match(payload.execution.stdout, /api check/);
		assert.ok(payload.state.execution.some((record) => record.id.startsWith("notebook:") && record.kind === "verification"));
		assert.ok(payload.state.checks.some((check) => check.status === "pass" && check.evidencePaths.includes("outputs/scaling-laws.md")));
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("workbench server persists session config and downloads artifacts", async () => {
	const root = makeWorkspace();
	const handle = await startWorkbenchServer({
		workingDir: root,
		version: "0.0.0-test",
		host: "127.0.0.1",
		port: 0,
		token: "test-token",
	});
	try {
		const configResponse = await fetch(`${handle.url}api/chat/config`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "feynman_workbench=test-token",
			},
			body: JSON.stringify({
				sessionId: "scaling-laws",
				projectId: "workspace",
				title: "Scaling laws",
				config: { delegation: false, specialist: "Verifier" },
			}),
		});
		assert.equal(configResponse.status, 200);
		const configPayload = await configResponse.json() as { session: { config: { delegation: boolean; specialist: string } } };
		assert.equal(configPayload.session.config.delegation, false);
		assert.equal(configPayload.session.config.specialist, "Verifier");

		const download = await fetch(`${handle.url}api/file/download?path=${encodeURIComponent("papers/scaling-laws.pdf")}`, {
			headers: { cookie: "feynman_workbench=test-token" },
		});
		assert.equal(download.status, 200);
		assert.equal(download.headers.get("content-type"), "application/pdf");
		assert.ok((download.headers.get("content-disposition") ?? "").includes("scaling-laws.pdf"));
		assert.match(await download.text(), /PDF fixture/);
	} finally {
		await handle.close();
		rmSync(root, { recursive: true, force: true });
	}
});
