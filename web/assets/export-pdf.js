/* Lumen Health — Export to PDF (thin client over a server-built report)
 *
 * The PDF is built entirely on the backend: POST /api/export-pdf launches
 * headless Chrome (Cloudflare Browser Rendering), renders the patient's real
 * pages, strips all app chrome, lays them out on A4 with normal margins, merges
 * them behind the dark cover, and streams a true vector PDF. This file only:
 *   1. loads the data-driven section list (GET /api/export-manifest),
 *   2. shows the checkbox dialog,
 *   3. POSTs the selection and downloads the returned PDF blob.
 *
 * No client-side rendering/screenshotting — that path (html2canvas/jsPDF) is gone.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var PATIENT = params.get('patient') || sessionStorage.getItem('jc_current_patient') || '';

  /* Export is self-or-admin at the API (gateExportViewer) — a granted viewer
     (doctor, family) would get a button that can only 403. Hide it instead. */
  var VIEWER = '', ROLE = '';
  try {
    VIEWER = sessionStorage.getItem('jc_viewer_clerk') || '';
    ROLE = sessionStorage.getItem('jc_viewer_role') || '';
  } catch (_) {}
  if (ROLE !== 'admin' && VIEWER && PATIENT && VIEWER !== PATIENT) {
    document.querySelectorAll('[data-export-btn]').forEach(function (btn) {
      btn.style.display = 'none';
    });
    return;
  }

  function lang() { return document.documentElement.lang === 'pt' ? 'pt' : 'en'; }
  function T(key) {
    var d = {
      title:    { en: 'Export to PDF',                    pt: 'Exportar em PDF' },
      sub:      { en: 'Choose which sections to include.', pt: 'Selecione as seções a incluir.' },
      selectAll:{ en: 'Select all',                        pt: 'Selecionar tudo' },
      clearAll: { en: 'Clear',                             pt: 'Limpar' },
      cancel:   { en: 'Cancel',                            pt: 'Cancelar' },
      cont:     { en: 'Generate',                          pt: 'Gerar' },
      none:     { en: 'Select at least one section.',      pt: 'Selecione ao menos uma seção.' },
      loading:  { en: 'Loading sections…',                 pt: 'Carregando seções…' },
      noData:   { en: 'No exportable sections found.',     pt: 'Nenhuma seção exportável encontrada.' },
      building: { en: 'Building your report… this can take up to a minute.',
                  pt: 'Montando seu relatório… isso pode levar até um minuto.' },
      failed:   { en: 'Export failed. Try again.',         pt: 'Falha ao exportar. Tente novamente.' },
    };
    return (d[key] && d[key][lang()]) || (d[key] && d[key].en) || key;
  }

  var manifestTree = null;

  /* ── Modal (reuses .export-modal* styles in styles.css) ─────────────── */
  function buildShell() {
    if (document.getElementById('exportModal')) return document.getElementById('exportModal');
    var root = document.createElement('div');
    root.id = 'exportModal';
    root.className = 'export-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.hidden = true;
    root.innerHTML =
      '<div class="export-modal-backdrop" data-close></div>' +
      '<div class="export-modal-card">' +
        '<header class="export-modal-head">' +
          '<h2 class="export-modal-title"></h2><p class="export-modal-sub"></p>' +
        '</header>' +
        '<div class="export-modal-body"></div>' +
        '<div class="export-modal-error" hidden></div>' +
        '<footer class="export-modal-foot">' +
          '<div class="export-modal-foot-left">' +
            '<button type="button" class="export-link-btn" data-action="all"></button>' +
            '<button type="button" class="export-link-btn" data-action="clear"></button>' +
          '</div>' +
          '<div class="export-modal-foot-right">' +
            '<button type="button" class="export-btn-ghost" data-close></button>' +
            '<button type="button" class="export-btn-primary" data-action="continue"></button>' +
          '</div>' +
        '</footer>' +
        '<div class="export-modal-progress" hidden>' +
          '<div class="export-donut-wrap">' +
            '<svg class="export-donut" viewBox="0 0 100 100" width="104" height="104" aria-hidden="true">' +
              '<circle cx="50" cy="50" r="42" fill="none" stroke="#E6ECF1" stroke-width="9"/>' +
              '<circle class="export-donut-arc" cx="50" cy="50" r="42" fill="none" stroke="#3E7CA3" ' +
                'stroke-width="9" stroke-linecap="round" stroke-dasharray="263.894" stroke-dashoffset="263.894" ' +
                'transform="rotate(-90 50 50)" style="transition:stroke-dashoffset .3s ease"/>' +
              '<text class="export-donut-label" x="50" y="50" text-anchor="middle" dominant-baseline="central" ' +
                'font-family="\'IBM Plex Mono\', monospace" font-size="19" fill="#1A2129">0%</text>' +
            '</svg>' +
          '</div>' +
          '<div class="export-progress-text"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    root.querySelectorAll('[data-close]').forEach(function (el) { el.addEventListener('click', closeModal); });
    root.querySelector('[data-action="all"]').addEventListener('click', function () {
      root.querySelectorAll('.export-modal-body input[type="checkbox"]').forEach(function (i) { i.checked = true; });
    });
    root.querySelector('[data-action="clear"]').addEventListener('click', function () {
      root.querySelectorAll('.export-modal-body input[type="checkbox"]').forEach(function (i) { i.checked = false; });
    });
    root.querySelector('[data-action="continue"]').addEventListener('click', onContinue);
    document.addEventListener('keydown', function (e) { if (!root.hidden && e.key === 'Escape') closeModal(); });
    return root;
  }

  function renderNode(node, depth) {
    var isLeaf = !node.children;
    var wrap = document.createElement('div');
    wrap.className = 'export-cat' + (depth ? ' export-cat-nested' : '');
    wrap.style.marginLeft = (depth * 16) + 'px';
    var label = document.createElement('label');
    label.className = isLeaf ? 'export-cat-subitem' : 'export-cat-top';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true;
    if (isLeaf) cb.dataset.leaf = node.id; else cb.dataset.group = node.id;
    var span = document.createElement('span');
    span.className = isLeaf ? '' : 'export-cat-label';
    span.textContent = node[lang()] || node.en;
    label.appendChild(cb); label.appendChild(span); wrap.appendChild(label);
    if (!isLeaf) {
      var sub = document.createElement('div');
      sub.className = 'export-cat-sub';
      node.children.forEach(function (c) { sub.appendChild(renderNode(c, depth + 1)); });
      wrap.appendChild(sub);
      cb.addEventListener('change', function () {
        sub.querySelectorAll('input[type="checkbox"]').forEach(function (i) { i.checked = cb.checked; });
      });
      sub.addEventListener('change', function () {
        cb.checked = !![].slice.call(sub.querySelectorAll('input[type="checkbox"]')).find(function (i) { return i.checked; });
      });
    }
    return wrap;
  }

  function paintTree(root) {
    var body = root.querySelector('.export-modal-body');
    root.querySelector('.export-modal-title').textContent = T('title');
    root.querySelector('.export-modal-sub').textContent = T('sub');
    root.querySelector('[data-action="all"]').textContent = T('selectAll');
    root.querySelector('[data-action="clear"]').textContent = T('clearAll');
    root.querySelector('[data-close].export-btn-ghost').textContent = T('cancel');
    root.querySelector('[data-action="continue"]').textContent = T('cont');
    body.innerHTML = '';
    var cont = root.querySelector('[data-action="continue"]');
    if (!manifestTree || !manifestTree.length) {
      body.innerHTML = '<p class="export-empty">' + T('noData') + '</p>';
      cont.disabled = true; return;
    }
    cont.disabled = false;
    manifestTree.forEach(function (n) { body.appendChild(renderNode(n, 0)); });
  }

  function readSelection(root) {
    var out = [];
    root.querySelectorAll('.export-modal-body input[data-leaf]').forEach(function (cb) {
      if (cb.checked) out.push(cb.dataset.leaf);
    });
    return out;
  }

  /* ── State ─────────────────────────────────────────────────────────── */
  function openModal() {
    if (!PATIENT) { alert(lang() === 'pt' ? 'Nenhum paciente selecionado.' : 'No patient in context.'); return; }
    var root = buildShell();
    root.querySelector('.export-modal-error').hidden = true;
    root.querySelector('.export-modal-progress').hidden = true;
    root.querySelector('.export-modal-body').hidden = false;
    root.querySelector('.export-modal-foot').hidden = false;
    root.querySelector('.export-modal-title').textContent = T('title');
    root.querySelector('.export-modal-body').innerHTML = '<p class="export-empty">' + T('loading') + '</p>';
    root.hidden = false;
    document.body.style.overflow = 'hidden';

    fetch('/api/export-manifest?patient=' + encodeURIComponent(PATIENT), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { manifestTree = (j && j.tree) || []; paintTree(root); })
      .catch(function (e) { manifestTree = []; paintTree(root); showError('' + e.message); });
  }
  function closeModal() {
    var root = document.getElementById('exportModal');
    if (!root) return;
    root.hidden = true; document.body.style.overflow = '';
  }
  function showError(msg) {
    var root = document.getElementById('exportModal');
    var err = root.querySelector('.export-modal-error');
    err.textContent = msg; err.hidden = false;
  }
  function showProgress() {
    var root = document.getElementById('exportModal');
    root.querySelector('.export-modal-body').hidden = true;
    root.querySelector('.export-modal-foot').hidden = true;
    root.querySelector('.export-modal-error').hidden = true;
    root.querySelector('.export-modal-progress').hidden = false;
  }

  /* ── Donut progress ─────────────────────────────────────────────────
   * The report is built in one server request (no per-step reporting), so this
   * is a time ESTIMATE scaled to the number of sections: it eases toward a cap
   * (~92%) and only snaps to 100% when the PDF actually arrives — it never shows
   * "done" before it is. */
  var DONUT_C = 263.894; // 2*pi*42
  var anim = { raf: 0, done: false, pct: 0 };

  function setDonut(pct) {
    var root = document.getElementById('exportModal');
    var arc = root.querySelector('.export-donut-arc');
    var label = root.querySelector('.export-donut-label');
    var txt = root.querySelector('.export-progress-text');
    if (arc) arc.setAttribute('stroke-dashoffset', String(DONUT_C * (1 - pct / 100)));
    if (label) label.textContent = Math.round(pct) + '%';
    if (txt) txt.textContent = progressLabel(pct);
  }
  function progressLabel(pct) {
    var d = pct >= 100 ? { en: 'Done', pt: 'Concluído' }
      : pct < 12 ? { en: 'Preparing…', pt: 'Preparando…' }
      : pct < 82 ? { en: 'Rendering sections…', pt: 'Renderizando seções…' }
      : { en: 'Finalising…', pt: 'Finalizando…' };
    return d[lang()] || d.en;
  }
  function startEstimate(nSections) {
    var cap = 92;
    var dur = (4 + 6 * Math.max(1, nSections)) * 1000; // rough ETA in ms
    var t0 = performance.now();
    anim.done = false; anim.pct = 0; setDonut(0);
    (function tick(now) {
      if (anim.done) return;
      var t = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - t, 3);          // easeOutCubic
      var pct = Math.min(cap, eased * cap);
      if (pct > anim.pct) { anim.pct = pct; setDonut(pct); }
      anim.raf = requestAnimationFrame(tick);
    })(t0);
  }
  function finishEstimate(cb) {
    anim.done = true;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    setDonut(100);
    setTimeout(cb, 400);
  }
  function stopEstimate() {
    anim.done = true;
    if (anim.raf) cancelAnimationFrame(anim.raf);
  }
  function backToSelector() {
    var root = document.getElementById('exportModal');
    root.querySelector('.export-modal-progress').hidden = true;
    root.querySelector('.export-modal-body').hidden = false;
    root.querySelector('.export-modal-foot').hidden = false;
  }

  /* ── Generate (server builds the PDF; we just download it) ──────────── */
  async function onContinue() {
    var root = document.getElementById('exportModal');
    var sections = readSelection(root);
    if (!sections.length) { showError(T('none')); return; }
    showProgress();
    startEstimate(sections.length);
    try {
      var resp = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
        body: JSON.stringify({ patientId: PATIENT, language: lang(), sections: sections }),
      });
      if (!resp.ok) {
        var msg = 'HTTP ' + resp.status;
        try { var j = await resp.json(); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      var blob = await resp.blob();
      finishEstimate(function () {
        downloadBlob(blob, filenameFrom(resp));
        closeModal();
      });
    } catch (e) {
      console.error('[export-pdf] failed', e);
      stopEstimate();
      backToSelector();
      showError(T('failed') + (e && e.message ? ' — ' + e.message : ''));
    }
  }

  function filenameFrom(resp) {
    var cd = resp.headers.get('Content-Disposition') || '';
    var star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch (e) {} }
    var plain = cd.match(/filename="?([^";]+)"?/i);
    if (plain) return plain[1];
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
    return 'Lumen Health Report ' + dd + '-' + mm + '-' + d.getFullYear() + '.pdf';
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function init() {
    document.querySelectorAll('[data-export-btn]').forEach(function (btn) {
      btn.addEventListener('click', openModal);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
