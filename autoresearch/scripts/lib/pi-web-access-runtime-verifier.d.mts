export interface GitHubCloneSafetyResult {
	malformedIdentity: "rejected";
	cleanup: "confined";
	symlinkCleanup: "confined" | "skipped-unsupported";
}

export interface ModelAwareSearchRoutingResult {
	curator: {
		codex: "openai";
		nonCodex: "exa";
		openaiFallback: "openai";
	};
	search: {
		codex: "openai";
		nonCodex: "exa";
	};
}

export declare function verifyModelAwareSearchRouting(
	packageRoot: string,
): ModelAwareSearchRoutingResult;

export declare function verifyGitHubCloneSafety(
	packageRoot: string,
): GitHubCloneSafetyResult;
