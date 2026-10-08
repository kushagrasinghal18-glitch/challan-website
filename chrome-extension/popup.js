import { fillPage } from './fill.js';

const SITE = 'https://niptao-challan-site.onrender.com';
const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;

let auth = null; // { token, user }
let leads = [];

async function api(path, opts = {}) {
  const res = await fetch(SITE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
  });
  if (res.status === 401 && auth) { await logout(); throw new Error('Please log in again.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

function show(view) {
  $('login').hidden = view !== 'login';
  $('main').hidden = view !== 'main';
  $('logout').hidden = view !== 'main';
}

async function logout() {
  auth = null;
  await store.remove(['auth', 'lead']);
  show('login');
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    auth = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
    });
    await store.set({ auth });
    $('password').value = '';
    await loadLeads();
  } catch (err) {
    auth = null;
    $('loginError').textContent = err.message === 'wrong_password' ? 'Wrong username or password.' : `Could not log in (${err.message}).`;
  }
});
$('logout').addEventListener('click', logout);

async function loadLeads() {
  show('main');
  $('listNote').textContent = 'Loading leads… (the site can take up to a minute to wake up)';
  try {
    leads = (await api('/api/admin/leads')).leads || [];
    leads.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    renderList();
  } catch (err) {
    $('listNote').textContent = `Could not load leads: ${err.message}`;
  }
}

function renderList() {
  const q = $('search').value.trim().toLowerCase().replace(/\s+/g, '');
  const match = leads.filter((l) => !q || [l.name, l.plate, l.phone, l.ref].some((v) => String(v || '').toLowerCase().replace(/\s+/g, '').includes(q)));
  $('leads').replaceChildren(...match.slice(0, 100).map((l) => {
    const li = document.createElement('li');
    li.innerHTML = '<div class="row"><span></span><span class="plate"></span></div><div class="row muted"><span></span><span></span></div>';
    const [name, plate, phone, status] = li.querySelectorAll('span');
    name.textContent = l.name;
    plate.textContent = l.plate;
    phone.textContent = l.phone;
    status.textContent = `${l.status || ''} · ${l.ref || ''}`;
    li.addEventListener('click', () => select(l));
    return li;
  }));
  $('listNote').textContent = match.length ? '' : 'No leads found.';
}
$('search').addEventListener('input', renderList);

async function select(lead) {
  const picked = { ref: lead.ref, name: lead.name, plate: lead.plate, phone: lead.phone };
  await store.set({ lead: picked });
  showCurrent(picked);
}

function showCurrent(lead) {
  $('current').hidden = !lead;
  if (!lead) return;
  $('curRef').textContent = lead.ref || '';
  $('curName').textContent = lead.name;
  $('curPlate').textContent = lead.plate;
  $('curPhone').textContent = lead.phone;
  $('fillResult').textContent = '';
}

$('fill').addEventListener('click', async () => {
  const { lead } = await store.get('lead');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: fillPage, args: [lead] });
    const filled = [...new Set(results.flatMap((r) => r.result?.filled || []))];
    const captcha = results.some((r) => r.result?.captcha);
    $('fillResult').textContent = filled.length
      ? `Filled ${filled.join(', ')}. Now type the captcha${captcha ? ' (cursor is in the box)' : ''} and OTP yourself, then submit.`
      : 'No matching boxes found on this page. Right-click a box and pick "Niptao: fill …" instead.';
  } catch (err) {
    $('fillResult').textContent = `Can't fill this page (${err.message}). Open the token website tab first.`;
  }
});

(async () => {
  const saved = await store.get(['auth', 'lead']);
  auth = saved.auth || null;
  showCurrent(saved.lead);
  if (auth) await loadLeads(); else show('login');
})();
