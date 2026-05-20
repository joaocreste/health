/* JC Advisory — patient-context.js
 *
 * Runs on every section page (Summary, Physical, Mental, Spiritual, Loops,
 * Assessment, Physical-Exams, Physical-Vitals, Physical-Genetics). Three jobs:
 *
 *   1. Resolve the "current patient" from ?patient=<clerk_user_id> in the URL
 *      or sessionStorage.jc_current_patient. If neither is set, bounce back
 *      to the picker.
 *
 *   2. Inject a "Change patient" button into the topnav alongside Sign out.
 *
 *   3. If the current patient is NOT Patient Zero (pending:joao) — for whom
 *      the section HTML is hard-coded — fetch /api/patient-summary and render
 *      an overview panel (counts + recent documents/labs + pending files).
 *      Falls back to an empty-state shell only if the DB has zero rows.
 *
 * Set window.JC_PUBLIC = true (login) or window.JC_PICKER_PAGE = true (picker)
 * before this script loads to skip everything.
 */
(function () {
  'use strict';

  if (window.JC_PUBLIC === true || window.JC_PICKER_PAGE === true) return;

  var PATIENT_ZERO = 'pending:joao';

  var params = new URLSearchParams(location.search);
  var fromUrl = params.get('patient');
  var stored = sessionStorage.getItem('jc_current_patient');
  var patient = fromUrl || stored;

  if (!patient) {
    location.replace('patients.html');
    return;
  }
  if (fromUrl && fromUrl !== stored) {
    sessionStorage.setItem('jc_current_patient', fromUrl);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function injectChangeButton() {
    var signOut = document.querySelector('.signout-btn');
    if (!signOut) return;
    if (document.querySelector('.changepatient-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'changepatient-btn';
    btn.setAttribute('aria-label', 'Change patient');
    btn.setAttribute('title', 'Change patient');
    btn.onclick = function () {
      if (typeof window.jcChangePatient === 'function') {
        window.jcChangePatient();
      } else {
        sessionStorage.removeItem('jc_current_patient');
        location.href = 'patients.html';
      }
    };
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>' +
        '<circle cx="9" cy="7" r="4"/>' +
        '<polyline points="16 11 18 13 22 9"/>' +
        '<polyline points="22 13 18 9"/>' +
      '</svg>' +
      '<span class="changepatient-label">' +
        '<span class="lang-en">Change patient</span>' +
        '<span class="lang-pt">Trocar paciente</span>' +
      '</span>';
    signOut.parentNode.insertBefore(btn, signOut);
  }

  function hidePageBody() {
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === 'NAV' || el.tagName === 'SCRIPT' || el.classList.contains('jc-empty-shell') || el.classList.contains('jc-overview')) continue;
      el.style.display = 'none';
    }
  }

  function renderEmptyShell(clerkId, patientName) {
    var shell = document.createElement('main');
    shell.className = 'jc-empty-shell';
    shell.innerHTML =
      '<div class="jc-empty-card">' +
        '<div class="jc-empty-eyebrow">' +
          '<span class="lang-en">Patient record</span>' +
          '<span class="lang-pt">Prontuário do paciente</span>' +
        '</div>' +
        '<h1 class="jc-empty-title">' +
          '<span class="lang-en">No data yet for ' + escapeHtml(patientName || 'this patient') + '.</span>' +
          '<span class="lang-pt">Sem dados ainda para ' + escapeHtml(patientName || 'este paciente') + '.</span>' +
        '</h1>' +
        '<p class="jc-empty-body">' +
          '<span class="lang-en">The record is empty. Use <em>Add data</em> to upload files; they will appear here once ingested.</span>' +
          '<span class="lang-pt">O prontuário está vazio. Use <em>Adicionar dados</em> para enviar arquivos; eles aparecerão aqui após o processamento.</span>' +
        '</p>' +
        '<div class="jc-empty-id">' + escapeHtml(clerkId) + '</div>' +
        '<button type="button" class="jc-empty-back" onclick="window.jcChangePatient && window.jcChangePatient()">' +
          '<span class="lang-en">← Choose another patient</span>' +
          '<span class="lang-pt">← Escolher outro paciente</span>' +
        '</button>' +
      '</div>';
    document.body.appendChild(shell);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var s = String(iso);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : s;
  }

  function fmtFlag(flag) {
    if (!flag) return '';
    var cls = (flag === 'H' || flag === 'HH') ? 'high'
            : (flag === 'L' || flag === 'LL') ? 'low'
            : 'norm';
    return ' <span class="lab-flag ' + cls + '">' + escapeHtml(flag) + '</span>';
  }

  function renderOverview(summary) {
    var p = summary.patient || {};
    var counts = summary.counts || {};
    var docs = summary.recent_documents || [];
    var labs = summary.recent_labs || [];
    var pending = summary.pending_files || [];

    var profileBits = [];
    if (p.date_of_birth) profileBits.push('DOB ' + formatDate(p.date_of_birth));
    if (p.sex) profileBits.push(escapeHtml(p.sex));
    if (p.country_of_residence) profileBits.push(escapeHtml(p.country_of_residence));
    if (p.native_language) profileBits.push('lang: ' + escapeHtml(p.native_language));

    var countCards = [
      { k: 'documents',       label: 'Documents'   },
      { k: 'lab_results',     label: 'Lab results' },
      { k: 'imaging_studies', label: 'Imaging'     },
      { k: 'medications',     label: 'Medications' },
      { k: 'writings',        label: 'Writings'    },
      { k: 'encounters',      label: 'Encounters'  },
      { k: 'imports',         label: 'Imports'     },
    ].map(function (c) {
      var n = counts[c.k] || 0;
      return '<div class="ov-count' + (n === 0 ? ' empty' : '') + '">' +
               '<div class="ov-count-n">' + n + '</div>' +
               '<div class="ov-count-l">' + c.label + '</div>' +
             '</div>';
    }).join('');

    var docList = docs.length === 0
      ? '<div class="ov-empty">No documents yet.</div>'
      : '<ul class="ov-list">' + docs.map(function (d) {
          var title = d.title || d.original_filename || '(untitled)';
          var date = d.document_date || (d.created_at && String(d.created_at).slice(0, 10));
          return '<li>' +
                   '<span class="ov-list-title">' + escapeHtml(title) + '</span>' +
                   '<span class="ov-list-meta">' +
                     escapeHtml(d.kind || '—') + ' · ' + escapeHtml(formatDate(date)) +
                   '</span>' +
                 '</li>';
        }).join('') + '</ul>';

    var labList = labs.length === 0
      ? '<div class="ov-empty">No lab results yet.</div>'
      : '<ul class="ov-list">' + labs.map(function (l) {
          var v = (l.value != null) ? (l.value + (l.unit ? ' ' + l.unit : '')) : (l.value_text || '—');
          var ref = (l.ref_low != null || l.ref_high != null)
            ? ' (ref ' + (l.ref_low != null ? l.ref_low : '–') + '–' + (l.ref_high != null ? l.ref_high : '–') + ')' : '';
          return '<li>' +
                   '<span class="ov-list-title">' + escapeHtml(l.marker || '—') + fmtFlag(l.flag) + '</span>' +
                   '<span class="ov-list-meta">' +
                     escapeHtml(v) + escapeHtml(ref) + ' · ' + escapeHtml(formatDate(l.taken_at)) +
                     (l.panel ? ' · ' + escapeHtml(l.panel) : '') +
                   '</span>' +
                 '</li>';
        }).join('') + '</ul>';

    var pendingBlock = pending.length === 0 ? '' :
      '<div class="ov-pending">' +
        '<strong>' + pending.length + ' file' + (pending.length === 1 ? '' : 's') + ' did not process.</strong> ' +
        'They were uploaded but classification or parsing failed (often a billing or transient error). ' +
        '<ul class="ov-list">' +
          pending.map(function (f) {
            return '<li>' +
              '<span class="ov-list-title">' + escapeHtml(f.original_path || '(no name)') + '</span>' +
              '<span class="ov-list-meta">' + escapeHtml(f.status || '?') +
                (f.error_message ? ' — ' + escapeHtml(String(f.error_message).slice(0, 160)) : '') +
              '</span></li>';
          }).join('') +
        '</ul>' +
      '</div>';

    var overview = document.createElement('main');
    overview.className = 'jc-overview';
    overview.innerHTML =
      '<div class="ov-shell">' +
        '<header class="ov-header">' +
          '<div class="ov-eyebrow">Patient record</div>' +
          '<h1 class="ov-title">' + escapeHtml(p.full_name || 'Unnamed') + '</h1>' +
          '<div class="ov-profile">' + (profileBits.join(' · ') || '<em>No profile fields set.</em>') + '</div>' +
          '<div class="ov-id">' + escapeHtml(p.clerk_user_id || '') + '</div>' +
        '</header>' +

        '<section class="ov-section">' +
          '<h2>Counts</h2>' +
          '<div class="ov-counts">' + countCards + '</div>' +
        '</section>' +

        pendingBlock +

        '<section class="ov-section">' +
          '<h2>Recent documents</h2>' + docList +
        '</section>' +

        '<section class="ov-section">' +
          '<h2>Recent lab results</h2>' + labList +
        '</section>' +

        '<p class="ov-footnote">Section pages (Physical, Mental, Spiritual…) still show Patient Zero only — per-patient rendering for those sections is not built yet.</p>' +
      '</div>';
    document.body.appendChild(overview);
  }

  function injectOverviewStyles() {
    if (document.getElementById('jc-overview-styles')) return;
    var s = document.createElement('style');
    s.id = 'jc-overview-styles';
    s.textContent = [
      '.jc-overview { padding: 32px 24px 96px; background: #F9F7F4; min-height: 100vh; }',
      '.ov-shell { max-width: 980px; margin: 0 auto; }',
      '.ov-header { margin-bottom: 28px; }',
      '.ov-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 6px; }',
      '.ov-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; color: #0D1B2A; margin: 0 0 4px; }',
      '.ov-profile { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; color: #7A8FA6; margin-bottom: 4px; }',
      '.ov-id { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #B8954A; letter-spacing: 0.04em; }',
      '.ov-section { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }',
      '.ov-section h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0 0 14px; }',
      '.ov-counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }',
      '.ov-count { background: #F4F1EA; border: 1px solid #DDD8CC; border-radius: 8px; padding: 12px; text-align: center; }',
      '.ov-count.empty { opacity: 0.55; }',
      '.ov-count-n { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 22px; color: #0D1B2A; }',
      '.ov-count-l { font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; margin-top: 4px; }',
      '.ov-list { list-style: none; padding: 0; margin: 0; }',
      '.ov-list li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #EFEBE3; font-size: 13px; }',
      '.ov-list li:first-child { border-top: none; }',
      '.ov-list-title { color: #0D1B2A; font-family: "IBM Plex Sans", sans-serif; font-weight: 500; }',
      '.ov-list-meta { color: #7A8FA6; font-family: "IBM Plex Mono", monospace; font-size: 11px; }',
      '.ov-empty { font-size: 13px; color: #7A8FA6; font-style: italic; }',
      '.ov-pending { background: #FBE9E7; border: 1px solid #E5B5AB; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; color: #7A2E22; }',
      '.ov-pending strong { color: #7A2E22; }',
      '.ov-pending .ov-list { margin-top: 8px; }',
      '.ov-pending .ov-list li { border-top-color: #E5B5AB; }',
      '.ov-pending .ov-list-title { color: #7A2E22; }',
      '.ov-pending .ov-list-meta { color: #9c5446; }',
      '.lab-flag { font-family: "IBM Plex Mono", monospace; font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }',
      '.lab-flag.high { background: #FBE9E7; color: #7A2E22; border: 1px solid #E5B5AB; }',
      '.lab-flag.low  { background: #E7EEFB; color: #22417A; border: 1px solid #ABBFE5; }',
      '.lab-flag.norm { background: #F0EEE9; color: #7A8FA6; border: 1px solid #DDD8CC; }',
      '.ov-footnote { font-size: 11px; color: #7A8FA6; font-family: "IBM Plex Mono", monospace; text-align: center; margin-top: 24px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    injectChangeButton();
    if (patient === PATIENT_ZERO) return;

    injectOverviewStyles();
    hidePageBody();

    fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), {
      headers: { 'Accept': 'application/json' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (summary) {
        var totalRows =
          (summary.counts.documents || 0) +
          (summary.counts.lab_results || 0) +
          (summary.counts.imaging_studies || 0) +
          (summary.counts.medications || 0) +
          (summary.counts.writings || 0) +
          (summary.counts.encounters || 0);
        if (totalRows === 0 && (summary.pending_files || []).length === 0) {
          renderEmptyShell(patient, summary.patient && summary.patient.full_name);
        } else {
          renderOverview(summary);
        }
      })
      .catch(function () {
        renderEmptyShell(patient, null);
      });
  });
})();
