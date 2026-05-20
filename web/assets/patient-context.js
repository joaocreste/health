/* JC Advisory — patient-context.js
 *
 * Runs on every section page. Resolves the current patient, injects the
 * "Change patient" button, and — for any patient other than Patient Zero
 * (pending:joao), whose section pages are bespoke hardcoded HTML —
 * replaces the page body with a data-driven view.
 *
 * Page-aware rendering for non-Joao patients:
 *   /home              → three pillar cards (Physical, Mental, Spiritual)
 *                        + recent docs + recent labs + pending files
 *   /physical-exams    → labs grouped by panel + lab PDFs + imaging list
 *   any other section  → "empty for this patient" shell with back link
 *
 * Set window.JC_PUBLIC=true (login) or window.JC_PICKER_PAGE=true (picker)
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

  // ─── Page detection ─────────────────────────────────────────────
  function currentSection() {
    var p = location.pathname.replace(/\/+$/, '').toLowerCase();
    var last = p.split('/').pop() || 'home';
    last = last.replace(/\.html$/, '');
    if (!last || last === 'index') return 'home';
    return last; // 'home', 'physical', 'physical-exams', 'mental', 'spiritual', etc.
  }

  // ─── Helpers ────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
      if (el.tagName === 'NAV' || el.tagName === 'HEADER' || el.tagName === 'SCRIPT' ||
          el.classList.contains('jc-empty-shell') ||
          el.classList.contains('jc-overview') ||
          el.classList.contains('jc-exams')) continue;
      el.style.display = 'none';
    }
  }

  // ─── Renderers ──────────────────────────────────────────────────
  function renderPatientHeader(p) {
    var profileBits = [];
    if (p.date_of_birth) profileBits.push('DOB ' + formatDate(p.date_of_birth));
    if (p.sex) profileBits.push(escapeHtml(p.sex));
    if (p.country_of_residence) profileBits.push(escapeHtml(p.country_of_residence));
    if (p.native_language) profileBits.push('lang: ' + escapeHtml(p.native_language));
    return (
      '<header class="ov-header">' +
        '<div class="ov-eyebrow">Patient record</div>' +
        '<h1 class="ov-title">' + escapeHtml(p.full_name || 'Unnamed') + '</h1>' +
        '<div class="ov-profile">' + (profileBits.join(' · ') || '<em>No profile fields set.</em>') + '</div>' +
        '<div class="ov-id">' + escapeHtml(p.clerk_user_id || '') + '</div>' +
      '</header>'
    );
  }

  function renderPillarCard(name, total, breakdown, href, accent) {
    var rows = Object.keys(breakdown).map(function (k) {
      var label = k.replace(/_/g, ' ');
      var v = breakdown[k];
      return '<li class="pillar-row' + (v === 0 ? ' empty' : '') + '">' +
               '<span>' + escapeHtml(label) + '</span>' +
               '<span>' + v + '</span>' +
             '</li>';
    }).join('');
    var emptyNote = total === 0
      ? '<div class="pillar-empty">No data yet for this pillar.</div>' : '';
    return (
      '<section class="pillar-card pillar-' + accent + '">' +
        '<header class="pillar-head">' +
          '<h2>' + escapeHtml(name) + '</h2>' +
          '<div class="pillar-total">' + total + '</div>' +
        '</header>' +
        emptyNote +
        '<ul class="pillar-rows">' + rows + '</ul>' +
        '<a class="pillar-link" href="' + href + '">Open ' + escapeHtml(name) + ' →</a>' +
      '</section>'
    );
  }

  function renderPendingBanner(pending) {
    if (!pending || pending.length === 0) return '';
    return (
      '<div class="ov-pending">' +
        '<strong>' + pending.length + ' file' + (pending.length === 1 ? '' : 's') + ' did not process.</strong> ' +
        'Uploaded but classification or parsing failed (often an API billing or transient error). ' +
        '<ul class="ov-list">' +
          pending.map(function (f) {
            return '<li>' +
              '<span class="ov-list-title">' + escapeHtml(f.original_path || '(no name)') + '</span>' +
              '<span class="ov-list-meta">' + escapeHtml(f.status || '?') +
                (f.error_message ? ' — ' + escapeHtml(String(f.error_message).slice(0, 160)) : '') +
              '</span></li>';
          }).join('') +
        '</ul>' +
      '</div>'
    );
  }

  function renderDocList(docs) {
    if (!docs || docs.length === 0) return '<div class="ov-empty">No documents yet.</div>';
    return '<ul class="ov-list">' + docs.map(function (d) {
      var title = d.title || d.original_filename || '(untitled)';
      var date = d.document_date || (d.created_at && String(d.created_at).slice(0, 10));
      return '<li>' +
               '<span class="ov-list-title">' + escapeHtml(title) + '</span>' +
               '<span class="ov-list-meta">' +
                 escapeHtml(d.kind || '—') + ' · ' + escapeHtml(formatDate(date)) +
               '</span>' +
             '</li>';
    }).join('') + '</ul>';
  }

  function renderLabList(labs) {
    if (!labs || labs.length === 0) return '<div class="ov-empty">No lab results yet.</div>';
    return '<ul class="ov-list">' + labs.map(function (l) {
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
  }

  function renderHome(summary) {
    var p = summary.patient || {};
    var pillars = summary.pillars || {};
    var docs = summary.recent_documents || [];
    var labs = summary.recent_labs || [];
    var pending = summary.pending_files || [];

    var pillarsHtml =
      renderPillarCard('Physical',  pillars.physical  && pillars.physical.total  || 0, (pillars.physical  && pillars.physical.breakdown)  || {}, 'physical.html',  'physical') +
      renderPillarCard('Mental',    pillars.mental    && pillars.mental.total    || 0, (pillars.mental    && pillars.mental.breakdown)    || {}, 'mental.html',    'mental') +
      renderPillarCard('Spiritual', pillars.spiritual && pillars.spiritual.total || 0, (pillars.spiritual && pillars.spiritual.breakdown) || {}, 'spiritual.html', 'spiritual');

    var overview = document.createElement('main');
    overview.className = 'jc-overview';
    overview.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        renderPendingBanner(pending) +
        '<div class="pillar-grid">' + pillarsHtml + '</div>' +
        '<section class="ov-section">' +
          '<h2>Recent documents <span class="ov-count-inline">' + (summary.counts && summary.counts.documents || 0) + '</span></h2>' +
          renderDocList(docs) +
        '</section>' +
        '<section class="ov-section">' +
          '<h2>Recent lab results <span class="ov-count-inline">' + ((pillars.physical && pillars.physical.breakdown && pillars.physical.breakdown.lab_results) || 0) + '</span></h2>' +
          renderLabList(labs) +
        '</section>' +
      '</div>';
    document.body.appendChild(overview);
  }

  function renderExams(exams) {
    var p = exams.patient || {};
    var panels = exams.panels || [];
    var docs = exams.lab_documents || [];
    var imaging = exams.imaging || [];

    var panelsHtml = panels.length === 0
      ? '<div class="ov-empty">No lab results yet. Upload exam PDFs from Add data; once parsed they appear here grouped by panel.</div>'
      : panels.map(function (pn) {
          var rows = pn.markers.map(function (m) {
            var v = (m.latest_value != null) ? (m.latest_value + (m.unit ? ' ' + m.unit : '')) : (m.latest_value_text || '—');
            var ref = (m.ref_low != null || m.ref_high != null)
              ? (m.ref_low != null ? m.ref_low : '–') + ' – ' + (m.ref_high != null ? m.ref_high : '–')
              : '—';
            var pointsCount = m.points && m.points.length;
            var pointsCell = pointsCount > 1
              ? '<span title="' + pointsCount + ' data points" class="exam-points">' + pointsCount + '×</span>'
              : '';
            return '<tr>' +
              '<td class="exam-marker">' + escapeHtml(m.marker) + '</td>' +
              '<td class="exam-value">' + escapeHtml(String(v)) + fmtFlag(m.flag) + '</td>' +
              '<td class="exam-ref">' + escapeHtml(ref) + '</td>' +
              '<td class="exam-date">' + escapeHtml(formatDate(m.latest_taken_at)) + '</td>' +
              '<td class="exam-lab">' + escapeHtml(m.laboratory || '—') + '</td>' +
              '<td class="exam-trend">' + pointsCell + '</td>' +
            '</tr>';
          }).join('');
          return (
            '<section class="exam-panel">' +
              '<header class="exam-panel-head">' +
                '<h2>' + escapeHtml(pn.panel) + '</h2>' +
                '<span class="exam-panel-count">' + pn.markers.length + ' marker' + (pn.markers.length === 1 ? '' : 's') + '</span>' +
              '</header>' +
              '<table class="exam-table">' +
                '<thead><tr>' +
                  '<th>Marker</th><th>Latest value</th><th>Ref range</th><th>Date</th><th>Lab</th><th>Points</th>' +
                '</tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
              '</table>' +
            '</section>'
          );
        }).join('');

    var imagingHtml = imaging.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>Imaging studies <span class="ov-count-inline">' + imaging.length + '</span></h2>' +
        '<ul class="ov-list">' + imaging.map(function (s) {
          return '<li>' +
            '<span class="ov-list-title">' + escapeHtml(s.modality || '?') +
              (s.body_part ? ' · ' + escapeHtml(s.body_part) : '') + '</span>' +
            '<span class="ov-list-meta">' + escapeHtml(formatDate(s.study_date)) +
              (s.file_count ? ' · ' + s.file_count + ' files' : '') +
              ' · ' + escapeHtml(s.source_format || '—') +
            '</span></li>';
        }).join('') + '</ul>' +
      '</section>';

    var docsHtml = docs.length === 0 ? '' :
      '<section class="ov-section">' +
        '<h2>Source PDFs <span class="ov-count-inline">' + docs.length + '</span></h2>' +
        '<p class="ov-section-note">PDFs uploaded to this patient. Items marked "unclassified" landed here because the LLM classifier was unreachable when they were ingested.</p>' +
        renderDocList(docs) +
      '</section>';

    var view = document.createElement('main');
    view.className = 'jc-overview jc-exams';
    view.innerHTML =
      '<div class="ov-shell">' +
        renderPatientHeader(p) +
        '<div class="ov-section-eyebrow">Physical → Exams</div>' +
        panelsHtml +
        imagingHtml +
        docsHtml +
      '</div>';
    document.body.appendChild(view);
  }

  function renderEmptyShell(clerkId, patientName, sectionLabel) {
    var shell = document.createElement('main');
    shell.className = 'jc-empty-shell';
    shell.innerHTML =
      '<div class="jc-empty-card">' +
        '<div class="jc-empty-eyebrow">' + escapeHtml(sectionLabel || 'Patient record') + '</div>' +
        '<h1 class="jc-empty-title">' +
          'Not built yet for ' + escapeHtml(patientName || 'this patient') + '.' +
        '</h1>' +
        '<p class="jc-empty-body">' +
          'This section still uses Patient Zero\'s hardcoded layout. Data for ' +
          escapeHtml(patientName || 'this patient') + ' will appear here once a data-driven view is built.' +
        '</p>' +
        '<div class="jc-empty-id">' + escapeHtml(clerkId) + '</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">' +
          '<a href="home.html" class="jc-empty-back" style="text-decoration:none;display:inline-block;">← Back to summary</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(shell);
  }

  // ─── Styles ─────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('jc-overview-styles')) return;
    var s = document.createElement('style');
    s.id = 'jc-overview-styles';
    s.textContent = [
      '.jc-overview { padding: 32px 24px 96px; background: #F9F7F4; min-height: 100vh; }',
      '.ov-shell { max-width: 1080px; margin: 0 auto; }',
      '.ov-header { margin-bottom: 24px; }',
      '.ov-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7A8FA6; margin-bottom: 6px; }',
      '.ov-title { font-family: "Raleway", sans-serif; font-weight: 300; font-size: 32px; color: #0D1B2A; margin: 0 0 4px; }',
      '.ov-profile { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; color: #7A8FA6; margin-bottom: 4px; }',
      '.ov-id { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #B8954A; letter-spacing: 0.04em; }',
      '.ov-section { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }',
      '.ov-section h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #0D1B2A; margin: 0 0 14px; }',
      '.ov-count-inline { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: #7A8FA6; font-weight: 400; margin-left: 8px; letter-spacing: 0.04em; }',
      '.ov-section-note { font-size: 12px; color: #7A8FA6; margin: -6px 0 12px; }',
      '.ov-section-eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #B8954A; margin: 8px 0 16px; }',
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
      // Pillars
      '.pillar-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }',
      '@media (max-width: 880px) { .pillar-grid { grid-template-columns: 1fr; } }',
      '.pillar-card { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; min-height: 220px; }',
      '.pillar-card.pillar-physical  { border-top: 3px solid #244E6E; }',
      '.pillar-card.pillar-mental    { border-top: 3px solid #B8954A; }',
      '.pillar-card.pillar-spiritual { border-top: 3px solid #7A8FA6; }',
      '.pillar-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }',
      '.pillar-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 16px; color: #0D1B2A; margin: 0; letter-spacing: 0; text-transform: none; }',
      '.pillar-total { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 24px; color: #0D1B2A; }',
      '.pillar-empty { font-size: 12px; color: #7A8FA6; font-style: italic; margin-bottom: 8px; }',
      '.pillar-rows { list-style: none; padding: 0; margin: 0 0 14px; flex: 1; }',
      '.pillar-row { display: flex; justify-content: space-between; font-size: 12px; font-family: "IBM Plex Sans", sans-serif; padding: 4px 0; color: #0D1B2A; text-transform: capitalize; }',
      '.pillar-row.empty { opacity: 0.5; }',
      '.pillar-row span:last-child { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; }',
      '.pillar-link { font-family: "IBM Plex Mono", monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #B8954A; text-decoration: none; align-self: flex-start; border: 1px solid #B8954A; padding: 6px 12px; border-radius: 6px; transition: background 0.15s; }',
      '.pillar-link:hover { background: #FFF6E5; }',
      // Exam tables
      '.exam-panel { background: #FFFFFF; border: 1px solid #E5E2DC; border-radius: 10px; padding: 16px 20px; margin-bottom: 14px; }',
      '.exam-panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }',
      '.exam-panel-head h2 { font-family: "Raleway", sans-serif; font-weight: 700; font-size: 14px; color: #0D1B2A; margin: 0; text-transform: none; letter-spacing: 0; }',
      '.exam-panel-count { font-family: "IBM Plex Mono", monospace; font-size: 11px; color: #7A8FA6; letter-spacing: 0.04em; }',
      '.exam-table { width: 100%; border-collapse: collapse; font-family: "IBM Plex Sans", sans-serif; font-size: 13px; }',
      '.exam-table th { text-align: left; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #7A8FA6; padding: 8px 6px; border-bottom: 1px solid #E5E2DC; }',
      '.exam-table td { padding: 8px 6px; border-bottom: 1px solid #EFEBE3; vertical-align: top; }',
      '.exam-table tr:last-child td { border-bottom: none; }',
      '.exam-marker { color: #0D1B2A; font-weight: 500; }',
      '.exam-value { font-family: "IBM Plex Mono", monospace; color: #0D1B2A; }',
      '.exam-ref, .exam-date, .exam-lab { font-family: "IBM Plex Mono", monospace; color: #7A8FA6; font-size: 12px; }',
      '.exam-points { display: inline-block; background: #F4F1EA; border: 1px solid #DDD8CC; border-radius: 4px; padding: 1px 6px; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #7A8FA6; }',
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

    injectStyles();
    hidePageBody();

    var section = currentSection();

    if (section === 'home') {
      fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(renderHome)
        .catch(function () { renderEmptyShell(patient, null, 'Patient record'); });
      return;
    }

    if (section === 'physical-exams') {
      fetch('/api/patient-exams?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(renderExams)
        .catch(function () { renderEmptyShell(patient, null, 'Physical → Exams'); });
      return;
    }

    // Other section pages — show a small "not built yet" shell rather than the
    // home overview, so the user knows where they are.
    var labels = {
      'physical':          'Physical',
      'physical-vitals':   'Physical → Vitals',
      'physical-genetics': 'Physical → Genetics',
      'mental':            'Mental',
      'spiritual':         'Spiritual',
      'loops':             'Loops',
      'assessment':        'Assessment',
    };
    fetch('/api/patient-summary?clerk=' + encodeURIComponent(patient), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (summary) {
        renderEmptyShell(patient, summary.patient && summary.patient.full_name, labels[section] || section);
      })
      .catch(function () { renderEmptyShell(patient, null, labels[section] || section); });
  });
})();
