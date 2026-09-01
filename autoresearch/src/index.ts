import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { patchPiRuntimeNodeModules } from "./pi/runtime-patches.js";
import { ensureSupportedNodeVersion } from "./system/node-version.js";

async function run(): Promise<void> {
	ensureSupportedNodeVersion();
	patchPiRuntimeNodeModules(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
	const { main } = await import("./cli.js");
	await main();
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
