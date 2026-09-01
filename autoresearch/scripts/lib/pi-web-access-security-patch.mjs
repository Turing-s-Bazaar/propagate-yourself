const UTILS_NET_IMPORT = 'import net from "node:net";';
const CURL_CONFIG_HELPER_SIGNATURE =
	"function quoteCurlConfigValue(value: string): string {";
const CURL_CONFIG_HELPER = `function quoteCurlConfigValue(value: string): string {
	return \`"\${value
		.replace(/\\\\/g, "\\\\\\\\")
		.replace(/"/g, '\\\\"')
		.replace(/\\t/g, "\\\\t")
		.replace(/\\r/g, "\\\\r")
		.replace(/\\n/g, "\\\\n")}"\`;
}

`;
const CURL_SECRET_ARGS_ORIGINAL = `	const args: string[] = [
		"--silent",
		"--show-error",
		"--compressed",
		"--connect-timeout", "20",
		"-x", proxyUrl,
		"-D", headerFile,
		"--output", bodyFile,
		"--write-out", "%{json}",
	];`;
const CURL_SECRET_ARGS_PATCHED = `	const args: string[] = [
		"--silent",
		"--show-error",
		"--compressed",
		"--connect-timeout", "20",
		"-D", headerFile,
		"--output", bodyFile,
		"--write-out", "%{json}",
		"--config", "-",
	];
	const configLines = [\`proxy = \${quoteCurlConfigValue(proxyUrl)}\`];`;
const UTILS_PROXY_BYPASS_ORIGINAL = `function noProxyEntryMatches(hostname: string, entry: string): boolean {
	if (!entry) return false;
	if (entry === "*") return true;
	let host = entry;
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close > 0) host = host.slice(0, close + 1);
	} else {
		const colon = host.lastIndexOf(":");
		if (colon > -1 && /^\\d+$/.test(host.slice(colon + 1))) host = host.slice(0, colon);
	}
	host = host.toLowerCase().replace(/^\\[|\\]$/g, "");
	if (!host) return false;
	return hostname === host || hostname.endsWith(host.startsWith(".") ? host : \`.\${host}\`);
}

/** True when a URL must NOT be sent through the active proxy. */
export function isProxyBypassedUrl(url: URL): boolean {
	const hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
	if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1") return true;
	const noProxy = process.env.NO_PROXY || process.env.no_proxy;
	if (noProxy && noProxy.split(",").some((entry) => noProxyEntryMatches(hostname, entry.trim()))) return true;
	return false;
}`;
const UTILS_PROXY_BYPASS_PATCHED = `const PROXY_ENV_NAMES = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"http_proxy",
	"https_proxy",
	"all_proxy",
] as const;

function normalizeProxyHostname(value: string): string {
	return value.toLowerCase().replace(/^\\[|\\]$/g, "").replace(/\\.$/, "");
}

function isIpv4Loopback(hostname: string): boolean {
	return net.isIP(hostname) === 4 && hostname.split(".")[0] === "127";
}

function isIpv4MappedLoopback(hostname: string): boolean {
	const dotted = /^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$/i.exec(hostname)?.[1];
	if (dotted) return isIpv4Loopback(dotted);
	const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
	return hexadecimal ? (Number.parseInt(hexadecimal[1], 16) >>> 8) === 127 : false;
}

function isLoopbackProxyHost(hostname: string): boolean {
	return hostname === "localhost"
		|| hostname.endsWith(".localhost")
		|| hostname === "::1"
		|| isIpv4Loopback(hostname)
		|| isIpv4MappedLoopback(hostname);
}

function parseNoProxyEntry(entry: string): { hostname: string; port?: string } | null {
	const trimmed = entry.trim();
	if (!trimmed) return null;
	if (trimmed === "*") return { hostname: "*" };
	let hostname = trimmed;
	let port: string | undefined;
	if (hostname.startsWith("[")) {
		const close = hostname.indexOf("]");
		if (close <= 0) return null;
		const suffix = hostname.slice(close + 1);
		if (suffix && !/^:\\d+$/.test(suffix)) return null;
		if (suffix) port = suffix.slice(1);
		hostname = hostname.slice(1, close);
	} else {
		const colon = hostname.lastIndexOf(":");
		if (colon > -1 && hostname.indexOf(":") === colon && /^\\d+$/.test(hostname.slice(colon + 1))) {
			port = hostname.slice(colon + 1);
			hostname = hostname.slice(0, colon);
		}
	}
	hostname = normalizeProxyHostname(hostname).replace(/^\\*?\\./, "");
	return hostname ? { hostname, ...(port ? { port } : {}) } : null;
}

function noProxyEntryMatches(url: URL, entry: string): boolean {
	const parsed = parseNoProxyEntry(entry);
	if (!parsed) return false;
	if (parsed.hostname === "*") return true;
	const hostname = normalizeProxyHostname(url.hostname);
	const port = url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
	if (parsed.port !== undefined && parsed.port !== port) return false;
	if (net.isIP(parsed.hostname) !== 0) return hostname === parsed.hostname;
	return hostname === parsed.hostname || hostname.endsWith(\`.\${parsed.hostname}\`);
}

/** True when a URL must NOT be sent through the active proxy. */
export function isProxyBypassedUrl(url: URL): boolean {
	const hostname = normalizeProxyHostname(url.hostname);
	if (isLoopbackProxyHost(hostname)) return true;
	const noProxy = process.env.NO_PROXY || process.env.no_proxy;
	return !!noProxy && noProxy.split(",").some((entry) => noProxyEntryMatches(url, entry));
}

/** Child-process environment matching the current per-call proxy decision. */
export function getProxyProcessEnv(rawUrl: string | URL): NodeJS.ProcessEnv {
	const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
	const proxy = getActiveProxy();
	if (!hasScopedProxyDecision() && !proxy) return { ...process.env };
	const env = { ...process.env };
	for (const name of PROXY_ENV_NAMES) delete env[name];
	if (proxy && !isProxyBypassedUrl(url)) {
		for (const name of PROXY_ENV_NAMES) env[name] = proxy;
	}
	return env;
}`;

export function patchProxyUtilitySource(source) {
	let patched = source;
	if (!patched.includes(UTILS_NET_IMPORT)) {
		const pathImport = 'import { join } from "node:path";';
		if (patched.includes(pathImport)) {
			patched = patched.replace(pathImport, `${UTILS_NET_IMPORT}\n${pathImport}`);
		}
	}
	if (patched.includes(UTILS_PROXY_BYPASS_ORIGINAL)) {
		patched = patched.replace(UTILS_PROXY_BYPASS_ORIGINAL, UTILS_PROXY_BYPASS_PATCHED);
	}
	if (!patched.includes(CURL_CONFIG_HELPER_SIGNATURE)) {
		patched = patched.replace(
			"async function fetchViaCurlOnce(url: URL, init: RequestInit, proxyUrl: string): Promise<Response> {",
			`${CURL_CONFIG_HELPER}async function fetchViaCurlOnce(url: URL, init: RequestInit, proxyUrl: string): Promise<Response> {`,
		);
	}
	patched = patched
		.replace(CURL_SECRET_ARGS_ORIGINAL, CURL_SECRET_ARGS_PATCHED)
		.replace(
			'		args.push("-H", `${name}: ${value}`);',
			'		configLines.push(`header = ${quoteCurlConfigValue(`${name}: ${value}`)}`);',
		)
		.replace(
			"	args.push(url.toString());",
			"	configLines.push(`url = ${quoteCurlConfigValue(url.toString())}`);",
		)
		.replace(
			'			const child = spawn("curl", args, { windowsHide: true });',
			'			const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });',
		);
	if (!patched.includes('child.stdin?.end(`${configLines.join("\\n")}\\n`);')) {
		patched = patched.replace(
			"			const onAbort = () => { try { child.kill(); } catch {} };",
			'			const onAbort = () => { try { child.kill(); } catch {} };\n' +
				'			child.stdin?.on("error", () => {});\n' +
				'			child.stdin?.end(`${configLines.join("\\n")}\\n`);',
		);
	}
	return patched;
}

const SSRF_NO_PROXY_HELPER_ORIGINAL = `function hostnameMatchesNoProxy(hostname: string, port: string, entry: string): boolean {
	const trimmed = entry.trim();
	if (!trimmed) return false;
	if (trimmed === "*") return true;

	// NO_PROXY entries may include a port. Strip it only after handling
	// bracketed IPv6 literals, which can contain several colons.
	let hostEntry = trimmed;
	let entryPort: string | undefined;
	if (hostEntry.startsWith("[")) {
		const closingBracket = hostEntry.indexOf("]");
		if (closingBracket >= 0) {
			const suffix = hostEntry.slice(closingBracket + 1);
			if (/^:\\d+$/.test(suffix)) entryPort = suffix.slice(1);
			hostEntry = hostEntry.slice(0, closingBracket + 1);
		}
	} else {
		const colon = hostEntry.lastIndexOf(":");
		if (colon > -1 && /^\\d+$/.test(hostEntry.slice(colon + 1))) {
			entryPort = hostEntry.slice(colon + 1);
			hostEntry = hostEntry.slice(0, colon);
		}
	}
	if (entryPort !== undefined && entryPort !== port) return false;

	const normalizedEntry = normalizeHostname(hostEntry);
	if (!normalizedEntry) return false;
	if (normalizedEntry === hostname) return true;
	const suffix = normalizedEntry.startsWith("*.")
		? normalizedEntry.slice(1)
		: normalizedEntry.startsWith(".")
			? normalizedEntry
			: \`.\${normalizedEntry}\`;
	return hostname.endsWith(suffix);
}

`;
const SSRF_TRUST_ENV_PROXY_ORIGINAL = `function shouldTrustEnvProxy(url: URL, enabled: boolean): boolean {
	if (!enabled || !getProxyForProtocol(url.protocol)) return false;
	if (hasScopedProxyDecision()) return false;
	const activeProxy = getActiveProxy();
	if (activeProxy && !isProxyBypassedUrl(url)) return false;
	const hostname = normalizeHostname(url.hostname);
	const port = url.port || (url.protocol === "https:" ? "443" : "80");
	const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
	return !noProxy.split(",").some(entry => hostnameMatchesNoProxy(hostname, port, entry));
}`;
const SSRF_TRUST_ENV_PROXY_PATCHED = `function shouldTrustEnvProxy(url: URL, enabled: boolean): boolean {
	if (!enabled || !getProxyForProtocol(url.protocol)) return false;
	if (hasScopedProxyDecision()) return false;
	const activeProxy = getActiveProxy();
	if (activeProxy && !isProxyBypassedUrl(url)) return false;
	return !isProxyBypassedUrl(url);
}`;

export function patchSsrfNoProxySource(source) {
	let patched = source;
	const helperStart = patched.indexOf("function hostnameMatchesNoProxy(");
	const trustStart = patched.indexOf("function shouldTrustEnvProxy(");
	if (helperStart >= 0 && trustStart > helperStart) {
		patched = `${patched.slice(0, helperStart)}${patched.slice(trustStart)}`;
	}
	return patched.replace(
		SSRF_TRUST_ENV_PROXY_ORIGINAL,
		SSRF_TRUST_ENV_PROXY_PATCHED,
	);
}

export const GITHUB_PROXY_IMPORT =
	'import { getProxyProcessEnv } from "./utils.ts";';

export function patchGitHubApiProxySource(source) {
	let patched = source;
	const typeImport = 'import type { GitHubUrlInfo } from "./github-extract.ts";';
	if (!patched.includes(GITHUB_PROXY_IMPORT) && patched.includes(typeImport)) {
		patched = patched.replace(typeImport, `${typeImport}\n${GITHUB_PROXY_IMPORT}`);
	}
	for (const [original, replacement] of [
		[
			'{ timeout: 5000, ...(signal ? { signal } : {}) }',
			'{ timeout: 5000, ...(signal ? { signal } : {}), env: getProxyProcessEnv("https://github.com") }',
		],
		[
			'{ timeout: 10000 }',
			'{ timeout: 10000, env: getProxyProcessEnv("https://github.com") }',
		],
		[
			'{ timeout: 15000, maxBuffer: 5 * 1024 * 1024 }',
			'{ timeout: 15000, maxBuffer: 5 * 1024 * 1024, env: getProxyProcessEnv("https://github.com") }',
		],
		[
			'{ timeout: 10000, maxBuffer: 2 * 1024 * 1024 }',
			'{ timeout: 10000, maxBuffer: 2 * 1024 * 1024, env: getProxyProcessEnv("https://github.com") }',
		],
	]) {
		patched = patched.split(original).join(replacement);
	}
	return patched;
}

export function patchGitHubIssueProxySource(source) {
	let patched = source;
	const configImport = 'import { getWebSearchConfigPath } from "./utils.ts";';
	const proxyImport =
		'import { getProxyProcessEnv, getWebSearchConfigPath } from "./utils.ts";';
	if (patched.includes(configImport)) patched = patched.replace(configImport, proxyImport);
	patched = patched.replace(
		'env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },',
		'env: { ...getProxyProcessEnv("https://github.com"), GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },',
	);
	return patched;
}

export function patchGitHubCloneProxySource(source) {
	let patched = source;
	const configImport = 'import { getWebSearchConfigPath } from "./utils.ts";';
	const proxyImport =
		'import { getProxyProcessEnv, getWebSearchConfigPath } from "./utils.ts";';
	if (patched.includes(configImport)) patched = patched.replace(configImport, proxyImport);
	patched = patched.replace(
		"				...process.env,\n" +
			'				GIT_TERMINAL_PROMPT: "0",',
		'				...getProxyProcessEnv("https://github.com"),\n' +
			'				GIT_TERMINAL_PROMPT: "0",',
	);
	return patched;
}

const GEMINI_ADC_DEFAULT_PATH_ORIGINAL =
	'const DEFAULT_ADC_PATH = join(homedir(), ".config", "gcloud", "application_default_credentials.json");';
const GEMINI_ADC_DEFAULT_PATH_PATCHED = `export function getDefaultAdcPath(
	currentPlatform: NodeJS.Platform = process.platform,
	environment: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string {
	const appData = environment.APPDATA?.trim();
	if (currentPlatform === "win32" && appData) {
		return win32.join(appData, "gcloud", "application_default_credentials.json");
	}
	return join(home, ".config", "gcloud", "application_default_credentials.json");
}`;
const GEMINI_ADC_GET_PATH_ORIGINAL = `function getAdcPath(): string {
	return process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || DEFAULT_ADC_PATH;
}`;
const GEMINI_ADC_GET_PATH_PATCHED = `function getAdcPath(): string {
	return process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || getDefaultAdcPath();
}`;

export function patchGeminiAdcPathSource(source) {
	return source
		.replace('import { join } from "node:path";', 'import { join, win32 } from "node:path";')
		.replace(GEMINI_ADC_DEFAULT_PATH_ORIGINAL, GEMINI_ADC_DEFAULT_PATH_PATCHED)
		.replace(GEMINI_ADC_GET_PATH_ORIGINAL, GEMINI_ADC_GET_PATH_PATCHED);
}
