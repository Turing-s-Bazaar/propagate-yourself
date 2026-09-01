/**
 * Temporary pi-docparser 4.0.0 patch for the verified real-world portion of:
 * https://github.com/run-llama/liteparse/issues/432
 *
 * GPO bill PDFs contain white-on-white print/operator stamps that LiteParse
 * currently merges into body text. The generic paint-order problem belongs in
 * LiteParse's compositor. This narrow fallback requires stable GPO grammar,
 * metadata, geometry, and rendered white-background proof before removal.
 *
 * Removal condition: delete this patch after a supported LiteParse/pi-docparser
 * release suppresses these GPO stamps before text and textItems are returned.
 */
export const PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION = "4.0.0";
export const PI_DOCPARSER_INVISIBLE_TEXT_PATCH_TARGETS = Object.freeze([
	"extensions/docparser/native-worker.mjs",
]);
export const PI_DOCPARSER_INVISIBLE_TEXT_PATCH_MARKER =
	"Feynman pi-docparser 4.0.0 patch: suppress hidden GPO bill stamps";

function countOccurrences(source, value) {
	return source.split(value).length - 1;
}

export function assertPiDocparserInvisibleTextVersion(version, surface) {
	if (version !== PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION) {
		throw new Error(
			`Unsupported pi-docparser invisible-text patch ${surface}: expected ${PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiDocparserInvisibleTextPatchSource(source, surface = "pi-docparser native worker") {
	for (const fragment of [
		PI_DOCPARSER_INVISIBLE_TEXT_PATCH_MARKER,
		'import { inflateSync } from "node:zlib";',
		"function isHiddenGpoBillStampText(value) {",
		"function findHiddenGpoBillStampCandidates(page) {",
		"function decodeGpoScreenshotPng(imageBuffer) {",
		"function isWhiteGpoScreenshotRegion(decoded, page, item) {",
		"async function stripHiddenGpoBillStamps(parser, inputPath, parseResult) {",
		"screenshots = await parser.screenshot(inputPath, [...candidates.keys()]);",
		"extractTextMetadata: true,",
		"await stripHiddenGpoBillStamps(parser, request.inputPath, await parser.parse(",
	]) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete pi-docparser invisible-text patch ${surface}: missing ${fragment}`);
		}
	}
	if (
		countOccurrences(
			source,
			"await stripHiddenGpoBillStamps(parser, request.inputPath, await parser.parse(",
		) !== 2
	) {
		throw new Error(
			`Incomplete pi-docparser invisible-text patch ${surface}: parse and search must both sanitize results`,
		);
	}
}

const PATCH_HELPERS = `
// ${PI_DOCPARSER_INVISIBLE_TEXT_PATCH_MARKER}
function isHiddenGpoBillStampText(value) {
  if (typeof value !== "string") return false;
  const text = value.trim().replace(/\\s+/g, " ");
  return (
    /^[A-Za-z][A-Za-z0-9._-]* on [A-Z0-9-]+ with BILLS$/.test(text) ||
    /^VerDate .+ Jkt [0-9]+ PO [0-9]+ Frm [0-9]+ Fmt [0-9]+ Sfmt [0-9]+ .*[\\\\/]BILLS[\\\\/].+$/.test(text)
  );
}

function findHiddenGpoBillStampCandidates(page) {
  const textItems = page.textItems;
  const operatorIndexes = [];
  const operatorLines = [];
  for (let index = 0; index < textItems.length; index += 1) {
    const item = textItems[index];
    if (
      item &&
      /^[A-Za-z][A-Za-z0-9._-]* on [A-Z0-9-]+ with BILLS$/.test(item.text?.trim()) &&
      item.fillColor === "ffffffff" &&
      item.rotation === 270 &&
      Number.isFinite(item.x) &&
      item.x <= 30 &&
      Number.isFinite(item.y) &&
      (!Number.isFinite(page.height) || item.y >= page.height / 2)
    ) {
      operatorIndexes.push(index);
      operatorLines.push(item.text.trim().replace(/\\s+/g, " "));
    }
  }
  const printRows = [];
  for (let index = 0; index < textItems.length; index += 1) {
    const first = textItems[index];
    if (
      !first ||
      typeof first.text !== "string" ||
      !first.text.trim().startsWith("VerDate ") ||
      !Number.isFinite(first.x) ||
      !Number.isFinite(first.y) ||
      (Number.isFinite(page.height) && first.y < page.height - 40)
    ) continue;
    const row = textItems
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) =>
        item &&
        typeof item.text === "string" &&
        item.fillColor === "ffffffff" &&
        Number.isFinite(item.x) &&
        Number.isFinite(item.y) &&
        item.x >= first.x - 0.5 &&
        Math.abs(item.y - first.y) <= 1
      )
      .sort((left, right) => left.item.x - right.item.x);
    const line = row.map(({ item }) => item.text.trim()).filter(Boolean).join(" ")
      .trim().replace(/\\s+/g, " ");
    if (!isHiddenGpoBillStampText(line)) continue;
    printRows.push({ indexes: row.map(({ itemIndex }) => itemIndex), line });
  }
  return { operatorIndexes, operatorLines, printRows };
}

function decodeGpoScreenshotPng(imageBuffer) {
  if (
    !Buffer.isBuffer(imageBuffer) ||
    imageBuffer.length < 33 ||
    !imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) throw new Error("Unsupported GPO screenshot image.");
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  for (let offset = 8; offset + 12 <= imageBuffer.length;) {
    const length = imageBuffer.readUInt32BE(offset);
    const type = imageBuffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > imageBuffer.length) throw new Error("Truncated GPO screenshot image.");
    const data = imageBuffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    bitDepth !== 8 ||
    channels === 0 ||
    interlace !== 0 ||
    idat.length === 0
  ) throw new Error("Unsupported GPO screenshot PNG layout.");
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length !== height * (stride + 1)) {
    throw new Error("Unexpected GPO screenshot PNG size.");
  }
  const pixels = Buffer.allocUnsafe(height * stride);
  const paeth = (left, up, upperLeft) => {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
    return upDistance <= upperLeftDistance ? up : upperLeft;
  };
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    if (filter < 0 || filter > 4) throw new Error("Unsupported GPO screenshot PNG filter.");
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels
        ? pixels[(y - 1) * stride + x - channels]
        : 0;
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      pixels[y * stride + x] = (inflated[sourceOffset] + predictor) & 255;
      sourceOffset += 1;
    }
  }
  return { width, height, channels, pixels };
}

function isWhiteGpoScreenshotRegion(decoded, page, item) {
  if (
    !Number.isFinite(page.width) ||
    !Number.isFinite(page.height) ||
    page.width <= 0 ||
    page.height <= 0 ||
    !Number.isFinite(item.x) ||
    !Number.isFinite(item.y) ||
    !Number.isFinite(item.width) ||
    !Number.isFinite(item.height)
  ) return false;
  const xScale = decoded.width / page.width;
  const yScale = decoded.height / page.height;
  const left = Math.max(0, Math.floor(item.x * xScale));
  const right = Math.min(decoded.width, Math.ceil((item.x + item.width) * xScale));
  const top = Math.max(0, Math.floor(item.y * yScale));
  const bottom = Math.min(decoded.height, Math.ceil((item.y + item.height) * yScale));
  if (left >= right || top >= bottom) return false;
  let pixelsChecked = 0;
  let nonWhitePixels = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * decoded.width + x) * decoded.channels;
      const alpha = decoded.channels === 4 ? decoded.pixels[offset + 3] : 255;
      pixelsChecked += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const composited = Math.round(
          (decoded.pixels[offset + channel] * alpha + 255 * (255 - alpha)) / 255,
        );
        if (composited !== 255) {
          nonWhitePixels += 1;
          break;
        }
      }
    }
  }
  return pixelsChecked > 0 && nonWhitePixels === 0;
}

function stripHiddenGpoBillStampLines(value, lineCounts) {
  if (typeof value !== "string") return value;
  const remaining = new Map(lineCounts);
  const records = value.match(/[^\\r\\n]*(?:\\r\\n|\\r|\\n|$)/g) ?? [];
  return records
    .filter((record) => {
      if (record.length === 0) return false;
      const line = record.replace(/(?:\\r\\n|\\r|\\n)$/, "");
      const normalized = line.trim().replace(/\\s+/g, " ");
      const count = remaining.get(normalized) ?? 0;
      if (count === 0) return true;
      remaining.set(normalized, count - 1);
      return false;
    })
    .join("");
}

async function stripHiddenGpoBillStamps(parser, inputPath, parseResult) {
  if (!parseResult || !Array.isArray(parseResult.pages)) return parseResult;
  const candidates = new Map();
  for (const page of parseResult.pages) {
    if (!page || !Array.isArray(page.textItems)) continue;
    const candidate = findHiddenGpoBillStampCandidates(page);
    if (candidate.operatorIndexes.length === 0 || candidate.printRows.length === 0) continue;
    candidates.set(page.pageNum, candidate);
  }
  if (candidates.size === 0) return parseResult;
  let screenshots;
  try {
    screenshots = await parser.screenshot(inputPath, [...candidates.keys()]);
  } catch {
    return parseResult;
  }
  const screenshotsByPage = new Map(screenshots.map((screenshot) => [screenshot.pageNum, screenshot]));
  let removed = 0;
  const resultLineCounts = new Map();
  const pages = parseResult.pages.map((page) => {
    const candidate = candidates.get(page?.pageNum);
    const screenshot = screenshotsByPage.get(page?.pageNum);
    if (!candidate || !screenshot || !Array.isArray(page.textItems)) return page;
    let decoded;
    try {
      decoded = decodeGpoScreenshotPng(screenshot.imageBuffer);
    } catch {
      return page;
    }
    const hiddenIndexes = new Set([
      ...candidate.operatorIndexes,
      ...candidate.printRows.flatMap((row) => row.indexes),
    ]);
    const allCandidateRegionsAreWhite = [...hiddenIndexes].every((index) =>
      isWhiteGpoScreenshotRegion(decoded, page, page.textItems[index]));
    if (!allCandidateRegionsAreWhite) return page;
    const hiddenLineCounts = new Map();
    for (const line of [
      ...candidate.operatorLines,
      ...candidate.printRows.map((row) => row.line),
    ]) {
      hiddenLineCounts.set(line, (hiddenLineCounts.get(line) ?? 0) + 1);
      resultLineCounts.set(line, (resultLineCounts.get(line) ?? 0) + 1);
    }
    removed += hiddenIndexes.size;
    const sanitizedPage = {
      ...page,
      text: stripHiddenGpoBillStampLines(page.text, hiddenLineCounts),
      textItems: page.textItems.filter((_, index) => !hiddenIndexes.has(index)),
    };
    if (typeof page.markdown === "string") {
      sanitizedPage.markdown = stripHiddenGpoBillStampLines(page.markdown, hiddenLineCounts);
    }
    return sanitizedPage;
  });
  if (removed === 0) return parseResult;
  return {
    ...parseResult,
    pages,
    text: stripHiddenGpoBillStampLines(parseResult.text, resultLineCounts),
  };
}
`;

export function patchPiDocparserInvisibleTextSource(relativePath, source) {
	if (!relativePath.endsWith("/native-worker.mjs")) return source;
	if (source.includes(PI_DOCPARSER_INVISIBLE_TEXT_PATCH_MARKER)) {
		assertPiDocparserInvisibleTextPatchSource(source);
		return source;
	}

	const importAnchor = 'import { basename, join } from "node:path";';
	if (countOccurrences(source, importAnchor) !== 1) {
		throw new Error(
			`Unsupported pi-docparser ${PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION} native-worker import layout`,
		);
	}
	let patched = source.replace(
		importAnchor,
		`${importAnchor}\nimport { inflateSync } from "node:zlib";`,
	);
	const anchor = "const SCREENSHOT_JOB_MAX_BYTES = 64 * 1024 * 1024;";
	if (countOccurrences(patched, anchor) !== 1) {
		throw new Error(
			`Unsupported pi-docparser ${PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION} native-worker constants layout`,
		);
	}
	patched = patched.replace(anchor, `${anchor}${PATCH_HELPERS}`);
	const configAnchor =
		'    tessdataPath: /** @type {string | undefined} */ (config.tessdataPath),\n    quiet: true,';
	if (countOccurrences(patched, configAnchor) !== 1) {
		throw new Error(
			`Unsupported pi-docparser ${PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION} LiteParse config layout`,
		);
	}
	patched = patched.replace(
		configAnchor,
		'    tessdataPath: /** @type {string | undefined} */ (config.tessdataPath),\n    extractTextMetadata: true,\n    quiet: true,',
	);
	const parseAnchor =
		"const parseResult = await parser.parse(/** @type {string} */ (request.inputPath));";
	if (countOccurrences(patched, parseAnchor) !== 2) {
		throw new Error(
			`Unsupported pi-docparser ${PI_DOCPARSER_INVISIBLE_TEXT_REQUIRED_VERSION} parse layout`,
		);
	}
	patched = patched.replaceAll(
		parseAnchor,
		"const parseResult = await stripHiddenGpoBillStamps(parser, request.inputPath, await parser.parse(/** @type {string} */ (request.inputPath)));",
	);
	assertPiDocparserInvisibleTextPatchSource(patched);
	return patched;
}
