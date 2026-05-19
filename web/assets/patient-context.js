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
 *      the section HTML is hard-coded — replace the page body with an
 *      empty-state shell. Once Add data ingests real content per patient,
 *      this guard relaxes per-section.
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

  function renderEmptyShell(clerkId) {
    // Hide everything in the body except scripts, the topnav, and our own shell.
    var kids = document.body.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.tagName === 'NAV' || el.tagName === 'SCRIPT' || el.classList.contains('jc-empty-shell')) continue;
      el.style.display = 'none';
    }
    var shell = document.createElement('main');
    shell.className = 'jc-empty-shell';
    shell.innerHTML =
      '<div class="jc-empty-card">' +
        '<div class="jc-empty-eyebrow">' +
          '<span class="lang-en">Patient record</span>' +
          '<span class="lang-pt">Prontuário do paciente</span>' +
        '</div>' +
        '<h1 class="jc-empty-title">' +
          '<span class="lang-en">No data yet for this patient.</span>' +
          '<span class="lang-pt">Sem dados ainda para este paciente.</span>' +
        '</h1>' +
        '<p class="jc-empty-body">' +
          '<span class="lang-en">The record is empty. Once files are ingested through <em>Add data</em>, they will appear in the appropriate sections — physical, mental, spiritual, labs, imaging, writings.</span>' +
          '<span class="lang-pt">O prontuário está vazio. Assim que arquivos forem enviados em <em>Adicionar dados</em>, eles aparecerão nas seções correspondentes — físico, mental, espiritual, exames, imagem, escritos.</span>' +
        '</p>' +
        '<div class="jc-empty-id">' + escapeHtml(clerkId) + '</div>' +
        '<button type="button" class="jc-empty-back" onclick="window.jcChangePatient && window.jcChangePatient()">' +
          '<span class="lang-en">← Choose another patient</span>' +
          '<span class="lang-pt">← Escolher outro paciente</span>' +
        '</button>' +
      '</div>';
    document.body.appendChild(shell);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
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
    if (patient !== PATIENT_ZERO) {
      renderEmptyShell(patient);
    }
  });
})();
