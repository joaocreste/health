/* JC Advisory health-record chatbot
   Bottom-left floating icon → opens chat panel → POSTs to /api/chat (streams).
   Bilingual: reads document.documentElement.lang, re-renders on change. */

(function () {
  if (window.__jcChatbotLoaded) return;
  window.__jcChatbotLoaded = true;

  const TEAL = "#2B6475";
  const TEAL_LIGHT = "#C8DFE6";

  const STR = {
    en: {
      open: "Open health-record assistant",
      close: "Close",
      header: "Health record assistant",
      sub: "Answers based only on Joao’s record",
      placeholder: "Ask about Joao’s health record…",
      send: "Send",
      empty: "Ask a question about the record. Try: “What were his last vitals?”, “Summarise the spiritual section.”",
      thinking: "Thinking…",
      error: "Something went wrong. Please try again.",
      net: "Network error. Please try again.",
    },
    pt: {
      open: "Abrir assistente do prontuário",
      close: "Fechar",
      header: "Assistente do prontuário",
      sub: "Responde apenas com base no prontuário do João",
      placeholder: "Pergunte sobre o prontuário do João…",
      send: "Enviar",
      empty: "Faça uma pergunta sobre o prontuário. Ex.: “Quais foram os últimos sinais vitais?”, “Resuma a seção espiritual.”",
      thinking: "Pensando…",
      error: "Algo deu errado. Tente novamente.",
      net: "Erro de rede. Tente novamente.",
    },
  };

  function lang() {
    return document.documentElement.lang === "pt" ? "pt" : "en";
  }
  function t(key) {
    return STR[lang()][key];
  }

  /* ── Styles ───────────────────────────────────────── */
  const css = `
.jc-chat-launcher {
  position: fixed; left: 20px; bottom: 20px; z-index: 9998;
  width: 56px; height: 56px; border-radius: 50%;
  background: ${TEAL};
  border: none; cursor: pointer; padding: 0;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2);
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.jc-chat-launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.45), 0 4px 8px rgba(0,0,0,0.25); }
.jc-chat-launcher:active { transform: translateY(0); }
.jc-chat-launcher:focus-visible { outline: 2px solid ${TEAL_LIGHT}; outline-offset: 3px; }
.jc-chat-launcher.is-open { background: #1B3B54; }

.jc-chat-launcher svg { width: 30px; height: 30px; display: block; }

.jc-chat-launcher-pulse {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid ${TEAL};
  animation: jc-chat-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes jc-chat-pulse {
  0%   { transform: scale(1);    opacity: 0.55; }
  70%  { transform: scale(1.45); opacity: 0; }
  100% { transform: scale(1.45); opacity: 0; }
}

.jc-chat-panel {
  position: fixed; left: 20px; bottom: 88px; z-index: 9999;
  width: 380px; max-width: calc(100vw - 32px);
  height: 560px; max-height: calc(100vh - 120px);
  background: #0F2238;
  border: 1px solid rgba(139, 184, 210, 0.18);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35);
  display: none; flex-direction: column; overflow: hidden;
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #E6ECF1;
  opacity: 0; transform: translateY(8px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.jc-chat-panel.is-open { display: flex; opacity: 1; transform: translateY(0); }

.jc-chat-header {
  background: ${TEAL};
  color: #FFFFFF;
  padding: 14px 16px;
  display: flex; align-items: center; gap: 12px;
  flex-shrink: 0;
}
.jc-chat-header-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,0.12);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.jc-chat-header-icon svg { width: 20px; height: 20px; }
.jc-chat-header-text { flex: 1; min-width: 0; }
.jc-chat-header-title { font-weight: 600; font-size: 14px; line-height: 1.2; letter-spacing: 0.01em; }
.jc-chat-header-sub { font-size: 11px; opacity: 0.85; line-height: 1.3; margin-top: 2px; }
.jc-chat-close {
  background: transparent; border: none; color: #FFFFFF;
  cursor: pointer; padding: 4px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.85;
}
.jc-chat-close:hover { opacity: 1; background: rgba(255,255,255,0.12); }
.jc-chat-close:focus-visible { outline: 2px solid ${TEAL_LIGHT}; outline-offset: 1px; }

.jc-chat-messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-behavior: smooth;
}
.jc-chat-messages::-webkit-scrollbar { width: 6px; }
.jc-chat-messages::-webkit-scrollbar-thumb { background: rgba(139,184,210,0.25); border-radius: 3px; }

.jc-chat-empty {
  color: #8FA6B8; font-size: 13px; line-height: 1.55;
  padding: 12px 14px;
  background: rgba(91, 156, 200, 0.06);
  border-radius: 10px;
  border-left: 3px solid ${TEAL};
}

.jc-chat-msg {
  max-width: 88%;
  padding: 10px 13px;
  border-radius: 12px;
  font-size: 13.5px; line-height: 1.5;
  white-space: pre-wrap; word-wrap: break-word;
}
.jc-chat-msg.user {
  align-self: flex-end;
  background: ${TEAL};
  color: #FFFFFF;
  border-bottom-right-radius: 4px;
}
.jc-chat-msg.assistant {
  align-self: flex-start;
  background: rgba(139, 184, 210, 0.10);
  color: #E6ECF1;
  border: 1px solid rgba(139, 184, 210, 0.15);
  border-bottom-left-radius: 4px;
}
.jc-chat-msg.assistant.is-thinking {
  color: #8FA6B8; font-style: italic;
}
.jc-chat-msg.error {
  background: rgba(216, 138, 138, 0.12);
  border: 1px solid rgba(216, 138, 138, 0.30);
  color: #F0BFBF;
}

.jc-chat-input-wrap {
  border-top: 1px solid rgba(139,184,210,0.12);
  padding: 12px;
  display: flex; gap: 8px; align-items: flex-end;
  flex-shrink: 0;
  background: #0B1A28;
}
.jc-chat-input {
  flex: 1; resize: none;
  background: rgba(139, 184, 210, 0.08);
  border: 1px solid rgba(139, 184, 210, 0.18);
  border-radius: 10px;
  color: #E6ECF1;
  font-family: inherit; font-size: 13.5px; line-height: 1.45;
  padding: 9px 12px;
  min-height: 38px; max-height: 120px;
}
.jc-chat-input:focus { outline: none; border-color: ${TEAL}; background: rgba(139,184,210,0.12); }
.jc-chat-input::placeholder { color: #6F8696; }
.jc-chat-send {
  background: ${TEAL}; color: #FFFFFF;
  border: none; cursor: pointer;
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 0.15s ease;
}
.jc-chat-send:hover:not(:disabled) { background: #1B3B54; }
.jc-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
.jc-chat-send svg { width: 18px; height: 18px; }

@media (max-width: 480px) {
  .jc-chat-panel {
    left: 8px; right: 8px; bottom: 80px;
    width: auto; height: calc(100vh - 100px);
  }
  .jc-chat-launcher { left: 16px; bottom: 16px; }
}

@media print { .jc-chat-launcher, .jc-chat-panel { display: none !important; } }
`;

  const styleEl = document.createElement("style");
  styleEl.id = "jc-chatbot-styles";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── SVG icons (branded — teal speech bubble + ECG pulse) ── */
  const ICON_BUBBLE = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M9 13 C9 9.7 11.7 7 15 7 L33 7 C36.3 7 39 9.7 39 13 L39 28 C39 31.3 36.3 34 33 34 L22 34 L14 41 L14 34 L15 34 C11.7 34 9 31.3 9 28 Z"
        fill="${TEAL_LIGHT}" stroke="${TEAL_LIGHT}" stroke-width="0.5" stroke-linejoin="round"/>
  <polyline points="13,21 17,21 20,15 23,27 26,17 29,23 35,21"
            fill="none" stroke="${TEAL}" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  const ICON_BUBBLE_HEADER = `
<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M9 13 C9 9.7 11.7 7 15 7 L33 7 C36.3 7 39 9.7 39 13 L39 28 C39 31.3 36.3 34 33 34 L22 34 L14 41 L14 34 L15 34 C11.7 34 9 31.3 9 28 Z"
        fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-linejoin="round"/>
  <polyline points="13,21 17,21 20,15 23,27 26,17 29,23 35,21"
            fill="none" stroke="#FFFFFF" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_SEND  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  /* ── Build DOM ────────────────────────────────────── */
  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "jc-chat-launcher";
  launcher.setAttribute("aria-label", t("open"));
  launcher.innerHTML = `<span class="jc-chat-launcher-pulse" aria-hidden="true"></span>${ICON_BUBBLE}`;

  const panel = document.createElement("section");
  panel.className = "jc-chat-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("header"));
  panel.innerHTML = `
    <header class="jc-chat-header">
      <div class="jc-chat-header-icon">${ICON_BUBBLE_HEADER}</div>
      <div class="jc-chat-header-text">
        <div class="jc-chat-header-title" data-i18n="header"></div>
        <div class="jc-chat-header-sub" data-i18n="sub"></div>
      </div>
      <button type="button" class="jc-chat-close" aria-label="${t("close")}">${ICON_CLOSE}</button>
    </header>
    <div class="jc-chat-messages" role="log" aria-live="polite">
      <div class="jc-chat-empty" data-i18n="empty"></div>
    </div>
    <form class="jc-chat-input-wrap">
      <textarea class="jc-chat-input" rows="1" data-i18n-placeholder="placeholder" autocomplete="off" spellcheck="true"></textarea>
      <button type="submit" class="jc-chat-send" aria-label="${t("send")}">${ICON_SEND}</button>
    </form>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector(".jc-chat-messages");
  const emptyEl = panel.querySelector(".jc-chat-empty");
  const form = panel.querySelector("form");
  const input = panel.querySelector(".jc-chat-input");
  const sendBtn = panel.querySelector(".jc-chat-send");
  const closeBtn = panel.querySelector(".jc-chat-close");

  /* ── i18n re-render ───────────────────────────────── */
  function applyI18n() {
    panel.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    panel.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    launcher.setAttribute("aria-label", t("open"));
    closeBtn.setAttribute("aria-label", t("close"));
    panel.setAttribute("aria-label", t("header"));
  }
  applyI18n();
  document.querySelectorAll(".lang-btn").forEach((btn) =>
    btn.addEventListener("click", () => setTimeout(applyI18n, 60))
  );
  new MutationObserver(applyI18n).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  /* ── Open / close ─────────────────────────────────── */
  function open() {
    panel.classList.add("is-open");
    launcher.classList.add("is-open");
    setTimeout(() => input.focus(), 100);
  }
  function close() {
    panel.classList.remove("is-open");
    launcher.classList.remove("is-open");
    launcher.focus();
  }
  launcher.addEventListener("click", () => (panel.classList.contains("is-open") ? close() : open()));
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) close();
  });

  /* ── Auto-grow textarea ───────────────────────────── */
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  /* ── Chat state + send ────────────────────────────── */
  const history = []; // [{role, content}]
  let pending = false;

  function addMessage(role, text, opts = {}) {
    const div = document.createElement("div");
    div.className = `jc-chat-msg ${role}` + (opts.className ? " " + opts.className : "");
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function send(userText) {
    if (pending || !userText.trim()) return;
    pending = true;
    sendBtn.disabled = true;
    if (emptyEl.parentNode) emptyEl.remove();

    addMessage("user", userText);
    history.push({ role: "user", content: userText });

    const thinkingEl = addMessage("assistant", t("thinking"), { className: "is-thinking" });
    let assistantText = "";
    let started = false;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, lang: lang() }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "");
        thinkingEl.classList.remove("is-thinking");
        thinkingEl.classList.add("error");
        thinkingEl.textContent = errText || t("error");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          if (evt.error) {
            thinkingEl.classList.remove("is-thinking");
            thinkingEl.classList.add("error");
            thinkingEl.textContent = evt.error;
            return;
          }
          if (evt.text) {
            if (!started) {
              thinkingEl.classList.remove("is-thinking");
              thinkingEl.textContent = "";
              started = true;
            }
            assistantText += evt.text;
            thinkingEl.textContent = assistantText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          if (evt.done) {
            if (assistantText) history.push({ role: "assistant", content: assistantText });
            return;
          }
        }
      }
    } catch (e) {
      thinkingEl.classList.remove("is-thinking");
      thinkingEl.classList.add("error");
      thinkingEl.textContent = t("net");
    } finally {
      pending = false;
      sendBtn.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    input.style.height = "auto";
    send(v);
  });
})();
