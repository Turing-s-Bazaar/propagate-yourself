# Kinome CRISPR-KO Library — Construction Protocol

**Library:** 3,129 sgRNAs (2,072 kinase-targeting + 989 non-targeting + 68 positive-control)
**Vector:** lentiGuide-Puro (Addgene #52963) or lentiCRISPRv2 (Addgene #52961)
**Cloning enzyme:** Esp3I / BsmBI (Golden Gate)
**Design basis:** Brunello (Doench et al. 2016), subset to the human protein kinome.

---

## 1. Oligo pool design

Each 83-nt oligo:

```
5'-[AGGCACTTGCTCGTACGACGCGTCTCACACCG]-[20-nt spacer]-[GTTTAGAGACGTTAAGGTGCCGGGCCCACAT]-3'
      fwd amplification + BsmBI + CACCG overhang        BsmBI + AAAC overhang + rev amplification
```

- The two BsmBI recognition sites (`CGTCTC` forward, `GAGACG` reverse) face **inward**; digestion excises the adapters and leaves 4-nt overhangs (`CACCG` / `AAAC`) complementary to BsmBI-linearized lentiGuide-Puro.
- The `CACCG` overhang supplies the U6 **+1 G** required for Pol III transcription, so spacers need not begin with G.
- **9 targeting spacers begin with `TCTC`**, which fuses with the `...CACCG` adapter tail to create a spurious third BsmBI site. These are flagged `needs_separate_cloning=True` in `oligo_pool_synthesis.csv`. Clone them in a separate BbsI-based reaction (or individually by annealed-oligo cloning). Every affected gene retains ≥2 other guides, so dropping them from the main pool does not reduce any gene below 2 guides.
- Pool is otherwise free of internal BsmBI sites (8 non-targeting controls with internal BsmBI were removed during design).

Order `oligo_pool_synthesis.csv` / `oligo_order.txt` as an oligonucleotide pool (Twist Bioscience, GenScript, or CustomArray; ~3,129 × 83-mer).

## 2. Pool amplification (emulsion/low-cycle PCR)

- Resuspend pool to 1 ng/µL. Amplify with primers matching the outer adapters.
- Use a **minimal cycle number (≤15–18 cycles)** and split across ≥8 parallel 50-µL reactions to limit PCR skew/jackpotting.
- Gel-verify a single band; PCR-purify (column or 1.0× AMPure XP).

## 3. Golden-Gate assembly (BsmBI)

Per 20-µL reaction:
| Component | Amount |
|---|---|
| lentiGuide-Puro (pre-dephosphorylated or single-tube GG) | 100 ng |
| Amplified insert pool | molar ratio insert:vector ≈ 2:1 |
| Esp3I (BsmBI) | 1 µL (NEB) |
| T4 DNA Ligase | 1 µL |
| T4 Ligase Buffer (10×) | 2 µL |

Thermocycle: 30–50 cycles of (37 °C 5 min → 16 °C 5 min), then 37 °C 15 min, 65 °C 15 min (heat-kill). Purify by isopropanol precipitation or 0.7× AMPure; elute in 10 µL.

## 4. Transformation & representation

- Electroporate into **Endura** or **Lucigenic** electrocompetent *E. coli* (≥10¹⁰ cfu/µg). Use enough reactions to obtain **≥300× representation**.
- **Target: ≥ 938,700 independent colonies** (3,129 guides × 300×). Plate serial dilutions to count cfu and confirm coverage **before** scraping.
- Scrape all colonies from large bioassay plates; midi/maxi-prep plasmid DNA.

## 5. Coverage QC

- Deep-sequence the plasmid pool (amplicon NGS of the spacer region) at ≥500 reads/guide.
- Acceptance: **>90–95 % of guides detected**, **skew ratio (90th/10th percentile) < 10**, Gini index < 0.1. Re-clone if skew or dropout is excessive.

## 6. Lentivirus production

- Co-transfect HEK293T/293FT with the library plasmid + psPAX2 (gag-pol) + pMD2.G (VSV-G) at standard ratios (4:3:1 or 4:2:1).
- Harvest viral supernatant at 48 h and 72 h; 0.45-µm filter; concentrate if needed; aliquot and store at −80 °C.
- **Titer** on the target cell line (functional titer by puromycin-resistant colony counting at serial dilutions) to determine the volume giving MOI ≈ 0.3.

## Key parameters

| Parameter | Value |
|---|---|
| Unique sgRNAs | 3,129 |
| Oligo length | 83 nt |
| Cloning enzyme | Esp3I / BsmBI |
| Backbone | lentiGuide-Puro / lentiCRISPRv2 |
| Cloning representation | ≥ 300× (≥ 938,700 colonies) |
| Separate-cloning guides | 9 (TCTC-leading, BbsI) |
