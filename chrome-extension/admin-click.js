// Runs on the Niptao admin panel.
// - Keeps a copy of the admin login, so Parivahan and WhatsApp Web can save to the admin panel.
// - When someone clicks "Open Parivahan e-Challan" (any element with data-niptao-plate),
//   remembers that plate and lead ref so the Parivahan tab can fill it.
function copyLogin(save = {}) {
  try {
    const login = JSON.parse(localStorage.getItem('niptao-admin'));
    if (login?.token) save.auth = { token: login.token, user: login.user, origin: location.origin };
  } catch { /* not logged in here */ }
  if (Object.keys(save).length) chrome.storage.local.set(save);
}

copyLogin();
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-niptao-plate]');
  copyLogin(el ? { pendingPlate: { plate: el.dataset.niptaoPlate, ref: el.dataset.niptaoRef || '', at: Date.now() } } : {});
}, true);
