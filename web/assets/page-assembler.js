/* ── Lumen Health · Page Assembler ────────────────────────────────────────
   ONE function owns the page sequence for every non-static-bespoke patient
   page (FRONTEND-CONTRACT.md §1):

     1. HERO            identity strictly from /api/patient-summary (nullable-
                        safe: missing fields are omitted, never "—")
     2. CONCISE AI      registry entry flagged summary:true (gate G-DASH /
        SUMMARY         G-DOMAIN) — purple AI pill + one legend line under the
                        first AI-badged block on the page (D2)
     3. TOPIC SECTIONS  registry order; failing gate emits NOTHING (I-5)
     4. EMPTY-STATE     only when zero topic sections rendered
     5. TAIL            Upload → Update-AI-Insights → Delete (home only, D3)
     6. FOOTER          one shared bilingual footer on every patient page

   Section content comes from provider functions registered by
   patient-context.js on window.LUMEN_PROVIDERS. A provider receives
   ctx = { patient, page, payloads, entry, shared } and returns an Element,
   an HTML string, { el|html, after:fn }, or null (renders nothing).
   `after` hooks run once the whole page is in the DOM (charts, viewers).

   This file is generic: no patient ids, no per-patient branches (I-2).     */
(function () {
  'use strict';

  /* ── bilingual helpers (same conventions as patient-context.js) ── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function t(en, pt) {
    return '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span>';
  }
  function tPlain(en, pt) {
    var l = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
    return l === 'pt' ? pt : en;
  }

  var MONTHS_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_PT_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
    'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  /* Locale-formatted short date, EN '17 Oct 1992' / PT '17 out 1992'.
     ISO day kept verbatim (already zero-padded, matching the design file). */
  function dateShort(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var mo = parseInt(m[2], 10) - 1;
    if (mo < 0 || mo > 11) return null;
    return { en: m[3] + ' ' + MONTHS_EN_SHORT[mo] + ' ' + m[1], pt: m[3] + ' ' + MONTHS_PT_SHORT[mo] + ' ' + m[1] };
  }
  /* Full years elapsed since DOB — calendar comparison, no ms-division
     birthday bugs: subtract a year until the birthday has passed this year. */
  function ageFromDob(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    var now = new Date();
    var age = now.getFullYear() - y;
    if ((now.getMonth() + 1) < mo || ((now.getMonth() + 1) === mo && now.getDate() < d)) age--;
    return (age >= 0 && age < 150) ? age : null;
  }

  /* ── gate predicate library (contract §2) ── */
  function resolvePath(payloads, path) {
    var parts = String(path || '').split('.');
    var results = [payloads];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i], next = [];
      results.forEach(function (obj) {
        if (obj == null) return;
        if (seg === '*') {
          Object.keys(obj).forEach(function (k) { next.push(obj[k]); });
        } else if (Object.prototype.hasOwnProperty.call(obj, seg)) {
          next.push(obj[seg]);
        }
      });
      results = next;
      if (!results.length) return [];
    }
    return results;
  }
  function aiInsightsSection(payloads) {
    var d = payloads && payloads.dashboard;
    return (d && d.sections && d.sections['ai-insights']) || null;
  }
  function aiCards(payloads) {
    var s = aiInsightsSection(payloads);
    return (s && s.cards_json) || null;
  }
  var GATES = {
    'G-DASH': function (payloads) { return !!aiInsightsSection(payloads); },
    'G-DOMAIN': function (payloads, args) {
      var cards = aiCards(payloads);
      var d = args && args[0];
      return !!(cards && cards.pages && cards.pages[d] && cards.pages[d].data_sufficient === true);
    },
    'G-ARR': function (payloads, args) {
      return (args || []).some(function (p) {
        return resolvePath(payloads, p).some(function (v) { return Array.isArray(v) && v.length > 0; });
      });
    },
    'G-NUM': function (payloads, args) {
      return (args || []).some(function (p) {
        return resolvePath(payloads, p).some(function (v) { return v != null && Number(v) > 0; });
      });
    },
    'PATIENT': function (payloads, args, ctx) {
      return !!(ctx.entry.patientScope && ctx.patient === ctx.entry.patientScope);
    },
  };
  function gatePasses(entry, payloads, ctx) {
    /* patientScope is enforced regardless of the declared gate fn. */
    if (entry.patientScope && ctx.patient !== entry.patientScope) return false;
    var g = entry.gate || {};
    var fn = GATES[g.fn];
    if (!fn) return false; // unknown gate → fail closed
    try { return !!fn(payloads, g.args || [], ctx); } catch (_) { return false; }
  }

  /* ── assembler chrome styles ── */
  function injectAssemblerStyles() {
    if (document.getElementById('lumen-assembler-styles')) return;
    var s = document.createElement('style');
    s.id = 'lumen-assembler-styles';
    s.textContent =
      '.lumen-page-root{display:block;}' +
      '.lumen-topics{display:block;}' +
      '.lumen-ai-legend{max-width:880px;margin:6px auto 18px;padding:0 22px;font-family:"IBM Plex Mono",monospace;' +
        'font-size:11px;letter-spacing:.03em;color:var(--text-muted,#6E7B8A);}' +
      '.lumen-empty{max-width:720px;margin:56px auto;padding:0 22px;text-align:center;}' +
      '.lumen-empty p{font-size:15px;line-height:1.6;color:var(--text-secondary,#3E4956);margin:0;}' +
      '.lumen-tail{max-width:1080px;margin:40px auto 24px;padding:0 22px;}' +
      '.lumen-tail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:stretch;}' +
      '.lumen-tail-grid > *{max-width:none;margin:0;height:100%;}' +
      '.lumen-tail-grid .uc-wrap,.lumen-tail-grid .iu-wrap,.lumen-tail-grid .jc-danger-zone{max-width:none;margin:0;padding:0;height:100%;}' +
      '.lumen-tail-grid .uc-card,.lumen-tail-grid .iu-card,.lumen-tail-grid .jc-danger-card{height:100%;}' +
      '.lumen-footnote{max-width:880px;margin:28px auto 4px;padding:0 22px;font-family:"IBM Plex Mono",monospace;' +
        'font-size:11px;letter-spacing:.04em;color:var(--text-muted,#6E7B8A);text-align:center;}' +
      /* keep the assembler root clear of the fixed side rail on shells that have one */
      'body.has-side-nav > .lumen-page-root{margin-left:var(--side-nav-w,240px);}' +
      '@media(max-width:880px){body.has-side-nav > .lumen-page-root{margin-left:0;}}';
    document.head.appendChild(s);
  }

  /* ── hero (slot 1) ── */
  function newestGeneratedAt(payloads) {
    var d = payloads && payloads.dashboard;
    var newest = null;
    if (d && d.sections) {
      Object.keys(d.sections).forEach(function (k) {
        var g = d.sections[k] && d.sections[k].generated_at;
        if (g && (!newest || g > newest)) newest = g;
      });
    }
    return newest;
  }
  /* Pillar crumb: subpage pillar strings carry the middot ('PHYSICAL · VITALS');
     split and rejoin so each separator renders as a gold .crumb-sep span. */
  function crumbHtml(pillarStr) {
    return String(pillarStr).split('·').map(function (s) { return esc(s.trim()); })
      .join('<span class="crumb-sep">·</span>');
  }
  function bannerIdItem(labelEn, labelPt, valueHtml, extraClass) {
    return '<div class="id-item' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="id-label">' + t(labelEn, labelPt) + '</div>' +
      '<div class="id-value">' + valueHtml + '</div></div>';
  }
  /* The unified page banner (prompt #2b): breadcrumb → title → description →
     identity strip. Identity strictly from /api/patient-summary (I-3);
     absent fields are omitted entirely — no dashes, no placeholders. */
  function renderPageBanner(summary, pageMeta, generatedAt) {
    var meta = pageMeta || {};
    var p = (summary && summary.patient) || {};
    var crumb = meta.pillar ? t(crumbHtml(meta.pillar.en), crumbHtml(meta.pillar.pt)) : '';
    var title = meta.title ? t(esc(meta.title.en), esc(meta.title.pt)) : '';
    var desc = meta.description ? t(esc(meta.description.en), esc(meta.description.pt)) : '';

    var items = '';
    if (p.full_name) items += bannerIdItem('Patient', 'Paciente', esc(p.full_name), 'id-item--patient');
    var dob = dateShort(p.date_of_birth);
    if (dob) {
      var age = ageFromDob(p.date_of_birth);
      items += bannerIdItem('Born', 'Nascimento',
        '<span class="lang-en">' + dob.en + (age != null ? ' <span class="id-soft">· ' + age + 'y</span>' : '') + '</span>' +
        '<span class="lang-pt">' + dob.pt + (age != null ? ' <span class="id-soft">· ' + age + 'a</span>' : '') + '</span>');
    }
    if (p.country_of_residence) items += bannerIdItem('Locale', 'Local', esc(p.country_of_residence));
    var prep = dateShort(generatedAt);
    if (prep) items += bannerIdItem('Prepared', 'Preparado',
      '<span class="lang-en">' + prep.en + '</span><span class="lang-pt">' + prep.pt + '</span>');

    /* <header>, not <section>: on the static shells the banner replaces a
       <header> element in place, and section.report-section zebra striping
       keys on nth-of-type — a <section> here would flip that parity. */
    return '<header class="page-banner"><div class="banner-inner">' +
      (crumb ? '<p class="banner-crumb">' + crumb + '</p>' : '') +
      (title ? '<h1 class="banner-title">' + title + '</h1>' : '') +
      (desc ? '<p class="banner-desc">' + desc + '</p>' : '') +
      (items ? '<div class="banner-identity">' + items + '</div>' : '') +
    '</div></header>';
  }

  /* ── legend (D2): one line under the FIRST AI-badged block per page ── */
  function aiLegendEl() {
    var el = document.createElement('p');
    el.className = 'lumen-ai-legend';
    el.innerHTML = t('AI = AI-generated synthesis, not patient data.',
                     'IA = síntese gerada por IA, não dados do paciente.');
    return el;
  }
  function ensureAiLegend(scope) {
    injectAssemblerStyles();
    var rootEl = scope || document;
    if (rootEl.querySelector('.lumen-ai-legend') || document.querySelector('.lumen-ai-legend')) return;
    var pills = rootEl.querySelectorAll('.ai-pill');
    for (var i = 0; i < pills.length; i++) {
      if (pills[i].closest('.lumen-ai-legend')) continue;
      var block = pills[i].closest('section, .report-section, .ai-ins-block, .archetype-card, header, .ov-ai-summary, .lumen-slot-summary') ||
                  pills[i].parentElement;
      if (!block || !block.parentNode) continue;
      block.parentNode.insertBefore(aiLegendEl(), block.nextSibling);
      return;
    }
  }

  /* ── empty state (slot 4) ── */
  function buildEmptyState() {
    var el = document.createElement('section');
    el.className = 'lumen-empty';
    el.innerHTML = '<p>' +
      t('Nothing on record for this page yet. Use the Upload card below to add exams, vitals or documents.',
        'Ainda não há dados registrados nesta página. Use o cartão Enviar dados abaixo para adicionar exames, sinais vitais ou documentos.') +
      '</p>';
    return el;
  }

  /* ── tail (slot 5): Upload → Update-AI-Insights → Delete (home only, D3) ── */
  function buildTail(patient, page) {
    injectAssemblerStyles();
    var tail = document.createElement('section');
    tail.className = 'lumen-tail';
    var grid = document.createElement('div');
    grid.className = 'lumen-tail-grid';
    tail.appendChild(grid);
    try {
      if (typeof window.jcBuildUploadCard === 'function') {
        var up = window.jcBuildUploadCard();
        if (up) grid.appendChild(up);
      }
    } catch (e) { console.error('[lumen tail] upload card', e); }
    try {
      if (typeof window.jcBuildInsightsUpdateCard === 'function') {
        var iu = window.jcBuildInsightsUpdateCard();
        if (iu) grid.appendChild(iu);
      }
    } catch (e) { console.error('[lumen tail] insights card', e); }
    if (page === 'home') {
      try {
        if (typeof window.jcBuildDangerZone === 'function') {
          var dz = window.jcBuildDangerZone();
          if (dz) grid.appendChild(dz);
        }
      } catch (e) { console.error('[lumen tail] danger zone', e); }
    }
    return grid.children.length ? tail : null;
  }

  /* ── footer (slot 6): one shared bilingual footer ── */
  function buildFooter() {
    var f = document.createElement('footer');
    f.className = 'doc-footer';
    f.innerHTML =
      '<div class="footer-brand"><img src="assets/logo.svg" alt="">' +
        '<span>Lumen Health · ' + t('From data to insights', 'Dos dados aos insights') + '</span></div>' +
      '<div>' + t('Strictly confidential · For clinical communication only · Does not replace licensed medical advice.',
                  'Estritamente confidencial · Apenas para comunicação clínica · Não substitui aconselhamento médico licenciado.') + '</div>';
    return f;
  }

  /* ── payload fetching ── */
  function getJson(url, headers) {
    return fetch(url, { headers: headers || { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function fetchPayloads(patient, page) {
    var q = 'clerk=' + encodeURIComponent(patient);
    var jobs = {
      summary: getJson('/api/patient-summary?' + q),
      dashboard: getJson('/api/patient-dashboard?' + q),
    };
    if (page === 'physical-exams') jobs.exams = getJson('/api/patient-exams?' + q);
    if (page === 'mental') jobs.psych = getJson('/api/patient-psych?' + q);
    if (page === 'physical-vitals') {
      var viewer = '';
      try { viewer = sessionStorage.getItem('jc_viewer_clerk') || ''; } catch (_) {}
      var today = new Date().toISOString().slice(0, 10);
      jobs.vitals = getJson('/api/vitals-range?' + q + '&from=2015-01-01&to=' + today,
        viewer ? { 'X-Viewer-Clerk': viewer, Accept: 'application/json' } : { Accept: 'application/json' });
    }
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (vals) {
      var out = {};
      keys.forEach(function (k, i) { out[k] = vals[i]; });
      return out;
    });
  }

  /* ── the assembler itself ── */
  function normalizeResult(res) {
    if (res == null) return null;
    if (typeof res === 'string') {
      if (!res.trim()) return null;
      var wrap = document.createElement('div');
      wrap.innerHTML = res;
      return { el: wrap, after: null };
    }
    if (res.nodeType === 1) return { el: res, after: null };
    if (typeof res === 'object') {
      var el = res.el || null;
      if (!el && res.html) {
        if (!String(res.html).trim()) return null;
        el = document.createElement('div');
        el.innerHTML = res.html;
      }
      if (!el) return null;
      return { el: el, after: (typeof res.after === 'function' ? res.after : null) };
    }
    return null;
  }

  function assemblePage(patient, page, payloads) {
    injectAssemblerStyles();
    var registry = (window.LUMEN_REGISTRY || {})[page] || [];
    var providers = window.LUMEN_PROVIDERS || {};
    var meta = (window.LUMEN_PAGE_META || {})[page] || {};

    /* document.title from page meta + patient name (I-7: localizes). */
    var p = (payloads.summary && payloads.summary.patient) || {};
    var pageTitle = meta.title ? tPlain(meta.title.en, meta.title.pt) : (page === 'home' ? tPlain('Health Summary', 'Resumo de saúde') : page);
    document.title = 'Lumen Health — ' + pageTitle + (p.full_name ? ' · ' + p.full_name : '');

    var root = document.createElement('main');
    root.className = 'lumen-page-root jc-overview' + (page === 'home' ? ' jc-home' : '');

    /* 1 · hero — the unified page banner */
    var heroWrap = document.createElement('div');
    heroWrap.className = 'lumen-hero';
    heroWrap.innerHTML = renderPageBanner(payloads.summary, meta, newestGeneratedAt(payloads));
    root.appendChild(heroWrap);

    /* 2+3 · concise AI summary, then topic sections, in registry order.
       Non-home pages wrap topics in .ov-shell so the existing overview CSS
       (max-width, padding) applies; home sections are full-bleed
       .report-section blocks and manage their own containers. */
    var topics = document.createElement('div');
    topics.className = 'lumen-topics' + (page === 'home' ? '' : ' ov-shell');
    root.appendChild(topics);

    var afters = [];
    var topicCount = 0;
    var summaryCount = 0;
    var shared = {}; // per-render scratch shared across providers (memoized computations)
    registry.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); })
      .forEach(function (entry) {
        var ctx = { patient: patient, page: page, payloads: payloads, entry: entry, shared: shared };
        if (!gatePasses(entry, payloads, ctx)) return;
        var provider = providers[entry.provider];
        if (typeof provider !== 'function') return; // no provider registered → nothing (fail closed)
        var out;
        try { out = normalizeResult(provider(ctx)); }
        catch (e) { console.error('[lumen assemble] provider ' + entry.provider + ' (' + entry.id + ')', e); return; }
        if (!out) return;
        out.el.setAttribute('data-lumen-section', entry.id);
        if (entry.summary) out.el.classList.add('lumen-slot-summary');
        topics.appendChild(out.el);
        if (out.after) afters.push(out.after);
        if (!entry.summary) topicCount++;
        else summaryCount++;
      });

    /* 4 · empty state — only when NOTHING rendered. Its copy claims nothing
       is on record; below a data-backed AI summary (prompt #2c guarantees one
       whenever the domain has data) that claim would be false. */
    if (topicCount === 0 && summaryCount === 0) root.appendChild(buildEmptyState());

    /* registry-driven footnote (spiritual pastoral line) */
    if (meta.footnote) {
      var fn = document.createElement('p');
      fn.className = 'lumen-footnote';
      fn.innerHTML = t(esc(meta.footnote.en), esc(meta.footnote.pt));
      root.appendChild(fn);
    }

    /* 5 · tail */
    var tail = buildTail(patient, page);
    if (tail) root.appendChild(tail);

    /* 6 · footer */
    root.appendChild(buildFooter());

    document.body.appendChild(root);

    /* post-mount hooks (charts, viewers) */
    afters.forEach(function (fn) {
      try { fn(root); } catch (e) { console.error('[lumen assemble] after-hook', e); }
    });

    /* D2: one legend line under the first AI-badged block */
    ensureAiLegend(root);

    return root;
  }

  function assemble(patient, page) {
    return fetchPayloads(patient, page).then(function (payloads) {
      return assemblePage(patient, page, payloads);
    });
  }

  window.LUMEN_ASSEMBLER = {
    assemble: assemble,
    assemblePage: assemblePage,
    fetchPayloads: fetchPayloads,
    gates: GATES,
    gatePasses: gatePasses,
    buildTail: buildTail,
    buildFooter: buildFooter,
    ensureAiLegend: ensureAiLegend,
    renderPageBanner: renderPageBanner,
    newestGeneratedAt: newestGeneratedAt,
    t: t,
    tPlain: tPlain,
    esc: esc,
  };
})();
