# Single-cell dissection of immune cell states before and during checkpoint immunotherapy in melanoma

## Study and dataset

**Source:** Sade-Feldman et al., *Cell* 2018 — "Defining T cell states associated with response to checkpoint immunotherapy in melanoma" (GEO accession **GSE120575**).

This is an unbiased single-cell RNA-seq (Smart-seq2) survey of **CD45+ immune cells from 48 melanoma tumor biopsies** taken from **32 patients**, sampled **before (Pre, baseline) or during (Post, on-treatment)** checkpoint immunotherapy (anti-PD-1, anti-CTLA4+PD-1, or anti-CTLA4). Each biopsy carries a clinical **response label** (Responder = CR/PR vs Non-responder = SD/PD by RECIST), which makes the dataset directly suited to the task: compare immune composition before vs after treatment and between responders and non-responders, and derive signatures that stratify response.

| | |
|---|---|
| Cells (raw) | 16,291 CD45+ single cells |
| Cells after QC | 16,060 |
| Genes quantified | 45,692 (after filtering; 55,737 in raw matrix) |
| Patients / biopsies | 32 / 48 (19 Pre, 29 Post) |
| Response (samples) | 17 Responder, 31 Non-responder |
| Expression unit | log2(TPM+1), as provided by the authors |

The raw count/TPM matrix (`GSE120575_Sade_Feldman_melanoma_single_cells_TPM_GEO.txt.gz`, ~127 MB) and the assembled/processed AnnData object (`sadefeldman_processed.h5ad`, ~321 MB) are referenced by name only, per instruction, as they exceed ~1 MB.

## Methods summary

Expression values were used as provided (log2(TPM+1)). After light QC (removing cells with >40% mitochondrial content; the author-curated set already had ≥1,093 genes/cell), I selected 2,000 highly variable genes, scaled, ran PCA, corrected donor/batch effects across the 32 patients with **Harmony**, then built a neighbor graph, **Leiden** clusters, and a **UMAP**. Clusters were annotated to immune lineages from canonical markers. CD8 T cells were further split into **memory-like** vs **exhausted/dysfunctional** states by per-cell scoring. Composition shifts were tested on per-sample proportions (Mann–Whitney, BH-corrected). Responder-stratifying signatures were derived by per-sample pseudobulk differential expression within the CD8 compartment and evaluated at the sample level by ROC/AUC, with **leave-one-out cross-validation** for the data-driven signature to avoid circularity.

## Cell-type landscape

Nine immune populations were resolved (see `umap_celltypes.png`, `marker_dotplot.png`, `marker_heatmap.png`):

| Population | Defining markers |
|---|---|
| CD8 memory-like | CD8A/B, IL7R, TCF7, CCR7, SELL, GZMK |
| CD8 exhausted/dysfunctional | CD8A/B, PDCD1, HAVCR2, LAG3, TIGIT, TOX |
| CD4 T conv | CD3D/E, CD4, IL7R, TRAC |
| Treg | FOXP3, IL2RA, CTLA4, TNFRSF4/18 |
| Cycling T | MKI67, TOP2A, STMN1, TUBA1B |
| NK | NKG7, GNLY, KLRF1, KLRD1 |
| B cells | MS4A1, CD79A/B, CD19, IGKC |
| Macrophage/Monocyte | CD14, LYZ, C1QA, TYROBP, FCER1G |
| pDC | LILRA4, IL3RA, PLD4, IRF8 |

Full per-population marker tables are in `cluster_markers.csv`.

![UMAP of annotated immune populations]({{artifact:c9c7712a-13ca-4e0a-a0bf-65533d35a5de}})

![Marker dot plot across populations]({{artifact:261bc2f3-6de0-415c-982a-5fe9bb772019}})

## Populations that expand or contract

**Treatment alone (pooled Post vs Pre) produced no significant compositional shift** (all BH-adjusted p > 0.88). The signal is in *who responds*, not in the timepoint per se — consistent with the fact that responders and non-responders remodel their immune compartment in opposite directions, so pooling cancels the effect.

**Responder vs Non-responder composition** (per-sample proportions; BH-adjusted):

| Population | Frac. Responder | Frac. Non-responder | Direction | padj |
|---|---|---|---|---|
| CD8 memory-like | 0.346 | 0.259 | **↑ in Responder** | 0.034 |
| B cells | 0.196 | 0.072 | **↑ in Responder** | 0.016 |
| CD8 exhausted/dysfunctional | 0.180 | 0.272 | **↑ in Non-responder** | 0.019 |
| Macrophage/Monocyte | 0.036 | 0.117 | **↑ in Non-responder** | 0.019 |
| Cycling T | 0.019 | 0.050 | **↑ in Non-responder** | 0.001 |
| pDC | 0.008 | 0.022 | **↑ in Non-responder** | 0.033 |
| Treg / NK / CD4 T conv | — | — | n.s. | >0.4 |

The central axis: **responding tumors are enriched for memory-like CD8 T cells and B cells**, whereas **non-responding tumors are enriched for exhausted/dysfunctional CD8 T cells, myeloid cells (macrophage/monocyte, pDC), and cycling T cells**. The **CD8 memory-like : exhausted ratio** cleanly separates the groups: median **2.70 in responders vs 0.91 in non-responders** (p = 0.003). This reproduces the key finding of the original study.

![Composition by timepoint and response]({{artifact:b072b59e-bae4-4207-8045-f8ac5a831b87}})

![Per-sample population proportions, Responder vs Non-responder]({{artifact:d92c8d28-2441-4bca-b77f-ecc76a163efe}})

Full statistics (both comparisons) are in `composition_stats.csv`.

## Marker genes

Wilcoxon marker genes per population are in `cluster_markers.csv`; the z-scored mean-expression heatmap (`marker_heatmap.png`) shows clean block-diagonal specificity. Highlights:

- **CD8 memory-like:** IL7R, TCF7, CCR7, SELL, LEF1, GZMK
- **CD8 exhausted/dysfunctional:** PDCD1, HAVCR2, TIGIT, CCL5, NKG7, PRF1, LYST
- **Treg:** FOXP3, IL2RA, CTLA4, TNFRSF4, TNFRSF18
- **B cells:** MS4A1, CD79A, CD19, IGKC, BANK1
- **Macrophage/Mono:** LYZ, TYROBP, IFI30, FCER1G, AIF1
- **pDC:** LILRA4, IL3RA, PLD4, SERPINF1, IRF8

![Marker gene heatmap]({{artifact:5160659a-cb78-474a-a17d-8d19ed08013c}})

## Predicted responder-stratifying signatures

I derived signatures from **per-sample pseudobulk differential expression within the CD8 compartment** (Responder vs Non-responder), which avoids pseudoreplication from treating individual cells as independent.

**Responder-UP (memory/stem-like CD8 program):**
`IL7R, GPR183, CCR7, SELL, TCF7, LEF1, FOXP1, PLAC8, LTB, CD55, YPEL5, SORL1, ATM`

**Responder-DOWN / Non-responder-UP (terminal cytotoxic–IFN–exhaustion program):**
`NKG7, PRF1, GZMA, GZMB, GZMH, CCL4, CCL5, CST7, HLA-DRA, HLA-DPA1, HLA-DRB1, IFI6, PSMB9, GBP5, CD38`

These are biologically coherent with the compositional result: response tracks with a **memory/progenitor CD8 state (TCF7/IL7R/CCR7)**, and resistance tracks with a **terminally differentiated, interferon-activated, exhausted CD8 state**.

**Sample-level stratification performance (CD8 compartment, n = 47 biopsies with ≥10 CD8 cells):**

| Signature | AUC |
|---|---|
| Data-driven CD8 signature, **leave-one-out CV** (honest) | **0.859** |
| Published Sade-Feldman responder−nonresponder signature | 0.843 |
| CD8 memory/exhausted ratio (single feature) | 0.767 |

The leave-one-out CV estimate (0.86) is the unbiased figure — the signature genes were re-derived on each training split and scored on the held-out sample. The independently published signature reaching 0.84 on the same samples corroborates the biology.

![ROC curves for responder stratification]({{artifact:cc5f07fe-a266-4040-8411-9bf86fc3de39}})

![Signature score distributions, Responder vs Non-responder]({{artifact:bd507e2c-925c-4ccf-821b-638af01e4421}})

Signature gene lists and AUC values are in `signature_genes.json`; full differential-expression tables are in `responder_DE_CD8.csv` and `responder_DE_all.csv`.

## Interpretation and caveats

- **Response is encoded in CD8 T-cell *state*, not abundance.** A high ratio of memory-like (TCF7+) to terminally exhausted CD8 cells is the strongest single compositional correlate of response. B-cell enrichment in responders is a secondary signal (consistent with the reported role of tertiary-lymphoid/B-cell content in ICB response).
- **Timepoint effects are response-dependent.** Pooling Pre/Post washes out; the biology lives in the interaction with response.
- **Caveats:** (1) Cross-sectional biopsies from mixed therapy regimens and mixed timepoints; the AUCs are associative, not a locked prospective classifier. (2) Sample-level n is modest (17 R / 30–31 NR), so signature gene membership is somewhat unstable across CV folds even though the aggregate score is robust. (3) Smart-seq2 CD45-gated data captures immune cells only — no tumor/stromal compartment. (4) Signatures should be validated in an independent ICB cohort before any translational claim.

## Artifacts

Figures and tables are listed in the accompanying response. Large data files (TPM matrix, processed AnnData) are referenced by filename only and are not linked inline.
