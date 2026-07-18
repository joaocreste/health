/* Reflective Portrait v2 — Evolution charts + right-to-respond binding.
 *
 * Charts read brand tokens from the live stylesheet (getComputedStyle), render
 * bilingually, and re-render when the html[lang] attribute changes (app.js
 * owns the language toggle; no event is dispatched, so we observe the attr).
 * Gaps are never bridged: score arrays carry nulls and traces set
 * connectgaps:false — a bin the patient didn't write in stays open.
 *
 * Right-to-respond: item cards carry data-item-key. On load we fetch
 * /api/reflective?clerk=<patient> (approved, non-flagged items only) to map
 * item_key -> DB id and hydrate saved reactions; buttons POST to
 * /api/reflective-respond. If the fetch fails or the viewer cannot respond,
 * the controls stay hidden — the portrait remains fully readable statically.
 */
(function () {
  var EV = window.JC_EVOLUTION;
  var PATIENT = window.JC_PATIENT_CLERK || 'pending:joao';

  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'pt'; }
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hexToRgba(hex, a) {
    var m = hex.replace('#', '');
    if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(m, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ── Radar: earliest scored epoch vs latest ── */
  function renderRadar() {
    var el = document.getElementById('evo-radar-plot');
    if (!el || !window.Plotly || !EV) return;
    var L = lang();
    var petrol = cssVar('--accent-petrol', '#244E6E');
    var gold = cssVar('--accent-gold', '#B8860B');
    var labels = EV.dims.map(function (d) { return d[L]; });
    // close the polygon by repeating the first axis
    var theta = labels.concat([labels[0]]);
    function trace(epochIdx, color, name) {
      var r = EV.dims.map(function (d) { return d.scores[epochIdx]; });
      r = r.concat([r[0]]);
      return {
        type: 'scatterpolar', r: r, theta: theta, name: name,
        connectgaps: false, fill: 'toself', fillcolor: hexToRgba(color, 0.25),
        line: { color: color, width: 2 }, marker: { size: 6, color: color },
        hovertemplate: '%{theta}: %{r}<extra>' + name + '</extra>'
      };
    }
    var data = [
      trace(EV.thenEpoch, petrol, EV.epochs[EV.thenEpoch]),
      trace(EV.nowEpoch, gold, EV.epochs[EV.nowEpoch])
    ];
    var layout = {
      polar: {
        radialaxis: { range: [0, 5], tickvals: [1, 2, 3, 4, 5], tickfont: { size: 9, family: 'IBM Plex Mono' }, gridcolor: 'rgba(62,124,163,0.15)', angle: 90, tickangle: 90 },
        angularaxis: { tickfont: { size: 11, family: 'IBM Plex Sans' }, gridcolor: 'rgba(62,124,163,0.12)' },
        bgcolor: 'rgba(0,0,0,0)'
      },
      showlegend: false, paper_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 55, r: 55, t: 30, b: 30 },
      font: { family: 'IBM Plex Sans, sans-serif' }
    };
    Plotly.newPlot(el, data, layout, { displayModeBar: false, responsive: true });
  }

  /* ── Trails: one compact line per dimension; gaps break the line ── */
  function renderTrails() {
    var grid = document.getElementById('evo-trail-grid');
    if (!grid || !window.Plotly || !EV) return;
    var L = lang();
    var petrol = cssVar('--accent-petrol', '#244E6E');
    grid.innerHTML = '';
    EV.dims.forEach(function (d) {
      var card = document.createElement('div');
      card.className = 'evo-trail-card';
      card.setAttribute('data-item-key', 'joao-v2-evo-dim-' + d.id);
      var head = document.createElement('h4');
      head.style.cssText = 'margin:0;font-size:14px;';
      head.textContent = (L === 'en' ? d.en : d.pt);
      var plot = document.createElement('div');
      plot.style.cssText = 'width:100%;height:120px;';
      var delta = document.createElement('p');
      delta.className = 'evo-delta';
      delta.textContent = (L === 'en' ? d.delta_en : d.delta_pt);
      var rtr = document.createElement('div');
      rtr.className = 'rtr';
      card.appendChild(head); card.appendChild(plot); card.appendChild(delta); card.appendChild(rtr);
      grid.appendChild(card);
      // marker rule: filled = 3+ evidence items, hollow = exactly 2
      var symbols = d.ev.map(function (n) { return n >= 3 ? 'circle' : 'circle-open'; });
      Plotly.newPlot(plot, [{
        type: 'scatter', mode: 'lines+markers',
        x: EV.epochs, y: d.scores, connectgaps: false,
        line: { color: petrol, width: 2 },
        marker: { size: 7, color: petrol, symbol: symbols, line: { color: petrol, width: 1.5 } },
        hovertemplate: '%{x}: %{y}<extra></extra>'
      }], {
        yaxis: { range: [0.5, 5.5], tickvals: [1, 3, 5], tickfont: { size: 8, family: 'IBM Plex Mono' }, gridcolor: 'rgba(62,124,163,0.12)' },
        xaxis: { tickfont: { size: 8, family: 'IBM Plex Mono' }, showgrid: false },
        margin: { l: 22, r: 6, t: 6, b: 22 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)'
      }, { displayModeBar: false, responsive: true });
    });
    bindResponses(); // new .rtr nodes need binding
  }

  /* ── Right-to-respond ── */
  var itemMap = null, canRespond = false;
  var RTR_COPY = {
    q: { en: 'Does this match how you see it?', pt: 'Isso corresponde ao que você vê?' },
    trailQ: { en: 'Does this match how you remember it?', pt: 'Isso corresponde ao que você lembra?' },
    yes: { en: 'Resonates', pt: 'Faz sentido' },
    no: { en: 'Not quite', pt: 'Não é bem assim' },
    note: { en: 'Add a note', pt: 'Anotar' },
    saved: { en: 'Saved', pt: 'Salvo' },
    ph: { en: 'Your answer, in your words…', pt: 'Sua resposta, nas suas palavras…' }
  };
  function viewerClerk() {
    try { return sessionStorage.getItem('jc_viewer_clerk') || ''; } catch (e) { return ''; }
  }
  function fetchItems() {
    return fetch('/api/reflective?clerk=' + encodeURIComponent(PATIENT), {
      headers: viewerClerk() ? { 'X-Viewer-Clerk': viewerClerk() } : {}
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      canRespond = !!j.can_respond;
      itemMap = {};
      (j.items || []).forEach(function (it) { itemMap[it.item_key] = it; });
      bindResponses();
    }).catch(function () { /* portrait stays readable without responses */ });
  }
  function post(itemId, reaction, note) {
    return fetch('/api/reflective-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk() },
      body: JSON.stringify({ patient_clerk: PATIENT, item_id: itemId, reaction: reaction, note: note || null })
    });
  }
  function bindResponses() {
    if (!itemMap || !canRespond) return;
    var L = lang();
    document.querySelectorAll('[data-item-key]').forEach(function (card) {
      var key = card.getAttribute('data-item-key');
      var item = itemMap[key];
      var slot = card.querySelector('.rtr');
      if (!item || !slot || slot.dataset.bound) return;
      slot.dataset.bound = '1';
      var isTrail = key.indexOf('-evo-dim-') !== -1;
      slot.innerHTML =
        '<span class="rtr-q">' + (isTrail ? RTR_COPY.trailQ[L] : RTR_COPY.q[L]) + '</span>' +
        '<button type="button" data-r="resonates" aria-pressed="false">' + RTR_COPY.yes[L] + '</button>' +
        '<button type="button" data-r="doesnt" aria-pressed="false">' + RTR_COPY.no[L] + '</button>' +
        '<button type="button" data-r="note" aria-pressed="false">' + RTR_COPY.note[L] + '</button>' +
        '<span class="rtr-saved">' + RTR_COPY.saved[L] + '</span>' +
        '<textarea placeholder="' + RTR_COPY.ph[L] + '"></textarea>';
      var ta = slot.querySelector('textarea');
      if (item.response_reaction) {
        var b = slot.querySelector('[data-r="' + item.response_reaction + '"]');
        if (b) b.setAttribute('aria-pressed', 'true');
        if (item.response_note) { ta.value = item.response_note; slot.classList.add('rtr-noting'); }
      }
      slot.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var r = btn.dataset.r;
          if (r === 'note') { slot.classList.toggle('rtr-noting'); if (slot.classList.contains('rtr-noting')) { ta.focus(); return; } }
          slot.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
          btn.setAttribute('aria-pressed', 'true');
          post(item.id, r, ta.value.trim() || null).then(function (res) {
            if (res && res.ok) {
              var s = slot.querySelector('.rtr-saved');
              s.style.display = 'inline'; setTimeout(function () { s.style.display = 'none'; }, 2000);
            }
          });
        });
      });
      ta.addEventListener('blur', function () {
        if (!ta.value.trim()) return;
        var pressed = slot.querySelector('button[aria-pressed="true"]');
        post(item.id, pressed ? pressed.dataset.r : 'note', ta.value.trim());
      });
    });
  }

  function renderAll() { renderRadar(); renderTrails(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderAll(); fetchItems(); });
  } else { renderAll(); fetchItems(); }

  // Re-render charts + rebind copy when the language toggle flips html[lang].
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.attributeName === 'lang') {
        renderAll();
        document.querySelectorAll('.rtr').forEach(function (s) { delete s.dataset.bound; });
        bindResponses();
      }
    });
  }).observe(document.documentElement, { attributes: true });
})();
