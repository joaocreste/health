#!/usr/bin/env node
/**
 * One-page therapy-session handoff for Joao Victor Creste, addressed to his
 * psychiatrist Dr. Eduardo Tisher. Lumen-branded, single A4 sheet, Brazilian
 * Portuguese (consistent with build-joao-psychiatry-report.mjs and the recipient).
 *
 * Three blocks, per request:
 *   1. Pontos principais discutidos hoje
 *   2. Acoes a partir de agora
 *   3. Focos para a terapia
 *   + a clinician-directed risk callout (suicidality; factual, no method detail).
 *
 * Content sourced from the ingested session of 23 jun 2026 (therapist Ageu
 * Heringer Lisboa, CRP 06/9732) — themes, interventions, strengths/growth and the
 * risk flag persisted under migration 0020.
 *
 * Output: web/_report-joao-therapy-handoff.html -> render with render-report-pdf.mjs
 * Usage:  node scripts/build-joao-therapy-handoff.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "web");

const LUMEN_MARK = `<svg class="mark-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-label="Lumen Health">
  <g transform="translate(32,32) scale(1.1)">
    <path d="M 0 22 C -20 6, -28 -2, -20 -14 C -12 -22, -4 -18, 0 -10 C 4 -18, 12 -22, 20 -14 C 28 -2, 20 6, 0 22 Z" fill="rgba(36,78,110,0.08)" stroke="#244E6E" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M -36 0 L -22 0 L -16 4 L -10 -4 L -2 -16 L 6 14 L 12 -4 L 18 0 L 36 0" fill="none" stroke="#B8860B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
const PULSE_LINE = `<svg class="pulse-svg" viewBox="0 0 1000 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M0 24 H392 l9 0 l7 5 l7 -10 l8 -17 l9 38 l9 -28 l7 12 l8 0 H560 l7 4 l6 -6 l7 2 l8 0 H1000"
        fill="none" stroke="#B8860B" stroke-width="4.48" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const li = (lead, rest) => `<li><strong>${lead}</strong> ${rest}</li>`;

// 1 — Pontos principais discutidos hoje
const pontos = [
  li("Decisão cirúrgica.", "Revisou a remoção do tecido fibrótico na fronte; múltiplos especialistas convergiram de forma independente quanto ao procedimento e à prevenção de nova fibrose. Optou por operar em Ribeirão Preto, onde se sente mais amparado para a recuperação."),
  li("Relação com o pai e sistema familiar.", "Padrões recorrentes de controle, autossacrifício, hiper-responsabilidade e dificuldade de delegar; preocupação com a saúde física e emocional do pai e com o impacto dessas dinâmicas sobre toda a família."),
  li("Reações emocionais intensas em conflito familiar.", "Relatou períodos de desespero e pensamentos suicidas, reconhecendo ser importante levá-los aos seus profissionais de saúde. (Ver sinalização de risco abaixo.)"),
  li("Crença de que “a vida só avança após resolver o passado”.", "Começou a questionar se a resolução completa é mesmo pré-condição para novos relacionamentos, projetos e oportunidades."),
  li("Vocação.", "Desenvolvimento de uma empresa de health-tech que transforma dados de saúde fragmentados em insights apoiados por IA, para auxiliar — não substituir — os profissionais."),
  li("Espiritualidade e ritual familiar.", "Interesse em encontros familiares regulares de oração, gratidão e reflexão como apoio ao crescimento e à comunicação."),
];

// 2 — Acoes a partir de agora
const acoes = [
  li("Cirurgia em 8 de julho de 2026", "em Ribeirão Preto, com recuperação pós-operatória no local."),
  li("Foco no curto prazo até agosto", "— planejar passo a passo, sem tentar resolver todas as questões de longo prazo de uma vez."),
  li("Acompanhamento psiquiátrico do risco", "— avaliação de segurança ativa diante do relato de ideação suicida (ver abaixo)."),
  li("Conversas familiares estruturadas e práticas espirituais", "— iniciar encontros familiares de oração, gratidão e reflexão, visando comunicação mais saudável."),
  li("Continuidade da vocação", "— seguir com o desenvolvimento da plataforma de health-tech como fonte de propósito e agência."),
];

// 3 — Focos para a terapia
const focos = [
  li("Dinâmica com o pai e enredamento familiar", "— controle, autossacrifício e hiper-responsabilidade como roteiros herdados; trabalhar limites e diferenciação."),
  li("Ideação suicida e desespero em conflito", "— monitorar o registro de exaustão/desesperança; manter canal aberto de disclosure e segurança."),
  li("Crença “resolver o passado antes de viver”", "— flexibilizar a pré-condição que adia relacionamentos e projetos."),
  li("Hiper-responsabilidade e autossacrifício", "— sustentar a capacidade de delegar e de cuidar de si sem culpa."),
];

const CSS = `
:root{
  --navy:#0D1B2A; --slate:#1E2D3D; --fg2:#42505F; --gold:#B8954A; --muted:#7A8FA6;
  --petrol:#2F6489; --panel:#FBFAF7; --panel2:#F6F3ED; --bd:#E5E2DC; --bd2:#ECE8E0;
  --red:#C0392B; --redbg:#FBF1F0; --redbd:#E6C7C3; --redink:#9A3328;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:0}
html,body{background:#fff;color:var(--slate);font-family:'IBM Plex Sans',system-ui,sans-serif;font-weight:400}
.sheet{position:relative;width:210mm;min-height:297mm;padding:14mm 15mm 12mm;background:#fff}
strong{font-weight:600;color:var(--navy)}

/* header */
.hd{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:11px}
.mark-svg{width:38px;height:38px;display:block}
.word{display:flex;flex-direction:column;line-height:1;letter-spacing:.30em}
.word b{font-family:'Raleway',sans-serif;font-weight:600;font-size:13pt;color:var(--navy)}
.word span{font-weight:400;font-size:8pt;color:var(--muted);margin-top:4px}
.doc{text-align:right;font-family:'Raleway',sans-serif;font-size:12pt;color:var(--navy);font-weight:600;line-height:1.2}
.doc span{display:block;font-family:'IBM Plex Mono',monospace;font-size:7pt;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-top:5px;font-weight:500}
.rule-strong{height:2px;background:var(--navy);margin:11px 0 0}
.pulse{margin:9px 0 13px}
.pulse-svg{width:100%;height:20px;display:block;opacity:.85}

/* identity + meta */
.who{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:9px}
.who-name{font-family:'Raleway',sans-serif;font-size:17pt;font-weight:600;color:var(--navy);line-height:1.05}
.who-sub{font-size:9.5px;color:var(--muted);margin-top:3px}
.who-to{text-align:right;font-size:10px;color:var(--fg2);line-height:1.5}
.who-to b{color:var(--navy);font-weight:600}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:11px}
.pill{font-family:'IBM Plex Mono',monospace;font-size:8.5px;padding:3px 9px;border-radius:999px;background:var(--panel2);border:1px solid var(--bd);color:var(--fg2)}
.lead{font-size:10.5px;line-height:1.6;color:var(--fg2);margin-bottom:13px;padding-left:11px;border-left:2px solid var(--gold)}

/* sections */
.sec{margin-bottom:13px;break-inside:avoid}
.sec-label{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);margin-bottom:3px}
h2{font-family:'Raleway',sans-serif;font-weight:600;font-size:14pt;color:var(--navy);margin-bottom:7px;line-height:1.1}
ul{list-style:none}
ul li{position:relative;padding-left:15px;font-size:10px;line-height:1.5;color:var(--fg2);margin-bottom:6px}
ul li::before{content:'';position:absolute;left:0;top:6px;width:5px;height:5px;border-radius:50%;background:var(--petrol)}
.sec.actions ul li::before{background:var(--gold)}
.sec.therapy ul li::before{background:var(--petrol)}

/* risk */
.risk{background:var(--redbg);border:1px solid var(--redbd);border-left:3px solid var(--red);border-radius:8px;padding:10px 13px;margin:4px 0 13px}
.risk h4{font-family:'Raleway',sans-serif;font-weight:600;font-size:10.5px;color:var(--red);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.risk .tag{font-family:'IBM Plex Mono',monospace;font-size:8px;background:var(--red);color:#fff;padding:2px 7px;border-radius:999px;font-weight:500}
.risk p{font-size:9.7px;color:var(--redink);line-height:1.5;margin:0}

/* footer */
.foot{position:absolute;left:15mm;right:15mm;bottom:11mm;padding-top:8px;border-top:1px solid var(--bd2)}
.foot p{font-size:8px;line-height:1.6;color:var(--muted);margin:0}
.foot .conf{color:var(--gold);font-weight:500;margin-top:4px}
.foot .meta{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:7.5px;letter-spacing:.06em;color:var(--muted);margin-top:6px}
`;

const sheet = `<section class="sheet">
  <header class="hd">
    <div class="brand">${LUMEN_MARK}<span class="word"><b>LUMEN</b><span>HEALTH</span></span></div>
    <div class="doc">Resumo de sessão<span>Psicoterapia · handoff</span></div>
  </header>
  <div class="rule-strong"></div>
  <div class="pulse">${PULSE_LINE}</div>

  <div class="who">
    <div>
      <div class="who-name">João Victor Creste Dias de Souza</div>
      <div class="who-sub">17 de outubro de 1992 · 33 anos · masculino</div>
    </div>
    <div class="who-to">Para: <b>Dr. Eduardo Tisher</b><br>Psiquiatra assistente</div>
  </div>
  <div class="pills">
    <span class="pill">Sessão · 23 jun 2026</span>
    <span class="pill">Ageu Heringer Lisboa · CRP 06/9732</span>
    <span class="pill">Individual · rotina</span>
  </div>
  <p class="lead">Síntese da sessão de psicoterapia mais recente para acompanhamento conjunto: os pontos discutidos, as ações combinadas a partir de agora e os focos a serem trabalhados em terapia.</p>

  <div class="sec">
    <div class="sec-label">01</div>
    <h2>Pontos principais discutidos hoje</h2>
    <ul>${pontos.join("")}</ul>
  </div>

  <div class="risk">
    <h4><span class="tag">SINALIZAÇÃO DE RISCO</span> requer avaliação de segurança</h4>
    <p>Suicidalidade — gravidade moderada. Relato retrospectivo de desespero e pensamentos suicidas em conflitos familiares; sem plano, intenção ou meio declarados. O próprio paciente reconheceu a importância de levar isso aos seus profissionais de saúde. Recomenda-se avaliação de segurança e acompanhamento psiquiátrico ativos.</p>
  </div>

  <div class="sec actions">
    <div class="sec-label">02</div>
    <h2>Ações a partir de agora</h2>
    <ul>${acoes.join("")}</ul>
  </div>

  <div class="sec therapy">
    <div class="sec-label">03</div>
    <h2>Focos para a terapia</h2>
    <ul>${focos.join("")}</ul>
  </div>

  <div class="foot">
    <p>Documento gerado pela plataforma Lumen Health a partir da sessão de psicoterapia registrada. A síntese clínica é apoiada por IA e <strong>não constitui diagnóstico</strong>; decisões sobre conduta e medicação competem ao psiquiatra assistente. Decisões sobre benzodiazepínicos competem exclusivamente ao prescritor.</p>
    <p class="conf">Confidencial · contém dados pessoais sensíveis de saúde</p>
    <div class="meta"><span>Lumen Health · Resumo de sessão</span><span>João Victor Creste · emissão 25-06-2026</span></div>
  </div>
</section>`;

const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<title>Resumo de sessão — João Victor Creste</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body>${sheet}</body></html>`;

const outPath = path.join(webDir, "_report-joao-therapy-handoff.html");
fs.writeFileSync(outPath, html);
console.log("✓ wrote", path.relative(root, outPath), `(${(html.length / 1024).toFixed(0)} KB)`);
