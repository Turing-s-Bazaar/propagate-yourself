// Remove this patch after the bundled pi-subagents release includes upstream commits
// c00577935732, e556c1692620, 2332d87440fb, 5ffdcfc18f4e, and
// 86119c8e5099, preserves
// rate-limit fallback, rejects zero-success parallel runs, and passes this runtime verifier.
const MODEL_VERIFICATION_HELPER = [
	'const SUBAGENT_MODEL_VERIFICATION_ERROR_PREFIX = "model_verification_failed:";',
	'const SUBAGENT_MODEL_THINKING_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);',
	"",
	"function stripSubagentModelThinkingSuffix(model: string): string {",
	"\tconst colonIndex = model.lastIndexOf(\":\");",
	"\tif (colonIndex === -1) return model;",
	"\tconst suffix = model.slice(colonIndex + 1);",
	"\treturn SUBAGENT_MODEL_THINKING_SUFFIXES.has(suffix) ? model.slice(0, colonIndex) : model;",
	"}",
	"",
	"function parseExpectedSubagentModelIdentity(",
	"\texpectedModel: string,",
	"\tavailableModels: AvailableModelInfo[] | undefined,",
	"): { provider: string; model: string; fullId: string } | undefined {",
	"\tconst requested = expectedModel.trim();",
	"\tconst exact = availableModels?.find((entry) => entry.fullId === requested);",
	"\tif (exact) return { provider: exact.provider, model: exact.id, fullId: exact.fullId };",
	"\tconst expectedBase = stripSubagentModelThinkingSuffix(requested);",
	"\tconst canonical = availableModels?.find((entry) => entry.fullId === expectedBase);",
	"\tif (canonical) return { provider: canonical.provider, model: canonical.id, fullId: canonical.fullId };",
	"\tconst separatorIndex = expectedBase.indexOf(\"/\");",
	"\tif (separatorIndex <= 0 || separatorIndex === expectedBase.length - 1) return undefined;",
	"\tconst provider = expectedBase.slice(0, separatorIndex);",
	"\tconst model = expectedBase.slice(separatorIndex + 1);",
	"\treturn {",
	"\t\tprovider,",
	"\t\tmodel,",
	"\t\tfullId: `${provider}/${model}`,",
	"\t};",
	"}",
	"",
	"export function isSubagentModelVerificationFailure(error: string | undefined): boolean {",
	"\treturn error?.startsWith(SUBAGENT_MODEL_VERIFICATION_ERROR_PREFIX) === true;",
	"}",
	"",
	"export function formatSubagentModelVerificationError(",
	"\texpectedModel: string,",
	"\tobservedProvider: unknown,",
	"\tobservedModel: unknown,",
	"\tavailableModels?: AvailableModelInfo[],",
	"): string | undefined {",
	"\tconst expected = parseExpectedSubagentModelIdentity(expectedModel, availableModels);",
	"\tif (!expected) return undefined;",
	"\tconst provider = typeof observedProvider === \"string\" ? observedProvider : \"\";",
	"\tconst model = typeof observedModel === \"string\" ? observedModel : \"\";",
	"\tconst observedIdentity = `${provider || \"<missing-provider>\"}/${model || \"<missing-model>\"}`;",
	"\tif (provider && model && expected.provider === provider && expected.model === model) return undefined;",
	"\treturn `${SUBAGENT_MODEL_VERIFICATION_ERROR_PREFIX} requested '${expectedModel}' resolved to '${expected.fullId}', but the child assistant reported '${observedIdentity}'.`;",
	"}",
	"",
].join("\n");

const INHERITED_PARENT_MODEL_HELPER = [
	"export function inheritsParentModel(",
	"\texplicitModel: string | boolean | undefined,",
	"\tagentModel: string | boolean | undefined,",
	"\tparentModel: ParentModel | undefined,",
	"): boolean {",
	"\tconst requestedModel = explicitModel ?? agentModel;",
	"\tconst trimmed = typeof requestedModel === \"string\" ? requestedModel.trim() : \"\";",
	"\treturn Boolean(parentModel && (!trimmed || trimmed === INHERIT_MODEL));",
	"}",
	"",
].join("\n");

const CONTEXT_OVERFLOW_HELPER = [
	"/** Context-window failures must not rerun the same input on fallback models. */",
	"const CONTEXT_OVERFLOW_PATTERNS = [",
	"\t/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,",
	"\t/maximum context length/i,",
	"\t/context_length_exceeded/i,",
	"\t/(?:prompt|input|request|messages?).{0,80}(?:too many tokens|token limit)/i,",
	"\t/(?:too many tokens|token limit).{0,80}(?:prompt|input|request|messages?)/i,",
	"\t/prompt.*too long/i,",
	"\t/input.*too long/i,",
	"\t/(?:prompt|input|messages?).{0,80}exceed(?:s|ed)?.{0,80}(?:token|context|maximum)/i,",
	"\t/reduce (?:the )?length of (?:the )?(?:messages?|prompt|input)/i,",
	"\t/exceeded.*context/i,",
	"\t/context.*overflow/i,",
	"];",
	"",
	"export function isContextOverflow(error: string | undefined): boolean {",
	"\tif (!error) return false;",
	"\tif (TOOL_FAILURE_PREFIX.test(error.trim())) return false;",
	"\treturn CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(error));",
	"}",
	"",
].join("\n");

const LEGACY_CONTEXT_OVERFLOW_PATTERNS = [
	"const CONTEXT_OVERFLOW_PATTERNS = [",
	"\t/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,",
	"\t/maximum context length/i,",
	"\t/too many tokens/i,",
	"\t/token limit/i,",
	"\t/context_length_exceeded/i,",
	"\t/length_required/i,",
	"\t/maximum.*tokens/i,",
	"\t/prompt.*too long/i,",
	"\t/input.*too long/i,",
	"\t/exceeded.*context/i,",
	"\t/context.*overflow/i,",
	"];",
].join("\n");

const CURRENT_CONTEXT_OVERFLOW_PATTERNS = CONTEXT_OVERFLOW_HELPER.slice(
	CONTEXT_OVERFLOW_HELPER.indexOf("const CONTEXT_OVERFLOW_PATTERNS = ["),
	CONTEXT_OVERFLOW_HELPER.indexOf("\n\nexport function isContextOverflow("),
);

const FINALIZE_TOOL_RESULT_HELPER = [
	"/** Convert internal logical failures into Pi's canonical errored tool result. */",
	"function finalizeToolResult<T extends { isError?: boolean; content: unknown[] }>(result: T): T {",
	"\tif (result.isError !== true) return result;",
	"\tconst message = result.content",
	"\t\t.filter(",
	"\t\t\t(item): item is { type: \"text\"; text: string } =>",
	"\t\t\t\ttypeof item === \"object\" && item !== null &&",
	"\t\t\t\t(item as { type?: unknown }).type === \"text\" &&",
	"\t\t\t\ttypeof (item as { text?: unknown }).text === \"string\",",
	"\t\t)",
	"\t\t.map((item) => item.text)",
	"\t\t.join(\"\\n\")",
	"\t\t.trim();",
	"\tthrow new Error(message || \"pi-subagents reported a logical tool failure.\");",
	"}",
	"",
].join("\n");

function replaceAll(source, original, replacement) {
	return source.split(original).join(replacement);
}

function addAfter(source, anchor, addition) {
	if (!source.includes(anchor) || source.includes(addition.trim())) return source;
	return source.replace(anchor, `${anchor}\n${addition}`);
}

function addLineAfter(source, lineText, additionText) {
	const lines = source.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index].trim() !== lineText) continue;
		if (lines[index + 1]?.trim() === additionText) continue;
		const indentation = lines[index].match(/^\s*/)?.[0] ?? "";
		lines.splice(index + 1, 0, `${indentation}${additionText}`);
	}
	return lines.join("\n");
}

function addLineWithinInterface(source, interfaceName, lineText, additionText) {
	const interfaceStart = source.indexOf(`interface ${interfaceName} {`);
	if (interfaceStart === -1) return source;
	const interfaceEnd = source.indexOf("\n}", interfaceStart);
	if (interfaceEnd === -1) return source;
	const before = source.slice(0, interfaceStart);
	const body = source.slice(interfaceStart, interfaceEnd);
	const after = source.slice(interfaceEnd);
	return `${before}${addLineAfter(body, lineText, additionText)}${after}`;
}

function patchModelFallback(source) {
	let patched = source;
	const sentinel = "/** Sentinel model value requesting that a subagent inherit the parent session's model. */";
	const helperStarts = [
		patched.lastIndexOf('const SUBAGENT_MODEL_VERIFICATION_ERROR_PREFIX = "model_verification_failed:";', patched.indexOf(sentinel)),
		patched.lastIndexOf("export function formatSubagentModelVerificationError(", patched.indexOf(sentinel)),
	].filter((index) => index >= 0);
	const helperStart = helperStarts.length > 0 ? Math.min(...helperStarts) : -1;
	const sentinelIndex = patched.indexOf(sentinel);
	if (helperStart >= 0 && sentinelIndex > helperStart) {
		patched = `${patched.slice(0, helperStart)}${MODEL_VERIFICATION_HELPER}${patched.slice(sentinelIndex)}`;
	} else if (sentinelIndex >= 0) {
		patched = `${patched.slice(0, sentinelIndex)}${MODEL_VERIFICATION_HELPER}${patched.slice(sentinelIndex)}`;
	}
	if (!patched.includes("export function inheritsParentModel(")) {
		const inheritanceAnchor = "export function resolveSubagentModelOverride(";
		patched = patched.replace(inheritanceAnchor, `${INHERITED_PARENT_MODEL_HELPER}${inheritanceAnchor}`);
	}
	if (patched.includes("export function isContextOverflow(")) {
		return patched.replace(
			LEGACY_CONTEXT_OVERFLOW_PATTERNS,
			CURRENT_CONTEXT_OVERFLOW_PATTERNS,
		);
	}
	const anchor = "export function formatModelAttemptNote(";
	if (!patched.includes("const TOOL_FAILURE_PREFIX =") || !patched.includes(anchor)) return patched;
	return patched.replace(anchor, `${CONTEXT_OVERFLOW_HELPER}${anchor}`);
}

function patchForegroundExecution(source) {
	let patched = source;
	if (!patched.includes("\tformatSubagentModelVerificationError,\n")) {
		patched = patched.replace(
			"\tbuildModelCandidates,\n\tformatModelAttemptNote,",
			"\tbuildModelCandidates,\n\tformatSubagentModelVerificationError,\n\tformatModelAttemptNote,",
		);
	}
	if (!patched.includes("\tisSubagentModelVerificationFailure,\n")) {
		patched = patched.replace(
			"\tisRetryableModelFailure,\n",
			"\tisRetryableModelFailure,\n\tisSubagentModelVerificationFailure,\n",
		);
	}
	if (!patched.includes("\tisContextOverflow,\n")) {
		patched = patched.replace(
			"\tformatModelAttemptNote,\n\tisRetryableModelFailure,",
			"\tformatModelAttemptNote,\n\tisContextOverflow,\n\tisRetryableModelFailure,",
		);
	}
	patched = addLineAfter(
		patched,
		"originalTask?: string;",
		"verifyModel: boolean;",
	);
	patched = patched.replace(
		"const expectedModelForVerification = modelArg;",
		"const expectedModelForVerification = shared.verifyModel ? model : undefined;",
	);
	patched = addLineAfter(
		patched,
		"const modelArg = applyThinkingSuffix(model, effectiveThinking, options.thinkingOverride !== undefined);",
		"const expectedModelForVerification = shared.verifyModel ? model : undefined;",
	);
	const weakObservedModelBlock = [
		"\t\t\t\t\tif (evt.message.model) {",
		"\t\t\t\t\t\tprogress.model = evt.message.model;",
		"\t\t\t\t\t\tif (!result.model) result.model = evt.message.model;",
		"\t\t\t\t\t\tif (expectedModelForVerification) {",
		"\t\t\t\t\t\t\tconst modelVerificationError = formatSubagentModelVerificationError(expectedModelForVerification, evt.message.model, options.availableModels);",
		"\t\t\t\t\t\t\tif (modelVerificationError && !result.error) result.error = modelVerificationError;",
		"\t\t\t\t\t\t}",
		"\t\t\t\t\t}",
	].join("\n");
	const observedModelBlock = [
		"\t\t\t\t\tif (evt.message.model) {",
		"\t\t\t\t\t\tprogress.model = evt.message.model;",
		"\t\t\t\t\t\tif (!result.model) result.model = evt.message.model;",
		"\t\t\t\t\t}",
	].join("\n");
	patched = patched.replace(weakObservedModelBlock, observedModelBlock);
	const modelVerificationStateAnchor = "\t\tlet assistantError: string | undefined;";
	const modelVerificationState = [
		modelVerificationStateAnchor,
		"\t\tlet modelVerificationFailed = false;",
		"\t\tlet firstAssistantMessageStartSeen = false;",
		"\t\tlet modelVerificationHardKillTimer: NodeJS.Timeout | undefined;",
	].join("\n");
	if (!patched.includes("\t\tlet modelVerificationFailed = false;")) {
		patched = patched.replace(modelVerificationStateAnchor, modelVerificationState);
	}
	const clearModelVerificationTimerAnchor = [
		"\t\t\tif (finalHardKillTimer) {",
		"\t\t\t\tclearTimeout(finalHardKillTimer);",
		"\t\t\t\tfinalHardKillTimer = undefined;",
		"\t\t\t}",
	].join("\n");
	const clearModelVerificationTimer = [
		clearModelVerificationTimerAnchor,
		"\t\t\tif (modelVerificationHardKillTimer) {",
		"\t\t\t\tclearTimeout(modelVerificationHardKillTimer);",
		"\t\t\t\tmodelVerificationHardKillTimer = undefined;",
		"\t\t\t}",
	].join("\n");
	if (!patched.includes("\t\t\t\tmodelVerificationHardKillTimer = undefined;")) {
		patched = patched.replace(clearModelVerificationTimerAnchor, clearModelVerificationTimer);
	}
	const modelVerificationFunctions = [
		"\t\tconst terminateForModelVerificationFailure = (verificationError: string): false => {",
		"\t\t\tmodelVerificationFailed = true;",
		"\t\t\tif (!result.error) result.error = verificationError;",
		"\t\t\tprogress.status = \"failed\";",
		"\t\t\tprogress.error = verificationError;",
		"\t\t\tif (!childExited) {",
		"\t\t\t\ttrySignalChild(proc, \"SIGTERM\");",
		"\t\t\t\tmodelVerificationHardKillTimer ??= setTimeout(() => {",
		"\t\t\t\t\tif (!childExited) trySignalChild(proc, \"SIGKILL\");",
		"\t\t\t\t}, 1000);",
		"\t\t\t\tmodelVerificationHardKillTimer.unref?.();",
		"\t\t\t}",
		"\t\t\treturn false;",
		"\t\t};",
		"",
		"\t\tconst verifyAssistantModelIdentity = (message: Message): boolean => {",
		"\t\t\tif (!expectedModelForVerification) return true;",
		"\t\t\tconst identity = message as Message & { provider?: unknown; model?: unknown };",
		"\t\t\tconst verificationError = formatSubagentModelVerificationError(",
		"\t\t\t\texpectedModelForVerification,",
		"\t\t\t\tidentity.provider,",
		"\t\t\t\tidentity.model,",
		"\t\t\t\toptions.availableModels,",
		"\t\t\t);",
		"\t\t\treturn verificationError ? terminateForModelVerificationFailure(verificationError) : true;",
		"\t\t};",
		"",
	].join("\n");
	const rawStdoutAnchor = "\t\tconst rawStdoutTail = createBoundedByteTail();";
	if (!patched.includes("const verifyAssistantModelIdentity = (message: Message): boolean =>")) {
		patched = patched.replace(rawStdoutAnchor, `${modelVerificationFunctions}${rawStdoutAnchor}`);
	}
	patched = patched.replace(
		"\t\t\t\tidentity.model,\n\t\t\t);",
		"\t\t\t\tidentity.model,\n\t\t\t\toptions.availableModels,\n\t\t\t);",
	);
	const parsedEventAnchor = [
		"\t\t\tshared.transcriptWriter?.writeChildEvent(evt);",
		'\t\t\tif (evt.type === "agent_settled") agentSettledReceived = true;',
	].join("\n");
	const parsedEventVerification = [
		"\t\t\tshared.transcriptWriter?.writeChildEvent(evt);",
		"\t\t\tif (modelVerificationFailed) return;",
		"\t\t\tif (evt.message?.role === \"assistant\") {",
		"\t\t\t\tif (evt.type === \"message_start\" && !firstAssistantMessageStartSeen) {",
		"\t\t\t\t\tfirstAssistantMessageStartSeen = true;",
		"\t\t\t\t\tif (!verifyAssistantModelIdentity(evt.message)) return;",
		"\t\t\t\t} else if (evt.type === \"message_end\" && !verifyAssistantModelIdentity(evt.message)) {",
		"\t\t\t\t\treturn;",
		"\t\t\t\t}",
		"\t\t\t}",
		'\t\t\tif (evt.type === "agent_settled") agentSettledReceived = true;',
	].join("\n");
	if (!patched.includes('evt.type === "message_start" && !firstAssistantMessageStartSeen')) {
		patched = patched.replace(parsedEventAnchor, parsedEventVerification);
	}
	patched = patched.replace(
		[
			"\t\tconst candidate = modelsToTry[modelIndex];",
			"\t\tfor (let startupAttemptIndex = 0; ; startupAttemptIndex++) {",
			"\t\t\tconst verifyModel = Boolean(candidate);",
			"\t\t\tconst outputSnapshot = captureSingleOutputSnapshot(options.outputPath);",
		].join("\n"),
		[
			"\t\tconst candidate = modelsToTry[modelIndex];",
			"\t\tfor (let startupAttemptIndex = 0; ; startupAttemptIndex++) {",
			"\t\t\tconst verifyModel = Boolean(candidate) && !(options.modelOverrideFromParent && modelIndex === 0);",
			"\t\t\tconst outputSnapshot = captureSingleOutputSnapshot(options.outputPath);",
		].join("\n"),
	);
	patched = addLineAfter(
		patched,
		"for (let startupAttemptIndex = 0; ; startupAttemptIndex++) {",
		"const verifyModel = Boolean(candidate) && !(options.modelOverrideFromParent && modelIndex === 0);",
	);
	patched = addLineAfter(
		patched,
		"originalTask: task,",
		"verifyModel,",
	);
	const original =
		"\t\t\tif (!isRetryableModelFailure(result.error) || modelIndex === modelsToTry.length - 1) break modelAttemptsLoop;";
	const replacement = [
		"\t\t\tif (isContextOverflow(result.error)) {",
		"\t\t\t\tresult.contextOverflow = true;",
		"\t\t\t\tattemptNotes.push(`[fallback] ${attempt.model} failed: context overflow — reduce the task input or use a larger context window.`);",
		"\t\t\t\tbreak modelAttemptsLoop;",
		"\t\t\t}",
		original,
	].join("\n");
	if (!patched.includes("result.contextOverflow = true;")) {
		patched = patched.replace(original, replacement);
	}
	const modelFailureBreakAnchor =
		"\t\t\tif (intercomDetached || result.timedOut || result.turnBudgetExceeded) break modelAttemptsLoop;";
	if (!patched.includes("\t\t\tif (isSubagentModelVerificationFailure(result.error)) break modelAttemptsLoop;")) {
		patched = patched.replace(
			modelFailureBreakAnchor,
			`${modelFailureBreakAnchor}\n\t\t\tif (isSubagentModelVerificationFailure(result.error)) break modelAttemptsLoop;`,
		);
	}
	const toolResultAnchor =
		'\t\t\tif (evt.type === "tool_result_end" && evt.message) {';
	const toolResultReplacement = [
		toolResultAnchor,
		"\t\t\t\t// Some Pi event streams omit tool_execution_end. Treat the completed result as the tool boundary.",
		"\t\t\t\tif (progress.currentTool) {",
		"\t\t\t\t\tprogress.recentTools.push({",
		"\t\t\t\t\t\ttool: progress.currentTool,",
		'\t\t\t\t\t\targs: progress.currentToolArgs || "",',
		"\t\t\t\t\t\tendMs: now,",
		"\t\t\t\t\t});",
		"\t\t\t\t}",
		"\t\t\t\tprogress.currentTool = undefined;",
		"\t\t\t\tprogress.currentToolArgs = undefined;",
		"\t\t\t\tprogress.currentToolStartedAt = undefined;",
		"\t\t\t\tprogress.currentPath = undefined;",
	].join("\n");
	if (!patched.includes("Some Pi event streams omit tool_execution_end.")) {
		patched = patched.replace(toolResultAnchor, toolResultReplacement);
	}
	return patched;
}

function patchBackgroundRunner(source) {
	let patched = source.replace(
		'import { formatModelAttemptNote, isRetryableModelFailure } from "../shared/model-fallback.ts";',
		'import { formatModelAttemptNote, isContextOverflow, isRetryableModelFailure } from "../shared/model-fallback.ts";',
	);
	patched = patched.replace(
		'import { formatModelAttemptNote, isContextOverflow, isRetryableModelFailure } from "../shared/model-fallback.ts";',
		'import { formatModelAttemptNote, formatSubagentModelVerificationError, isContextOverflow, isRetryableModelFailure, isSubagentModelVerificationFailure } from "../shared/model-fallback.ts";',
	);
	patched = patched.replace(
		'import { formatModelAttemptNote, formatSubagentModelVerificationError, isContextOverflow, isRetryableModelFailure } from "../shared/model-fallback.ts";',
		'import { formatModelAttemptNote, formatSubagentModelVerificationError, isContextOverflow, isRetryableModelFailure, isSubagentModelVerificationFailure } from "../shared/model-fallback.ts";',
	);
	patched = addLineAfter(patched, "type ChildMessage = Message & {", "provider?: string;");
	patched = patched.replace(
		[
			"\tregisterTurnBudgetAbort?: (abort: ((message: string, state?: TurnBudgetState) => void) | undefined) => void,",
			'\tonWriterProcess?: (writer: { state: "none" | "spawning" } | { state: "running"; pid: number }) => void,',
			"): Promise<RunPiStreamingResult> {",
		].join("\n"),
		[
			"\tregisterTurnBudgetAbort?: (abort: ((message: string, state?: TurnBudgetState) => void) | undefined) => void,",
			'\tonWriterProcess?: (writer: { state: "none" | "spawning" } | { state: "running"; pid: number }) => void,',
			"\texpectedModelForVerification?: string,",
			"\tmodelVerificationRegistry?: Array<{ provider: string; id: string; fullId: string }>,",
			"): Promise<RunPiStreamingResult> {",
		].join("\n"),
	);
	patched = addLineAfter(
		patched,
		"expectedModelForVerification?: string,",
		"modelVerificationRegistry?: Array<{ provider: string; id: string; fullId: string }>,",
	);
	const weakObservedModelBlock = [
		"\t\t\t\tif (event.message.model) {",
		"\t\t\t\t\tmodel = event.message.model;",
		"\t\t\t\t\tif (expectedModelForVerification) {",
		"\t\t\t\t\t\tconst modelVerificationError = formatSubagentModelVerificationError(expectedModelForVerification, event.message.model, modelVerificationRegistry);",
		"\t\t\t\t\t\tif (modelVerificationError && !error) error = modelVerificationError;",
		"\t\t\t\t\t}",
		"\t\t\t\t}",
	].join("\n");
	patched = patched.replace(weakObservedModelBlock, "\t\t\t\tif (event.message.model) model = event.message.model;");
	const modelVerificationStateAnchor = "\t\tlet assistantError: string | undefined;";
	const modelVerificationState = [
		modelVerificationStateAnchor,
		"\t\tlet modelVerificationFailed = false;",
		"\t\tlet firstAssistantMessageStartSeen = false;",
		"\t\tlet modelVerificationHardKillTimer: NodeJS.Timeout | undefined;",
	].join("\n");
	if (!patched.includes("\t\tlet modelVerificationFailed = false;")) {
		patched = patched.replace(modelVerificationStateAnchor, modelVerificationState);
	}
	const modelVerificationFunctions = [
		"\t\tconst terminateForModelVerificationFailure = (verificationError: string): false => {",
		"\t\t\tmodelVerificationFailed = true;",
		"\t\t\tif (!error) error = verificationError;",
		"\t\t\tif (!childExited) {",
		"\t\t\t\ttrySignalChild(child, \"SIGTERM\");",
		"\t\t\t\tmodelVerificationHardKillTimer ??= setTimeout(() => {",
		"\t\t\t\t\tif (!settled) trySignalChild(child, \"SIGKILL\");",
		"\t\t\t\t}, 1000);",
		"\t\t\t\tmodelVerificationHardKillTimer.unref?.();",
		"\t\t\t}",
		"\t\t\treturn false;",
		"\t\t};",
		"",
		"\t\tconst verifyAssistantModelIdentity = (message: ChildMessage): boolean => {",
		"\t\t\tif (!expectedModelForVerification) return true;",
		"\t\t\tconst verificationError = formatSubagentModelVerificationError(",
		"\t\t\t\texpectedModelForVerification,",
		"\t\t\t\tmessage.provider,",
		"\t\t\t\tmessage.model,",
		"\t\t\t\tmodelVerificationRegistry,",
		"\t\t\t);",
		"\t\t\treturn verificationError ? terminateForModelVerificationFailure(verificationError) : true;",
		"\t\t};",
		"",
	].join("\n");
	const processStdoutAnchor = "\t\tconst processStdoutLine = (line: string) => {";
	if (!patched.includes("const verifyAssistantModelIdentity = (message: ChildMessage): boolean =>")) {
		patched = patched.replace(processStdoutAnchor, `${modelVerificationFunctions}${processStdoutAnchor}`);
	}
	patched = patched.replace(
		"\t\t\t\tmessage.model,\n\t\t\t);",
		"\t\t\t\tmessage.model,\n\t\t\t\tmodelVerificationRegistry,\n\t\t\t);",
	);
	const parsedEventAnchor = [
		"\t\t\tappendChildEvent(event);",
		"\t\t\ttranscriptWriter?.writeChildEvent(event);",
		'\t\t\tif (event.type === "agent_settled") agentSettledReceived = true;',
	].join("\n");
	const parsedEventVerification = [
		"\t\t\tappendChildEvent(event);",
		"\t\t\ttranscriptWriter?.writeChildEvent(event);",
		"\t\t\tif (modelVerificationFailed) return;",
		"\t\t\tif (event.message?.role === \"assistant\") {",
		"\t\t\t\tif (event.type === \"message_start\" && !firstAssistantMessageStartSeen) {",
		"\t\t\t\t\tfirstAssistantMessageStartSeen = true;",
		"\t\t\t\t\tif (!verifyAssistantModelIdentity(event.message)) return;",
		"\t\t\t\t} else if (event.type === \"message_end\" && !verifyAssistantModelIdentity(event.message)) {",
		"\t\t\t\t\treturn;",
		"\t\t\t\t}",
		"\t\t\t}",
		'\t\t\tif (event.type === "agent_settled") agentSettledReceived = true;',
	].join("\n");
	if (!patched.includes('event.type === "message_start" && !firstAssistantMessageStartSeen')) {
		patched = patched.replace(parsedEventAnchor, parsedEventVerification);
	}
	const clearModelVerificationTimerAnchor = [
		"\t\t\tif (protocolHardKillTimer) {",
		"\t\t\t\tclearTimeout(protocolHardKillTimer);",
		"\t\t\t\tprotocolHardKillTimer = undefined;",
		"\t\t\t}",
	].join("\n");
	const clearModelVerificationTimer = [
		clearModelVerificationTimerAnchor,
		"\t\t\tif (modelVerificationHardKillTimer) {",
		"\t\t\t\tclearTimeout(modelVerificationHardKillTimer);",
		"\t\t\t\tmodelVerificationHardKillTimer = undefined;",
		"\t\t\t}",
	].join("\n");
	if (!patched.includes("\t\t\t\tmodelVerificationHardKillTimer = undefined;")) {
		patched = patched.replace(clearModelVerificationTimerAnchor, clearModelVerificationTimer);
	}
	patched = addLineAfter(
		patched,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: imported.modelAttempts,",
		"contextOverflow: imported.contextOverflow,",
	);
	if (!patched.includes("\tlet contextOverflow = false;")) {
		patched = patched.replace(
			"\tlet actualLaunchContractDigest = step.launchContractDigest;",
			"\tlet actualLaunchContractDigest = step.launchContractDigest;\n\tlet contextOverflow = false;",
		);
	}
	patched = patched.replace(
		[
			"\t\tconst candidate = candidates[modelIndex];",
			"\t\tctx.onAttemptStart?.({ model: candidate, thinking: resolveEffectiveThinking(candidate, step.thinking) });",
		].join("\n"),
		[
			"\t\tconst candidate = candidates[modelIndex];",
			"\t\tconst expectedModelForVerification = candidate && !(step.skipPrimaryModelVerification && modelIndex === 0) ? candidate : undefined;",
			"\t\tctx.onAttemptStart?.({ model: candidate, thinking: resolveEffectiveThinking(candidate, step.thinking) });",
		].join("\n"),
	);
	patched = patched.replace(
		"\t\tconst expectedModelForVerification = candidate;",
		"\t\tconst expectedModelForVerification = candidate && !(step.skipPrimaryModelVerification && modelIndex === 0) ? candidate : undefined;",
	);
	patched = patched.replace(
		[
			"\t\t\tctx.registerTurnBudgetAbort,",
			"\t\t\tctx.onWriterProcess,",
			"\t\t);",
		].join("\n"),
		[
			"\t\t\tctx.registerTurnBudgetAbort,",
			"\t\t\tctx.onWriterProcess,",
			"\t\t\texpectedModelForVerification,",
			"\t\t\tstep.modelVerificationRegistry,",
			"\t\t);",
		].join("\n"),
	);
	patched = patched.replace(
		"\t\t\texpectedModelForVerification,\n\t\t);",
		"\t\t\texpectedModelForVerification,\n\t\t\tstep.modelVerificationRegistry,\n\t\t);",
	);
	const retryOriginal =
		"\t\tif (!isRetryableModelFailure(error) || modelIndex === candidates.length - 1) break modelAttemptsLoop;";
	const retryReplacement = [
		"\t\tif (isContextOverflow(error)) {",
		"\t\t\tcontextOverflow = true;",
		"\t\t\tattemptNotes.push(`[fallback] ${attempt.model} failed: context overflow — reduce the task input or use a larger context window.`);",
		"\t\t\tbreak modelAttemptsLoop;",
		"\t\t}",
		retryOriginal,
	].join("\n");
	if (!patched.includes("\t\t\tcontextOverflow = true;")) {
		patched = patched.replace(retryOriginal, retryReplacement);
	}
	const modelFailureBreakAnchor =
		"\t\tif (run.stopped || run.timedOut || ctx.timeoutSignal?.aborted || ctx.stopSignal?.aborted || ctx.skipAcceptance?.()) break modelAttemptsLoop;";
	if (!patched.includes("\t\tif (isSubagentModelVerificationFailure(error)) break modelAttemptsLoop;")) {
		patched = patched.replace(
			modelFailureBreakAnchor,
			`${modelFailureBreakAnchor}\n\t\tif (isSubagentModelVerificationFailure(error)) break modelAttemptsLoop;`,
		);
	}
	patched = replaceAll(
		patched,
		"\t\tmodelAttempts,\n\t\ttotalCost: costSummaryFromAttempts(modelAttempts),",
		"\t\tmodelAttempts,\n\t\tcontextOverflow: contextOverflow || undefined,\n\t\ttotalCost: costSummaryFromAttempts(modelAttempts),",
	);
	const lines = patched.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const match = lines[index].match(
			/^(\s*)(statusPayload\.steps\[[^\n]+)\.modelAttempts = singleResult\.modelAttempts;$/,
		);
		if (!match) continue;
		const contextLine =
			`${match[1]}${match[2]}.contextOverflow = singleResult.contextOverflow;`;
		if (lines[index + 1] !== contextLine) lines.splice(index + 1, 0, contextLine);
	}
	patched = lines.join("\n");
	for (const name of ["pr", "singleResult", "r"]) {
		patched = addLineAfter(
			patched,
			`modelAttempts: ${name}.modelAttempts,`,
			`contextOverflow: ${name}.contextOverflow,`,
		);
	}
	return patched;
}

function patchAsyncExecution(source) {
	let patched = source.replace(
		"import { buildModelCandidates, resolveEffectiveSubagentModel,",
		"import { buildModelCandidates, inheritsParentModel, resolveEffectiveSubagentModel,",
	);
	patched = addLineWithinInterface(
		patched,
		"AsyncSingleParams",
		"modelOverride?: string;",
		"modelOverrideFromParent?: boolean;",
	);
	if (!patched.includes("\t\tconst primaryModelFromParent = inheritsParentModel(s.model, a.model, ctx.currentModel);")) {
		patched = patched.replace(
			"\t\tconst primaryModel = resolveEffectiveSubagentModel(",
			"\t\tconst primaryModelFromParent = inheritsParentModel(s.model, a.model, ctx.currentModel);\n\t\tconst primaryModel = resolveEffectiveSubagentModel(",
		);
	}
	patched = patched.replace(
		"\n\t\t\t),\n\t\t\ttools: a.tools,",
		"\n\t\t\t),\n\t\t\t...(primaryModelFromParent ? { skipPrimaryModelVerification: true } : {}),\n\t\t\ttools: a.tools,",
	);
	patched = addLineAfter(
		patched,
		"...(primaryModelFromParent ? { skipPrimaryModelVerification: true } : {}),",
		"...(availableModels && availableModels.length > 0 ? { modelVerificationRegistry: availableModels } : {}),",
	);
	patched = patched.replace(
		"\n\t\t\t\t\t\tmodelCandidates,\n\t\t\t\t\t\ttools: agentConfig.tools,",
		"\n\t\t\t\t\t\tmodelCandidates,\n\t\t\t\t\t\t...(params.modelOverrideFromParent ? { skipPrimaryModelVerification: true } : {}),\n\t\t\t\t\t\ttools: agentConfig.tools,",
	);
	patched = addLineAfter(
		patched,
		"...(params.modelOverrideFromParent ? { skipPrimaryModelVerification: true } : {}),",
		"...(availableModels && availableModels.length > 0 ? { modelVerificationRegistry: availableModels } : {}),",
	);
	patched = addLineAfter(
		patched,
		"...(model ? { model } : {}),",
		"...(params.modelOverrideFromParent ? { modelOverrideFromParent: true } : {}),",
	);
	return patched;
}

function patchParallelUtils(source) {
	let patched = addLineWithinInterface(
		source,
		"RunnerSubagentStep",
		"modelCandidates?: string[];",
		"/** The primary model is inherited from the parent session and is not an explicit child-model assertion. */",
	);
	patched = addLineWithinInterface(
		patched,
		"RunnerSubagentStep",
		"/** The primary model is inherited from the parent session and is not an explicit child-model assertion. */",
		"skipPrimaryModelVerification?: boolean;",
	);
	patched = addLineWithinInterface(
		patched,
		"RunnerSubagentStep",
		"skipPrimaryModelVerification?: boolean;",
		"modelVerificationRegistry?: Array<{ provider: string; id: string; fullId: string }>;",
	);
	return patched;
}

function patchSubagentExecutor(source) {
	let patched = source.replace(
		"import { buildModelCandidates, normalizeParentModel,",
		"import { buildModelCandidates, inheritsParentModel, normalizeParentModel,",
	);
	patched = patched.replace(
		/(resolveEffectiveSubagentModel\(\n[ \t]*modelOverride,\n)[ \t]*modelOverrideFromParent,\n/g,
		"$1",
	);
	patched = addLineWithinInterface(
		patched,
		"ForegroundParallelRunInput",
		"modelOverrides: (string | undefined)[];",
		"modelOverridesFromParent: boolean[];",
	);
	if (!patched.includes("const modelOverridesFromParent = tasks.map((_, i) =>")) {
		patched = patched.replace(
			[
				"\tconst modelOverrides: (string | undefined)[] = tasks.map((_, i) =>",
				"\t\tresolveEffectiveSubagentModel(behaviorOverrides[i]?.model, agentConfigs[i]?.model, parentModel, availableModels, currentProvider, { scope: data.modelScope }),",
				"\t);",
			].join("\n"),
			[
				"\tconst modelOverrides: (string | undefined)[] = tasks.map((_, i) =>",
				"\t\tresolveEffectiveSubagentModel(behaviorOverrides[i]?.model, agentConfigs[i]?.model, parentModel, availableModels, currentProvider, { scope: data.modelScope }),",
				"\t);",
				"\tconst modelOverridesFromParent = tasks.map((_, i) =>",
				"\t\tinheritsParentModel(behaviorOverrides[i]?.model, agentConfigs[i]?.model, parentModel),",
				"\t);",
			].join("\n"),
		);
	}
	patched = patched.replace(
		[
			"\t\t\t\tmodelOverrides[i] = resolveEffectiveSubagentModel(override.model, agentConfigs[i]?.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });",
			"\t\t\t\tbehaviorOverrides[i]!.model = override.model;",
		].join("\n"),
		[
			"\t\t\t\tmodelOverrides[i] = resolveEffectiveSubagentModel(override.model, agentConfigs[i]?.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });",
			"\t\t\t\tmodelOverridesFromParent[i] = false;",
			"\t\t\t\tbehaviorOverrides[i]!.model = override.model;",
		].join("\n"),
	);
	patched = addLineAfter(patched, "modelOverrides,", "modelOverridesFromParent,");
	patched = addLineAfter(
		patched,
		"modelOverride: input.modelOverrides[index],",
		"modelOverrideFromParent: input.modelOverridesFromParent[index],",
	);
	if (!patched.includes("const modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, a.model, parentModel);")) {
		patched = patched.replace(
			"\t\tconst modelOverride = resolveEffectiveSubagentModel(params.model as string | undefined, a.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });",
			"\t\tconst modelOverride = resolveEffectiveSubagentModel(params.model as string | undefined, a.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });\n\t\tconst modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, a.model, parentModel);",
		);
	}
	if (!patched.includes("let modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, agentConfig.model, parentModel);")) {
		patched = patched.replace(
			"\tlet skillOverride: string[] | false | undefined = normalizeSkillInput(params.skill);",
			"\tlet modelOverrideFromParent = inheritsParentModel(params.model as string | undefined, agentConfig.model, parentModel);\n\tlet skillOverride: string[] | false | undefined = normalizeSkillInput(params.skill);",
		);
	}
	patched = patched.replace(
		"\t\tif (override?.model !== undefined) modelOverride = resolveEffectiveSubagentModel(override.model, agentConfig.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });",
		[
			"\t\tif (override?.model !== undefined) {",
			"\t\t\tmodelOverride = resolveEffectiveSubagentModel(override.model, agentConfig.model, parentModel, availableModels, currentProvider, { scope: data.modelScope });",
			"\t\t\tmodelOverrideFromParent = false;",
			"\t\t}",
		].join("\n"),
	);
	patched = patched.replace(
		/^([ \t]*)modelOverride,\n\1thinkingOverride:/gm,
		"$1modelOverride,\n$1modelOverrideFromParent,\n$1thinkingOverride:",
	);
	patched = addLineAfter(
		patched,
		"modelOverride: recoveryDescriptor?.model ?? target.model,",
		"modelOverrideFromParent: recoveryDescriptor?.modelOverrideFromParent,",
	);
	// Repair candidates produced by the earlier broad shorthand insertion. This
	// is a positional resolver call, not an options object, and model inheritance
	// metadata must never change its argument list.
	patched = patched.replace(
		[
			"\t\t\t\tconst primaryModel = resolveEffectiveSubagentModel(",
			"\t\t\t\t\tmodelOverride,",
			"\t\t\t\t\tmodelOverrideFromParent,",
			"\t\t\t\t\tagentConfig?.model,",
		].join("\n"),
		[
			"\t\t\t\tconst primaryModel = resolveEffectiveSubagentModel(",
			"\t\t\t\t\tmodelOverride,",
			"\t\t\t\t\tagentConfig?.model,",
		].join("\n"),
	);
	return patched;
}

function patchChainExecution(source) {
	let patched = source.replace(
		'import { resolveEffectiveSubagentModel } from "../shared/model-fallback.ts";',
		'import { inheritsParentModel, resolveEffectiveSubagentModel } from "../shared/model-fallback.ts";',
	);
	if (!patched.includes("const effectiveModelsFromParent = input.step.parallel.map((task) =>")) {
		patched = patched.replace(
			"\tfor (let taskIndex = 0; taskIndex < input.step.parallel.length; taskIndex++) {",
			[
				"\tconst effectiveModelsFromParent = input.step.parallel.map((task) => {",
				"\t\tconst taskAgentConfig = input.agents.find((agent) => agent.name === task.agent);",
				"\t\treturn inheritsParentModel(task.model, taskAgentConfig?.model, input.ctx.model);",
				"\t});",
				"\tfor (let taskIndex = 0; taskIndex < input.step.parallel.length; taskIndex++) {",
			].join("\n"),
		);
	}
	if (!patched.includes("const effectiveModelFromParent = inheritsParentModel(explicitStepModel, agentConfig.model, ctx.model);")) {
		patched = patched.replace(
			"\t\t\tconst effectiveModel = resolveEffectiveSubagentModel(",
			"\t\t\tconst effectiveModelFromParent = inheritsParentModel(explicitStepModel, agentConfig.model, ctx.model);\n\t\t\tconst effectiveModel = resolveEffectiveSubagentModel(",
		);
	}
	patched = patched
		.replace("\n\t\t\t\tmodelOverrideFromParent: effectiveModelsFromParent[taskIndex],", "")
		.replace("\n\t\t\t\tmodelOverrideFromParent: effectiveModelFromParent,", "");
	patched = patched.replace(
		"\t\t\t\tmodelOverride: effectiveModel,\n\t\t\t\tavailableModels: input.availableModels,",
		"\t\t\t\tmodelOverride: effectiveModel,\n\t\t\t\tmodelOverrideFromParent: effectiveModelsFromParent[taskIndex],\n\t\t\t\tavailableModels: input.availableModels,",
	);
	patched = patched.replace(
		"\t\t\t\tmodelOverride: effectiveModel,\n\t\t\t\tavailableModels,",
		"\t\t\t\tmodelOverride: effectiveModel,\n\t\t\t\tmodelOverrideFromParent: effectiveModelFromParent,\n\t\t\t\tavailableModels,",
	);
	return patched;
}

function patchAsyncResume(source) {
	let patched = source.replace(
		'"cwd", "model", "fallbackModels",',
		'"cwd", "model", "modelOverrideFromParent", "fallbackModels",',
	);
	if (!patched.includes("parsed.modelOverrideFromParent !== undefined")) {
		patched = patched.replace(
			'\tif (parsed.outputMode !== "inline" && parsed.outputMode !== "file-only") throw new Error(`Invalid async recovery descriptor',
			"\tif (parsed.modelOverrideFromParent !== undefined && typeof parsed.modelOverrideFromParent !== \"boolean\") throw new Error(`Invalid async recovery descriptor '${descriptorPath}': modelOverrideFromParent must be a boolean.`);\n\tif (parsed.outputMode !== \"inline\" && parsed.outputMode !== \"file-only\") throw new Error(`Invalid async recovery descriptor",
		);
	}
	return patched;
}

function patchSharedTypes(source) {
	let patched = addLineAfter(
		source,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineWithinInterface(
		patched,
		"RunSyncOptions",
		"modelOverride?: string;",
		"/** The primary model came from the running parent session rather than an explicit child selection. */",
	);
	patched = addLineWithinInterface(
		patched,
		"RunSyncOptions",
		"/** The primary model came from the running parent session rather than an explicit child selection. */",
		"modelOverrideFromParent?: boolean;",
	);
	patched = addLineWithinInterface(
		patched,
		"SteeringRecoveryDescriptor",
		"model?: string;",
		"modelOverrideFromParent?: boolean;",
	);
	return patched;
}

function patchChainRootAttachment(source) {
	let patched = addLineAfter(
		source,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"...(step?.modelAttempts ? { modelAttempts: step.modelAttempts } : {}),",
		"...(step?.contextOverflow ? { contextOverflow: true } : {}),",
	);
	patched = addLineAfter(
		patched,
		"...(child?.modelAttempts ?? step?.modelAttempts ? { modelAttempts: child?.modelAttempts ?? step?.modelAttempts } : {}),",
		"...(child?.contextOverflow || step?.contextOverflow ? { contextOverflow: true } : {}),",
	);
	return patched;
}

function patchStaleRunReconciler(source) {
	let patched = addLineAfter(
		source,
		'modelAttempts?: NonNullable<AsyncStatus["steps"]>[number]["modelAttempts"];',
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: child?.modelAttempts ?? step.modelAttempts,",
		"contextOverflow: child?.contextOverflow ?? step.contextOverflow,",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: step.modelAttempts,",
		"contextOverflow: step.contextOverflow,",
	);
	return patched;
}

function patchAsyncStatus(source) {
	let patched = addLineAfter(
		source,
		"attemptedModels?: string[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"...(step.attemptedModels ? { attemptedModels: step.attemptedModels } : {}),",
		"...(step.contextOverflow ? { contextOverflow: true } : {}),",
	);
	return patched;
}

function patchParallelFailureResult(source) {
	const marker = "...(ok === 0 ? { isError: true } : {}),";
	if (source.includes(marker)) return source;
	const original = [
		"\t\treturn {",
		"\t\t\tcontent: [{ type: \"text\", text: fullContent }],",
		"\t\t\tdetails,",
		"\t\t};",
	].join("\n");
	const replacement = [
		"\t\treturn {",
		"\t\t\tcontent: [{ type: \"text\", text: fullContent }],",
		`\t\t\t${marker}`,
		"\t\t\tdetails,",
		"\t\t};",
	].join("\n");
	return source.replace(original, replacement);
}

function patchPublicToolBoundary(relativePath, source) {
	let patched = source;
	if (relativePath === "src/extension/index.ts") {
		patched = addAfter(
			patched,
			'export { loadConfig } from "./config.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn executeSubagentCollapsed(id, params, signal, onUpdate, ctx);",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn finalizeToolResult(await executeSubagentCollapsed(id, params, signal, onUpdate, ctx));",
				"\t\t},",
			].join("\n"),
		);
	}
	if (relativePath === "src/extension/fanout-child.ts") {
		patched = addAfter(
			patched,
			'import { type Details, type SubagentState } from "../shared/types.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn executor.execute(id, params as SubagentParamsLike, signal, onUpdate, ctx);",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn finalizeToolResult(await executor.execute(id, params as SubagentParamsLike, signal, onUpdate, ctx));",
				"\t\t},",
			].join("\n"),
		);
	}
	if (relativePath === "src/runs/background/wait-tool.ts") {
		patched = addAfter(
			patched,
			'import { resolveWaitToolConfig, waitForSubagents } from "./subagent-wait.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(_id, params, signal, onUpdate) {",
				"\t\t\treturn waitForSubagents(params, signal, { state, events: pi.events, enabled, onUpdate });",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(_id, params, signal, onUpdate) {",
				"\t\t\treturn finalizeToolResult(await waitForSubagents(params, signal, { state, events: pi.events, enabled, onUpdate }));",
				"\t\t},",
			].join("\n"),
		);
	}
	return patched;
}

export function patchPiSubagentsCorrectness(relativePath, source) {
	let patched = patchPublicToolBoundary(relativePath, source);
	if (relativePath === "src/runs/shared/model-fallback.ts") {
		patched = patchModelFallback(patched);
	} else if (relativePath === "src/runs/foreground/execution.ts") {
		patched = patchForegroundExecution(patched);
	} else if (relativePath === "src/runs/foreground/chain-execution.ts") {
		patched = patchChainExecution(patched);
	} else if (relativePath === "src/runs/foreground/subagent-executor.ts") {
		patched = patchParallelFailureResult(patchSubagentExecutor(patched));
	} else if (relativePath === "src/runs/background/async-execution.ts") {
		patched = patchAsyncExecution(patched);
	} else if (relativePath === "src/runs/background/subagent-runner.ts") {
		patched = patchBackgroundRunner(patched);
	} else if (relativePath === "src/runs/background/async-resume.ts") {
		patched = patchAsyncResume(patched);
	} else if (relativePath === "src/runs/shared/parallel-utils.ts") {
		patched = patchParallelUtils(patched);
	} else if (relativePath === "src/shared/types.ts") {
		patched = patchSharedTypes(patched);
	} else if (relativePath === "src/runs/background/chain-root-attachment.ts") {
		patched = patchChainRootAttachment(patched);
	} else if (relativePath === "src/runs/background/stale-run-reconciler.ts") {
		patched = patchStaleRunReconciler(patched);
	} else if (relativePath === "src/runs/background/async-status.ts") {
		patched = patchAsyncStatus(patched);
	}
	return patched;
}
