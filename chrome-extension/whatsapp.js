// Runs on WhatsApp Web. A small Niptao panel for the open chat: "Save chat to Niptao" sends the
// messages on screen to the admin panel, "Add as lead" starts a lead for this number. The only
// thing it does by itself: when the open chat shows a new "I APPROVE" from the customer, it saves
// that chat once so the approval reaches the admin panel, and puts the payment details in the
// message box. It never sends WhatsApp messages itself: a person always presses Send.
(() => {
  const PHONE_ID = /(?:^|_)(\d{10,15})@c\.us/;
  const PHONE_TEXT = /^\+?\d[\d\s()-]{8,16}\d$/;
  const APPROVE = /\bI\s*APPROVE/i;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const digits = (s) => (s || '').replace(/\D/g, '');
  const store = chrome.storage.local;

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
    p{margin:8px 0 0} .hint{background:#fef3c7;border-radius:6px;padding:6px 8px} .lead{border-top:1px solid #f3f4f6;padding-top:6px;margin-top:6px}
    .plate{font-family:ui-monospace,monospace;font-weight:700} .small{font-size:11px;color:#6b7280}
    .link{background:none;border:0;padding:0;color:#6b7280;text-decoration:underline;cursor:pointer;font:inherit;font-size:11px}</style>
    <div class="box"><div class="top"><b>Niptao</b><button class="min" title="Hide or show">▾</button></div>
    <div id="body"><p id="none">Open a chat to save it to Niptao.</p>
    <div id="chat" hidden>
      <label>Customer mobile <input id="phone" placeholder="10-digit number"></label>
      <p id="phoneHelp" class="small" hidden>Couldn't read the number. Type it once, or click the name at the top of the chat so WhatsApp shows the number. It's remembered for this chat.</p>
      <label>Name <input id="name"></label>
      <p id="hint" class="hint" hidden></p>
      <div class="btns"><button id="save">Save chat to Niptao</button><button id="add" class="alt">Add as lead</button></div>
      <p id="msg"></p><div id="leads"></div>
      <div id="pay" class="hint" hidden><span id="payMsg"></span> <button id="copyQr" class="link" hidden>Copy QR</button></div>
      <p><button id="debug" class="link">Not working? Copy page details for support</button></p></div></div></div>`;
  const $ = (s) => root.querySelector(s);
  $('.min').onclick = () => { $('#body').hidden = !$('#body').hidden; $('.min').textContent = $('#body').hidden ? '▸' : '▾'; };

  // ── Read the open chat ──
  const main = () => document.querySelector('#main');
  const headerName = () => clean(main()?.querySelector('header span[dir=auto]')?.textContent || main()?.querySelector('header span[title]')?.getAttribute('title'));

  // Every message's text sits in an element carrying data-pre-plain-text="[13:01, 08/10/2026] Name: ".
  // Older and newer layouts differ around it, so look in several places for the id and direction.
  function messageNodes() {
    const m = main();
    if (!m) return [];
    const boxes = [...m.querySelectorAll('[data-pre-plain-text]')];
    const extra = [...m.querySelectorAll('.message-in, .message-out')].filter((el) => !el.querySelector('[data-pre-plain-text]'));
    return [...boxes, ...extra];
  }
  function direction(el) {
    if (el.closest('.message-out')) return 'out';
    if (el.closest('.message-in')) return 'in';
    const id = el.closest('[data-id]')?.dataset.id || '';
    if (id.startsWith('true_')) return 'out';
    if (id.startsWith('false_')) return 'in';
    // Last resort: outgoing bubbles sit on the right half of the chat.
    const r = el.getBoundingClientRect(), mr = main().getBoundingClientRect();
    return r.left + r.width / 2 > mr.left + mr.width / 2 ? 'out' : 'in';
  }
  const textOf = (el) => clean(el.querySelector('span.selectable-text')?.innerText || el.querySelector('span[dir]')?.innerText || el.innerText);

  // "[13:01, 08/10/2026] Name: " or "[1:01 pm, 8/10/2026] Name: " (day/month/year, as in India).
  function parseTime(pre) {
    const m = (pre || '').match(/\[(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?,\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\]/i);
    if (!m) return undefined;
    let [, h, min, ampm, d, mo, y] = m;
    h = +h; if (ampm) h = (h % 12) + (/p/i.test(ampm) ? 12 : 0);
    if (y.length === 2) y = '20' + y;
    const t = new Date(+y, +mo - 1, +d, h, +min);
    return isNaN(t) ? undefined : t.toISOString();
  }
  const senderOf = (pre) => clean((pre || '').replace(/^\[[^\]]*\]\s*/, '').replace(/:\s*$/, ''));

  function readMessages() {
    const out = [], seen = new Set();
    for (const el of messageNodes()) {
      const text = textOf(el);
      if (!text) continue;
      const pre = el.dataset.prePlainText || el.querySelector('[data-pre-plain-text]')?.dataset.prePlainText || '';
      const id = el.closest('[data-id]')?.dataset.id || `${pre}|${text}`.slice(0, 120);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, dir: direction(el), text, at: parseTime(pre), sender: senderOf(pre) });
    }
    return out.slice(-60);
  }

  const isGroup = () => [...(main()?.querySelectorAll('[data-id]') || [])].some((el) => el.dataset.id.includes('@g.us'));

  // The customer's number, from wherever WhatsApp shows it.
  function detectPhone() {
    const m = main();
    if (!m) return '';
    for (const el of m.querySelectorAll('[data-id]')) { const x = el.dataset.id.match(PHONE_ID); if (x) return x[1]; }
    for (const msg of readMessages()) if (msg.dir === 'in' && PHONE_TEXT.test(msg.sender)) return digits(msg.sender);
    if (PHONE_TEXT.test(headerName())) return digits(headerName());
    // The number shown in the header subtitle or the contact info panel (not the chat list).
    for (const el of document.querySelectorAll('#main header span, #app span[title], #app span[dir=auto]')) {
      if (el.closest('#pane-side, [data-pre-plain-text], .message-in, .message-out, [data-id], footer')) continue;
      const t = clean(el.getAttribute('title') || el.textContent);
      if (PHONE_TEXT.test(t) && digits(t).length >= 10) return digits(t);
    }
    return '';
  }

  // ── Keep the panel in step with the chat that's open ──
  let current = null, remembered = {};
  store.get('waPhones').then((v) => { remembered = v.waPhones || {}; });
  const rememberPhone = (name, phone) => {
    if (!name || !phone) return;
    remembered[name] = phone;
    store.set({ waPhones: remembered });
  };

  function refresh() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    const open = Boolean(main());
    const key = open ? headerName() : null;
    if (key !== current) {
      current = key;
      const group = open && isGroup();
      $('#none').hidden = open && !group;
      $('#none').textContent = group ? 'Group chats are not saved.' : 'Open a chat to save it to Niptao.';
      $('#chat').hidden = !open || group;
      if (open && !group) {
        $('#phone').value = '';
        $('#name').value = PHONE_TEXT.test(key) ? '' : key;
        $('#msg').textContent = '';
        $('#leads').replaceChildren();
        $('#pay').hidden = true;
      }
    }
    if (!open || $('#chat').hidden) return;
    if (!$('#phone').value || $('#phone').dataset.auto === '1') {
      const p = detectPhone() || remembered[current] || '';
      if (p) { $('#phone').value = p; $('#phone').dataset.auto = '1'; }
    }
    $('#phoneHelp').hidden = Boolean($('#phone').value);
    const approval = readMessages().filter((m) => m.dir === 'in').slice(-5).reverse().find((m) => APPROVE.test(m.text));
    $('#hint').hidden = !approval;
    if (approval) autoSaveApproval(approval);
  }
  $('#phone').addEventListener('input', () => { $('#phone').dataset.auto = '0'; });
  setInterval(refresh, 1000);
  refresh();

  // Save once per "I APPROVE" message, so the admin panel marks the approval.
  let busy = false, failedKey = null;
  async function autoSaveApproval(m) {
    const key = `${current}|${m.id}`;
    if (key === failedKey) return; // don't retry on its own; the Save button still works
    const { waApprovalsSaved = [] } = await store.get('waApprovalsSaved');
    if (waApprovalsSaved.includes(key)) { $('#hint').textContent = 'The customer\'s "I APPROVE" is saved to Niptao.'; return; }
    if (!digits($('#phone').value)) { $('#hint').textContent = 'The customer wrote "I APPROVE". Enter their mobile number above and it will be saved.'; return; }
    if (busy) return;
    $('#hint').textContent = 'The customer wrote "I APPROVE". Saving to Niptao…';
    const leads = await send(false);
    if (leads) {
      await store.set({ waApprovalsSaved: [...waApprovalsSaved, key].slice(-500) });
      // Right after the approval, put the payment details in the chat box (only one lead, or it's ambiguous).
      const ready = leads.filter((l) => l.paymentReady && !l.paymentSent);
      if (ready.length === 1) preparePayment(ready[0].ref);
    } else { failedKey = key; $('#hint').textContent = 'The customer wrote "I APPROVE" but it could not be saved. See below, then press Save chat to Niptao.'; }
  }

  // ── Buttons ──
  const ERRORS = {
    login: 'Open the Niptao admin panel in this browser and log in (or log in from the N icon), then try again.',
    invalid_phone: 'Type the customer\'s 10-digit mobile number above.',
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
      if (l.paymentReady) {
        const b = document.createElement('button');
        b.className = 'link';
        b.textContent = l.paymentSent ? 'Payment details sent ✓ (put them in the chat again)' : 'Put payment details in the chat';
        b.onclick = () => preparePayment(l.ref);
        d.append(b);
      }
      return d;
    }));
  }
  async function send(create) {
    const messages = create ? [] : readMessages().map(({ sender, ...m }) => m);
    const body = { phone: $('#phone').value, name: clean($('#name').value), messages };
    if (create) body.create = true;
    busy = true;
    for (const b of root.querySelectorAll('.btns button')) b.disabled = true;
    $('#msg').textContent = create ? 'Adding lead…' : `Saving ${messages.length} messages…`;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'saveWhatsApp', body });
      if (!res?.ok) { $('#msg').textContent = `Not saved. ${ERRORS[res?.error] || `(${res?.error || 'no answer'})`}`; return null; }
      rememberPhone(current, digits($('#phone').value));
      const leads = res.leads || [];
      $('#msg').textContent = leads.length ? (create ? 'Lead saved.' : `Saved ${messages.length} messages.`) : 'Saved, but this lead is assigned to someone else.';
      showLeads(leads);
      return leads;
    } finally {
      busy = false;
      for (const b of root.querySelectorAll('.btns button')) b.disabled = false;
    }
  }

  // ── Payment details: typed into the WhatsApp message box, QR copied. The person presses Send. ──
  let qrBlob = null;
  function typeIntoChat(text) {
    const box = main()?.querySelector('footer [contenteditable="true"]') || main()?.querySelector('[contenteditable="true"][role="textbox"]');
    if (!box) return false;
    box.focus();
    // WhatsApp's editor understands a paste, which keeps the line breaks (typing "\n" would mean Enter).
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasted = !box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (!pasted || !clean(box.innerText)) document.execCommand('insertText', false, text);
    return Boolean(clean(box.innerText));
  }
  async function toPng(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
  async function copyQr() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': qrBlob })]);
      return true;
    } catch { return false; }
  }
  async function preparePayment(ref) {
    const res = await chrome.runtime.sendMessage({ type: 'getPayment', ref });
    if (!res?.ok) {
      const why = { payment_not_set: 'Add the UPI ID and QR code in the admin panel under Settings, Payment details.', login: ERRORS.login };
      $('#pay').hidden = false;
      $('#payMsg').textContent = `Payment details not ready. ${why[res?.error] || `(${res?.error || 'no answer'})`}`;
      $('#copyQr').hidden = true;
      return;
    }
    const typed = typeIntoChat(res.text);
    watchPaymentSent(ref, res);
    qrBlob = res.qr ? await toPng(res.qr).catch(() => null) : null;
    const copied = qrBlob ? await copyQr() : false;
    $('#pay').hidden = false;
    $('#copyQr').hidden = !qrBlob || copied;
    $('#payMsg').textContent = [
      typed ? 'Payment details are in the message box. Check them and press Enter to send.' : 'Could not reach the message box. Click in it and press "Put payment details in the chat" again.',
      qrBlob ? (copied ? 'Then press Ctrl+V and Enter to send the QR code.' : 'Then press "Copy QR", Ctrl+V and Enter to send the QR code.') : '',
    ].filter(Boolean).join(' ');
  }
  // Once the payment message shows up as sent in this chat, record it on the lead.
  let watching = null;
  function watchPaymentSent(ref, pay) {
    clearInterval(watching);
    const chat = current, since = new Set(readMessages().map((m) => m.id));
    const needle = clean(pay.upiId || pay.text.split('\n')[0]);
    let ticks = 0;
    watching = setInterval(async () => {
      if (current !== chat || ++ticks > 600) return clearInterval(watching); // stop after 10 minutes or a chat switch
      const sent = readMessages().find((m) => m.dir === 'out' && !since.has(m.id) && m.text.includes(needle));
      if (!sent) return;
      clearInterval(watching);
      const amount = pay.amount != null ? `₹${Number(pay.amount).toLocaleString('en-IN')}` : '';
      const res = await chrome.runtime.sendMessage({ type: 'paymentSent', ref, note: `Sent payment details on WhatsApp: ${[amount, pay.upiId && `to ${pay.upiId}`].filter(Boolean).join(' ')}.` });
      $('#payMsg').textContent = res?.ok ? `Payment details sent. Marked on ${ref} in the admin panel.` : `Payment details sent, but the admin panel wasn't updated (${res?.error || 'no answer'}).`;
      $('#copyQr').hidden = true;
    }, 1000);
  }

  $('#copyQr').onclick = async () => {
    if (await copyQr()) { $('#copyQr').hidden = true; $('#payMsg').textContent = 'QR copied. Click in the message box, press Ctrl+V, then Enter.'; }
  };

  $('#save').onclick = () => send(false);
  $('#add').onclick = () => send(true);

  // Page layout only (no names, numbers or message text), so support can fix the reading.
  $('#debug').onclick = async () => {
    const mask = (s) => String(s || '').replace(/\d/g, '9').replace(/[^\s\d9_@.:\-[\],/]/g, 'x').slice(0, 80);
    const describe = (el) => el && `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${[...el.classList].slice(0, 4).map((c) => '.' + c).join('')}`
      + [...el.attributes].filter((a) => !['class', 'id', 'style'].includes(a.name)).map((a) => `[${a.name}=${mask(a.value)}]`).join('');
    const chain = (el) => { const out = []; for (let i = 0; el && i < 8; i++, el = el.parentElement) out.push(describe(el)); return out; };
    const m = main();
    const sample = m ? [...m.querySelectorAll('span.selectable-text, [data-pre-plain-text], [data-id], .message-in, .message-out')].slice(-6) : [];
    const report = {
      version: chrome.runtime.getManifest().version,
      hasMain: Boolean(m),
      header: m ? [...m.querySelectorAll('header span')].slice(0, 8).map((s) => describe(s) + ' text=' + mask(s.textContent)) : [],
      counts: m ? Object.fromEntries(['[data-id]', '[data-pre-plain-text]', 'span.selectable-text', '.message-in', '.message-out', '[role=row]'].map((s) => [s, m.querySelectorAll(s).length])) : {},
      read: readMessages().map((x) => ({ dir: x.dir, id: mask(x.id), sender: mask(x.sender), text: mask(x.text).slice(0, 20) })).slice(-4),
      samples: sample.map(chain),
    };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 1)); $('#msg').textContent = 'Copied. Paste it in the Niptao chat with Claude.'; }
    catch { $('#msg').textContent = 'Could not copy. Click inside the WhatsApp page first, then try again.'; }
  };
})();
