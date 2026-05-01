/* JC Advisory — Chart.js defaults & nav helpers (health-palette tokens) */
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
    location.replace('index.html');
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

    // Inject fullscreen toggle into the header. The Fullscreen API (with ESC
    // to exit) is widely available; we still feature-detect to avoid showing
    // a button that wouldn't do anything.
    const head = viewer.querySelector('.ct-viewer-head');
    if (head && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ct-fs-btn';
      btn.setAttribute('aria-label', 'Toggle fullscreen');
      btn.title = 'Fullscreen (Esc to exit)';
      btn.innerHTML = FS_ENTER_ICON;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const inFs = (document.fullscreenElement || document.webkitFullscreenElement) === viewer;
        if (inFs) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          const req = viewer.requestFullscreen || viewer.webkitRequestFullscreen;
          if (req) {
            const p = req.call(viewer);
            if (p && typeof p.catch === 'function') p.catch((err) => console.warn('Fullscreen failed:', err));
          }
        }
      });
      head.appendChild(btn);

      // Swap icon when entering / exiting fullscreen so the affordance reads correctly.
      const onFsChange = () => {
        const cur = document.fullscreenElement || document.webkitFullscreenElement;
        btn.innerHTML = (cur === viewer) ? FS_EXIT_ICON : FS_ENTER_ICON;
      };
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
    }

    let max;
    let urlFn;

    function bindEvents() {
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
      idxEl.textContent = i + 1; // human-friendly 1-based index
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

    function init(maxVal, makeUrl) {
      max = maxVal;
      urlFn = makeUrl;
      slider.max = String(max);
      if (totalEl) totalEl.textContent = max + 1;
      bindEvents();
      const start = parseInt(slider.value, 10);
      setSlice(Number.isFinite(start) ? start : Math.floor(max / 2));
    }

    if (manifestUrl) {
      fetch(manifestUrl)
        .then((r) => r.json())
        .then((files) => {
          init(files.length - 1, (i) => `${prefix}${files[i]}`);
        })
        .catch((err) => {
          console.error('Failed to load manifest', manifestUrl, err);
        });
    } else {
      init(parseInt(viewer.dataset.max, 10), (i) => `${prefix}${i}-0.png`);
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
