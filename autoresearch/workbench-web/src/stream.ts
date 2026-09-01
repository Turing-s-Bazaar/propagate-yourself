import type {
	WorkbenchChatMessage,
	WorkbenchChatSession,
	WorkbenchToolEvent,
	WorkbenchState,
} from "./types.js";

export type WorkbenchChatStreamEvent =
	| { type: "session"; session: WorkbenchChatSession }
	| { type: "delta"; content: string }
	| { type: "tool"; toolEvent: WorkbenchToolEvent }
	| { type: "done"; session: WorkbenchChatSession; state?: WorkbenchState }
	| { type: "error"; message: string; session?: WorkbenchChatSession; state?: WorkbenchState };

export function isTerminalChatStreamEvent(event: WorkbenchChatStreamEvent): boolean {
	return event.type === "done" || event.type === "error";
}

export function parseStreamChunk(buffer: string, onEvent: (event: WorkbenchChatStreamEvent) => void): string {
	let cursor = buffer.indexOf("\n\n");
	while (cursor !== -1) {
		const frame = buffer.slice(0, cursor);
		buffer = buffer.slice(cursor + 2);
		const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
		if (dataLine) {
			try {
				onEvent(JSON.parse(dataLine.slice(6)) as WorkbenchChatStreamEvent);
			} catch {}
		}
		cursor = buffer.indexOf("\n\n");
	}
	return buffer;
}

export function patchLastAssistant(
	session: WorkbenchChatSession,
	patch: Partial<WorkbenchChatMessage>,
): WorkbenchChatSession {
	const messages = [...session.messages];
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role !== "assistant") continue;
		messages[index] = { ...messages[index], ...patch };
		return { ...session, messages };
	}
	return session;
}

export function upsertAssistantTool(
	session: WorkbenchChatSession,
	toolEvent: WorkbenchToolEvent,
): WorkbenchChatSession {
	const messages = [...session.messages];
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role !== "assistant") continue;
		const existing = messages[index].toolEvents ?? [];
		const nextEvents = existing.some((event) => event.id === toolEvent.id)
			? existing.map((event) => event.id === toolEvent.id ? { ...event, ...toolEvent } : event)
			: [...existing, toolEvent];
		messages[index] = { ...messages[index], toolEvents: nextEvents };
		return { ...session, messages };
	}
	return session;
}
