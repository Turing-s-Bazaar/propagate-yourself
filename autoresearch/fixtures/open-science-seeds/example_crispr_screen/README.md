# Human Kinome CRISPR-KO Screen — Design Package

Genome-wide SpCas9 knockout library targeting the human protein kinome (522 kinases),
built on the Brunello library with genome-wide off-target re-analysis, controls, and
full construction + sequencing plans.

## Deliverables

### Report
- **design_report.html** — self-contained report with all six figures and every parameter.

### Gene set & library tables
- **kinome_genes.csv** — 522 kinase genes (Manning group/family, UniProt, Entrez, Brunello coverage, de-novo flag).
- **kinase_guides_brunello.csv** — 2,072 selected Brunello guides (4/gene) with coordinates and Rule Set 2 scores.
- **final_kinome_library.csv** — complete 3,140-sgRNA library (targeting + controls) with QC verdicts. *(>1 MB)*
- **oligo_pool_synthesis.csv** — 3,129 synthesis-ready 83-mer oligos with BsmBI adapters. *(>1 MB)*
- **oligo_order.txt** — id⇥oligo list for vendor ordering.

### QC & off-target
- **guide_ontarget_qc.csv** — per-guide GC, poly-T, homopolymer, BsmBI, Rule Set 2 flags.
- **offtarget_report.csv** — per-guide CFD/MIT specificity, mismatch-class counts, coding off-target risk.
- **offtarget_coding_hits.csv** — the 135 high-CFD coding off-target sites (guide, gene, locus).
- **denovo_design_worklist.csv** — 37 genes (53 guides) needing custom design.

### Plans
- **construction_protocol.md** — oligo architecture, Golden-Gate cloning, transformation, QC.
- **sequencing_depth_plan.csv** — representation × reads/guide scenario matrix.

### Figures
- kinome_groups.png · guides_per_gene.png · ontarget_score_distributions.png
- offtarget_specificity.png · library_composition.png · coverage_vs_cells.png

## Headline numbers
| | |
|---|---|
| Kinase genes targeted | 522 (518 in Brunello, 4 de-novo) |
| Targeting sgRNAs | 2,072 (4/gene) |
| Final library | 3,140 sgRNAs (2,072 targeting + 1,000 NTC + 68 positive) |
| Synthesis pool | 3,129 oligos (83-mer, BsmBI) |
| Median MIT specificity | 97 |
| High-risk off-target guides | 128 (6.2%) — retained, annotated |
| Cloning representation | ≥300× (≈939k colonies) |
| Screen representation | ≥500× (1.56M cells/replicate, MOI 0.3) |
| Sequencing | ~28M reads for 9 samples @1,000 reads/guide (~3.5% NovaSeq SP) |

## Methods
KinHub/Manning kinome · Brunello (Doench 2016) · Cas-OFFinder v2.4.1 vs GRCh38
(Ensembl r110), ≤3 mismatches · CFD (Doench 2016) + MIT/Hsu (2013) scoring ·
Ensembl r110 CDS/exon annotation.
