import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

function nativeLiteParsePackage() {
	if (process.platform === "darwin" && process.arch === "arm64") {
		return "@llamaindex/liteparse-darwin-arm64";
	}
	if (process.platform === "darwin" && process.arch === "x64") {
		return "@llamaindex/liteparse-darwin-x64";
	}
	if (process.platform === "linux" && process.arch === "arm64") {
		return "@llamaindex/liteparse-linux-arm64-gnu";
	}
	if (process.platform === "linux" && process.arch === "x64") {
		const report = process.report?.getReport() as {
			header?: { glibcVersionRuntime?: string };
		};
		return report?.header?.glibcVersionRuntime
			? "@llamaindex/liteparse-linux-x64-gnu"
			: "@llamaindex/liteparse-linux-x64-musl";
	}
	if (process.platform === "win32" && process.arch === "arm64") {
		return "@llamaindex/liteparse-win32-arm64-msvc";
	}
	if (process.platform === "win32" && process.arch === "x64") {
		return "@llamaindex/liteparse-win32-x64-msvc";
	}
	throw new Error(`Unsupported LiteParse test platform: ${process.platform}-${process.arch}`);
}

function tableHeaderProbePage() {
	const item = (text: string, x: number, y: number, width = 20) => ({
		text,
		x,
		y,
		width,
		height: 6,
		fontName: "Helvetica",
		fontSize: 5,
		fontHeight: 5,
		fontWeight: 400,
		words: [],
	});
	return {
		pageNumber: 1,
		pageWidth: 500,
		pageHeight: 700,
		textItems: [
			item("Model", 50, 100),
			item("Metric A", 170, 100),
			item("Metric B", 290, 100),
			item("Family", 50, 110),
			item("Detail", 159, 110, 3),
			item("Score A", 170, 110),
			item("Score B", 290, 110),
			item("Alpha", 50, 120),
			item("X", 159, 120, 3),
			item("10", 170, 120),
			item("20", 290, 120),
			item("Beta", 50, 130),
			item("Y", 159, 130, 3),
			item("11", 170, 130),
			item("21", 290, 130),
			item("Gamma", 50, 140),
			item("Z", 159, 140, 3),
			item("12", 170, 140),
			item("22", 290, 140),
		],
	};
}

test("bundled LiteParse preserves in-table cells from multi-line headers", async () => {
	const nativePackage = nativeLiteParsePackage();
	const nativeModule = require(nativePackage);
	const LiteParse = nativeModule.LiteParse ?? nativeModule.default?.LiteParse;
	assert.equal(typeof LiteParse, "function", `${nativePackage} has no LiteParse`);
	const parser = new LiteParse({
		ocrEnabled: false,
		outputFormat: "markdown",
		quiet: true,
	});
	const result = parser.parsePages([tableHeaderProbePage()]);
	const markdown = result?.pages?.[0]?.markdown ?? result?.text ?? "";

	for (const expectedRow of [
		"| Model |  | Metric A | Metric B |",
		"| Family | Detail | Score A | Score B |",
		"| Alpha | X | 10 | 20 |",
		"| Beta | Y | 11 | 21 |",
		"| Gamma | Z | 12 | 22 |",
	]) {
		assert.ok(markdown.includes(expectedRow), `LiteParse lost table content: ${expectedRow}`);
	}
});
