import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export const OPEN_SCIENCE_SEED_FIXTURE_DIR = "fixtures/open-science-seeds";
export const OPEN_SCIENCE_SEED_WORKSPACE_DIR = "outputs/open-science-seeds";

export const OPEN_SCIENCE_SEED_WORKFLOWS = [
	"example_crispr_screen",
	"example_enzyme_engineering",
	"example_extremophile",
	"example_immunotherapy",
] as const;

export type OpenScienceSeedFixtureResult = {
	sourceRoot: string;
	targetRoot: string;
	sourceAvailable: boolean;
	workflowCount: number;
	fileCount: number;
	copiedFiles: number;
	skippedFiles: number;
};

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function walkFixtureFiles(root: string): string[] {
	const files: string[] = [];

	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const absPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absPath);
				continue;
			}
			if (entry.isFile()) files.push(absPath);
		}
	}

	if (existsSync(root)) walk(root);
	return files;
}

export function openScienceSeedFixtureSourceRoot(appRoot: string): string {
	return resolve(appRoot, OPEN_SCIENCE_SEED_FIXTURE_DIR);
}

export function openScienceSeedWorkspaceRoot(workingDir: string): string {
	return resolve(workingDir, OPEN_SCIENCE_SEED_WORKSPACE_DIR);
}

export function ensureOpenScienceSeedFixtures(input: { appRoot: string; workingDir: string }): OpenScienceSeedFixtureResult {
	const sourceRoot = openScienceSeedFixtureSourceRoot(input.appRoot);
	const targetRoot = openScienceSeedWorkspaceRoot(input.workingDir);
	if (!existsSync(sourceRoot)) {
		return {
			sourceRoot,
			targetRoot,
			sourceAvailable: false,
			workflowCount: 0,
			fileCount: 0,
			copiedFiles: 0,
			skippedFiles: 0,
		};
	}

	let copiedFiles = 0;
	let skippedFiles = 0;
	const sourceFiles = walkFixtureFiles(sourceRoot);
	const workflowCount = OPEN_SCIENCE_SEED_WORKFLOWS.filter((workflow) => existsSync(resolve(sourceRoot, workflow))).length;

	for (const sourceFile of sourceFiles) {
		const relPath = toPosixPath(relative(sourceRoot, sourceFile));
		const targetFile = resolve(targetRoot, relPath);
		if (existsSync(targetFile)) {
			skippedFiles += 1;
			continue;
		}
		mkdirSync(resolve(targetFile, ".."), { recursive: true });
		copyFileSync(sourceFile, targetFile);
		copiedFiles += 1;
	}

	return {
		sourceRoot,
		targetRoot,
		sourceAvailable: true,
		workflowCount,
		fileCount: sourceFiles.length,
		copiedFiles,
		skippedFiles,
	};
}
