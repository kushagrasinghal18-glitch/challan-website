// Runs on the Delhi Traffic Police court and Lok Adalat pages. After a plate is clicked in the
// admin panel, fill it in when the vehicle number box shows up, and leave the captcha and OTP to
// the person. These pages may ask for a mobile number and OTP first and load each step late,
// so the plate stays ready for 30 minutes, and a "Fill vehicle number" button fills whichever
// box was clicked last (typing it key by key, since these pages often block pasting).
(async () => {
  const KEEP = 30 * 60_000;
  const store = chrome.storage.local;
  const { pendingPlate, delhiPlate } = await store.get(['pendingPlate', 'delhiPlate']);
  let lead = delhiPlate && Date.now() - delhiPlate.at < KEEP ? delhiPlate : null;
  if (pendingPlate && Date.now() - pendingPlate.at < KEEP) {
    lead = { ...pendingPlate, at: Date.now() };
    await store.set({ delhiPlate: lead });
    await store.remove('pendingPlate');
  }
  if (!lead) return;
  const { fillPage, fillFocused } = await import(chrome.runtime.getURL('fill.js'));
  const top = window.top === window;

  // Remember the last text box the person clicked, for the button.
  let lastBox = null;
  document.addEventListener('focusin', (e) => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'hidden') lastBox = e.target; }, true);

  let say = () => {};
  let host;
  if (top) {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>.box{font:13px system-ui,sans-serif;background:#fff;color:#111827;border:2px solid #0f766e;border-radius:10px;padding:10px 12px;width:250px;box-shadow:0 6px 20px rgba(0,0,0,.2)}
      b{color:#0f766e} .plate{font-family:ui-monospace,monospace;font-weight:700}
      button{margin-top:8px;padding:7px 10px;border:0;border-radius:6px;background:#0f766e;color:#fff;font:inherit;font-weight:600;cursor:pointer;width:100%}
      .link{background:none;color:#6b7280;text-decoration:underline;font-weight:400;font-size:11px;padding:0;width:auto}
      .x{float:right;background:none;color:#6b7280;margin:0;padding:0;width:auto}</style>
      <div class="box"><button class="x" title="Hide">✕</button><b>Niptao</b> · <span class="plate"></span>
      <div id="msg" style="margin-top:6px"></div>
      <button id="fill">Fill vehicle number</button>
      <div><button id="debug" class="link">Not working? Copy page details for support</button></div></div>`;
    root.querySelector('.plate').textContent = lead.plate;
    root.querySelector('.x').onclick = () => host.remove();
    say = (t) => { root.querySelector('#msg').textContent = t; };
    // mousedown keeps the focus in the page's box, so we know which box was meant.
    root.querySelector('#fill').addEventListener('mousedown', (e) => e.preventDefault());
    root.querySelector('#fill').onclick = () => {
      if (!lastBox || !lastBox.isConnected) return say('Click inside the vehicle number box first, then press this button.');
      lastBox.focus();
      fillFocused(lead.plate);
      say('Filled. Type the captcha (and OTP when it comes) yourself, then continue.');
    };
    root.querySelector('#debug').onclick = async () => {
      const mask = (v) => String(v || '').replace(/\d/g, '9').replace(/[A-Za-z]/g, 'x').slice(0, 60);
      const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${[...el.classList].slice(0, 4).map((c) => '.' + c).join('')}`
        + [...el.attributes].filter((a) => !['class', 'id', 'style', 'value'].includes(a.name)).map((a) => `[${a.name}=${a.name === 'placeholder' || a.name.includes('label') || a.name.includes('name') || a.name === 'type' ? a.value : mask(a.value)}]`).join('');
      const labelOf = (el) => (el.labels?.[0]?.textContent || el.closest('label, .form-group, mat-form-field, div')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const report = {
        version: chrome.runtime.getManifest().version, url: location.href.replace(/\d{4,}/g, '9999'),
        frames: document.querySelectorAll('iframe').length,
        inputs: [...document.querySelectorAll('input, textarea, select, [contenteditable=true]')].slice(0, 25).map((el) => ({ el: describe(el), label: labelOf(el), visible: el.getClientRects().length > 0 })),
        buttons: [...document.querySelectorAll('button, [role=tab], [role=radio], mat-radio-button, a.nav-link')].slice(0, 20).map((b) => b.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
      };
      try { await navigator.clipboard.writeText(JSON.stringify(report, null, 1)); say('Copied. Paste it in the Niptao chat with Claude.'); }
      catch { say('Could not copy. Click on the page once, then try again.'); }
    };
    say('Waiting for the vehicle number box. If the page asks for a mobile number and OTP first, do that and it will fill after.');
    document.documentElement.appendChild(host);
  }

  let done = false;
  const tryFill = async () => {
    if (done) return;
    const { filled } = await fillPage({ plate: lead.plate });
    if (!filled.length) return;
    done = true;
    say('Vehicle number filled. Type the captcha (and OTP when it comes) yourself, then continue. If it looks wrong, click the box and press the button.');
  };
  await tryFill();
  const watch = new MutationObserver(() => { clearTimeout(watch.t); watch.t = setTimeout(tryFill, 400); });
  watch.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => watch.disconnect(), KEEP);
})();
