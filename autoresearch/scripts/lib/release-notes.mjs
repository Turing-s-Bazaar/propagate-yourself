export function normalizeReleaseVersion(version) {
	const trimmed = String(version ?? "").trim();
	if (!trimmed) return "";
	return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function extractReleaseNotes(source, version) {
	const normalizedVersion = normalizeReleaseVersion(version);
	if (!normalizedVersion) return "";

	const lines = String(source ?? "").split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().match(new RegExp(`^##\\s+${escapeRegExp(normalizedVersion)}(?:\\s|$)`)));
	if (start === -1) return "";

	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s+\S+/.test(lines[index])) {
			end = index;
			break;
		}
	}

	return lines.slice(start, end).join("\n").trim();
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
