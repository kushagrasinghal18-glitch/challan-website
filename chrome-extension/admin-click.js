// Runs on the Niptao admin panel. When someone clicks "Open Parivahan e-Challan"
// (any element with data-niptao-plate), remember that plate and lead ref so the Parivahan
// tab can fill it, plus the admin login so the challans found there can be saved back.
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-niptao-plate]');
  if (!el) return;
  const save = { pendingPlate: { plate: el.dataset.niptaoPlate, ref: el.dataset.niptaoRef || '', at: Date.now() } };
  try {
    const login = JSON.parse(localStorage.getItem('niptao-admin'));
    if (login?.token) save.auth = { token: login.token, user: login.user };
  } catch { /* not logged in here */ }
  chrome.storage.local.set(save);
}, true);
