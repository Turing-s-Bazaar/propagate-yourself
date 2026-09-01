import { createHash } from "node:crypto";

import type { WorkbenchChatMessage, WorkbenchChatSession, WorkbenchToolEvent } from "./chat.js";
import type {
	WorkbenchComputeJobRecord,
	WorkbenchFrameEvent,
	WorkbenchFrameReadCursor,
	WorkbenchGeneratedPlan,
	WorkbenchNotificationStatus,
	WorkbenchQueuedUserMessage,
	WorkbenchSessionActivityItem,
	WorkbenchSessionNotification,
	WorkbenchSessionSeenMark,
} from "./types.js";

const MAX_ACTIVITY_ITEMS = 180;
const MAX_TEXT_CHARS = 280;

type BuildSessionActivityInput = {
	sessions: WorkbenchChatSession[];
	plans: WorkbenchGeneratedPlan[];
	computeJobs: WorkbenchComputeJobRecord[];
	frameReadCursors: WorkbenchFrameReadCursor[];
};

export type WorkbenchSessionActivityState = {
	events: WorkbenchFrameEvent[];
	notifications: WorkbenchSessionNotification[];
	queuedUserMessages: WorkbenchQueuedUserMessage[];
	sessionSeenMarks: WorkbenchSessionSeenMark[];
	sessionActivity: WorkbenchSessionActivityItem[];
};

function hashId(prefix: string, parts: Array<number | string | undefined>): string {
	const hash = createHash("sha256")
		.update(parts.filter((part) => part !== undefined).join("\n"))
		.digest("hex")
		.slice(0, 16);
	return `${prefix}:${hash}`;
}

function timestampMs(value: string | undefined): number {
	if (!value) return 0;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : 0;
}

function compactText(value: string | undefined, fallback: string): string {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (!text) return fallback;
	return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1).trimEnd()}...` : text;
}

function statusFromChat(status: WorkbenchChatMessage["status"] | WorkbenchToolEvent["status"]): WorkbenchNotificationStatus {
	if (status === "error") return "failed";
	if (status === "stopped") return "stopped";
	if (status === "queued") return "queued";
	if (status === "running") return "running";
	return "complete";
}

function statusFromCompute(status: WorkbenchComputeJobRecord["status"]): WorkbenchNotificationStatus {
	if (status === "error") return "failed";
	if (status === "stopped") return "stopped";
	if (status === "queued") return "queued";
	if (status === "running") return "running";
	return "complete";
}

function statusFromPlan(status: WorkbenchGeneratedPlan["status"]): WorkbenchNotificationStatus {
	if (status === "awaiting_approval" || status === "rejected") return "needs_input";
	if (status === "running") return "running";
	return "complete";
}

function queuedState(message: WorkbenchChatMessage): WorkbenchQueuedUserMessage["state"] | undefined {
	const queuedByStatus = message.status === "queued";
	const queuedByTool = message.toolEvents.some((event) => /queued/i.test(`${event.label}\n${event.output ?? ""}`));
	if (!queuedByStatus && !queuedByTool) return undefined;
	if (message.status === "error") return "failed";
	if (message.status === "complete") return "resolved";
	return "queued";
}

function seenMarks(cursors: WorkbenchFrameReadCursor[]): WorkbenchSessionSeenMark[] {
	return cursors.map((cursor) => ({
		rootFrameId: cursor.rootFrameId,
		seenToken: `${cursor.messageId ?? cursor.messageIndex}:${cursor.messageCount}`,
		...(cursor.messageId ? { messageId: cursor.messageId } : {}),
		messageIndex: cursor.messageIndex,
		messageCount: cursor.messageCount,
		...(cursor.projectId ? { projectId: cursor.projectId } : {}),
		...(cursor.runSlug ? { runSlug: cursor.runSlug } : {}),
		updatedAt: cursor.updatedAt,
		updatedAtMs: cursor.updatedAtMs,
	}));
}

function readStateFor(
	cursor: WorkbenchFrameReadCursor | undefined,
	index: number | undefined,
	createdAtMs: number,
	messageCount: number | undefined,
): { readAt?: string; readAtMs?: number; seenToken?: string; unread: boolean } {
	if (!cursor) return { unread: true };
	const seenToken = `${cursor.messageId ?? cursor.messageIndex}:${cursor.messageCount}`;
	const readAtMs = cursor.updatedAtMs;
	const unreadByIndex = index !== undefined ? index > cursor.messageIndex : false;
	const unreadByTime = index === undefined && createdAtMs > readAtMs;
	const unreadByCount = messageCount !== undefined && messageCount > cursor.messageCount;
	return {
		readAt: cursor.updatedAt,
		readAtMs,
		seenToken,
		unread: unreadByIndex || unreadByTime || unreadByCount,
	};
}

function eventFromMessage(
	session: WorkbenchChatSession,
	message: WorkbenchChatMessage,
	index: number,
): WorkbenchFrameEvent {
	return {
		id: hashId("event", [session.id, message.id, message.status]),
		frameId: session.id,
		rootFrameId: session.id,
		projectId: session.projectId,
		runSlug: session.id,
		sessionId: session.id,
		eventType: `${message.role}_message`,
		payload: {
			messageId: message.id,
			messageIndex: index,
			messageCount: session.messages.length,
			role: message.role,
			status: message.status,
			toolEvents: message.toolEvents.length,
			text: compactText(message.content, "Message"),
		},
		createdAt: message.createdAt,
		createdAtMs: timestampMs(message.createdAt),
	};
}

function eventFromTool(
	session: WorkbenchChatSession,
	message: WorkbenchChatMessage,
	messageIndex: number,
	tool: WorkbenchToolEvent,
	toolIndex: number,
): WorkbenchFrameEvent {
	return {
		id: hashId("event", [session.id, message.id, tool.id, tool.status]),
		frameId: session.id,
		rootFrameId: session.id,
		projectId: session.projectId,
		runSlug: session.id,
		sessionId: session.id,
		eventType: "tool_event",
		payload: {
			messageId: message.id,
			messageIndex,
			messageCount: session.messages.length,
			toolEventIndex: toolIndex,
			toolName: tool.toolName ?? tool.label,
			status: tool.status,
			label: tool.label,
			input: compactText(tool.input, ""),
			output: compactText(tool.output, ""),
		},
		createdAt: message.createdAt,
		createdAtMs: timestampMs(message.createdAt) + toolIndex,
	};
}

function queuedUserMessage(
	session: WorkbenchChatSession,
	message: WorkbenchChatMessage,
	index: number,
	seq: number,
): WorkbenchQueuedUserMessage | undefined {
	const state = queuedState(message);
	if (!state) return undefined;
	const createdAtMs = timestampMs(message.createdAt);
	return {
		seq,
		id: hashId("queued", [session.id, message.id, message.content]),
		frameId: session.id,
		rootFrameId: session.id,
		projectId: session.projectId,
		runSlug: session.id,
		sessionId: session.id,
		messageId: message.id,
		messageIndex: index,
		messageCount: session.messages.length,
		intentId: hashId("intent", [session.id, message.id]),
		payload: {
			text: compactText(message.content, "Queued user message"),
			toolEvents: message.toolEvents.length,
		},
		state,
		...(state === "resolved" || state === "failed" ? { resolvedAt: session.updatedAt, resolvedAtMs: timestampMs(session.updatedAt) } : {}),
		createdAt: message.createdAt,
		createdAtMs,
	};
}

function notificationFromMessage(
	session: WorkbenchChatSession,
	message: WorkbenchChatMessage,
	index: number,
	cursor: WorkbenchFrameReadCursor | undefined,
): WorkbenchSessionNotification | undefined {
	if (message.role === "user" && message.status === "complete") return undefined;
	if (message.role === "assistant" && message.status === "complete" && !message.toolEvents.some((event) => event.status === "error")) return undefined;
	const createdAtMs = timestampMs(message.createdAt);
	const read = readStateFor(cursor, index, createdAtMs, session.messages.length);
	const status = statusFromChat(message.status);
	return {
		id: hashId("notification", [session.id, message.id, message.status]),
		senderFrameId: session.id,
		recipientFrameId: session.id,
		rootFrameId: session.id,
		projectId: session.projectId,
		runSlug: session.id,
		sessionId: session.id,
		notificationType: message.role === "user" ? "queued_user_message" : "assistant_message",
		title: message.role === "user" ? "Queued user message" : status === "failed" ? "Assistant turn failed" : "Assistant turn update",
		detail: compactText(message.content, message.role === "user" ? "Queued message" : "Assistant update"),
		status,
		payload: {
			messageId: message.id,
			messageIndex: index,
			messageCount: session.messages.length,
			unread: read.unread,
		},
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: message.createdAt,
		createdAtMs,
	};
}

function notificationFromTool(
	session: WorkbenchChatSession,
	message: WorkbenchChatMessage,
	messageIndex: number,
	tool: WorkbenchToolEvent,
	toolIndex: number,
	cursor: WorkbenchFrameReadCursor | undefined,
): WorkbenchSessionNotification | undefined {
	if (tool.status === "complete" && !tool.isError) return undefined;
	const createdAtMs = timestampMs(message.createdAt) + toolIndex;
	const read = readStateFor(cursor, messageIndex, createdAtMs, session.messages.length);
	const status = tool.isError ? "failed" : statusFromChat(tool.status);
	return {
		id: hashId("notification", [session.id, message.id, tool.id, tool.status]),
		senderFrameId: session.id,
		recipientFrameId: session.id,
		rootFrameId: session.id,
		projectId: session.projectId,
		runSlug: session.id,
		sessionId: session.id,
		notificationType: "tool_event",
		title: status === "failed" ? `${tool.label} failed` : tool.label,
		detail: compactText(tool.output || tool.details || tool.input, tool.toolName ?? "Tool activity"),
		status,
		payload: {
			messageId: message.id,
			messageIndex,
			messageCount: session.messages.length,
			toolEventId: tool.id,
			toolName: tool.toolName ?? tool.label,
			unread: read.unread,
		},
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: message.createdAt,
		createdAtMs,
	};
}

function notificationFromPlan(
	plan: WorkbenchGeneratedPlan,
	cursor: WorkbenchFrameReadCursor | undefined,
): WorkbenchSessionNotification {
	const createdAtMs = timestampMs(plan.updatedAt);
	const read = readStateFor(cursor, undefined, createdAtMs, undefined);
	const status = statusFromPlan(plan.status);
	return {
		id: hashId("notification", [plan.id, plan.status, plan.updatedAt]),
		senderFrameId: plan.sessionId,
		recipientFrameId: plan.sessionId,
		rootFrameId: plan.sessionId,
		projectId: plan.projectId,
		runSlug: plan.runSlug,
		sessionId: plan.sessionId,
		notificationType: "plan_status",
		title: plan.status === "awaiting_approval" ? "Plan ready for approval" : plan.title,
		detail: compactText(plan.taskSummary, "Generated plan update"),
		status,
		payload: {
			planId: plan.id,
			artifactPath: plan.artifactPath,
			status: plan.status,
			unread: read.unread,
		},
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: plan.updatedAt,
		createdAtMs,
	};
}

function notificationFromCompute(
	job: WorkbenchComputeJobRecord,
	cursor: WorkbenchFrameReadCursor | undefined,
): WorkbenchSessionNotification {
	const completed = job.endedAtMs >= job.startedAtMs ? job.endedAt : job.startedAt;
	const createdAtMs = timestampMs(completed);
	const read = readStateFor(cursor, undefined, createdAtMs, undefined);
	return {
		id: hashId("notification", [job.id, job.status, completed]),
		senderFrameId: job.sessionId,
		recipientFrameId: job.sessionId,
		rootFrameId: job.sessionId,
		projectId: job.projectId,
		...(job.runSlug ? { runSlug: job.runSlug } : {}),
		sessionId: job.sessionId,
		notificationType: job.status === "complete" || job.status === "verified" ? "compute_done" : "compute_update",
		title: job.title,
		detail: compactText(job.error || job.detail || job.command, "Compute job update"),
		status: statusFromCompute(job.status),
		payload: {
			jobId: job.id,
			provider: job.providerName,
			status: job.status,
			outputPaths: job.outputPaths,
			unread: read.unread,
		},
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: completed,
		createdAtMs,
	};
}

function activityFromQueued(
	message: WorkbenchQueuedUserMessage,
	cursor: WorkbenchFrameReadCursor | undefined,
): WorkbenchSessionActivityItem {
	const read = readStateFor(cursor, message.messageIndex, message.createdAtMs, message.messageCount);
	const status: WorkbenchNotificationStatus = message.state === "failed" ? "failed" : message.state === "resolved" ? "complete" : "queued";
	return {
		id: `activity:${message.id}`,
		kind: "queued_user_message",
		eventType: "queued_user_message",
		title: message.state === "resolved" ? "Queued message resolved" : "Queued user message",
		detail: message.payload.text,
		status,
		rootFrameId: message.rootFrameId,
		projectId: message.projectId,
		runSlug: message.runSlug,
		sessionId: message.sessionId,
		messageId: message.messageId,
		messageIndex: message.messageIndex,
		messageCount: message.messageCount,
		artifactPaths: [],
		unread: read.unread,
		...(read.seenToken ? { seenToken: read.seenToken } : {}),
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: message.createdAt,
		createdAtMs: message.createdAtMs,
		payload: {
			intentId: message.intentId,
			state: message.state,
		},
	};
}

function activityFromNotification(notification: WorkbenchSessionNotification): WorkbenchSessionActivityItem {
	const artifactPaths = Array.isArray(notification.payload.artifactPath)
		? notification.payload.artifactPath.filter((item): item is string => typeof item === "string")
		: typeof notification.payload.artifactPath === "string"
			? [notification.payload.artifactPath]
			: Array.isArray(notification.payload.outputPaths)
				? notification.payload.outputPaths.filter((item): item is string => typeof item === "string")
				: [];
	return {
		id: `activity:${notification.id}`,
		kind: "notification",
		eventType: notification.notificationType,
		title: notification.title,
		detail: notification.detail,
		status: notification.status,
		rootFrameId: notification.rootFrameId,
		projectId: notification.projectId,
		runSlug: notification.runSlug,
		sessionId: notification.sessionId,
		artifactPaths,
		unread: notification.payload.unread === true,
		...(notification.readAt ? { readAt: notification.readAt, readAtMs: notification.readAtMs } : {}),
		createdAt: notification.createdAt,
		createdAtMs: notification.createdAtMs,
		payload: notification.payload,
	};
}

function activityFromEvent(event: WorkbenchFrameEvent, cursor: WorkbenchFrameReadCursor | undefined): WorkbenchSessionActivityItem | undefined {
	if (event.eventType !== "assistant_message" && event.eventType !== "tool_event") return undefined;
	const messageIndex = typeof event.payload.messageIndex === "number" ? event.payload.messageIndex : undefined;
	const read = readStateFor(cursor, messageIndex, event.createdAtMs, typeof event.payload.messageCount === "number" ? event.payload.messageCount : undefined);
	return {
		id: `activity:${event.id}`,
		kind: "event",
		eventType: event.eventType,
		title: event.eventType === "tool_event" ? "Tool activity" : "Assistant message",
		detail: compactText(typeof event.payload.text === "string" ? event.payload.text : typeof event.payload.label === "string" ? event.payload.label : undefined, "Session event"),
		status: statusFromChat(typeof event.payload.status === "string" ? event.payload.status as WorkbenchChatMessage["status"] : "complete"),
		rootFrameId: event.rootFrameId,
		projectId: event.projectId,
		runSlug: event.runSlug,
		sessionId: event.sessionId,
		messageId: typeof event.payload.messageId === "string" ? event.payload.messageId : undefined,
		messageIndex,
		messageCount: typeof event.payload.messageCount === "number" ? event.payload.messageCount : undefined,
		artifactPaths: [],
		unread: read.unread,
		...(read.seenToken ? { seenToken: read.seenToken } : {}),
		...(read.readAt ? { readAt: read.readAt, readAtMs: read.readAtMs } : {}),
		createdAt: event.createdAt,
		createdAtMs: event.createdAtMs,
		payload: event.payload,
	};
}

export function buildWorkbenchSessionActivity(input: BuildSessionActivityInput): WorkbenchSessionActivityState {
	const cursorByRoot = new Map(input.frameReadCursors.map((cursor) => [cursor.rootFrameId, cursor]));
	const events: WorkbenchFrameEvent[] = [];
	const notifications: WorkbenchSessionNotification[] = [];
	const queuedUserMessages: WorkbenchQueuedUserMessage[] = [];
	let seq = 0;

	for (const session of input.sessions) {
		const cursor = cursorByRoot.get(session.id);
		session.messages.forEach((message, index) => {
			events.push(eventFromMessage(session, message, index));
			const queued = message.role === "user" ? queuedUserMessage(session, message, index, ++seq) : undefined;
			if (queued) queuedUserMessages.push(queued);
			const notification = notificationFromMessage(session, message, index, cursor);
			if (notification) notifications.push(notification);
			message.toolEvents.forEach((tool, toolIndex) => {
				events.push(eventFromTool(session, message, index, tool, toolIndex));
				const toolNotification = notificationFromTool(session, message, index, tool, toolIndex, cursor);
				if (toolNotification) notifications.push(toolNotification);
			});
		});
	}

	for (const plan of input.plans) notifications.push(notificationFromPlan(plan, cursorByRoot.get(plan.sessionId)));
	for (const job of input.computeJobs) notifications.push(notificationFromCompute(job, cursorByRoot.get(job.sessionId)));

	const sessionSeenMarks = seenMarks(input.frameReadCursors);
	const activity = [
		...queuedUserMessages.map((message) => activityFromQueued(message, cursorByRoot.get(message.rootFrameId))),
		...notifications.map(activityFromNotification),
		...events.flatMap((event) => {
			const item = activityFromEvent(event, cursorByRoot.get(event.rootFrameId));
			return item ? [item] : [];
		}),
	]
		.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
		.slice(0, MAX_ACTIVITY_ITEMS);

	return {
		events: events.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id)).slice(0, MAX_ACTIVITY_ITEMS),
		notifications: notifications.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id)).slice(0, MAX_ACTIVITY_ITEMS),
		queuedUserMessages: queuedUserMessages.sort((a, b) => a.seq - b.seq).slice(0, MAX_ACTIVITY_ITEMS),
		sessionSeenMarks,
		sessionActivity: activity,
	};
}
