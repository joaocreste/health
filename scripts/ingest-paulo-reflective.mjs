#!/usr/bin/env node
/**
 * Gate 1 — structure Paulo Silotto's collateral account into reflective_items.
 *
 * Paulo has NO clinical mental-health history. The only mental-DB input is one
 * third-party account (his son João's verbatim narrative, writing 562f411c…).
 * This script converts that raw text into the operator-reviewable Reflective
 * Portrait schema (migration 0017) — the ONLY synthesis this frontend job does.
 *
 * Operator decisions encoded here (asked & confirmed before authoring):
 *   - Consent: cleared. Third-party items are ATTRIBUTED to João (son, lifelong).
 *   - Sensitive content: the family's "deep depression" concern is rendered ONCE
 *     as a gentle, attributed blind-spot perception ("a heavy, lasting weight"),
 *     NON-clinical, no diagnosis word. Relative-directed content ("bacteria /
 *     worms" about aunts/uncle) is DROPPED — it is not about Paulo.
 *   - Persistence: full DB (this table) + API endpoint.
 *
 * Johari logic for THIS patient: Paulo wrote nothing himself, so nothing is
 * self-corroborated -> every 'other' item is quadrant 'blind', every
 * 'ai_synthesis' item is 'emerging'; 'open' and 'hidden' are intentionally
 * EMPTY until Paulo adds his own words. That emptiness is the point of the page.
 *
 * Idempotent: upsert on (patient_id, item_key). Dry-run by default; --apply writes.
 *   node scripts/ingest-paulo-reflective.mjs            # dry run + readback plan
 *   node scripts/ingest-paulo-reflective.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const DATABASE_URL = process.env.DATABASE_URL || fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);
const CLERK = "pending:paulo-silotto-df3441";

// Author provenance for every third-party ('other') item.
const SON = { author_name: "João Victor Creste", relationship: "son", known_duration: "his whole life", entry_date: "2026-06-19", confidence: null };
const AI = (confidence) => ({ author_name: null, relationship: null, known_duration: null, entry_date: null, confidence });

// source: self|other|ai_synthesis · quadrant: open|blind|hidden|emerging
const ITEMS = [
  // ── STRENGTHS · what João sees (other -> blind) ──────────────────────────
  { key: "str-provider", source: "other", meta: SON, quadrant: "blind", category: "strength", rank: 1,
    en: "From the age of twelve — the year your father died — you carried an entire family on your back, and you never put it down. João sees a man who simply 'gets the job done,' without a word of complaint.",
    pt: "Desde os doze anos — o ano em que seu pai morreu — você carregou uma família inteira nas costas, e nunca a colocou no chão. João vê um homem que simplesmente 'faz o que precisa ser feito', sem uma palavra de queixa.",
    evidence: "He worked from the age of 12 … never stopping, never complaining about pain." },
  { key: "str-connector", source: "other", meta: SON, quadrant: "blind", category: "strength", rank: 2,
    en: "You are, in João's words, 'the one who connects it all, the one who brings it all together' — quietly, in silence, without ever being thanked for it.",
    pt: "Você é, nas palavras de João, 'aquele que conecta tudo, aquele que une tudo' — em silêncio, sem nunca receber um obrigado por isso.",
    evidence: "In silence, he is the one who works to keep the ranch alive." },
  { key: "str-devotion", source: "other", meta: SON, quadrant: "blind", category: "strength", rank: 3,
    en: "Your love shows up as action, not announcement. You keep everything around the people you care for in good order, and João has no doubt you would give everything for the people you love.",
    pt: "Seu amor aparece em ação, não em discurso. Você mantém tudo ao redor de quem você cuida em ordem, e João não tem dúvida de que você daria tudo pelas pessoas que ama.",
    evidence: "everything is always sparkling … he would die for others." },
  { key: "str-endurance", source: "other", meta: SON, quadrant: "blind", category: "strength", rank: 4,
    en: "Since a back injury at sixteen you have lived alongside pain and kept moving anyway. Where others would have stopped, you learned to carry on.",
    pt: "Desde uma lesão na coluna aos dezesseis anos você convive com a dor e mesmo assim segue em frente. Onde outros teriam parado, você aprendeu a continuar.",
    evidence: "his first back hernia when he was 16 … Maybe he learned how to live in pain." },

  // ── GROWTH EDGES · a pattern João noticed (other -> blind), perspective not verdict ──
  { key: "ge-self-last", source: "other", meta: SON, quadrant: "blind", category: "growth_edge", rank: 1,
    en: "The pattern João most wants you to notice: you pour yourself out for everyone else and keep almost nothing for yourself. He points to the second half of an old line — 'love your neighbour as yourself' — and worries the 'as yourself' has quietly gone missing.",
    pt: "O padrão que João mais quer que você perceba: você se entrega por todos os outros e guarda quase nada para si. Ele lembra a segunda metade de uma frase antiga — 'ame o próximo como a si mesmo' — e teme que o 'como a si mesmo' tenha se perdido pelo caminho.",
    evidence: "he would die for others, but he would never live for himself." },
  { key: "ge-cant-say-no", source: "other", meta: SON, quadrant: "blind", category: "growth_edge", rank: 2,
    en: "João feels you are stretched across three families at once — your own, your siblings, and the people you work for — and that saying 'no' is hard for you, even when the cost of saying 'yes' lands squarely on you.",
    pt: "João sente que você está dividido entre três famílias ao mesmo tempo — a sua, a dos seus irmãos e a das pessoas para quem você trabalha — e que dizer 'não' é difícil para você, mesmo quando o custo de dizer 'sim' recai inteiramente sobre você.",
    evidence: "So, he carries three families at once." },
  { key: "ge-inward", source: "other", meta: SON, quadrant: "blind", category: "growth_edge", rank: 3,
    en: "Over the years João has watched you turn more inward — present in the room but sometimes far away, your attention pulled to the next thing that needs handling. He misses the man who was full of plans and small everyday joys.",
    pt: "Com os anos, João viu você se voltar mais para dentro — presente na sala, mas às vezes distante, com a atenção puxada para a próxima coisa a resolver. Ele sente falta do homem cheio de planos e de pequenas alegrias do dia a dia.",
    evidence: "to becoming a man who is gray, who is numb … he's not paying attention." },
  { key: "ge-heavy-weight", source: "other", meta: SON, quadrant: "blind", category: "growth_edge", rank: 4, support: true,
    en: "Someone who loves you very much worries that you have been carrying a heavy, lasting weight — a quiet exhaustion that looks like more than ordinary tiredness — and he hopes, more than anything, that you would let some support help you set part of it down. This is his fear, offered with love; it is not a verdict on you.",
    pt: "Alguém que ama muito você teme que você venha carregando um peso pesado e duradouro — um cansaço silencioso que parece ser mais do que o cansaço comum — e ele espera, mais do que tudo, que você aceite algum apoio para poder pôr parte desse peso no chão. Este é o medo dele, oferecido com amor; não é um veredito sobre você.",
    evidence: "I am willing to do whatever it takes … to help him." },

  // ── VALUES · what João sees you living by (other -> blind; observed, not self-declared) ──
  { key: "val-family", source: "other", meta: SON, quadrant: "blind", category: "value", rank: 1,
    en: "Family comes first — it always has. Whatever was asked of you, you showed up.",
    pt: "A família vem em primeiro lugar — sempre foi assim. O que pedissem de você, você apareceu.",
    evidence: "he took charge of the entire family at the age of 12." },
  { key: "val-loyalty", source: "other", meta: SON, quadrant: "blind", category: "value", rank: 2,
    en: "Loyalty, shown by turning up: the person everyone calls when something has to be carried or fixed.",
    pt: "Lealdade, demonstrada por estar presente: a pessoa que todos chamam quando algo precisa ser carregado ou resolvido.",
    evidence: "he is the one who brings it all together." },
  { key: "val-faith", source: "other", meta: SON, quadrant: "blind", category: "value", rank: 3,
    en: "Faith runs through how your son speaks of you — scripture and the example of love sit close to the centre of this account.",
    pt: "A fé atravessa o modo como seu filho fala de você — as escrituras e o exemplo do amor estão perto do centro deste relato.",
    evidence: "that reminds me when Jesus says, love one another as you love thyself." },
  { key: "val-provision", source: "other", meta: SON, quadrant: "blind", category: "value", rank: 4,
    en: "Dignity through work and provision — making sure there was always something on the table, for everyone, and last of all for yourself.",
    pt: "Dignidade pelo trabalho e pelo sustento — garantir que sempre houvesse algo na mesa, para todos, e por último para você mesmo.",
    evidence: "caring to bring something to eat at my mom and my grandma's table." },

  // ── THEMES · AI synthesis (ai_synthesis -> emerging) ─────────────────────
  { key: "th-sacrifice", source: "ai_synthesis", meta: AI("high"), quadrant: "emerging", category: "theme", rank: 1,
    en: "A life organised around self-sacrifice. Again and again the account returns to one shape: you absorb the cost so others don't have to. It is your great strength and, this reading suggests, the thing most quietly draining you.",
    pt: "Uma vida organizada em torno do auto-sacrifício. Repetidas vezes o relato volta ao mesmo desenho: você absorve o custo para que os outros não precisem. É a sua maior força e, sugere esta leitura, o que mais silenciosamente te esgota." },
  { key: "th-strong-one", source: "ai_synthesis", meta: AI("high"), quadrant: "emerging", category: "theme", rank: 2,
    en: "The weight of being 'the strong one' since childhood. At twelve you became the adult; fifty years on, the role has never been handed back. Strength that is never allowed to rest can start to feel like a cage.",
    pt: "O peso de ser 'o forte' desde a infância. Aos doze você virou o adulto; cinquenta anos depois, o papel nunca foi devolvido. Uma força a quem nunca se permite descanso pode começar a parecer uma jaula." },
  { key: "th-unlived", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "theme", rank: 3,
    en: "Carrying other people's unlived lives. This reading notices how much of your energy goes to lives that are not your own — and how little is left over for the plans and small pleasures that were once yours.",
    pt: "Carregar as vidas não vividas dos outros. Esta leitura percebe quanta da sua energia vai para vidas que não são a sua — e quão pouco sobra para os planos e pequenos prazeres que um dia foram seus." },

  // ── A JUNGIAN LENS · one way to read this, dismissible (ai_synthesis -> emerging) ──
  { key: "jung-caretaker", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "jungian", rank: 1,
    en: "One lens — not a result — is the figure Jung might call the Caretaker, or Atlas: the one who holds up the sky so others can stand. Its gift is devotion; its shadow is a self that disappears under the weight it carries. The invitation of this archetype is not to drop the world, but to discover that you, too, are allowed to be held.",
    pt: "Uma lente — não um resultado — é a figura que Jung poderia chamar de Cuidador, ou Atlas: aquele que sustenta o céu para que os outros fiquem de pé. Seu dom é a devoção; sua sombra é um eu que desaparece sob o peso que carrega. O convite deste arquétipo não é largar o mundo, mas descobrir que você também tem permissão para ser amparado." },

  // ── RECOMMENDED READING · curiosity not prescription, 3 max (ai_synthesis -> emerging) ──
  { key: "rec-body-says-no", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "recommendation", rank: 1,
    en: "Out of curiosity, not prescription — tied to 'self-sacrifice': Gabor Maté, When the Body Says No. It explores how a lifetime of putting others first and swallowing one's own needs can settle into the body. Given a back that has carried so much, it may read like a mirror.",
    pt: "Por curiosidade, não por prescrição — ligado ao 'auto-sacrifício': Gabor Maté, Quando o Corpo Diz Não. O livro explora como uma vida inteira colocando os outros em primeiro lugar e engolindo as próprias necessidades pode se alojar no corpo. Para uma coluna que já carregou tanto, pode soar como um espelho." },
  { key: "rec-boundaries", source: "ai_synthesis", meta: AI("low"), quadrant: "emerging", category: "recommendation", rank: 2,
    en: "Tied to 'saying yes to everyone': Henry Cloud & John Townsend, Boundaries. Not about closing doors, but about learning where you end and others begin — so that generosity becomes a choice rather than a reflex.",
    pt: "Ligado a 'dizer sim para todos': Henry Cloud e John Townsend, Limites. Não se trata de fechar portas, mas de aprender onde você termina e os outros começam — para que a generosidade seja uma escolha, e não um reflexo." },
  { key: "rec-self-compassion", source: "ai_synthesis", meta: AI("low"), quadrant: "emerging", category: "recommendation", rank: 3,
    en: "Tied to 'as yourself': Kristin Neff, Self-Compassion. A gentle, practical counterweight to a life spent being kinder to everyone else than to yourself.",
    pt: "Ligado ao 'como a si mesmo': Kristin Neff, Autocompaixão. Um contrapeso suave e prático a uma vida passada sendo mais gentil com todos os outros do que consigo mesmo." },

  // ── QUESTIONS WORTH SITTING WITH · closer (ai_synthesis -> emerging) ─────
  { key: "q-one-hour", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "question", rank: 1,
    en: "What would it look like to live one hour a week only for yourself — and what makes that hour so hard to claim?",
    pt: "Como seria viver uma hora por semana só para você — e o que torna essa hora tão difícil de reivindicar?" },
  { key: "q-hand-over", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "question", rank: 2,
    en: "If you let someone carry one thing for you, what would you hand them first?",
    pt: "Se você deixasse alguém carregar uma coisa por você, o que entregaria primeiro?" },
  { key: "q-twelve", source: "ai_synthesis", meta: AI("medium"), quadrant: "emerging", category: "question", rank: 3,
    en: "The twelve-year-old who quietly took charge of everyone — what would you most want to say to him now?",
    pt: "O menino de doze anos que silenciosamente assumiu o cuidado de todos — o que você mais gostaria de dizer a ele agora?" },
];

// distress floor: reviewed the full account for self-harm / suicidal ideation /
// abuse / acute crisis directed at the patient. None present as explicit
// statements. The family's concern about a "heavy weight" (ge-heavy-weight) is
// a worry, not a crisis -> distress_flag=false, handled via gentle framing +
// an on-item support line in the renderer (not crisis escalation).
const DISTRESS = ITEMS.filter((i) => i.distress);

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS "reflective_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "patient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "item_key" text NOT NULL, "source" text NOT NULL, "source_meta" jsonb,
    "quadrant" text NOT NULL, "category" text NOT NULL,
    "content_en" text NOT NULL, "content_pt" text NOT NULL, "evidence" text,
    "distress_flag" boolean NOT NULL DEFAULT false, "sort_rank" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'approved', "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "reflective_items_key_uq" UNIQUE ("patient_id", "item_key"))`;
  await sql`CREATE INDEX IF NOT EXISTS "reflective_items_patient_idx" ON "reflective_items" ("patient_id")`;
  await sql`CREATE TABLE IF NOT EXISTS "reflective_responses" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "item_id" uuid NOT NULL REFERENCES "reflective_items"("id") ON DELETE CASCADE,
    "patient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "reaction" text, "note" text,
    "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "reflective_responses_item_uq" UNIQUE ("item_id"))`;
  await sql`CREATE INDEX IF NOT EXISTS "reflective_responses_patient_idx" ON "reflective_responses" ("patient_id")`;
}

const rows = await sql`select id, full_name, role from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;

console.log(`Patient    : ${rows[0].full_name} (${patientId}) · role=${rows[0].role}`);
console.log(`Items      : ${ITEMS.length}`);
const by = (k) => ITEMS.reduce((a, i) => ((a[i[k]] = (a[i[k]] || 0) + 1), a), {});
console.log(`by source  : ${JSON.stringify(by("source"))}`);
console.log(`by quadrant: ${JSON.stringify(by("quadrant"))}`);
console.log(`by category: ${JSON.stringify(by("category"))}`);
console.log(`distress   : ${DISTRESS.length} flagged`);

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply to ensure tables + upsert. No write performed.");
  process.exit(0);
}

await ensureTables();
let n = 0;
for (const it of ITEMS) {
  await sql`
    insert into reflective_items
      (patient_id, item_key, source, source_meta, quadrant, category, content_en, content_pt, evidence, distress_flag, sort_rank, status)
    values
      (${patientId}, ${it.key}, ${it.source}, ${JSON.stringify(it.meta)}::jsonb, ${it.quadrant}, ${it.category},
       ${it.en}, ${it.pt}, ${it.evidence || null}, ${!!it.distress}, ${it.rank}, 'approved')
    on conflict (patient_id, item_key) do update set
      source = excluded.source, source_meta = excluded.source_meta, quadrant = excluded.quadrant,
      category = excluded.category, content_en = excluded.content_en, content_pt = excluded.content_pt,
      evidence = excluded.evidence, distress_flag = excluded.distress_flag, sort_rank = excluded.sort_rank,
      status = excluded.status`;
  n++;
}
console.log(`\n✓ upserted ${n} reflective_items`);

// ── read-back proof ──────────────────────────────────────────────────────
const cBySrc = await sql`select source, count(*)::int n from reflective_items where patient_id=${patientId} group by source order by source`;
const cByQ   = await sql`select quadrant, count(*)::int n from reflective_items where patient_id=${patientId} group by quadrant order by quadrant`;
const cByCat = await sql`select category, count(*)::int n from reflective_items where patient_id=${patientId} group by category order by category`;
const flagged = await sql`select item_key, content_en from reflective_items where patient_id=${patientId} and distress_flag=true`;
console.log("\nREAD-BACK from DB:");
console.log("  by source  :", JSON.stringify(cBySrc));
console.log("  by quadrant:", JSON.stringify(cByQ));
console.log("  by category:", JSON.stringify(cByCat));
console.log("  distress rows:", JSON.stringify(flagged));
