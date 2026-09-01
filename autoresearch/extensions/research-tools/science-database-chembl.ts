export type ChemblEntity = "assay" | "molecule" | "target";

type SearchParams = {
	chemblEntity?: ChemblEntity;
	limit?: number;
	query: string;
	source: "chembl";
};

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 25_000;
const DOCS_URL = "https://chembl.gitbook.io/chembl-interface-documentation/web-services/chembl-data-web-services";

type ParsedQuery = {
	bare: string;
	mode: string;
	values: Record<string, string>;
};

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "y"].includes(normalized)) return true;
	if (["0", "false", "no", "n"].includes(normalized)) return false;
	return undefined;
}

function safeLimit(value: number | undefined): number {
	if (!Number.isFinite(value) || value === undefined) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function cleanQuery(query: string): string {
	const clean = query.trim();
	if (!clean) throw new Error("ChEMBL search requires a non-empty query.");
	return clean;
}

function parseQuery(query: string): ParsedQuery {
	let working = cleanQuery(query);
	let mode = "search";
	const colon = working.match(/^([a-z][a-z-]*):(.*)$/i);
	if (colon) {
		mode = colon[1]!.toLowerCase();
		working = colon[2]!.trim();
	} else {
		const first = working.match(/^([a-z][a-z-]*)\b(.*)$/i);
		if (first && ["admet", "bioactivity", "compound", "drug", "mechanism", "target"].includes(first[1]!.toLowerCase())) {
			mode = first[1]!.toLowerCase();
			working = first[2]!.trim();
		}
	}
	const values: Record<string, string> = {};
	working = working.replace(/([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g, (_match, key: string, doubleQuoted?: string, singleQuoted?: string, bare?: string) => {
		values[key.replaceAll("-", "_").toLowerCase()] = doubleQuoted ?? singleQuoted ?? bare ?? "";
		return " ";
	}).trim();
	return { bare: working, mode, values };
}

async function responseFor(url: URL): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: { accept: "application/json" },
			signal: controller.signal,
		});
		if (response.status === 404) {
			return new Response(JSON.stringify({ page_meta: { total_count: 0 } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (!response.ok) throw new Error(`ChEMBL request failed: ${response.status} ${response.statusText}`);
		return response;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchJson(url: URL): Promise<Record<string, unknown>> {
	return recordValue(await (await responseFor(url)).json());
}

function chemblResultUrl(entity: ChemblEntity, id: string): string {
	const segment = entity === "molecule" ? "compound_report_card" : entity === "target" ? "target_report_card" : "assay_report_card";
	return `https://www.ebi.ac.uk/chembl/${segment}/${encodeURIComponent(id)}/`;
}

function moleculeProperties(value: unknown): Record<string, unknown> | undefined {
	const properties = recordValue(value);
	if (!Object.keys(properties).length) return undefined;
	return {
		alogp: numberValue(properties.alogp),
		aromaticRings: numberValue(properties.aromatic_rings),
		fullMolecularWeight: numberValue(properties.full_mwt),
		freebaseMolecularWeight: numberValue(properties.mw_freebase),
		hba: numberValue(properties.hba),
		hbd: numberValue(properties.hbd),
		heavyAtoms: numberValue(properties.heavy_atoms),
		molecularFormula: stringValue(properties.full_molformula),
		numRuleOfFiveViolations: numberValue(properties.num_ro5_violations),
		polarSurfaceArea: numberValue(properties.psa),
		qedWeighted: numberValue(properties.qed_weighted),
		rotatableBonds: numberValue(properties.rtb),
		ruleOfThreePass: stringValue(properties.ro3_pass),
	};
}

function normalizeMolecule(record: Record<string, unknown>): Record<string, unknown> {
	const id = stringValue(record.molecule_chembl_id);
	const structures = recordValue(record.molecule_structures);
	return {
		chemblId: id,
		name: stringValue(record.pref_name),
		moleculeType: stringValue(record.molecule_type),
		maxPhase: numberValue(record.max_phase),
		firstApproval: numberValue(record.first_approval),
		oral: booleanValue(record.oral),
		parenteral: booleanValue(record.parenteral),
		topical: booleanValue(record.topical),
		therapeuticFlag: booleanValue(record.therapeutic_flag),
		blackBoxWarning: booleanValue(record.black_box_warning),
		withdrawnFlag: booleanValue(record.withdrawn_flag),
		naturalProduct: booleanValue(record.natural_product),
		smiles: stringValue(structures.canonical_smiles),
		inchi: stringValue(structures.standard_inchi),
		inchiKey: stringValue(structures.standard_inchi_key),
		synonyms: arrayValue(record.molecule_synonyms).flatMap((synonym) => {
			const normalized = recordValue(synonym);
			return stringValue(normalized.molecule_synonym) ? [stringValue(normalized.molecule_synonym)] : [];
		}).slice(0, 20),
		properties: moleculeProperties(record.molecule_properties),
		score: numberValue(record.score) ?? numberValue(record.similarity),
		url: id ? chemblResultUrl("molecule", id) : undefined,
	};
}

function normalizeTarget(record: Record<string, unknown>): Record<string, unknown> {
	const id = stringValue(record.target_chembl_id);
	const components = arrayValue(record.target_components).map((component) => {
		const normalized = recordValue(component);
		const geneSymbol = arrayValue(normalized.target_component_synonyms).flatMap((synonym) => {
			const syn = recordValue(synonym);
			return stringValue(syn.syn_type) === "GENE_SYMBOL" && stringValue(syn.component_synonym) ? [stringValue(syn.component_synonym)] : [];
		})[0];
		return {
			accession: stringValue(normalized.accession),
			componentDescription: stringValue(normalized.component_description),
			componentId: numberValue(normalized.component_id),
			componentType: stringValue(normalized.component_type),
			geneSymbol,
			relationship: stringValue(normalized.relationship),
			xrefs: arrayValue(normalized.target_component_xrefs).slice(0, 25).map((xref) => {
				const normalizedXref = recordValue(xref);
				return {
					id: stringValue(normalizedXref.xref_id),
					name: stringValue(normalizedXref.xref_name),
					source: stringValue(normalizedXref.xref_src_db),
				};
			}),
		};
	});
	return {
		chemblId: id,
		name: stringValue(record.pref_name),
		organism: stringValue(record.organism),
		taxId: numberValue(record.tax_id),
		type: stringValue(record.target_type),
		score: numberValue(record.score),
		speciesGroupFlag: booleanValue(record.species_group_flag),
		components,
		url: id ? chemblResultUrl("target", id) : undefined,
	};
}

function normalizeAssay(record: Record<string, unknown>): Record<string, unknown> {
	const id = stringValue(record.assay_chembl_id);
	return {
		chemblId: id,
		description: stringValue(record.description),
		organism: stringValue(record.assay_organism),
		type: stringValue(record.assay_type),
		cellType: stringValue(record.assay_cell_type),
		targetChemblId: stringValue(record.target_chembl_id),
		url: id ? chemblResultUrl("assay", id) : undefined,
	};
}

function normalizeChemblResults(entity: ChemblEntity, payload: Record<string, unknown>): Array<Record<string, unknown>> {
	if (entity === "molecule") return arrayValue(payload.molecules).map((item) => normalizeMolecule(recordValue(item)));
	if (entity === "target") return arrayValue(payload.targets).map((item) => normalizeTarget(recordValue(item)));
	return arrayValue(payload.assays).map((item) => normalizeAssay(recordValue(item)));
}

function pageTotal(payload: Record<string, unknown>, fallback: number): number {
	return numberValue(recordValue(payload.page_meta).total_count) ?? fallback;
}

function withLimit(values: Record<string, string>, limit: number): URLSearchParams {
	return new URLSearchParams({ ...values, limit: String(limit) });
}

async function searchLegacy(params: SearchParams): Promise<Record<string, unknown>> {
	const query = cleanQuery(params.query);
	const limit = safeLimit(params.limit);
	const entity = params.chemblEntity ?? "molecule";
	const url = new URL(`${CHEMBL_BASE}/${entity}/search.json`);
	url.search = withLimit({ q: query }, limit).toString();
	const payload = await fetchJson(url);
	const results = normalizeChemblResults(entity, payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "search",
		entity,
		query,
		totalCount: pageTotal(payload, results.length),
		returned: results.length,
		results,
		provenance: {
			docs: DOCS_URL,
			endpoints: [url.toString()],
		},
	};
}

async function searchCompound(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const moleculeId = parsed.values.chembl_id ?? parsed.values.molecule_chembl_id ?? (/^CHEMBL\d+$/i.test(parsed.bare) ? parsed.bare : undefined);
	const maxPhase = parsed.values.max_phase;
	let url: URL;
	let queryKind = "name";
	if (moleculeId) {
		url = new URL(`${CHEMBL_BASE}/molecule.json`);
		url.search = withLimit({ molecule_chembl_id__in: moleculeId.toUpperCase(), ...(maxPhase ? { max_phase: maxPhase } : {}) }, limit).toString();
		queryKind = "chembl-id";
	} else if (parsed.values.smiles) {
		const threshold = parsed.values.similarity_threshold ?? parsed.values.threshold;
		if (threshold) {
			url = new URL(`${CHEMBL_BASE}/similarity/${encodeURIComponent(parsed.values.smiles)}/${encodeURIComponent(threshold)}.json`);
			queryKind = "similarity";
		} else {
			url = new URL(`${CHEMBL_BASE}/substructure/${encodeURIComponent(parsed.values.smiles)}.json`);
			queryKind = "substructure";
		}
		url.search = withLimit(maxPhase ? { max_phase: maxPhase } : {}, limit).toString();
	} else {
		const name = parsed.values.name ?? parsed.bare;
		url = new URL(`${CHEMBL_BASE}/molecule.json`);
		url.search = withLimit({ molecule_synonyms__molecule_synonym__icontains: cleanQuery(name), ...(maxPhase ? { max_phase: maxPhase } : {}) }, limit).toString();
	}
	const payload = await fetchJson(url);
	const results = normalizeChemblResults("molecule", payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "compound-search",
		queryKind,
		query: parsed.bare || parsed.values.name || moleculeId || parsed.values.smiles,
		totalCount: pageTotal(payload, results.length),
		returned: results.length,
		results,
		truncated: results.length < pageTotal(payload, results.length),
		provenance: { docs: DOCS_URL, endpoints: [url.toString()] },
	};
}

function normalizeIndicationRow(row: Record<string, unknown>): Record<string, unknown> {
	return {
		drugIndicationId: numberValue(row.drugind_id),
		efoId: stringValue(row.efo_id),
		efoTerm: stringValue(row.efo_term),
		maxPhaseForIndication: numberValue(row.max_phase_for_ind),
		meshHeading: stringValue(row.mesh_heading),
		moleculeChemblId: stringValue(row.molecule_chembl_id),
		parentMoleculeChemblId: stringValue(row.parent_molecule_chembl_id),
	};
}

function warningSummary(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	return rows.map((warning) => ({
		warningId: numberValue(warning.warning_id),
		warningClass: stringValue(warning.warning_class),
		warningType: stringValue(warning.warning_type),
		warningYear: numberValue(warning.warning_year),
		country: stringValue(warning.country),
		efoTerm: stringValue(warning.efo_term),
	}));
}

async function searchDrugs(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const indication = cleanQuery(parsed.values.indication ?? parsed.bare);
	const onlyApproved = booleanValue(parsed.values.only_approved) ?? false;
	const matchField = parsed.values.match_field === "mesh" ? "mesh_heading__icontains" : "efo_term__icontains";
	const indicationLimit = String(Math.min(100, Math.max(limit * 10, 20)));
	const indicationUrl = new URL(`${CHEMBL_BASE}/drug_indication.json`);
	indicationUrl.search = new URLSearchParams({
		[matchField]: indication,
		...(onlyApproved ? { max_phase_for_ind: "4" } : {}),
		limit: indicationLimit,
		order_by: "drugind_id",
	}).toString();
	const indicationPayload = await fetchJson(indicationUrl);
	const indicationRows = arrayValue(indicationPayload.drug_indications).map((row) => recordValue(row));
	const phaseByParent = new Map<string, number>();
	const rowsByParent = new Map<string, Array<Record<string, unknown>>>();
	for (const row of indicationRows) {
		const parent = stringValue(row.parent_molecule_chembl_id);
		if (!parent) continue;
		const phase = numberValue(row.max_phase_for_ind) ?? -1;
		if (phase > (phaseByParent.get(parent) ?? -2)) phaseByParent.set(parent, phase);
		const rows = rowsByParent.get(parent) ?? [];
		rows.push(row);
		rowsByParent.set(parent, rows);
	}
	let parents = [...phaseByParent.keys()].sort((a, b) => (phaseByParent.get(b) ?? -1) - (phaseByParent.get(a) ?? -1) || a.localeCompare(b));
	if (parsed.values.molecule_chembl_id ?? parsed.values.molecule) {
		const wanted = (parsed.values.molecule_chembl_id ?? parsed.values.molecule)!.toUpperCase();
		parents = parents.filter((parent) => parent.toUpperCase() === wanted);
	}
	const totalParents = parents.length;
	const selectedParents = parents.slice(0, limit);
	const moleculeUrl = new URL(`${CHEMBL_BASE}/molecule.json`);
	moleculeUrl.search = withLimit({ molecule_chembl_id__in: selectedParents.join(","), only: "molecule_chembl_id,pref_name,max_phase,first_approval,withdrawn_flag,black_box_warning,molecule_type,molecule_hierarchy" }, Math.max(1, selectedParents.length)).toString();
	const moleculePayload = selectedParents.length ? await fetchJson(moleculeUrl) : { molecules: [], page_meta: { total_count: 0 } };
	const moleculeById = new Map(arrayValue(moleculePayload.molecules).map((molecule) => {
		const normalized = recordValue(molecule);
		return [stringValue(normalized.molecule_chembl_id), normalized] as const;
	}).filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry[0])));
	const warningUrl = new URL(`${CHEMBL_BASE}/drug_warning.json`);
	warningUrl.search = withLimit({ parent_molecule_chembl_id__in: selectedParents.join(",") }, Math.max(1, selectedParents.length * 5)).toString();
	const warningPayload = selectedParents.length ? await fetchJson(warningUrl) : { drug_warnings: [], page_meta: { total_count: 0 } };
	const warningsByParent = new Map<string, Array<Record<string, unknown>>>();
	for (const warning of arrayValue(warningPayload.drug_warnings).map((row) => recordValue(row))) {
		const parent = stringValue(warning.parent_molecule_chembl_id);
		if (!parent) continue;
		const rows = warningsByParent.get(parent) ?? [];
		rows.push(warning);
		warningsByParent.set(parent, rows);
	}
	let drugs: Array<Record<string, unknown>> = selectedParents.map((parent) => ({
		...normalizeMolecule(moleculeById.get(parent) ?? { molecule_chembl_id: parent }),
		parentMoleculeChemblId: parent,
		bestPhaseForIndication: phaseByParent.get(parent),
		indicationRows: (rowsByParent.get(parent) ?? []).map(normalizeIndicationRow),
		warningSummary: warningSummary(warningsByParent.get(parent) ?? []),
	}));
	if (parsed.values.drug_name) {
		const needle = parsed.values.drug_name.toLowerCase();
		drugs = drugs.filter((drug) => String(drug.name ?? "").toLowerCase().includes(needle));
	}
	if (parsed.values.max_phase) {
		const wanted = Number(parsed.values.max_phase);
		drugs = drugs.filter((drug) => numberValue(drug.maxPhase) !== undefined && numberValue(drug.maxPhase)! >= wanted);
	}
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "drug-search",
		indicationQuery: { term: indication, matchField: parsed.values.match_field === "mesh" ? "mesh" : "efo", onlyApproved },
		totalIndicationRows: pageTotal(indicationPayload, indicationRows.length),
		totalParents,
		returned: drugs.length,
		drugs,
		truncated: drugs.length < totalParents,
		provenance: { docs: DOCS_URL, endpoints: [indicationUrl.toString(), moleculeUrl.toString(), warningUrl.toString()] },
	};
}

async function getAdmet(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const moleculeId = cleanQuery(parsed.values.molecule_chembl_id ?? parsed.values.molecule ?? parsed.bare).toUpperCase();
	const url = new URL(`${CHEMBL_BASE}/molecule.json`);
	url.search = withLimit({ molecule_chembl_id__in: moleculeId }, 1).toString();
	const payload = await fetchJson(url);
	const molecule = recordValue(arrayValue(payload.molecules)[0]);
	const properties = moleculeProperties(molecule.molecule_properties);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "admet-properties",
		query: moleculeId,
		found: Boolean(properties),
		properties: properties ? { moleculeChemblId: stringValue(molecule.molecule_chembl_id) ?? moleculeId, ...properties } : undefined,
		provenance: { docs: DOCS_URL, endpoints: [url.toString()] },
	};
}

function normalizeActivity(record: Record<string, unknown>): Record<string, unknown> {
	return {
		activityId: numberValue(record.activity_id),
		moleculeChemblId: stringValue(record.molecule_chembl_id),
		moleculeName: stringValue(record.molecule_pref_name),
		parentMoleculeChemblId: stringValue(record.parent_molecule_chembl_id),
		targetChemblId: stringValue(record.target_chembl_id),
		targetName: stringValue(record.target_pref_name),
		targetOrganism: stringValue(record.target_organism),
		standardType: stringValue(record.standard_type),
		standardRelation: stringValue(record.standard_relation),
		standardValue: numberValue(record.standard_value),
		standardUnits: stringValue(record.standard_units),
		pchemblValue: numberValue(record.pchembl_value),
		assayChemblId: stringValue(record.assay_chembl_id),
		assayDescription: stringValue(record.assay_description),
		assayType: stringValue(record.assay_type),
		dataValidityComment: stringValue(record.data_validity_comment),
		activityComment: stringValue(record.activity_comment),
		documentChemblId: stringValue(record.document_chembl_id),
		documentJournal: stringValue(record.document_journal),
		documentYear: numberValue(record.document_year),
		potentialDuplicate: booleanValue(record.potential_duplicate),
	};
}

function activitySummary(activities: Array<Record<string, unknown>>): string {
	const scored = activities
		.filter((activity) => numberValue(activity.pchemblValue) !== undefined)
		.sort((a, b) => numberValue(b.pchemblValue)! - numberValue(a.pchemblValue)!)
		.slice(0, 3);
	if (!scored.length) return "No pChEMBL-scored activities in this result set";
	return `Most potent activities: ${scored.map((activity) => `${activity.targetName ?? activity.targetChemblId}: ${activity.standardType}=${activity.standardValue ?? "?"}${activity.standardUnits ?? ""} (pChEMBL=${numberValue(activity.pchemblValue)?.toFixed(2)})`).join("; ")}`;
}

async function getBioactivity(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const filters: Record<string, string> = {};
	const moleculeId = parsed.values.molecule_chembl_id ?? parsed.values.molecule;
	const targetId = parsed.values.target_chembl_id ?? parsed.values.target;
	if (moleculeId) filters.molecule_chembl_id = moleculeId.toUpperCase();
	if (targetId) filters.target_chembl_id = targetId.toUpperCase();
	if (parsed.values.activity_type ?? parsed.values.type) filters.standard_type = (parsed.values.activity_type ?? parsed.values.type)!.toUpperCase();
	if (parsed.values.min_pchembl) filters.pchembl_value__gte = parsed.values.min_pchembl;
	if (parsed.values.min_value) filters.standard_value__gte = parsed.values.min_value;
	if (parsed.values.max_value) filters.standard_value__lte = parsed.values.max_value;
	if (parsed.values.unit) filters.standard_units = parsed.values.unit;
	if (!Object.keys(filters).length) throw new Error("ChEMBL bioactivity mode requires molecule=, target=, activity_type=, or another bounded filter.");
	const url = new URL(`${CHEMBL_BASE}/activity.json`);
	url.search = new URLSearchParams({ ...filters, limit: String(limit), offset: "0", order_by: "activity_id" }).toString();
	const payload = await fetchJson(url);
	const activities = arrayValue(payload.activities).map((item) => normalizeActivity(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "bioactivity",
		filters,
		totalCount: pageTotal(payload, activities.length),
		returned: activities.length,
		activities,
		summary: activitySummary(activities),
		truncated: activities.length < pageTotal(payload, activities.length),
		provenance: { docs: DOCS_URL, endpoints: [url.toString()] },
	};
}

function normalizeMechanism(record: Record<string, unknown>): Record<string, unknown> {
	return {
		mechanismId: numberValue(record.mec_id),
		moleculeChemblId: stringValue(record.molecule_chembl_id),
		parentMoleculeChemblId: stringValue(record.parent_molecule_chembl_id),
		mechanismOfAction: stringValue(record.mechanism_of_action),
		targetChemblId: stringValue(record.target_chembl_id),
		actionType: stringValue(record.action_type),
		directInteraction: booleanValue(record.direct_interaction),
		diseaseEfficacy: booleanValue(record.disease_efficacy),
		mechanismComment: stringValue(record.mechanism_comment),
		bindingSiteComment: stringValue(record.binding_site_comment),
		selectivityComment: stringValue(record.selectivity_comment),
		molecularMechanism: booleanValue(record.molecular_mechanism),
		maxPhase: numberValue(record.max_phase),
		recordId: numberValue(record.record_id),
		siteId: numberValue(record.site_id),
		mechanismRefs: arrayValue(record.mechanism_refs).slice(0, 10),
	};
}

function mechanismSummary(mechanisms: Array<Record<string, unknown>>): string {
	const counts = new Map<string, number>();
	for (const mechanism of mechanisms) {
		const action = stringValue(mechanism.actionType);
		if (action) counts.set(action, (counts.get(action) ?? 0) + 1);
	}
	if (!counts.size) return "No mechanism of action records found";
	return `Primary action types: ${[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([action, count]) => `${action} (${count})`).join(", ")}`;
}

async function getMechanism(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const filters: Record<string, string> = {};
	const moleculeId = parsed.values.molecule_chembl_id ?? parsed.values.molecule ?? (/^CHEMBL\d+$/i.test(parsed.bare) ? parsed.bare : undefined);
	const targetId = parsed.values.target_chembl_id ?? parsed.values.target;
	if (moleculeId) filters.molecule_chembl_id = moleculeId.toUpperCase();
	if (targetId) filters.target_chembl_id = targetId.toUpperCase();
	if (parsed.values.action_type) filters.action_type = parsed.values.action_type.toUpperCase();
	if (!Object.keys(filters).length) throw new Error("ChEMBL mechanism mode requires molecule=, target=, action_type=, or mechanism:<CHEMBL_ID>.");
	const url = new URL(`${CHEMBL_BASE}/mechanism.json`);
	url.search = new URLSearchParams({ ...filters, limit: String(limit), offset: "0", order_by: "mec_id" }).toString();
	let payload = await fetchJson(url);
	let fallbackUrl: URL | undefined;
	if (!arrayValue(payload.mechanisms).length && moleculeId) {
		fallbackUrl = new URL(`${CHEMBL_BASE}/mechanism.json`);
		const fallbackFilters = { ...filters };
		delete fallbackFilters.molecule_chembl_id;
		fallbackFilters.parent_molecule_chembl_id = moleculeId.toUpperCase();
		fallbackUrl.search = new URLSearchParams({ ...fallbackFilters, limit: String(limit), offset: "0", order_by: "mec_id" }).toString();
		payload = await fetchJson(fallbackUrl);
	}
	const mechanisms = arrayValue(payload.mechanisms).map((item) => normalizeMechanism(recordValue(item)));
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "mechanism",
		filters,
		totalCount: pageTotal(payload, mechanisms.length),
		returned: mechanisms.length,
		mechanisms,
		summary: mechanismSummary(mechanisms),
		truncated: mechanisms.length < pageTotal(payload, mechanisms.length),
		provenance: { docs: DOCS_URL, endpoints: [url.toString(), ...(fallbackUrl ? [fallbackUrl.toString()] : [])] },
	};
}

async function searchTargets(params: SearchParams, parsed: ParsedQuery): Promise<Record<string, unknown>> {
	const limit = safeLimit(params.limit);
	const filters: Record<string, string> = {};
	const targetId = parsed.values.target_chembl_id ?? parsed.values.target ?? (/^CHEMBL\d+$/i.test(parsed.bare) ? parsed.bare : undefined);
	const gene = parsed.values.gene_symbol ?? parsed.values.gene;
	const name = parsed.values.target_name ?? parsed.values.name ?? (!targetId && !gene ? parsed.bare : undefined);
	if (targetId) filters.target_chembl_id = targetId.toUpperCase();
	if (gene) filters["target_components__target_component_synonyms__component_synonym__iexact"] = gene;
	if (name) filters.pref_name__icontains = name;
	if (parsed.values.organism) filters.organism__icontains = parsed.values.organism;
	if (parsed.values.target_type ?? parsed.values.type) filters.target_type = (parsed.values.target_type ?? parsed.values.type)!;
	const url = new URL(`${CHEMBL_BASE}/target.json`);
	url.search = new URLSearchParams({ ...filters, limit: String(limit), offset: "0", order_by: "target_chembl_id" }).toString();
	const payload = await fetchJson(url);
	const targets = normalizeChemblResults("target", payload);
	return {
		schema: "feynman.scienceDatabaseSearch.v1",
		source: "chembl",
		mode: "target-search",
		filters,
		totalCount: pageTotal(payload, targets.length),
		returned: targets.length,
		targets,
		results: targets,
		truncated: targets.length < pageTotal(payload, targets.length),
		provenance: { docs: DOCS_URL, endpoints: [url.toString()] },
	};
}

export async function searchChembl(params: SearchParams): Promise<Record<string, unknown>> {
	const parsed = parseQuery(params.query);
	if (parsed.mode === "compound") return searchCompound(params, parsed);
	if (parsed.mode === "drug") return searchDrugs(params, parsed);
	if (parsed.mode === "admet") return getAdmet(params, parsed);
	if (parsed.mode === "bioactivity") return getBioactivity(params, parsed);
	if (parsed.mode === "mechanism") return getMechanism(params, parsed);
	if (parsed.mode === "target") return searchTargets(params, parsed);
	return searchLegacy(params);
}
