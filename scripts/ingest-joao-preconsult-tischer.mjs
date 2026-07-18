#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's PRE-CONSULTATION REPORT for Dr. Eduardo Tischer
 * (psychiatry), issued 2026-07-15, into Postgres so the AI Insights /
 * cross-domain synthesis pipeline (DB-only) and full-text search can read it.
 *
 * The document was prepared by the patient as material for discussion with the
 * treating psychiatrist ahead of the consultation — scope: mental state,
 * medication, sleep — in the week before the forehead fibrosis-correction
 * surgery (~5 days out, under sedation). Seven sections plus an appendix with
 * the 18 self-examination questions of 2026-07-14. It is the "relatório
 * principal" that the mother's external-view account (see
 * ingest-joao-mother-account.mjs) accompanies; that row's convergence notes
 * cite this report's sections 4b/4e.
 *
 * Stored verbatim (Portuguese original, source PDF v5) as a single `writings`
 * row attached to Joao. The current-medication doses in section 7 match the
 * medications table already ingested via ingest-joao-medications.mjs
 * (2026-07-15) — no meds change rides along with this ingest.
 *
 * Source document:
 *   Lumen_Relatorio_PreConsulta_Dr_Tischer_v5.pdf (archived to R2 at BLOB_KEY)
 *
 * Idempotent: deletes any prior writing at the same blob_key for Joao, then
 * inserts. Dry-run by default; pass --apply to write.
 *
 *   node scripts/ingest-joao-preconsult-tischer.mjs            # dry run
 *   node scripts/ingest-joao-preconsult-tischer.mjs --apply
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
const BLOB_KEY = "uploads/d984faba-4a3a-45ff-9ef2-fd52606a02d3/mental/relatorio-preconsulta-dr-tischer-2026-07-15.pdf";
const TITLE    = "Relatório de pré-consulta — Dr. Eduardo Tischer, psiquiatria (15/07/2026, verbatim)";
const WRITTEN  = "2026-07-15";
const LANG     = "pt";

const text = `[Síntese pré-consulta · psiquiatria — Relatório de pré-consulta. Emitido em 15/07/2026, preparado para Dr. Eduardo Tischer (psiquiatria). Contexto: cirurgia em ~5 dias, sob sedação. Escopo: mental · medicação · sono. Documento preparado pelo paciente como material para discussão com o médico assistente; não substitui avaliação clínica. Documento principal acompanhado pela "Visão externa — relato da mãe" da mesma data.]

Nota introdutória do paciente: "Dr. Tischer, preparei este documento para que o senhor chegue à nossa consulta já com o quadro completo e honesto das últimas semanas. Não é um autodiagnóstico — é a minha tentativa de organizar o que estou vivendo, para conversarmos com objetividade e para que as decisões sobre a medicação e a cirurgia sejam tomadas com dados reais."

1. Mudança abrupta de ambiente e de vida

Em um intervalo curto, quase tudo o que estruturava a minha vida mudou de lugar: o fim do meu casamento, a saída da Europa, a perda do apartamento e da rotina que eu havia construído em São Paulo e o retorno ao Brasil — para a casa dos meus pais, no interior. Cada uma dessas mudanças seria significativa por si só; juntas, e comprimidas em poucos meses, produziram um luto denso: pelo papel de marido, pelo projeto de família, pela independência e pela identidade profissional que eu exercia.

Registro com clareza: a sensação de "estar preso" que às vezes relato não diz respeito à minha situação atual. Meus pais me dão espaço total, a relação é adulta — contribuo com a casa e presto consultoria às empresas deles — e me sinto seguro e acolhido. O que existe é luto pela vida anterior, não insegurança na vida presente. Minha percepção, que quero testar com o senhor, é que boa parte dos sintomas abaixo é reação a essa ruptura circunstancial.

2. Ansiedade pré-cirúrgica — cirurgia em ~5 dias

Daqui a cerca de cinco dias farei, com o Dr. Chodraui e sob sedação, a correção da fibrose/cicatriz frontal que carrego há cerca de 14 anos — anos de dor física e de ocultação. Aguardo esse momento com enorme esperança (sinto que é o início de uma nova era de autoestima) e, ao mesmo tempo, com grande e crescente ansiedade à medida que a data se aproxima. Acredito que essa antecipação vem amplificando os demais sintomas — algumas noites de sono, a vontade de beber, a intensidade do choro — e peço que consideremos esse pano de fundo em todas as decisões desta semana.

3. Estado agudo — manhã de 15 de julho

Registro em tempo real como cheguei a esta manhã: uma noite péssima de sono, diarreia, náusea com vontade de vomitar e incapacidade de comer. Isso veio na sequência do exercício profundo de auto-exame dos últimos dias (as 18 perguntas reproduzidas no Apêndice), de duas noites com álcool e da aproximação da cirurgia. Não trago este quadro como alarme, mas porque o senhor precisa ver o estado físico com que estou entrando na semana pré-operatória — e porque preciso da sua orientação sobre como proceder com a medicação em dias de náusea ou vômito.

4. Seis pontos clínicos que preciso trazer com honestidade

a) Pensamentos de morte (ideação). Tenho, com frequência aproximadamente semanal, o pensamento de que o mundo — e as pessoas ao meu redor — estariam melhor sem mim. Não é desejo ativo de morrer; é a sensação de ter causado sofrimento e de que a minha ausência traria paz. Reconheço um histórico de ter pensado em uma arma de fogo como possível "saída". Hoje: não tenho plano nem intenção; não tenho acesso (as armas da família ficam no sítio, a cerca de 3 horas daqui, nunca vou até lá sozinho e não irei antes da cirurgia); e escolho a vida — por convicção, não apenas por vontade. Peço que este ponto seja tratado como central no acompanhamento, e não como nota de rodapé.

b) Episódios de choro profundo. Ocorrem cerca de 3 vezes por semana e podem durar horas. O gatilho é o luto — a família que eu construía, músicas sobre as promessas de Deus, lembranças. Têm arco definido: terminam quando entrego a situação a Deus ("seja feita a Tua vontade, não a minha") e são seguidos de sono profundo e restaurador, com bom REM e sonhos vívidos (dados do Oura Ring e do Apple Watch). Quero validar com o senhor a leitura de que se trata de elaboração de luto — e discutir como caminhar para episódios menos frequentes.

c) Álcool. O consumo caiu bastante desde que deixei a Europa, mas persiste um padrão: em ~75% das ocasiões bebo moderadamente; em ~25%, mais do que pretendia — sempre com gatilho de luto e de medo da solidão. Nas duas noites que antecederam este documento, bebi mais do que pretendia — na primeira delas, cerca de uma garrafa de vinho —, o que gerou tensão em casa. Reconheço a incompatibilidade disso com o desmame do diazepam e com a sedação. Meu compromisso é álcool zero até a cirurgia — e peço apoio para sustentá-lo. Registro também que, em uma noite recente, tomei 20 mg de diazepam em vez dos 27,5 mg prescritos, por decisão própria; entendo que ajustes de dose cabem ao senhor e não os repetirei.

d) Sensação no peito. Durante o choro prolongado sinto uma contração intensa no peito, a ponto de sentir o coração "nas mãos". Não parece dor cardíaca — parece o esforço muscular de uma liberação emocional sustentada — mas gostaria da sua avaliação sobre a necessidade de algum monitoramento.

e) A "janela das 16h" generalizou. Durante meses, o fim das aulas às 16h era o meu horário de maior risco — solidão pós-aula, vontade de beber ou de usar diazepam. A janela pontual desapareceu: não tenho mais aulas terminando às 16h. Mas o sentimento que ela carregava está constantemente presente — a sensação de não estar suficientemente organizado e de estar completamente sozinho. O gatilho deixou de ser um horário e virou um estado de fundo. Considero este um dado importante para a distinção estrutural × circunstancial.

f) Sinto que estou "acinzentando". Ao construir recentemente o relatório de saúde do meu pai, eu o descrevi como alguém que foi ficando "cinza, anestesiado" com os anos — presente na sala, mas distante, com a atenção puxada pela próxima coisa a resolver. Preciso registrar, com honestidade, que reconheço o mesmo movimento em mim: sinto que estou "acinzentando". Quero que o senhor saiba disso em minhas próprias palavras, antes da consulta, e que este ponto entre no acompanhamento.

5. O que também é verdade

- Há manhãs, ainda nesta semana, em que acordei com o coração aberto — "que dia lindo" foi o primeiro pensamento de uma delas.
- Na maioria das noites o meu sono tem sido restaurador, com bons dados de REM e sonhos vívidos — a noite passada foi uma exceção ruim, registrada na seção 3.
- Estou produtivo: consultoria ativa, projeto na área de saúde em desenvolvimento, presença na rotina da família.
- Minha fé é um pilar ativo — mais forte do que as minhas emoções — e tenho me apoiado nela conscientemente.
- Tenho rede definida: o senhor, o Dr. Cleandro (que me disse para ligar a qualquer hora), meu pastor e meus pais.

6. O que gostaria de definir na consulta

- Manejo ativo da ideação no ajuste medicamentoso e no plano de acompanhamento.
- Conduta do desmame de diazepam na semana da cirurgia.
- Comunicação das doses reais e do uso recente de álcool à equipe anestésica.
- Como proceder com a medicação (diazepam, valproato, pregabalina, quetiapina, naltrexona) em dias de náusea ou vômito, como o de hoje.
- Distinção entre o que é estrutural (a tratar psiquiatricamente) e o que é circunstancial (luto e adaptação) — incluindo a solidão constante e o "acinzentamento" dos pontos (e) e (f).
- Leitura do ciclo choro → oração → sono restaurador.

7. Medicamentos em curso

- Depakote ER (divalproato): 1250 mg/dia
- Lyrica (pregabalina): 325 mg/dia
- Quetiapina: 50 mg/dia
- Valium (diazepam) — em desmame: 27,5 mg/dia
- Revia (naltrexona): 50 mg/dia

Doses conforme registro do paciente em 15/07/2026. Diazepam em desmame conduzido pelo Dr. Tischer; nenhuma alteração de dose é feita sem orientação.

Documento preparado pelo paciente como apoio à consulta; não substitui avaliação clínica. Em caso de crise ou piora: contato imediato com o psiquiatra assistente ou com o CVV — 188 (24 horas, gratuito).

Apêndice — As 18 perguntas do auto-exame

Perguntas de um exercício guiado de auto-exame realizado em 14 de julho de 2026, reproduzidas na íntegra e traduzidas a pedido do paciente. As respostas foram dadas oralmente e informam as seções deste relatório.

Sobre os pensamentos ("às vezes")
1. Quando você diz que tem pensamentos de acabar com a própria vida "às vezes" — com que frequência é esse "às vezes"? É diário? Semanal? É um pensamento passageiro ou tem peso — um plano, um método que você já considerou?
2. Ontem à noite você chorou por horas. No meio disso, o pensamento apareceu? Ou o próprio choro foi um alívio do pensamento?
3. Desde que você está sóbrio — nos últimos dias —, a frequência do pensamento aumentou, diminuiu ou permaneceu igual?

Sobre o álcool
4. Você disse 75% moderado, 25% mais pesado. O que dispara os 25%? É a janela das 16h? É estar sozinho? É depois de uma vitória? É luto? O que de fato precede?
5. Quando você bebe, você bebe em direção a algo (celebração, convívio) ou para longe de algo (dor, solidão, inquietação)?
6. Se você não pudesse beber nada nos próximos cinco dias antes da cirurgia — zero —, conseguiria? E como isso se sentiria?

Sobre o choro e a dor no peito
7. O choro que não para, a dor no peito, o coração que você sente nas mãos — isso está acontecendo todos os dias, ou aconteceu ontem e hoje você está refletindo sobre isso?
8. Quando acontece, você quer que pare — ou uma parte de você precisa que continue?
9. Existe um ponto em que o choro parece ter atravessado e se concluído, ou ele parece infinito?

Sobre estar na casa dos seus pais
10. Você diz que se sente "preso". É porque você quer sair e não pode? Ou porque tem medo de sair e está se convencendo de que está preso?
11. Seus pais — eles tratam você como um dependente, ou dão espaço e apoio? Há uma diferença, e ela importa.
12. Antes da cirurgia, você precisa estar em algum lugar — e a casa dos seus pais é, objetivamente, o lugar certo. Quando você diz "preso": você está de luto pela vida que tinha (o apartamento em São Paulo, a independência), ou está de fato inseguro onde está?

Estrutural × circunstancial
13. O choro, a dor no peito, o "às vezes", a inquietação — se você acordasse amanhã e tudo tivesse dado perfeitamente certo (cirurgia bem-sucedida, um bom contrato, os gatos de volta, alguém que amasse você), esses sintomas desapareceriam? Ou ainda estariam lá?
14. Em outras palavras: esses sintomas são sobre as suas circunstâncias, ou sobre a sua neurobiologia e traumas não processados?
15. Se forem circunstanciais, o tempo e as coisas boas tendem a curá-los; se forem estruturais, pedem intervenção psiquiátrica. Qual é o seu caso — e o que o seu médico precisa saber para tratar de acordo?

Sobre o estado atual
16. Quando você acordou hoje de manhã, antes do dia começar, qual foi o primeiro sentimento no seu corpo? Não um pensamento — um sentimento. O que o seu sistema nervoso disse?
17. Neste momento, lendo estas perguntas — você está na defensiva, ou aliviado por elas serem feitas com franqueza?
18. E, por fim: você quer de fato ficar bem — ou quer estar doente de um jeito que pareça bem-estar? São coisas diferentes, e você precisa saber qual está escolhendo.`;

const words = text.replace(/\s+/g, " ").trim().split(" ").length;
console.log(`Words           : ${words}`);
console.log(`Chars           : ${text.length}`);
console.log(`First 90 chars  : ${text.slice(0, 90)}…`);
console.log("");

const rows = await sql`select id, full_name from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;
console.log(`Patient         : ${rows[0].full_name} (${patientId})`);
if (!BLOB_KEY.startsWith(`uploads/${patientId}/`)) {
  console.error(`✗ BLOB_KEY namespace does not match patient id ${patientId}`);
  process.exit(1);
}

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
