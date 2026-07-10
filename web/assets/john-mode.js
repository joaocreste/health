/* Lumen Health — john-mode.js
 *
 * John Smith Jr is a FULL 1:1 mirror of Patient Zero (Joao Victor Creste).
 * His Postgres record is an exact clone of Joao's (see
 * scripts/clone-joao-to-john.mjs) — same labs, vitals, imaging, ECG,
 * genetics, therapy, psych and AI insights. Rather than duplicate every
 * static HTML page, this script runs as a DOM-level transformer on every
 * static page when the active patient is John. Unlike leo-mode.js there is
 * NO hiding or clinical scrubbing — the only changes are cosmetic identity:
 *
 *   1. Force Portuguese (John's language is pt; locale BR).
 *   2. Swap demographic strings in text nodes:
 *        Joao / João                → John
 *        Joao Victor Creste ...     → John Smith Jr
 *        London / Londres           → São Paulo   (GB → BR, for locale coherence)
 *        United Kingdom / Reino Unido → Brasil
 *   3. Rewrite <title> (lives in <head>, not walked by the body pass).
 *
 * DOB, age and all clinical content are copied verbatim from Patient Zero.
 * Idempotent: re-running has no effect (John → John is a no-op).
 */
(function () {
  'use strict';

  var JOHN_CLERK = 'pending:john-smith-jr-9d4e21';

  // Detect the active patient. Mirrors patient-context.js resolution.
  var params = new URLSearchParams(location.search);
  var fromUrl = params.get('patient');
  var stored = sessionStorage.getItem('jc_current_patient');
  var patient = fromUrl || stored;
  if (patient !== JOHN_CLERK) return;

  // ─── 1. Force Portuguese ────────────────────────────────────────
  // Set both the live attribute and the persisted preference so app.js's
  // initI18n keeps pt across navigation. The .lang-btn toggle still works
  // within a page; each fresh load re-defaults to pt.
  try { localStorage.setItem('jc_lang', 'pt'); } catch (_) {}
  document.documentElement.setAttribute('lang', 'pt');

  // ─── 2. Demographic text replacements ───────────────────────────
  // Order matters: longest name variants first so we never half-replace.
  var REPLACEMENTS = [
    [/Joao Victor Creste Dias de Souza/g, 'John Smith Jr'],
    [/João Victor Creste Dias de Souza/g, 'John Smith Jr'],
    [/Joao Victor Creste/g, 'John Smith Jr'],
    [/João Victor Creste/g, 'John Smith Jr'],
    [/\bJoao Creste\b/g, 'John Smith Jr'],
    [/\bJoão Creste\b/g, 'John Smith Jr'],
    [/\bJoao\b/g, 'John'],
    [/\bJoão\b/g, 'John'],
    [/\bDias de Souza\b/g, 'Smith'],

    // Residence — Patient Zero shows London/GB; John's locale is BR.
    [/\bLondon\b/g, 'São Paulo'],
    [/\bLondres\b/g, 'São Paulo'],
    [/\bUnited Kingdom\b/g, 'Brasil'],
    [/\bReino Unido\b/g, 'Brasil'],

    // Report identifiers (MRN / accession / visit / registration numbers) -> synthetic
    [/\b3402824\b/g, '4815162'],
    [/\b3129863\b/g, '2718281'],
    [/\b190830993\b/g, '180550001'],
    [/\b190824100\b/g, '180550002'],
    [/\bE25873959\b/g, 'E31415926'],
    [/\b32088962\/12\b/g, '55110234/12'],
    [/\b4647288\b/g, '5912604'],
    [/\b17723927\b/g, '18904412'],
    [/\b117134640\b/g, '119220555'],
    [/\bNV1X01005196090\b/g, 'NV1X01009999001'],
    [/\bAE23-016535\b/g, 'AE23-099001'],
    [/\b30099223397\b/g, '30011122233'],
    [/\b96425\b/g, '90001'],
    [/\b220106\b/g, '90002'],
    [/\b99607\b/g, '90003'],
    [/\b157890\b/g, '90004'],
    [/\b7096445\b/g, '7000001'],
    [/\b54911\b/g, '90005'],
    [/\b93948\b/g, '90006'],
    [/\b75340\b/g, '90007'],
    [/\b185087\b/g, '90008'],
    [/\b96\.083\b/g, '90.009'],
    [/\b168889\b/g, '90010'],
    [/\b150803\b/g, '90011'],
    [/\b90\.835\b/g, '90.012'],
    [/\b120785\b/g, '90013'],
    [/\b230127\b/g, '90014'],
    [/\b90787\b/g, '90015'],
    [/\b06\/9732\b/g, '06/0001'],
  ];

  function walkText(node) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      var changed = false;
      for (var i = 0; i < REPLACEMENTS.length; i++) {
        var pair = REPLACEMENTS[i];
        pair[0].lastIndex = 0;
        if (pair[0].test(t)) {
          pair[0].lastIndex = 0;
          t = t.replace(pair[0], pair[1]);
          changed = true;
        }
      }
      if (changed) node.nodeValue = t;
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    for (var c = node.firstChild; c; c = c.nextSibling) walkText(c);
  }

  function rewriteTitle() {
    if (!document.title) return;
    document.title = document.title
      .replace(/Joao Victor Creste/g, 'John Smith Jr')
      .replace(/João Victor Creste/g, 'John Smith Jr')
      .replace(/Joao/g, 'John')
      .replace(/João/g, 'John')
      .replace(/London/g, 'São Paulo');
  }

  function run() {
    walkText(document.body);
    rewriteTitle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  // Second pass to catch any content injected asynchronously after
  // DOMContentLoaded (e.g. data.js renders, DB-driven decorators). Idempotent.
  setTimeout(run, 900);
  setTimeout(run, 2000);
})();
