export const MIN_NODE_VERSION = "22.22.0";
export const MAX_NODE_MAJOR = 25;
export const PREFERRED_NODE_MAJOR = 24;

type ParsedNodeVersion = {
	major: number;
	minor: number;
	patch: number;
};

function parseNodeVersion(version: string): ParsedNodeVersion {
	const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(".");
	return {
		major: Number.parseInt(major, 10) || 0,
		minor: Number.parseInt(minor, 10) || 0,
		patch: Number.parseInt(patch, 10) || 0,
	};
}

function compareNodeVersions(left: ParsedNodeVersion, right: ParsedNodeVersion): number {
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	return left.patch - right.patch;
}

export function isSupportedNodeVersion(version = process.versions.node): boolean {
	const parsed = parseNodeVersion(version);
	return compareNodeVersions(parsed, parseNodeVersion(MIN_NODE_VERSION)) >= 0 && parsed.major <= MAX_NODE_MAJOR;
}

export function getUnsupportedNodeVersionLines(version = process.versions.node): string[] {
	const isWindows = process.platform === "win32";
	const parsed = parseNodeVersion(version);
	const rangeText = `Node.js ${MIN_NODE_VERSION} through ${MAX_NODE_MAJOR}.x`;
	return [
		`feynman supports ${rangeText} (detected ${version}).`,
		parsed.major > MAX_NODE_MAJOR
			? "This newer Node release is not supported yet."
			: isWindows
				? "Install a supported Node.js release from https://nodejs.org, or use the standalone installer:"
				: `Switch to a supported Node release with \`nvm install ${PREFERRED_NODE_MAJOR} && nvm use ${PREFERRED_NODE_MAJOR}\`, or use the standalone installer:`,
		isWindows
			? "irm https://feynman.is/install.ps1 | iex"
			: "curl -fsSL https://feynman.is/install | bash",
	];
}

export function ensureSupportedNodeVersion(version = process.versions.node): void {
	if (!isSupportedNodeVersion(version)) {
		throw new Error(getUnsupportedNodeVersionLines(version).join("\n"));
	}
}
