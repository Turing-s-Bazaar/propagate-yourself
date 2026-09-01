import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	ensureFeynmanHome,
	ensureFeynmanActiveOrg,
	getBootstrapStatePath,
	getDefaultSessionDir,
	getFeynmanActiveOrgDir,
	getFeynmanActiveOrgPath,
	getFeynmanAgentDir,
	getFeynmanHome,
	getFeynmanMemoryDir,
	getFeynmanOrgDatabasePath,
	getFeynmanOrgsDir,
	getFeynmanStateDir,
} from "../src/config/paths.js";

test("getFeynmanHome uses FEYNMAN_HOME env var when set", () => {
	const previous = process.env.FEYNMAN_HOME;
	try {
		process.env.FEYNMAN_HOME = "/custom/home";
		assert.equal(getFeynmanHome(), resolve("/custom/home", ".feynman"));
	} finally {
		if (previous === undefined) {
			delete process.env.FEYNMAN_HOME;
		} else {
			process.env.FEYNMAN_HOME = previous;
		}
	}
});

test("getFeynmanHome falls back to homedir when FEYNMAN_HOME is unset", () => {
	const previous = process.env.FEYNMAN_HOME;
	try {
		delete process.env.FEYNMAN_HOME;
		const home = getFeynmanHome();
		assert.ok(home.endsWith(".feynman"), `expected path ending in .feynman, got: ${home}`);
		assert.ok(!home.includes("undefined"), `expected no 'undefined' in path, got: ${home}`);
	} finally {
		if (previous === undefined) {
			delete process.env.FEYNMAN_HOME;
		} else {
			process.env.FEYNMAN_HOME = previous;
		}
	}
});

test("getFeynmanAgentDir resolves to <home>/agent", () => {
	assert.equal(getFeynmanAgentDir("/some/home"), resolve("/some/home", "agent"));
});

test("getFeynmanOrgsDir resolves to <home>/orgs", () => {
	assert.equal(getFeynmanOrgsDir("/some/home"), resolve("/some/home", "orgs"));
});

test("getFeynmanActiveOrgPath resolves to <home>/active-org.json", () => {
	assert.equal(getFeynmanActiveOrgPath("/some/home"), resolve("/some/home", "active-org.json"));
});

test("getFeynmanOrgDatabasePath resolves to the active org database", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		const org = ensureFeynmanActiveOrg(home);
		assert.equal(getFeynmanOrgDatabasePath(home), resolve(home, "orgs", org.org_uuid, "feynman-workbench.db"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("getFeynmanMemoryDir resolves to <home>/memory", () => {
	assert.equal(getFeynmanMemoryDir("/some/home"), resolve("/some/home", "memory"));
});

test("getFeynmanStateDir resolves to <home>/.state", () => {
	assert.equal(getFeynmanStateDir("/some/home"), resolve("/some/home", ".state"));
});

test("getDefaultSessionDir resolves to <home>/sessions", () => {
	assert.equal(getDefaultSessionDir("/some/home"), resolve("/some/home", "sessions"));
});

test("getBootstrapStatePath resolves to <home>/.state/bootstrap.json", () => {
	assert.equal(getBootstrapStatePath("/some/home"), resolve("/some/home", ".state", "bootstrap.json"));
});

test("ensureFeynmanHome creates all required subdirectories", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureFeynmanHome(home);

		assert.ok(existsSync(home), "home dir should exist");
		assert.ok(existsSync(join(home, "active-org.json")), "active org manifest should exist");
		assert.ok(existsSync(join(home, "orgs")), "orgs dir should exist");
		assert.ok(existsSync(join(home, "agent")), "agent dir should exist");
		assert.ok(existsSync(join(home, "memory")), "memory dir should exist");
		assert.ok(existsSync(join(home, ".state")), ".state dir should exist");
		assert.ok(existsSync(join(home, "sessions")), "sessions dir should exist");
		const activeOrg = JSON.parse(readFileSync(join(home, "active-org.json"), "utf8")) as { org_uuid?: string; login_owner_data_dir?: string };
		assert.equal(activeOrg.login_owner_data_dir, home);
		assert.match(activeOrg.org_uuid ?? "", /^[0-9a-f-]{36}$/);
		assert.ok(existsSync(join(home, "orgs", activeOrg.org_uuid ?? "")), "active org dir should exist");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureFeynmanHome is idempotent when dirs already exist", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		ensureFeynmanHome(home);
		assert.doesNotThrow(() => ensureFeynmanHome(home));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureFeynmanActiveOrg preserves a reference-shaped existing active org", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const orgUuid = "11111111-1111-4111-8111-111111111111";
		const accountUuid = "22222222-2222-4222-8222-222222222222";
		writeFileSync(getFeynmanActiveOrgPath(home), `${JSON.stringify({
			org_uuid: orgUuid,
			org_name: "Lab Org",
			account_uuid: accountUuid,
			login_owner_data_dir: home,
		}, null, 2)}\n`);

		const activeOrg = ensureFeynmanActiveOrg(home);

		assert.equal(activeOrg.org_uuid, orgUuid);
		assert.equal(activeOrg.org_name, "Lab Org");
		assert.equal(activeOrg.account_uuid, accountUuid);
		assert.equal(getFeynmanActiveOrgDir(home), join(home, "orgs", orgUuid));
		assert.ok(existsSync(join(home, "orgs", orgUuid)));
		const persisted = JSON.parse(readFileSync(getFeynmanActiveOrgPath(home), "utf8")) as { schema?: string };
		assert.equal(persisted.schema, "feynman.activeOrg.v1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ensureFeynmanActiveOrg does not rewrite a valid manifest", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-paths-"));
	try {
		const home = join(root, "home");
		const activeOrg = ensureFeynmanActiveOrg(home);
		const path = getFeynmanActiveOrgPath(home);
		const before = statSync(path, { bigint: true });

		for (let index = 0; index < 20; index += 1) {
			assert.equal(ensureFeynmanActiveOrg(home).org_uuid, activeOrg.org_uuid);
		}

		const after = statSync(path, { bigint: true });
		assert.equal(after.mtimeNs, before.mtimeNs);
		assert.equal(after.ino, before.ino);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), activeOrg);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
