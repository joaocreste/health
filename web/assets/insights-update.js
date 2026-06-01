/* ════════════════════════════════════════════════════════════════════════════
 * Lumen Health — "Update AI Insights" button + async progress.
 *
 * Drops onto EVERY patient page (Summary/Physical/Exams/Vitals/Genetics/Mental/
 * Spiritual), static (Joao) and bespoke (Paulo/Silvana/Leo) alike. One button,
 * one behaviour everywhere: a WHOLE-PATIENT rebuild — never page-scoped.
 *
 * Flow:
 *   idle button -> click -> confirm modal (blue Yes / muted No)
 *   -> POST /api/patient-dashboard-build { patient }  (202 job_id, or 200 if a
 *      job is already running, or 429 cooldown)
 *   -> poll GET /api/patient-dashboard-build/status?job_id=... every ~1.8s
 *   -> on succeeded: fill to 100%, refresh the AI cards in place, show "just now"
 *   -> on failed: inline non-alarming error; old insights stay visible.
 *
 * Loaded AFTER patient-context.js, which exposes window.jcRefreshAiInsights(sec)
 * to re-render the insight cards without a full reload. Identity matches
 * patient-context.js exactly (?patient= / sessionStorage; X-Viewer-Clerk header).
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var COOLDOWN_MS = 3 * 60 * 1000;            // mirror server INSIGHT_COOLDOWN_MS
  var POLL_MS = 1800;

  /* ── identity (same resolution as patient-context.js) ── */
  function qp() { return new URLSearchParams(location.search); }
  function patientClerk() {
    return qp().get('patient') || sessionStorage.getItem('jc_current_patient') || '';
  }
  function viewerClerk() {
    return sessionStorage.getItem('jc_viewer_clerk')
        || sessionStorage.getItem('jc_current_patient') || patientClerk();
  }
  function section() {
    var p = location.pathname.replace(/\/+$/, '').toLowerCase().split('/').pop().replace(/\.html$/, '');
    return (!p || p === 'index') ? 'home' : p;
  }

  /* ── bilingual helpers (CSS hides whichever .lang-* != html[lang]) ── */
  function t(en, pt) { return '<span class="lang-en">' + en + '</span><span class="lang-pt">' + pt + '</span>'; }
  function tPlain(en, pt) {
    var l = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
    return l === 'pt' ? pt : en;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var STAGE_LABEL = {
    queued:        ['Queued', 'Na fila'],
    fetching:      ['Reading your data', 'Lendo seus dados'],
    interpolating: ['Preparing', 'Preparando'],
    generating:    ['Synthesizing insights', 'Sintetizando insights'],
    validating:    ['Validating', 'Validando'],
    persisting:    ['Saving', 'Salvando'],
  };

  function relWhen(iso) {
    if (!iso) return '';
    var secs = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return t('just now', 'agora mesmo');
    if (secs < 3600) { var m = Math.floor(secs / 60); return t(m + ' min ago', 'há ' + m + ' min'); }
    if (secs < 86400) { var h = Math.floor(secs / 3600); return t(h + 'h ago', 'há ' + h + 'h'); }
    var d = Math.floor(secs / 86400); return t(d + 'd ago', 'há ' + d + 'd');
  }

  /* ── styles (uses the global design tokens; amber from styles.css) ── */
  function injectStyles() {
    if (document.getElementById('iu-styles')) return;
    var css = [
      '.iu-wrap{max-width:880px;margin:26px auto 4px;padding:0 22px;font-family:var(--font-body,system-ui);}',
      '.iu-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}',
      '.iu-btn{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--accent-petrol,#244E6E);',
        'background:var(--accent-petrol,#244E6E);color:#fff;font-family:var(--font-display,sans-serif);',
        'font-size:.9rem;font-weight:600;padding:10px 16px;border-radius:10px;cursor:pointer;',
        'transition:background .15s,box-shadow .15s;box-shadow:var(--shadow-sm,0 1px 2px rgba(18,42,61,.06));}',
      '.iu-btn:hover{background:var(--accent-petrol-light,#4D7BA0);border-color:var(--accent-petrol-light,#4D7BA0);}',
      '.iu-btn:disabled{opacity:.55;cursor:not-allowed;background:var(--accent-petrol,#244E6E);}',
      '.iu-btn svg{flex:none;}',
      '.iu-sub{font-size:.76rem;color:var(--text-muted,#7A8FA6);line-height:1.4;}',
      '.iu-meta{font-size:.76rem;color:var(--text-muted,#7A8FA6);}',
      '.iu-newdata{font-size:.72rem;color:var(--accent-gold,#B8860B);font-weight:600;}',
      // progress
      '.iu-prog{display:none;flex-direction:column;gap:7px;width:100%;max-width:460px;}',
      '.iu-prog.iu-on{display:flex;}',
      '.iu-prog-top{display:flex;justify-content:space-between;align-items:baseline;font-size:.8rem;color:var(--text-secondary,#1E2D3D);}',
      '.iu-prog-pct{font-family:var(--font-mono,monospace);font-weight:600;color:var(--accent-petrol,#244E6E);}',
      '.iu-bar{height:8px;border-radius:999px;background:var(--surface-cool,#EEF3F6);overflow:hidden;}',
      '.iu-bar-fill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,var(--accent-petrol,#244E6E),var(--accent-petrol-light,#4D7BA0));transition:width .6s ease;}',
      '.iu-err{display:none;margin-top:8px;font-size:.82rem;color:#8a3a2e;background:#fbeae6;border:1px solid #f3cfc6;border-radius:8px;padding:8px 11px;}',
      '.iu-err.iu-on{display:block;}',
      // confirm modal
      '.iu-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
        'background:rgba(6,13,28,.55);padding:20px;}',
      '.iu-modal{background:var(--surface-pure,#fff);color:var(--text-primary,#0D1B33);border-radius:16px;',
        'max-width:440px;width:100%;padding:26px 26px 22px;box-shadow:var(--shadow-lg,0 12px 32px rgba(18,42,61,.18));}',
      '.iu-modal-title{font-family:var(--font-display,sans-serif);font-size:1.2rem;font-weight:700;margin:0 0 10px;}',
      '.iu-modal-body{font-size:.9rem;line-height:1.55;color:var(--text-secondary,#1E2D3D);margin:0 0 20px;}',
      '.iu-modal-btns{display:flex;gap:10px;justify-content:flex-end;}',
      '.iu-yes{background:var(--accent-petrol,#244E6E);color:#fff;border:1px solid var(--accent-petrol,#244E6E);',
        'font-family:var(--font-display,sans-serif);font-size:.9rem;font-weight:700;padding:10px 18px;border-radius:10px;cursor:pointer;}',
      '.iu-yes:hover{background:var(--accent-petrol-light,#4D7BA0);border-color:var(--accent-petrol-light,#4D7BA0);}',
      '.iu-no{background:var(--surface-cool,#EEF3F6);color:var(--text-secondary,#44535f);border:1px solid var(--border-default,#d4dbe1);',
        'font-family:var(--font-display,sans-serif);font-size:.9rem;font-weight:500;padding:10px 16px;border-radius:10px;cursor:pointer;}',
      '.iu-no:hover{background:var(--surface-cool,#E4ebf0);}',
    ].join('');
    var s = document.createElement('style');
    s.id = 'iu-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── DOM build ── */
  var refreshIcon =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';

  function buildWrap() {
    var wrap = document.createElement('div');
    wrap.className = 'iu-wrap';
    wrap.setAttribute('data-insights-update', '1');
    wrap.innerHTML =
      '<div class="iu-row">' +
        '<button type="button" class="iu-btn" data-iu-btn>' + refreshIcon +
          t('Update AI Insights', 'Atualizar Insights de IA') + '</button>' +
        '<div class="iu-sub" data-iu-sub>' +
          t('Re-reviews all your data and refreshes insights across every page',
            'Revisa todos os seus dados e atualiza os insights em todas as páginas') +
        '</div>' +
        '<div class="iu-prog" data-iu-prog>' +
          '<div class="iu-prog-top">' +
            '<span data-iu-stage>' + t('Updating', 'Atualizando') + '</span>' +
            '<span class="iu-prog-pct" data-iu-pct>0%</span>' +
          '</div>' +
          '<div class="iu-bar"><div class="iu-bar-fill" data-iu-fill></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="iu-meta" data-iu-meta></div>' +
      '<div class="iu-err" data-iu-err></div>';
    return wrap;
  }

  function q(root, sel) { return root.querySelector(sel); }

  /* ── confirmation modal ── */
  function openConfirm(onYes) {
    var ov = document.createElement('div');
    ov.className = 'iu-ov';
    ov.innerHTML =
      '<div class="iu-modal" role="dialog" aria-modal="true">' +
        '<h2 class="iu-modal-title">' + t('Update AI insights?', 'Atualizar insights de IA?') + '</h2>' +
        '<p class="iu-modal-body">' +
          t('This re-reviews all of your data and regenerates insights across every page. Your underlying health data is not changed. This can take a minute.',
            'Isto revisa todos os seus dados e regenera os insights em todas as páginas. Seus dados de saúde não são alterados. Pode levar um minuto.') +
        '</p>' +
        '<div class="iu-modal-btns">' +
          '<button type="button" class="iu-no" data-iu-no>' + t('No, cancel', 'Não, cancelar') + '</button>' +
          '<button type="button" class="iu-yes" data-iu-yes>' + t('Yes, update', 'Sim, atualizar') + '</button>' +
        '</div>' +
      '</div>';
    function close() {
      document.removeEventListener('keydown', onKey);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });        // backdrop cancels
    q(ov, '[data-iu-no]').addEventListener('click', close);                              // No cancels
    q(ov, '[data-iu-yes]').addEventListener('click', function () { close(); onYes(); }); // Yes proceeds
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    q(ov, '[data-iu-yes]').focus();
  }

  /* ── controller per mounted wrap ── */
  function wire(wrap) {
    var btn = q(wrap, '[data-iu-btn]');
    var sub = q(wrap, '[data-iu-sub]');
    var prog = q(wrap, '[data-iu-prog]');
    var stageEl = q(wrap, '[data-iu-stage]');
    var pctEl = q(wrap, '[data-iu-pct]');
    var fill = q(wrap, '[data-iu-fill]');
    var meta = q(wrap, '[data-iu-meta]');
    var errEl = q(wrap, '[data-iu-err]');
    var polling = false;

    function showError(msgEn, msgPt) {
      errEl.innerHTML = t(esc(msgEn), esc(msgPt));
      errEl.classList.add('iu-on');
    }
    function clearError() { errEl.classList.remove('iu-on'); errEl.innerHTML = ''; }

    function setIdle() {
      prog.classList.remove('iu-on');
      sub.style.display = '';
      btn.style.display = '';
      btn.disabled = false;
    }
    function setProgressUI(pct, stageKey) {
      sub.style.display = 'none';
      btn.style.display = 'none';
      prog.classList.add('iu-on');
      var p = Math.max(0, Math.min(100, pct || 0));
      fill.style.width = p + '%';
      pctEl.textContent = p + '%';
      var lab = STAGE_LABEL[stageKey];
      stageEl.innerHTML = lab
        ? t(esc(lab[0]), esc(lab[1]))
        : t('Updating', 'Atualizando');
    }
    function setCooldown(generatedAt, minutesAgo) {
      btn.disabled = true;
      var n = (minutesAgo != null) ? minutesAgo : 0;
      meta.innerHTML = (n <= 0)
        ? t('Updated just now', 'Atualizado agora mesmo')
        : t('Updated ' + n + ' minute' + (n === 1 ? '' : 's') + ' ago',
            'Atualizado há ' + n + ' minuto' + (n === 1 ? '' : 's'));
      var remain = generatedAt ? (COOLDOWN_MS - (Date.now() - new Date(generatedAt).getTime())) : 0;
      if (remain > 0) setTimeout(function () { btn.disabled = false; refreshMeta(); }, remain + 500);
    }

    function refreshCards() {
      try {
        if (typeof window.jcRefreshAiInsights === 'function') window.jcRefreshAiInsights(section());
        else location.reload();
      } catch (e) { /* leave existing cards in place */ }
    }

    // Show "last updated" + new-data hint from the persisted dashboard row.
    function refreshMeta() {
      fetch('/api/patient-dashboard?clerk=' + encodeURIComponent(patientClerk()), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { sections: {} }; })
        .catch(function () { return { sections: {} }; })
        .then(function (data) {
          var rec = data && data.sections && data.sections['ai-insights'];
          if (!rec || !rec.generated_at) { meta.innerHTML = t('Not generated yet', 'Ainda não gerado'); return; }
          var ageMs = Date.now() - new Date(rec.generated_at).getTime();
          meta.innerHTML = '<span class="iu-metawhen">' + t('Insights updated ', 'Insights atualizados ') + '</span>'
            + relWhen(rec.generated_at);
          if (ageMs >= 0 && ageMs < COOLDOWN_MS && !polling) {
            setCooldown(rec.generated_at, Math.floor(ageMs / 60000));
          }
        });
    }

    function poll(jobId) {
      polling = true;
      var dead = false;
      function tick() {
        if (dead) return;
        fetch('/api/patient-dashboard-build/status?job_id=' + encodeURIComponent(jobId), {
          headers: { 'Accept': 'application/json', 'X-Viewer-Clerk': viewerClerk() },
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            var j = res.j || {};
            if (!res.ok) { dead = true; polling = false; setIdle(); showError(j.error || 'Status check failed', j.error || 'Falha ao verificar status'); return; }
            setProgressUI(j.progress, j.stage);
            if (j.status === 'succeeded') {
              dead = true; polling = false;
              setProgressUI(100, 'persisting');
              refreshCards();
              setTimeout(function () { setIdle(); setCooldown(j.finished_at || new Date().toISOString(), 0); }, 900);
            } else if (j.status === 'failed') {
              dead = true; polling = false; setIdle();
              showError('Update could not complete. Your previous insights are unchanged.',
                        'A atualização não pôde ser concluída. Seus insights anteriores não foram alterados.');
            } else {
              setTimeout(tick, POLL_MS);
            }
          })
          .catch(function () { setTimeout(tick, POLL_MS); });
      }
      tick();
    }

    function start() {
      clearError();
      btn.disabled = true;
      setProgressUI(2, 'queued');
      fetch('/api/patient-dashboard-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk() },
        body: JSON.stringify({ patient: patientClerk() }),
      })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (res) {
          var j = res.j || {};
          if (res.status === 202 || (res.status === 200 && j.job_id)) {
            // 202 = new job; 200 + job_id = attached to an in-flight job.
            poll(j.job_id);
          } else if (res.status === 429 && j.error === 'cooldown') {
            setIdle();
            setCooldown(j.generated_at, j.minutes_ago != null ? j.minutes_ago : 0);
          } else {
            setIdle();
            showError(j.error || ('Could not start (HTTP ' + res.status + ')'),
                      j.error || ('Não foi possível iniciar (HTTP ' + res.status + ')'));
          }
        })
        .catch(function () {
          setIdle();
          showError('Network error starting the update.', 'Erro de rede ao iniciar a atualização.');
        });
    }

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      openConfirm(start);
    });

    // On mount: render any existing insights + show last-updated/cooldown.
    refreshCards();
    refreshMeta();

    // If a job is already running for this patient (e.g. started on another page),
    // attach to it so the bar shows here too. Side-effect-free GET probe — it
    // never starts a job (unlike a POST, which would).
    fetch('/api/patient-dashboard-build/status?patient=' + encodeURIComponent(patientClerk()), {
      headers: { 'Accept': 'application/json', 'X-Viewer-Clerk': viewerClerk() },
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.job_id && (j.status === 'running' || j.status === 'queued')) {
          btn.disabled = true; poll(j.job_id);
        }
      }).catch(function () {});
  }

  /* ── mount (handles async-rendered bespoke pages via observer) ── */
  function anchorRef() {
    return document.querySelector('section[data-ai-insights]')
        || document.querySelector('footer')
        || document.querySelector('main.jc-home, main.jc-paulo-exams, main.jc-silvana-exams, main.jc-empty-shell, main');
  }
  function tryMount() {
    if (document.querySelector('.iu-wrap[data-insights-update]')) return true;
    var ref = anchorRef();
    if (!ref) return false;
    injectStyles();
    var wrap = buildWrap();
    if (ref.tagName === 'FOOTER' || ref.hasAttribute('data-ai-insights')) {
      ref.parentNode.insertBefore(wrap, ref);    // above the footer / above the AI block
    } else {
      ref.appendChild(wrap);                      // bottom of the bespoke main
    }
    wire(wrap);
    return true;
  }
  function mount() {
    if (!patientClerk()) return;                  // no patient context -> nothing to do
    if (tryMount()) return;
    var obs = new MutationObserver(function () { if (tryMount()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
