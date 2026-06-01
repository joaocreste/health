#!/usr/bin/env node
/**
 * Wave 2 — pharmacogenomics for Patient Zero.
 * Source: web/physical-genetics.html (GnTech TotalGene panel, reported 2023-06-14).
 * Posts pgx_findings rows through the live Worker seed endpoint.
 *
 *   node scripts/seed-joao-genetics.mjs        # dry run
 *   node scripts/seed-joao-genetics.mjs --apply
 */
const APPLY = process.argv.includes("--apply");
const BASE = process.env.LUMEN_BASE || "https://lumenhealth.io";
const ADMIN = process.env.LUMEN_ADMIN_CLERK || "pending:admin";
const CLERK = "pending:joao";
const ASSAY = "GnTech TotalGene (NGS)";
const ON = "2023-06-14";

// category: pharmacokinetic | pharmacodynamic | condition_risk | other
const PK = "pharmacokinetic", PD = "pharmacodynamic", CR = "condition_risk", OT = "other";
const f = (gene, variant, phenotype, category, drug_class_impact = null, recommendation = null, confidence = "high") =>
  ({ gene, variant, phenotype, category, drug_class_impact, recommendation, confidence, assay_name: ASSAY, reported_on: ON });

const rows = [
  // ── PsicoGene · metabolism ──
  f("CYP1A2", "*1M/*1M", "Normal metaboliser (inducible to ultrarapid in smokers / CYP1A2 inducers)", PK),
  f("CYP2B6", "*1/*4", "Rapid metaboliser", PK, "bupropion, selegiline", "Rapid CYP2B6 metaboliser — bupropion/selegiline may need a dose increase."),
  f("CYP2C9", "*1/*2", "Intermediate metaboliser", PK, "valproate, phenytoin, NSAIDs, warfarin", "Reduced clearance: monitor serum valproate/LFTs/ammonia on Depakote; phenytoin/fosphenytoin ~25% maintenance dose reduction (CPIC); start celecoxib/flurbiprofen at lowest labelled dose; warfarin needs PGx-guided dosing."),
  f("CYP2C19", "*1C/*1C", "Normal metaboliser", PK, "diazepam, citalopram, escitalopram", "Normal metaboliser — diazepam (Valium) and citalopram-class agents behave as labelled."),
  f("CYP2D6", "*1/*1", "Normal metaboliser", PK, "SSRIs/SNRIs, tamoxifen", "Normal metaboliser — SSRI/SNRI rotation and tamoxifen dosing behave as labelled."),
  f("CYP3A4", "*1/*1", "Normal metaboliser", PK, "quetiapine, diazepam", "Normal metaboliser — quetiapine and diazepam behave as labelled."),
  f("CYP3A5", "*3/*3", "Non-expresser (poor metaboliser)", PK, "midazolam, tacrolimus", "Reduced midazolam clearance (red flag); tacrolimus standard start with TDM."),
  f("EPHX1", "rs1051740 T/C", "Elevated metaboliser", PK),
  f("EPHX1", "rs2234922 A/A", "Reduced metaboliser", PK),
  f("UGT1A4", "rs2011425 T/T", "Reduced metaboliser (lamotrigine)", PK, "lamotrigine"),
  f("UGT2B15", "rs1902023 A/C", "Reduced metaboliser", PK, "valproate, lorazepam, oxazepam", "Contributes to valproate clearance (relevant to Depakote ER); lorazepam/oxazepam can accumulate — consider dose reduction if a benzo rotation is needed during the diazepam taper."),
  f("MTHFR", "rs1801131 c.1298A>C A/C", "Heterozygous", OT),
  f("MTHFR", "rs1801133 c.677C>T C/T", "Compound heterozygote; ~50% reduction in MTHFR enzyme activity", CR, "antidepressants, folate", "Consider L-methylfolate adjunct to optimise antidepressant response; current B12 supplementation appropriate but methylated folate is the actionable add-on.", "moderate"),
  // ── PsicoGene · response / toxicity ──
  f("ABCB1", "rs1045642 G/G", "Reduced response", PD, null, null, "moderate"),
  f("ABCB1", "rs2032583 A/A", "Reduced risk of adverse effects", PD, null, null, "moderate"),
  f("ADRA2A", "rs1800544 G/C", "Favourable response", PD, null, null, "moderate"),
  f("ANKK1", "rs1800497 G/G", "Drug-dependent toxicity/response", PD, null, null, "moderate"),
  f("BDNF", "rs962369 T/T", "Reduced risk of adverse effects", PD, null, null, "moderate"),
  f("BDNF", "rs61888800 G/G", "Favourable response", PD, null, null, "moderate"),
  f("COMT", "rs4680 G/A", "Drug-dependent response", PD, null, null, "moderate"),
  f("COMT", "rs13306278 C/C", "Favourable response", PD, null, null, "moderate"),
  f("DRD1", "rs4532 C/T", "Reduced risk of adverse effects", PD, null, null, "moderate"),
  f("DRD2", "rs1799978 T/T", "Favourable response", PD, null, null, "moderate"),
  f("FKBP5", "rs4713916 A/A", "Favourable response (antidepressants)", PD, "SSRIs/SNRIs", "Favourable serotonergic response marker — SSRI/SNRI re-trial genetically supported if clinically indicated.", "moderate"),
  f("GRIK4", "rs1954787 T/C", "Reduced response", PD, null, null, "moderate"),
  f("GSK3B", "rs334558 A/G", "Favourable response", PD, null, null, "moderate"),
  f("GSK3B", "rs6438552 A/G", "Reduced response", PD, null, null, "moderate"),
  f("HTR1A", "rs6295 C/G", "Reduced response", PD, null, null, "moderate"),
  f("HTR2A", "rs7997012 G/G", "Reduced response", PD, null, null, "moderate"),
  f("HTR2C", "rs1414334 G/-", "Reduced risk of adverse effects (weight gain)", PD, "antipsychotics", null, "moderate"),
  f("HTR2C", "rs3813929 C/-", "Elevated risk of adverse effects", PD, "antipsychotics", null, "moderate"),
  f("MC4R", "rs489693 C/A", "Reduced risk of adverse effects (weight gain) with antipsychotics", PD, "antipsychotics (quetiapine)", "Lower metabolic-adverse-effect risk on quetiapine.", "moderate"),
  f("OPRD1", "rs678849 T/T", "Favourable response (opioids)", PD, "opioids", null, "moderate"),
  f("OPRM1", "rs1799971 A/A", "Drug-dependent toxicity/response (opioids)", PD, "opioids", null, "moderate"),
  f("SLC6A2", "rs28386840 T/A", "Favourable response", PD, null, null, "moderate"),
  f("SLC6A4", "5-HTTLPR L/C", "Favourable response (SSRIs)", PD, "SSRIs", "Favourable serotonergic response marker.", "moderate"),
  // ── HLA immunogenicity ──
  f("HLA-A", "rs1061235 WT/WT", "HLA-A*31:01 negative — normal SJS/TEN risk (carbamazepine)", CR),
  f("HLA-B", "rs144012689 WT/WT", "HLA-B*15:02 negative — normal SJS/TEN risk (carbamazepine, oxcarbazepine, phenytoin)", CR),
  f("G6PD", "B/-", "Normal G6PD activity", OT),
  // ── OncoGene (new genes) ──
  f("DPYD", "*1/*4", "Normal metaboliser — normal DPD activity", PK, "fluoropyrimidines (5-FU, capecitabine)", "Standard dosing."),
  f("NUDT15", "*1/*1", "Normal metaboliser", PK, "thiopurines"),
  f("TPMT", "*1/*1", "Normal metaboliser", PK, "thiopurines", "Normal myelosuppression risk."),
  f("UGT1A1", "*1/*1", "Normal metaboliser", PK, "irinotecan, atazanavir"),
  f("XPC", "rs2228001 G/T", "Elevated risk of cisplatin-induced toxicity (ototoxicity, neutropenia)", CR, "cisplatin", "Audiometric monitoring if cisplatin used."),
  // ── CardioGene (warfarin cluster + statins) ──
  f("VKORC1", "*1/*2", "Increased warfarin sensitivity", CR, "warfarin", "Part of the warfarin high-sensitivity cluster — prefer an alternative anticoagulant (rivaroxaban is green)."),
  f("CYP4F2", "rs2108622 *3/*3", "Homozygous T allele — warfarin dose increase 5–10%", PK, "warfarin", "If warfarin required, use a validated PGx dosing algorithm and add 5–10% for CYP4F2 carrier status."),
  f("CES1", "rs2244613 T/T", "Reduced metaboliser — elevated dabigatran bleeding risk", PK, "dabigatran", "Avoid dabigatran in atrial fibrillation (elevated bleed risk)."),
  f("SLCO1B1", "*1/*1", "Normal hepatic statin transport", PK, "statins", "Note: ABCB1 rs2032582 C/C predicts reduced simvastatin response — prefer atorvastatin/rosuvastatin."),
  f("ABCB1", "rs2032582 C/C", "Reduced response to simvastatin", PD, "simvastatin", null, "moderate"),
  f("ACE", "rs1799752 WT(DEL)/Ins", "Favourable response to captopril/quinapril", PD, "ACE inhibitors", "Benazepril flagged reduced response — prefer captopril/quinapril/perindopril.", "moderate"),
];

console.log(`pgx_findings rows: ${rows.length}`);
console.log("genes:", [...new Set(rows.map((r) => r.gene))].join(", "));

if (!APPLY) { console.log("\n(dry run — pass --apply to POST)"); process.exit(0); }

const resp = await fetch(`${BASE}/api/admin/seed-clinical`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Viewer-Clerk": ADMIN },
  body: JSON.stringify({ patient_clerk: CLERK, table: "pgx_findings", rows }),
});
const text = await resp.text();
console.log(resp.status, text.slice(0, 400));
