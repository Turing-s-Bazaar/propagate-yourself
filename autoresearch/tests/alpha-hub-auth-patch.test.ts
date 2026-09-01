import test from "node:test";
import assert from "node:assert/strict";

import { patchAlphaHubAuthSource } from "../scripts/lib/alpha-hub-auth-patch.mjs";

const LEGACY_ENDPOINTS = [
	"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
	"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
	"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
	"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
	"const SCOPES = 'profile email offline_access';",
].join("\n");

test("patchAlphaHubAuthSource uses alphaXiv's current OAuth endpoints", () => {
	const patched = patchAlphaHubAuthSource(LEGACY_ENDPOINTS);

	assert.match(patched, /https:\/\/api\.alphaxiv\.org\/auth/);
	assert.match(patched, /oauth2\/authorize/);
	assert.match(patched, /oauth2\/token/);
	assert.match(patched, /oauth2\/register/);
	assert.match(patched, /oauth2\/userinfo/);
	assert.match(patched, /openid profile email offline_access/);
	assert.doesNotMatch(patched, /clerk\.alphaxiv\.org/);
});

test("patchAlphaHubAuthSource fixes browser open logic for WSL and Windows", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /const isWsl = plat === 'linux'/);
	assert.match(patched, /wslview/);
	assert.match(patched, /cmd\.exe \/c start/);
	assert.match(patched, /cmd \/c start/);
});

test("patchAlphaHubAuthSource includes the auth URL in login output", () => {
	const input = "process.stderr.write('Opening browser for alphaXiv login...\\n');";

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /Auth URL: \$\{authUrl\.toString\(\)\}/);
});

test("patchAlphaHubAuthSource validates OAuth state on the loopback callback", () => {
	const input = [
		"function waitForCallback(server) {",
		"      const code = url.searchParams.get('code');",
		"      const error = url.searchParams.get('error');",
		"",
		"      if (error) {",
		"  const code = await waitForCallback(server);",
	].join("\n");

	const patched = patchAlphaHubAuthSource(input);

	assert.match(patched, /function waitForCallback\(server, expectedState\)/);
	assert.match(patched, /const returnedState = url\.searchParams\.get\('state'\)/);
	assert.match(patched, /returnedState !== expectedState/);
	assert.match(patched, /OAuth state mismatch/);
	assert.match(patched, /waitForCallback\(server, state\)/);
	assert.doesNotMatch(patched, /waitForCallback\(server\);/);
	assert.equal(patchAlphaHubAuthSource(patched), patched);
});

test("patchAlphaHubAuthSource is idempotent", () => {
	const input = [
		"function openBrowser(url) {",
		"  try {",
		"    const plat = platform();",
		"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
		"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
		"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
		"  } catch {}",
		"}",
		"process.stderr.write('Opening browser for alphaXiv login...\\n');",
	].join("\n");

	const once = patchAlphaHubAuthSource(input);
	const twice = patchAlphaHubAuthSource(once);

	assert.equal(twice, once);
});
