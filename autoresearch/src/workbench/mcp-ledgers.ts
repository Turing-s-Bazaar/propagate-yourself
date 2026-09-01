import { buildWorkbenchCustomMcpLedgers } from "./custom-mcp-ledgers.js";
import { buildWorkbenchDirectoryAttachments } from "./directory-attachments.js";
import { buildWorkbenchMcpToolGrants } from "./mcp-tool-grants.js";
import type {
	WorkbenchCustomMcpServer,
	WorkbenchDirectoryAttachment,
	WorkbenchMcpAgentAssignment,
	WorkbenchMcpToolGrant,
	WorkbenchResourceGroup,
} from "./types.js";

export function buildWorkbenchMcpLedgers({
	resources,
	workingDir,
}: {
	resources: WorkbenchResourceGroup[];
	workingDir: string;
}): {
	directoryAttachments: WorkbenchDirectoryAttachment[];
	mcpToolGrants: WorkbenchMcpToolGrant[];
	customMcpServers: WorkbenchCustomMcpServer[];
	mcpAgentAssignments: WorkbenchMcpAgentAssignment[];
} {
	return {
		directoryAttachments: buildWorkbenchDirectoryAttachments(resources),
		mcpToolGrants: buildWorkbenchMcpToolGrants(workingDir),
		...buildWorkbenchCustomMcpLedgers(workingDir),
	};
}
