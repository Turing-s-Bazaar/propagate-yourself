export function patchGeminiWebSource(source) {
	let patched = source;
	let changed = false;

	if (!patched.includes("geminiBrowser?: boolean;")) {
		const original = ["interface GeminiWebConfig {", "\tchromeProfile?: string;", "}"].join("\n");
		const replacement = [
			"interface GeminiWebConfig {",
			"\tchromeProfile?: string;",
			"\tgeminiBrowser?: boolean;",
			"}",
		].join("\n");
		if (patched.includes(original)) {
			patched = patched.replace(original, replacement);
			changed = true;
		}
	}

	const rawTypeOriginal = "let raw: { chromeProfile?: unknown };";
	const rawTypePatched =
		"let raw: { chromeProfile?: unknown; geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown };";
	if (patched.includes(rawTypeOriginal)) {
		patched = patched.replace(rawTypeOriginal, rawTypePatched);
		changed = true;
	}

	const configOriginal = ["cachedConfig = {", "\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),", "\t};"].join("\n");
	const configPatched = [
		"cachedConfig = {",
		"\t\tchromeProfile: normalizeChromeProfile(raw.chromeProfile),",
		"\t\tgeminiBrowser: normalizeBooleanFlag(raw.geminiBrowser ?? raw.allowBrowserAuth ?? raw.browserAuth),",
		"\t};",
	].join("\n");
	if (patched.includes(configOriginal)) {
		patched = patched.replace(configOriginal, configPatched);
		changed = true;
	}

	if (!patched.includes("function normalizeBooleanFlag(")) {
		const anchor = [
			"function getChromeProfileFromConfig(): string | undefined {",
			"\treturn loadConfig().chromeProfile;",
			"}",
		].join("\n");
		const replacement = [
			"function normalizeBooleanFlag(value: unknown): boolean {",
			"\tif (value === true) return true;",
			'\tif (typeof value !== "string") return false;',
			"\tconst normalized = value.trim().toLowerCase();",
			'\treturn normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";',
			"}",
			"",
			anchor,
		].join("\n");
		if (patched.includes(anchor)) {
			patched = patched.replace(anchor, replacement);
			changed = true;
		}
	}

	const availabilityOriginal = [
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? getChromeProfileFromConfig(),",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
	].join("\n");
	const availabilityPatched = [
		"export async function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null> {",
		"\tconst config = loadConfig();",
		"\tif (!config.geminiBrowser) return null;",
		"\tconst result = await getGoogleCookies({",
		"\t\tprofile: normalizeChromeProfile(chromeProfile) ?? config.chromeProfile,",
		"\t\trequiredCookies: REQUIRED_COOKIES,",
		"\t});",
		"\tif (!result) return null;",
		"\treturn result.cookies;",
		"}",
	].join("\n");
	if (patched.includes(availabilityOriginal)) {
		patched = patched.replace(availabilityOriginal, availabilityPatched);
		changed = true;
	}

	const profileHelper = [
		"function getChromeProfileFromConfig(): string | undefined {",
		"\treturn loadConfig().chromeProfile;",
		"}",
	].join("\n");
	if (patched.includes(profileHelper) && patched.includes("config.chromeProfile")) {
		patched = patched.replace(`${profileHelper}\n\n`, "").replace(`${profileHelper}\n`, "");
		changed = true;
	}

	return { source: patched, changed };
}

export function patchGeminiWebConfigSource(source) {
	let patched = source;
	let changed = false;

	const rawTypeOriginal =
		"let raw: { chromeProfile?: unknown; browserCookies?: unknown; allowBrowserCookies?: unknown };";
	const rawTypePatched =
		"let raw: { chromeProfile?: unknown; browserCookies?: unknown; allowBrowserCookies?: unknown; geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown };";
	if (patched.includes(rawTypeOriginal)) {
		patched = patched.replace(rawTypeOriginal, rawTypePatched);
		patched = patched.replace(
			"raw = JSON.parse(rawText) as { chromeProfile?: unknown; browserCookies?: unknown; allowBrowserCookies?: unknown };",
			"raw = JSON.parse(rawText) as { chromeProfile?: unknown; browserCookies?: unknown; allowBrowserCookies?: unknown; geminiBrowser?: unknown; allowBrowserAuth?: unknown; browserAuth?: unknown };",
		);
		changed = true;
	}

	if (!patched.includes("function normalizeBooleanFlag(")) {
		const anchor = "function loadConfig(): GeminiWebConfig {";
		const replacement = [
			"function normalizeBooleanFlag(value: unknown): boolean {",
			"\tif (value === true) return true;",
			'\tif (typeof value !== "string") return false;',
			"\tconst normalized = value.trim().toLowerCase();",
			'\treturn normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";',
			"}",
			"",
			anchor,
		].join("\n");
		if (patched.includes(anchor)) {
			patched = patched.replace(anchor, replacement);
			changed = true;
		}
	}

	const configOriginal = "\t\tallowBrowserCookies: raw.allowBrowserCookies === true,";
	const configPatched =
		"\t\tallowBrowserCookies: normalizeBooleanFlag(raw.allowBrowserCookies) || normalizeBooleanFlag(raw.geminiBrowser) || normalizeBooleanFlag(raw.allowBrowserAuth) || normalizeBooleanFlag(raw.browserAuth),";
	if (patched.includes(configOriginal)) {
		patched = patched.replace(configOriginal, configPatched);
		changed = true;
	}

	const accessOriginal = `\tconst rawText = readFileSync(CONFIG_PATH, "utf-8");
\tlet raw: { allowBrowserCookies?: unknown };
\ttry {
\t\traw = JSON.parse(rawText) as { allowBrowserCookies?: unknown };
\t} catch (err) {
\t\tconst message = err instanceof Error ? err.message : String(err);
\t\tthrow new Error(\`Failed to parse \${CONFIG_PATH}: \${message}\`);
\t}
\treturn raw.allowBrowserCookies === true;`;
	if (patched.includes(accessOriginal)) {
		patched = patched.replace(
			accessOriginal,
			"\treturn loadConfig().allowBrowserCookies === true;",
		);
		changed = true;
	}

	return { source: patched, changed };
}
