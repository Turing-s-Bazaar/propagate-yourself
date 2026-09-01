import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveVerifiedNpmSourceCommit } from "./lib/npm-provenance.mjs";

const [auditPath, name, version, integrity, repository, workflowPath, ref] =
	process.argv.slice(2);
if (!auditPath || !name || !version || !integrity || !repository || !workflowPath) {
	console.error(
		"Usage: node scripts/verify-npm-provenance.mjs <audit-json> <name> <version> <integrity> <repository-url> <workflow-path> [ref]",
	);
	process.exit(1);
}

const audit = JSON.parse(readFileSync(resolve(auditPath), "utf8"));
const commit = resolveVerifiedNpmSourceCommit(audit, {
	name,
	version,
	integrity,
	repository,
	workflowPath,
	ref,
});
process.stdout.write(`${commit}\n`);
