import JSZip from "jszip";
import { load, type NpyArray } from "npyjs";

export type TensorValueCell = {
	display: string;
	intensity: number;
	value?: number;
};

export type TensorMatrixPreview = {
	columns: string[];
	planeLabel?: string;
	rows: Array<{
		cells: TensorValueCell[];
		label: string;
	}>;
	truncatedColumns: boolean;
	truncatedRows: boolean;
};

export type TensorVectorPreview = {
	max?: number;
	min?: number;
	points: Array<{
		display: string;
		index: number;
		x: number;
		y: number;
	}>;
};

export type TensorArrayPreview = {
	dtype: string;
	fortranOrder: boolean;
	matrix?: TensorMatrixPreview;
	max?: number;
	mean?: number;
	min?: number;
	name: string;
	nanCount: number;
	negativeInfinityCount: number;
	positiveInfinityCount: number;
	sampleValues: string[];
	shape: number[];
	statsSampled: boolean;
	valueCount: number;
	vector?: TensorVectorPreview;
};

export type TensorArchivePreview = {
	arrays: TensorArrayPreview[];
	arraysTruncated: boolean;
	format: "npy" | "npz";
};

const MATRIX_COLUMN_LIMIT = 14;
const MATRIX_ROW_LIMIT = 18;
const NPZ_ARRAY_LIMIT = 8;
const STATS_VALUE_LIMIT = 250_000;
const VECTOR_POINT_LIMIT = 96;

function exactArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
	if (input instanceof ArrayBuffer) return input;
	const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	const copy = new Uint8Array(view.byteLength);
	copy.set(view);
	return copy.buffer;
}

function basename(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function shapeProduct(shape: number[]): number {
	return shape.length ? shape.reduce((product, value) => product * value, 1) : 1;
}

function dataLength(data: unknown): number {
	const candidate = data as { length?: unknown };
	return typeof candidate.length === "number" ? candidate.length : 0;
}

function valueAt(data: unknown, index: number): unknown {
	return (data as Record<number, unknown>)[index];
}

function tensorOffset(shape: number[], indices: number[], fortranOrder: boolean): number {
	if (!shape.length) return 0;
	let offset = 0;
	let stride = 1;
	if (fortranOrder) {
		for (let axis = 0; axis < shape.length; axis += 1) {
			offset += (indices[axis] ?? 0) * stride;
			stride *= shape[axis] ?? 1;
		}
		return offset;
	}
	for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
		offset += (indices[axis] ?? 0) * stride;
		stride *= shape[axis] ?? 1;
	}
	return offset;
}

function numericValue(value: unknown): number | undefined {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "boolean") return value ? 1 : 0;
	return undefined;
}

export function formatTensorValue(value: unknown): string {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (Number.isNaN(value)) return "NaN";
		if (value === Infinity) return "Inf";
		if (value === -Infinity) return "-Inf";
		const abs = Math.abs(value);
		if (abs !== 0 && (abs < 0.001 || abs >= 100_000)) return value.toExponential(3);
		if (Number.isInteger(value)) return value.toString();
		return value.toPrecision(abs >= 100 ? 5 : 4);
	}
	if (value === undefined) return "";
	return String(value);
}

function sampledIndices(length: number, limit: number): number[] {
	if (length <= limit) return Array.from({ length }, (_, index) => index);
	if (limit <= 1) return [0];
	return Array.from({ length: limit }, (_, index) => Math.round((index * (length - 1)) / (limit - 1)));
}

function normalizeIntensity(value: number | undefined, min: number | undefined, max: number | undefined): number {
	if (value === undefined || min === undefined || max === undefined || !Number.isFinite(value) || max <= min) return 0;
	return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function buildVectorPreview(data: unknown, shape: number[], fortranOrder: boolean, min?: number, max?: number): TensorVectorPreview | undefined {
	const valueCount = shapeProduct(shape);
	if (shape.length !== 1 || valueCount < 2) return undefined;
	const indices = sampledIndices(valueCount, VECTOR_POINT_LIMIT);
	return {
		min,
		max,
		points: indices.map((index, pointIndex) => {
			const value = valueAt(data, tensorOffset(shape, [index], fortranOrder));
			const numeric = numericValue(value);
			const normalized = normalizeIntensity(numeric, min, max);
			return {
				display: formatTensorValue(value),
				index,
				x: indices.length <= 1 ? 0 : pointIndex / (indices.length - 1),
				y: 1 - normalized,
			};
		}),
	};
}

function buildMatrixPreview(data: unknown, shape: number[], fortranOrder: boolean, min?: number, max?: number): TensorMatrixPreview | undefined {
	if (shape.length < 2) return undefined;
	const rowAxis = shape.length - 2;
	const columnAxis = shape.length - 1;
	const rowCount = shape[rowAxis] ?? 0;
	const columnCount = shape[columnAxis] ?? 0;
	if (!rowCount || !columnCount) return undefined;
	const rows = Math.min(rowCount, MATRIX_ROW_LIMIT);
	const columns = Math.min(columnCount, MATRIX_COLUMN_LIMIT);
	const prefixIndices = Array.from({ length: shape.length }, () => 0);
	const matrixRows = Array.from({ length: rows }, (_, rowIndex) => {
		const indices = [...prefixIndices];
		indices[rowAxis] = rowIndex;
		return {
			label: `${rowIndex}`,
			cells: Array.from({ length: columns }, (_, columnIndex) => {
				indices[columnAxis] = columnIndex;
				const value = valueAt(data, tensorOffset(shape, indices, fortranOrder));
				const numeric = numericValue(value);
				return {
					display: formatTensorValue(value),
					intensity: normalizeIntensity(numeric, min, max),
					...(numeric === undefined ? {} : { value: numeric }),
				};
			}),
		};
	});
	const planeAxes = shape.slice(0, Math.max(0, shape.length - 2));
	return {
		columns: Array.from({ length: columns }, (_, index) => `${index}`),
		...(planeAxes.length ? { planeLabel: `slice ${planeAxes.map(() => "0").join(",")}` } : {}),
		rows: matrixRows,
		truncatedColumns: columnCount > columns,
		truncatedRows: rowCount > rows,
	};
}

function summarizeNpyArray(array: NpyArray, name: string): TensorArrayPreview {
	const data = array.data as unknown;
	const length = Math.min(dataLength(data), shapeProduct(array.shape));
	const statsLimit = Math.min(length, STATS_VALUE_LIMIT);
	let finiteCount = 0;
	let nanCount = 0;
	let negativeInfinityCount = 0;
	let positiveInfinityCount = 0;
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	for (let index = 0; index < statsLimit; index += 1) {
		const numeric = numericValue(valueAt(data, index));
		if (numeric === undefined) continue;
		if (Number.isNaN(numeric)) {
			nanCount += 1;
			continue;
		}
		if (numeric === Infinity) {
			positiveInfinityCount += 1;
			continue;
		}
		if (numeric === -Infinity) {
			negativeInfinityCount += 1;
			continue;
		}
		finiteCount += 1;
		min = Math.min(min, numeric);
		max = Math.max(max, numeric);
		sum += numeric;
	}
	const finiteMin = finiteCount ? min : undefined;
	const finiteMax = finiteCount ? max : undefined;
	const finiteMean = finiteCount ? sum / finiteCount : undefined;
	return {
		dtype: array.dtype,
		fortranOrder: array.fortranOrder,
		...(finiteMax === undefined ? {} : { max: Number(finiteMax.toPrecision(6)) }),
		...(finiteMean === undefined ? {} : { mean: Number(finiteMean.toPrecision(6)) }),
		...(finiteMin === undefined ? {} : { min: Number(finiteMin.toPrecision(6)) }),
		matrix: buildMatrixPreview(data, array.shape, array.fortranOrder, finiteMin, finiteMax),
		name,
		nanCount,
		negativeInfinityCount,
		positiveInfinityCount,
		sampleValues: Array.from({ length: Math.min(length, 12) }, (_, index) => formatTensorValue(valueAt(data, index))),
		shape: array.shape,
		statsSampled: length > statsLimit,
		valueCount: length,
		vector: buildVectorPreview(data, array.shape, array.fortranOrder, finiteMin, finiteMax),
	};
}

export async function parseNpyPreview(buffer: ArrayBuffer | ArrayBufferView, name = "array.npy"): Promise<TensorArrayPreview> {
	const array = await load(exactArrayBuffer(buffer));
	return summarizeNpyArray(array, basename(name));
}

export async function parseTensorArchivePreview(
	buffer: ArrayBuffer | ArrayBufferView,
	extension: string,
	name = "array",
): Promise<TensorArchivePreview> {
	const normalizedExtension = extension.toLowerCase();
	if (normalizedExtension === ".npy") {
		return {
			arrays: [await parseNpyPreview(buffer, name)],
			arraysTruncated: false,
			format: "npy",
		};
	}
	const zip = await JSZip.loadAsync(exactArrayBuffer(buffer));
	const npyFiles = Object.values(zip.files)
		.filter((file) => !file.dir && file.name.toLowerCase().endsWith(".npy"))
		.sort((left, right) => left.name.localeCompare(right.name));
	const arrays: TensorArrayPreview[] = [];
	for (const file of npyFiles.slice(0, NPZ_ARRAY_LIMIT)) {
		const arrayBuffer = await file.async("arraybuffer");
		arrays.push(await parseNpyPreview(arrayBuffer, basename(file.name)));
	}
	return {
		arrays,
		arraysTruncated: npyFiles.length > arrays.length,
		format: "npz",
	};
}
