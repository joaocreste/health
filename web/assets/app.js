/* Lumen Health — Chart.js defaults & nav helpers (health-palette tokens) */
(function () {
  'use strict';

  /* ── AUTH GATE ──
   * Demo-only client-side gate. Any page that includes this script is
   * considered protected unless it sets `window.JC_PUBLIC = true` before
   * the script loads (the login page does this implicitly by NOT loading
   * this gate via the early head check).
   *
   * Real auth (Cloudflare Access, OAuth, etc.) MUST replace this before
   * the site is published outside the local network.
   */
  (function authGate() {
    if (window.JC_PUBLIC === true) return; // explicitly public page
    var here = location.pathname.split('/').pop().toLowerCase();
    // The login page is index.html — never gate it.
    if (here === '' || here === 'index.html') return;
    if (sessionStorage.getItem('jc_authed') !== 'true') {
      // Send the visitor to the login screen and replace history so back-button doesn't bounce.
      location.replace('index.html');
    }
  })();

  /* Expose a simple sign-out helper for the topnav button */
  window.jcSignOut = function () {
    sessionStorage.removeItem('jc_authed');
    sessionStorage.removeItem('jc_viewer_clerk');
    sessionStorage.removeItem('jc_viewer_username');
    sessionStorage.removeItem('jc_current_patient');
    location.replace('index.html');
  };

  /* Return to the patient picker without signing out. */
  window.jcChangePatient = function () {
    sessionStorage.removeItem('jc_current_patient');
    location.href = 'patients.html';
  };

  /* ── BILINGUAL TOGGLE ──
   * Reads ?lang= query string first, then localStorage, defaults to "en".
   * Sets <html lang="..."> and updates aria-pressed on the .lang-btn buttons.
   * Persists choice in localStorage.lang. CSS hides .lang-en or .lang-pt
   * blocks based on the html[lang] selector.
   */
  (function initI18n() {
    const STORE_KEY = 'jc_lang';
    const VALID = new Set(['en', 'pt']);
    function readChoice() {
      const url = new URLSearchParams(location.search).get('lang');
      if (VALID.has(url)) return url;
      const saved = localStorage.getItem(STORE_KEY);
      if (VALID.has(saved)) return saved;
      return 'en';
    }
    function applyLang(lang) {
      if (!VALID.has(lang)) return;
      document.documentElement.lang = lang;
      localStorage.setItem(STORE_KEY, lang);
      document.querySelectorAll('.lang-btn').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
      });
      // Swap data-en/data-pt strings on inline elements.
      document.querySelectorAll('[data-en][data-pt]').forEach((el) => {
        const value = el.dataset[lang];
        if (value !== undefined) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = value;
          } else {
            el.textContent = value;
          }
        }
      });
    }
    function bind() {
      document.querySelectorAll('.lang-btn').forEach((btn) => {
        btn.addEventListener('click', () => applyLang(btn.dataset.lang));
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        applyLang(readChoice());
        bind();
      });
    } else {
      applyLang(readChoice());
      bind();
    }
    // Apply lang attribute synchronously on script load to avoid flash of
    // "wrong language" before DOMContentLoaded.
    const initial = readChoice();
    document.documentElement.lang = initial;
  })();

  if (window.Chart) {
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = '#3E4956';                      /* neutral-700 */
    Chart.defaults.borderColor = 'rgba(62,124,163,0.10)';   /* blue-500 @ 10% */
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.usePointStyle = false;

    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(252,253,254,0.98)';
    Chart.defaults.plugins.tooltip.titleColor = '#1A2129';   /* neutral-900 */
    Chart.defaults.plugins.tooltip.bodyColor  = '#3E4956';   /* neutral-700 */
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(62,124,163,0.20)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.titleFont = { family: "'IBM Plex Mono', monospace", weight: '500', size: 11 };
    Chart.defaults.plugins.tooltip.bodyFont  = { family: "'IBM Plex Mono', monospace", size: 11 };
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
  }

  /* CT / MRI / EEG viewer — bind slider, wheel, keys; lightweight ±N preload.
   *
   * Two ways to feed images:
   *   1. data-prefix + data-max          → URL pattern `${prefix}${i}-0.png`
   *      (existing TC head — sequential `0-0.png` … `706-0.png`).
   *   2. data-prefix + data-manifest     → fetch a JSON array of filenames,
   *      append each to the prefix. Lets us scrub multi-session DICOM exports
   *      with arbitrary names like `image_s0001_i0001.jpg`.
   */
  const FS_ENTER_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  const FS_EXIT_ICON  = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

  const ctViewers = document.querySelectorAll('.ct-viewer');
  ctViewers.forEach((viewer) => {
    const prefix      = viewer.dataset.prefix;
    const manifestUrl = viewer.dataset.manifest;
    const img         = viewer.querySelector('.ct-img');
    const slider      = viewer.querySelector('.ct-slider');
    const idxEl       = viewer.querySelector('.ct-idx');
    const totalEl     = viewer.querySelector('.ct-total');
    const PRELOAD     = 6;
    const cache       = new Map();

    // Inject fullscreen toggle into the header.
    //
    // Approach: when expanding, MOVE the viewer DOM node into a dedicated
    // overlay div on document.body, and leave a same-size placeholder in
    // its original spot. When exiting, move the viewer back and remove
    // the placeholder. The page layout below the viewer never reflows
    // during the fullscreen period — which is exactly what was producing
    // the "screen messed up after exit" symptom: with position:fixed the
    // viewer left its grid cell, every section underneath shifted up,
    // and the layout snapping back on exit looked broken.
    //
    // DOM .appendChild moves nodes (does not clone) — event listeners,
    // image src, slider value all survive the move intact.
    const head = viewer.querySelector('.ct-viewer-head');
    if (head) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ct-fs-btn';
      btn.setAttribute('aria-label', 'Toggle fullscreen');
      btn.title = 'Expand (Esc to close)';
      btn.innerHTML = FS_ENTER_ICON;

      let overlay = null;
      let placeholder = null;
      let originalParent = null;
      let originalNext = null;

      const enter = () => {
        if (overlay) return;
        const rect = viewer.getBoundingClientRect();

        placeholder = document.createElement('div');
        placeholder.className = 'ct-viewer-placeholder';
        placeholder.style.width = rect.width + 'px';
        placeholder.style.height = rect.height + 'px';

        originalParent = viewer.parentNode;
        originalNext = viewer.nextSibling;
        originalParent.insertBefore(placeholder, viewer);

        overlay = document.createElement('div');
        overlay.className = 'ct-fs-overlay';
        overlay.appendChild(viewer);
        document.body.appendChild(overlay);

        viewer.classList.add('is-fullscreen');
        document.body.classList.add('ct-fs-active');
        btn.innerHTML = FS_EXIT_ICON;
      };

      const exit = () => {
        if (!overlay) return;
        // Move viewer back to its original spot, drop the placeholder.
        originalParent.insertBefore(viewer, originalNext);
        placeholder.remove();
        overlay.remove();
        overlay = null;
        placeholder = null;
        originalParent = null;
        originalNext = null;

        viewer.classList.remove('is-fullscreen');
        document.body.classList.remove('ct-fs-active');
        btn.innerHTML = FS_ENTER_ICON;
      };

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (overlay) exit(); else enter();
      });
      head.appendChild(btn);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay) {
          e.preventDefault();
          exit();
        }
      });
    }

    let max = 0;
    let urlFn = () => '';
    let eventsBound = false;
    const controls = viewer.querySelector('.ct-controls');
    const curLang = () => (document.documentElement.lang === 'pt' ? 'pt' : 'en');

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      slider.addEventListener('input', (e) => setSlice(parseInt(e.target.value, 10)));

      const stage = viewer.querySelector('.ct-stage');
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1);
        setSlice(parseInt(slider.value, 10) + step);
      }, { passive: false });

      let dragging = false, startY = 0, startIdx = 0;
      stage.addEventListener('pointerdown', (e) => {
        dragging = true; startY = e.clientY; startIdx = parseInt(slider.value, 10);
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const delta = Math.round((startY - e.clientY) * 0.5);
        setSlice(startIdx + delta);
      });
      stage.addEventListener('pointerup',     () => { dragging = false; });
      stage.addEventListener('pointercancel', () => { dragging = false; });

      // Arrow keys step by one (native range), Page/Home/End jump.
      slider.addEventListener('keydown', (e) => {
        const cur = parseInt(slider.value, 10);
        if (e.key === 'PageUp')   { e.preventDefault(); setSlice(cur + 10); }
        if (e.key === 'PageDown') { e.preventDefault(); setSlice(cur - 10); }
        if (e.key === 'Home')     { e.preventDefault(); setSlice(0); }
        if (e.key === 'End')      { e.preventDefault(); setSlice(max); }
      });
    }

    function setSlice(i) {
      i = Math.max(0, Math.min(max, i));
      slider.value = i;
      if (idxEl) idxEl.textContent = i + 1; // human-friendly 1-based index
      img.src = urlFn(i);
      for (let d = 1; d <= PRELOAD; d++) {
        [i + d, i - d].forEach((n) => {
          if (n < 0 || n > max || cache.has(n)) return;
          const im = new Image();
          im.src = urlFn(n);
          cache.set(n, im);
        });
      }
    }

    // Point the scrubber at an ordered list of slice filenames. Re-callable:
    // switching series/plane just re-configures the same DOM + event handlers.
    function configure(slices) {
      cache.clear();
      max = Math.max(0, slices.length - 1);
      urlFn = (i) => `${prefix}${slices[i]}`;
      slider.max = String(max);
      const single = slices.length <= 1;        // hide scrubber + counter for one-image "ways"
      viewer.classList.toggle('ct-single', single);
      if (totalEl) totalEl.textContent = slices.length;
      setSlice(single ? 0 : Math.floor(max / 2));
    }

    // New manifest shape: { ways:[{key,labelEn,labelPt,values:[...]}], stacks:[{select,slices}], defaultSelect }
    function buildWays(manifest) {
      const ways = manifest.ways || [];
      const sel = Object.assign({}, manifest.defaultSelect || {});
      ways.forEach((w) => { if (sel[w.key] === undefined && w.values[0]) sel[w.key] = w.values[0].key; });

      const resolveStack = (s) =>
        (manifest.stacks || []).find((st) =>
          Object.keys(st.select).every((k) => st.select[k] === s[k]));

      const apply = () => {
        const st = resolveStack(sel);
        if (st) configure(st.slices);
      };

      // Disable any value whose combination with the current other selections has no stack.
      const refreshDisabled = () => {
        ways.forEach((w) => {
          w.values.forEach((v) => {
            const probe = Object.assign({}, sel, { [w.key]: v.key });
            const ok = !!resolveStack(probe);
            const el = w._control.querySelector(`[data-value="${CSS.escape(v.key)}"]`);
            if (el) el.disabled = !ok;
          });
        });
      };

      ways.forEach((w) => {
        const row = document.createElement('div');
        row.className = 'ct-control-row';

        const lab = document.createElement('span');
        lab.className = 'ct-control-label';
        lab.dataset.en = w.labelEn; lab.dataset.pt = w.labelPt;
        lab.textContent = curLang() === 'pt' ? w.labelPt : w.labelEn;
        row.appendChild(lab);

        // > 5 values → dropdown, otherwise segmented buttons.
        if (w.values.length > 5) {
          const seln = document.createElement('select');
          seln.className = 'ct-control-select';
          w.values.forEach((v) => {
            const o = document.createElement('option');
            o.value = v.key;
            o.dataset.value = v.key;
            o.dataset.en = v.labelEn; o.dataset.pt = v.labelPt;
            o.textContent = curLang() === 'pt' ? v.labelPt : v.labelEn;
            if (sel[w.key] === v.key) o.selected = true;
            seln.appendChild(o);
          });
          seln.addEventListener('change', () => { sel[w.key] = seln.value; refreshDisabled(); apply(); });
          w._control = seln;
          row.appendChild(seln);
        } else {
          const grp = document.createElement('div');
          grp.className = 'ct-seg';
          w.values.forEach((v) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ct-seg-btn';
            b.dataset.value = v.key;
            b.dataset.en = v.labelEn; b.dataset.pt = v.labelPt;
            b.textContent = curLang() === 'pt' ? v.labelPt : v.labelEn;
            b.setAttribute('aria-pressed', String(sel[w.key] === v.key));
            b.addEventListener('click', () => {
              if (b.disabled) return;
              sel[w.key] = v.key;
              grp.querySelectorAll('.ct-seg-btn').forEach((x) =>
                x.setAttribute('aria-pressed', String(x.dataset.value === v.key)));
              refreshDisabled(); apply();
            });
            grp.appendChild(b);
          });
          w._control = grp;
          row.appendChild(grp);
        }
        if (controls) controls.appendChild(row);
      });

      refreshDisabled();
      apply();
    }

    if (manifestUrl) {
      fetch(manifestUrl)
        .then((r) => r.json())
        .then((manifest) => {
          bindEvents();
          if (Array.isArray(manifest)) {
            configure(manifest);                       // legacy: flat array of filenames
          } else {
            buildWays(manifest);                       // ways/stacks manifest
          }
        })
        .catch((err) => {
          console.error('Failed to load manifest', manifestUrl, err);
        });
    } else {
      bindEvents();
      const n = parseInt(viewer.dataset.max, 10);      // legacy `${i}-0.png` pattern
      configure(Array.from({ length: n + 1 }, (_, i) => `${i}-0.png`));
    }
  });

  /* PGx module tabs */
  document.querySelectorAll('.pgx-tabs').forEach((tabsEl) => {
    const tabs = tabsEl.querySelectorAll('.pgx-tab');
    const panels = document.querySelectorAll('.pgx-module');
    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        const target = t.dataset.target;
        tabs.forEach((b) => b.classList.toggle('active', b === t));
        panels.forEach((p) => {
          if (p.dataset.module === target) p.removeAttribute('hidden');
          else                              p.setAttribute('hidden', '');
        });
      });
    });
  });

  /* Highlight active section in section-nav based on scroll */
  const sectionNavLinks = document.querySelectorAll('.section-nav a');
  if (sectionNavLinks.length) {
    const targets = Array.from(sectionNavLinks)
      .map((a) => document.querySelector(a.getAttribute('href')))
      .filter(Boolean);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            sectionNavLinks.forEach((a) => a.classList.remove('active'));
            const link = document.querySelector(`.section-nav a[href="#${e.target.id}"]`);
            if (link) link.classList.add('active');
          }
        });
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 }
    );
    targets.forEach((t) => observer.observe(t));
  }
})();
