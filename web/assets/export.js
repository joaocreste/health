/* JC Advisory — Export to PDF
 *
 * Wires up the topnav "Export" button. Opens a modal with a checkbox tree of
 * exportable categories; on Continue, loads each selected source page in a
 * hidden iframe, waits for charts/fonts to render, snapshots <canvas> elements
 * to <img>, then captures the iframe body directly with html2canvas and
 * appends each capture into a multi-page PDF via jsPDF.
 *
 * Why this design (instead of html2pdf): html2pdf clones the source element
 * into an internal off-screen container and re-runs html2canvas. That clone
 * step strips inline-style context that comes from the iframe's stylesheets,
 * leaving the rasterised result blank. Driving html2canvas + jsPDF directly
 * keeps each iframe self-contained and isolates failures to a single page.
 *
 * Enable verbose logging from devtools:   window.__exportDebug = true
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

  // Selectors stripped from each iframe body before capture (site chrome
  // shouldn't appear in the PDF).
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
      capturing:{ en: 'Capturing',                           pt: 'Capturando' },
      writing:  { en: 'Writing PDF…',                        pt: 'Escrevendo PDF…' },
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

  function debug(...args) {
    if (window.__exportDebug) console.log('[export]', ...args);
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

    const body = root.querySelector('.export-modal-body');
    CATEGORIES.forEach((cat) => {
      const row = document.createElement('div');
      row.className = 'export-cat';

      const top = document.createElement('label');
      top.className = 'export-cat-top';
      top.dataset.catId = cat.id;
      top.innerHTML = `
        <input type="checkbox" data-cat="${cat.id}" checked>
        <span class="export-cat-label"></span>
      `;
      top.querySelector('.export-cat-label').textContent = cat.label[lang()];
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

    refreshModalText(root);

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

  function backToSelector() {
    const root = document.getElementById('exportModal');
    root.querySelector('.export-modal-progress').hidden = true;
    root.querySelector('.export-modal-body').hidden = false;
    root.querySelector('.export-modal-foot').hidden = false;
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
        if (!enabled.length) return;
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
    const html2canvas = window.html2canvas;
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!html2canvas || !jsPDFCtor) {
      showError(T('missing'));
      debug('libs missing — html2canvas:', !!html2canvas, 'jsPDF:', !!jsPDFCtor);
      return;
    }

    showProgress(T('preparing'));

    try {
      await generatePdf(sel, html2canvas, jsPDFCtor);
      closeModal();
    } catch (err) {
      console.error('[export] failed', err);
      backToSelector();
      const detail = (err && (err.message || err.toString())) || '';
      showError(`${T('failed')} ${detail ? '— ' + detail : ''}`);
    }
  }

  /* ── PDF generation ─────────────────────────────────────────────────── */

  async function generatePdf(selection, html2canvas, jsPDFCtor) {
    const pdf = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const usableW = pageW - 2 * margin;
    const usableH = pageH - 2 * margin;

    let pagesAdded = 0;

    // 1. Cover page
    showProgress(T('preparing'));
    const coverEl = buildCover(selection);
    const coverHost = mountCaptureHost();
    coverHost.appendChild(coverEl);
    await waitForImages(coverHost);
    await wait(150);
    debug('cover element size', coverEl.offsetWidth, 'x', coverEl.offsetHeight);
    const coverCanvas = await html2canvas(coverEl, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#FFFFFF',
      logging: !!window.__exportDebug,
    });
    debug('cover canvas', coverCanvas.width, 'x', coverCanvas.height);
    if (addCanvasToPdf(pdf, coverCanvas, margin, usableW, usableH, false)) pagesAdded++;
    coverHost.remove();

    // 2. Each selected source page
    for (let i = 0; i < selection.length; i++) {
      const { cat, sections } = selection[i];
      showProgress(`${T('loading')}: ${cat.label[lang()]} (${i + 1}/${selection.length})`);

      const frame = await loadFrame(cat.src);
      try {
        const fdoc = frame.contentDocument;
        const fwin = frame.contentWindow;
        try { if (fdoc.fonts && fdoc.fonts.ready) await fdoc.fonts.ready; } catch (_) {}
        await wait(1800);

        if (cat.id === 'exams' && sections) {
          fdoc.querySelectorAll('.report-section').forEach((sec) => {
            if (!sections.includes(sec.id)) sec.remove();
          });
        }

        snapshotCanvases(fdoc);

        STRIP_SELECTORS.forEach((sel) => {
          fdoc.querySelectorAll(sel).forEach((el) => el.remove());
        });

        // Wait for any remaining images in the iframe to finish loading.
        await waitForImages(fdoc.body);
        await wait(200);

        debug('iframe body size', cat.id, fdoc.body.scrollWidth, 'x', fdoc.body.scrollHeight);

        showProgress(`${T('capturing')}: ${cat.label[lang()]} (${i + 1}/${selection.length})`);

        // Run html2canvas INSIDE the iframe's own window so it sees its own
        // document, stylesheets, and computed layout natively. This sidesteps
        // every cross-document edge case we hit running it in the parent.
        let iframeH2C = fwin.html2canvas;
        for (let t = 0; t < 30 && typeof iframeH2C !== 'function'; t++) {
          await wait(100);
          iframeH2C = fwin.html2canvas;
        }
        if (typeof iframeH2C !== 'function') {
          throw new Error(`html2canvas not loaded in iframe for ${cat.id}`);
        }
        const canvas = await iframeH2C(fdoc.body, {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#FFFFFF',
          logging: !!window.__exportDebug,
        });
        debug('captured', cat.id, canvas.width, 'x', canvas.height);

        // Convert the iframe-document canvas to a data URL we can hand to
        // jsPDF in the host context.
        if (canvas && canvas.width && canvas.height) {
          if (addCanvasToPdf(pdf, canvas, margin, usableW, usableH, true)) pagesAdded++;
        }
      } finally {
        frame.remove();
      }
    }

    if (pagesAdded === 0) {
      throw new Error('All captures returned blank — nothing to export');
    }

    showProgress(T('writing'));
    pdf.save(pdfFilename());
  }

  // Adds a canvas image to the PDF, splitting tall content across pages.
  // If `newPageFirst` is true, starts the canvas on a new page.
  // Returns true on success, false if the canvas was blank/invalid (skipped).
  function addCanvasToPdf(pdf, canvas, margin, usableW, usableH, newPageFirst) {
    if (!canvas || !canvas.width || !canvas.height || !isFinite(canvas.width) || !isFinite(canvas.height)) {
      debug('skipping blank canvas', canvas && canvas.width, 'x', canvas && canvas.height);
      return false;
    }
    const ratio = canvas.height / canvas.width;
    const renderW = usableW;
    const renderH = renderW * ratio;
    if (!isFinite(renderH) || renderH <= 0) {
      debug('skipping invalid renderH', renderH);
      return false;
    }

    if (renderH <= usableH) {
      if (newPageFirst) pdf.addPage();
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(imgData, 'JPEG', margin, margin, renderW, renderH);
      return true;
    }

    // Slice the canvas vertically into page-sized chunks.
    const pxPerMm = canvas.width / renderW;
    const sliceH = Math.floor(usableH * pxPerMm);
    let y = 0;
    let first = true;
    while (y < canvas.height) {
      const h = Math.min(sliceH, canvas.height - y);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = h;
      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (first) {
        if (newPageFirst) pdf.addPage();
        first = false;
      } else {
        pdf.addPage();
      }
      const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      const drawH = h / pxPerMm;
      pdf.addImage(imgData, 'JPEG', margin, margin, renderW, drawH);
      y += h;
    }
    return true;
  }

  function loadFrame(url) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      // Position visibly off-screen but with real dimensions so the iframe
      // performs a real layout pass (essential for Chart.js sizing).
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

  function waitForImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    if (!imgs.length) return Promise.resolve();
    return Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((res) => {
        const done = () => res();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        // Hard cap so a single broken image can't hang the export.
        setTimeout(done, 4000);
      });
    }));
  }

  function rewriteRelativeUrls(root, baseDir) {
    if (!baseDir) return;
    const fix = (val) => {
      if (!val) return val;
      if (/^(https?:|data:|blob:|#|\/)/i.test(val)) return val;
      return baseDir + val;
    };
    root.querySelectorAll('img[src]').forEach((el) => {
      el.setAttribute('src', fix(el.getAttribute('src')));
    });
    root.querySelectorAll('a[href]').forEach((el) => {
      el.setAttribute('href', fix(el.getAttribute('href')));
    });
  }

  function snapshotCanvases(doc) {
    doc.querySelectorAll('canvas').forEach((cv) => {
      try {
        const url = cv.toDataURL('image/png');
        const img = doc.createElement('img');
        img.src = url;
        const cw = cv.clientWidth || cv.width;
        const ch = cv.clientHeight || cv.height;
        img.style.cssText = `display:block; width:${cw}px; height:${ch}px; max-width:100%;`;
        img.setAttribute('data-from-canvas', 'true');
        cv.parentNode.replaceChild(img, cv);
      } catch (e) {
        debug('canvas snapshot failed (likely tainted)', e.message);
      }
    });
  }

  /* ── Capture-host: in-viewport container the cover page is mounted to,
   *    so html2canvas sees a fully-laid-out element. The modal at z-index
   *    9999 keeps it visually hidden. ─────────────────────────────────── */

  function mountCaptureHost() {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute; top:0; left:0; width:1024px; background:#FFFFFF; z-index:0; pointer-events:none;';
    document.body.appendChild(host);
    return host;
  }

  /* ── Cover page ─────────────────────────────────────────────────────── */

  function buildCover(selection) {
    const wrap = document.createElement('section');
    wrap.className = 'pdf-section pdf-cover';
    wrap.style.cssText = 'width:1024px; min-height:1280px; padding:64px 56px; box-sizing:border-box; background:#FFFFFF;';

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
