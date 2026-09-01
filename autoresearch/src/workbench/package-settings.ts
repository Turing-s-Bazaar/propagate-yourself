import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type WorkbenchPackageAction = "disable" | "enable";

function readSettings(settingsPath: string): Record<string, unknown> {
	if (!existsSync(settingsPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function packageSource(entry: unknown): string | undefined {
	if (typeof entry === "string" && entry.trim()) return entry.trim();
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
	const source = (entry as Record<string, unknown>).source;
	return typeof source === "string" && source.trim() ? source.trim() : undefined;
}

export function updateWorkbenchPackageSettings(
	workingDir: string,
	action: WorkbenchPackageAction,
	sources: string[],
): Record<string, unknown> {
	const normalizedSources = [...new Set(sources.map((source) => source.trim()).filter(Boolean))];
	if (normalizedSources.length === 0) {
		throw new Error("Missing package source.");
	}

	const settingsPath = resolve(workingDir, ".feynman", "settings.json");
	const settings = readSettings(settingsPath);
	const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];
	const selected = new Set(normalizedSources);
	const existingSources = new Set(packages.map(packageSource).filter((source): source is string => Boolean(source)));

	if (action === "disable") {
		settings.packages = packages.filter((entry) => {
			const source = packageSource(entry);
			return !source || !selected.has(source);
		});
	} else {
		settings.packages = [
			...packages,
			...normalizedSources.filter((source) => !existingSources.has(source)),
		];
	}

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
	return settings;
}
