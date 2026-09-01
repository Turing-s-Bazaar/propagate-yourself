import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { WorkbenchRoutineSchedule } from "./types.js";

const LOCAL_USER_ID = "local-workbench";
const DEFAULT_EVERY_MINUTES = 10_080;
const MAX_PLAN_BYTES = 128_000;

function stableUuid(namespace: string, value: string): string {
	const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampFromMs(ms: number): { iso: string; ms: number } {
	const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
	return { iso: new Date(safeMs).toISOString(), ms: safeMs };
}

function readText(path: string): string {
	const buffer = readFileSync(path);
	return buffer.byteLength > MAX_PLAN_BYTES
		? buffer.subarray(0, MAX_PLAN_BYTES).toString("utf8")
		: buffer.toString("utf8");
}

function slugFromPlanPath(path: string): string {
	return basename(path, ".md").replace(/\.workbench-plan$/, "") || "watch";
}

function titleCaseSlug(slug: string): string {
	const text = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	return text ? text.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Research Watch";
}

function heading(text: string): string | undefined {
	return text.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
}

function lineValue(text: string, label: string): string | undefined {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const value = text.match(new RegExp(`^${escaped}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim();
	if (!value) return undefined;
	const first = value[0];
	const last = value[value.length - 1];
	return (first === last && (first === "\"" || first === "'")) ? value.slice(1, -1) : value;
}

function compact(value: string, max = 240): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

function everyMinutesFromText(text: string): number {
	const frequency = lineValue(text, "Check frequency") ?? lineValue(text, "Frequency") ?? "";
	const normalized = frequency.toLowerCase();
	const every = normalized.match(/every\s+(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)/);
	if (every) {
		const count = Number(every[1]);
		const unit = every[2] ?? "weeks";
		if (Number.isFinite(count) && count > 0) {
			if (unit.startsWith("minute")) return count;
			if (unit.startsWith("hour")) return count * 60;
			if (unit.startsWith("day")) return count * 1_440;
			if (unit.startsWith("week")) return count * 10_080;
			if (unit.startsWith("month")) return count * 43_200;
		}
	}
	if (/\bhourly\b/.test(normalized)) return 60;
	if (/\bdaily\b/.test(normalized)) return 1_440;
	if (/\bweekly\b/.test(normalized)) return 10_080;
	if (/\bmonthly\b/.test(normalized)) return 43_200;
	return DEFAULT_EVERY_MINUTES;
}

function isWatchPlan(text: string, slug: string, baselineExists: boolean): boolean {
	const lower = text.toLowerCase();
	if (!lower.includes("scheduling:")) return false;
	if (lower.includes("schedule_prompt")) return true;
	if (baselineExists && lower.includes("watch")) return true;
	return slug.includes("watch");
}

function scheduleEnabled(text: string): boolean {
	const scheduling = lineValue(text, "Scheduling")?.toLowerCase() ?? "";
	if (!scheduling || scheduling.includes("blocked") || scheduling.includes("unavailable")) return false;
	return scheduling.includes("active") || scheduling.includes("enabled") || scheduling.includes("scheduled");
}

function pausedReason(text: string, enabled: boolean): string | undefined {
	if (enabled) return undefined;
	const scheduling = lineValue(text, "Scheduling");
	if (scheduling) return compact(scheduling.replace(/^blocked\s*-\s*/i, ""));
	return "scheduling tool not available";
}

function buildSchedule(workingDir: string, planPath: string): WorkbenchRoutineSchedule | undefined {
	const text = readText(planPath);
	const slug = slugFromPlanPath(planPath);
	const baselinePath = `outputs/${slug}-baseline.md`;
	const absBaselinePath = resolve(workingDir, baselinePath);
	const baselineExists = existsSync(absBaselinePath);
	if (!isWatchPlan(text, slug, baselineExists)) return undefined;

	const planStat = statSync(planPath);
	const baselineStat = baselineExists ? statSync(absBaselinePath) : undefined;
	const created = timestampFromMs(planStat.birthtimeMs || planStat.ctimeMs || planStat.mtimeMs);
	const updatedMs = Math.max(planStat.mtimeMs || 0, baselineStat?.mtimeMs || 0);
	const updated = timestampFromMs(updatedMs || planStat.mtimeMs);
	const everyMinutes = everyMinutesFromText(text);
	const enabled = scheduleEnabled(text);
	const nextDue = timestampFromMs(updated.ms + everyMinutes * 60_000);
	const lastOk = baselineStat ? timestampFromMs(baselineStat.mtimeMs || baselineStat.ctimeMs || baselineStat.birthtimeMs) : undefined;
	const topic = lineValue(text, "Watch topic") ?? lineValue(text, "Topic") ?? heading(text) ?? titleCaseSlug(slug);
	const label = compact(topic, 120);
	const prompt = lineValue(text, "Refresh prompt") ?? `/watch "${topic}"`;
	const onTick = {
		schema: "feynman.routineTick.v1",
		kind: "watch",
		prompt,
		planPath: `outputs/.plans/${basename(planPath)}`,
		...(baselineExists ? { baselinePath } : {}),
	};
	const lastResults = {
		schema: "feynman.routineResults.v1",
		status: baselineExists ? "baseline-created" : "plan-created",
		planPath: onTick.planPath,
		...(baselineExists ? { baselinePath } : {}),
	};
	return {
		id: stableUuid("feynman-routine-schedule", slug),
		rootFrameId: slug,
		ownerUserId: LOCAL_USER_ID,
		label,
		onTick: JSON.stringify(onTick),
		everyMinutes,
		enabled,
		...(pausedReason(text, enabled) ? { pausedReason: pausedReason(text, enabled) } : {}),
		nextDue: nextDue.iso,
		nextDueMs: nextDue.ms,
		tickCount: baselineExists ? 1 : 0,
		missedTicks: 0,
		...(lastOk ? { lastFireAt: lastOk.iso, lastFireAtMs: lastOk.ms, lastOkAt: lastOk.iso, lastOkAtMs: lastOk.ms } : {}),
		idleStreak: enabled ? 0 : 1,
		lastResults: JSON.stringify(lastResults),
		createdAt: created.iso,
		createdAtMs: created.ms,
		updatedAt: updated.iso,
		updatedAtMs: updated.ms,
		source: "watch-plan",
		planPath: onTick.planPath,
		...(baselineExists ? { baselinePath } : {}),
	};
}

export function buildWorkbenchRoutineSchedules(workingDir: string): WorkbenchRoutineSchedule[] {
	const plansDir = resolve(workingDir, "outputs", ".plans");
	if (!existsSync(plansDir)) return [];
	return readdirSync(plansDir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => buildSchedule(workingDir, resolve(plansDir, entry.name)))
		.filter((item): item is WorkbenchRoutineSchedule => Boolean(item))
		.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.rootFrameId.localeCompare(b.rootFrameId));
}
