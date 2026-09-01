const PATH_TO_FILE_URL_IMPORT = 'import { fileURLToPath, pathToFileURL } from "node:url";';
const FILE_URL_TO_PATH_IMPORT = 'import { fileURLToPath } from "node:url";';

const IMPORT_CALL = 'const module = await jiti.import(extensionPath, { default: true });';
const PATCHED_IMPORT_CALL = [
	'    const extensionSpecifier = process.platform === "win32" && path.isAbsolute(extensionPath)',
	'        ? pathToFileURL(extensionPath).href',
	'        : extensionPath;',
	'    const module = await jiti.import(extensionSpecifier, { default: true });',
].join("\n");

const MARIO_VIRTUAL_MODULES = [
	'    "@mariozechner/pi-agent-core": _bundledPiAgentCore,',
	'    "@mariozechner/pi-tui": _bundledPiTui,',
	'    "@mariozechner/pi-ai": _bundledPiAi,',
	'    "@mariozechner/pi-ai/oauth": _bundledPiAiOauth,',
	'    "@mariozechner/pi-coding-agent": _bundledPiCodingAgent,',
].join("\n");

const EARENDIL_VIRTUAL_MODULES = [
	'    "@earendil-works/pi-agent-core": _bundledPiAgentCore,',
	'    "@earendil-works/pi-tui": _bundledPiTui,',
	'    "@earendil-works/pi-ai": _bundledPiAi,',
	'    "@earendil-works/pi-ai/oauth": _bundledPiAiOauth,',
	'    "@earendil-works/pi-coding-agent": _bundledPiCodingAgent,',
].join("\n");

const MARIO_WITH_EARENDIL_VIRTUAL_MODULES = [MARIO_VIRTUAL_MODULES, EARENDIL_VIRTUAL_MODULES].join("\n");
const EARENDIL_WITH_MARIO_VIRTUAL_MODULES = [EARENDIL_VIRTUAL_MODULES, MARIO_VIRTUAL_MODULES].join("\n");

const MARIO_ALIASES = [
	'        "@mariozechner/pi-coding-agent": packageIndex,',
	'        "@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core"),',
	'        "@mariozechner/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@mariozechner/pi-tui"),',
	'        "@mariozechner/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@mariozechner/pi-ai"),',
	'        "@mariozechner/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@mariozechner/pi-ai/oauth"),',
].join("\n");

const EARENDIL_ALIASES_FOR_MARIO_RUNTIME = [
	'        "@earendil-works/pi-coding-agent": packageIndex,',
	'        "@earendil-works/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@mariozechner/pi-agent-core"),',
	'        "@earendil-works/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@mariozechner/pi-tui"),',
	'        "@earendil-works/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@mariozechner/pi-ai"),',
	'        "@earendil-works/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@mariozechner/pi-ai/oauth"),',
].join("\n");

const EARENDIL_ALIASES = [
	'        "@earendil-works/pi-coding-agent": packageIndex,',
	'        "@earendil-works/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@earendil-works/pi-agent-core"),',
	'        "@earendil-works/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@earendil-works/pi-tui"),',
	'        "@earendil-works/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@earendil-works/pi-ai"),',
	'        "@earendil-works/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@earendil-works/pi-ai/oauth"),',
].join("\n");

const MARIO_ALIASES_FOR_EARENDIL_RUNTIME = [
	'        "@mariozechner/pi-coding-agent": packageIndex,',
	'        "@mariozechner/pi-agent-core": resolveWorkspaceOrImport("agent/dist/index.js", "@earendil-works/pi-agent-core"),',
	'        "@mariozechner/pi-tui": resolveWorkspaceOrImport("tui/dist/index.js", "@earendil-works/pi-tui"),',
	'        "@mariozechner/pi-ai": resolveWorkspaceOrImport("ai/dist/index.js", "@earendil-works/pi-ai"),',
	'        "@mariozechner/pi-ai/oauth": resolveWorkspaceOrImport("ai/dist/oauth.js", "@earendil-works/pi-ai/oauth"),',
].join("\n");

const MARIO_WITH_EARENDIL_ALIASES = [MARIO_ALIASES, EARENDIL_ALIASES_FOR_MARIO_RUNTIME].join("\n");
const EARENDIL_WITH_MARIO_ALIASES = [EARENDIL_ALIASES, MARIO_ALIASES_FOR_EARENDIL_RUNTIME].join("\n");

function patchPiNamespaceAliases(source) {
	let patched = source;
	if (!patched.includes('"@earendil-works/pi-coding-agent": _bundledPiCodingAgent')) {
		patched = patched.replace(MARIO_VIRTUAL_MODULES, MARIO_WITH_EARENDIL_VIRTUAL_MODULES);
	}
	if (!patched.includes('"@mariozechner/pi-coding-agent": _bundledPiCodingAgent')) {
		patched = patched.replace(EARENDIL_VIRTUAL_MODULES, EARENDIL_WITH_MARIO_VIRTUAL_MODULES);
	}
	if (!patched.includes('"@earendil-works/pi-coding-agent": packageIndex')) {
		patched = patched.replace(MARIO_ALIASES, MARIO_WITH_EARENDIL_ALIASES);
	}
	if (!patched.includes('"@mariozechner/pi-coding-agent": packageIndex')) {
		patched = patched.replace(EARENDIL_ALIASES, EARENDIL_WITH_MARIO_ALIASES);
	}
	return patched;
}

export function patchPiExtensionLoaderSource(source) {
	let patched = source;

	patched = patchPiNamespaceAliases(patched);

	if (!patched.includes(PATCHED_IMPORT_CALL) && patched.includes(FILE_URL_TO_PATH_IMPORT)) {
		patched = patched.replace(FILE_URL_TO_PATH_IMPORT, PATH_TO_FILE_URL_IMPORT);
	}

	if (patched.includes(PATCHED_IMPORT_CALL)) {
		return patched;
	}

	if (!patched.includes(PATH_TO_FILE_URL_IMPORT) || !patched.includes(IMPORT_CALL)) {
		return patched;
	}

	return patched.replace(IMPORT_CALL, PATCHED_IMPORT_CALL);
}
