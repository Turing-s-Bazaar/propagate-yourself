export declare function createRuntimeWorkspaceIntegrityIndex(
	workspaceDir: string,
): {
	runtimeTreeHash: string;
	integrityShapeHash: string;
};

export declare function runtimeWorkspaceIntegrityIndexMatches(
	workspaceDir: string,
	expectedShapeHash: string,
	expectedTreeHash: string,
): boolean;
