import type { WorkbenchChatSession } from "./types.js";

export type WorkbenchUpload = WorkbenchChatSession["attachments"][number];

export type AttachmentDownloadParams = {
	sessionId: string;
	projectId: string;
	title: string;
	attachmentId: string;
};

export function attachmentDownloadUrl(params: AttachmentDownloadParams): string {
	const query = new URLSearchParams({
		sessionId: params.sessionId,
		projectId: params.projectId,
		title: params.title,
		attachmentId: params.attachmentId,
	});
	return `/api/chat/attachment/download?${query.toString()}`;
}

export function filterUploadsForBrowser(uploads: WorkbenchUpload[], query: string): WorkbenchUpload[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return uploads;
	return uploads.filter((upload) => {
		return (
			upload.name.toLowerCase().includes(normalized) ||
			upload.contentType.toLowerCase().includes(normalized) ||
			upload.storagePath.toLowerCase().includes(normalized) ||
			(upload.previewText ?? "").toLowerCase().includes(normalized)
		);
	});
}

export function uploadPreviewText(upload: WorkbenchUpload): string {
	if (!upload.previewText) return "No text preview is available for this upload.";
	return `${upload.previewText}${upload.truncated ? "\n\n[preview truncated]" : ""}`;
}
