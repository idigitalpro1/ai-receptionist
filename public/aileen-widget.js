(() => {
  const script = document.currentScript;
  const endpoint = script?.dataset.endpoint || new URL('/chat', script.src).href;
  const title = script?.dataset.title || 'Aileen';
  const greeting =
    script?.dataset.greeting ||
    "Hello, you've reached Colorado News Press. This is Aileen. How can I help?";
  const accent = script?.dataset.accent || '#a88a4a';

  const host = document.createElement('div');
  host.id = 'aileen-chat';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      button, textarea { font: inherit; }
      .launcher {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483000;
        border: 1px solid ${accent}; background: #171717; color: #f4f1e8;
        min-width: 116px; padding: 13px 17px; cursor: pointer;
        font: 600 12px/1.2 Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase;
      }
      .panel {
        position: fixed; right: 22px; bottom: 78px; z-index: 2147483000;
        width: min(390px, calc(100vw - 28px)); height: min(590px, calc(100vh - 110px));
        display: none; grid-template-rows: auto 1fr auto; overflow: hidden;
        border: 1px solid rgba(168,138,74,.65); background: #171717; color: #f4f1e8;
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
        font: 15px/1.45 Arial, sans-serif;
      }
      .panel.open { display: grid; }
      header { display: flex; align-items: center; justify-content: space-between; padding: 18px; border-bottom: 1px solid rgba(168,138,74,.35); }
      header strong { font: 400 25px/1.1 Georgia, serif; }
      header span { display: block; margin-top: 4px; color: #b9b6ae; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      .close { border: 0; background: transparent; color: #f4f1e8; cursor: pointer; font-size: 22px; }
      .messages { overflow-y: auto; padding: 18px; }
      .message { max-width: 88%; margin: 0 0 14px; padding: 11px 13px; white-space: pre-wrap; }
      .assistant { border-left: 1px solid ${accent}; background: #202020; }
      .user { margin-left: auto; background: #eeeae0; color: #171717; }
      .status { min-height: 20px; color: #aaa69d; font-size: 12px; }
      .privacy { margin: 8px 0 0; color: #8f8b83; font-size: 10px; line-height: 1.35; }
      form { padding: 14px; border-top: 1px solid rgba(168,138,74,.35); }
      textarea { width: 100%; min-height: 68px; resize: none; border: 1px solid #4b4b4b; background: #101010; color: #fff; padding: 11px; outline: none; }
      textarea:focus { border-color: ${accent}; }
      .actions { display: flex; align-items: center; justify-content: space-between; margin-top: 9px; }
      .send { border: 0; border-bottom: 1px solid ${accent}; background: transparent; color: #f4f1e8; padding: 6px 0; cursor: pointer; text-transform: uppercase; letter-spacing: .1em; font-size: 11px; }
      .send:disabled { opacity: .45; }
      @media (max-width: 520px) {
        .launcher { right: 14px; bottom: 14px; }
        .panel { right: 14px; bottom: 68px; height: calc(100vh - 90px); }
      }
    </style>
    <button class="launcher" type="button" aria-expanded="false">Ask Aileen</button>
    <section class="panel" role="dialog" aria-label="Chat with Aileen">
      <header>
        <div><strong>${title}</strong><span>Colorado News Press</span></div>
        <button class="close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="messages" aria-live="polite"></div>
      <form>
        <textarea maxlength="1200" aria-label="Your message" placeholder="How can we help?"></textarea>
        <div class="actions"><span class="status"></span><button class="send" type="submit">Send</button></div>
        <p class="privacy">Do not send confidential, financial, medical, or source-identifying information.</p>
      </form>
    </section>`;

  const launcher = root.querySelector('.launcher');
  const panel = root.querySelector('.panel');
  const close = root.querySelector('.close');
  const form = root.querySelector('form');
  const input = root.querySelector('textarea');
  const messages = root.querySelector('.messages');
  const status = root.querySelector('.status');
  const send = root.querySelector('.send');
  const history = [];

  function addMessage(role, content) {
    const item = document.createElement('div');
    item.className = `message ${role}`;
    item.textContent = content;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  addMessage('assistant', greeting);
  history.push({ role: 'assistant', content: greeting });

  function setOpen(open) {
    panel.classList.toggle('open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  launcher.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  close.addEventListener('click', () => setOpen(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || send.disabled) return;

    addMessage('user', message);
    history.push({ role: 'user', content: message });
    input.value = '';
    send.disabled = true;
    status.textContent = 'Aileen is responding…';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-12) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat unavailable');
      addMessage('assistant', data.reply);
      history.push({ role: 'assistant', content: data.reply });
      status.textContent = '';
    } catch {
      status.textContent = 'Aileen is unavailable. Please try again shortly.';
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();
