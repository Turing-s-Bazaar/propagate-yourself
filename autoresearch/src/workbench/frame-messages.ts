import type { WorkbenchChatMessage, WorkbenchChatSession, WorkbenchToolEvent } from "./chat.js";
import type { WorkbenchFrameMessage } from "./ledger-types.js";

const MAX_MESSAGE_TEXT_CHARS = 120_000;
const MAX_TOOL_TEXT_CHARS = 20_000;

function timestampMs(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function boundedText(value: string | undefined, maxLength: number): { text: string; truncated: boolean } {
	const text = value ?? "";
	if (text.length <= maxLength) return { text, truncated: false };
	return { text: text.slice(0, maxLength), truncated: true };
}

function toolPayload(tool: WorkbenchToolEvent, index: number): Record<string, unknown> {
	const input = boundedText(tool.input, MAX_TOOL_TEXT_CHARS);
	const output = boundedText(tool.output, MAX_TOOL_TEXT_CHARS);
	const details = boundedText(tool.details, MAX_TOOL_TEXT_CHARS);
	return {
		id: tool.id,
		index,
		label: tool.label,
		status: tool.status,
		...(tool.toolName ? { tool_name: tool.toolName } : {}),
		...(input.text ? { input: input.text } : {}),
		...(input.truncated ? { input_truncated: true } : {}),
		...(output.text ? { output: output.text } : {}),
		...(output.truncated ? { output_truncated: true } : {}),
		...(details.text ? { details: details.text } : {}),
		...(details.truncated ? { details_truncated: true } : {}),
		...(tool.isError ? { is_error: true } : {}),
	};
}

function frameMessageJson(message: WorkbenchChatMessage, index: number, messageCount: number): string {
	const content = boundedText(message.content, MAX_MESSAGE_TEXT_CHARS);
	return JSON.stringify({
		_uuid: message.id,
		role: message.role,
		content: [
			{
				type: "text",
				text: content.text,
				...(content.truncated ? { truncated: true } : {}),
			},
		],
		status: message.status,
		created_at: message.createdAt,
		feynman: {
			message_index: index,
			message_count: messageCount,
			tool_events: message.toolEvents.map((tool, toolIndex) => toolPayload(tool, toolIndex)),
		},
	});
}

export function buildWorkbenchFrameMessages(sessions: WorkbenchChatSession[]): WorkbenchFrameMessage[] {
	return sessions
		.flatMap((session) =>
			session.messages.map((message, index) => {
				const createdAtMs = timestampMs(message.createdAt);
				return {
					frameId: session.id,
					idx: index,
					msgJson: frameMessageJson(message, index, session.messages.length),
					messageUuid: message.id,
					role: message.role,
					status: message.status,
					projectId: session.projectId,
					runSlug: session.id,
					sessionId: session.id,
					createdAt: message.createdAt,
					createdAtMs,
					source: "chat-session" as const,
				};
			})
		)
		.sort((a, b) => a.frameId.localeCompare(b.frameId) || a.idx - b.idx);
}
