import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
	assertPiOtelPatchedSources,
	PI_OTEL_PATCH_TARGETS,
	patchPiOtelPackageRoot,
	patchPiOtelSource,
	preflightPiOtelPackageRoot,
	verifyInstalledPiOtel,
} from "../scripts/lib/pi-otel-patch.mjs";
import { applyPackageRootPatchPlans } from "../scripts/lib/package-root-patch-utils.mjs";
import { writePiOtelFixture } from "./helpers/pi-otel-fixture.js";

test("patchPiOtelSource strips cwd attributes from pi-otel spans and resources", () => {
	const attrs = 'export const ATTR_PI_CWD = "pi.cwd";\nexport const ATTR_PI_TURN_COUNT = "pi.turn_count";';
	const spans = "const attrs = {\n            [ATTR_SYSTEM]: GEN_AI_SYSTEM_PI,\n            [ATTR_PI_CWD]: this.opts.cwd,\n        };";
	const sdk = 'import { Resource } from "@opentelemetry/resources";\nimport { ATTR_PI_CWD } from "../attrs.js";\nconst resource = new Resource({\n        [ATTR_SERVICE_NAME]: cfg.serviceName,\n        [ATTR_PI_CWD]: cfg.cwd,\n    });\n    // OTLP endpoints always carry an explicit port; refuse to fall back to\n    // 80/443, which could silently green-light an unrelated service.\n    if (!u.port)\n        return Promise.resolve(false);\n    return probeTcp(u.hostname || "127.0.0.1", Number(u.port), timeoutMs);';
	const index = "tracker = new SpanTracker({\n            tracer,\n            captureContent: cfg.captureContent,\n            cwd: cfg.cwd,\n            sessionId: () => sessionIdRef,\n        });\nattributes: {\n                    [ATTR_SYSTEM]: GEN_AI_SYSTEM_PI,\n                    [ATTR_PI_CWD]: cfg.cwd,\n                    \"service.name\": cfg.serviceName,\n                }\nif (await probeEndpoint(cfg.endpoint)) {";

	assert.doesNotMatch(patchPiOtelSource("dist/attrs.js", attrs), /ATTR_PI_CWD|pi\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/spans.js", spans), /ATTR_PI_CWD|this\.opts\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/otel/sdk.js", sdk), /ATTR_PI_CWD|cfg\.cwd/);
	assert.doesNotMatch(patchPiOtelSource("dist/index.js", index), /ATTR_PI_CWD|cfg\.cwd/);
	assert.match(
		patchPiOtelSource("dist/index.js", index),
		/if \(await probeEndpoint\(cfg\.endpoint, 300, cfg\.headers\)\)/,
	);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /import \* as otelResources from "@opentelemetry\/resources"/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /const resource = createFeynmanResource\(\{/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /u\.protocol === "https:" \? 443/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /FEYNMAN_POSTHOG_KEY/);
	assert.match(patchPiOtelSource("dist/otel/sdk.js", sdk), /method: "OPTIONS"/);
});

test("patchPiOtelSource supports both OpenTelemetry 1.x and 2.x resource APIs", () => {
	for (const source of [
		`import { Resource } from "@opentelemetry/resources";
const resource = new Resource({});`,
		`import { resourceFromAttributes } from "@opentelemetry/resources";
const resource = resourceFromAttributes({});`,
	]) {
		const patched = patchPiOtelSource("dist/otel/sdk.js", source);

		assert.match(patched, /typeof otelResources\.resourceFromAttributes === "function"/);
		assert.match(patched, /new otelResources\.Resource\(attributes\)/);
		assert.match(patched, /const resource = createFeynmanResource\(\{\}\)/);
	}
});

test("patchPiOtelSource preserves explicit per-signal OTLP configuration", () => {
	const config = `    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;
	const patched = patchPiOtelSource("dist/config.js", config);

	assert.match(patched, /const sharedEndpoint = process\.env\.OTEL_EXPORTER_OTLP_ENDPOINT/);
	assert.match(patched, /const prefix = `OTEL_EXPORTER_OTLP_\$\{signal\.toUpperCase\(\)\}`/);
	assert.match(patched, /explicitEndpoint: explicitEndpoint !== undefined/);
	assert.match(patched, /traces: createFeynmanSignalConfig\("traces"\)/);
	assert.match(patched, /metrics: createFeynmanSignalConfig\("metrics"\)/);
	assert.match(patched, /logs: createFeynmanSignalConfig\("logs"\)/);
});

test("patched pi-otel config resolves independent signal endpoints, headers, and protocols", async () => {
	const source = readFileSync(
		resolve(import.meta.dirname, "fixtures", "pi-otel-0.1.0", "dist", "config.js"),
		"utf8",
	);
	const executable = patchPiOtelSource("dist/config.js", source)
		.replace(
			'import { DiagLogLevel } from "@opentelemetry/api";',
			"const DiagLogLevel = { NONE: 0, ERROR: 30, WARN: 50, INFO: 60, DEBUG: 70, VERBOSE: 80, ALL: 9999 };",
		)
		.replace(/\n\/\/# sourceMappingURL=.*$/, "");
	const keys = [
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"OTEL_EXPORTER_OTLP_PROTOCOL",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
		"OTEL_EXPORTER_OTLP_TRACES_HEADERS",
		"OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
		"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_METRICS_HEADERS",
		"OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
		"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		"OTEL_EXPORTER_OTLP_LOGS_HEADERS",
		"OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
	] as const;
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	Object.assign(process.env, {
		OTEL_EXPORTER_OTLP_ENDPOINT: "https://shared.example/base",
		OTEL_EXPORTER_OTLP_HEADERS: "common=one",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/custom",
		OTEL_EXPORTER_OTLP_TRACES_HEADERS: "trace=two",
		OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
		OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://metrics.example/custom",
		OTEL_EXPORTER_OTLP_METRICS_HEADERS: "metric=three",
		OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "grpc",
		OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://logs.example/custom",
		OTEL_EXPORTER_OTLP_LOGS_HEADERS: "log=four",
		OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/protobuf",
	});
	try {
		const { resolveConfig } = await import(
			`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`
		) as { resolveConfig: (cwd: string) => any };
		const cfg = resolveConfig(resolve(tmpdir(), "feynman-pi-otel-config"));
		assert.deepEqual(cfg.feynmanOtlpSignals, {
			traces: {
				endpoint: "https://traces.example/custom",
				protocol: "http/json",
				headers: { common: "one", trace: "two" },
				explicitEndpoint: true,
			},
			metrics: {
				endpoint: "https://metrics.example/custom",
				protocol: "grpc",
				headers: { common: "one", metric: "three" },
				explicitEndpoint: true,
			},
			logs: {
				endpoint: "https://logs.example/custom",
				protocol: "http/protobuf",
				headers: { common: "one", log: "four" },
				explicitEndpoint: true,
			},
		});
		assert.equal(cfg.endpoint, "https://traces.example/custom");
		assert.equal(cfg.protocol, "http/json");
		assert.deepEqual(cfg.headers, { common: "one", trace: "two" });
	} finally {
		for (const key of keys) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("patchPiOtelSource routes HTTP OTLP exporters by signal without changing PostHog's exact trace URL", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-signals-"));
	const modulePath = resolve(root, "sdk.mjs");
	const sdk = `class GrpcExporter {
    constructor(opts) { Object.assign(this, opts, { kind: "grpc" }); }
}
class ProtoExporter {
    constructor(opts) { Object.assign(this, opts, { kind: "http/protobuf" }); }
}
class HttpExporter {
    constructor(opts) { Object.assign(this, opts, { kind: "http/json" }); }
}
function pickByProtocol(cfg, ctors) {
    const opts = { url: cfg.endpoint, headers: cfg.headers };
    if (cfg.protocol === "http/protobuf")
        return new ctors.proto(opts);
    if (cfg.protocol === "http/json")
        return new ctors.http(opts);
    return new ctors.grpc(opts);
}
export function initSdk(cfg) {
    const traceExporter = pickByProtocol(cfg, { grpc: GrpcExporter, proto: ProtoExporter, http: HttpExporter });
    const metricExporter = pickByProtocol(cfg, { grpc: GrpcExporter, proto: ProtoExporter, http: HttpExporter });
    const logExporter = pickByProtocol(cfg, { grpc: GrpcExporter, proto: ProtoExporter, http: HttpExporter });
    return { traceExporter, metricExporter, logExporter };
}`;
	const patched = patchPiOtelSource("dist/otel/sdk.js", sdk);
	writeFileSync(modulePath, patched, "utf8");

	try {
		assert.match(patched, /nikiforovall\/pi-otel#8/);
		assert.match(patched, /configured\?\.explicitEndpoint === true/);
		assert.match(patched, /process\.env\.FEYNMAN_POSTHOG_KEY && signal === "traces"/);
		assert.match(patched, /pickByProtocol\(cfg, "traces"/);
		assert.match(patched, /pickByProtocol\(cfg, "metrics"/);
		assert.match(patched, /pickByProtocol\(cfg, "logs"/);

		const { initSdk, resolveFeynmanOtlpSignalConfig, resolveFeynmanOtlpSignalUrl } = await import(
			`${pathToFileURL(modulePath).href}?test=${Date.now()}`
		) as {
			initSdk: (cfg: Record<string, unknown>) => Record<string, any>;
			resolveFeynmanOtlpSignalConfig: (
				cfg: Record<string, unknown>,
				signal: string,
			) => { url: string; protocol: string; headers: Record<string, string> };
			resolveFeynmanOtlpSignalUrl: (endpoint: string, signal: string) => string;
		};
		assert.equal(
			resolveFeynmanOtlpSignalUrl("https://collector.example", "traces"),
			"https://collector.example/v1/traces",
		);
		assert.equal(
			resolveFeynmanOtlpSignalUrl("https://collector.example/v1/traces", "metrics"),
			"https://collector.example/v1/metrics",
		);
		assert.equal(
			resolveFeynmanOtlpSignalUrl("http://127.0.0.1:4318/", "logs"),
			"http://127.0.0.1:4318/v1/logs",
		);
		const previousKey = process.env.FEYNMAN_POSTHOG_KEY;
		delete process.env.FEYNMAN_POSTHOG_KEY;
		try {
			const http = initSdk({
				endpoint: "https://collector.example/base",
				headers: { common: "one" },
				protocol: "http/protobuf",
			});
			assert.equal(http.traceExporter.url, "https://collector.example/base/v1/traces");
			assert.equal(http.metricExporter.url, "https://collector.example/base/v1/metrics");
			assert.equal(http.logExporter.url, "https://collector.example/base/v1/logs");
			const explicit = initSdk({
				endpoint: "https://collector.example/base",
				headers: { common: "one" },
				protocol: "http/protobuf",
				feynmanOtlpSignals: {
					traces: {
						endpoint: "https://traces.example/custom",
						headers: { trace: "two" },
						protocol: "http/json",
						explicitEndpoint: true,
					},
					metrics: {
						endpoint: "https://metrics.example/custom",
						headers: { metric: "three" },
						protocol: "grpc",
						explicitEndpoint: true,
					},
					logs: {
						endpoint: "https://logs.example/custom",
						headers: { log: "four" },
						protocol: "http/protobuf",
						explicitEndpoint: true,
					},
				},
			});
			assert.deepEqual(
				{
					url: explicit.traceExporter.url,
					headers: explicit.traceExporter.headers,
					kind: explicit.traceExporter.kind,
				},
				{
					url: "https://traces.example/custom",
					headers: { trace: "two" },
					kind: "http/json",
				},
			);
			assert.deepEqual(
				{
					url: explicit.metricExporter.url,
					headers: explicit.metricExporter.headers,
					kind: explicit.metricExporter.kind,
				},
				{
					url: "https://metrics.example/custom",
					headers: { metric: "three" },
					kind: "grpc",
				},
			);
			assert.deepEqual(
				{
					url: explicit.logExporter.url,
					headers: explicit.logExporter.headers,
					kind: explicit.logExporter.kind,
				},
				{
					url: "https://logs.example/custom",
					headers: { log: "four" },
					kind: "http/protobuf",
				},
			);
			process.env.FEYNMAN_POSTHOG_KEY = "test-project-token";
			assert.equal(
				resolveFeynmanOtlpSignalConfig({
					endpoint: "https://us.i.posthog.com/i/v0/ai/otel",
					headers: { Authorization: "Bearer test-project-token" },
					protocol: "http/protobuf",
				}, "traces").url,
				"https://us.i.posthog.com/i/v0/ai/otel",
			);
		} finally {
			if (previousKey === undefined) {
				delete process.env.FEYNMAN_POSTHOG_KEY;
			} else {
				process.env.FEYNMAN_POSTHOG_KEY = previousKey;
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("patchPiOtelSource silently skips a blocked Feynman-managed collector", () => {
	const index = `        if (await probeEndpoint(cfg.endpoint)) {
            wireSdk(cfg);
        }
        else {
            notify(\`pi-otel: OTLP endpoint \${cfg.endpoint} not reachable — run /otel start to launch a dashboard, or /otel connect <endpoint> to wire elsewhere.\`);
        }`;
	const sdk = `export function probeEndpoint(endpoint, timeoutMs = 300) {
    let u;
    try {
        u = new URL(endpoint);
    }
    catch {
        return Promise.resolve(false);
    }
    // OTLP endpoints always carry an explicit port; refuse to fall back to
    // 80/443, which could silently green-light an unrelated service.
    if (!u.port)
        return Promise.resolve(false);
    return probeTcp(u.hostname || "127.0.0.1", Number(u.port), timeoutMs);
}`;

	const patchedIndex = patchPiOtelSource("dist/index.js", index);
	const patchedSdk = patchPiOtelSource("dist/otel/sdk.js", sdk);

	assert.match(patchedIndex, /if \(!process\.env\.FEYNMAN_POSTHOG_KEY\)/);
	assert.match(patchedIndex, /probeEndpoint\(cfg\.endpoint, 300, cfg\.headers\)/);
	assert.match(patchedSdk, /process\.env\.FEYNMAN_POSTHOG_KEY/);
	assert.match(patchedSdk, /probeEndpoint\(endpoint, timeoutMs = 300, headers = \{\}\)/);
	assert.match(patchedSdk, /fetch\(u, \{ method: "OPTIONS", headers, signal: controller\.signal \}\)/);
	assert.match(patchedSdk, /\.then\(\(response\) => response\.ok, \(\) => false\)/);
});

test("patchPiOtelSource rejects retriable HTTP failures before exporters start", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-probe-"));
	const modulePath = resolve(root, "sdk.mjs");
	const sdk = `export function probeTcp() {
    return Promise.resolve(true);
}
export function probeEndpoint(endpoint, timeoutMs = 300) {
    let u;
    try {
        u = new URL(endpoint);
    }
    catch {
        return Promise.resolve(false);
    }
    const defaultPort = u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : undefined;
    const port = u.port ? Number(u.port) : defaultPort;
    if (!port)
        return Promise.resolve(false);
    return probeTcp(u.hostname || "127.0.0.1", port, timeoutMs);
}`;
	writeFileSync(modulePath, patchPiOtelSource("dist/otel/sdk.js", sdk), "utf8");

	let status = 503;
	let method = "";
	let authorization = "";
	const server = createServer((request, response) => {
		method = request.method ?? "";
		authorization = request.headers.authorization ?? "";
		response.writeHead(status).end();
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const previousKey = process.env.FEYNMAN_POSTHOG_KEY;
	process.env.FEYNMAN_POSTHOG_KEY = "test-project-token";

	try {
		const { probeEndpoint } = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
			probeEndpoint: (endpoint: string, timeoutMs: number, headers: Record<string, string>) => Promise<boolean>;
		};
		const endpoint = `http://127.0.0.1:${address.port}/i/v0/ai/otel`;
		assert.equal(
			await probeEndpoint(endpoint, 1_000, { Authorization: "Bearer test-project-token" }),
			false,
		);
		assert.equal(method, "OPTIONS");
		assert.equal(authorization, "Bearer test-project-token");

		status = 204;
		assert.equal(
			await probeEndpoint(endpoint, 1_000, { Authorization: "Bearer test-project-token" }),
			true,
		);
	} finally {
		if (previousKey === undefined) {
			delete process.env.FEYNMAN_POSTHOG_KEY;
		} else {
			process.env.FEYNMAN_POSTHOG_KEY = previousKey;
		}
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => error ? rejectClose(error) : resolveClose());
		});
		rmSync(root, { recursive: true, force: true });
	}
});

test("patched pi-otel executes shutdown and dashboard rewiring in their owning scopes", async () => {
	const baseline = readFileSync(
		resolve(import.meta.dirname, "fixtures", "pi-otel-0.1.0", "dist", "index.js"),
		"utf8",
	);
	const patched = patchPiOtelSource("dist/index.js", baseline);
	const extractHandlerBody = (marker: string): string => {
		const start = patched.indexOf(marker);
		assert.ok(start >= 0, `missing ${marker}`);
		const bodyStart = patched.indexOf("=> {", start);
		const bodyEnd = patched.indexOf("\n    });", bodyStart);
		assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, `invalid ${marker} handler`);
		return patched.slice(bodyStart + "=> {".length, bodyEnd);
	};
	const sessionShutdownBody = extractHandlerBody('pi.on("session_shutdown"');
	const dashboardReadyBody = extractHandlerBody('pi.events.on("pi-otel:dashboard-ready"');

	assert.doesNotMatch(sessionShutdownBody, /\boverride\b|\bcfg\b/);
	assert.match(dashboardReadyBody, /delete cfg\.feynmanOtlpSignals/);

	const sessionState = {
		shutdowns: 0,
		emitted: [] as Array<[string, unknown]>,
	};
	const executeSessionShutdown = new Function(
		"state",
		`return (async () => {
			let tracker = { endInteraction() {} };
			const sessionIdRef = "session-test";
			const ATTR_SYSTEM = "gen_ai.system";
			const ATTR_PI_SESSION_ID = "pi.session.id";
			const GEN_AI_SYSTEM_PI = "pi";
			const pi = { events: { emit: (...args) => state.emitted.push(args) } };
			const shutdownSdk = async () => { state.shutdowns += 1; };
			${sessionShutdownBody}
		})();`,
	) as (state: typeof sessionState) => Promise<void>;
	await executeSessionShutdown(sessionState);
	assert.equal(sessionState.shutdowns, 1);
	assert.ok(
		sessionState.emitted.some(([event, payload]) =>
			event === "pi-otel:status" &&
			(payload as { state?: string })?.state === "shutdown"
		),
	);

	const dashboardState = {
		cfg: {
			enabled: true,
			endpoint: "https://collector.example/base",
			protocol: "http/protobuf",
			feynmanOtlpSignals: {
				traces: { endpoint: "https://collector.example/base/v1/traces" },
			},
		},
		payload: {
			endpoint: "https://dashboard.example/otel",
			protocol: "grpc",
		},
		shutdowns: 0,
		wired: [] as Array<Record<string, unknown>>,
	};
	const executeDashboardReady = new Function(
		"state",
		`return (async () => {
			const ctx0 = { cwd: "/tmp/pi-otel-handler-test" };
			const payload = state.payload;
			const resolveConfig = () => state.cfg;
			const shutdownSdk = async () => { state.shutdowns += 1; };
			const wireSdk = (cfg) => state.wired.push({ ...cfg });
			${dashboardReadyBody}
		})();`,
	) as (state: typeof dashboardState) => Promise<void>;
	await executeDashboardReady(dashboardState);
	assert.equal(dashboardState.shutdowns, 1);
	assert.equal(dashboardState.wired.length, 1);
	assert.equal(dashboardState.wired[0].endpoint, "https://dashboard.example/otel");
	assert.equal(dashboardState.wired[0].protocol, "grpc");
	assert.equal(dashboardState.wired[0].feynmanOtlpSignals, undefined);
});

test("patchPiOtelSource is idempotent", () => {
	const source = `import { Resource } from "@opentelemetry/resources";
import { ATTR_PI_CWD } from "../attrs.js";
const resource = new Resource({
        [ATTR_SERVICE_NAME]: cfg.serviceName,
        [ATTR_PI_CWD]: cfg.cwd,
    });
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };`;
	const once = patchPiOtelSource("dist/otel/sdk.js", source);
	const twice = patchPiOtelSource("dist/otel/sdk.js", once);
	const configOnce = patchPiOtelSource("dist/config.js", source);
	const configTwice = patchPiOtelSource("dist/config.js", configOnce);

	assert.doesNotMatch(once, /ATTR_PI_CWD|cfg\.cwd/);
	assert.equal(twice, once);
	assert.equal(configTwice, configOnce);
});

test("pi-otel repairs the exact pre-release misplaced dashboard reset", () => {
	const baseline = readFileSync(
		resolve(import.meta.dirname, "fixtures", "pi-otel-0.1.0", "dist", "index.js"),
		"utf8",
	);
	const correct = patchPiOtelSource("dist/index.js", baseline);
	const signalReset =
		'        if (typeof override.endpoint === "string" || typeof override.protocol === "string")\n' +
		"            delete cfg.feynmanOtlpSignals;\n";
	const broken = correct
		.replace(signalReset, "")
		.replace(
			"        await shutdownSdk();",
			`${signalReset}        await shutdownSdk();`,
		);
	const repaired = patchPiOtelSource("dist/index.js", broken);

	assert.equal(repaired, correct);
	assert.equal(patchPiOtelSource("dist/index.js", repaired), repaired);
});

test("pi-otel 0.1.0 package patch is atomic and rejects fail-open drift", () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-package-"));
	const packageRoot = resolve(root, "pi-otel");
	try {
		writePiOtelFixture(packageRoot);
		assert.equal(patchPiOtelPackageRoot(packageRoot), true);
		const sources = new Map(
			PI_OTEL_PATCH_TARGETS.map((relativePath) => [
				relativePath,
				readFileSync(resolve(packageRoot, relativePath), "utf8"),
			]),
		);
		assert.doesNotThrow(() =>
			assertPiOtelPatchedSources(sources, "patched fixture"),
		);
		assert.equal(patchPiOtelPackageRoot(packageRoot), false);

		const sdkPath = resolve(packageRoot, "dist", "otel", "sdk.js");
		writeFileSync(
			sdkPath,
			readFileSync(sdkPath, "utf8").replace(
				'protocol === "grpc"',
				'false && protocol === "grpc"',
			),
			"utf8",
		);
		assert.throws(
			() => patchPiOtelPackageRoot(packageRoot),
			/Unsupported pi-otel 0\.1\.0 dist\/otel\/sdk\.js/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pi-otel migrates the exact published Feynman 0.3.45 SDK", () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-legacy-"));
	const packageRoot = resolve(root, "pi-otel");
	try {
		writePiOtelFixture(packageRoot, { publishedFeynmanVersion: "0.3.45" });
		assert.equal(patchPiOtelPackageRoot(packageRoot), true);
		assert.equal(patchPiOtelPackageRoot(packageRoot), false);
		assertPiOtelPatchedSources(
			new Map(
				PI_OTEL_PATCH_TARGETS.map((relativePath) => [
					relativePath,
					readFileSync(resolve(packageRoot, relativePath), "utf8"),
				]),
			),
			"published Feynman 0.3.45 fixture",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("installed runtime verification executes OTLP routing from exact patched bytes", async () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-installed-pi-otel-"));
	const packageRoot = resolve(
		root,
		".feynman",
		"npm",
		"node_modules",
		"pi-otel",
	);
	try {
		writePiOtelFixture(packageRoot);
		assert.equal(patchPiOtelPackageRoot(packageRoot), true);
		assert.equal(await verifyInstalledPiOtel(root), "passed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pi-otel multi-root plans preflight every source before writing", () => {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-pi-otel-plans-"));
	const firstRoot = resolve(root, "first", "pi-otel");
	const secondRoot = resolve(root, "second", "pi-otel");
	try {
		writePiOtelFixture(firstRoot);
		writePiOtelFixture(secondRoot);
		const firstSdkPath = resolve(firstRoot, "dist", "otel", "sdk.js");
		const secondSdkPath = resolve(secondRoot, "dist", "otel", "sdk.js");
		const firstBefore = readFileSync(firstSdkPath, "utf8");
		writeFileSync(secondSdkPath, `${readFileSync(secondSdkPath, "utf8")}\n// unsupported drift\n`);
		assert.throws(
			() => [
				preflightPiOtelPackageRoot(firstRoot),
				preflightPiOtelPackageRoot(secondRoot),
			],
			/Unsupported pi-otel 0\.1\.0 dist\/otel\/sdk\.js/,
		);
		assert.equal(readFileSync(firstSdkPath, "utf8"), firstBefore);

		writePiOtelFixture(secondRoot);
		const plans = [
			preflightPiOtelPackageRoot(firstRoot),
			preflightPiOtelPackageRoot(secondRoot),
		];
		writeFileSync(secondSdkPath, `${readFileSync(secondSdkPath, "utf8")}\n// changed after preflight\n`);
		assert.throws(
			() => applyPackageRootPatchPlans(plans),
			/Package patch source changed after preflight/,
		);
		assert.equal(readFileSync(firstSdkPath, "utf8"), firstBefore);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
