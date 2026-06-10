/**
 * Add-data modal — Phase 1.
 *
 * Click "Add or edit data" in the topnav → modal opens with a drag-drop zone
 * and a file list. "Commit and adjust" uploads each file sequentially to
 * /api/ingest, which classifies and routes server-side. Per-file status is
 * rendered as it lands.
 */
(function () {
  'use strict';

  if (window.JC_PUBLIC === true || window.JC_PICKER_PAGE === true) return;

  function getPatientClerk() {
    var p = new URLSearchParams(location.search).get('patient');
    return p || sessionStorage.getItem('jc_current_patient') || '';
  }
  function getViewerClerk() {
    return sessionStorage.getItem('jc_viewer_clerk') || '';
  }

  /* ── Modal markup (lazy-injected on first open) ─────────────────────── */

  var modalEl = null;
  var fileInputEl = null;
  var listEl = null;
  var commitBtnEl = null;
  var stagedFiles = []; // [{ id, file, status, result, error }]
  var fileIdCounter = 0;

  function buildModal() {
    if (modalEl) return modalEl;
    var wrap = document.createElement('div');
    wrap.className = 'add-data-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="add-data-card">' +
        '<div class="add-data-head">' +
          '<div>' +
            '<div class="add-data-eyebrow">' +
              '<span class="lang-en">Add or edit data</span>' +
              '<span class="lang-pt">Adicionar ou editar dados</span>' +
            '</div>' +
            '<h2 class="add-data-title">' +
              '<span class="lang-en">Drop files for this patient</span>' +
              '<span class="lang-pt">Arraste arquivos deste paciente</span>' +
            '</h2>' +
            '<p class="add-data-sub">' +
              '<span class="lang-en">PDFs, images, DICOM, Excel, CSV, Word, text. Multiple files are fine — each one is classified and routed to the right section automatically.</span>' +
              '<span class="lang-pt">PDFs, imagens, DICOM, Excel, CSV, Word, texto. Múltiplos arquivos são suportados — cada um é classificado e roteado automaticamente.</span>' +
            '</p>' +
          '</div>' +
          '<button type="button" class="add-data-close" aria-label="' + (document.documentElement.lang === 'pt' ? 'Fechar' : 'Close') + '">×</button>' +
        '</div>' +

        '<div class="add-data-drop" id="add-data-drop" tabindex="0" role="button">' +
          '<input type="file" multiple style="display:none" id="add-data-input">' +
          '<input type="file" webkitdirectory directory multiple style="display:none" id="add-data-dir-input">' +
          '<div class="add-data-drop-inner">' +
            '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M32 44V18"/>' +
              '<polyline points="22,28 32,18 42,28"/>' +
              '<path d="M14 44v6a2 2 0 0 0 2 2h32a2 2 0 0 0 2-2v-6"/>' +
            '</svg>' +
            '<div class="add-data-drop-label">' +
              '<span class="lang-en">Drop files <em>or folders</em> here</span>' +
              '<span class="lang-pt">Arraste arquivos <em>ou pastas</em> aqui</span>' +
            '</div>' +
            '<div class="add-data-drop-actions">' +
              '<button type="button" class="add-data-drop-link" id="add-data-pick-files">' +
                '<span class="lang-en">Choose files</span><span class="lang-pt">Escolher arquivos</span>' +
              '</button>' +
              '<span class="add-data-drop-sep">·</span>' +
              '<button type="button" class="add-data-drop-link" id="add-data-pick-dir">' +
                '<span class="lang-en">Choose folder</span><span class="lang-pt">Escolher pasta</span>' +
              '</button>' +
            '</div>' +
            '<div class="add-data-drop-hint">' +
              '<span class="lang-en">Folder paths are preserved so the classifier can use them as context.</span>' +
              '<span class="lang-pt">A estrutura de pastas é preservada para o classificador.</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<ul class="add-data-list" id="add-data-list"></ul>' +

        '<div class="add-data-foot">' +
          '<button type="button" class="add-data-secondary" id="add-data-clear">' +
            '<span class="lang-en">Clear</span><span class="lang-pt">Limpar</span>' +
          '</button>' +
          '<button type="button" class="add-data-primary" id="add-data-commit" disabled>' +
            '<span class="lang-en">Commit &amp; adjust</span>' +
            '<span class="lang-pt">Confirmar &amp; ajustar</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(wrap);

    modalEl = wrap;
    fileInputEl = wrap.querySelector('#add-data-input');
    var dirInputEl = wrap.querySelector('#add-data-dir-input');
    listEl = wrap.querySelector('#add-data-list');
    commitBtnEl = wrap.querySelector('#add-data-commit');

    wrap.querySelector('.add-data-close').addEventListener('click', closeModal);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (modalEl && modalEl.classList.contains('open') && e.key === 'Escape') closeModal();
    });

    var dropZone = wrap.querySelector('#add-data-drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', function (e) {
      handleDrop(e.dataTransfer);
    });
    // Activate the file picker when the empty dropzone area is clicked (but
    // not when the user clicks the explicit "Choose folder" / "Choose files"
    // buttons or any inner control).
    dropZone.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== dropZone) {
        if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'A') return;
        t = t.parentNode;
      }
      fileInputEl.click();
    });
    wrap.querySelector('#add-data-pick-files').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      fileInputEl.click();
    });
    wrap.querySelector('#add-data-pick-dir').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      dirInputEl.click();
    });
    fileInputEl.addEventListener('change', function () {
      addFiles(fileInputEl.files, /*fromDir=*/false);
      fileInputEl.value = '';
    });
    dirInputEl.addEventListener('change', function () {
      addFiles(dirInputEl.files, /*fromDir=*/true);
      dirInputEl.value = '';
    });

    wrap.querySelector('#add-data-clear').addEventListener('click', function () {
      stagedFiles = [];
      renderList();
    });
    commitBtnEl.addEventListener('click', commit);

    return wrap;
  }

  function openModal() {
    buildModal();
    modalEl.classList.add('open');
    document.body.classList.add('add-data-open');
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('open');
    document.body.classList.remove('add-data-open');
  }

  function sanitizePath(p) {
    // Normalize separators, strip leading "./" and any leading slash so paths
    // are always relative. Trim each segment of trailing whitespace.
    return String(p || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .split('/')
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .join('/');
  }

  function stageEntry(file, relPath) {
    var path = sanitizePath(relPath || file.name);
    stagedFiles.push({
      id: ++fileIdCounter,
      file: file,
      path: path,
      status: 'staged',
      result: null,
      error: null,
    });
  }

  // Used by both the <input> change events and the drop fallback (when the
  // browser doesn't expose entries — covers all <input> picks).
  function addFiles(fileList, fromDir) {
    Array.prototype.forEach.call(fileList, function (file) {
      // webkitRelativePath is populated for files picked via
      // <input webkitdirectory> AND for files dragged from a directory
      // in some browsers. For loose-file picks it's empty — fall back to name.
      var rel = (fromDir && file.webkitRelativePath) ? file.webkitRelativePath
              : (file.webkitRelativePath || file.name);
      stageEntry(file, rel);
    });
    renderList();
  }

  // Recursive walker for drag-and-drop. dataTransfer.items lets us see folders;
  // each item exposes webkitGetAsEntry which gives us a FileSystemEntry we can
  // walk with .file() / .createReader().readEntries(). Falls back to
  // dataTransfer.files when entries aren't available (older browsers, drops
  // from unusual sources).
  function handleDrop(dt) {
    if (!dt) return;
    var items = dt.items;
    var anyEntry = false;
    if (items && items.length) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].webkitGetAsEntry) {
          anyEntry = true; break;
        }
      }
    }
    if (!anyEntry) {
      if (dt.files) addFiles(dt.files, false);
      return;
    }
    var pending = 0, finished = false;
    function done() { if (finished && pending === 0) renderList(); }
    function walkEntry(entry, prefix) {
      if (!entry) return;
      if (entry.isFile) {
        pending++;
        entry.file(function (f) {
          stageEntry(f, prefix + entry.name);
          pending--; done();
        }, function () { pending--; done(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        function readBatch() {
          pending++;
          reader.readEntries(function (entries) {
            entries.forEach(function (e) { walkEntry(e, prefix + entry.name + '/'); });
            pending--;
            if (entries.length > 0) readBatch();   // some browsers cap at 100/batch
            else done();
          }, function () { pending--; done(); });
        }
        readBatch();
      }
    }
    for (var j = 0; j < items.length; j++) {
      var entry = items[j].webkitGetAsEntry && items[j].webkitGetAsEntry();
      if (entry) walkEntry(entry, '');
    }
    finished = true;
    done();
    // Show immediate visual feedback even before async walk completes
    renderList();
  }

  var MAX_ATTEMPTS = 3;

  function statusLabel(item) {
    if (item.status === 'staged')    return { en: 'Queued',     pt: 'Em fila',     css: 'staged' };
    if (item.status === 'uploading') {
      var n = item.attempt || 1;
      if (n === 1) return { en: 'Uploading…', pt: 'Enviando…', css: 'progress' };
      return {
        en: 'Retrying ' + n + '/' + MAX_ATTEMPTS + '…',
        pt: 'Tentando ' + n + '/' + MAX_ATTEMPTS + '…',
        css: 'progress',
      };
    }
    if (item.status === 'done') {
      if (item.result) {
        var c = item.result.classified_as || 'unclassified';
        var CLASS_PT = {
          labs: 'exames',
          imaging: 'imagem',
          genetics: 'genética',
          mental: 'saúde mental',
          unclassified: 'não classificado',
        };
        return { en: c, pt: CLASS_PT[c] || c, css: 'done' };
      }
      return { en: 'Done', pt: 'Pronto', css: 'done' };
    }
    if (item.status === 'failed')    return { en: 'Failed',     pt: 'Falhou',      css: 'failed' };
    return { en: item.status, pt: item.status, css: '' };
  }

  function humanSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function renderList() {
    if (!listEl) return;
    if (stagedFiles.length === 0) {
      listEl.innerHTML = '';
      commitBtnEl.disabled = true;
      return;
    }
    var html = '';
    stagedFiles.forEach(function (item) {
      var s = statusLabel(item);
      var summary = '';
      if (item.result && item.result.summary) {
        summary = '<div class="add-data-row-summary">' + escapeHtml(item.result.summary) + '</div>';
      } else if (item.error) {
        summary = '<div class="add-data-row-summary error">' + escapeHtml(item.error) + '</div>';
      }
      var note = '';
      if (item.result && item.result.note) {
        note = '<div class="add-data-row-summary error">' + escapeHtml(item.result.note) + '</div>';
      }
      var targets = '';
      if (item.result && Array.isArray(item.result.created) && item.result.created.length) {
        var byTable = {};
        item.result.created.forEach(function (c) { byTable[c.table] = (byTable[c.table] || 0) + 1; });
        var parts = Object.keys(byTable).map(function (k) { return byTable[k] + '× ' + k; });
        targets = '<div class="add-data-row-targets">→ ' + parts.join(', ') + '</div>';
      }
      // Split the display path into "folder/segments/" + "leaf.ext" so the
      // folder context is visible but the filename stays emphasized.
      var path = item.path || item.file.name;
      var lastSlash = path.lastIndexOf('/');
      var folderHtml = lastSlash > 0
        ? '<span class="add-data-row-folder">' + escapeHtml(path.slice(0, lastSlash + 1)) + '</span>'
        : '';
      var leaf = lastSlash > 0 ? path.slice(lastSlash + 1) : path;
      html +=
        '<li class="add-data-row" data-id="' + item.id + '">' +
          '<div class="add-data-row-main">' +
            '<div class="add-data-row-name">' + folderHtml +
              '<span class="add-data-row-leaf">' + escapeHtml(leaf) + '</span>' +
            '</div>' +
            '<div class="add-data-row-meta">' + humanSize(item.file.size) + (item.file.type ? ' · ' + escapeHtml(item.file.type) : '') + '</div>' +
            summary + note + targets +
          '</div>' +
          '<div class="add-data-row-status ' + s.css + '">' +
            '<span class="lang-en">' + escapeHtml(s.en) + '</span>' +
            '<span class="lang-pt">' + escapeHtml(s.pt) + '</span>' +
          '</div>' +
        '</li>';
    });
    listEl.innerHTML = html;
    commitBtnEl.disabled = stagedFiles.every(function (i) { return i.status !== 'staged'; });
  }

  async function tryUploadOnce(item, patientClerk, viewerClerk) {
    var fd = new FormData();
    fd.append('patient_clerk', patientClerk);
    if (viewerClerk) fd.append('viewer_clerk', viewerClerk);
    // Pass the relative path as the multipart filename so the server reads
    // it via formData file.name. Backend stores it on import_files.original_path
    // and surfaces it to the classifier, which uses the folder context.
    fd.append('files', item.file, item.path || item.file.name);
    var resp;
    try {
      resp = await fetch('/api/ingest', { method: 'POST', body: fd });
    } catch (e) {
      return { ok: false, error: 'Network error: ' + (e.message || 'fetch threw') };
    }
    // Read body as text first so we can surface a useful excerpt when it
    // isn't JSON (worker timeout / 5xx HTML / empty body, etc).
    var bodyText;
    try { bodyText = await resp.text(); }
    catch (e) { return { ok: false, error: 'HTTP ' + resp.status + ' (body read failed: ' + e.message + ')' }; }
    var data;
    try { data = bodyText ? JSON.parse(bodyText) : null; }
    catch (e) {
      var excerpt = (bodyText || '').replace(/\s+/g, ' ').slice(0, 160);
      return { ok: false, error: 'HTTP ' + resp.status + ' non-JSON body: ' + (excerpt || '(empty)') };
    }
    if (!resp.ok || (data && data.error)) {
      return { ok: false, error: (data && data.error) || ('HTTP ' + resp.status) };
    }
    var first = (data && data.results && data.results[0]) || null;
    if (first && first.ok) return { ok: true, result: first };
    return { ok: false, error: (first && first.error) || 'Unknown error' };
  }

  function isRateLimit(err) {
    var s = String(err || '');
    return /\b429\b/.test(s) || /rate_limit/i.test(s);
  }

  async function uploadOne(item, patientClerk, viewerClerk) {
    var lastError = null;
    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      item.status = 'uploading';
      item.attempt = attempt;
      renderList();
      var outcome = await tryUploadOnce(item, patientClerk, viewerClerk);
      if (outcome.ok) {
        item.status = 'done';
        item.result = outcome.result;
        renderList();
        return;
      }
      lastError = outcome.error;
      if (attempt < MAX_ATTEMPTS) {
        // Rate-limit windows reset on a ~60s cadence; quick retries would
        // just hit the same wall. Wait ~25–35s instead of 500ms–1s.
        var waitMs = isRateLimit(lastError) ? (25000 + 10000 * attempt) : (500 * attempt);
        await new Promise(function (r) { setTimeout(r, waitMs); });
      }
    }
    item.status = 'failed';
    item.error = 'After ' + MAX_ATTEMPTS + ' attempts: ' + (lastError || 'Unknown error');
    renderList();
  }

  async function commit() {
    var patientClerk = getPatientClerk();
    var viewerClerk = getViewerClerk();
    if (!patientClerk) {
      var lang = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
      alert(lang === 'pt'
        ? 'Nenhum paciente selecionado — volte ao seletor e escolha um paciente primeiro.'
        : 'No patient context — return to the picker and choose a patient first.');
      return;
    }
    commitBtnEl.disabled = true;
    for (var i = 0; i < stagedFiles.length; i++) {
      var it = stagedFiles[i];
      if (it.status !== 'staged') continue;
      await uploadOne(it, patientClerk, viewerClerk);
    }
    commitBtnEl.disabled = stagedFiles.every(function (i) { return i.status !== 'staged'; });
  }

  /* ── Topnav button injection ────────────────────────────────────────── */

  function injectAddDataButton() {
    var anchor = document.querySelector('.signout-btn');
    if (!anchor) return;
    if (document.querySelector('.add-data-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'add-data-btn';
    btn.setAttribute('aria-label', document.documentElement.lang === 'pt' ? 'Adicionar dados' : 'Add or edit data');
    btn.setAttribute('title', document.documentElement.lang === 'pt' ? 'Adicionar dados' : 'Add or edit data');
    btn.onclick = openModal;
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '<line x1="12" y1="12" x2="12" y2="18"/>' +
        '<line x1="9" y1="15" x2="15" y2="15"/>' +
      '</svg>' +
      '<span class="add-data-btn-label">' +
        '<span class="lang-en">Add or edit data</span>' +
        '<span class="lang-pt">Adicionar dados</span>' +
      '</span>';
    var changeBtn = document.querySelector('.changepatient-btn');
    var parent = anchor.parentNode;
    if (changeBtn && changeBtn.parentNode === parent) {
      parent.insertBefore(btn, changeBtn);
    } else {
      parent.insertBefore(btn, anchor);
    }
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(injectAddDataButton);
})();
