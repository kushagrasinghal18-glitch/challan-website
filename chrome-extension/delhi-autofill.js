// Runs on the Delhi Traffic Police court and Lok Adalat pages. If a plate was clicked in the
// admin panel in the last two minutes, fill it in and leave the captcha and OTP to the person.
// These pages load their form late (and change it without reloading), so keep trying a while.
(async () => {
  const store = chrome.storage.local;
  const { pendingPlate } = await store.get('pendingPlate');
  if (!pendingPlate || Date.now() - pendingPlate.at > 2 * 60_000) return;
  const { fillPage } = await import(chrome.runtime.getURL('fill.js'));

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>.box{font:13px system-ui,sans-serif;background:#fff;color:#111827;border:2px solid #0f766e;border-radius:10px;padding:10px 12px;width:240px;box-shadow:0 6px 20px rgba(0,0,0,.2)} b{color:#0f766e}</style>
    <div class="box"><b>Niptao</b> · <span id="lead"></span><div id="msg" style="margin-top:6px"></div></div>`;
  root.querySelector('#lead').textContent = pendingPlate.plate;
  const say = (t) => { root.querySelector('#msg').textContent = t; };
  say('Waiting for the vehicle number box…');
  document.documentElement.appendChild(host);

  let done = false;
  const tryFill = async () => {
    if (done) return;
    const { filled } = await fillPage({ plate: pendingPlate.plate });
    if (!filled.length) return;
    done = true;
    await store.remove('pendingPlate');
    say('Vehicle number filled. Type the captcha (and OTP when it comes) yourself, then continue.');
    setTimeout(() => host.remove(), 20_000);
  };
  // Try now, whenever the page changes, and give up after two minutes.
  await tryFill();
  const watch = new MutationObserver(() => { clearTimeout(watch.t); watch.t = setTimeout(tryFill, 400); });
  watch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => {
    watch.disconnect();
    if (!done) say('Couldn\'t find the vehicle number box. Right-click the box and pick "Niptao: fill vehicle number", or paste with Ctrl+V.');
  }, 2 * 60_000);
})();
