// Runs on Parivahan. If a plate was clicked in the admin panel in the last two minutes,
// fill it in (retrying while the page finishes loading), then leave the captcha to the person.
(async () => {
  const { pendingPlate } = await chrome.storage.local.get('pendingPlate');
  if (!pendingPlate || Date.now() - pendingPlate.at > 2 * 60_000) return;
  const { fillPage } = await import(chrome.runtime.getURL('fill.js'));
  for (let i = 0; i < 20; i++) {
    const { filled } = await fillPage({ plate: pendingPlate.plate });
    if (filled.length) { await chrome.storage.local.remove('pendingPlate'); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
})();
