#!/usr/bin/env node
/**
 * Add de-identified, patient-friendly amber finding explanations (aiFinding) to
 * the MRI manifests whose radiology impression carries a key finding. Model-
 * written text from de-identified inputs only (stripped finding phrases — no
 * name/DOB/MRN). Idempotent: overwrites aiFinding for the listed studies only.
 * Bumps no images; touches manifest JSON only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "scans");

const findings = {
  "maria-regina-coury-lumbar-mri-2026-05-14-manifest.json": {
    en: "This scan notes small fluid-filled nerve-root cysts (Tarlov cysts) at the S2-S3 level, mild wear (degenerative changes) of the sacroiliac joints, and some thinning of the deep muscles along the spine. These are common findings that usually develop slowly and are frequently seen with age; on their own they don't point to anything urgent. Worth reviewing with your doctor in the context of any back or leg symptoms.",
    pt: "Este exame observa pequenos cistos de raiz nervosa cheios de líquido (cistos de Tarlov) no nível S2-S3, desgaste leve (alterações degenerativas) das articulações sacroilíacas e certa redução da musculatura profunda ao longo da coluna. São achados comuns, geralmente de evolução lenta e frequentes com a idade; isoladamente não indicam urgência. Vale conversar com seu médico considerando eventuais sintomas nas costas ou pernas.",
  },
  "maria-regina-coury-femur-mri-2026-05-14-manifest.json": {
    en: "This scan of the right thigh and hip shows partial tearing and irritation of the hamstring tendons where they attach, wear of the right hip joint, mild inflammation of a hip cushion (the trochanteric bursa), and a little fluid with lining thickening in the right knee. It also notes a previous left knee replacement. These are common musculoskeletal findings; together they can relate to pain or stiffness. Worth discussing with your doctor, especially alongside any symptoms.",
    pt: "Este exame da coxa e do quadril direitos mostra rotura parcial e irritação dos tendões isquiotibiais na sua origem, desgaste da articulação do quadril direito, leve inflamação de uma bursa do quadril (a bursa trocantérica) e um pouco de líquido com espessamento do revestimento no joelho direito. Também registra uma prótese prévia no joelho esquerdo. São achados musculoesqueléticos comuns; em conjunto podem se relacionar a dor ou rigidez. Vale conversar com seu médico, sobretudo se houver sintomas.",
  },
};

for (const [file, txt] of Object.entries(findings)) {
  const p = path.join(OUT, file);
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.aiFinding = txt; // model-written, de-identified -> renders behind .ai-pill
  fs.writeFileSync(p, JSON.stringify(m, null, 2));
  console.log("patched aiFinding:", file);
}
console.log("done.");
