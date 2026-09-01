export interface NpmProvenanceExpectation {
	name: string;
	version: string;
	integrity: string;
	repository: string;
	workflowPath: string;
	ref?: string;
	registry?: string;
}

export function resolveVerifiedNpmSourceCommit(
	audit: unknown,
	expected: NpmProvenanceExpectation,
): string;
