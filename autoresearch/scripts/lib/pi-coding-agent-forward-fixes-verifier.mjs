import { assertPiCodingAgentForwardFixSource, PI_CODING_AGENT_FORWARD_FIX_TARGETS } from "./pi-runtime-correctness-patch.mjs";

export function assertPiCodingAgentForwardFixPackageTree(readSource, surface = "bundled") {
	for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
		const label = `${surface} Pi coding-agent ${relativePath}`;
		assertPiCodingAgentForwardFixSource(relativePath, readSource(relativePath, label), label);
	}
}

export function assertPiCodingAgentForwardFixArchive(readSource, surface = "runtime") {
	for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
		const label = `${surface} Pi coding-agent ${relativePath}`;
		assertPiCodingAgentForwardFixSource(relativePath, readSource(relativePath, label), label);
	}
}
