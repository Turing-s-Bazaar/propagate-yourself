import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listWorkbenchCloudExportTargets } from "./cloud-export-targets.js";
import { migratedWorkbenchDataPath } from "./data-root.js";
import { readWorkbenchSettings } from "./settings-store.js";
import { readWorkbenchFileDownload } from "./scan.js";
import type { WorkbenchCloudExportRecord, WorkbenchCloudExportTarget } from "./types.js";

type CloudExportInput = {
	artifactPath: string;
	credentialId: string;
	destinationPath?: string;
};

type ParsedTarget =
	| { type: "gcs"; baseUri: string }
	| { type: "local"; root: string }
	| { type: "s3"; baseUri: string };

function nowIso(): string {
	return new Date().toISOString();
}

function toPosixPath(value: string): string {
	return value.replace(/\\/g, "/");
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/g, "");
}

function exportLogPath(workingDir: string): string {
	return migratedWorkbenchDataPath(workingDir, "cloud-exports.jsonl");
}

function sanitizeDestinationPath(destinationPath: string | undefined, fallbackName: string): string {
	const rawPath = (destinationPath?.trim() || fallbackName).replace(/\\/g, "/");
	const path = rawPath.endsWith("/") ? `${rawPath}${fallbackName}` : rawPath;
	const cleaned = path.replace(/^\/+/, "");
	const parts = cleaned.split("/").filter(Boolean);
	if (!parts.length) return fallbackName;
	if (parts.some((part) => part === "." || part === "..")) {
		throw new Error("Destination path cannot contain . or .. segments.");
	}
	return parts.join("/");
}

function parseTarget(target: string, provider: WorkbenchCloudExportTarget["provider"]): ParsedTarget {
	const value = target.trim();
	if (!value) throw new Error("Cloud export target environment value is empty.");
	if (value.startsWith("file://")) return { type: "local", root: fileURLToPath(value) };
	if (provider === "local" && isAbsolute(value)) return { type: "local", root: value };
	if (value.startsWith("s3://")) return { type: "s3", baseUri: trimTrailingSlash(value) };
	if (value.startsWith("gs://")) return { type: "gcs", baseUri: trimTrailingSlash(value) };
	throw new Error("Cloud export target must be file://, an absolute local path, s3://, or gs://.");
}

function assertInside(root: string, targetPath: string): void {
	const relPath = toPosixPath(relative(root, targetPath));
	if (relPath.startsWith("../") || relPath === ".." || relPath.split("/").includes("..")) {
		throw new Error("Destination path escaped the export target.");
	}
}

function runCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(new Error(`${command} exited with ${code ?? "unknown"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
		});
	});
}

function writeExportRecord(workingDir: string, record: WorkbenchCloudExportRecord): void {
	const path = exportLogPath(workingDir);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function exportWorkbenchArtifactToCloud(
	workingDir: string,
	input: CloudExportInput,
): Promise<WorkbenchCloudExportRecord> {
	const file = readWorkbenchFileDownload(workingDir, input.artifactPath);
	const target = listWorkbenchCloudExportTargets(workingDir).find((item) => item.id === input.credentialId);
	if (!target) throw new Error("Cloud export credential not found.");
	const credential = readWorkbenchSettings(workingDir).credentialRefs.find((item) => item.id === target.id);
	if (!credential) throw new Error("Cloud export credential record not found.");
	const rawTarget = process.env[target.envVar]?.trim();
	if (!rawTarget) throw new Error(`Cloud export target env var ${target.envVar} is not set.`);
	const parsed = parseTarget(rawTarget, target.provider);
	const destinationPath = sanitizeDestinationPath(input.destinationPath, file.name);
	let exportedTarget = "";
	try {
		if (parsed.type === "local") {
			const root = resolve(parsed.root);
			const outputPath = resolve(root, destinationPath);
			assertInside(root, outputPath);
			mkdirSync(dirname(outputPath), { recursive: true });
			copyFileSync(resolve(workingDir, file.path), outputPath);
			exportedTarget = `file://${outputPath}`;
		} else if (parsed.type === "s3") {
			exportedTarget = `${parsed.baseUri}/${destinationPath}`;
			await runCommand("aws", ["s3", "cp", resolve(workingDir, file.path), exportedTarget]);
		} else {
			exportedTarget = `${parsed.baseUri}/${destinationPath}`;
			try {
				await runCommand("gcloud", ["storage", "cp", resolve(workingDir, file.path), exportedTarget]);
			} catch (error) {
				if (error instanceof Error && error.message.includes("ENOENT")) {
					await runCommand("gsutil", ["cp", resolve(workingDir, file.path), exportedTarget]);
				} else {
					throw error;
				}
			}
		}
		const record: WorkbenchCloudExportRecord = {
			id: randomUUID(),
			artifactPath: file.path,
			artifactName: file.name,
			credentialId: credential.id,
			credentialName: credential.name,
			provider: target.provider,
			destinationPath,
			target: exportedTarget,
			status: "complete",
			sizeBytes: file.sizeBytes,
			createdAt: nowIso(),
		};
		writeExportRecord(workingDir, record);
		return record;
	} catch (error) {
		const record: WorkbenchCloudExportRecord = {
			id: randomUUID(),
			artifactPath: file.path,
			artifactName: file.name,
			credentialId: credential.id,
			credentialName: credential.name,
			provider: target.provider,
			destinationPath,
			target: exportedTarget || target.detail,
			status: "error",
			sizeBytes: file.sizeBytes,
			createdAt: nowIso(),
			error: error instanceof Error ? error.message : String(error),
		};
		writeExportRecord(workingDir, record);
		throw error;
	}
}
