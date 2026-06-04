/* ════════════════════════════════════════════════════════════════════════════
 * Lumen Health — patient upload page (/upload.html).
 *
 * Files go DIRECT to R2 via presigned PUT — never through an /api route (the
 * 100MB Worker body cap can't carry large folders). Flow:
 *   stage files/folders  ->  POST /api/uploads/presign (get PUT URLs)
 *   ->  XHR PUT each file straight to R2 (per-item progress)
 *   ->  POST /api/uploads/complete (writes metadata rows, status pending_review)
 *   ->  refresh the "Your uploads" table.
 *
 * Upload != ingest: nothing here parses or classifies. An admin reviews each
 * upload and sets its status. Identity mirrors patient-context.js / add-data.js
 * (?patient= / sessionStorage; X-Viewer-Clerk header). Folder-walk logic mirrors
 * assets/add-data.js.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PUT_CONCURRENCY = 4;

  /* ── identity ── */
  function qp() { return new URLSearchParams(location.search); }
  function patientClerk() { return qp().get('patient') || sessionStorage.getItem('jc_current_patient') || ''; }
  function viewerClerk() { return sessionStorage.getItem('jc_viewer_clerk') || sessionStorage.getItem('jc_current_patient') || patientClerk(); }
  function lang() { return (document.documentElement.lang || 'en').toLowerCase().slice(0, 2); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function humanSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }
  function sanitizePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
      .split('/').map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== '.' && s !== '..'; }).join('/');
  }

  /* ── staged items: one per top-level file OR folder ── */
  var items = [];               // [{ id, kind, name, groupKey, files:[{file,relPath}], status, loaded, total, error }]
  var folderIndex = {};         // groupKey -> item (folders only)
  var counter = 0;

  function stageEntry(file, relPathRaw) {
    var relPath = sanitizePath(relPathRaw || file.name) || file.name;
    var slash = relPath.indexOf('/');
    if (slash === -1) {
      // loose file -> its own top-level item
      items.push({ id: ++counter, kind: 'file', name: relPath, groupKey: '__f' + counter,
        files: [{ file: file, relPath: relPath }], status: 'staged', loaded: 0, total: file.size || 0, error: null });
    } else {
      // file inside a folder -> group under the top-level folder name
      var top = relPath.slice(0, slash);
      var item = folderIndex[top];
      if (!item) {
        item = { id: ++counter, kind: 'folder', name: top, groupKey: top,
          files: [], status: 'staged', loaded: 0, total: 0, error: null };
        folderIndex[top] = item;
        items.push(item);
      }
      item.files.push({ file: file, relPath: relPath });
      item.total += file.size || 0;
    }
  }

  function addFileList(fileList, fromDir) {
    Array.prototype.forEach.call(fileList, function (file) {
      var rel = (fromDir && file.webkitRelativePath) ? file.webkitRelativePath
              : (file.webkitRelativePath || file.name);
      stageEntry(file, rel);
    });
    renderStaged();
  }

  // Recursive drag-drop walker (mirrors add-data.js).
  function handleDrop(dt) {
    if (!dt) return;
    var its = dt.items, anyEntry = false;
    if (its && its.length) {
      for (var i = 0; i < its.length; i++) {
        if (its[i].kind === 'file' && its[i].webkitGetAsEntry) { anyEntry = true; break; }
      }
    }
    if (!anyEntry) { if (dt.files) addFileList(dt.files, false); return; }
    var pending = 0, finished = false;
    function done() { if (finished && pending === 0) renderStaged(); }
    function walk(entry, prefix) {
      if (!entry) return;
      if (entry.isFile) {
        pending++;
        entry.file(function (f) { stageEntry(f, prefix + entry.name); pending--; done(); },
                   function () { pending--; done(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        (function readBatch() {
          pending++;
          reader.readEntries(function (entries) {
            entries.forEach(function (e) { walk(e, prefix + entry.name + '/'); });
            pending--;
            if (entries.length > 0) readBatch(); else done();
          }, function () { pending--; done(); });
        })();
      }
    }
    for (var j = 0; j < its.length; j++) {
      var entry = its[j].webkitGetAsEntry && its[j].webkitGetAsEntry();
      if (entry) walk(entry, '');
    }
    finished = true; done();
    renderStaged();
  }

  /* ── render staged list ── */
  var listEl, goBtn, toastEl;
  function stateLabel(item) {
    if (item.status === 'uploading') return lang() === 'pt' ? 'Enviando…' : 'Uploading…';
    if (item.status === 'done')     return lang() === 'pt' ? 'Enviado' : 'Uploaded';
    if (item.status === 'failed')   return lang() === 'pt' ? 'Falhou' : 'Failed';
    return lang() === 'pt' ? 'Em fila' : 'Queued';
  }
  function renderStaged() {
    if (items.length === 0) { listEl.innerHTML = ''; goBtn.disabled = true; return; }
    var fileIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    var folderIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    listEl.innerHTML = items.map(function (it) {
      var pct = it.total > 0 ? Math.round((it.loaded / it.total) * 100) : (it.status === 'done' ? 100 : 0);
      var meta = humanSize(it.total) + (it.kind === 'folder'
        ? ' · ' + it.files.length + (lang() === 'pt' ? ' arquivos' : ' files') : '');
      if (it.error) meta += ' · ' + esc(it.error);
      var removable = (it.status === 'staged');
      return '<li class="up-row ' + it.status + '" data-id="' + it.id + '">' +
        '<span class="up-row-icon">' + (it.kind === 'folder' ? folderIcon : fileIcon) + '</span>' +
        '<div class="up-row-main">' +
          '<div class="up-row-name">' + esc(it.name) + '</div>' +
          '<div class="up-row-meta">' + meta + '</div>' +
          '<div class="up-row-prog"><div class="up-row-prog-fill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<span class="up-row-state">' + esc(stateLabel(it)) + '</span>' +
        (removable ? '<button type="button" class="up-row-x" data-remove="' + it.id + '" aria-label="Remove">&times;</button>' : '') +
      '</li>';
    }).join('');
    listEl.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = parseInt(b.getAttribute('data-remove'), 10);
        var it = items.filter(function (x) { return x.id === id; })[0];
        if (it && it.kind === 'folder') delete folderIndex[it.groupKey];
        items = items.filter(function (x) { return x.id !== id; });
        renderStaged();
      });
    });
    goBtn.disabled = !items.some(function (it) { return it.status === 'staged'; });
  }

  function showToast(kind, en, pt) {
    toastEl.className = 'up-toast ' + kind;
    toastEl.innerHTML = '<span class="lang-en">' + esc(en) + '</span><span class="lang-pt">' + esc(pt) + '</span>';
  }
  function clearToast() { toastEl.className = 'up-toast'; toastEl.innerHTML = ''; }

  /* ── direct-to-R2 PUT with progress ── */
  function putFile(url, file, onProgress) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (file.type) xhr.setRequestHeader('Content-Type', file.type); // not signed — see worker presignPut
      if (xhr.upload) xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded); };
      xhr.onload = function () { resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status }); };
      xhr.onerror = function () { resolve({ ok: false, status: 0 }); };
      xhr.send(file);
    });
  }

  // Upload an item's files with bounded concurrency, aggregating loaded bytes.
  function uploadItemFiles(item, signedFiles) {
    var byPath = {};
    signedFiles.forEach(function (sf) { byPath[sf.relative_path] = sf; });
    var perLoaded = {};
    var queue = item.files.map(function (f, idx) { return { f: f, idx: idx }; });
    var results = new Array(item.files.length);
    var inFlight = 0, ptr = 0;
    return new Promise(function (resolve) {
      function pump() {
        if (ptr >= queue.length && inFlight === 0) { resolve(results); return; }
        while (inFlight < PUT_CONCURRENCY && ptr < queue.length) {
          (function (job) {
            var sf = byPath[job.f.relPath];
            inFlight++;
            if (!sf) { results[job.idx] = { ok: false }; inFlight--; setTimeout(pump, 0); return; }
            putFile(sf.put_url, job.f.file, function (loaded) {
              perLoaded[job.idx] = loaded;
              item.loaded = Object.keys(perLoaded).reduce(function (a, k) { return a + perLoaded[k]; }, 0);
              renderStaged();
            }).then(function (res) {
              perLoaded[job.idx] = job.f.file.size || 0;
              item.loaded = Object.keys(perLoaded).reduce(function (a, k) { return a + perLoaded[k]; }, 0);
              results[job.idx] = {
                ok: res.ok, relative_path: sf.relative_path, r2_key: sf.r2_key,
                bytes: job.f.file.size || 0, content_type: job.f.file.type || null,
              };
              inFlight--; renderStaged(); pump();
            });
          })(queue[ptr++]);
        }
      }
      pump();
    });
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk() }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { error: 'HTTP ' + r.status }; }
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  async function startUpload() {
    var pending = items.filter(function (it) { return it.status === 'staged'; });
    if (pending.length === 0) return;
    var pc = patientClerk();
    if (!pc) { showToast('err', 'No patient selected — return to the picker first.', 'Nenhum paciente selecionado — volte ao seletor.'); return; }
    clearToast();
    goBtn.disabled = true;

    // 1. presign — one manifest for all pending items.
    var manifest = pending.map(function (it) {
      return { group_id: it.id, kind: it.kind, name: it.name,
        files: it.files.map(function (f) { return { relative_path: f.relPath, size: f.file.size || 0, content_type: f.file.type || null }; }) };
    });
    var presign;
    try {
      presign = await api('/api/uploads/presign', { method: 'POST', body: JSON.stringify({ patient: pc, items: manifest }) });
    } catch (e) {
      var msg = /r2_s3_not_configured/.test(e.message) ? 'Uploads are not configured on the server yet. Please contact support.' : ('Could not start upload: ' + e.message);
      var msgPt = /r2_s3_not_configured/.test(e.message) ? 'Os envios ainda não estão configurados no servidor. Contate o suporte.' : ('Não foi possível iniciar o envio: ' + e.message);
      showToast('err', msg, msgPt); renderStaged(); return;
    }
    var presignByGroup = {};
    (presign.items || []).forEach(function (p) { presignByGroup[p.group_id] = p; });

    // 2. PUT every file straight to R2, then 3. complete.
    var completeItems = [];
    for (var i = 0; i < pending.length; i++) {
      var it = pending[i];
      var p = presignByGroup[it.id];
      if (!p) { it.status = 'failed'; it.error = lang() === 'pt' ? 'sem URL' : 'no URL'; renderStaged(); continue; }
      it.status = 'uploading'; it.loaded = 0; renderStaged();
      var fileResults = await uploadItemFiles(it, p.files);
      var okResults = fileResults.filter(function (r) { return r && r.ok; });
      it.status = okResults.length === it.files.length ? 'done' : (okResults.length > 0 ? 'done' : 'failed');
      if (it.status === 'failed') it.error = lang() === 'pt' ? 'envio falhou' : 'upload failed';
      renderStaged();
      if (okResults.length > 0) {
        completeItems.push({ upload_id: p.upload_id, kind: p.kind, original_name: p.original_name, r2_prefix: p.r2_prefix,
          files: okResults.map(function (r) { return { relative_path: r.relative_path, r2_key: r.r2_key, bytes: r.bytes, content_type: r.content_type, ok: true }; }) });
      }
    }

    if (completeItems.length === 0) { showToast('err', 'Upload failed. Please try again.', 'O envio falhou. Tente novamente.'); return; }
    try {
      await api('/api/uploads/complete', { method: 'POST', body: JSON.stringify({ patient: pc, items: completeItems }) });
      showToast('ok', 'Uploaded. Your documents are pending review.', 'Enviado. Seus documentos estão aguardando revisão.');
      // clear the finished items so the staging area resets; keep any still-staged
      items = items.filter(function (x) { return x.status === 'staged'; });
      folderIndex = {}; items.forEach(function (x) { if (x.kind === 'folder') folderIndex[x.groupKey] = x; });
      renderStaged();
      loadUploads();
    } catch (e) {
      showToast('err', 'Files uploaded but saving the record failed: ' + e.message, 'Arquivos enviados, mas o registro falhou: ' + e.message);
    }
  }

  /* ── "Your uploads" table ── */
  function statusPill(status) {
    if (status === 'ingested')   return '<span class="badge badge-success"><span class="lang-en">Ingested</span><span class="lang-pt">Processado</span></span>';
    if (status === 'data_error') return '<span class="badge badge-danger"><span class="lang-en">Data error</span><span class="lang-pt">Erro nos dados</span></span>';
    return '<span class="badge badge-warning"><span class="lang-en">Pending review</span><span class="lang-pt">Em revisão</span></span>';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(lang() === 'pt' ? 'pt-BR' : 'en-GB',
      { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  function loadUploads() {
    var tbody = document.getElementById('up-tbody');
    var emptyEl = document.getElementById('up-table-empty');
    var tableEl = document.getElementById('up-table');
    var pc = patientClerk();
    if (!pc) return;
    fetch('/api/uploads?patient=' + encodeURIComponent(pc), { headers: { 'Accept': 'application/json', 'X-Viewer-Clerk': viewerClerk() } })
      .then(function (r) { return r.ok ? r.json() : { uploads: [] }; })
      .catch(function () { return { uploads: [] }; })
      .then(function (data) {
        var rows = (data && data.uploads) || [];
        if (rows.length === 0) { tableEl.style.display = 'none'; emptyEl.style.display = 'block'; return; }
        tableEl.style.display = ''; emptyEl.style.display = 'none';
        tbody.innerHTML = rows.map(function (u) {
          var nameMeta = u.kind === 'folder'
            ? ' <span class="up-row-meta">(' + u.file_count + (lang() === 'pt' ? ' arquivos' : ' files') + ')</span>' : '';
          var note = (u.status === 'data_error' && u.error_note)
            ? '<div class="up-row-meta" style="color:var(--red-700,#8a2b2b)">' + esc(u.error_note) + '</div>' : '';
          return '<tr>' +
            '<td>' + esc(u.original_name) + nameMeta + note + '</td>' +
            '<td class="up-docref">' + esc(u.doc_ref) + '</td>' +
            '<td>' + esc(fmtDate(u.created_at)) + '</td>' +
            '<td>' + statusPill(u.status) + '</td>' +
          '</tr>';
        }).join('');
      });
  }

  /* ── wire up ── */
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    // Preserve patient context on the back/brand links.
    var pc = patientClerk();
    if (pc) {
      var bl = document.getElementById('up-back-link'); if (bl) bl.href = 'home.html?patient=' + encodeURIComponent(pc);
      var br = document.getElementById('up-brand'); if (br) br.href = 'home.html?patient=' + encodeURIComponent(pc);
    }
    listEl = document.getElementById('up-list');
    goBtn = document.getElementById('up-go');
    toastEl = document.getElementById('up-toast');

    var drop = document.getElementById('up-drop');
    var inputFiles = document.getElementById('up-input-files');
    var inputDir = document.getElementById('up-input-dir');

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover'); });
    });
    drop.addEventListener('drop', function (e) { handleDrop(e.dataTransfer); });
    drop.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== drop) { if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'A') return; t = t.parentNode; }
      inputFiles.click();
    });
    document.getElementById('up-pick-files').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); inputFiles.click(); });
    document.getElementById('up-pick-dir').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); inputDir.click(); });
    inputFiles.addEventListener('change', function () { addFileList(inputFiles.files, false); inputFiles.value = ''; });
    inputDir.addEventListener('change', function () { addFileList(inputDir.files, true); inputDir.value = ''; });

    document.getElementById('up-clear').addEventListener('click', function () { items = []; folderIndex = {}; clearToast(); renderStaged(); });
    goBtn.addEventListener('click', startUpload);

    renderStaged();
    loadUploads();
  });
})();
