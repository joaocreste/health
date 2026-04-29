/* JC Advisory — Export to PDF
 *
 * Wires up the topnav "Export" button. Opens a modal with a checkbox tree of
 * exportable categories; on Continue, loads each selected source page in a
 * hidden iframe, waits for charts/fonts to render, snapshots <canvas> elements
 * to <img>, clones the body content into a staging container, then runs
 * html2pdf to produce a single downloadable PDF.
 *
 * The PDF inherits the host page's stylesheet, so branding matches the site.
 */
(function () {
  'use strict';

  const PATIENT = {
    name: 'Joao Victor Creste Dias de Souza',
    dob: '17 October 1992',
  };

  const CATEGORIES = [
    { id: 'summary',  src: 'home.html',              label: { en: 'Summary',             pt: 'Resumo' } },
    { id: 'physical', src: 'physical.html',          label: { en: 'Physical · Overview', pt: 'Físico · Visão geral' } },
    { id: 'vitals',   src: 'physical-vitals.html',   label: { en: 'Vitals',              pt: 'Sinais vitais' } },
    { id: 'exams',    src: 'physical-exams.html',    label: { en: 'Exams',               pt: 'Exames' }, sections: [
      { id: 'imaging',      label: { en: 'CT facial sinuses',  pt: 'TC dos seios da face' } },
      { id: 'mri-head',     label: { en: 'MRI brain',          pt: 'RM do encéfalo' } },
      { id: 'mri-cervical', label: { en: 'MRI cervical spine', pt: 'RM da coluna cervical' } },
      { id: 'tc-heart',     label: { en: 'Coronary CT',        pt: 'Angio-TC coronariana' } },
      { id: 'eeg',          label: { en: 'EEG',                pt: 'EEG' } },
      { id: 'labs',         label: { en: 'Blood & urine labs', pt: 'Sangue e urina' } },
      { id: 'gut',          label: { en: 'Gut microbiota',     pt: 'Microbiota intestinal' } },
      { id: 'alcohol',      label: { en: 'Alcohol pattern',    pt: 'Padrão de álcool' } },
    ]},
    { id: 'genetics', src: 'physical-genetics.html', label: { en: 'Genetics',            pt: 'Genética' } },
    { id: 'mental',   src: 'mental.html',            label: { en: 'Mental health',       pt: 'Saúde mental' } },
  ];

  // Selectors on every page that should be removed from the cloned content
  // so the PDF doesn't show site chrome (top nav, in-page nav, language
  // toggle, sign-out button, the export button itself, the bilingual notice).
  const STRIP_SELECTORS = [
    '.topnav',
    '.section-nav',
    '.lang-switch',
    '.signout-btn',
    '[data-export-btn]',
    '.pt-pending-notice',
    '.back-link',
    'script',
  ];

  const T = (key) => {
    const dict = {
      title:    { en: 'Export to PDF',                       pt: 'Exportar em PDF' },
      sub:      { en: 'Choose which sections to include.',   pt: 'Selecione as seções a incluir.' },
      selectAll:{ en: 'Select all',                          pt: 'Selecionar tudo' },
      clearAll: { en: 'Clear',                               pt: 'Limpar' },
      cancel:   { en: 'Cancel',                              pt: 'Cancelar' },
      cont:     { en: 'Continue',                            pt: 'Continuar' },
      none:     { en: 'Select at least one section.',        pt: 'Selecione ao menos uma seção.' },
      preparing:{ en: 'Preparing report…',                   pt: 'Preparando relatório…' },
      loading:  { en: 'Loading',                             pt: 'Carregando' },
      rendering:{ en: 'Rendering PDF…',                      pt: 'Renderizando PDF…' },
      failed:   { en: 'Export failed. Try again.',           pt: 'Falha ao exportar. Tente novamente.' },
      missing:  { en: 'PDF library not loaded.',             pt: 'Biblioteca de PDF não carregada.' },
      reportTitle: { en: 'Health Report',                    pt: 'Relatório de Saúde' },
      patient:  { en: 'Patient',                             pt: 'Paciente' },
      dob:      { en: 'Date of birth',                       pt: 'Data de nascimento' },
      generated:{ en: 'Generated',                           pt: 'Gerado em' },
      sections: { en: 'Sections included',                   pt: 'Seções incluídas' },
      confidential: {
        en: 'Strictly confidential — for clinical communication only. Does not replace licensed medical advice.',
        pt: 'Estritamente confidencial — apenas para comunicação clínica. Não substitui aconselhamento médico licenciado.'
      },
    };
    return dict[key][lang()] || dict[key].en;
  };

  function lang() {
    return document.documentElement.lang === 'pt' ? 'pt' : 'en';
  }

  function todayStr() {
    const d = new Date();
    const months = {
      en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      pt: ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'],
    };
    const L = lang();
    return `${d.getDate()} ${months[L][d.getMonth()]} ${d.getFullYear()}`;
  }

  function pdfFilename() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `JC-Advisory-Health-Report-${yyyy}-${mm}-${dd}.pdf`;
  }

  /* ── Modal ──────────────────────────────────────────────────────────── */

  function buildModal() {
    if (document.getElementById('exportModal')) return;

    const root = document.createElement('div');
    root.id = 'exportModal';
    root.className = 'export-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'exportModalTitle');
    root.hidden = true;

    root.innerHTML = `
      <div class="export-modal-backdrop" data-close></div>
      <div class="export-modal-card">
        <header class="export-modal-head">
          <h2 id="exportModalTitle" class="export-modal-title"></h2>
          <p class="export-modal-sub"></p>
        </header>
        <div class="export-modal-body"></div>
        <div class="export-modal-error" hidden></div>
        <footer class="export-modal-foot">
          <div class="export-modal-foot-left">
            <button type="button" class="export-link-btn" data-action="all"></button>
            <button type="button" class="export-link-btn" data-action="clear"></button>
          </div>
          <div class="export-modal-foot-right">
            <button type="button" class="export-btn-ghost" data-close></button>
            <button type="button" class="export-btn-primary" data-action="continue"></button>
          </div>
        </footer>
        <div class="export-modal-progress" hidden>
          <div class="export-spinner" aria-hidden="true"></div>
          <div class="export-progress-text"></div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    // Populate body with categories tree
    const body = root.querySelector('.export-modal-body');
    CATEGORIES.forEach((cat) => {
      const row = document.createElement('div');
      row.className = 'export-cat';

      const top = document.createElement('label');
      top.className = 'export-cat-top';
      top.innerHTML = `
        <input type="checkbox" data-cat="${cat.id}" checked>
        <span class="export-cat-label"></span>
      `;
      top.querySelector('.export-cat-label').textContent = cat.label[lang()];
      top.dataset.catId = cat.id;
      row.appendChild(top);

      if (cat.sections) {
        const sub = document.createElement('div');
        sub.className = 'export-cat-sub';
        cat.sections.forEach((s) => {
          const sl = document.createElement('label');
          sl.className = 'export-cat-subitem';
          sl.innerHTML = `
            <input type="checkbox" data-cat="${cat.id}" data-section="${s.id}" checked>
            <span></span>
          `;
          sl.querySelector('span').textContent = s.label[lang()];
          sub.appendChild(sl);
        });
        row.appendChild(sub);

        // Wire parent → child cascade
        const parent = top.querySelector('input');
        parent.addEventListener('change', () => {
          sub.querySelectorAll('input').forEach((i) => { i.checked = parent.checked; });
        });
        sub.querySelectorAll('input').forEach((child) => {
          child.addEventListener('change', () => {
            const any = !![...sub.querySelectorAll('input')].find((i) => i.checked);
            parent.checked = any;
          });
        });
      }

      body.appendChild(row);
    });

    // Localized button text
    refreshModalText(root);

    // Wire actions
    root.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    root.querySelector('[data-action="all"]').addEventListener('click', () => {
      root.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = true; });
    });
    root.querySelector('[data-action="clear"]').addEventListener('click', () => {
      root.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = false; });
    });
    root.querySelector('[data-action="continue"]').addEventListener('click', onContinue);

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (!root.hidden && e.key === 'Escape') closeModal();
    });
  }

  function refreshModalText(root) {
    root = root || document.getElementById('exportModal');
    if (!root) return;
    root.querySelector('.export-modal-title').textContent = T('title');
    root.querySelector('.export-modal-sub').textContent = T('sub');
    root.querySelector('[data-action="all"]').textContent = T('selectAll');
    root.querySelector('[data-action="clear"]').textContent = T('clearAll');
    root.querySelector('[data-close].export-btn-ghost').textContent = T('cancel');
    root.querySelector('[data-action="continue"]').textContent = T('cont');
    // Re-localize category labels
    CATEGORIES.forEach((cat) => {
      const top = root.querySelector(`.export-cat-top[data-cat-id="${cat.id}"] .export-cat-label`);
      if (top) top.textContent = cat.label[lang()];
    });
    root.querySelectorAll('.export-cat-subitem').forEach((el) => {
      const inp = el.querySelector('input');
      const cat = CATEGORIES.find((c) => c.id === inp.dataset.cat);
      const sec = cat && cat.sections && cat.sections.find((s) => s.id === inp.dataset.section);
      if (sec) el.querySelector('span').textContent = sec.label[lang()];
    });
  }

  function openModal() {
    buildModal();
    const root = document.getElementById('exportModal');
    refreshModalText(root);
    root.querySelector('.export-modal-error').hidden = true;
    root.querySelector('.export-modal-progress').hidden = true;
    root.querySelector('.export-modal-body').hidden = false;
    root.querySelector('.export-modal-foot').hidden = false;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const root = document.getElementById('exportModal');
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = '';
  }

  function showError(msg) {
    const root = document.getElementById('exportModal');
    const err = root.querySelector('.export-modal-error');
    err.textContent = msg;
    err.hidden = false;
  }

  function showProgress(text) {
    const root = document.getElementById('exportModal');
    root.querySelector('.export-modal-body').hidden = true;
    root.querySelector('.export-modal-foot').hidden = true;
    root.querySelector('.export-modal-error').hidden = true;
    const p = root.querySelector('.export-modal-progress');
    p.hidden = false;
    p.querySelector('.export-progress-text').textContent = text;
  }

  /* ── Selection model ────────────────────────────────────────────────── */

  function readSelection() {
    const root = document.getElementById('exportModal');
    const out = [];
    CATEGORIES.forEach((cat) => {
      const parent = root.querySelector(`input[data-cat="${cat.id}"]:not([data-section])`);
      if (!parent || !parent.checked) return;
      const entry = { cat, sections: null };
      if (cat.sections) {
        const enabled = cat.sections.filter((s) => {
          const cb = root.querySelector(`input[data-cat="${cat.id}"][data-section="${s.id}"]`);
          return cb && cb.checked;
        });
        if (!enabled.length) return; // top checked but all sub off → skip
        if (enabled.length < cat.sections.length) entry.sections = enabled.map((s) => s.id);
      }
      out.push(entry);
    });
    return out;
  }

  /* ── Continue handler ───────────────────────────────────────────────── */

  async function onContinue() {
    const sel = readSelection();
    if (!sel.length) {
      showError(T('none'));
      return;
    }
    if (typeof window.html2pdf !== 'function') {
      showError(T('missing'));
      return;
    }

    showProgress(T('preparing'));

    try {
      const staging = await composeReport(sel);
      showProgress(T('rendering'));
      await renderPdf(staging);
      cleanupStaging(staging);
      closeModal();
    } catch (err) {
      console.error('[export] failed', err);
      // Reset modal UI from progress back to selector
      const root = document.getElementById('exportModal');
      root.querySelector('.export-modal-progress').hidden = true;
      root.querySelector('.export-modal-body').hidden = false;
      root.querySelector('.export-modal-foot').hidden = false;
      showError(T('failed'));
    }
  }

  /* ── Composition: load each source page in iframe, harvest content ──── */

  async function composeReport(selection) {
    const staging = document.createElement('div');
    staging.id = 'pdfStaging';
    staging.className = 'pdf-staging';
    document.body.appendChild(staging);

    // Cover page
    staging.appendChild(buildCover(selection));

    // Each selected source page
    for (let i = 0; i < selection.length; i++) {
      const { cat, sections } = selection[i];
      showProgress(`${T('loading')}: ${cat.label[lang()]} (${i + 1}/${selection.length})`);

      const frame = await loadFrame(cat.src);
      try {
        const fdoc = frame.contentDocument;

        // Wait for fonts and any post-load chart drawing.
        try { if (fdoc.fonts && fdoc.fonts.ready) await fdoc.fonts.ready; } catch (_) {}
        await wait(1800);

        // For exams page, drop sub-sections that weren't selected.
        if (cat.id === 'exams' && sections) {
          fdoc.querySelectorAll('.report-section').forEach((sec) => {
            if (!sections.includes(sec.id)) sec.remove();
          });
        }

        // Snapshot canvases (Chart.js, CT viewer) into <img> so cloning preserves pixels.
        snapshotCanvases(fdoc);

        // Strip site chrome.
        STRIP_SELECTORS.forEach((sel) => {
          fdoc.querySelectorAll(sel).forEach((el) => el.remove());
        });

        // Resolve relative urls in src/href so they keep working in the host.
        const baseDir = cat.src.replace(/[^/]+$/, ''); // '' for top-level pages → relative
        rewriteRelativeUrls(fdoc.body, baseDir);

        // Wrap and import (deep-clone into host document — safer than cross-doc
        // adoption, which can lose computed styles in some browsers).
        const wrap = document.createElement('section');
        wrap.className = 'pdf-section pdf-pagebreak';
        wrap.dataset.cat = cat.id;
        Array.from(fdoc.body.childNodes).forEach((node) => {
          wrap.appendChild(document.importNode(node, true));
        });
        staging.appendChild(wrap);
        if (window.__exportDebug) {
          console.log('[export] staged', cat.id, '— children:', wrap.childElementCount, '· height:', wrap.offsetHeight);
        }
      } finally {
        frame.remove();
      }
    }

    return staging;
  }

  function loadFrame(url) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed; left:-100000px; top:0; width:1024px; height:20000px; border:0; visibility:hidden;';
      f.setAttribute('aria-hidden', 'true');
      f.addEventListener('load', () => resolve(f), { once: true });
      f.addEventListener('error', reject, { once: true });
      document.body.appendChild(f);
      f.src = url;
    });
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function snapshotCanvases(doc) {
    doc.querySelectorAll('canvas').forEach((cv) => {
      try {
        const url = cv.toDataURL('image/png');
        const img = doc.createElement('img');
        img.src = url;
        const w = cv.width, h = cv.height;
        const cw = cv.clientWidth, ch = cv.clientHeight;
        img.style.cssText = `display:block; width:${cw || w}px; height:${ch || h}px; max-width:100%;`;
        img.setAttribute('data-from-canvas', 'true');
        cv.parentNode.replaceChild(img, cv);
      } catch (e) {
        // Tainted canvas (cross-origin); leave as-is.
      }
    });
  }

  function rewriteRelativeUrls(root, baseDir) {
    if (!baseDir) return; // already relative to site root
    const fix = (val) => {
      if (!val) return val;
      if (/^(https?:|data:|blob:|#|\/)/i.test(val)) return val;
      return baseDir + val;
    };
    root.querySelectorAll('img[src], source[src], a[href]').forEach((el) => {
      if (el.tagName === 'A') el.setAttribute('href', fix(el.getAttribute('href')));
      else el.setAttribute('src', fix(el.getAttribute('src')));
    });
  }

  function cleanupStaging(staging) {
    if (staging && staging.parentNode) staging.parentNode.removeChild(staging);
  }

  /* ── Cover page ─────────────────────────────────────────────────────── */

  function buildCover(selection) {
    const wrap = document.createElement('section');
    wrap.className = 'pdf-section pdf-cover';

    const items = selection.map(({ cat, sections }) => {
      const labels = sections
        ? sections.map((sid) => cat.sections.find((s) => s.id === sid).label[lang()]).join(', ')
        : '';
      return `<li><strong>${cat.label[lang()]}</strong>${labels ? ` <span class="pdf-cover-sub">— ${labels}</span>` : ''}</li>`;
    }).join('');

    wrap.innerHTML = `
      <div class="pdf-cover-inner">
        <div class="pdf-cover-brand">
          <img src="assets/logo.svg" alt="">
          <div>
            <div class="pdf-cover-brand-name">JC Advisory</div>
            <div class="pdf-cover-brand-tag">${lang() === 'pt' ? 'Dos dados aos insights' : 'From data to insights'}</div>
          </div>
        </div>
        <h1 class="pdf-cover-title">${T('reportTitle')}</h1>
        <dl class="pdf-cover-meta">
          <dt>${T('patient')}</dt><dd>${PATIENT.name}</dd>
          <dt>${T('dob')}</dt><dd>${PATIENT.dob}</dd>
          <dt>${T('generated')}</dt><dd>${todayStr()}</dd>
        </dl>
        <h2 class="pdf-cover-sec-title">${T('sections')}</h2>
        <ul class="pdf-cover-sec-list">${items}</ul>
        <p class="pdf-cover-foot">${T('confidential')}</p>
      </div>
    `;
    return wrap;
  }

  /* ── PDF render ─────────────────────────────────────────────────────── */

  function renderPdf(staging) {
    if (window.__exportDebug) {
      console.log('[export] staging size before render:', staging.offsetWidth, 'x', staging.offsetHeight,
                  '· sections:', staging.querySelectorAll('.pdf-section').length);
    }
    return window.html2pdf()
      .from(staging)
      .set({
        margin: [12, 12, 14, 12], // mm: top, right, bottom, left
        filename: pdfFilename(),
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: !!window.__exportDebug,
          backgroundColor: '#FFFFFF',
          width: 1024,
          windowWidth: 1024,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: {
          mode: ['css', 'legacy'],
          before: '.pdf-pagebreak',
          avoid: ['.list-card', '.metric-card', '.lab-test', '.entry-card', 'tr', 'figure'],
        },
      })
      .save();
  }

  /* ── Init ───────────────────────────────────────────────────────────── */

  function init() {
    document.querySelectorAll('[data-export-btn]').forEach((btn) => {
      btn.addEventListener('click', openModal);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
