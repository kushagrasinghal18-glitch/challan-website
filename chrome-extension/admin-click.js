// Runs on the Niptao admin panel. When someone clicks "Open Parivahan e-Challan"
// (any element with data-niptao-plate), remember that plate so the Parivahan tab can fill it.
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-niptao-plate]');
  if (!el) return;
  chrome.storage.local.set({ pendingPlate: { plate: el.dataset.niptaoPlate, at: Date.now() } });
}, true);
