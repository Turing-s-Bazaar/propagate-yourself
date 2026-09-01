export const PI_SESSION_SEARCH_PATCH_TARGETS = [
	"extensions/indexer.ts",
];

const UPSTREAM_SESSION_DIR =
	'const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");';
const FEYNMAN_SESSION_DIR =
	'const sessionsDir = process.env.FEYNMAN_SESSION_DIR ?? process.env.PI_SESSION_DIR ?? path.join(os.homedir(), ".pi", "agent", "sessions");';

export function patchPiSessionSearchSource(relativePath, source) {
	if (relativePath !== "extensions/indexer.ts") {
		return source;
	}
	return source.replace(UPSTREAM_SESSION_DIR, FEYNMAN_SESSION_DIR);
}
