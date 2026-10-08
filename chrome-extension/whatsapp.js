// Runs on WhatsApp Web. A small Niptao panel for the open chat: "Save chat to Niptao" sends the
// messages on screen to the admin panel, "Add as lead" starts a lead for this number.
// Nothing happens unless the person presses a button: no automatic sending or reading in the background.
(() => {
  const PHONE_ID = /^(true|false)_(\d{10,15})@c\.us/;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ── Panel ──
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;top:70px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .box{font:13px system-ui,sans-serif;background:#fff;color:#111827;border:2px solid #0f766e;border-radius:10px;padding:10px 12px;width:250px;box-shadow:0 6px 20px rgba(0,0,0,.2)}
    .top{display:flex;justify-content:space-between;align-items:center} b{color:#0f766e}
    .min{background:none;border:0;color:#6b7280;cursor:pointer;font:inherit}
    label{display:block;margin-top:8px;color:#6b7280;font-size:12px}
    input{box-sizing:border-box;width:100%;padding:5px 7px;margin-top:2px;border:1px solid #d1d5db;border-radius:6px;font:inherit}
    .btns{display:flex;gap:6px;margin-top:8px} .btns button{flex:1;padding:7px 6px;border:0;border-radius:6px;background:#0f766e;color:#fff;font:inherit;font-weight:600;cursor:pointer}
    .btns button.alt{background:#e6f4f1;color:#0f766e} button:disabled{opacity:.5;cursor:default}
    p{margin:8px 0 0} .hint{background:#fef3c7;border-radius:6px;padding:6px 8px} .lead{border-top:1px solid #f3f4f6;padding-top:6px}
    .plate{font-family:ui-monospace,monospace;font-weight:700}</style>
    <div class="box"><div class="top"><b>Niptao</b><button class="min" title="Hide or show">▾</button></div>
    <div id="body"><p id="none">Open a chat to save it to Niptao.</p>
    <div id="chat" hidden>
      <label>Customer mobile <input id="phone" placeholder="10-digit number"></label>
      <label>Name <input id="name"></label>
      <p id="hint" class="hint" hidden>The customer wrote "I APPROVE". Press Save to record it.</p>
      <div class="btns"><button id="save">Save chat to Niptao</button><button id="add" class="alt">Add as lead</button></div>
      <p id="msg"></p><div id="leads"></div></div></div></div>`;
  const $ = (s) => root.querySelector(s);
  $('.min').onclick = () => { $('#body').hidden = !$('#body').hidden; $('.min').textContent = $('#body').hidden ? '▸' : '▾'; };

  // ── Read the open chat ──
  const rows = () => [...document.querySelectorAll('#main div[data-id]')].filter((el) => /^(true|false)_/.test(el.dataset.id));
  const headerName = () => clean(document.querySelector('#main header span[dir=auto]')?.textContent);
  const isGroup = () => rows().some((r) => r.dataset.id.includes('@g.us'));

  function detectPhone() {
    for (const r of rows()) { const m = r.dataset.id.match(PHONE_ID); if (m) return m[2]; }
    const digits = headerName().replace(/[^\d+]/g, '');
    return /^\+?\d{10,13}$/.test(digits) ? digits.replace('+', '') : '';
  }

  // "[13:01, 08/10/2026] Name: " or "[1:01 pm, 8/10/2026] Name: " (day/month/year, as in India).
  function parseTime(pre) {
    const m = (pre || '').match(/\[(\d{1,2}):(\d{2})\s*(am|pm)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/i);
    if (!m) return undefined;
    let [, h, min, ampm, d, mo, y] = m;
    h = +h; if (ampm) h = (h % 12) + (/pm/i.test(ampm) ? 12 : 0);
    if (y.length === 2) y = '20' + y;
    const t = new Date(+y, +mo - 1, +d, h, +min);
    return isNaN(t) ? undefined : t.toISOString();
  }

  function readMessages() {
    const out = [], seen = new Set();
    for (const r of rows()) {
      if (seen.has(r.dataset.id)) continue;
      seen.add(r.dataset.id);
      const box = r.querySelector('.copyable-text[data-pre-plain-text]') || r.querySelector('.copyable-text');
      const text = clean(r.querySelector('.copyable-text span.selectable-text')?.innerText || r.querySelector('span.selectable-text')?.innerText);
      if (!text) continue;
      out.push({ id: r.dataset.id, dir: r.dataset.id.startsWith('true_') ? 'out' : 'in', text, at: parseTime(box?.dataset.prePlainText) });
    }
    return out.slice(-60);
  }

  // ── Keep the panel in step with the chat that's open ──
  let current = null;
  function refresh() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    const open = Boolean(document.querySelector('#main'));
    const key = open ? headerName() : null;
    if (key !== current) {
      current = key;
      const group = open && isGroup();
      $('#none').hidden = open && !group;
      $('#none').textContent = group ? 'Group chats are not saved.' : 'Open a chat to save it to Niptao.';
      $('#chat').hidden = !open || group;
      if (open && !group) {
        const phone = detectPhone();
        $('#phone').value = phone;
        $('#name').value = /^\+?[\d\s-]+$/.test(key) ? '' : key;
        $('#msg').textContent = phone ? '' : 'Type the customer\'s mobile number above.';
        $('#leads').replaceChildren();
      }
    }
    if (open && !$('#chat').hidden) {
      const last = readMessages().filter((m) => m.dir === 'in').pop();
      $('#hint').hidden = !/\bI\s*APPROVE\b/i.test(last?.text || '');
      if (!$('#phone').value) $('#phone').value = detectPhone();
    }
  }
  setInterval(refresh, 1000);
  refresh();

  // ── Buttons ──
  const ERRORS = {
    login: 'Open the Niptao admin panel in this browser and log in (or log in from the N icon), then try again.',
    invalid_phone: 'Check the mobile number above.',
    no_messages: 'No text messages on screen to save.',
  };
  function showLeads(leads) {
    $('#leads').replaceChildren(...leads.map((l) => {
      const d = document.createElement('div');
      d.className = 'lead';
      d.innerHTML = '<div><b></b> <span class="plate"></span></div><div></div>';
      d.querySelector('b').textContent = l.ref;
      d.querySelector('.plate').textContent = l.plate || '';
      const approval = { sent: 'approval sent, waiting', received: 'approved ✓' }[l.waApproval] || '';
      d.lastChild.textContent = [l.status, l.agent, approval].filter(Boolean).join(' · ');
      return d;
    }));
  }
  async function send(create) {
    const body = { phone: $('#phone').value, name: clean($('#name').value), messages: create ? [] : readMessages() };
    if (create) body.create = true;
    for (const b of root.querySelectorAll('.btns button')) b.disabled = true;
    $('#msg').textContent = create ? 'Adding lead…' : `Saving ${body.messages.length} messages…`;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'saveWhatsApp', body });
      if (!res?.ok) { $('#msg').textContent = `Not saved. ${ERRORS[res?.error] || `(${res?.error || 'no answer'})`}`; return; }
      const leads = res.leads || [];
      $('#msg').textContent = leads.length ? (create ? 'Lead saved.' : `Saved ${body.messages.length} messages.`) : 'Saved, but this lead is assigned to someone else.';
      showLeads(leads);
    } finally {
      for (const b of root.querySelectorAll('.btns button')) b.disabled = false;
    }
  }
  $('#save').onclick = () => send(false);
  $('#add').onclick = () => send(true);
})();
