import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
	WorkbenchArtifact,
	WorkbenchExecutionRecord,
	WorkbenchResearchClaim,
	WorkbenchResearchClaimStatus,
	WorkbenchVerificationCheck,
} from "./types.js";

const MAX_CLAIMS = 180;
const MAX_CLAIM_BYTES = 160_000;
const MAX_CLAIM_TEXT = 500;
const CLAIM_MARKER = /^(?:[-*]\s+|\d+[.)]\s+|#{1,6}\s+)?(?:claim|finding|conclusion|verified)\s*:\s+(.+)$/i;

type ClaimCandidate = {
	claim: string;
	source: WorkbenchResearchClaim["source"];
	sourceTitle: string;
	sourcePath?: string;
	runSlug?: string;
	sessionId?: string;
	executionId?: string;
	evidencePaths: string[];
	checkIds: string[];
	createdAt: string;
	createdAtMs: number;
	status: WorkbenchResearchClaimStatus;
	detail?: string;
};

function normalizeClaimText(value: string): string {
	return value
		.replace(/\s+/g, " ")
		.replace(/^["'`]+|["'`.;:]+$/g, "")
		.trim()
		.slice(0, MAX_CLAIM_TEXT);
}

export function claimIdForText(claim: string, scope = "workspace"): string {
	const normalized = normalizeClaimText(claim).toLowerCase();
	const hash = createHash("sha256").update(`${scope}:${normalized}`).digest("hex").slice(0, 16);
	return `claim:${hash}`;
}

function claimScope(runSlug?: string, sessionId?: string): string {
	return runSlug || sessionId || "workspace";
}

function statusForChecks(checks: WorkbenchVerificationCheck[]): WorkbenchResearchClaimStatus {
	if (checks.some((check) => check.status === "fail")) return "failed";
	if (checks.some((check) => check.status === "pass")) return "verified";
	return "unverified";
}

function claimStatusRank(status: WorkbenchResearchClaimStatus): number {
	if (status === "failed") return 3;
	if (status === "verified") return 2;
	return 1;
}

function mergeCandidate(target: WorkbenchResearchClaim, candidate: ClaimCandidate): WorkbenchResearchClaim {
	const status = claimStatusRank(candidate.status) > claimStatusRank(target.status) ? candidate.status : target.status;
	return {
		...target,
		status,
		evidencePaths: [...new Set([...target.evidencePaths, ...candidate.evidencePaths])].sort((a, b) => a.localeCompare(b)),
		checkIds: [...new Set([...target.checkIds, ...candidate.checkIds])].sort((a, b) => a.localeCompare(b)),
		createdAt: target.createdAtMs <= candidate.createdAtMs ? target.createdAt : candidate.createdAt,
		createdAtMs: Math.min(target.createdAtMs, candidate.createdAtMs),
		detail: target.detail || candidate.detail,
	};
}

function candidateToClaim(candidate: ClaimCandidate): WorkbenchResearchClaim {
	const id = claimIdForText(candidate.claim, claimScope(candidate.runSlug, candidate.sessionId));
	return {
		id,
		claim: normalizeClaimText(candidate.claim),
		status: candidate.status,
		source: candidate.source,
		sourceTitle: candidate.sourceTitle,
		...(candidate.sourcePath ? { sourcePath: candidate.sourcePath } : {}),
		...(candidate.runSlug ? { runSlug: candidate.runSlug } : {}),
		...(candidate.sessionId ? { sessionId: candidate.sessionId } : {}),
		...(candidate.executionId ? { executionId: candidate.executionId } : {}),
		evidencePaths: [...new Set(candidate.evidencePaths)].sort((a, b) => a.localeCompare(b)),
		checkIds: [...new Set(candidate.checkIds)].sort((a, b) => a.localeCompare(b)),
		createdAt: candidate.createdAt,
		createdAtMs: candidate.createdAtMs,
		...(candidate.detail ? { detail: candidate.detail } : {}),
	};
}

function candidateFromCheck(check: WorkbenchVerificationCheck): ClaimCandidate {
	return {
		claim: check.claim,
		source: "verification",
		sourceTitle: check.title,
		...(check.runSlug ? { runSlug: check.runSlug } : {}),
		...(check.sessionId ? { sessionId: check.sessionId } : {}),
		...(check.executionId ? { executionId: check.executionId } : {}),
		evidencePaths: check.evidencePaths,
		checkIds: [check.id],
		createdAt: check.createdAt,
		createdAtMs: check.createdAtMs,
		status: statusForChecks([check]),
		detail: check.detail,
	};
}

function artifactCanContainClaims(artifact: WorkbenchArtifact): boolean {
	if (artifact.extension !== ".md" && artifact.extension !== ".txt") return false;
	return ["draft", "note", "output", "paper", "provenance", "verification"].includes(artifact.category);
}

function candidatesFromArtifact(workingDir: string, artifact: WorkbenchArtifact): ClaimCandidate[] {
	if (!artifactCanContainClaims(artifact)) return [];
	let content = "";
	try {
		content = readFileSync(resolve(workingDir, artifact.path), "utf8").slice(0, MAX_CLAIM_BYTES);
	} catch {
		return [];
	}
	return content
		.split(/\r?\n/)
		.map((line) => normalizeClaimText(line.match(CLAIM_MARKER)?.[1] ?? ""))
		.filter(Boolean)
		.slice(0, 12)
		.map((claim) => ({
			claim,
			source: "artifact" as const,
			sourceTitle: artifact.title,
			sourcePath: artifact.path,
			runSlug: artifact.slug,
			evidencePaths: [artifact.path],
			checkIds: [],
			createdAt: artifact.updatedAt,
			createdAtMs: artifact.updatedAtMs,
			status: "unverified" as const,
			detail: `Claim marker extracted from ${artifact.path}.`,
		}));
}

function candidatesFromExecution(record: WorkbenchExecutionRecord): ClaimCandidate[] {
	if (record.kind !== "verification" || !record.title) return [];
	const claim = normalizeClaimText(record.title.replace(/^Verification check:\s*/i, ""));
	if (!claim) return [];
	return [{
		claim,
		source: "execution",
		sourceTitle: record.title,
		...(record.runSlug ? { runSlug: record.runSlug } : {}),
		...(record.sessionId ? { sessionId: record.sessionId } : {}),
		executionId: record.id,
		evidencePaths: [...new Set([...(record.inputPaths ?? []), ...(record.outputPaths ?? [])])],
		checkIds: [],
		createdAt: record.createdAt,
		createdAtMs: record.createdAtMs,
		status: record.status === "complete" || record.status === "verified" ? "verified" : record.status === "error" || record.status === "stopped" ? "failed" : "unverified",
		detail: record.detail,
	}];
}

export function buildWorkbenchClaims(options: {
	workingDir: string;
	artifacts: WorkbenchArtifact[];
	checks: WorkbenchVerificationCheck[];
	execution: WorkbenchExecutionRecord[];
}): WorkbenchResearchClaim[] {
	const candidates = [
		...options.checks.map(candidateFromCheck),
		...options.execution.flatMap(candidatesFromExecution),
		...options.artifacts.flatMap((artifact) => candidatesFromArtifact(options.workingDir, artifact)),
	];
	const claims = new Map<string, WorkbenchResearchClaim>();
	for (const candidate of candidates) {
		const normalized = normalizeClaimText(candidate.claim);
		if (!normalized) continue;
		const claim = candidateToClaim({ ...candidate, claim: normalized });
		const existing = claims.get(claim.id);
		claims.set(claim.id, existing ? mergeCandidate(existing, candidate) : claim);
	}
	return [...claims.values()]
		.sort((a, b) => b.createdAtMs - a.createdAtMs || a.claim.localeCompare(b.claim))
		.slice(0, MAX_CLAIMS);
}
