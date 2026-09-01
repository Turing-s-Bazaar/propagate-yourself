import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { migratedWorkbenchDataPath } from "./data-root.js";

export type WorkbenchStoredProject = {
	id: string;
	name: string;
	description: string;
	agentContext: string;
	createdAt: string;
	updatedAt: string;
};

type StoredProjectsFile = {
	schema: "feynman.workbenchProjects.v1";
	projects: WorkbenchStoredProject[];
	updatedAt: string;
};

const PROJECTS_SCHEMA = "feynman.workbenchProjects.v1" as const;

function nowIso(): string {
	return new Date().toISOString();
}

function projectsPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "projects.json");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72) || "project";
}

function normalizeText(value: unknown, maxLength: number): string {
	return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeLongText(value: unknown, maxLength: number): string {
	return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function emptyFile(): StoredProjectsFile {
	return {
		schema: PROJECTS_SCHEMA,
		projects: [],
		updatedAt: nowIso(),
	};
}

function normalizeProject(value: unknown): WorkbenchStoredProject | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const id = normalizeText(record.id, 90);
	const name = normalizeText(record.name, 140);
	if (!id || !name) return undefined;
	const createdAt = typeof record.createdAt === "string" ? record.createdAt : nowIso();
	return {
		id,
		name,
		description: normalizeText(record.description, 240),
		agentContext: normalizeLongText(record.agentContext, 8_000),
		createdAt,
		updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
	};
}

function readProjectsFile(workingDir: string): StoredProjectsFile {
	const path = projectsPath(workingDir);
	if (!existsSync(path)) return emptyFile();
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredProjectsFile>;
		return {
			schema: PROJECTS_SCHEMA,
			projects: Array.isArray(parsed.projects)
				? parsed.projects.flatMap((project) => normalizeProject(project) ?? [])
				: [],
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
		};
	} catch {
		return emptyFile();
	}
}

function writeProjectsFile(workingDir: string, file: StoredProjectsFile): void {
	const path = projectsPath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}

function uniqueProjectId(projects: WorkbenchStoredProject[], name: string): string {
	const base = slugify(name);
	const existing = new Set(projects.map((project) => project.id));
	if (!existing.has(base)) return base;
	for (let index = 2; index < 100; index += 1) {
		const candidate = `${base}-${index}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${base}-${randomBytes(3).toString("hex")}`;
}

export function readWorkbenchProjects(workingDir: string): WorkbenchStoredProject[] {
	return readProjectsFile(workingDir).projects;
}

export function findWorkbenchProject(workingDir: string, projectId: string): WorkbenchStoredProject | undefined {
	return readWorkbenchProjects(workingDir).find((project) => project.id === projectId);
}

export function createWorkbenchProject(
	workingDir: string,
	input: {
		name: string;
		description?: string;
		agentContext?: string;
	},
): WorkbenchStoredProject {
	const file = readProjectsFile(workingDir);
	const name = normalizeText(input.name, 140);
	if (!name) throw new Error("Project name is required.");
	const timestamp = nowIso();
	const project: WorkbenchStoredProject = {
		id: uniqueProjectId(file.projects, name),
		name,
		description: normalizeText(input.description, 240),
		agentContext: normalizeLongText(input.agentContext, 8_000),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const nextFile: StoredProjectsFile = {
		schema: PROJECTS_SCHEMA,
		projects: [project, ...file.projects],
		updatedAt: timestamp,
	};
	writeProjectsFile(workingDir, nextFile);
	return project;
}
