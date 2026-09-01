import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PI_OTEL_PATCH_TARGETS } from "../../scripts/lib/pi-otel-patch.mjs";

const fixtureRoot = resolve(
	import.meta.dirname,
	"..",
	"fixtures",
	"pi-otel-0.1.0",
);

export function writePiOtelFixture(
	packageRoot: string,
	options: { publishedFeynmanVersion?: "0.3.45" } = {},
): void {
	for (const relativePath of ["package.json", ...PI_OTEL_PATCH_TARGETS]) {
		const target = resolve(packageRoot, relativePath);
		const fixturePath =
			options.publishedFeynmanVersion === "0.3.45" &&
			relativePath !== "package.json"
				? resolve(fixtureRoot, "feynman-0.3.45", relativePath)
				: resolve(fixtureRoot, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(
			target,
			readFileSync(fixturePath),
		);
	}
}
