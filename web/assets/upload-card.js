/* ════════════════════════════════════════════════════════════════════════════
 * Lumen Health — "Upload data" action card.
 *
 * Pure builder: window.jcBuildUploadCard() returns the wired card element (or
 * null when no patient is active). Placement is owned by the page assembler's
 * tail (page-assembler.js) — Upload · Update AI Insights · Delete — on both
 * assembler-rendered and static-bespoke pages. No self-mounting, no observer.
 * Routes to upload.html (the actual upload happens there). Identity matches
 * patient-context.js / insights-update.js (?patient= / sessionStorage).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function qp() { return new URLSearchParams(location.search); }
  function patientClerk() { return qp().get('patient') || sessionStorage.getItem('jc_current_patient') || ''; }
  function t(en, pt) { return '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span>'; }

  function injectStyles() {
    if (document.getElementById('uc-styles')) return;
    var css = [
      '.uc-wrap{font-family:var(--font-body,system-ui);}',
      // green-bordered card — mirrors .jc-danger-card / .iu-card structure
      '.uc-card{background:#FFFFFF;border:1px solid var(--green-200,#B0DEBE);border-radius:10px;padding:20px 24px;display:flex;flex-direction:column;gap:10px;}',
      '.uc-eyebrow{display:inline-flex;align-items:center;gap:7px;font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--green-700,#245F3C);}',
      '.uc-title{font-family:var(--font-display,sans-serif);font-weight:700;font-size:15px;color:#0D1B2A;margin:0;}',
      '.uc-body{font-family:var(--font-body,sans-serif);font-size:13px;color:#1E2D3D;line-height:1.5;margin:0;}',
      '.uc-btn{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;padding:8px 16px;font-family:var(--font-body,sans-serif);font-size:13px;font-weight:500;color:var(--green-700,#245F3C);background:#FFFFFF;border:1px solid var(--green-200,#B0DEBE);border-radius:6px;cursor:pointer;text-decoration:none;transition:background .15s,color .15s,border-color .15s;}',
      '.uc-btn:hover{background:var(--green-500,#3D9460);color:#FFFFFF;border-color:var(--green-500,#3D9460);}',
      '.uc-btn svg{flex:none;}',
    ].join('');
    var s = document.createElement('style');
    s.id = 'uc-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  var uploadIcon =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

  window.jcBuildUploadCard = function () {
    var pc = patientClerk();
    if (!pc) return null;
    injectStyles();
    var href = 'upload.html?patient=' + encodeURIComponent(pc);
    var wrap = document.createElement('section');
    wrap.className = 'uc-wrap';
    wrap.setAttribute('data-upload-card', '1');
    wrap.innerHTML =
      '<div class="uc-card">' +
        '<div class="uc-eyebrow">' + t('Upload', 'Enviar') + '</div>' +
        '<h3 class="uc-title">' + t('Upload data', 'Enviar dados') + '</h3>' +
        '<p class="uc-body">' +
          t('Send documents, scans, lab PDFs, images or whole folders to Client Services. They are stored securely and reviewed before being added to your record.',
            'Envie documentos, exames, PDFs de laboratório, imagens ou pastas inteiras ao Atendimento. São armazenados com segurança e revisados antes de entrarem no seu registro.') +
        '</p>' +
        '<a class="uc-btn" href="' + href + '">' + uploadIcon + t('Upload data', 'Enviar dados') + '</a>' +
      '</div>';
    return wrap;
  };
})();
