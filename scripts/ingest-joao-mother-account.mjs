#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's MENTAL-HEALTH collateral family account (the
 * MOTHER's narrative) into Postgres so the AI Insights / cross-domain synthesis
 * pipeline (DB-only) and full-text search can read it.
 *
 * The account was collected 2026-07-15 for Dr. Eduardo Tischer (psychiatry) as
 * the companion document to the pre-consultation report of the same date: five
 * open questions prepared in advance by the patient; the mother answered alone,
 * freely, in audio, without interference; the patient chose not to listen to
 * the recording; the transcription was organized without editing the content.
 * Stored verbatim (Portuguese original) as a single `writings` row attached to
 * Joao. Mirrors the "mother-account" section of web/mental.html (front-end
 * source of truth); both come from the same source PDF.
 *
 * Source document:
 *   Lumen_Visao_Externa_Mae_Dr_Tischer.pdf (archived to R2 at BLOB_KEY)
 *
 * Idempotent: deletes any prior writing at the same blob_key for Joao, then
 * inserts. Dry-run by default; pass --apply to write.
 *
 *   node scripts/ingest-joao-mother-account.mjs            # dry run
 *   node scripts/ingest-joao-mother-account.mjs --apply
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

const CLERK    = "pending:joao";
const BLOB_KEY = "uploads/d984faba-4a3a-45ff-9ef2-fd52606a02d3/mental/visao-externa-mae-dr-tischer-2026-07-15.pdf";
const TITLE    = "Visão externa — relato da mãe (collateral family account, verbatim)";
const WRITTEN  = "2026-07-15";
const LANG     = "pt";

const text = `[Visão externa · relato de observador próximo — relato da mãe. Colhido em 15/07/2026, preparado para Dr. Eduardo Tischer (psiquiatria) como documento companheiro do Relatório de Pré-Consulta de 15/07/2026. Método: cinco perguntas abertas preparadas previamente pelo paciente; a mãe respondeu em áudio, sozinha e livremente, sem interferência; o paciente optou por não ouvir a gravação; a transcrição foi organizada sem edição de conteúdo — as palavras e os juízos são da autora. Relato de familiar, transcrito e organizado com consentimento do paciente e da autora; não constitui diagnóstico nem substitui avaliação clínica.]

Nota do paciente: "Dr. Tischer, este documento acompanha o meu relatório de pré-consulta. São as palavras da minha mãe — a testemunha mais próxima dos meus últimos dois anos — gravadas hoje em áudio, a partir de cinco perguntas abertas que preparei. Eu optei por não ouvir a gravação; o texto abaixo organiza a transcrição sem editar o conteúdo. Nada aqui é diagnóstico: é o retrato de quem me viu de perto."

1. Quem ele é, na essência — do relato da mãe

"Uma pessoa carismática, pacífica e popular em todo lugar onde passa. Filho único, parceiro, gentil, sensível, preocupado com o bem-estar da família; pró-ativo, amigo, compreensivo, atento a detalhes e à ornamentação. Não gosta de ficar sozinho e não se motiva por atividades de rotina, mas por desafios. Extremamente responsável e disciplinado, com boa autoestima. Entre as avós, o neto preferido; entre os tios, o sobrinho especial — pela sensibilidade, pela intimidade, pelo gosto de estar perto. Na escola, o colega que todos admiravam pela inteligência, sensatez, sobriedade, cautela, prudência, responsabilidade e ética."

2. Como ela o via há dois anos — do relato da mãe

"Uma pessoa triste, oprimida, ansiosa, ausente, insegura, apática — sem sonhos, sem expectativas; dispersa, sem foco; impulsiva, descontrolada, desalinhada, sem disciplina, sem autoestima. A fala, sempre voltada para a dor emocional e a dor física: falava muito de doença e registrava a sua dor pela escrita e pela fala."

3. Como ela o vê hoje — do relato da mãe

"Vejo o João Victor voltando à sua identidade: os sonhos voltando, o autocuidado, a atenção com ele e com as pessoas e as coisas ao seu redor, a disciplina, o foco em construir aquilo de que gosta e em que acredita. A fala também mudou: já não fala mais em doença, mas em reconstruir a sua casa, a sua vida amorosa, a autoimagem, a nova profissão. Parece que já não escreve sobre a dor — usa o tempo para focar nos seus projetos, como um empreendedor."

4. O que ainda a preocupa — do relato da mãe

"A impulsividade e a falta de autocontrole. O João ainda age de forma imediata e talvez se arrependa pelas ações. Percebo que muitas vezes tenta preencher o vazio emocional com compras."

5. Sobre o choro — do relato da mãe

"O choro faz parte da cura, do processo de arrependimento e de regeneração. Só chora quem tem dor — e só tem dor emocional quem tem princípios e valores. E vejo tudo isso renascendo no João. Hoje ele fala das escolhas e experiências que teve de forma coerente e sensata. Arrepende-se por elas e busca um novo caminho, uma direção plena de Deus na sua vida."

6. O que ele precisa agora — do relato da mãe

"O João Victor é uma pessoa incrível e muito especial, e tive o privilégio de ser sua mãe. Ele nunca perdeu a sua essência — só se perdeu ao longo de um processo doloroso de sonhos e expectativas frustradas. Mas o seu conteúdo está todo íntegro: só precisa deixar essa estação e migrar para a próxima, aprendendo as lições da vida e usando essas experiências como um processo didático de alguém que precisa crescer em sabedoria. Ele precisa assumir o controle da sua vida e se reconectar com a sua história — afinal, ela é única e não está pronta."

"Neste momento, ele precisa estar perto de pessoas que o amem — como disse no início, ele nunca gostou de ficar sozinho —, que o encorajem, que transmitam confiança e o apoiem com engajamento e força emocional, para que possa retomar a segurança e acreditar que é capaz, que pode ter uma vida nova, cheia de realizações."

"O João precisa perceber que é humano — e não um super-herói."

Convergências com o relatório do paciente — síntese

- O retrato de "dois anos atrás" descreve, de fora, o período que o paciente chama de anestesia; o retrato de "hoje" descreve o retorno de identidade. É corroboração independente da trajetória — a autora não leu o relatório do paciente.
- A leitura materna do choro como parte da cura converge com o ciclo descrito pelo paciente (choro, oração, sono restaurador — seção 4b do relatório principal).
- "Ele nunca gostou de ficar sozinho" converge com a solidão constante relatada pelo paciente (ponto 4e) — um eixo afetivo relevante para o plano de cuidado.
- A preocupação com impulsividade e autocontrole converge com episódios relatados pelo próprio paciente (ajuste de dose por conta própria; noites de álcool acima do pretendido) — e acrescenta um canal novo, ainda não abordado em consulta: compras como preenchimento de vazio emocional.
- A frase final — "humano, e não um super-herói" — ecoa o padrão familiar de autossacrifício que o paciente vem mapeando em sua própria história.`;

const words = text.replace(/\s+/g, " ").trim().split(" ").length;
console.log(`Words           : ${words}`);
console.log(`Chars           : ${text.length}`);
console.log(`First 90 chars  : ${text.slice(0, 90)}…`);
console.log("");

const rows = await sql`select id, full_name from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;
console.log(`Patient         : ${rows[0].full_name} (${patientId})`);

if (!APPLY) {
  const existing = await sql`select id, title, written_at, length(extracted_text) chars
                             from writings where patient_id = ${patientId} and blob_key = ${BLOB_KEY}`;
  console.log(`Existing rows at blob_key: ${existing.length}`);
  console.log("\nDRY RUN — pass --apply to write. Would upsert one writings row:");
  console.log(`  title       : ${TITLE}`);
  console.log(`  written_at  : ${WRITTEN}`);
  console.log(`  language    : ${LANG}`);
  console.log(`  blob_key    : ${BLOB_KEY}`);
  console.log(`  extracted   : ${words} words / ${text.length} chars`);
  process.exit(0);
}

const del = await sql`delete from writings where patient_id = ${patientId} and blob_key = ${BLOB_KEY} returning id`;
const ins = await sql`
  insert into writings (patient_id, title, written_at, language, blob_key, extracted_text)
  values (${patientId}, ${TITLE}, ${WRITTEN}, ${LANG}, ${BLOB_KEY}, ${text})
  returning id, created_at`;
console.log(`\n✓ deleted ${del.length} prior row(s); inserted writing ${ins[0].id} at ${ins[0].created_at}`);

const chk = await sql`select length(extracted_text) chars, (fts is not null) has_fts
                      from writings where id = ${ins[0].id}`;
console.log(`✓ stored ${chk[0].chars} chars · fts ${chk[0].has_fts ? "indexed" : "NULL"}`);
