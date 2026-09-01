export const PI_OPENAI_RESPONSES_NO_TOOLS_MARKER =
	"Feynman Pi 0.84.2 forward patch: Responses omits tool_choice without tools #8649";

const ORIGINAL_TOOL_CHOICE = `    if (options?.toolChoice !== undefined) {
        params.tool_choice = options.toolChoice;
    }`;

const PATCHED_TOOL_CHOICE = `    // ${PI_OPENAI_RESPONSES_NO_TOOLS_MARKER}
    if (options?.toolChoice !== undefined && toolPlacement.immediate.length > 0) {
        params.tool_choice = options.toolChoice;
    }`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

export function assertPiOpenAiResponsesNoToolsSource(source, relativePath) {
	for (const fragment of [
		PI_OPENAI_RESPONSES_NO_TOOLS_MARKER,
		"if (options?.toolChoice !== undefined && toolPlacement.immediate.length > 0)",
	]) {
		const count = countOccurrences(source, fragment);
		if (count !== 1) {
			throw new Error(
				`Incomplete Pi AI forward patch ${relativePath}: expected exactly one semantic fragment, found ${count}: ${fragment}`,
			);
		}
	}
	if (source.includes(ORIGINAL_TOOL_CHOICE)) {
		throw new Error(
			`Incomplete Pi AI forward patch ${relativePath}: retained no-tools tool_choice`,
		);
	}
}

export function patchPiOpenAiResponsesNoToolsSource(source, relativePath) {
	if (source.includes(PI_OPENAI_RESPONSES_NO_TOOLS_MARKER)) {
		assertPiOpenAiResponsesNoToolsSource(source, relativePath);
		return source;
	}
	const count = countOccurrences(source, ORIGINAL_TOOL_CHOICE);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi 0.84.2 OpenAI Responses no-tools tool choice layout in ${relativePath}; expected 1 occurrence, found ${count}`,
		);
	}
	const patched = source.replace(ORIGINAL_TOOL_CHOICE, PATCHED_TOOL_CHOICE);
	assertPiOpenAiResponsesNoToolsSource(patched, relativePath);
	return patched;
}
