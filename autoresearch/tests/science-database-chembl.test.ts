import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { registerScienceDatabaseTools } from "../extensions/research-tools/science-databases.js";

type Tool = {
	execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; details: unknown }>;
	name: string;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function registerTool(): Tool {
	const tools = new Map<string, Tool>();
	registerScienceDatabaseTools({
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
	} as never);
	const tool = tools.get("feynman_science_database_search");
	assert.ok(tool);
	return tool;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function moleculeBody(extra: Record<string, unknown> = {}) {
	return {
		molecules: [{
			molecule_chembl_id: "CHEMBL941",
			pref_name: "IMATINIB",
			max_phase: 4,
			first_approval: 2001,
			black_box_warning: 0,
			withdrawn_flag: 0,
			molecule_type: "Small molecule",
			molecule_structures: { canonical_smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1" },
			molecule_properties: {
				alogp: "4.59",
				full_mwt: "493.62",
				mw_freebase: "493.62",
				psa: "86.28",
				hba: 7,
				hbd: 2,
				rtb: 7,
				aromatic_rings: 4,
				heavy_atoms: 37,
				num_ro5_violations: 0,
				ro3_pass: "N",
				qed_weighted: "0.48",
				full_molformula: "C29H31N7O",
			},
			...extra,
		}],
		page_meta: { total_count: 1 },
	};
}

test("science database tool supports reference-shaped ChEMBL workflow modes", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url.toString());
		assert.equal(url.origin, "https://www.ebi.ac.uk");
		if (url.pathname.endsWith("/molecule.json") && url.searchParams.get("molecule_synonyms__molecule_synonym__icontains") === "imatinib") {
			return jsonResponse(moleculeBody());
		}
		if (url.pathname.endsWith("/molecule.json") && url.searchParams.get("molecule_chembl_id__in") === "CHEMBL941") {
			return jsonResponse(moleculeBody());
		}
		if (url.pathname.endsWith("/activity.json")) {
			assert.equal(url.searchParams.get("molecule_chembl_id"), "CHEMBL941");
			assert.equal(url.searchParams.get("target_chembl_id"), "CHEMBL1862");
			assert.equal(url.searchParams.get("standard_type"), "IC50");
			assert.equal(url.searchParams.get("pchembl_value__gte"), "7");
			return jsonResponse({
				activities: [{
					activity_id: 10,
					molecule_chembl_id: "CHEMBL941",
					molecule_pref_name: "IMATINIB",
					target_chembl_id: "CHEMBL1862",
					target_pref_name: "Tyrosine-protein kinase ABL",
					target_organism: "Homo sapiens",
					standard_type: "IC50",
					standard_relation: "=",
					standard_value: "38",
					standard_units: "nM",
					pchembl_value: "7.42",
					assay_chembl_id: "CHEMBL123",
					assay_type: "B",
					document_chembl_id: "CHEMBL_DOC_1",
				}],
				page_meta: { total_count: 1 },
			});
		}
		if (url.pathname.endsWith("/mechanism.json")) {
			assert.equal(url.searchParams.get("molecule_chembl_id"), "CHEMBL941");
			return jsonResponse({
				mechanisms: [{
					mec_id: 1,
					molecule_chembl_id: "CHEMBL941",
					parent_molecule_chembl_id: "CHEMBL941",
					mechanism_of_action: "Tyrosine-protein kinase inhibitor",
					target_chembl_id: "CHEMBL1862",
					action_type: "INHIBITOR",
					direct_interaction: 1,
					disease_efficacy: 1,
					max_phase: 4,
				}],
				page_meta: { total_count: 1 },
			});
		}
		if (url.pathname.endsWith("/drug_indication.json")) {
			assert.equal(url.searchParams.get("efo_term__icontains"), "leukemia");
			assert.equal(url.searchParams.get("max_phase_for_ind"), "4");
			return jsonResponse({
				drug_indications: [{
					drugind_id: 99,
					efo_id: "EFO:0000565",
					efo_term: "leukemia",
					max_phase_for_ind: 4,
					mesh_heading: "Leukemia",
					molecule_chembl_id: "CHEMBL941",
					parent_molecule_chembl_id: "CHEMBL941",
				}],
				page_meta: { total_count: 1 },
			});
		}
		if (url.pathname.endsWith("/drug_warning.json")) {
			assert.equal(url.searchParams.get("parent_molecule_chembl_id__in"), "CHEMBL941");
			return jsonResponse({
				drug_warnings: [{
					warning_id: 7,
					parent_molecule_chembl_id: "CHEMBL941",
					warning_class: "Black Box Warning",
					warning_type: "Toxicity",
				}],
				page_meta: { total_count: 1 },
			});
		}
		if (url.pathname.endsWith("/target.json")) {
			assert.equal(url.searchParams.get("target_components__target_component_synonyms__component_synonym__iexact"), "ABL1");
			return jsonResponse({
				targets: [{
					target_chembl_id: "CHEMBL1862",
					pref_name: "Tyrosine-protein kinase ABL",
					target_type: "SINGLE PROTEIN",
					organism: "Homo sapiens",
					tax_id: 9606,
					target_components: [{
						accession: "P00519",
						component_description: "Tyrosine-protein kinase ABL1",
						component_type: "PROTEIN",
						relationship: "SINGLE PROTEIN",
						target_component_synonyms: [{ syn_type: "GENE_SYMBOL", component_synonym: "ABL1" }],
					}],
				}],
				page_meta: { total_count: 1 },
			});
		}
		throw new Error(`unexpected URL ${url}`);
	};

	const tool = registerTool();
	const compound = await tool.execute("call-chembl-compound", { source: "chembl", query: "compound:imatinib", limit: 1 });
	const admet = await tool.execute("call-chembl-admet", { source: "chembl", query: "admet:CHEMBL941", limit: 1 });
	const bioactivity = await tool.execute("call-chembl-bioactivity", { source: "chembl", query: "bioactivity molecule=CHEMBL941 target=CHEMBL1862 activity_type=IC50 min_pchembl=7", limit: 1 });
	const mechanism = await tool.execute("call-chembl-mechanism", { source: "chembl", query: "mechanism:CHEMBL941", limit: 1 });
	const drug = await tool.execute("call-chembl-drug", { source: "chembl", query: "drug:leukemia only_approved=true", limit: 1 });
	const target = await tool.execute("call-chembl-target", { source: "chembl", query: "target gene=ABL1 organism=\"Homo sapiens\"", limit: 1 });

	const compoundDetails = compound.details as { mode: string; results: Array<{ chemblId?: string; properties?: { fullMolecularWeight?: number } }> };
	const admetDetails = admet.details as { found: boolean; mode: string; properties?: { alogp?: number; moleculeChemblId?: string } };
	const bioactivityDetails = bioactivity.details as { activities: Array<{ pchemblValue?: number; targetChemblId?: string }>; mode: string; summary: string };
	const mechanismDetails = mechanism.details as { mechanisms: Array<{ actionType?: string; mechanismOfAction?: string }>; mode: string };
	const drugDetails = drug.details as { drugs: Array<{ bestPhaseForIndication?: number; warningSummary: unknown[] }>; mode: string; totalIndicationRows: number };
	const targetDetails = target.details as { mode: string; targets: Array<{ chemblId?: string; components: Array<{ geneSymbol?: string }> }> };

	assert.equal(compoundDetails.mode, "compound-search");
	assert.equal(compoundDetails.results[0]?.chemblId, "CHEMBL941");
	assert.equal(compoundDetails.results[0]?.properties?.fullMolecularWeight, 493.62);
	assert.equal(admetDetails.mode, "admet-properties");
	assert.equal(admetDetails.found, true);
	assert.equal(admetDetails.properties?.moleculeChemblId, "CHEMBL941");
	assert.equal(admetDetails.properties?.alogp, 4.59);
	assert.equal(bioactivityDetails.mode, "bioactivity");
	assert.equal(bioactivityDetails.activities[0]?.targetChemblId, "CHEMBL1862");
	assert.equal(bioactivityDetails.activities[0]?.pchemblValue, 7.42);
	assert.match(bioactivityDetails.summary, /Most potent/);
	assert.equal(mechanismDetails.mode, "mechanism");
	assert.equal(mechanismDetails.mechanisms[0]?.actionType, "INHIBITOR");
	assert.equal(mechanismDetails.mechanisms[0]?.mechanismOfAction, "Tyrosine-protein kinase inhibitor");
	assert.equal(drugDetails.mode, "drug-search");
	assert.equal(drugDetails.totalIndicationRows, 1);
	assert.equal(drugDetails.drugs[0]?.bestPhaseForIndication, 4);
	assert.equal(drugDetails.drugs[0]?.warningSummary.length, 1);
	assert.equal(targetDetails.mode, "target-search");
	assert.equal(targetDetails.targets[0]?.chemblId, "CHEMBL1862");
	assert.equal(targetDetails.targets[0]?.components[0]?.geneSymbol, "ABL1");
	assert.equal(requests.some((url) => url.includes("/drug_indication.json")), true);
	assert.equal(requests.some((url) => url.includes("/activity.json")), true);
	assert.equal(requests.some((url) => url.includes("/mechanism.json")), true);
});
