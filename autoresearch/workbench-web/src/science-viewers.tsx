import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";

import type { Browser as IgvBrowser, TrackLoad } from "igv";
import type { RDKitLoader, RDKitModule } from "@rdkit/rdkit";
import rdkitWasmUrl from "@rdkit/rdkit/dist/RDKit_minimal.wasm?url";
import type { GenomeBrowserTrack, TreePreview } from "./artifacts.js";

type MoleculeRenderInput = {
	input: string;
	label: string;
	type: "cdxml" | "ket" | "molblock" | "rxn" | "smiles";
};

type ViewerStatus = {
	state: "error" | "loading" | "ready";
	message: string;
};

type ThreeDmolStyleMode = "ball-stick" | "cartoon" | "line" | "sphere" | "stick" | "surface";

type KetcherMoleculeFormat = "molfile" | "smiles";
type TidyTreeLayout = "circular" | "horizontal" | "vertical";
type TidyTreeType = "dendrogram" | "tree" | "weighted";

export type KetcherMoleculeExport = {
	content: string;
	format: KetcherMoleculeFormat;
	molfile: string;
	smiles: string;
};

type ThreeDmolModule = {
	createViewer: (element: HTMLElement, config?: Record<string, unknown>) => ThreeDmolViewer;
	SurfaceType?: Record<string, string | number>;
};

type ThreeDmolViewer = {
	addSurface?: (
		surfaceType: string | number,
		style?: Record<string, unknown>,
		atomSelection?: Record<string, unknown>,
		allSelection?: Record<string, unknown>,
		focus?: Record<string, unknown>,
		callback?: () => void,
	) => unknown;
	addModel: (data: string, format: string, options?: Record<string, unknown>) => unknown;
	clear?: () => void;
	removeAllSurfaces?: () => unknown;
	render: () => unknown;
	resize?: () => void;
	setBackgroundColor?: (color: string | number, alpha?: number) => void;
	setStyle: (selection: Record<string, unknown>, style: Record<string, unknown>) => void;
	zoomTo: () => unknown;
};

type TidyTreeConstructor = new (newick: string, options?: Record<string, unknown>) => TidyTreeInstance;

type TidyTreeInstance = {
	draw?: (target: HTMLElement) => TidyTreeInstance;
	destroy?: () => void;
	recenter?: () => void;
	redraw?: () => TidyTreeInstance;
	transform?: { k: number; x: number; y: number };
};

let rdkitPromise: Promise<RDKitModule> | null = null;
let ketcherPromise: Promise<KetcherRuntime> | null = null;
let igvPromise: Promise<typeof import("igv")> | null = null;
let tidyTreePromise: Promise<TidyTreeConstructor> | null = null;

type KetcherInstance = {
	getMolfile: () => Promise<string>;
	getSmiles: () => Promise<string>;
	layout: () => Promise<void>;
	setMolecule: (structStr: string, options?: { needZoom?: boolean }) => Promise<void | undefined>;
};

type KetcherEditorProps = {
	disableMacromoleculesEditor?: boolean;
	errorHandler?: (message: string) => void;
	onInit?: (ketcher: KetcherInstance) => void;
	staticResourcesUrl: string;
	structServiceProvider: unknown;
};

type KetcherRuntime = {
	Editor: ComponentType<KetcherEditorProps>;
	createProvider: () => unknown;
};

const STRUCTURE_STYLE_OPTIONS: Array<{ id: ThreeDmolStyleMode; label: string }> = [
	{ id: "cartoon", label: "Cartoon" },
	{ id: "stick", label: "Stick" },
	{ id: "sphere", label: "Sphere" },
	{ id: "surface", label: "Surface" },
	{ id: "line", label: "Line" },
];

const MOLECULE_STYLE_OPTIONS: Array<{ id: ThreeDmolStyleMode; label: string }> = [
	{ id: "ball-stick", label: "Ball" },
	{ id: "stick", label: "Stick" },
	{ id: "sphere", label: "Sphere" },
	{ id: "line", label: "Line" },
];

const TIDY_TREE_MARGIN: [number, number, number, number] = [28, 72, 34, 48];

function defaultStyleMode(kind: "molecule" | "structure"): ThreeDmolStyleMode {
	return kind === "structure" ? "cartoon" : "ball-stick";
}

async function loadRdkit(): Promise<RDKitModule> {
	if (!rdkitPromise) {
		rdkitPromise = import("@rdkit/rdkit").then((module) => {
			const candidate = module as typeof module & {
				default?: RDKitLoader;
				"module.exports"?: RDKitLoader;
			};
			const loader = candidate.default ?? candidate["module.exports"] ?? window.initRDKitModule;
			if (!loader) throw new Error("RDKit loader is unavailable.");
			return loader({ locateFile: () => rdkitWasmUrl });
		});
	}
	return rdkitPromise;
}

async function loadKetcher(): Promise<KetcherRuntime> {
	if (!ketcherPromise) {
		const browserGlobal = globalThis as typeof globalThis & { global?: typeof globalThis };
		browserGlobal.global ??= globalThis;
		ketcherPromise = Promise.all([
			import("ketcher-react"),
			import("ketcher-standalone"),
			import("ketcher-react/dist/index.css"),
		]).then(([reactModule, standaloneModule]) => ({
			Editor: reactModule.Editor as ComponentType<KetcherEditorProps>,
			createProvider: () => new standaloneModule.StandaloneStructServiceProvider(),
		}));
	}
	return ketcherPromise;
}

async function loadIgv(): Promise<typeof import("igv")> {
	igvPromise ??= import("igv");
	return igvPromise;
}

async function loadTidyTree(): Promise<TidyTreeConstructor> {
	if (!tidyTreePromise) {
		tidyTreePromise = Promise.all([
			import("d3"),
			import("patristic"),
		]).then(async ([d3Module, patristicModule]) => {
			const browserGlobal = globalThis as typeof globalThis & { d3?: unknown; patristic?: unknown };
			browserGlobal.d3 = d3Module;
			browserGlobal.patristic = patristicModule;
			const tidyTreeModule = await import("tidytree/src/main.js");
			return tidyTreeModule.default as TidyTreeConstructor;
		});
	}
	return tidyTreePromise;
}

function applyTidyTreeInitialTransform(container: HTMLElement, layout: TidyTreeLayout): { k: number; x: number; y: number } {
	const svg = container.querySelector("svg");
	const group = svg?.querySelector(":scope > g");
	const width = svg instanceof SVGSVGElement ? svg.getBoundingClientRect().width : container.getBoundingClientRect().width;
	const height = svg instanceof SVGSVGElement ? svg.getBoundingClientRect().height : container.getBoundingClientRect().height;
	const transform = {
		k: 1,
		x: layout === "circular" ? TIDY_TREE_MARGIN[0] + width / 2 : TIDY_TREE_MARGIN[0],
		y: layout === "circular" ? TIDY_TREE_MARGIN[3] + height / 2 : TIDY_TREE_MARGIN[3],
	};
	group?.setAttribute("transform", `translate(${transform.x},${transform.y}) scale(${transform.k}) rotate(0)`);
	return transform;
}

function igvTrackConfig(track: GenomeBrowserTrack, objectUrl: string): TrackLoad<"annotation" | "variant"> {
	const common = {
		name: track.name,
		url: objectUrl,
		indexed: false as const,
		removable: false,
		color: "#225632",
	};
	if (track.type === "variant") {
		return {
			...common,
			type: "variant",
			format: "vcf",
			height: 160,
			displayMode: "EXPANDED",
			showGenotypes: false,
		};
	}
	return {
		...common,
		type: "annotation",
		format: track.format,
		height: 130,
		displayMode: "EXPANDED",
	};
}

function firstMoleculeInput(content: string, extension: string): MoleculeRenderInput | undefined {
	const ext = extension.toLowerCase();
	if (ext === ".smi" || ext === ".smiles" || ext === ".cxsmiles") {
		const line = content.split(/\r?\n/).find((item) => item.trim());
		if (!line) return undefined;
		const [smiles = "", ...nameParts] = line.trim().split(/\s+/);
		return smiles ? { input: smiles, label: nameParts.join(" ") || "SMILES molecule", type: "smiles" } : undefined;
	}
	if (ext === ".ket") return content.trim() ? { input: content, label: "Ketcher structure", type: "ket" } : undefined;
	if (ext === ".rxn") return content.trim() ? { input: content, label: "Reaction sketch", type: "rxn" } : undefined;
	if (ext === ".cdxml") return content.trim() ? { input: content, label: "ChemDraw structure", type: "cdxml" } : undefined;
	const molecule = content.split(/\n\$\$\$\$\s*(?:\r?\n|$)/).find((item) => item.trim())?.trim();
	if (!molecule) return undefined;
	return {
		input: molecule,
		label: molecule.split(/\r?\n/)[0]?.trim() || "Molecule",
		type: "molblock",
	};
}

function structureFormat(extension: string): string {
	const ext = extension.toLowerCase();
	if (ext === ".cif" || ext === ".mmcif") return "cif";
	if (ext === ".mol" || ext === ".sdf") return "sdf";
	return "pdb";
}

function applyThreeDmolStyle({
	kind,
	styleMode,
	threeDmol,
	viewer,
}: {
	kind: "molecule" | "structure";
	styleMode: ThreeDmolStyleMode;
	threeDmol: ThreeDmolModule;
	viewer: ThreeDmolViewer;
}): unknown {
	viewer.removeAllSurfaces?.();
	if (kind === "structure") {
		if (styleMode === "cartoon") {
			viewer.setStyle({}, { cartoon: { color: "spectrum" } });
			viewer.setStyle({ hetflag: true }, { stick: { radius: 0.18, colorscheme: "greenCarbon" } });
			viewer.setStyle({ resn: "GLY" }, { stick: { radius: 0.12, colorscheme: "Jmol" } });
			return undefined;
		}
		if (styleMode === "stick") {
			viewer.setStyle({}, { stick: { radius: 0.16, colorscheme: "Jmol" } });
			return undefined;
		}
		if (styleMode === "sphere") {
			viewer.setStyle({}, { sphere: { scale: 0.32, colorscheme: "Jmol" } });
			return undefined;
		}
		if (styleMode === "line") {
			viewer.setStyle({}, { line: { colorscheme: "Jmol" } });
			return undefined;
		}
		viewer.setStyle({}, { cartoon: { color: "spectrum", opacity: 0.28 } });
		viewer.setStyle({ hetflag: true }, { stick: { radius: 0.16, colorscheme: "greenCarbon" } });
		return viewer.addSurface?.(threeDmol.SurfaceType?.VDW ?? "VDW", { opacity: 0.74, color: "#99d8a2" }, {});
	}
	if (styleMode === "stick") {
		viewer.setStyle({}, { stick: { radius: 0.22, colorscheme: "Jmol" } });
		return undefined;
	}
	if (styleMode === "sphere") {
		viewer.setStyle({}, { sphere: { scale: 0.32, colorscheme: "Jmol" } });
		return undefined;
	}
	if (styleMode === "line") {
		viewer.setStyle({}, { line: { colorscheme: "Jmol" } });
		return undefined;
	}
	viewer.setStyle({}, { stick: { radius: 0.22, colorscheme: "Jmol" }, sphere: { scale: 0.24 } });
	return undefined;
}

export function RdkitMoleculePreview({ content, extension }: { content: string; extension: string }) {
	const input = firstMoleculeInput(content, extension);
	const [status, setStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading RDKit renderer" });
	const [svg, setSvg] = useState("");

	useEffect(() => {
		let cancelled = false;
		setSvg("");
		setStatus({ state: "loading", message: "Loading RDKit renderer" });
		if (!input) {
			setStatus({ state: "error", message: "No renderable molecule was found in this preview." });
			return;
		}
		if (input.type !== "molblock" && input.type !== "smiles") {
			setStatus({ state: "ready", message: `${input.label} opens in Ketcher; RDKit preview supports molfile, SDF, and SMILES.` });
			return;
		}
		loadRdkit()
			.then((rdkit) => {
				if (cancelled) return;
				const molecule = rdkit.get_mol(input.input);
				if (!molecule) {
					setStatus({ state: "error", message: `RDKit could not parse the first ${input.type === "smiles" ? "SMILES" : "mol block"} record.` });
					return;
				}
				try {
					const rendered = molecule.get_svg(360, 220);
					if (!cancelled) {
						setSvg(rendered);
						setStatus({ state: "ready", message: `RDKit ${rdkit.version()} | ${input.label}` });
					}
				} finally {
					molecule.delete();
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "RDKit renderer failed to load." });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [content, extension, input?.input, input?.label, input?.type]);

	return (
		<div className="science-render-panel molecule-render-panel">
			<div className="science-render-stage molecule-render-stage" data-render-state={status.state}>
				{svg ? <div className="rdkit-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span>{status.message}</span>}
			</div>
			<p>{status.message}</p>
		</div>
	);
}

export function KetcherMoleculeEditor({
	content,
	extension,
	onSave,
}: {
	content: string;
	extension: string;
	onSave?: (result: KetcherMoleculeExport) => Promise<void> | void;
}) {
	const input = firstMoleculeInput(content, extension);
	const [open, setOpen] = useState(false);
	const [runtime, setRuntime] = useState<KetcherRuntime | null>(null);
	const [ketcher, setKetcher] = useState<KetcherInstance | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<ViewerStatus>({ state: "ready", message: "Chemistry editor closed" });
	const provider = useMemo(() => runtime?.createProvider(), [runtime]);
	const saveFormat: KetcherMoleculeFormat = extension.toLowerCase() === ".smi" || extension.toLowerCase() === ".smiles" ? "smiles" : "molfile";

	useEffect(() => {
		if (!open || runtime) return;
		let cancelled = false;
		setStatus({ state: "loading", message: "Loading Ketcher editor" });
		loadKetcher()
			.then((loaded) => {
				if (!cancelled) {
					setRuntime(loaded);
					setStatus({ state: "loading", message: "Starting standalone chemistry editor" });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "Ketcher editor failed to load." });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, runtime]);

	useEffect(() => {
		if (!open || !ketcher) return;
		if (!input) {
			setStatus({ state: "error", message: "No molecule could be loaded into Ketcher." });
			return;
		}
		let cancelled = false;
		setStatus({ state: "loading", message: "Loading molecule into Ketcher" });
		ketcher.setMolecule(input.input, { needZoom: true })
			.then(() => ketcher.layout())
			.then(() => {
				if (!cancelled) setStatus({ state: "ready", message: `Ketcher ready | ${input.label}` });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "Ketcher could not load this molecule." });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [input?.input, input?.label, ketcher, open]);

	async function exportMolecule(target: KetcherMoleculeFormat, action: "copy" | "save") {
		if (!ketcher || busy) return;
		setBusy(true);
		const exportLabel = target === "smiles" ? "SMILES" : "molfile";
		setStatus({ state: "loading", message: action === "save" ? `Saving ${exportLabel}` : `Copying ${exportLabel}` });
		try {
			const molfile = target === "molfile" ? await ketcher.getMolfile() : "";
			const smiles = target === "smiles" ? await ketcher.getSmiles() : "";
			const contentToSave = target === "smiles" ? `${smiles.trim()}\n` : molfile;
			if (action === "copy" && navigator.clipboard) await navigator.clipboard.writeText(contentToSave.trim());
			if (action === "save" && target === saveFormat && onSave) await onSave({ content: contentToSave, format: target, molfile, smiles });
			setStatus({
				state: "ready",
				message: action === "save" && target === saveFormat && onSave
					? `Saved ${exportLabel} through artifact history`
					: `Copied ${exportLabel} export`,
			});
		} catch (error) {
			setStatus({ state: "error", message: error instanceof Error ? error.message : "Ketcher export failed." });
		} finally {
			setBusy(false);
		}
	}

	const Editor = runtime?.Editor;

	return (
		<div className="science-render-panel ketcher-editor-panel">
			<div className="science-viewer-toolbar" role="group" aria-label="Chemistry editor actions">
				<button type="button" className={`science-viewer-mode${open ? " is-active" : ""}`} aria-pressed={open} onClick={() => setOpen((value) => !value)}>
					{open ? "Close editor" : "Open editor"}
				</button>
				<button type="button" className="science-viewer-mode" disabled={!ketcher || busy} onClick={() => void exportMolecule(saveFormat, "save")}>
					Save {saveFormat === "smiles" ? "SMILES" : "molfile"}
				</button>
				<button type="button" className="science-viewer-reset" disabled={!ketcher || busy} onClick={() => void exportMolecule("smiles", "copy")}>
					Copy SMILES
				</button>
			</div>
			{open ? (
				<div className="ketcher-editor-stage" data-render-state={status.state}>
					{Editor && provider ? (
						<Editor
							disableMacromoleculesEditor
							staticResourcesUrl={import.meta.env.BASE_URL}
							structServiceProvider={provider}
							errorHandler={(message) => setStatus({ state: "error", message })}
							onInit={(nextKetcher) => setKetcher(nextKetcher)}
						/>
					) : (
						<span>{status.message}</span>
					)}
				</div>
			) : null}
			<p>{status.message}</p>
		</div>
	);
}

export function ThreeDmolPreview({
	content,
	extension,
	kind,
}: {
	content: string;
	extension: string;
	kind: "molecule" | "structure";
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [resetNonce, setResetNonce] = useState(0);
	const [styleMode, setStyleMode] = useState<ThreeDmolStyleMode>(defaultStyleMode(kind));
	const [status, setStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading 3Dmol renderer" });
	const styleOptions = kind === "structure" ? STRUCTURE_STYLE_OPTIONS : MOLECULE_STYLE_OPTIONS;

	useEffect(() => {
		setStyleMode(defaultStyleMode(kind));
	}, [kind]);

	useEffect(() => {
		let cancelled = false;
		let viewer: ThreeDmolViewer | undefined;
		let observer: ResizeObserver | undefined;
		const container = containerRef.current;
		if (!container) return undefined;
		container.replaceChildren();
		setStatus({ state: "loading", message: "Loading 3Dmol renderer" });
		import("3dmol/build/3Dmol.js")
			.then((module) => {
				if (cancelled || !containerRef.current) return;
				const threeDmol = module as unknown as ThreeDmolModule;
				viewer = threeDmol.createViewer(containerRef.current, { backgroundColor: "white" });
				viewer.setBackgroundColor?.("white", 0);
				const format = structureFormat(extension);
				viewer.addModel(content, format, { multimodel: true });
				const surface = applyThreeDmolStyle({ kind, styleMode, threeDmol, viewer });
				viewer.zoomTo();
				viewer.render();
				observer = new ResizeObserver(() => {
					viewer?.resize?.();
					viewer?.render();
				});
				observer.observe(containerRef.current);
				const readyStatus = { state: "ready" as const, message: `3Dmol ${format.toUpperCase()} viewer | ${styleOptions.find((option) => option.id === styleMode)?.label ?? styleMode}` };
				if (surface && typeof (surface as Promise<unknown>).then === "function") {
					void (surface as Promise<unknown>)
						.then(() => {
							if (!cancelled) {
								viewer?.render();
								setStatus(readyStatus);
							}
						})
						.catch((error: unknown) => {
							if (!cancelled) {
								setStatus({ state: "error", message: error instanceof Error ? error.message : "3Dmol surface renderer failed." });
							}
						});
				} else {
					setStatus(readyStatus);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "3Dmol renderer failed to load." });
				}
			});
		return () => {
			cancelled = true;
			observer?.disconnect();
			viewer?.clear?.();
			container.replaceChildren();
		};
	}, [content, extension, kind, resetNonce, styleMode, styleOptions]);

	return (
		<div className="science-render-panel structure-render-panel">
			<div className="science-viewer-toolbar" role="group" aria-label={`${kind === "structure" ? "Structure" : "Molecule"} style`}>
				{styleOptions.map((option) => (
					<button
						key={option.id}
						type="button"
						className={`science-viewer-mode${styleMode === option.id ? " is-active" : ""}`}
						aria-pressed={styleMode === option.id}
						onClick={() => setStyleMode(option.id)}
					>
						{option.label}
					</button>
				))}
				<button type="button" className="science-viewer-reset" onClick={() => setResetNonce((value) => value + 1)}>
					Reset
				</button>
			</div>
			<div ref={containerRef} className="science-render-stage structure-render-stage" data-render-state={status.state} />
			<p>{status.message}</p>
		</div>
	);
}

export function IgvGenomePreview({
	content,
	track,
	truncated,
}: {
	content: string;
	track: GenomeBrowserTrack;
	truncated: boolean;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<ViewerStatus>({
		state: "loading",
		message: "Loading IGV genome browser",
	});

	useEffect(() => {
		let cancelled = false;
		let browser: IgvBrowser | undefined;
		let igvRuntime: { removeBrowser: (browser: IgvBrowser) => void } | undefined;
		let objectUrl: string | undefined;
		const container = containerRef.current;
		container?.replaceChildren();
		if (!container) {
			return undefined;
		}
		setStatus({ state: "loading", message: "Loading IGV genome browser" });
		objectUrl = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
		loadIgv()
			.then(async (module) => {
				if (cancelled || !containerRef.current || !objectUrl) return;
				const igv = module.default;
				igvRuntime = igv;
				browser = await igv.createBrowser(containerRef.current, {
					genome: "hg38",
					locus: track.locus,
					tracks: [igvTrackConfig(track, objectUrl)],
				});
				if (!cancelled) {
					setStatus({
						state: "ready",
						message: `IGV ${igv.version()} | ${track.format.toUpperCase()} at ${track.locus}${truncated ? " | preview truncated" : ""}`,
					});
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "IGV genome browser failed to load." });
				}
			});
		return () => {
			cancelled = true;
			const mountedBrowser = browser;
			if (mountedBrowser && igvRuntime) {
				try {
					igvRuntime.removeBrowser(mountedBrowser);
				} catch {
					container.replaceChildren();
				}
			} else {
				container.replaceChildren();
			}
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [content, track?.format, track?.locus, track?.name, track?.type, truncated]);

	return (
		<div className="science-render-panel igv-render-panel">
			<div ref={containerRef} className="science-render-stage igv-render-stage" data-render-state={status.state} />
			<p>{status.message}</p>
		</div>
	);
}

export function TidyTreePreview({ preview }: { preview: TreePreview }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState<TidyTreeLayout>("horizontal");
	const [type, setType] = useState<TidyTreeType>("weighted");
	const [leafLabels, setLeafLabels] = useState(true);
	const [resetNonce, setResetNonce] = useState(0);
	const [status, setStatus] = useState<ViewerStatus>({ state: "loading", message: "Loading phylogenetic tree viewer" });

	useEffect(() => {
		let cancelled = false;
		let tree: TidyTreeInstance | undefined;
		const container = containerRef.current;
		container?.replaceChildren();
		if (!container) return undefined;
		if (!preview.newick) {
			setStatus({ state: "error", message: "No Newick tree was found in this artifact." });
			return undefined;
		}
		setStatus({ state: "loading", message: "Loading TidyTree phylogenetic viewer" });
		loadTidyTree()
			.then((TidyTree) => {
				if (cancelled || !containerRef.current) return;
				tree = new TidyTree(preview.newick, {
					layout,
					type,
					mode: "square",
					leafLabels,
					branchLabels: !leafLabels,
					branchDistances: type === "weighted",
					branchNodes: false,
					leafNodes: true,
					ruler: type === "weighted",
					animation: 0,
					margin: TIDY_TREE_MARGIN,
				});
				tree.draw?.(containerRef.current);
				tree.redraw?.();
				tree.transform = applyTidyTreeInitialTransform(containerRef.current, layout);
				setStatus({
					state: "ready",
					message: `TidyTree ${preview.format.toUpperCase()} | ${preview.leafCount} leaves | ${layout} ${type}`,
				});
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus({ state: "error", message: error instanceof Error ? error.message : "TidyTree failed to render this tree." });
				}
			});
		return () => {
			cancelled = true;
			tree?.destroy?.();
			container.replaceChildren();
		};
	}, [layout, leafLabels, preview.format, preview.leafCount, preview.newick, resetNonce, type]);

	return (
		<div className="science-render-panel tree-render-panel">
			<div className="science-viewer-toolbar" role="group" aria-label="Phylogenetic tree display">
				{(["horizontal", "vertical", "circular"] as TidyTreeLayout[]).map((option) => (
					<button
						key={option}
						type="button"
						className={`science-viewer-mode${layout === option ? " is-active" : ""}`}
						aria-pressed={layout === option}
						onClick={() => setLayout(option)}
					>
						{option[0]?.toUpperCase()}{option.slice(1)}
					</button>
				))}
				{(["weighted", "tree", "dendrogram"] as TidyTreeType[]).map((option) => (
					<button
						key={option}
						type="button"
						className={`science-viewer-mode${type === option ? " is-active" : ""}`}
						aria-pressed={type === option}
						onClick={() => setType(option)}
					>
						{option[0]?.toUpperCase()}{option.slice(1)}
					</button>
				))}
				<button type="button" className={`science-viewer-mode${leafLabels ? " is-active" : ""}`} aria-pressed={leafLabels} onClick={() => setLeafLabels((value) => !value)}>
					Labels
				</button>
				<button type="button" className="science-viewer-reset" onClick={() => setResetNonce((value) => value + 1)}>
					Reset
				</button>
			</div>
			<div ref={containerRef} className="science-render-stage tree-render-stage" data-render-state={status.state} />
			<p>{status.message}</p>
		</div>
	);
}
