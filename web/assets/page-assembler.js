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
  function isSelfOrAdminViewer(patient) {
    var viewer = '', role = '';
    try {
      viewer = sessionStorage.getItem('jc_viewer_clerk') || '';
      role = sessionStorage.getItem('jc_viewer_role') || '';
    } catch (_) {}
    return role === 'admin' || !viewer || viewer === patient;
  }
  /* Per-entry bespoke coverage: a generic DB-driven section is suppressed
     only when the bespoke renderer actually covers that content FOR THIS
     VIEWER. Paulo's bespoke exams inline both imaging and labs (always
     covered). Silvana/Cristina's bespoke pages cover labs only — their
     curated self/admin view deliberately omits the DB imaging cards
     (commit 7039b7d9), but a GRANTED viewer with the imaging scope must
     get the generic scope-filtered imaging section or their grant renders
     nothing. Laboratory coverage keys on the worker-gated labs global:
     absent (403 = scope denied) means the generic section is the viewer's
     only surface. */
  var BESPOKE_COVERS = {
    'pending:paulo-silotto-df3441': {
      imaging: function () { return true; },
      laboratory: function () { return true; },
    },
    'pending:silvana-creste-18ba19': {
      imaging: function (patient) { return isSelfOrAdminViewer(patient); },
      laboratory: function () { return !!window.SILVANA_LABS; },
    },
    'pending:cristina-cresti-d7479c': {
      imaging: function (patient) { return isSelfOrAdminViewer(patient); },
      laboratory: function () { return !!window.CRISTINA_LABS; },
    },
  };
  function gatePasses(entry, payloads, ctx) {
    /* patientScope is enforced regardless of the declared gate fn. */
    if (entry.patientScope && ctx.patient !== entry.patientScope) return false;
    /* excludeScopes: a generic section a bespoke renderer already covers is
       suppressed for those patients — unless BESPOKE_COVERS says this entry's
       content is NOT covered for this viewer (scope-denied bespoke data), in
       which case the generic section is the scope-filtered fallback. */
    if (entry.excludeScopes && entry.excludeScopes.indexOf(ctx.patient) >= 0) {
      var covers = BESPOKE_COVERS[ctx.patient];
      var fn = covers && covers[entry.id];
      if (!fn || fn(ctx.patient)) return false;
    }
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
      '@media(max-width:880px){body.has-side-nav > .lumen-page-root{margin-left:0;}}' +
      /* ── scalable-machine chrome (assembler-owned) ──
         Light-blue canvas replaces the warm .jc-overview #F9F7F4; a dark-blue
         left rail in the banner colour is generated from the rendered sections.
         Applies to every assembler-rendered page — no per-patient rules. */
      'body.lumen-assembled{background:var(--blue-50,#EBF2F8);}' +
      'body.lumen-assembled > .lumen-page-root{background:var(--blue-50,#EBF2F8);}' +
      /* bespoke providers wrap their output in a page-canvas wrapper that paints
         over the blue root — .jc-paulo-mental / .jc-home-dash-wrap are literal
         cream (#F9F7F4), the exam wrappers cool near-white. Make them all
         transparent so the one light-blue canvas shows uniformly; the section
         cards keep their own surfaces. Intentional warm AI cards are untouched. */
      'body.lumen-assembled .jc-paulo-exams,' +
        'body.lumen-assembled .jc-silvana-exams,' +
        'body.lumen-assembled .jc-paulo-mental,' +
        'body.lumen-assembled .jc-home-dash-wrap{background:transparent;}' +
      'body.lumen-has-rail > .lumen-page-root{margin-left:var(--side-nav-w,240px);}' +
      /* the banner full-bleeds left (-24px) out of the overview padding; with the
         rail present, page-root sits at margin-left:240px, so that same -24px
         lands the band's left edge flush on the rail's right edge (no gap, no
         poke-under). banner-inner's padding-left:24px keeps the text inset from
         the seam. (Zeroing this left a 24px light-blue strip between rail+band.) */
      'body.lumen-has-rail .lumen-page-root.jc-overview:not(.jc-home) > .lumen-hero{margin-left:-24px;}' +
      'body.lumen-has-rail .lumen-page-root .banner-inner,' +
        'body.lumen-has-rail .lumen-page-root .lumen-ai-legend,' +
        'body.lumen-has-rail .lumen-page-root .lumen-tail{padding-left:24px;}' +
      '.lumen-page-root .report-section[id],.lumen-page-root [data-lumen-section]{scroll-margin-top:calc(var(--topnav-h,60px) + 16px);}' +
      /* safety net: a chart that did not re-fit to the narrowed column scrolls
         inside its own box, never forcing page-level horizontal scroll. */
      'body.lumen-has-rail .chart-wrap{max-width:100%;overflow-x:auto;}' +
      '.lumen-side-nav{position:fixed;left:0;top:var(--topnav-h,60px);bottom:0;width:var(--side-nav-w,240px);' +
        'background:var(--surface-dark-base,#0A1428);border-right:1px solid rgba(255,255,255,0.06);' +
        'box-shadow:2px 0 8px rgba(0,0,0,0.10);padding:22px 12px 24px;overflow-y:auto;overflow-x:hidden;z-index:30;}' +
      '.lumen-side-nav-title{padding:0 12px 12px;margin-bottom:8px;font-family:var(--font-mono,monospace);' +
        'font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.36);' +
        'border-bottom:1px solid rgba(255,255,255,0.08);}' +
      '.lumen-side-nav a{display:block;padding:9px 12px;border-radius:6px;color:rgba(255,255,255,0.66);' +
        'font-family:var(--font-mono,monospace);font-size:11px;font-weight:500;letter-spacing:0.09em;' +
        'text-transform:uppercase;text-decoration:none;line-height:1.4;transition:background .15s,color .15s;}' +
      '.lumen-side-nav a + a{margin-top:2px;}' +
      '.lumen-side-nav a:hover{background:rgba(255,255,255,0.06);color:#fff;}' +
      '.lumen-side-nav a.active{background:rgba(94,151,188,0.20);color:#fff;' +
        'border-left:3px solid var(--blue-400,#5E97BC);padding-left:9px;}' +
      '@media(max-width:880px){' +
        'body.lumen-has-rail > .lumen-page-root{margin-left:0;}' +
        '.lumen-side-nav{position:static;left:auto;top:auto;bottom:auto;width:auto;height:auto;' +
          'display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:10px 14px;white-space:nowrap;' +
          'border-right:none;box-shadow:none;margin:0 0 8px;border-radius:8px;}' +
        '.lumen-side-nav-title{display:none;}' +
        '.lumen-side-nav a{padding:6px 10px;border-radius:14px;background:rgba(255,255,255,0.06);' +
          'flex:0 0 auto;}' +
        '.lumen-side-nav a + a{margin-top:0;}' +
      '}';
    document.head.appendChild(s);
  }

  /* ── assembler-built left rail (scalable chrome) ──
     Generated from the sections the page actually rendered — no patient
     branches (I-2). Each top-level section contributes either its own nav
     entry (generic providers) or one entry per inner .report-section[id]
     (bespoke providers that pack many studies into a single output, e.g.
     Paulo's exams). Labels reuse each section's own bilingual heading, so
     the rail is bilingual by construction (I-7). Rendered only when ≥2
     targets exist — a one-item rail is noise. */
  function railIsVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }
  /* "5 · Imagery · Spine MRI" → "Spine MRI": drop the (out-of-order) ordinal
     prefix and keep the most specific segment, so the rail reads cleanly. */
  function railShorten(text) {
    var s = String(text == null ? '' : text).trim();
    s = s.replace(/^\s*\d+\s*[·.–—\-]\s*/, '');
    var parts = s.split('·');
    if (parts.length > 1) s = parts[parts.length - 1].trim();
    return s;
  }
  /* Shorten one heading element into { html (bilingual), key (en text) }. */
  function railShortenNode(src) {
    if (!src) return null;
    var enS = src.querySelector('.lang-en'), ptS = src.querySelector('.lang-pt');
    if (enS || ptS) {
      var en = railShorten(enS ? enS.textContent : (ptS ? ptS.textContent : ''));
      var pt = railShorten(ptS ? ptS.textContent : (enS ? enS.textContent : ''));
      if (!en && !pt) return null;
      return { html: t(esc(en || pt), esc(pt || en)), key: (en || pt).toLowerCase() };
    }
    var flat = railShorten(src.textContent);
    return flat ? { html: esc(flat), key: flat.toLowerCase() } : null;
  }
  /* Primary label from .section-label (distinctive for imaging: "Spine MRI"),
     plus an alternate from .section-title used only to break ties — BIA rows
     all share the generic label "Analysis" but carry distinct titles
     ("Muscle-fat analysis", "Obesity analysis", ...). */
  function railLabelOptions(el) {
    var labelNode = railShortenNode(el.querySelector('.section-label'));
    var titleNode = railShortenNode(el.querySelector('.section-title') || el.querySelector('h2'));
    return { primary: labelNode || titleNode, alt: titleNode };
  }
  function collectRailTargets(root, titleById) {
    var raw = [];
    var topics = root.querySelector('.lumen-topics');
    if (!topics) return [];
    var secs = topics.children;
    for (var i = 0; i < secs.length; i++) {
      var secEl = secs[i];
      var id = secEl.getAttribute('data-lumen-section') || '';
      var inner = secEl.querySelectorAll(':scope > .report-section[id]');
      var list = [];
      if (inner.length) { for (var j = 0; j < inner.length; j++) list.push(inner[j]); }
      else if (secEl.matches && secEl.matches('.report-section[id]')) { list.push(secEl); }
      if (list.length) {
        for (var k = 0; k < list.length; k++) {
          var el = list[k];
          if (!el.id || !railIsVisible(el)) continue;
          var opt = railLabelOptions(el);
          if (opt.primary) raw.push({ id: el.id, el: el, opt: opt });
        }
      } else {
        if (!railIsVisible(secEl)) continue;
        var ttl = titleById[id];
        if (!ttl) continue; // untitled scaffolding (legend etc.) → not a nav target
        if (!secEl.id) secEl.id = 'sec-' + id;
        raw.push({ id: secEl.id, el: secEl, opt: { primary: { html: t(esc(ttl.en), esc(ttl.pt)), key: String(ttl.en || '').toLowerCase() }, alt: null } });
      }
    }
    /* De-dup: when several sections resolve to the same primary label (all the
       BIA rows read "Analysis"), swap each to its distinct title. Distinctive
       labels (Paulo's imaging) never collide, so they're untouched. */
    var counts = {};
    raw.forEach(function (r) { counts[r.opt.primary.key] = (counts[r.opt.primary.key] || 0) + 1; });
    return raw.map(function (r) {
      var choice = r.opt.primary;
      if (counts[choice.key] > 1 && r.opt.alt && r.opt.alt.key && r.opt.alt.key !== choice.key) choice = r.opt.alt;
      return { id: r.id, el: r.el, html: choice.html };
    });
  }
  function buildSideNav(targets) {
    var nav = document.createElement('nav');
    nav.className = 'lumen-side-nav';
    nav.setAttribute('aria-label', tPlain('On this page', 'Nesta página'));
    var title = document.createElement('div');
    title.className = 'lumen-side-nav-title';
    title.innerHTML = t('On this page', 'Nesta página');
    nav.appendChild(title);
    targets.forEach(function (tg) {
      var a = document.createElement('a');
      a.href = '#' + tg.id;
      a.setAttribute('data-target', tg.id);
      a.innerHTML = tg.html;
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        /* Resolve to the exact element the rail collected inside the assembler
           root — NOT document.getElementById(tg.id). The hidden static shell
           (display:none, left in the DOM by hidePageBody) can carry the same id
           (e.g. #labs on the exams shell), and getElementById would return that
           first, stranding the scroll on an invisible node. */
        var dest = tg.el || document.getElementById(tg.id);
        if (!dest) return;
        dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try { history.replaceState(null, '', '#' + tg.id); } catch (_) {}
      });
      nav.appendChild(a);
    });
    return nav;
  }
  function wireRailSpy(nav, targets) {
    if (!('IntersectionObserver' in window)) return;
    var links = {};
    nav.querySelectorAll('a[data-target]').forEach(function (a) { links[a.getAttribute('data-target')] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (kk) { links[kk].classList.remove('active'); });
        var a = links[e.target.id];
        if (a) a.classList.add('active');
      });
    }, { rootMargin: '-72px 0px -68% 0px', threshold: 0 });
    targets.forEach(function (tg) {
      var el = tg.el || document.getElementById(tg.id); // scoped element, dodges duplicate-id shells
      if (el) obs.observe(el);
    });
  }
  /* The left rail belongs on the detail pages that carry it on the static
     shells (Joao's has-side-nav pages): exams, vitals, genetics, mental.
     Landing/summary/narrative pages (home, physical, spiritual) and the
     single-scroll consult view intentionally have no rail — matching the
     canon so machine-2 pages look like machine-1, not more chromed. */
  var RAIL_PAGES = {
    'physical-exams': 1, 'physical-vitals': 1, 'physical-genetics': 1,
    'mental': 1, 'spiritual': 1,
  };
  function mountSideNav(root, titleById, page) {
    var existing = document.querySelector('.lumen-side-nav');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.body.classList.remove('lumen-has-rail');
    if (!RAIL_PAGES[page]) return;
    var targets = collectRailTargets(root, titleById);
    if (targets.length < 2) return;
    var nav = buildSideNav(targets);
    root.insertBefore(nav, root.firstChild);
    document.body.classList.add('lumen-has-rail');
    wireRailSpy(nav, targets);
    /* Charts rendered by the after-hooks measured the full-width column; the
       rail just narrowed it by 240px. Chart.js re-fits via ResizeObserver, but
       Plotly (responsive:true) only listens to window resize — nudge it once
       layout has settled so its SVG can't overflow the narrowed column. */
    var reflow = function () { try { window.dispatchEvent(new Event('resize')); } catch (_) {} };
    if (window.requestAnimationFrame) window.requestAnimationFrame(reflow); else reflow();
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
  function renderPageBanner(summary, pageMeta, generatedAt, stale) {
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
    if (prep) {
      var prepVal = '<span class="lang-en">' + prep.en + '</span><span class="lang-pt">' + prep.pt + '</span>';
      // Read-time staleness: newer source data has been ingested than this narrative
      // reflects. Never let the banner silently imply the page is fully current.
      if (stale) prepVal += ' <span class="id-soft" style="color:#B8954A">' +
        t('&middot; update pending', '&middot; atualiza&ccedil;&atilde;o pendente') + '</span>';
      items += bannerIdItem('Prepared', 'Preparado', prepVal, stale ? 'id-item--stale' : '');
    }

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
  function buildEmptyState(hasUploadTail) {
    var el = document.createElement('section');
    el.className = 'lumen-empty';
    /* Only mention the Upload card when the tail actually renders one —
       granted viewers (doctor/family) have no tail, and consult pages don't
       load upload-card.js at all. */
    el.innerHTML = '<p>' + (hasUploadTail
      ? t('Nothing on record for this page yet. Use the Upload card below to add exams, vitals or documents.',
          'Ainda não há dados registrados nesta página. Use o cartão Enviar dados abaixo para adicionar exames, sinais vitais ou documentos.')
      : t('Nothing on record for this page yet.',
          'Ainda não há dados registrados nesta página.')) +
      '</p>';
    return el;
  }

  /* ── tail (slot 5): Upload → Update-AI-Insights → Delete (home only, D3) ── */
  function buildTail(patient, page) {
    /* Self-only affordances: upload, insights-rebuild and wipe are all
       server-gated to self-or-admin — for a granted viewer (doctor, family)
       these cards can only 403. Skip the whole tail for them. */
    var viewer = '', role = '';
    try {
      viewer = sessionStorage.getItem('jc_viewer_clerk') || '';
      role = sessionStorage.getItem('jc_viewer_role') || '';
    } catch (_) {}
    if (role !== 'admin' && viewer && patient && viewer !== patient) return null;
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
    /* 'consult' is the single-scroll consultation page: it stacks sections
       from every domain, so it fetches the union of the per-page payloads.
       Each API scope-filters server-side; denied slices come back null/empty
       and their sections simply don't render. */
    if (page === 'physical-exams' || page === 'consult') jobs.exams = getJson('/api/patient-exams?' + q);
    if (page === 'mental' || page === 'consult') jobs.psych = getJson('/api/patient-psych?' + q);
    if (page === 'physical-vitals' || page === 'consult') {
      var viewer = '';
      try { viewer = sessionStorage.getItem('jc_viewer_clerk') || ''; } catch (_) {}
      var today = new Date().toISOString().slice(0, 10);
      jobs.vitals = getJson('/api/vitals-range?' + q + '&from=2015-01-01&to=' + today,
        viewer ? { 'X-Viewer-Clerk': viewer, Accept: 'application/json' } : { Accept: 'application/json' });
      /* Bioimpedance / body composition — its own table, not part of the
         vitals-range device series. Scope-filtered server-side ('vitals'),
         so a denied viewer gets an error body and the sections stay closed. */
      jobs.bodyComp = getJson('/api/patient-body-composition?' + q,
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
    document.body.classList.add('lumen-assembled'); // light-blue canvas + rail scope
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
    heroWrap.innerHTML = renderPageBanner(payloads.summary, meta, newestGeneratedAt(payloads),
      payloads.dashboard && payloads.dashboard.freshness && payloads.dashboard.freshness.stale);
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
    var titleById = {}; // id → {en,pt} for rendered sections (side-rail labels)
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
        if (entry.title) titleById[entry.id] = entry.title;
        topics.appendChild(out.el);
        if (out.after) afters.push(out.after);
        if (!entry.summary) topicCount++;
        else summaryCount++;
      });

    /* 5 · tail — built early so the empty state knows whether an Upload
       card will actually be on the page (granted viewers get no tail). */
    var tail = buildTail(patient, page);

    /* 4 · empty state — only when NOTHING rendered. Its copy claims nothing
       is on record; below a data-backed AI summary (prompt #2c guarantees one
       whenever the domain has data) that claim would be false. */
    if (topicCount === 0 && summaryCount === 0) root.appendChild(buildEmptyState(!!tail));

    /* registry-driven footnote (spiritual pastoral line) */
    if (meta.footnote) {
      var fn = document.createElement('p');
      fn.className = 'lumen-footnote';
      fn.innerHTML = t(esc(meta.footnote.en), esc(meta.footnote.pt));
      root.appendChild(fn);
    }

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

    /* left rail — generated from the sections that actually rendered
       (only on the canon rail pages) */
    mountSideNav(root, titleById, page);

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
