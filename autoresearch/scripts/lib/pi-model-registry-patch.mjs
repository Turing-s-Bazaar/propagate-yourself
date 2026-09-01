// Issue #171: a models.json provider header or API key containing characters
// above U+00FF (e.g. Chinese text) makes undici's fetch throw the cryptic
// "Cannot convert argument to a ByteString because the character at index N
// has a value of M which is greater than 255" with no hint of which config
// value caused it. Validate at request-assembly time and name the exact
// provider and header instead; the surrounding try/catch in
// getApiKeyAndHeaders turns the throw into a readable model error.
const LATIN1_GUARD_HELPER = [
	"function findNonLatin1CharIndex(value) {",
	'    if (typeof value !== "string") return -1;',
	"    for (let index = 0; index < value.length; index++) {",
	"        if (value.charCodeAt(index) > 255) return index;",
	"    }",
	"    return -1;",
	"}",
	"function assertHeaderSafeRequestConfig(provider, apiKey, headers) {",
	"    const apiKeyIndex = findNonLatin1CharIndex(apiKey);",
	"    if (apiKeyIndex !== -1) {",
	"        throw new Error(`The API key for provider \"${provider}\" contains a non-Latin-1 character at index ${apiKeyIndex} (code point ${apiKey.codePointAt(apiKeyIndex)}). HTTP headers cannot carry characters above U+00FF - check models.json or your stored auth for stray non-ASCII characters.`);",
	"    }",
	"    for (const [headerName, headerValue] of Object.entries(headers ?? {})) {",
	'        const value = typeof headerValue === "string" ? headerValue : String(headerValue);',
	"        const nameIndex = findNonLatin1CharIndex(headerName);",
	"        const valueIndex = findNonLatin1CharIndex(value);",
	"        if (nameIndex === -1 && valueIndex === -1) continue;",
	"        const offending = nameIndex !== -1 ? headerName : value;",
	"        const offendingIndex = nameIndex !== -1 ? nameIndex : valueIndex;",
	"        throw new Error(`Header \"${headerName}\" for provider \"${provider}\" contains a non-Latin-1 character at index ${offendingIndex} (code point ${offending.codePointAt(offendingIndex)}). HTTP headers cannot carry characters above U+00FF - remove or URL-encode the value in models.json.`);",
	"    }",
	"}",
].join("\n");

const RETURN_ORIGINAL = [
	"            return {",
	"                ok: true,",
	"                apiKey,",
	"                headers: headers && Object.keys(headers).length > 0 ? headers : undefined,",
	"            };",
].join("\n");

const RETURN_PATCHED = [
	"            assertHeaderSafeRequestConfig(model.provider, apiKey, headers);",
	RETURN_ORIGINAL,
].join("\n");

const HELPER_ANCHOR = "function formatValidationPath(error) {";
const CURRENT_REGISTRY_HELPER_ANCHOR = "export class ModelRegistry {";
const CURRENT_COMPATIBILITY_RETURN_ORIGINAL = "                return { ok: true, headers };";
const CURRENT_COMPATIBILITY_RETURN_PATCHED = [
	"                assertHeaderSafeRequestConfig(model.provider, undefined, headers);",
	CURRENT_COMPATIBILITY_RETURN_ORIGINAL,
].join("\n");
const CURRENT_RESOLVED_RETURN_ORIGINAL =
	"            return { ok: true, apiKey: resolution.auth.apiKey, headers, env: resolution.env };";
const CURRENT_RESOLVED_RETURN_PATCHED = [
	"            assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, headers);",
	CURRENT_RESOLVED_RETURN_ORIGINAL,
].join("\n");
const MODERN_COMPATIBILITY_RETURN_ORIGINAL =
	"                return { ok: true, headers: compatibility.headers };";
const MODERN_COMPATIBILITY_RETURN_PATCHED = [
	"                assertHeaderSafeRequestConfig(model.provider, undefined, compatibility.headers);",
	MODERN_COMPATIBILITY_RETURN_ORIGINAL,
].join("\n");
const MODERN_RESOLVED_RETURN_ORIGINAL = [
	"            return {",
	"                ok: true,",
	"                apiKey: resolution.auth.apiKey,",
	"                headers: resolution.auth.headers,",
	"                ...(resolution.auth.baseUrl ? { baseUrl: resolution.auth.baseUrl } : {}),",
	"                env: resolution.env,",
	"            };",
].join("\n");
const MODERN_RESOLVED_RETURN_PATCHED = [
	"            assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, resolution.auth.headers);",
	MODERN_RESOLVED_RETURN_ORIGINAL,
].join("\n");
const RUNTIME_HELPER_ANCHOR = "function mergeHeaders(base, override) {";
const RUNTIME_REQUEST_AUTH = [
	"        if (transformHeaders)",
	"            headers = await transformHeaders(headers ?? {});",
].join("\n");
const RUNTIME_REQUEST_AUTH_PATCHED = [
	RUNTIME_REQUEST_AUTH,
	"        assertHeaderSafeRequestConfig(model.provider, providerOptions.apiKey ?? resolution.auth.apiKey, headers);",
].join("\n");

export function patchPiModelRegistrySource(source) {
	if (source.includes("function assertHeaderSafeRequestConfig(")) {
		return source;
	}
	if (source.includes(RETURN_ORIGINAL) && source.includes(HELPER_ANCHOR)) {
		let patched = source.replace(RETURN_ORIGINAL, RETURN_PATCHED);
		patched = patched.replace(HELPER_ANCHOR, `${LATIN1_GUARD_HELPER}\n${HELPER_ANCHOR}`);
		return patched;
	}
	if (
		source.includes(CURRENT_COMPATIBILITY_RETURN_ORIGINAL) &&
		source.includes(CURRENT_RESOLVED_RETURN_ORIGINAL) &&
		source.includes(CURRENT_REGISTRY_HELPER_ANCHOR)
	) {
		let patched = source.replace(
			CURRENT_COMPATIBILITY_RETURN_ORIGINAL,
			CURRENT_COMPATIBILITY_RETURN_PATCHED,
		);
		patched = patched.replace(
			CURRENT_RESOLVED_RETURN_ORIGINAL,
			CURRENT_RESOLVED_RETURN_PATCHED,
		);
		patched = patched.replace(
			CURRENT_REGISTRY_HELPER_ANCHOR,
			`${LATIN1_GUARD_HELPER}\n${CURRENT_REGISTRY_HELPER_ANCHOR}`,
		);
		return patched;
	}
	if (
		source.includes(MODERN_COMPATIBILITY_RETURN_ORIGINAL) &&
		source.includes(MODERN_RESOLVED_RETURN_ORIGINAL) &&
		source.includes(CURRENT_REGISTRY_HELPER_ANCHOR)
	) {
		let patched = source.replace(
			MODERN_COMPATIBILITY_RETURN_ORIGINAL,
			MODERN_COMPATIBILITY_RETURN_PATCHED,
		);
		patched = patched.replace(
			MODERN_RESOLVED_RETURN_ORIGINAL,
			MODERN_RESOLVED_RETURN_PATCHED,
		);
		patched = patched.replace(
			CURRENT_REGISTRY_HELPER_ANCHOR,
			`${LATIN1_GUARD_HELPER}\n${CURRENT_REGISTRY_HELPER_ANCHOR}`,
		);
		return patched;
	}
	if (source.includes(RUNTIME_REQUEST_AUTH) && source.includes(RUNTIME_HELPER_ANCHOR)) {
		let patched = source.replace(RUNTIME_REQUEST_AUTH, RUNTIME_REQUEST_AUTH_PATCHED);
		patched = patched.replace(RUNTIME_HELPER_ANCHOR, `${LATIN1_GUARD_HELPER}\n${RUNTIME_HELPER_ANCHOR}`);
		return patched;
	}
	if (source.includes("class ModelRuntime")) {
		throw new Error("Unsupported Pi ModelRuntime layout: required request-auth patch anchor was not found");
	}
	if (source.includes("class ModelRegistry")) {
		throw new Error("Unsupported Pi ModelRegistry layout: required request-auth patch anchors were not found");
	}
	return source;
}
