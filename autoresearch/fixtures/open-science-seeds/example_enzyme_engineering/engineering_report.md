# Engineering the IS621 bridge recombinase for improved activity
### Protein language model + inverse-folding consensus campaign

---

## 1. Protein identity and characterization

The submitted sequence (`is621_bridge_recombinase.fasta`, 326 aa) is the **IS621 bridge recombinase** from *Escherichia coli*, a member of the **IS110 insertion-sequence family**. This is the programmable, RNA-guided recombinase behind the "bridge RNA" system: a single non-coding bridge RNA encodes two programmable loops that independently specify the target-DNA and donor-DNA sites, enabling sequence-specific insertion, excision and inversion.

**Physicochemical properties**

| Property | Value |
|---|---|
| Length | 326 residues |
| Molecular weight | ~36.5 kDa |
| Net charge | **≈ +13** (29 Arg, 24 Lys; 19 Asp, 21 Glu) |
| Cysteines | 3 (no obligate disulfides) |
| Aromatics (F/W/Y) | 20 |

The strongly basic character is concentrated in the C-terminal domain and is consistent with an enzyme that clamps and threads nucleic acid.

**Domain architecture** (numbering per the cryo-EM structural work, Nature 2024)

| Domain | Residues | Role | Net charge |
|---|---|---|---|
| RuvC (RNase-H fold) | 1–122 | Catalysis, Mg²⁺ coordination | −2 |
| Coiled-coil linker | 123–188 | Dimerization / bridging arm | −3 |
| Tnp (IS110-specific) | 189–326 | DNA/RNA binding, 2nd half-site | **+18** |

**Catalytic residues (verified against the sequence; excluded from engineering)**

- **DEDD tetrad** (RuvC): **D11, E60, D102, D105** — coordinate the two catalytic Mg²⁺ ions.
- **Catalytic serine** (Tnp): **S241** — the nucleophile that forms the covalent 5′-phosphoserine strand-transfer intermediate.

Published functional data show that D11A/E60A/D102A/D105A (RuvC) and S241A (Tnp) each abolish recombination, so these five positions — plus their immediate ≤8 Å shell (37 positions total) — were protected from mutation.

*(Figures: `sequence_features.png`, tables `sequence_annotation.csv`, `catalytic_residues.csv`.)*

---

## 2. Structure model

ESMFold (`facebook/esmfold_v1`, CPU) produced a high-confidence monomer model:

- **mean pLDDT 89.3**, **pTM 0.87**
- RuvC 90.5 · coiled-coil 91.4 · Tnp 87.4 (domain means)
- All catalytic residues fall in well-ordered, high-confidence regions.

This model (`is621_esmfold.pdb`) was the backbone input for both inverse-folding methods and for all structural analysis. *(Figure: `plddt_profile.png`.)*

---

## 3. Variant-effect scoring — three orthogonal methods

Every single substitution at every position (19 × 326 = **6,194 variants**) was scored with three state-of-the-art methods spanning two distinct modeling paradigms:

| Method | Type | Model | Signal |
|---|---|---|---|
| **ESM-2 650M** | Sequence PLM | `esm2_t33_650M_UR50D` | Masked-marginal log-likelihood ratio logP(mut) − logP(wt) |
| **ProteinMPNN** | Inverse folding | `v_48_020` | Per-position log-prob given backbone |
| **ESM-IF1** | Inverse folding | GVP-Transformer (142M) | Per-position conditional log-prob given backbone |

**Agreement between methods (Spearman ρ):**

|  | ESM-2 | ProteinMPNN | ESM-IF |
|---|---|---|---|
| ESM-2 | 1.00 | 0.32 | 0.44 |
| ProteinMPNN | 0.32 | 1.00 | **0.76** |
| ESM-IF | 0.44 | 0.76 | 1.00 |

The two inverse-folding methods agree strongly (ρ=0.76) because both read the same structural backbone; sequence-based ESM-2 is more orthogonal (ρ=0.32–0.44) because it reads evolutionary/sequence context. Requiring **consensus across all three** therefore suppresses method-specific artifacts and favors mutations supported by both structural and evolutionary evidence.

*(Full matrices: `esm_variant_scores.csv`, `proteinmpnn_scores.csv`, `esmif_scores.csv`; landscape `esm_heatmap.png`.)*

---

## 4. Consensus ranking and candidate selection

Each method's scores were z-normalized across all 6,194 variants; the **consensus score** is the mean of the three z-scores. Engineering filters applied:

1. **Exclude catalysis** — remove the 5 catalytic residues and the ≤8 Å active-site shell (37 positions). We are engineering *around* the active site, not remodeling it.
2. **Model confidence** — require per-residue pLDDT ≥ 70, so the structure-based scores are trustworthy.
3. **Cross-method agreement** — favorable (>0) in ≥2 of 3 methods **and** consensus z > 0.
4. **Chemistry guardrail** — disallow introduction of new cysteines (free-thiol / misoxidation risk).

This yielded **218 candidate substitutions**. For the experimental panel we selected the **best substitution at each of the top 5 distinct positions** (rather than 5 variants of one hot-spot), giving broader coverage of the fitness landscape.

*(Tables: `ranked_candidates.csv` — all 218; `ranked_candidates_by_position.csv`; comparison `method_comparison.png`.)*

---

## 5. Top 5 candidates for experimental testing

| Rank | Mutation | Domain | ESM-2 | MPNN | ESM-IF | Consensus z | rel.SASA | Å to active site | pLDDT | Mechanism |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **L168A** | Coiled-coil | 5.01 | 1.79 | 3.59 | **2.64** | 0.61 | 39 | 91 | Surface / packing relief |
| 2 | **N322L** | Tnp (C-term) | 0.79 | 3.67 | 4.51 | **2.58** | 0.30 | 36 | 74 | Hydrophobic core completion |
| 3 | **T152L** | Coiled-coil | 4.13 | 2.53 | 0.59 | **2.49** | 0.26 | 40 | 91 | Hydrophobic core packing |
| 4 | **S258L** | Tnp | 3.64 | 0.89 | 3.46 | **2.35** | 0.18 | 20 | 88 | Buried-cavity filling |
| 5 | **H224N** | Tnp | 1.07 | 3.18 | 1.44 | **2.34** | 0.43 | 25 | 86 | Buried-charge / strain relief |

All five are favorable in **3/3 methods** and lie **≥20 Å from the catalytic center**. *(Summary: `top5_summary.csv`; structure overview `top5_overview.png`; per-mutation panels `top5_mut_<mutation>.png`.)*

---

## 6. Mechanistic rationale — how these mutations may raise activity

**Key principle.** PLM and inverse-folding scores predict *sequence fitness* and *foldability / stability*, not catalytic turnover directly. None of the top candidates sit in the active site, so the hypothesis for each is **activity gained indirectly through improved folding stability and expression** — a more stably folded, better-expressed enzyme presents more active molecules and is more tolerant of the conformational strain of the catalytic cycle. For a multidomain nucleic-acid enzyme like IS621, stabilizing the dimerization (coiled-coil) and DNA-binding (Tnp) domains is a well-precedented route to higher net activity. This is distinct from, and complementary to, active-site engineering.

**1. L168A (coiled-coil) — relief of steric crowding.** Leu168 sits on a dimerization-arm helix (relSASA 0.61) immediately adjacent to the bulky **Trp169** (3.2 Å) and packed against L167/A165. ESM-2 very strongly prefers a smaller residue here (the single strongest ESM score among the top 5). Trimming Leu→Ala relieves steric crowding against Trp169 and removes an oversized hydrophobic group from a partly-exposed position, which can improve folding efficiency of the bridging arm that organizes the two half-sites.

**2. N322L (C-terminal Tnp) — completing a hydrophobic pocket.** Asn322 is partially buried (relSASA 0.30) among hydrophobic neighbors **A318, V324** near P323. A buried Asn with an unsatisfied amide is destabilizing; both inverse-folding models strongly favor a hydrophobic Leu that packs into this pocket. *Caveat:* local pLDDT here is 74 (lowest of the five), so the geometry — and hence this prediction — is the least certain; worth testing but with that flag.

**3. T152L (coiled-coil) — hydrophobic core packing.** Thr152 (relSASA 0.26) contacts **L149 and I163** in the coiled-coil core. The β-branched Thr packs sub-optimally and buries a polar hydroxyl; Leu improves van der Waals complementarity with the L149/I163 cluster and removes a buried polar group, stabilizing the dimerization helix.

**4. S258L (Tnp) — filling a buried cavity (cleanest stability gain).** Ser258 is the most buried of the five (relSASA 0.18) and is surrounded by a fully hydrophobic pocket: **V257, L259, Y215, V211**. A buried serine in a hydrophobic cavity is thermodynamically costly (unsatisfied hydroxyl + packing void). All three methods agree Leu better fills this pocket. This is the most mechanistically clean stability hypothesis and, because it stabilizes the DNA-binding Tnp domain, a strong candidate for a genuine activity gain.

**5. H224N (Tnp) — relief of buried-charge/strain.** His224 (relSASA 0.43) packs against A223/A225 on a Tnp helix. A partially-buried, titratable His imposes a tautomer/charge penalty; ProteinMPNN strongly prefers **Asn**, a smaller polar residue that satisfies local hydrogen bonding without the bulky imidazole, reducing local strain.

---

## 7. Recommendations for the wet lab

- **Test as individual point mutants first**, then combine the independent stabilizers (e.g. S258L + T152L + L168A span different domains and should be additive). Avoid stacking all five blindly.
- **Prioritize S258L and L168A** — highest confidence geometry (pLDDT 88–91) and cleanest mechanisms. **Flag N322L** as lower-confidence (pLDDT 74).
- **Assays:** pair a recombination/inversion activity readout with a thermostability measurement (e.g. Tm by nanoDSF or thermal-shift) and an expression/solubility check — the stability-driven hypothesis predicts gains in Tm and soluble yield that should track with activity.
- **Scope/caveats:**
  - Scores predict fitness/foldability, not catalytic rate; these are ranked *hypotheses*, not guarantees.
  - The structure is an ESMFold monomer model; IS621 functions as a higher-order assembly on a bridge-RNA/DNA complex. Positions near the modeled surface (L168) could behave differently at a real protein–protein or protein–nucleic-acid interface. A follow-up scoring round on the cryo-EM complex (PDB 8WT6–8WT9) would refine interface-proximal calls.
  - The active-site shell was deliberately excluded; direct catalytic-rate engineering would require a different, mechanism-based approach.

---

## 8. Artifact index

| File | Contents |
|---|---|
| `sequence_features.png` | Domain architecture + hydrophobicity track |
| `sequence_annotation.csv`, `catalytic_residues.csv` | Domain table, catalytic residues |
| `is621_esmfold.pdb` | ESMFold model (mean pLDDT 89.3, pTM 0.87) |
| `plddt_profile.png` | Per-residue confidence |
| `esm_variant_scores.csv`, `proteinmpnn_scores.csv`, `esmif_scores.csv` | Full 6,194-variant scores per method |
| `esm_heatmap.png` | ESM-2 mutational landscape |
| `method_comparison.png` | Cross-method correlations & top-5 placement |
| `ranked_candidates.csv` | All 218 filtered candidates |
| `ranked_candidates_by_position.csv` | Best substitution per position |
| `top5_summary.csv` | Top 5 with scores + mechanism |
| `top5_overview.png`, `top5_mut_*.png` | Structural figures |
