import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { testableScienceDatabases } from "../extensions/research-tools/science-databases.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function trialStudy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		protocolSection: {
			identificationModule: {
				nctId: "NCT12345678",
				briefTitle: "Targeted melanoma trial",
				officialTitle: "A targeted melanoma therapy trial",
				acronym: "TARGET",
			},
			statusModule: {
				overallStatus: "RECRUITING",
				startDateStruct: { date: "2026-01-01" },
				primaryCompletionDateStruct: { date: "2027-06" },
				completionDateStruct: { date: "2028-01" },
			},
			sponsorCollaboratorsModule: {
				leadSponsor: { name: "ModernaTX, Inc." },
				collaborators: [{ name: "Example Cancer Center" }],
			},
			descriptionModule: {
				briefSummary: "A study summary.",
				detailedDescription: "A detailed study description.",
			},
			eligibilityModule: {
				eligibilityCriteria: "Inclusion Criteria:\n\n* Adults with melanoma.",
				minimumAge: "18 Years",
				maximumAge: "75 Years",
				sex: "ALL",
				healthyVolunteers: false,
			},
			conditionsModule: { conditions: ["Melanoma"] },
			armsInterventionsModule: { interventions: [{ name: "Drug A" }] },
			designModule: {
				phases: ["PHASE3"],
				studyType: "INTERVENTIONAL",
				enrollmentInfo: { count: 120 },
			},
			outcomesModule: {
				primaryOutcomes: [{ measure: "Progression-free survival", timeFrame: "12 months" }],
				secondaryOutcomes: [{ measure: "Overall survival", timeFrame: "24 months" }],
			},
			contactsLocationsModule: {
				locations: [{
					facility: "Example Cancer Center",
					city: "Boston",
					state: "Massachusetts",
					country: "United States",
					status: "RECRUITING",
					contacts: [{ name: "Jane Researcher", role: "CONTACT" }],
				}],
			},
			...overrides,
		},
		hasResults: true,
	};
}

test("ClinicalTrials.gov adapter fetches NCT detail records", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		assert.match(url, /\/api\/v2\/studies\/NCT12345678\?/);
		return jsonResponse(trialStudy());
	};

	const result = await testableScienceDatabases.scienceDatabaseSearch({
		source: "clinicaltrials",
		query: "details:NCT12345678",
		limit: 5,
	});
	const details = result as {
		returned: number;
		results: Array<{
			nctId: string;
			briefSummary?: string;
			eligibilityCriteria?: string;
			primaryOutcomes?: Array<{ measure?: string }>;
			hasResults?: boolean;
		}>;
		searchMode: string;
	};

	assert.equal(details.searchMode, "trial-details");
	assert.equal(details.returned, 1);
	assert.equal(details.results[0]?.nctId, "NCT12345678");
	assert.match(details.results[0]?.eligibilityCriteria ?? "", /Adults with melanoma/);
	assert.equal(details.results[0]?.primaryOutcomes?.[0]?.measure, "Progression-free survival");
	assert.equal(details.results[0]?.hasResults, true);
	assert.equal(new URL(requests[0]!).searchParams.get("fields"), "protocolSection|hasResults");
});

test("ClinicalTrials.gov adapter searches sponsor-specific trials", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		return jsonResponse({ totalCount: 1, studies: [trialStudy()] });
	};

	const result = await testableScienceDatabases.scienceDatabaseSearch({
		source: "clinicaltrials",
		query: "sponsor: condition=melanoma sponsor=Moderna phase=PHASE3 count_total=true",
		limit: 3,
	});
	const details = result as { searchMode: string; totalCount?: number; results: Array<{ sponsor?: string }> };
	const params = new URL(requests[0]!).searchParams;

	assert.equal(details.searchMode, "search-by-sponsor");
	assert.equal(details.totalCount, 1);
	assert.equal(details.results[0]?.sponsor, "ModernaTX, Inc.");
	assert.equal(params.get("query.cond"), "melanoma");
	assert.equal(params.get("countTotal"), "true");
	assert.match(params.get("filter.advanced") ?? "", /AREA\[LeadSponsorName\]"Moderna"/);
	assert.match(params.get("filter.advanced") ?? "", /AREA\[Phase\]PHASE3/);
});

test("ClinicalTrials.gov adapter builds eligibility filters", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		return jsonResponse({ studies: [trialStudy({
			contactsLocationsModule: {
				overallOfficials: [{
					name: "Jane Researcher",
					role: "PRINCIPAL_INVESTIGATOR",
					affiliation: "Example Cancer Center",
				}],
				locations: [{ facility: "Example Cancer Center", city: "Boston", country: "United States" }],
			},
		})] });
	};

	const result = await testableScienceDatabases.scienceDatabaseSearch({
		source: "clinicaltrials",
		query: "eligibility condition=melanoma eligibility_keywords=\"brain metastases\" min_age=18 sex=female",
		limit: 2,
	});
	const details = result as { searchMode: string; results: Array<{ nctId: string }> };
	const params = new URL(requests[0]!).searchParams;

	assert.equal(details.searchMode, "search-by-eligibility");
	assert.equal(details.results[0]?.nctId, "NCT12345678");
	assert.equal(params.get("filter.overallStatus"), "RECRUITING");
	assert.match(params.get("filter.advanced") ?? "", /AREA\[EligibilityCriteria\]"brain metastases"/);
	assert.match(params.get("filter.advanced") ?? "", /AREA\[MinimumAge\]RANGE\[MIN,18 years\]/);
	assert.match(params.get("filter.advanced") ?? "", /AREA\[Sex\]FEMALE/);
});

test("ClinicalTrials.gov adapter searches investigator/contact records", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		return jsonResponse({ studies: [trialStudy()] });
	};

	const result = await testableScienceDatabases.scienceDatabaseSearch({
		source: "clinicaltrials",
		query: "investigator=Jane institution=\"Example Cancer Center\" condition=melanoma",
		limit: 5,
	});
	const details = result as { searchMode: string; results: Array<{ name?: string; affiliation?: string; nctId?: string }> };
	const params = new URL(requests[0]!).searchParams;

	assert.equal(details.searchMode, "search-by-investigators");
	assert.equal(details.results[0]?.name, "Jane Researcher");
	assert.equal(details.results[0]?.affiliation, "Example Cancer Center");
	assert.equal(details.results[0]?.nctId, "NCT12345678");
	assert.match(params.get("filter.advanced") ?? "", /AREA\[OverallOfficialName\]"Jane"/);
	assert.match(params.get("filter.advanced") ?? "", /AREA\[LocationFacility\]"Example Cancer Center"/);
});

test("ClinicalTrials.gov adapter summarizes endpoint measures", async () => {
	const requests: string[] = [];
	globalThis.fetch = async (input) => {
		const url = String(input);
		requests.push(url);
		return jsonResponse({ studies: [trialStudy(), trialStudy({
			identificationModule: { nctId: "NCT87654321", briefTitle: "Second trial" },
			outcomesModule: {
				primaryOutcomes: [{ measure: "Progression-free survival", timeFrame: "18 months" }],
				secondaryOutcomes: [{ measure: "Objective response rate", timeFrame: "12 months" }],
			},
		})] });
	};

	const result = await testableScienceDatabases.scienceDatabaseSearch({
		source: "clinicaltrials",
		query: "endpoints condition=melanoma phase=PHASE3 start_date_after=2022-01-01",
		limit: 10,
	});
	const details = result as {
		searchMode: string;
		results: Array<{ trialsAnalyzed?: number; commonMeasures?: string[]; primaryEndpoints?: Array<{ measure?: string }> }>;
	};
	const params = new URL(requests[0]!).searchParams;

	assert.equal(details.searchMode, "endpoints");
	assert.equal(details.results[0]?.trialsAnalyzed, 2);
	assert.equal(details.results[0]?.commonMeasures?.[0], "Progression-free survival");
	assert.equal(details.results[0]?.primaryEndpoints?.length, 2);
	assert.equal(params.get("fields"), "NCTId|protocolSection.outcomesModule");
	assert.match(params.get("filter.advanced") ?? "", /AREA\[Phase\]PHASE3/);
	assert.match(params.get("filter.advanced") ?? "", /AREA\[StartDate\]RANGE\[2022-01-01,MAX\]/);
});
