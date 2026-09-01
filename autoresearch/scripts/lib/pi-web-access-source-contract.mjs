import { createHash } from "node:crypto";

const BASELINE_SHA256 = Object.freeze({
	"index.ts": "80d4f01fe7db1c0f095a60d9aa2c9fe3ebee675d988affced30da935554a0127",
	"extract.ts": "dd47dcaa6ba077f27dd5a2364e28703d91c108cd4c6573cdf319d06ebb695add",
	"fetch-params.ts": "7a6f75acf5d9379c370da9dc0f438b04d783f2efe50e87beb7840a42137af7ac",
	"firecrawl.ts": "152de3a293ed233a61001f27934bd807b39088ab76a952bee3c6fdcfd2564411",
	"ssrf-protection.ts": "c8280208780f19a2d66a0c9a04d2feb674f8baa813e6b88a1b12cd53675f71aa",
	"chrome-cookies.ts": "d69f91df6ef0e1768fc487c49c1056c3601b798989143eda95b0eefa8e3e108b",
	"data-uri-sanitize.ts": "2f63c0b0b5009eb9b92ca27d041707c3f7d0d0042ea0ee8a921ad0813f332ec0",
	"credential-source.ts": "444c45e61a943aac5a8c3b03bb55e19066a96f0c162560041e3e35cdb464c05f",
	"curator-page.ts": "289a8c19232c7f2c09c13825781e8b0afb87038e2f4ab4f64adb9573704c63d3",
	"curator-server.ts": "1dcae298ddf92d5266000e743adb84be975554f5638fa2583627295bcebb80f1",
	"feature-config.ts": "207dc9f392086474b7759a5fc9c36b0540096359d367f213f198bab39fd258bf",
	"page-query.ts": "1574284cd35467f88e23e881b20b4fa458d11463be950be90676ddf48559833b",
	"storage.ts": "89ee6ff204ceb108a7d619f4a207819f774bd829a7f80d6ccd1a780009ea012f",
	"summary-model-scope.ts": "f9700d39a7e4f6a128f05f78c7df2630c70f3362930f12df560c3d6c7bdd5adb",
	"summary-review.ts": "57a56bc0dd3ba1c785a64b1fb375a1c5ed8b4182a4aca739fb482d862c2189d9",
	"exa.ts": "350b058f92422a485dab7ab9adefbeb0cc79f2aa67f1e299d5c2cb71a586a0ee",
	"gemini-api.ts": "dd5b853d2bba02ced7284b74dac1bcf1f11bb0bf99067d7eaf5d970fc6f86599",
	"gemini-adc.ts": "bbd7b8dc6913265597af61246157eb80a5dc8605095d503859a8f13f87de33fc",
	"gemini-search.ts": "c53b0a677671a0f93ffeb7f5d265c19bd7611be3cf9c6d60fd1e3363ba510470",
	"gemini-url-context.ts": "3f37b5480d964937b2228d95b61a3a95639e9ca5a1afbea4f2f0f2885ff512fa",
	"gemini-web-config.ts": "a1c408a3cef6127a3818d776d7b66240e17b2509475c1a9eaa29102340d476ef",
	"gemini-web.ts": "4664f38e8f344ac501db87aa89bbb1e9e208f775f000305d3ee48a7778fc78c8",
	"github-api.ts": "ae3aa01a7fc5b490a40477c9ed63edfb696ef9f467776051e8823d509cb36ceb",
	"github-extract.ts": "da077b6b0559d3789ba5b6773a237e256b1221b0f027f0e09a0e9c93b5fe35f8",
	"github-issue-pr.ts": "6c902662f16f36867bb36a56c451fd4a32920f8d1851392f19f3e88f60cf717d",
	"kimi-search.ts": "129868f4a983890511f9f95cc42ae9b63723cddbda696d72216db283a05de817",
	"openai-search.ts": "9eec8e91a8935d70bb9119dffe18e97b90dd14cae89df2ae1700cbe457a73640",
	"perplexity.ts": "8451deecf8f6551ff26383431116d3b381e66ca2bcb84f9f2918f1ba0dc6b866",
	"pdf-extract.ts": "e7dfd6dda9887373a40b815e2d60a7f0e96fd1a1950a7e4f0c9c9e1657fe3170",
	"video-extract.ts": "c5eea57652efe02c70a7ebaf9e32cce72ebe9a41c06573061cd94211ec73e843",
	"youtube-extract.ts": "7ac867dc1f343cf10929331e80a0d6c85df267ec2572685441e879797c4d762a",
	"utils.ts": "6b588a7ff4503f165a6670b3611b0e9502dde0d348519016fb06861e8c640b05",
});

const PATCHED_SHA256 = Object.freeze({
	"index.ts": "b8ca8c69a23bb9f01dca2084d011ea641368ff7f66e785e859377dd228b0eb14",
	"extract.ts": BASELINE_SHA256["extract.ts"],
	"fetch-params.ts": BASELINE_SHA256["fetch-params.ts"],
	"firecrawl.ts": "79409f4fe09e23ed17d27a4254b753e758fe5d80855ad8c451367a10ef798bb8",
	"ssrf-protection.ts": "0fc6169c9e52c26049d2dc3972614249018c6199cbc1f111db7096e7df64b82e",
	"chrome-cookies.ts": "eed7b4488bee4fcedaa7007edfc387ce01491500566e54140273de958d65f9da",
	"data-uri-sanitize.ts": BASELINE_SHA256["data-uri-sanitize.ts"],
	"credential-source.ts": BASELINE_SHA256["credential-source.ts"],
	"curator-page.ts": BASELINE_SHA256["curator-page.ts"],
	"curator-server.ts": BASELINE_SHA256["curator-server.ts"],
	"feature-config.ts": BASELINE_SHA256["feature-config.ts"],
	"page-query.ts": "06245436c0ff741de5f46f0f5e1f408a3ab0f759ef9bf714802bd1f1531f878e",
	"storage.ts": "471c9bf444b48775e9571c53f447e222f1b19b0185efdacab6058d6be7e77a2b",
	"summary-model-scope.ts": "2d4bfbfc4c13236706ed363f58a947d9dc3c57f95f103b5e3bd918bdd54e87e9",
	"summary-review.ts": "e98d088d33f97103a15b87107a8a84682678e03815755a7423c5f468c869e4b4",
	"exa.ts": BASELINE_SHA256["exa.ts"],
	"gemini-api.ts": BASELINE_SHA256["gemini-api.ts"],
	"gemini-adc.ts": "67cc59b11ad48bc6ad518354c02d2d02fd5dd05054acb13741589c90f4abac51",
	"gemini-search.ts": "b5afacd79abbc609349a6f38183b59fad3467b19a1680f47684cfa68acfed1b4",
	"gemini-url-context.ts": BASELINE_SHA256["gemini-url-context.ts"],
	"gemini-web-config.ts": "4349ab62928c62b64e1ae4c928dede30e752b3b22216c78d0e0445949956cf46",
	"gemini-web.ts": BASELINE_SHA256["gemini-web.ts"],
	"github-api.ts": "49f032ba2266fe6bacd9bcabb897266dd32f12db3ec703eae1c3822f52282dd5",
	"github-extract.ts": "c406e986f66d044e85deb0a33dc72a378a4a8b74a74e38964e549094a82ce077",
	"github-issue-pr.ts": "62564a9f591c4d41b1be926963a2333f4f417a669f015c8c76e902adaed583ec",
	"kimi-search.ts": BASELINE_SHA256["kimi-search.ts"],
	"openai-search.ts": BASELINE_SHA256["openai-search.ts"],
	"perplexity.ts": BASELINE_SHA256["perplexity.ts"],
	"pdf-extract.ts": "3e58267784031daaf4ed0bf3eaa99a668235d9bdffd754991a451083e2754f30",
	"video-extract.ts": BASELINE_SHA256["video-extract.ts"],
	"youtube-extract.ts": BASELINE_SHA256["youtube-extract.ts"],
	"utils.ts": "7ce555e08a5db5d37564acbe6b023e930b2c13020b7251d4e4112c3abd967c2c",
});
const KNOWN_PARTIAL_SHA256 = Object.freeze({
	"index.ts": Object.freeze([
		"b5009f0f568f2d8e1f1f2aaa063463cf06f50e89ac40e90293f570164b7edad6",
		"c180ade6e5cca01b53f2e272478abb432097cc355854b8f9e64dd20ec3e85af4",
		"df5e29b4cec7c821b27a4d3ff0acd9a055a4f0e5659845912de2bcb3c7d87b64",
	]),
	"gemini-search.ts": Object.freeze([
		"71d680438ccdcf8f4edc91d0d851a7b4933f44fc205016da654fc9b91eaad9e0",
	]),
	"utils.ts": Object.freeze([
		"e9f347080e8cee8b4883ceab42416d402cbb8a6225fc4278f1cc8eb0267ebcb0",
		"64084d32b8a182934900b61f220dcc3b45608325a5cf93a97a4b612dd3843811",
	]),
});

function digest(source) {
	return createHash("sha256")
		.update(source.replace(/\r\n/g, "\n"))
		.digest("hex");
}

function assertKnownTargets(targets) {
	const expected = Object.keys(BASELINE_SHA256);
	if (
		targets.length !== expected.length ||
		targets.some((target, index) => target !== expected[index])
	) {
		throw new Error("pi-web-access 0.25.0 source contract target order drifted");
	}
}

export function assertPiWebAccessReviewedSources(
	sources,
	targets,
	surface = "source tree",
) {
	assertKnownTargets(targets);
	for (const relativePath of targets) {
		const source = sources.get(relativePath);
		if (typeof source !== "string") {
			throw new Error(`Unsupported pi-web-access 0.25.0 ${surface}: missing ${relativePath}`);
		}
		const sourceDigest = digest(source);
		if (
			sourceDigest !== BASELINE_SHA256[relativePath] &&
			sourceDigest !== PATCHED_SHA256[relativePath] &&
			!(KNOWN_PARTIAL_SHA256[relativePath] ?? []).includes(sourceDigest)
		) {
			throw new Error(
				`Unsupported pi-web-access 0.25.0 ${surface} ${relativePath}: unreviewed digest ${sourceDigest}`,
			);
		}
	}
}

export function assertPiWebAccessPatchedDigests(
	sources,
	targets,
	surface = "patched source tree",
) {
	assertKnownTargets(targets);
	for (const relativePath of targets) {
		const sourceDigest = digest(sources.get(relativePath) ?? "");
		if (sourceDigest !== PATCHED_SHA256[relativePath]) {
			throw new Error(
				`Incomplete pi-web-access 0.25.0 ${surface} ${relativePath}: expected ${PATCHED_SHA256[relativePath]}, found ${sourceDigest}`,
			);
		}
	}
}
