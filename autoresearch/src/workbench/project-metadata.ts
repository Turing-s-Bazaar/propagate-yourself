import { createHash } from "node:crypto";

import type { WorkbenchProject } from "./types.js";

export const LOCAL_PROJECT_USER_ID = "local-workbench";

export function stableWorkbenchUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function projectUploadFrameId(projectId: string): string {
	return stableWorkbenchUuid("feynman-frame", `${projectId}:uploads`);
}

export function buildWorkbenchProjectMetadata(
	projectId: string,
	options: {
		agentContext?: string;
		createdAt?: string;
		fallbackUpdatedAt?: string;
		updatedAt: string;
		updatedAtMs: number;
	},
): Pick<WorkbenchProject, "context" | "userId" | "uploadsFrameId" | "memoryEnabled" | "createdAt" | "createdAtMs"> {
	const createdAt = options.createdAt ?? options.fallbackUpdatedAt ?? options.updatedAt;
	const context = options.agentContext?.trim();
	return {
		...(context ? { context } : {}),
		userId: LOCAL_PROJECT_USER_ID,
		uploadsFrameId: projectUploadFrameId(projectId),
		memoryEnabled: false,
		createdAt,
		createdAtMs: Date.parse(createdAt) || options.updatedAtMs,
	};
}
