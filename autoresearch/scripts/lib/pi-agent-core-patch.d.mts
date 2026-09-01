export declare const PI_AGENT_CORE_PATCH_MARKERS: Readonly<{
	toolAliases: string;
	streamWatchdog: string;
}>;
export declare function assertPiAgentCorePatchSource(source: string, surface?: string): void;
export function patchPiAgentCoreSource(source: string): string;
