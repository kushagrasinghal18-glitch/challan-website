import { fillFocused } from './fill.js';

// Right-click menu for pages where "Fill this page" can't find the right box.
const ITEMS = [
  { id: 'plate', title: 'Niptao: fill vehicle number' },
  { id: 'phone', title: 'Niptao: fill mobile number' },
  { id: 'name', title: 'Niptao: fill name' },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const item of ITEMS) chrome.contextMenus.create({ ...item, contexts: ['editable'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { lead } = await chrome.storage.local.get('lead');
  if (!lead || !tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
    func: fillFocused,
    args: [lead[info.menuItemId]],
  });
});

// Pages on Parivahan and WhatsApp Web ask us to save things to the admin panel. Only this
// background worker may call the Niptao site, so they send the data here.
const DEFAULT_SITE = 'https://www.niptao.co.in';
async function post(path, body) {
  const { auth } = await chrome.storage.local.get('auth');
  if (!auth?.token) return { ok: false, error: 'login' };
  try {
    const res = await fetch(`${auth.origin || DEFAULT_SITE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { await chrome.storage.local.remove('auth'); return { ok: false, error: 'login' }; }
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...data } : { ok: false, error: data.error || `error ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'saveChallans') {
    post(`/api/admin/leads/${encodeURIComponent(msg.ref)}/challans`, { source: 'Parivahan', challans: msg.challans }).then(reply);
  } else if (msg?.type === 'saveWhatsApp') {
    post('/api/admin/whatsapp-web', msg.body).then(reply);
  } else return;
  return true; // keep the channel open for the async reply
});
