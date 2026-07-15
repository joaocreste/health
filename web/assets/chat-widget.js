/* Ask Lumen v2 — floating per-patient chat widget.
 *
 * Overlay-only: mounts a single .lumen-chat-root on <body> (kept visible through
 * patient-context.js hidePageBody) and never restructures the page DOM. Talks to
 * POST /api/chat/v2/message (SSE). Bottom-LEFT launcher by design. */
(function () {
  'use strict';
  if (window.JC_PUBLIC === true || window.JC_PICKER_PAGE === true) return;
  if (document.querySelector('.lumen-chat-root')) return; // idempotent

  var PATIENT_ZERO = 'pending:joao';
  var params = new URLSearchParams(location.search);
  var patientClerk = params.get('patient') || sessionStorage.getItem('jc_current_patient') || PATIENT_ZERO;
  var viewerClerk = sessionStorage.getItem('jc_viewer_clerk') || patientClerk;

  /* Chat is self-or-admin at the API (resolveChatPatient) — a granted viewer
     (doctor, family) would get a launcher that can only 403. Don't mount it. */
  var viewerRole = sessionStorage.getItem('jc_viewer_role') || '';
  if (viewerRole !== 'admin' && viewerClerk !== patientClerk) return;

  // Best-effort first name for the header.
  var FIRST = { 'pending:joao': 'João', 'pending:paulo-silotto-df3441': 'Paulo', 'pending:silvana-creste-18ba19': 'Silvana', 'pending:john-smith-jr-9d4e21': 'John' };
  var firstName = FIRST[patientClerk] || '';

  function lang() {
    var l = document.documentElement.lang || localStorage.getItem('jc_lang') || 'pt';
    return l === 'en' ? 'en' : 'pt';
  }

  var STORE_KEY = 'lumen_chat_' + patientClerk;
  function loadHistory() { try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(h) { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(h.slice(-40))); } catch (e) {} }

  /* ── tiny markdown -> safe HTML ── */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  }
  function mdToHtml(md) {
    var lines = String(md || '').split(/\r?\n/), out = [], list = null;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;
      if (!line.trim()) { close(); continue; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); var h = m[1].length + 2; out.push('<h' + h + '>' + inlineMd(m[2]) + '</h' + h + '>'); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inlineMd(m[1]) + '</li>'); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inlineMd(m[1]) + '</li>'); continue; }
      close(); out.push('<p>' + inlineMd(line) + '</p>');
    }
    close();
    return out.join('');
  }

  var MARK = '<svg class="lc-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    '<path d="M16 27s-9-5.4-9-12.4A5.5 5.5 0 0 1 16 9a5.5 5.5 0 0 1 9 5.6C25 21.6 16 27 16 27Z" stroke="#6BA3C7" stroke-width="1.6"/>' +
    '<path d="M7 17.5h3.5l1.8-3.6 3 7.2 1.9-3.6H25" stroke="#F4B942" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // inject stylesheet (one include per page = just this script)
  if (!document.querySelector('link[data-lumen-chat]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'assets/chat-widget.css?v=2'; link.setAttribute('data-lumen-chat', '1');
    document.head.appendChild(link);
  }

  var root = document.createElement('div');
  root.className = 'lumen-chat-root';
  root.innerHTML =
    '<button class="lc-launcher" type="button" aria-label="Ask Lumen">' + MARK.replace('lc-mark', 'lc-mark-lg') + '<span class="lc-badge"></span></button>' +
    '<div class="lc-panel" role="dialog" aria-label="Ask Lumen">' +
      '<div class="lc-header">' + MARK +
        '<div class="lc-title">Ask Lumen' + (firstName ? ' · ' + esc(firstName) : '') + '</div>' +
        '<button class="lc-close" type="button" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="lc-log"></div>' +
      '<div class="lc-foot">' +
        '<div class="lc-inputrow">' +
          '<textarea class="lc-input" rows="1"></textarea>' +
          '<button class="lc-send" type="button" aria-label="Send">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="lc-disclaimer">' +
          '<span class="lang-en">Lumen helps you prepare for your doctor — it does not provide medical diagnoses.</span>' +
          '<span class="lang-pt">O Lumen ajuda você a se preparar para o seu médico — ele não fornece diagnósticos.</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);

  var panel = root.querySelector('.lc-panel');
  var logEl = root.querySelector('.lc-log');
  var input = root.querySelector('.lc-input');
  var sendBtn = root.querySelector('.lc-send');
  var history = loadHistory();
  var busy = false;

  function relang() {
    input.placeholder = lang() === 'pt' ? 'Pergunte sobre seu histórico…' : 'Ask about your record…';
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.lang-btn')) setTimeout(relang, 0); });
  relang();

  function scrollDown() { logEl.scrollTop = logEl.scrollHeight; }
  function emptyHint() {
    if (history.length) return;
    var d = document.createElement('div');
    d.className = 'lc-msg bot';
    d.innerHTML = lang() === 'pt'
      ? 'Olá! Posso ajudar a entender seus exames e a preparar perguntas para o seu médico. O que você gostaria de saber?'
      : 'Hi! I can help you understand your results and prepare questions for your doctor. What would you like to know?';
    logEl.appendChild(d);
  }
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'lc-msg ' + (role === 'user' ? 'user' : 'bot');
    if (role === 'user') d.textContent = text; else d.innerHTML = mdToHtml(text);
    logEl.appendChild(d); scrollDown();
    return d;
  }
  function render() { logEl.innerHTML = ''; emptyHint(); history.forEach(function (m) { addMsg(m.role, m.content); }); }
  render();

  function addPdfCard(p) {
    var card = document.createElement('div');
    card.className = 'lc-pdf';
    var size = p.size ? ' · ' + Math.max(1, Math.round(p.size / 1024)) + ' KB' : '';
    var expires = lang() === 'pt' ? 'Link expira em 7 dias' : 'Link expires in 7 days';
    var dl = lang() === 'pt' ? 'Baixar' : 'Download';
    card.innerHTML =
      '<svg class="lc-pdf-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>' +
      '<div class="lc-pdf-meta"><div class="lc-pdf-name">' + esc(p.filename || 'lumen.pdf') + size + '</div>' +
      '<div class="lc-pdf-sub">' + expires + '</div></div>' +
      '<a class="lc-pdf-dl" href="' + esc(p.url) + '" download>' + dl + '</a>';
    logEl.appendChild(card); scrollDown();
  }

  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    input.value = ''; input.style.height = 'auto';
    if (!history.length) logEl.innerHTML = '';
    history.push({ role: 'user', content: text }); addMsg('user', text); saveHistory(history);

    var typing = document.createElement('div');
    typing.className = 'lc-typing'; typing.innerHTML = '<span></span><span></span><span></span>';
    logEl.appendChild(typing); scrollDown();

    var botEl = null, acc = '';
    function ensureBot() { if (!botEl) { if (typing.parentNode) typing.remove(); botEl = addMsg('bot', ''); } return botEl; }

    try {
      var res = await fetch('/api/chat/v2/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viewer-Clerk': viewerClerk },
        body: JSON.stringify({ messages: history, patient_clerk: patientClerk, lang: lang() }),
      });
      if (!res.ok && (res.headers.get('content-type') || '').indexOf('event-stream') < 0) {
        var err = await res.json().catch(function () { return {}; });
        if (typing.parentNode) typing.remove();
        addMsg('bot', err.error === 'chat_not_configured'
          ? (lang() === 'pt' ? 'O chat ainda não está configurado.' : 'Chat is not configured yet.')
          : (lang() === 'pt' ? 'Não foi possível responder agora.' : 'Could not get a response right now.'));
        return;
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var parts = buf.split('\n\n'); buf = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          var line = parts[i].trim();
          if (line.indexOf('data:') !== 0) continue;
          var evt; try { evt = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
          if (evt.text) { acc += evt.text; ensureBot().innerHTML = mdToHtml(acc); scrollDown(); }
          else if (evt.pdf_ready) { if (typing.parentNode) typing.remove(); addPdfCard(evt.pdf_ready); }
          else if (evt.error) { ensureBot().innerHTML = mdToHtml(evt.message || 'Sorry, something went wrong.'); }
        }
      }
      if (typing.parentNode) typing.remove();
      if (acc.trim()) { history.push({ role: 'assistant', content: acc }); saveHistory(history); }
      else if (!botEl) { addMsg('bot', lang() === 'pt' ? 'Pronto.' : 'Done.'); }
    } catch (e) {
      if (typing.parentNode) typing.remove();
      addMsg('bot', lang() === 'pt' ? 'Erro de conexão.' : 'Connection error.');
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  }

  // events
  root.querySelector('.lc-launcher').addEventListener('click', function () { root.classList.add('lc-open'); relang(); scrollDown(); input.focus(); });
  root.querySelector('.lc-close').addEventListener('click', function () { root.classList.remove('lc-open'); });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(110, input.scrollHeight) + 'px'; });
})();
