import assert from "node:assert/strict";
import test from "node:test";

import {
	ALPHAXIV_USERINFO_ENDPOINT,
	verifyAlphaAuthStatus,
} from "../src/alpha-auth-status.js";

test("alpha auth status rejects missing and expired credentials", async () => {
	let fetchCalls = 0;
	const missing = await verifyAlphaAuthStatus({
		getValidToken: async () => null,
		fetchImpl: async () => {
			fetchCalls += 1;
			return new Response();
		},
	});
	assert.deepEqual(missing, { authenticated: false });
	assert.equal(fetchCalls, 0);

	const expired = await verifyAlphaAuthStatus({
		getValidToken: async () => "expired-token",
		fetchImpl: async (input, init) => {
			fetchCalls += 1;
			assert.equal(String(input), ALPHAXIV_USERINFO_ENDPOINT);
			assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer expired-token");
			return new Response('{"error":"invalid_token"}', { status: 400 });
		},
	});
	assert.deepEqual(expired, { authenticated: false });
	assert.equal(fetchCalls, 1);
});

test("alpha auth status requires a live user subject", async () => {
	const authenticated = await verifyAlphaAuthStatus({
		getValidToken: async () => "current-token",
		fetchImpl: async () => new Response(JSON.stringify({
			sub: "user-1",
			name: "Researcher",
		}), {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	});
	assert.deepEqual(authenticated, {
		authenticated: true,
		name: "Researcher",
	});

	await assert.rejects(
		verifyAlphaAuthStatus({
			getValidToken: async () => "current-token",
			fetchImpl: async () => new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		}),
		/no user subject/,
	);
});

test("alpha auth status surfaces provider failures", async () => {
	await assert.rejects(
		verifyAlphaAuthStatus({
			getValidToken: async () => "current-token",
			fetchImpl: async () => new Response("unavailable", {
				status: 503,
				statusText: "Service Unavailable",
			}),
		}),
		/503 Service Unavailable/,
	);
});
