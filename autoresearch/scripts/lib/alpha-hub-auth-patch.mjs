const LEGACY_SUCCESS_HTML = "'<html><body><h2>Logged in to Alpha Hub</h2><p>You can close this tab.</p></body></html>'";
const LEGACY_ERROR_HTML = "'<html><body><h2>Login failed</h2><p>You can close this tab.</p></body></html>'";

const bodyAttr = 'style="font-family:system-ui,sans-serif;text-align:center;padding-top:20vh;background:#050a08;color:#f0f5f2"';
const logo = '<h1 style="font-family:monospace;font-size:48px;color:#34d399;margin:0">feynman</h1>';

const FEYNMAN_SUCCESS_HTML = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#34d399;margin-top:16px">Logged in</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;
const FEYNMAN_ERROR_HTML = `'<html><body ${bodyAttr}>${logo}<h2 style="color:#ef4444;margin-top:16px">Login failed</h2><p style="color:#8aaa9a">You can close this tab.</p></body></html>'`;

const CURRENT_OPEN_BROWSER = [
	"function openBrowser(url) {",
	"  try {",
	"    const plat = platform();",
	"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
	"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
	"    else if (plat === 'win32') execSync(`start \"\" \"${url}\"`);",
	"  } catch {}",
	"}",
].join("\n");

const PATCHED_OPEN_BROWSER = [
	"function openBrowser(url) {",
	"  try {",
	"    const plat = platform();",
	"    const isWsl = plat === 'linux' && (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));",
	"    if (plat === 'darwin') execSync(`open \"${url}\"`);",
	"    else if (isWsl) {",
	"      try {",
	"        execSync(`wslview \"${url}\"`);",
	"      } catch {",
	"        execSync(`cmd.exe /c start \"\" \"${url}\"`);",
	"      }",
	"    }",
	"    else if (plat === 'linux') execSync(`xdg-open \"${url}\"`);",
	"    else if (plat === 'win32') execSync(`cmd /c start \"\" \"${url}\"`);",
	"  } catch {}",
	"}",
].join("\n");

const LEGACY_WIN_OPEN = "else if (plat === 'win32') execSync(`start \"${url}\"`);";
const FIXED_WIN_OPEN = "else if (plat === 'win32') execSync(`cmd /c start \"\" \"${url}\"`);";

const OPEN_BROWSER_LOG = "process.stderr.write('Opening browser for alphaXiv login...\\n');";
const OPEN_BROWSER_LOG_WITH_URL = "process.stderr.write(`Opening browser for alphaXiv login...\\nAuth URL: ${authUrl.toString()}\\n`);";

const LEGACY_CALLBACK_DECLARATION = "function waitForCallback(server) {";
const VALIDATING_CALLBACK_DECLARATION = "function waitForCallback(server, expectedState) {";

const LEGACY_CALLBACK_PARAMS = [
	"      const code = url.searchParams.get('code');",
	"      const error = url.searchParams.get('error');",
	"",
	"      if (error) {",
].join("\n");

const VALIDATING_CALLBACK_PARAMS = [
	"      const code = url.searchParams.get('code');",
	"      const error = url.searchParams.get('error');",
	"      const returnedState = url.searchParams.get('state');",
	"",
	"      if (!returnedState || returnedState !== expectedState) {",
	"        res.writeHead(400, { 'Content-Type': 'text/html' });",
	"        res.end(ERROR_HTML);",
	"        clearTimeout(timeout);",
	"        server.close();",
	"        reject(new Error('OAuth state mismatch'));",
	"        return;",
	"      }",
	"",
	"      if (error) {",
].join("\n");

const LEGACY_CALLBACK_CALL = "  const code = await waitForCallback(server);";
const VALIDATING_CALLBACK_CALL = "  const code = await waitForCallback(server, state);";

const LEGACY_AUTH_ENDPOINTS = [
	"const CLERK_ISSUER = 'https://clerk.alphaxiv.org';",
	"const AUTH_ENDPOINT = `${CLERK_ISSUER}/oauth/authorize`;",
	"const TOKEN_ENDPOINT = `${CLERK_ISSUER}/oauth/token`;",
	"const REGISTER_ENDPOINT = `${CLERK_ISSUER}/oauth/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${CLERK_ISSUER}/oauth/userinfo`;",
	"const SCOPES = 'profile email offline_access';",
].join("\n");

const CURRENT_AUTH_ENDPOINTS = [
	"const ALPHAXIV_AUTH_ISSUER = 'https://api.alphaxiv.org/auth';",
	"const AUTH_ENDPOINT = `${ALPHAXIV_AUTH_ISSUER}/oauth2/authorize`;",
	"const TOKEN_ENDPOINT = `${ALPHAXIV_AUTH_ISSUER}/oauth2/token`;",
	"const REGISTER_ENDPOINT = `${ALPHAXIV_AUTH_ISSUER}/oauth2/register`;",
	"const CALLBACK_PORT = 9876;",
	"const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;",
	"const USERINFO_ENDPOINT = `${ALPHAXIV_AUTH_ISSUER}/oauth2/userinfo`;",
	"const SCOPES = 'openid profile email offline_access';",
].join("\n");

export function patchAlphaHubAuthSource(source) {
	let patched = source;

	if (patched.includes(LEGACY_AUTH_ENDPOINTS)) {
		patched = patched.replace(LEGACY_AUTH_ENDPOINTS, CURRENT_AUTH_ENDPOINTS);
	}
	if (patched.includes(LEGACY_SUCCESS_HTML)) {
		patched = patched.replace(LEGACY_SUCCESS_HTML, FEYNMAN_SUCCESS_HTML);
	}
	if (patched.includes(LEGACY_ERROR_HTML)) {
		patched = patched.replace(LEGACY_ERROR_HTML, FEYNMAN_ERROR_HTML);
	}
	if (patched.includes(CURRENT_OPEN_BROWSER)) {
		patched = patched.replace(CURRENT_OPEN_BROWSER, PATCHED_OPEN_BROWSER);
	}
	if (patched.includes(LEGACY_WIN_OPEN)) {
		patched = patched.replace(LEGACY_WIN_OPEN, FIXED_WIN_OPEN);
	}
	if (patched.includes(OPEN_BROWSER_LOG)) {
		patched = patched.replace(OPEN_BROWSER_LOG, OPEN_BROWSER_LOG_WITH_URL);
	}
	if (patched.includes(LEGACY_CALLBACK_DECLARATION)) {
		patched = patched.replace(LEGACY_CALLBACK_DECLARATION, VALIDATING_CALLBACK_DECLARATION);
	}
	if (patched.includes(LEGACY_CALLBACK_PARAMS)) {
		patched = patched.replace(LEGACY_CALLBACK_PARAMS, VALIDATING_CALLBACK_PARAMS);
	}
	if (patched.includes(LEGACY_CALLBACK_CALL)) {
		patched = patched.replace(LEGACY_CALLBACK_CALL, VALIDATING_CALLBACK_CALL);
	}

	return patched;
}
