/* Reflective Portrait v3 — triad SVGs (archetype wheel, coping loops, Johari
 * mini) + Evolution charts + right-to-respond binding.
 *
 * All SVGs are data-driven from window.JC_TRIAD / JC_EVOLUTION (mirrored in
 * patient_dashboards), consume CSS variables so both themes work, and carry
 * role="img" with bilingual titles. Bilingual re-render via MutationObserver
 * on html[lang] (app.js owns the toggle; no event is dispatched).
 * Gaps are never bridged: null scores + connectgaps:false; unwritten epochs
 * are not selectable on the radar and draw no recurrence dots.
 */
(function () {
  var EV = window.JC_EVOLUTION, TR = window.JC_TRIAD;
  var PATIENT = window.JC_PATIENT_CLERK || 'pending:joao';
  var SVGNS = 'http://www.w3.org/2000/svg';

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
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function wrapText(textEl, words, maxChars) {
    var lines = [], line = '';
    words.split(' ').forEach(function (w) {
      if ((line + ' ' + w).trim().length > maxChars) { lines.push(line.trim()); line = w; }
      else line += ' ' + w;
    });
    if (line.trim()) lines.push(line.trim());
    lines = lines.slice(0, 3);
    lines.forEach(function (l, i) {
      var t = el('tspan', { x: textEl.getAttribute('x'), dy: i === 0 ? 0 : 10.5 });
      t.textContent = l;
      textEl.appendChild(t);
    });
    return lines.length;
  }

  var VALENCE_TOKENS = {
    sustaining: { stroke: function () { return cssVar('--green-600', '#2D7A4C'); }, fill: function () { return cssVar('--green-50', '#EEF8F1'); } },
    mixed: { stroke: function () { return cssVar('--amber-700', '#8a6508'); }, fill: function () { return cssVar('--amber-50', '#FDF8EC'); } },
    costly: { stroke: function () { return '#B54747'; }, fill: function () { return '#FBF0F0'; } }
  };
  var GROUP_COPY = {
    sustaining: { en: 'Sustains you', pt: 'O que te sustenta' },
    mixed: { en: 'Double-edged', pt: 'Faca de dois gumes' },
    costly: { en: 'Costs you', pt: 'O que te custa' },
    agency: { en: 'Noticing a loop is the first step out of it.', pt: 'Perceber um ciclo é o primeiro passo para sair dele.' },
    roles: { en: ['Trigger', 'Response', 'Relief', 'Return'], pt: ['Gatilho', 'Resposta', 'Alívio', 'Retorno'] }
  };

  /* ── Archetype wheel: 12 segments, primary gold, secondary petrol ── */
  function renderArchetypeWheel() {
    var slot = document.getElementById('arch-wheel');
    if (!slot || !TR) return;
    var L = lang();
    var gold = cssVar('--accent-gold', '#B8860B');
    var petrol = cssVar('--accent-petrol', '#244E6E');
    var labels = L === 'en' ? TR.archetype.labels_en : TR.archetype.labels_pt;
    var P = TR.archetype.primaryIdx, S = TR.archetype.secondaryIdx;
    slot.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 220 220', role: 'img', style: 'width:100%;max-width:240px;display:block;margin:0 auto;' });
    var title = el('title', {}, svg);
    title.textContent = L === 'en'
      ? 'Archetype wheel: primary ' + labels[P] + ', secondary ' + labels[S]
      : 'Roda de arquétipos: primário ' + labels[P] + ', secundário ' + labels[S];
    var cx = 110, cy = 110, r1 = 62, r2 = 96;
    for (var i = 0; i < 12; i++) {
      // rotate so the primary segment sits centered at the top
      var start = ((i - P) * 30 - 105) * Math.PI / 180;
      var end = start + 28 * Math.PI / 180;
      var p = 'M' + (cx + r1 * Math.cos(start)) + ' ' + (cy + r1 * Math.sin(start)) +
        ' L' + (cx + r2 * Math.cos(start)) + ' ' + (cy + r2 * Math.sin(start)) +
        ' A' + r2 + ' ' + r2 + ' 0 0 1 ' + (cx + r2 * Math.cos(end)) + ' ' + (cy + r2 * Math.sin(end)) +
        ' L' + (cx + r1 * Math.cos(end)) + ' ' + (cy + r1 * Math.sin(end)) +
        ' A' + r1 + ' ' + r1 + ' 0 0 0 ' + (cx + r1 * Math.cos(start)) + ' ' + (cy + r1 * Math.sin(start)) + ' Z';
      var isP = i === P, isS = i === S;
      el('path', {
        d: p,
        fill: isP ? hexToRgba(gold, 0.28) : isS ? hexToRgba(petrol, 0.22) : 'rgba(62,124,163,0.06)',
        stroke: isP ? gold : isS ? petrol : 'rgba(62,124,163,0.25)',
        'stroke-width': isP ? 2 : 1
      }, svg);
      var mid = (start + end) / 2, rl = (r1 + r2) / 2;
      if (isP || isS) {
        var t = el('text', {
          x: cx + rl * Math.cos(mid), y: cy + rl * Math.sin(mid) + 3,
          'text-anchor': 'middle', 'font-size': '9.5', 'font-family': 'IBM Plex Sans, sans-serif',
          'font-weight': '600', fill: isP ? gold : petrol
        }, svg);
        t.textContent = labels[i];
      }
    }
    var c = el('text', { x: cx, y: cy + 8, 'text-anchor': 'middle', 'font-size': '30', 'font-family': 'IBM Plex Mono, monospace', 'font-weight': '500', fill: gold }, svg);
    c.textContent = labels[P].charAt(0);
    slot.appendChild(svg);
  }

  /* ── Coping loop figure: Trigger -> Response -> Relief -> Return ── */
  function renderCopingLoop(loop) {
    var L = lang();
    var tok = VALENCE_TOKENS[loop.valence];
    var stroke = tok.stroke(), fill = tok.fill();
    var nodes = L === 'en' ? loop.nodes_en : loop.nodes_pt;
    var roles = GROUP_COPY.roles[L];
    var svg = el('svg', { viewBox: '0 0 240 240', role: 'img', class: 'loop-svg' });
    var title = el('title', {}, svg);
    title.textContent = (L === 'en' ? 'Coping loop: ' : 'Ciclo: ') + (L === 'en' ? loop.label_en : loop.label_pt);
    var centers = [[120, 40], [196, 120], [120, 200], [44, 120]];
    // curved arrows between consecutive nodes, closing the circle
    el('defs', {}, svg).innerHTML = '<marker id="lp-arr-' + loop.id + '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="' + stroke + '"/></marker>';
    var arcs = [
      'M 158 56 A 78 78 0 0 1 184 88', 'M 184 152 A 78 78 0 0 1 158 184',
      'M 82 184 A 78 78 0 0 1 56 152', 'M 56 88 A 78 78 0 0 1 82 56'
    ];
    arcs.forEach(function (d) {
      el('path', { d: d, fill: 'none', stroke: stroke, 'stroke-width': 1.6, 'marker-end': 'url(#lp-arr-' + loop.id + ')' }, svg);
    });
    centers.forEach(function (c, i) {
      el('rect', { x: c[0] - 42, y: c[1] - 25, width: 84, height: 50, rx: 9, fill: fill, stroke: stroke, 'stroke-width': i === 3 && (loop.valence !== 'sustaining') ? 1.8 : 1.1 }, svg);
      var role = el('text', { x: c[0], y: c[1] - 14, 'text-anchor': 'middle', 'font-size': '7.5', 'font-family': 'IBM Plex Mono, monospace', fill: stroke, 'letter-spacing': '.05em' }, svg);
      role.textContent = roles[i].toUpperCase();
      var txt = el('text', { x: c[0], y: c[1] - 3, 'text-anchor': 'middle', 'font-size': '9.5', 'font-family': 'IBM Plex Sans, sans-serif', fill: 'var(--text-default, #24313E)' }, svg);
      wrapText(txt, nodes[i], 16);
    });
    el('circle', { cx: 120, cy: 120, r: 21, fill: '#fff', stroke: stroke, 'stroke-width': 1.4 }, svg);
    var cn = el('text', { x: 120, y: 124, 'text-anchor': 'middle', 'font-size': '12', 'font-family': 'IBM Plex Mono, monospace', 'font-weight': '500', fill: stroke }, svg);
    cn.textContent = 'x' + loop.count;
    return svg;
  }

  /* ── Loop groups + cards ── */
  function renderLoops() {
    var wrap = document.getElementById('loop-groups');
    if (!wrap || !TR) return;
    var L = lang();
    wrap.innerHTML = '';
    ['sustaining', 'mixed', 'costly'].forEach(function (valence) {
      var loops = TR.loops.filter(function (l) { return l.valence === valence; });
      if (!loops.length) return;
      var g = document.createElement('div');
      g.className = 'loop-group v-' + valence;
      var h = document.createElement('h3');
      h.textContent = GROUP_COPY[valence][L];
      g.appendChild(h);
      var cards = document.createElement('div');
      cards.className = 'loop-cards';
      loops.forEach(function (loop) {
        var card = document.createElement('div');
        card.className = 'loop-card';
        card.setAttribute('data-item-key', 'joao-v3-loop-' + loop.id);
        var t = document.createElement('h4');
        t.textContent = (L === 'en' ? loop.label_en : loop.label_pt);
        card.appendChild(t);
        card.appendChild(renderCopingLoop(loop));
        // recurrence strip: one dot per epoch, sized by count; unwritten = dashed
        var strip = document.createElement('div');
        strip.className = 'loop-strip';
        TR.epochOrder.forEach(function (eid, i) {
          var n = loop.epochs[eid] || 0;
          var d = document.createElement('span');
          if (n > 0) {
            var px = 6 + Math.min(n, 12);
            d.className = 'dot'; d.style.width = px + 'px'; d.style.height = px + 'px';
            d.title = TR.epochLabels[i] + ' x' + n;
          } else {
            d.className = 'dot empty';
            d.title = TR.epochLabels[i];
          }
          strip.appendChild(d);
        });
        var cchip = document.createElement('span');
        cchip.className = 'ep';
        cchip.textContent = 'x' + loop.count + ' · 2015→26';
        strip.appendChild(cchip);
        card.appendChild(strip);
        var meta = document.createElement('div');
        meta.className = 'loop-meta';
        meta.innerHTML = '<span class="ai-pill">' + (L === 'en' ? 'AI' : 'IA') + '</span>' +
          '<span class="jh-chip">' + (L === 'en' ? 'confidence: ' : 'confiança: ') + (L === 'en' ? loop.conf : ({ high: 'alta', medium: 'média', low: 'baixa' })[loop.conf]) + '</span>';
        card.appendChild(meta);
        var det = document.createElement('details');
        det.innerHTML = '<summary>' + (L === 'en' ? 'Evidence' : 'Evidências') + '</summary><p class="rp-evd">' + loop.evd + '</p>';
        card.appendChild(det);
        var rtr = document.createElement('div');
        rtr.className = 'rtr';
        card.appendChild(rtr);
        cards.appendChild(card);
      });
      g.appendChild(cards);
      if (valence !== 'sustaining') {
        var a = document.createElement('p');
        a.className = 'loop-agency';
        a.textContent = GROUP_COPY.agency[L];
        g.appendChild(a);
      }
      wrap.appendChild(g);
    });
    bindResponses();
  }

  /* ── Johari mini 2x2 ── */
  function renderJohariMini() {
    var slot = document.getElementById('johari-mini-slot');
    if (!slot || !TR) return;
    var L = lang();
    var petrol = cssVar('--accent-petrol', '#244E6E');
    var q = [
      [L === 'en' ? 'Open' : 'Aberto', TR.johari.open], [L === 'en' ? 'Blind' : 'Cego', TR.johari.blind],
      [L === 'en' ? 'Hidden' : 'Oculto', TR.johari.hidden], [L === 'en' ? 'Emerging' : 'Emergente', TR.johari.emerging]
    ];
    slot.innerHTML = '';
    var svg = el('svg', { viewBox: '0 0 200 140', role: 'img', class: 'johari-mini' });
    var title = el('title', {}, svg);
    title.textContent = L === 'en' ? 'Johari window item counts' : 'Contagem de itens da janela de Johari';
    q.forEach(function (cell, i) {
      var x = (i % 2) * 100, y = Math.floor(i / 2) * 70;
      el('rect', { x: x + 2, y: y + 2, width: 96, height: 66, rx: 8, fill: 'rgba(62,124,163,0.06)', stroke: 'rgba(62,124,163,0.3)' }, svg);
      var n = el('text', { x: x + 50, y: y + 34, 'text-anchor': 'middle', 'font-size': '20', 'font-family': 'IBM Plex Mono, monospace', fill: petrol, 'font-weight': '500' }, svg);
      n.textContent = cell[1];
      var lab = el('text', { x: x + 50, y: y + 52, 'text-anchor': 'middle', 'font-size': '10', 'font-family': 'IBM Plex Sans, sans-serif', fill: 'var(--text-muted, #5B6B7A)' }, svg);
      lab.textContent = cell[0];
    });
    slot.appendChild(svg);
  }

  /* ── Radar: two selected epochs; scored bins selectable via chips ── */
  var selected = null;
  function scoredEpochs() {
    return EV.epochs.map(function (_, i) { return i; }).filter(function (i) {
      return EV.dims.some(function (d) { return d.scores[i] !== null; });
    });
  }
  function renderRadar() {
    var elp = document.getElementById('evo-radar-plot');
    if (!elp || !window.Plotly || !EV) return;
    if (!selected) selected = [EV.thenEpoch, EV.nowEpoch];
    var L = lang();
    var petrol = cssVar('--accent-petrol', '#244E6E');
    var gold = cssVar('--accent-gold', '#B8860B');
    var labels = EV.dims.map(function (d) { return d[L]; });
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
    var lo = Math.min(selected[0], selected[1]), hi = Math.max(selected[0], selected[1]);
    var data = [trace(lo, petrol, EV.epochs[lo]), trace(hi, gold, EV.epochs[hi])];
    renderRadarChips(lo, hi, petrol, gold);
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
    Plotly.newPlot(elp, data, layout, { displayModeBar: false, responsive: true });
  }
  function renderRadarChips(lo, hi, petrol, gold) {
    var L = lang();
    var legend = document.getElementById('evo-radar-legend');
    var chips = document.getElementById('evo-epoch-chips');
    if (legend) {
      legend.innerHTML = '';
      [[lo, petrol, L === 'en' ? 'then' : 'antes'], [hi, gold, L === 'en' ? 'now' : 'agora']].forEach(function (t) {
        var s = document.createElement('span');
        s.className = 'evo-chip';
        s.style.borderColor = t[1]; s.style.color = t[1];
        s.textContent = EV.epochs[t[0]] + ' · ' + t[2];
        legend.appendChild(s);
      });
    }
    if (!chips) return;
    chips.innerHTML = '';
    var scorable = scoredEpochs();
    EV.epochs.forEach(function (label, i) {
      var ev = EV.epochEvidence ? EV.epochEvidence[i] : null;
      var isGap = scorable.indexOf(i) === -1;
      var c = document.createElement(isGap ? 'span' : 'button');
      c.className = 'evo-chip' + (isGap ? ' evo-gap' : '');
      c.textContent = label + ' · ' + (ev === null ? '—' : ev + ' ' + (L === 'en' ? 'entries' : 'registros'));
      if (!isGap) {
        c.type = 'button';
        c.style.cursor = 'pointer';
        var active = (i === lo || i === hi);
        c.setAttribute('aria-pressed', String(active));
        if (active) {
          var col = i === lo ? petrol : gold;
          c.style.borderColor = col; c.style.color = '#fff'; c.style.background = col;
        }
        c.addEventListener('click', function () {
          if (i === lo || i === hi) return;
          if (Math.abs(i - lo) <= Math.abs(i - hi)) selected = [i, hi];
          else selected = [lo, i];
          renderRadar();
        });
      }
      chips.appendChild(c);
    });
  }

  /* ── Trails ── */
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
    bindResponses();
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

  function renderAll() {
    renderArchetypeWheel();
    renderLoops();
    renderJohariMini();
    renderRadar();
    renderTrails();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderAll(); fetchItems(); });
  } else { renderAll(); fetchItems(); }

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
