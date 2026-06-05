/* ════════════════════════════════════════════════════════════════════════════
 * Lumen Health — admin "Uploads to Review" queue (/uploads-review.html).
 *
 * Lists every patient upload (raw blobs awaiting manual ingestion). The admin
 * downloads each one, ingests on the terminal (separately), then sets status:
 * pending review / ingested / data error. The real auth gate is the endpoint
 * (X-Viewer-Clerk must resolve to role=admin); this page just renders the queue.
 *
 * Folder download: a single click can't stream a multi-GB zip through a Worker,
 * so a folder row expands to per-file presigned-GET links PLUS a copy-paste
 * rclone command for the R2 prefix — the admin is already on the terminal.
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (sessionStorage.getItem('jc_authed') !== 'true') { location.replace('index.html'); return; }
  var viewerClerk = sessionStorage.getItem('jc_viewer_clerk') || '';
  var viewerName = sessionStorage.getItem('jc_viewer_username') || '';

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
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(lang() === 'pt' ? 'pt-BR' : 'en-GB',
      { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { error: 'HTTP ' + r.status }; }
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  var STATUS_OPTS = [
    { v: 'pending_review', en: 'Pending review', pt: 'Em revisão' },
    { v: 'ingested',       en: 'Ingested',       pt: 'Processado' },
    { v: 'data_error',     en: 'Data error',     pt: 'Erro nos dados' },
  ];

  function render(uploads) {
    var tbody = document.getElementById('ur-tbody');
    var emptyEl = document.getElementById('ur-empty');
    var tableEl = document.getElementById('ur-table');
    if (!uploads || uploads.length === 0) { tableEl.style.display = 'none'; emptyEl.style.display = 'block'; return; }
    tableEl.style.display = ''; emptyEl.style.display = 'none';

    tbody.innerHTML = uploads.map(function (u) {
      var kindLabel = u.kind === 'folder'
        ? '<span class="lang-en">Folder</span><span class="lang-pt">Pasta</span>'
        : '<span class="lang-en">File</span><span class="lang-pt">Arquivo</span>';
      var meta = kindLabel + ' · ' + (u.kind === 'folder' ? (u.file_count + (lang() === 'pt' ? ' arquivos · ' : ' files · ')) : '') +
        humanSize(u.total_bytes) + ' · ' + esc(u.doc_ref);
      var noteCurrent = (u.status === 'data_error' && u.error_note) ? esc(u.error_note) : '';
      var sel = '<select class="ur-status-sel status-' + esc(u.status) + '" data-id="' + esc(u.id) + '">' +
        STATUS_OPTS.map(function (o) {
          return '<option value="' + o.v + '"' + (o.v === u.status ? ' selected' : '') + '>' +
            (lang() === 'pt' ? o.pt : o.en) + '</option>';
        }).join('') + '</select>';
      var noteBox = '<div class="ur-note' + (u.status === 'data_error' ? ' open' : '') + '" data-note-for="' + esc(u.id) + '">' +
        '<input type="text" class="ur-note-input" placeholder="' + (lang() === 'pt' ? 'Motivo do erro (opcional)' : 'Reason for error (optional)') + '" value="' + noteCurrent + '">' +
        '<button type="button" class="ur-note-save" data-id="' + esc(u.id) + '">' +
          '<span class="lang-en">Save note</span><span class="lang-pt">Salvar motivo</span></button>' +
        '</div>';
      return '<tr data-row="' + esc(u.id) + '">' +
        '<td><input type="checkbox" class="ur-check ur-row-check" data-check="' + esc(u.id) + '" aria-label="Select"></td>' +
        '<td class="ur-docref">' + esc(u.patient_clerk) + '</td>' +
        '<td>' + esc(u.patient_name || '') + '</td>' +
        '<td>' +
          '<div><strong>' + esc(u.original_name) + '</strong></div>' +
          '<div class="ur-row-meta">' + meta + ' · ' + esc(fmtDate(u.created_at)) + '</div>' +
          '<div style="margin-top:6px;"><button type="button" class="ur-dl" data-dl="' + esc(u.id) + '" data-kind="' + esc(u.kind) + '">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            '<span class="lang-en">Download</span><span class="lang-pt">Baixar</span></button></div>' +
          '<div class="ur-manifest" data-manifest-for="' + esc(u.id) + '"></div>' +
        '</td>' +
        '<td>' + sel + noteBox + '</td>' +
        '<td><button type="button" class="ur-del" data-del="' + esc(u.id) + '" data-name="' + esc(u.original_name) + '" data-ref="' + esc(u.doc_ref) + '">' +
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '<span class="lang-en">Delete</span><span class="lang-pt">Excluir</span></button></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.ur-status-sel').forEach(function (sel) {
      sel.addEventListener('change', function () { onStatusChange(sel); });
    });
    tbody.querySelectorAll('.ur-note-save').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var input = tbody.querySelector('.ur-note[data-note-for="' + id + '"] .ur-note-input');
        postStatus(id, 'data_error', input ? input.value : '');
      });
    });
    tbody.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () { onDownload(b.getAttribute('data-dl'), b.getAttribute('data-kind')); });
    });
    tbody.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { onDelete(b); });
    });
    tbody.querySelectorAll('.ur-row-check').forEach(function (cb) {
      cb.addEventListener('change', updateBulkState);
    });
    var all = document.getElementById('ur-check-all');
    if (all) all.checked = false;
    updateBulkState();
  }

  /* ── bulk selection + actions ── */
  function selectedIds() {
    return Array.prototype.slice.call(document.querySelectorAll('.ur-row-check:checked'))
      .map(function (cb) { return cb.getAttribute('data-check'); });
  }
  function updateBulkState() {
    var ids = selectedIds();
    var n = ids.length;
    var bar = document.getElementById('ur-bulkbar');
    var count = document.getElementById('ur-bulk-count');
    var applyBtn = document.getElementById('ur-bulk-apply');
    var delBtn = document.getElementById('ur-bulk-delete');
    var statusSel = document.getElementById('ur-bulk-status');
    if (count) count.textContent = n + (lang() === 'pt' ? (n === 1 ? ' selecionado' : ' selecionados') : ' selected');
    if (bar) { if (n === 0) bar.classList.add('disabled'); else bar.classList.remove('disabled'); }
    if (applyBtn) applyBtn.disabled = (n === 0 || !statusSel || !statusSel.value);
    if (delBtn) delBtn.disabled = (n === 0);
  }

  async function bulkApply() {
    var ids = selectedIds();
    var status = (document.getElementById('ur-bulk-status') || {}).value;
    if (!ids.length || !status) return;
    var applyBtn = document.getElementById('ur-bulk-apply');
    applyBtn.disabled = true;
    var errors = 0;
    for (var i = 0; i < ids.length; i++) {
      try { await api('/api/admin/uploads/status', { method: 'POST', body: JSON.stringify({ upload_id: ids[i], status: status }) }); }
      catch (e) { errors++; }
    }
    if (errors) alert((lang() === 'pt' ? 'Alguns não puderam ser atualizados: ' : 'Some could not be updated: ') + errors);
    load();
  }

  async function bulkDelete() {
    var ids = selectedIds();
    if (!ids.length) return;
    var msg = lang() === 'pt'
      ? ('Excluir definitivamente ' + ids.length + ' envio(s)?\n\nIsto remove os arquivos do armazenamento e das contas dos pacientes. Não pode ser desfeito.')
      : ('Permanently delete ' + ids.length + ' upload(s)?\n\nThis removes the files from storage and from the patients’ accounts. This cannot be undone.');
    if (!window.confirm(msg)) return;
    var delBtn = document.getElementById('ur-bulk-delete');
    delBtn.disabled = true;
    var errors = 0;
    for (var i = 0; i < ids.length; i++) {
      try { await api('/api/admin/uploads/delete', { method: 'POST', body: JSON.stringify({ upload_id: ids[i] }) }); }
      catch (e) { errors++; }
    }
    if (errors) alert((lang() === 'pt' ? 'Alguns não puderam ser excluídos: ' : 'Some could not be deleted: ') + errors);
    load();
  }

  function onDelete(btn) {
    var id = btn.getAttribute('data-del');
    var name = btn.getAttribute('data-name') || '';
    var ref = btn.getAttribute('data-ref') || '';
    var msg = lang() === 'pt'
      ? 'Excluir definitivamente este envio?\n\n' + name + ' (' + ref + ')\n\nIsto remove os arquivos do armazenamento e da conta do paciente. Não pode ser desfeito.'
      : 'Permanently delete this upload?\n\n' + name + ' (' + ref + ')\n\nThis removes the files from storage and from the patient’s account. This cannot be undone.';
    if (!window.confirm(msg)) return;
    btn.disabled = true;
    api('/api/admin/uploads/delete', { method: 'POST', body: JSON.stringify({ upload_id: id }) })
      .then(function () {
        var row = document.querySelector('tr[data-row="' + id + '"]');
        if (row) row.remove();
        if (!document.querySelectorAll('#ur-tbody tr').length) load(); // show empty state
      })
      .catch(function (e) {
        btn.disabled = false;
        alert((lang() === 'pt' ? 'Falha ao excluir: ' : 'Delete failed: ') + e.message);
      });
  }

  function onStatusChange(sel) {
    var id = sel.getAttribute('data-id');
    var val = sel.value;
    sel.className = 'ur-status-sel status-' + val;
    var noteBox = document.querySelector('.ur-note[data-note-for="' + id + '"]');
    if (val === 'data_error') {
      if (noteBox) noteBox.classList.add('open'); // let the admin type a reason, then Save note
      return; // do NOT post yet — wait for the note (Save posts it; empty note is allowed)
    }
    if (noteBox) noteBox.classList.remove('open');
    postStatus(id, val, null);
  }

  function postStatus(id, status, errorNote) {
    api('/api/admin/uploads/status', { method: 'POST', body: JSON.stringify({ upload_id: id, status: status, error_note: errorNote }) })
      .then(function () { load(); })
      .catch(function (e) { alert((lang() === 'pt' ? 'Falha ao atualizar status: ' : 'Status update failed: ') + e.message); load(); });
  }

  function onDownload(id, kind) {
    // Folders download as a single streamed ZIP (built server-side via the R2
    // binding) — one click, the whole folder at once.
    if (kind === 'folder') {
      window.open('/api/admin/uploads/' + encodeURIComponent(id) + '/download.zip?viewer=' + encodeURIComponent(viewerClerk), '_blank');
      return;
    }
    api('/api/admin/uploads/' + encodeURIComponent(id) + '/download')
      .then(function (data) {
        if (data.kind === 'file' && data.url) { window.open(data.url, '_blank'); return; }
        // folder -> expand a manifest panel with per-file links + a bulk command.
        var panel = document.querySelector('.ur-manifest[data-manifest-for="' + id + '"]');
        if (!panel) return;
        var files = data.files || [];
        var bucket = data.bucket || 'jc-health-uploads';
        var cmd = 'rclone copy "r2:' + bucket + '/' + data.r2_prefix + '" "./' + (data.doc_ref || 'upload') + '" --progress';
        panel.innerHTML =
          '<ul>' + files.map(function (f) {
            return '<li><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.relative_path) + '</a>' +
                   '<span class="ur-row-meta">' + humanSize(f.bytes) + '</span></li>';
          }).join('') + '</ul>' +
          '<div class="ur-row-meta" style="margin-bottom:4px;"><span class="lang-en">Or bulk-download the whole folder on the terminal:</span><span class="lang-pt">Ou baixe a pasta inteira no terminal:</span></div>' +
          '<input class="ur-cmd" readonly value="' + esc(cmd) + '">' +
          '<button type="button" class="ur-cmd-copy"><span class="lang-en">Copy command</span><span class="lang-pt">Copiar comando</span></button>';
        panel.classList.add('open');
        var copyBtn = panel.querySelector('.ur-cmd-copy');
        copyBtn.addEventListener('click', function () {
          var inp = panel.querySelector('.ur-cmd');
          inp.select();
          try { navigator.clipboard.writeText(cmd); } catch (e) { document.execCommand('copy'); }
          copyBtn.textContent = lang() === 'pt' ? 'Copiado!' : 'Copied!';
        });
      })
      .catch(function (e) { alert((lang() === 'pt' ? 'Falha no download: ' : 'Download failed: ') + e.message); });
  }

  function load() {
    api('/api/admin/uploads')
      .then(function (data) { render(data.uploads || []); })
      .catch(function (e) {
        var tbody = document.getElementById('ur-tbody');
        tbody.innerHTML = '<tr><td colspan="6" style="color:#8a2b2b;">' + esc(e.message) + '</td></tr>';
      });
  }

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    document.getElementById('admin-viewer').textContent = viewerName || viewerClerk;
    // Populate the bulk "change status to" dropdown (keep the leading "—").
    var bs = document.getElementById('ur-bulk-status');
    if (bs) {
      STATUS_OPTS.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.v; opt.textContent = (lang() === 'pt' ? o.pt : o.en);
        bs.appendChild(opt);
      });
      bs.addEventListener('change', updateBulkState);
    }
    var all = document.getElementById('ur-check-all');
    if (all) all.addEventListener('change', function () {
      var checked = this.checked;
      document.querySelectorAll('.ur-row-check').forEach(function (cb) { cb.checked = checked; });
      updateBulkState();
    });
    var applyBtn = document.getElementById('ur-bulk-apply');
    if (applyBtn) applyBtn.addEventListener('click', bulkApply);
    var delBtn = document.getElementById('ur-bulk-delete');
    if (delBtn) delBtn.addEventListener('click', bulkDelete);
    load();
  });
})();
