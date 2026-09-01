import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	applyPackageRootPatchPlans,
	preflightPackageRootPatch,
} from "./package-root-patch-utils.mjs";

export const PI_OTEL_REQUIRED_VERSION = "0.1.0";
export const PI_OTEL_PATCH_TARGETS = [
	"dist/attrs.js",
	"dist/config.js",
	"dist/index.js",
	"dist/otel/sdk.js",
	"dist/spans.js",
];
const PI_OTEL_BASELINE_SHA256 = Object.freeze({
	"dist/attrs.js": "7eb85b0f07eed0f4d853a1fac949a90c9ee5f5bbea47787b0d9dc5023965303d",
	"dist/config.js": "8850b6aea342a39d7a00e176e36076f577d1426e3694b152ccda7c466ff1e75d",
	"dist/index.js": "79d6b706fa4b91236ce63e8646372a7b7b78c5b5d8dfb30dbba2944b48664bba",
	"dist/otel/sdk.js": "957238066bec2bc97d65c1706325bbbb39e60b0aaf8fcf454655b6ecb0cda2d0",
	"dist/spans.js": "412fba7d9314abe9329c16f14b5b45ef1ad21a4553e61e8d7698f522ff25442a",
});
const PI_OTEL_PUBLISHED_FEYNMAN_0_3_45_SHA256 = Object.freeze({
	"dist/attrs.js": "e18851f6ebc046789640e9f19fbc007d56ac6a9e7956d954c1e83db3b7f4b1a0",
	"dist/config.js": "2fd887e7b91efb381b78d98252a629f049b36dce891214c8051f2c34d93b8a34",
	"dist/index.js": "2d3ffd82eb0c283bee3a7164385590244ee0f1c312f0c3b388dc9fa0b564e553",
	"dist/otel/sdk.js": "28f6677f2b04cd100add17c3d0d09649249d2e8edaa1d58824f3900713c55307",
	"dist/spans.js": "30763e25e1c2db6a2a7ec5cf9907a730840754724ccac1fbffb46d5018a38ffc",
});
const PI_OTEL_PREVIOUS_CANDIDATE_SHA256 = Object.freeze({
	...PI_OTEL_PUBLISHED_FEYNMAN_0_3_45_SHA256,
	"dist/otel/sdk.js": "6a11d061fb67fd214a7b09397eddbe9bddaea1a07a85e071bfcad4d24015c5d3",
});
const PI_OTEL_RELEASE_BLOCKER_SHA256 = Object.freeze({
	...PI_OTEL_PREVIOUS_CANDIDATE_SHA256,
	"dist/config.js": "45d4251b8e6b2de00b4160110faf4ac616e087452ddc8f9330f7460147d4602e",
	"dist/index.js": "d5fda0a4493fbe7b59d4946c4bbe39de22c69e811bbb5acf6fb8079c59dcbd33",
	"dist/otel/sdk.js": "d7828a932fb0976664b8a5664bb216187b8b50c07846bd73e6bf049d11da80f7",
});
const PI_OTEL_PATCHED_SHA256 = Object.freeze({
	"dist/attrs.js": "e18851f6ebc046789640e9f19fbc007d56ac6a9e7956d954c1e83db3b7f4b1a0",
	"dist/config.js": "45d4251b8e6b2de00b4160110faf4ac616e087452ddc8f9330f7460147d4602e",
	"dist/index.js": "f5169b0f47ed9deacee5f8b92e0f40bd5a99d3364efa270c99b635678ce81bf7",
	"dist/otel/sdk.js": "d7828a932fb0976664b8a5664bb216187b8b50c07846bd73e6bf049d11da80f7",
	"dist/spans.js": "30763e25e1c2db6a2a7ec5cf9907a730840754724ccac1fbffb46d5018a38ffc",
});

function digest(source) {
	return createHash("sha256").update(source).digest("hex");
}

export function assertPiOtelPatchedSources(sources, surface = "pi-otel") {
	for (const relativePath of PI_OTEL_PATCH_TARGETS) {
		const source = sources.get(relativePath);
		if (typeof source !== "string") {
			throw new Error(`Incomplete pi-otel patch ${surface}: missing ${relativePath}`);
		}
		const sourceDigest = digest(source);
		if (sourceDigest !== PI_OTEL_PATCHED_SHA256[relativePath]) {
			throw new Error(
				`Incomplete pi-otel patch ${surface} ${relativePath}: expected ${PI_OTEL_PATCHED_SHA256[relativePath]}, found ${sourceDigest}`,
			);
		}
	}
}

export function patchPiOtelSource(relativePath, source) {
	if (!PI_OTEL_PATCH_TARGETS.includes(relativePath)) {
		throw new Error(`Unknown pi-otel patch target: ${relativePath}`);
	}
	let patched = source;

	if (relativePath === "dist/index.js") {
		patched = patched
			.replace(" ATTR_PI_CWD,", "")
			.replace("\n                    [ATTR_PI_CWD]: cfg.cwd,", "")
			.replace("\n            cwd: cfg.cwd,", "")
			.replace(
				"if (await probeEndpoint(cfg.endpoint)) {",
				"if (await probeEndpoint(cfg.endpoint, 300, cfg.headers)) {",
			);
		if (!patched.includes("if (!process.env.FEYNMAN_POSTHOG_KEY)")) {
			patched = patched.replace(
				"            notify(`pi-otel: OTLP endpoint ${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.`);",
				"            if (!process.env.FEYNMAN_POSTHOG_KEY)\n                notify(`pi-otel: OTLP endpoint ${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.`);",
			);
		}
		const misplacedSignalReset =
			'        if (typeof override.endpoint === "string" || typeof override.protocol === "string")\n' +
			"            delete cfg.feynmanOtlpSignals;\n" +
			"        await shutdownSdk();";
		const dashboardOverrideEnd =
			'        if (typeof override.protocol === "string" && override.protocol) {\n' +
			"            cfg.protocol = override.protocol;\n" +
			"        }\n" +
			"        await shutdownSdk();";
		const dashboardSignalReset =
			'        if (typeof override.protocol === "string" && override.protocol) {\n' +
			"            cfg.protocol = override.protocol;\n" +
			"        }\n" +
			'        if (typeof override.endpoint === "string" || typeof override.protocol === "string")\n' +
			"            delete cfg.feynmanOtlpSignals;\n" +
			"        await shutdownSdk();";
		// A pre-release candidate inserted the dashboard-only reset into the
		// earlier session_shutdown handler. Repair that exact shape before
		// placing the reset beside the dashboard override that owns cfg/override.
		patched = patched.replace(misplacedSignalReset, "        await shutdownSdk();");
		if (!patched.includes("delete cfg.feynmanOtlpSignals")) {
			patched = patched.replace(dashboardOverrideEnd, dashboardSignalReset);
		}
	}

	if (relativePath === "dist/otel/sdk.js") {
		const compatibleResourceImport = `import * as otelResources from "@opentelemetry/resources";
const createFeynmanResource = (attributes) => typeof otelResources.resourceFromAttributes === "function"
    ? otelResources.resourceFromAttributes(attributes)
    : new otelResources.Resource(attributes);`;
		const previousSignalRouter = `// Feynman backport: nikiforovall/pi-otel#8 signal-specific HTTP OTLP paths.
export function resolveFeynmanOtlpSignalUrl(endpoint, signal) {
    const parsed = new URL(endpoint);
    const basePath = parsed.pathname.replace(/\\/+$/, "").replace(/\\/v1\\/(?:traces|metrics|logs)$/, "");
    parsed.pathname = \`\${basePath}/v1/\${signal}\`;
    return parsed.toString();
}
function pickByProtocol(cfg, signal, ctors) {
    const url = process.env.FEYNMAN_POSTHOG_KEY || cfg.protocol === "grpc"
        ? cfg.endpoint
        : resolveFeynmanOtlpSignalUrl(cfg.endpoint, signal);
    const opts = { url, headers: cfg.headers };
    if (cfg.protocol === "http/protobuf")
        return new ctors.proto(opts);
    if (cfg.protocol === "http/json")
        return new ctors.http(opts);
    return new ctors.grpc(opts);
}`;
		const signalRouter = `// Feynman backport: nikiforovall/pi-otel#8 signal-specific HTTP OTLP paths.
export function resolveFeynmanOtlpSignalUrl(endpoint, signal) {
    const parsed = new URL(endpoint);
    const basePath = parsed.pathname.replace(/\\/+$/, "").replace(/\\/v1\\/(?:traces|metrics|logs)$/, "");
    parsed.pathname = \`\${basePath}/v1/\${signal}\`;
    return parsed.toString();
}
export function resolveFeynmanOtlpSignalConfig(cfg, signal) {
    const configured = cfg.feynmanOtlpSignals?.[signal];
    const endpoint = configured?.endpoint ?? cfg.endpoint;
    const protocol = configured?.protocol ?? cfg.protocol;
    const headers = configured?.headers ?? cfg.headers;
    const explicitEndpoint = configured?.explicitEndpoint === true ||
        (process.env.FEYNMAN_POSTHOG_KEY && signal === "traces");
    const url = protocol === "grpc" || explicitEndpoint
        ? endpoint
        : resolveFeynmanOtlpSignalUrl(endpoint, signal);
    return { url, protocol, headers };
}
function pickByProtocol(cfg, signal, ctors) {
    const { url, protocol, headers } = resolveFeynmanOtlpSignalConfig(cfg, signal);
    const opts = { url, headers };
    if (protocol === "http/protobuf")
        return new ctors.proto(opts);
    if (protocol === "http/json")
        return new ctors.http(opts);
    return new ctors.grpc(opts);
}`;
		const baselineProtocolRouter = `function pickByProtocol(cfg, ctors) {
    const opts = { url: cfg.endpoint, headers: cfg.headers };
    if (cfg.protocol === "http/protobuf")
        return new ctors.proto(opts);
    if (cfg.protocol === "http/json")
        return new ctors.http(opts);
    return new ctors.grpc(opts);
}`;
		patched = patched
			// pi-otel can resolve its declared OpenTelemetry 1.x dependency in
			// the agent workspace or Feynman's hoisted 2.x runtime dependency.
			.replace('import { Resource } from "@opentelemetry/resources";', compatibleResourceImport)
			.replace('import { resourceFromAttributes } from "@opentelemetry/resources";', compatibleResourceImport)
			.replace('import { ATTR_PI_CWD } from "../attrs.js";\n', "")
			.replace("\n        [ATTR_PI_CWD]: cfg.cwd,", "")
			.replace("const resource = new Resource({", "const resource = createFeynmanResource({")
			.replace("const resource = resourceFromAttributes({", "const resource = createFeynmanResource({")
			.replace(
				"export function probeEndpoint(endpoint, timeoutMs = 300) {",
				"export function probeEndpoint(endpoint, timeoutMs = 300, headers = {}) {",
			)
			.replace(previousSignalRouter, signalRouter)
			.replace(baselineProtocolRouter, signalRouter)
			.replace("const traceExporter = pickByProtocol(cfg, {", 'const traceExporter = pickByProtocol(cfg, "traces", {')
			.replace("const metricExporter = pickByProtocol(cfg, {", 'const metricExporter = pickByProtocol(cfg, "metrics", {')
			.replace("const logExporter = pickByProtocol(cfg, {", 'const logExporter = pickByProtocol(cfg, "logs", {')
			.replace(
				"    // OTLP endpoints always carry an explicit port; refuse to fall back to\n    // 80/443, which could silently green-light an unrelated service.\n    if (!u.port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || \"127.0.0.1\", Number(u.port), timeoutMs);",
				"    const defaultPort = u.protocol === \"https:\" ? 443 : u.protocol === \"http:\" ? 80 : undefined;\n    const port = u.port ? Number(u.port) : defaultPort;\n    if (!port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || \"127.0.0.1\", port, timeoutMs);",
			);
		const oldFeynmanHttpProbe = `    if (process.env.FEYNMAN_POSTHOG_KEY && (u.protocol === "https:" || u.protocol === "http:")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        return fetch(u, { method: "HEAD", signal: controller.signal })
            .then(() => true, () => false)
            .finally(() => clearTimeout(timeout));
    }`;
		const feynmanHttpProbe = `    if (process.env.FEYNMAN_POSTHOG_KEY && (u.protocol === "https:" || u.protocol === "http:")) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        return fetch(u, { method: "OPTIONS", headers, signal: controller.signal })
            .then((response) => response.ok, () => false)
            .finally(() => clearTimeout(timeout));
    }`;
		patched = patched.replace(oldFeynmanHttpProbe, feynmanHttpProbe);
		if (!patched.includes("method: \"OPTIONS\"")) {
			patched = patched.replace(
				"    const defaultPort = u.protocol === \"https:\" ? 443 : u.protocol === \"http:\" ? 80 : undefined;",
				`${feynmanHttpProbe}\n    const defaultPort = u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : undefined;`,
			);
		}
	}

	if (relativePath === "dist/config.js") {
		const baselineConfig = `    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;
		const previousConfig = `    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    };`;
		const signalConfig = `    const sharedEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const sharedProtocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const sharedHeaders = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };
    const createFeynmanSignalConfig = (signal) => {
        const prefix = \`OTEL_EXPORTER_OTLP_\${signal.toUpperCase()}\`;
        const explicitEndpoint = process.env[\`\${prefix}_ENDPOINT\`];
        return {
            endpoint: explicitEndpoint ?? sharedEndpoint,
            protocol: normalizeProtocol(process.env[\`\${prefix}_PROTOCOL\`] ?? sharedProtocol),
            headers: {
                ...sharedHeaders,
                ...parseKvList(process.env[\`\${prefix}_HEADERS\`]),
            },
            explicitEndpoint: explicitEndpoint !== undefined,
        };
    };
    const feynmanOtlpSignals = {
        traces: createFeynmanSignalConfig("traces"),
        metrics: createFeynmanSignalConfig("metrics"),
        logs: createFeynmanSignalConfig("logs"),
    };
    const { endpoint, protocol, headers } = feynmanOtlpSignals.traces;`;
		patched = patched
			.replace(previousConfig, signalConfig)
			.replace(baselineConfig, signalConfig);
		if (!patched.includes("        feynmanOtlpSignals,")) {
			patched = patched.replace(
				"        headers,\n        serviceName,",
				"        headers,\n        feynmanOtlpSignals,\n        serviceName,",
			);
		}
	}

	if (relativePath === "dist/spans.js") {
		patched = patched
			.replace(" ATTR_PI_CWD,", "")
			.replace("\n            [ATTR_PI_CWD]: this.opts.cwd,", "");
	}

	if (relativePath === "dist/attrs.js") {
		patched = patched.replace('export const ATTR_PI_CWD = "pi.cwd";\n', "");
	}

	return patched;
}

export function preflightPiOtelPackageRoot(packageRoot) {
	const plan = preflightPackageRootPatch({
		packageRoot,
		packageName: "pi-otel",
		requiredVersion: PI_OTEL_REQUIRED_VERSION,
		targets: PI_OTEL_PATCH_TARGETS,
		patchSource(relativePath, source) {
			const sourceDigest = digest(source);
				const reviewedDigests = new Set([
					PI_OTEL_BASELINE_SHA256[relativePath],
					PI_OTEL_PUBLISHED_FEYNMAN_0_3_45_SHA256[relativePath],
					PI_OTEL_PREVIOUS_CANDIDATE_SHA256[relativePath],
					PI_OTEL_RELEASE_BLOCKER_SHA256[relativePath],
					PI_OTEL_PATCHED_SHA256[relativePath],
				]);
			if (!reviewedDigests.has(sourceDigest)) {
				throw new Error(
					`Unsupported pi-otel ${PI_OTEL_REQUIRED_VERSION} ${relativePath}: found ${sourceDigest}`,
				);
			}
			return patchPiOtelSource(relativePath, source);
		},
	});
	if (!plan) return undefined;
	assertPiOtelPatchedSources(
		new Map(plan.entries.map((entry) => [entry.relativePath, entry.patched])),
		packageRoot,
	);
	return plan;
}

export function patchPiOtelPackageRoot(packageRoot) {
	return applyPackageRootPatchPlans([preflightPiOtelPackageRoot(packageRoot)]);
}

export async function verifyInstalledPiOtel(installedPackageRoot) {
	const piOtelRoot = resolve(
		installedPackageRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-otel",
	);
	const sources = new Map(
		PI_OTEL_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(resolve(piOtelRoot, ...relativePath.split("/")), "utf8"),
		]),
	);
	assertPiOtelPatchedSources(sources, "installed runtime pi-otel");
	const sdkSource = sources.get("dist/otel/sdk.js");
	const routingStart = sdkSource.indexOf(
		"export function resolveFeynmanOtlpSignalUrl(",
	);
	const routingEnd = sdkSource.indexOf("function pickByProtocol(", routingStart);
	if (routingStart < 0 || routingEnd <= routingStart) {
		throw new Error("Installed pi-otel signal routing helpers are missing");
	}
	const sdk = await import(
		`data:text/javascript;base64,${Buffer.from(sdkSource.slice(routingStart, routingEnd)).toString("base64")}`,
	);
	const shared = {
		endpoint: "https://collector.example/base",
		protocol: "http/protobuf",
		headers: { common: "one" },
	};
	for (const signal of ["traces", "metrics", "logs"]) {
		const actual = sdk.resolveFeynmanOtlpSignalConfig(shared, signal).url;
		const expected = `https://collector.example/base/v1/${signal}`;
		if (actual !== expected) {
			throw new Error(
				`Installed pi-otel ${signal} URL mismatch: expected ${expected}, found ${actual}`,
			);
		}
	}
	const explicit = sdk.resolveFeynmanOtlpSignalConfig({
		...shared,
		feynmanOtlpSignals: {
			metrics: {
				endpoint: "https://metrics.example/custom-ingest",
				protocol: "grpc",
				headers: { Authorization: "metric-token" },
				explicitEndpoint: true,
			},
		},
	}, "metrics");
	if (
		explicit.url !== "https://metrics.example/custom-ingest" ||
		explicit.protocol !== "grpc" ||
		explicit.headers?.Authorization !== "metric-token"
	) {
		throw new Error("Installed pi-otel did not preserve explicit metrics configuration");
	}
	const previousPostHogKey = process.env.FEYNMAN_POSTHOG_KEY;
	process.env.FEYNMAN_POSTHOG_KEY = "installed-verification";
	try {
		const posthog = sdk.resolveFeynmanOtlpSignalConfig({
			endpoint: "https://us.i.posthog.com/i/v0/ai/otel",
			protocol: "http/protobuf",
			headers: { Authorization: "Bearer installed-verification" },
		}, "traces");
		if (posthog.url !== "https://us.i.posthog.com/i/v0/ai/otel") {
			throw new Error(`Installed pi-otel changed PostHog trace URL: ${posthog.url}`);
		}
	} finally {
		if (previousPostHogKey === undefined) {
			delete process.env.FEYNMAN_POSTHOG_KEY;
		} else {
			process.env.FEYNMAN_POSTHOG_KEY = previousPostHogKey;
		}
	}
	return "passed";
}
