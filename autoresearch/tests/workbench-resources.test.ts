import assert from "node:assert/strict";
import test from "node:test";

import {
	filterResourceGroups,
	resourceDirectoryCounts,
} from "../workbench-web/src/resources.js";
import type {
	WorkbenchResource,
	WorkbenchResourceGroup,
} from "../workbench-web/src/types.js";

test("resource directory searches and filters the full capabilities catalog", () => {
	const connectors = Array.from({ length: 9 }, (_, index) => ({
		id: `connector-${index}`,
		name: index === 7 ? "Open Targets" : `Connector ${index}`,
		description: index === 7 ? "Target discovery evidence connector" : "Science connector",
		status: index % 2 === 0 ? "configured" : "available",
		source: "Science connector preset",
		connectorKind: "directory",
		section: "Directory",
		tags: index === 7 ? ["target discovery", "genomics"] : ["mcp"],
		tools: index === 7 ? [{ name: "feynman_science_database_search", description: "Search Open Targets" }] : [],
	} satisfies WorkbenchResource));
	const groups: WorkbenchResourceGroup[] = [
		{
			id: "connectors",
			title: "Connectors",
			description: "Science connectors",
			resources: connectors,
		},
		{
			id: "permissions",
			title: "Permissions",
			description: "Tool grants",
			resources: [{
				id: "grant-read",
				name: "Read grants",
				description: "Allowed connector grants",
				status: "read-only",
				source: "Workbench grant",
				tags: ["grant"],
			}],
		},
	];

	assert.deepEqual(resourceDirectoryCounts(groups), {
		groups: 2,
		resources: 10,
		configured: 5,
		available: 4,
		disabled: 0,
		readOnly: 1,
	});
	assert.equal(filterResourceGroups(groups, { groupId: "connectors" })[0]?.resources.length, 9);
	assert.deepEqual(filterResourceGroups(groups, { query: "open targets" }).map((group) => group.resources.map((resource) => resource.name)), [["Open Targets"]]);
	assert.deepEqual(filterResourceGroups(groups, { status: "read-only" }).map((group) => group.group.id), ["permissions"]);
	assert.equal(filterResourceGroups(groups, { groupId: "connectors", query: "feynman_science_database_search" })[0]?.resources[0]?.name, "Open Targets");
});
