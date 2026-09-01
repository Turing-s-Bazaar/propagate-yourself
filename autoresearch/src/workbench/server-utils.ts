import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const STANDARD_ERROR_NAMES = new Set([
	"AggregateError",
	"Error",
	"EvalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
]);

export function requestOrigin(request: IncomingMessage): string {
	const host = typeof request.headers.host === "string" ? request.headers.host : "127.0.0.1";
	const protoHeader = request.headers["x-forwarded-proto"];
	const protocol = typeof protoHeader === "string" && protoHeader.trim() ? protoHeader.split(",")[0]!.trim() : "http";
	return `${protocol}://${host}`;
}

export function requestCookie(header: string | undefined, expectedName: string): string | undefined {
	for (const pair of (header ?? "").split(";")) {
		const [rawName, ...rawValue] = pair.split("=");
		if (rawName?.trim() !== expectedName) continue;
		try {
			return decodeURIComponent(rawValue.join("=").trim());
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function hostForUrl(host: string): string {
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function normalizeHost(value: string | undefined): string {
	const host = value?.trim();
	return host || "127.0.0.1";
}

export function logWorkbenchRequestError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	const name = error instanceof Error && STANDARD_ERROR_NAMES.has(error.name) ? error.name : error instanceof Error ? "Error" : typeof error;
	const hash = createHash("sha256").update(message).digest("hex").slice(0, 16);
	console.error(`Feynman workbench request failed (${name}; error_message_hash=${hash}).`);
}

export function sendWorkbenchRequestError(response: ServerResponse, error: unknown): void {
	logWorkbenchRequestError(error);
	if (response.headersSent) {
		if (!response.writableEnded && String(response.getHeader("content-type") ?? "").startsWith("text/event-stream")) {
			response.write("event: error\ndata: {\"type\":\"error\",\"message\":\"Internal server error.\"}\n\n");
		}
		if (!response.writableEnded) response.end();
		return;
	}
	response.writeHead(500, { "cache-control": "no-store" });
	response.end("Internal server error.");
}

export function parseWorkbenchPort(value: string | undefined): number | undefined {
	if (!value) return undefined;
	if (!/^\d+$/.test(value)) {
		throw new Error("Workbench port must be a positive integer.");
	}
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
		throw new Error("Workbench port must be between 0 and 65535.");
	}
	return port;
}
