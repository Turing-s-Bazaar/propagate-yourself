# Evolution of a protein of unknown function in an extremophile: the DUF34/NIF3 family and its dinuclear metal site

## 1. The protein: MJ0927 from *Methanocaldococcus jannaschii*

The focal protein is **MJ0927** (UniProt **Q58337**), a ~244-residue protein from the hyperthermophilic, deep-sea hydrothermal-vent archaeon *Methanocaldococcus jannaschii* (optimal growth ~85 °C). It is a member of the **DUF34 family**, also known as the **NIF3 protein superfamily** (Pfam PF01784, InterPro IPR002678) — a genuine *domain of unknown function* that is ubiquitous across all three superkingdoms yet still lacks an experimentally established biochemical activity.

Why this is an interesting example of a protein of unknown function:

- **It is annotated, but the annotation is probably wrong.** Across databases these proteins are widely labelled "GTP cyclohydrolase I type 2 homolog" — an annotation propagated electronically from a single early study. A comprehensive reanalysis of the family explicitly challenges that label and instead proposes the family acts as **metal-ion insertases, chaperones, or metallocofactor maturases**. So "unknown function" here is not merely a missing label; it is an actively *contested* one.
- **It carries a concrete, structurally defined active site.** The *E. coli* homolog **YbgI** was crystallised as a toroidal hexamer (a trimer of dimers), with **each subunit binding two metal ions inside the ring** — a **dinuclear metal center** that suggested a hydrolase/oxidase-type activity. This gives a set of catalytic (metal-coordinating) residues whose evolution can be traced.
- **The focal protein itself has a solved structure.** MJ0927 has been crystallised and shown to adopt a novel quaternary assembly within the Nif3 family, making the archaeal extremophile member structurally anchored rather than purely hypothetical.
- **It spans the entire tree of life**, so a cross-domain phylogeny and ancestral reconstruction are biologically meaningful.

## 2. Dataset

A curated, non-redundant set of **45 NIF3/DUF34 homologs** was assembled from UniProt (reviewed/Swiss-Prot members of PF01784, supplemented with selected thermophiles), balanced across domains and deliberately enriched for extremophiles:

| Domain | n | Notable members (lifestyle) |
|---|---|---|
| **Archaea** | 7 | **MJ0927 / Q58337** (*M. jannaschii*, hyperthermophile, 85 °C); *Pyrococcus horikoshii* & *abyssi* (hyperthermophiles, ~96–98 °C); *Thermococcus piezophilus* (deep-sea piezophile); *Methanothermobacter* (thermophile); *Archaeoglobus fulgidus*; *Halobacterium salinarum* (extreme halophile) |
| **Bacteria** | 30 | *E. coli* **YbgI / P0AFP6** (dinuclear-site structural reference); *Deinococcus radiodurans* (radiation/desiccation extremophile); *Thermus thermophilus* (thermophile); *Halalkalibacterium halodurans* (alkaliphile); one representative per genus across Firmicutes, Actinobacteria, Proteobacteria, Cyanobacteria, Spirochaetes, etc. |
| **Eukarya** | 8 | Human **NIF3L1 / Q9GZT8**, mouse, rat, bovine, *Drosophila*, *S. cerevisiae*, *S. pombe*, *Dictyostelium* |

Sequences: `nif3_homologs.fasta`; annotations: `nif3_metadata.csv`.

Coverage note: several classically "extremophile" lineages (*Sulfolobus/Saccharolobus*, *Thermotoga*, *Aquifex*) and land plants returned **no** PF01784 hit. This is consistent with the family's known patchy, lineage-specific distribution — it has been independently lost in multiple clades.

## 3. Phylogenetic tree across all domains of life

![NIF3/DUF34 maximum-likelihood phylogeny]({{artifact:d33659e5-5e1b-4626-ba75-39cac0b0daf2}})

- **Method:** MAFFT L-INS-i alignment (45 × 488 columns) → trimAl `-automated1` (→ 305 columns, 282 parsimony-informative) → IQ-TREE with ModelFinder, 1000 ultrafast-bootstrap replicates and SH-aLRT. Best-fit model **LG+I+G4** (γ shape α = 2.13, p-inv = 0.02); tree log-likelihood −18531.7. Midpoint-rooted.
- **Topology:** The **eukaryotes form a single, cleanly monophyletic clade** (MRCA contains exactly the 8 eukaryotic sequences). **Archaea and Bacteria are intermixed** rather than each forming a clean domain-level clade. This is expected for a very ancient, slowly- and unevenly-evolving family: long branches in the fast-evolving minimal-genome bacteria (*Buchnera*, *Ureaplasma*, *Mycoplasmopsis*) and the deep archaeal/extremophile branches attract, and lateral gene transfer further blurs the prokaryotic backbone. The extremophile archaea (MJ0927, *Pyrococcus*, *Thermococcus*) group together, partly reflecting shared thermophilic sequence composition.

Alignment overview (conserved core vs. the variable middle insertion present only in the longer bacterial/eukaryotic members):

![Alignment overview]({{artifact:2aea3f1e-df6a-4b76-adff-f30cb647afaf}})

Tree files: `nif3.treefile` (with support values), `nif3_rooted.nwk`, full IQ-TREE report `nif3.iqtree`.

## 4. The catalytic residues: a dinuclear metal site

The active site is a **dinuclear (two-metal) center**. Using the *E. coli* YbgI structure as the anchor, the metal-coordinating residues (UniProt "binding site / divalent metal cation" features) are:

| Site | *E. coli* YbgI | MJ0927 (*M. jannaschii*) | Role |
|---|---|---|---|
| 1 | **His63** | His65 | Metal-1 ligand |
| 2 | **His64** | His66 | Metal-1 ligand |
| 3 | **Asp101** | Asp102 | bridging |
| 4 | **His215** | His215/216 | Metal-2 ligand |
| 5 | **Glu219** | Glu220 | Metal-2 ligand |

The reference motif is therefore **His-His-Asp-His-Glu (H-H-D-H-E)**. The extremophile MJ0927 carries the *identical* five residues, and all five map to the same five alignment columns (101, 102, 142, 424, 428).

### Conservation across 45 homologs

![Metal-site sequence logo by domain]({{artifact:9dff5128-433f-4140-abfb-ee6569913784}})

![Per-sequence metal-site residues]({{artifact:bf379318-901f-490c-8327-1daed5895de5}})

| Position | Overall | Archaea | Bacteria | Eukarya | Observation |
|---|---|---|---|---|---|
| **His64** | 100% | 100% | 100% | 100% | invariant |
| **Asp101** | 100% | 100% | 100% | 100% | invariant |
| **His215** | 100% | 100% | 100% | 100% | invariant |
| **Glu219** | 100% | 100% | 100% | 100% | invariant |
| **His63** | 78% | **100%** | 93% | **0% (all Tyr)** | domain-specific substitution |

**Four of the five metal ligands (H64, D101, H215, E219) are strictly invariant in all 45 proteins across all three domains** — conservation maintained over the billions of years separating archaea, bacteria and eukaryotes. The fifth ligand, **His63**, is the interesting one: it is His in every archaeon (including the extremophile MJ0927) and in 28/30 bacteria, but is **replaced by tyrosine in all eight eukaryotes** (and by lysine in two streptococcal/lactococcal bacteria). The metal site is thus overwhelmingly a fixed structural feature, with a single clade-specific "tuning" position.

Per-sequence residue table: `catalytic_residues.csv`.

## 5. Ancestral sequence reconstruction

Marginal ancestral states were reconstructed with IQ-TREE (`-asr`, LG+I+G4) on the full alignment with the ML topology fixed (51 internal nodes).

![Ancestral metal-site states mapped onto the tree]({{artifact:5846badb-fd9e-4797-b2e4-7a8bdf09167d}})

| Node | H63 | H64 | D101 | H215 | E219 |
|---|---|---|---|---|---|
| **Ancestral NIF3 (root)** | **H** (1.00) | H (1.00) | D (1.00) | H (1.00) | E (1.00) |
| Eukaryotic ancestor | **Y** (0.99) | H (1.00) | D (1.00) | H (1.00) | E (1.00) |

- The **last common ancestor of the whole family is reconstructed with the complete H-H-D-H-E dinuclear metal site at posterior probability 1.00 at every one of the five positions.** The two-metal active site is therefore not a later elaboration — it was present in the ancestral NIF3 protein and has been conserved ever since.
- The **His63→Tyr substitution is a single event on the eukaryotic stem** (reconstructed Tyr at PP 0.99 in the eukaryotic ancestor), after which it was fixed in every descendant eukaryote. The four other ligands were untouched.

Key-node states: `ancestral_states.csv`; reconstructed ancestral sequences: `ancestral_NIF3_sequences.fasta`; full per-site posteriors in `nif3_asr.state` (raw IQ-TREE output, ~3.6 MB).

## 6. Inferred ancestral function

Integrating the tree, the residue conservation and the ancestral reconstruction:

1. **The ancestral NIF3/DUF34 protein was a dinuclear-metal protein.** The H-H-D-H-E two-metal site is reconstructed intact at the root with maximum confidence and is essentially invariant across the whole tree. Whatever the family does, **it has been built around binding two divalent metal ions since before the divergence of the three domains of life** — i.e., it is a trait of the last universal common ancestor-level NIF3 protein, not a domain-specific innovation.

2. **The most parsimonious ancestral function is metal-dependent, not GTP cyclohydrolase.** The widely propagated "GTP cyclohydrolase I type 2" annotation is not supported by any conserved GTP-cyclohydrolase catalytic machinery here; it originates from electronic propagation and has been directly challenged in the literature. The structural signature instead is that of a **metal-handling protein**: a toroidal hexamer with buried dinuclear sites. The best-supported current hypothesis for the family is a role as a **metal-ion insertase / metallochaperone / metallocofactor maturase** — delivering or inserting metal ions (e.g., Ni/Fe/Zn) into client enzymes — which coherently explains the family's pleiotropic phenotypes in metal homeostasis, redox and stress responses. An alternative, not mutually exclusive, reading of the dinuclear site is a **hydrolase/oxidase**-type activity, as originally proposed from the YbgI structure. Both hypotheses require the same feature — two coordinated metals — which is exactly what the reconstruction shows was ancestral.

3. **The eukaryotic His63→Tyr change is a lineage-specific modification of a retained metal site, not its loss.** Because the other four ligands remain intact in eukaryotes, the dinuclear site is preserved; the His→Tyr swap alters one coordinating position (a histidine-to-tyrosine change at a metal ligand can shift metal selectivity or redox behaviour while keeping the site functional). This coincides with the eukaryotic members (NIF3L1 and yeast NIF3) acquiring *additional* reported roles — e.g., interaction with the Ngg1/transcriptional-coactivator machinery and in cell differentiation — layered on top of the conserved ancestral metal-binding core. The extremophile archaeon MJ0927 retains the unmodified ancestral H-H-D-H-E configuration.

**Bottom line:** the ancestral function of this "protein of unknown function" is most consistent with a **metal-ion chaperone/insertase (or, more generally, a dinuclear-metal enzyme) present in the common ancestor of all life**, with the hyperthermophilic archaeon MJ0927 preserving the ancestral active-site state essentially unchanged, and eukaryotes making a single conservative tweak (His→Tyr) at one of the two metal centers while elaborating new regulatory roles.

## 7. Caveats

- Function here is **inferred**, not experimentally demonstrated: this is a structure/evolution-based hypothesis for a DUF. No enzymatic assay is performed.
- The prokaryotic backbone of the tree is not fully resolved (intermixed Archaea/Bacteria), reflecting ancient divergence, rate heterogeneity and likely horizontal gene transfer; deep-node *topology* should be read cautiously. The *metal-site residue* reconstruction, however, is robust (PP ≈ 1.0) because those columns are near-invariant regardless of backbone uncertainty.
- Midpoint rooting is a pragmatic choice; an explicit outgroup is not available for a family this universal. Root placement affects which prokaryotic node is "deepest" but not the conclusion that the H-H-D-H-E site is ancestral (it is reconstructed with PP 1.0 at every candidate deep node).

## 8. Methods summary

UniProt REST (PF01784) → MAFFT v7.526 L-INS-i → trimAl v1.5 `-automated1` → IQ-TREE v3.1.2 (ModelFinder, `-bb 1000 -alrt 1000`, LG+I+G4) → IQ-TREE `-asr` marginal ancestral reconstruction. Metal-site residues from UniProt binding-site annotations anchored to the *E. coli* YbgI crystal structure (PDB 1NMP family). Figures via matplotlib/logomaker.

## 9. Artifacts

Figures and small tables are linked in the sections above. Raw/large data files (referenced by name, not linked): `nif3_asr.state` (~3.6 MB full ancestral posteriors), `nif3.iqtree`, `nif3_asr.iqtree` (IQ-TREE reports).
