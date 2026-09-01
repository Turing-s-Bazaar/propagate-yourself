import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION = "0.4.1";
export const PI_BTW_MODEL_RUNTIME_PATCH_TARGETS = Object.freeze([
	"extensions/btw.ts",
]);
export const PI_BTW_MODEL_RUNTIME_PATCH_MARKER =
	"Feynman backport: dbachelder/pi-btw#30 ModelRuntime propagation";
const PI_BTW_MODEL_RUNTIME_BASELINE_SHA256 =
	"74f411f75b97af69bf8f6f5246dff8c7bfa3fa691d9a98004da7db83afa8f124";
const PI_BTW_MODEL_RUNTIME_PATCHED_SHA256 =
	"8e3439ddc0f4c7b66535ecdf24b218c5911cdc4e2a0b7affc9f9dbce90b93ca6";
const PI_BTW_MODEL_RUNTIME_LEGACY_PATCHED_SHA256 =
	"aa6ff68f1b6a3fb5864a12fb44f990f2e7c95e177c692f6e70a3b2643322b0a4";

function digest(source) {
	return createHash("sha256").update(source).digest("hex");
}

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	if (countOccurrences(source, original) !== 1) {
		throw new Error(
			`Unsupported pi-btw ${PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION} ${label} layout`,
		);
	}
	return source.replace(original, replacement);
}

const MODEL_RUNTIME_HELPER = `// ${PI_BTW_MODEL_RUNTIME_PATCH_MARKER}.
// Remove after a released pi-btw includes upstream PR #30.
export async function createFeynmanBtwModelRuntime(
  ctx: ExtensionCommandContext,
  model: SessionModel,
): Promise<ModelRuntime | undefined> {
  const nativeProvider = ctx.modelRegistry.getRegisteredNativeProvider(model.provider);
  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  const hasRuntimeApiKey = ctx.modelRegistry.getProviderAuthStatus(model.provider).source === "runtime";
  let runtimeApiKey: string | undefined;

  if (hasRuntimeApiKey) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || typeof auth.apiKey !== "string" || auth.apiKey.trim().length === 0) {
      const reason = auth.ok ? "no nonempty runtime API key was returned" : auth.error;
      throw new Error(\`Unable to copy the temporary runtime API key for \${model.provider}/\${model.id}: \${reason}\`);
    }
    runtimeApiKey = auth.apiKey;
  }

  if (!nativeProvider && !providerConfig && !runtimeApiKey) {
    return undefined;
  }

  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  if (nativeProvider) {
    modelRuntime.registerNativeProvider(nativeProvider);
  } else if (providerConfig) {
    modelRuntime.registerProvider(model.provider, providerConfig);
  }
  await modelRuntime.refresh({ allowNetwork: false });

  if (runtimeApiKey) {
    await modelRuntime.setRuntimeApiKey(model.provider, runtimeApiKey);
  }

  return modelRuntime;
}
`;

export function assertPiBtwModelRuntimePatchedSource(
	source,
	surface = "pi-btw source",
) {
	const sourceDigest = digest(source);
	if (sourceDigest !== PI_BTW_MODEL_RUNTIME_PATCHED_SHA256) {
		throw new Error(
			`Incomplete pi-btw ModelRuntime patch ${surface}: expected ${PI_BTW_MODEL_RUNTIME_PATCHED_SHA256}, found ${sourceDigest}`,
		);
	}
	for (const [fragment, expected] of [
		[PI_BTW_MODEL_RUNTIME_PATCH_MARKER, 1],
		["  ModelRuntime,", 1],
		["export async function createFeynmanBtwModelRuntime(", 1],
		["ModelRuntime.create({ allowModelNetwork: false })", 1],
		["modelRuntime.registerNativeProvider(nativeProvider)", 1],
			["modelRuntime.registerProvider(model.provider, providerConfig)", 1],
			["modelRuntime.refresh({ allowNetwork: false })", 1],
			["let runtimeApiKey: string | undefined;", 1],
			['typeof auth.apiKey !== "string" || auth.apiKey.trim().length === 0', 1],
			["Unable to copy the temporary runtime API key for", 1],
			["modelRuntime.setRuntimeApiKey(model.provider, runtimeApiKey)", 1],
			["const modelRuntime = await createFeynmanBtwModelRuntime(ctx, settings.model);", 1],
		["const modelRuntime = await createFeynmanBtwModelRuntime(ctx, model);", 1],
		["...(modelRuntime ? { modelRuntime } : {}),", 2],
	]) {
		const actual = countOccurrences(source, fragment);
		if (actual !== expected) {
			throw new Error(
				`Incomplete pi-btw ModelRuntime patch ${surface}: expected ${expected} occurrences of ${fragment}, found ${actual}`,
			);
		}
	}
	if (
		source.includes(
			'modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"]',
		)
	) {
		throw new Error(
			`Incomplete pi-btw ModelRuntime patch ${surface}: retained legacy child modelRegistry`,
		);
	}
}

export function patchPiBtwModelRuntimeSource(relativePath, source) {
	if (!PI_BTW_MODEL_RUNTIME_PATCH_TARGETS.includes(relativePath)) {
		throw new Error(`Unknown pi-btw ModelRuntime patch target: ${relativePath}`);
	}
	const sourceDigest = digest(source);
	if (sourceDigest === PI_BTW_MODEL_RUNTIME_PATCHED_SHA256) {
		assertPiBtwModelRuntimePatchedSource(source, relativePath);
		return source;
	}
	if (sourceDigest === PI_BTW_MODEL_RUNTIME_LEGACY_PATCHED_SHA256) {
		const helperStart = source.indexOf(
			`// ${PI_BTW_MODEL_RUNTIME_PATCH_MARKER}.`,
		);
		const helperEnd = source.indexOf(
			'function extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {',
			helperStart,
		);
		if (helperStart === -1 || helperEnd === -1) {
			throw new Error(
				`Unsupported pi-btw ${PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION} legacy ModelRuntime helper layout`,
			);
		}
		const upgraded =
			source.slice(0, helperStart) +
			MODEL_RUNTIME_HELPER +
			"\n" +
			source.slice(helperEnd);
		assertPiBtwModelRuntimePatchedSource(upgraded, `${relativePath} legacy upgrade`);
		return upgraded;
	}
	if (sourceDigest !== PI_BTW_MODEL_RUNTIME_BASELINE_SHA256) {
		throw new Error(
			`Unsupported pi-btw ${PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION} ${relativePath}: expected reviewed baseline or patched source, found ${sourceDigest}`,
		);
	}

	let patched = replaceRequired(
		source,
		`  createExtensionRuntime,
  SessionManager,`,
		`  createExtensionRuntime,
  ModelRuntime,
  SessionManager,`,
		"coding-agent import",
	);
	patched = replaceRequired(
		patched,
		"function extractText(parts: AssistantMessage[\"content\"], type: \"text\" | \"thinking\"): string {",
		`${MODEL_RUNTIME_HELPER}
function extractText(parts: AssistantMessage["content"], type: "text" | "thinking"): string {`,
		"runtime helper anchor",
	);
	patched = replaceRequired(
		patched,
		`    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: settings.model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],`,
		`    const modelRuntime = await createFeynmanBtwModelRuntime(ctx, settings.model);
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model: settings.model,
      ...(modelRuntime ? { modelRuntime } : {}),`,
		"BTW child session",
	);
	patched = replaceRequired(
		patched,
		`    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],`,
		`    const modelRuntime = await createFeynmanBtwModelRuntime(ctx, model);
    const { session } = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      ...(modelRuntime ? { modelRuntime } : {}),`,
		"BTW summary child session",
	);

	assertPiBtwModelRuntimePatchedSource(patched, relativePath);
	return patched;
}

export function patchPiBtwModelRuntimePackageRoot(packageRoot) {
	if (!existsSync(packageRoot)) return false;
	const manifestPath = resolve(packageRoot, "package.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`pi-btw package manifest is missing: ${manifestPath}`);
	}
	const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
	if (version !== PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported pi-btw ModelRuntime package ${packageRoot}: expected ${PI_BTW_MODEL_RUNTIME_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
	const relativePath = PI_BTW_MODEL_RUNTIME_PATCH_TARGETS[0];
	const entryPath = resolve(packageRoot, relativePath);
	if (!existsSync(entryPath)) {
		throw new Error(`pi-btw ModelRuntime patch target is missing: ${entryPath}`);
	}
	const source = readFileSync(entryPath, "utf8");
	const patched = patchPiBtwModelRuntimeSource(relativePath, source);
	if (patched === source) return false;
	writeFileSync(entryPath, patched, "utf8");
	return true;
}
