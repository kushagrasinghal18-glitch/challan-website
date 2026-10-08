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

// Parivahan's page asks us to save the challans it found onto the lead in the admin panel.
const SITE = 'https://niptao-challan-site.onrender.com';
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'saveChallans') return;
  (async () => {
    const { auth } = await chrome.storage.local.get('auth');
    if (!auth?.token) return reply({ ok: false, error: 'login' });
    try {
      const res = await fetch(`${SITE}/api/admin/leads/${encodeURIComponent(msg.ref)}/challans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ source: 'Parivahan', challans: msg.challans }),
      });
      if (res.status === 401) { await chrome.storage.local.remove('auth'); return reply({ ok: false, error: 'login' }); }
      const body = await res.json().catch(() => ({}));
      reply(res.ok ? { ok: true, ...body } : { ok: false, error: body.error || `error ${res.status}` });
    } catch (err) {
      reply({ ok: false, error: err.message });
    }
  })();
  return true; // keep the channel open for the async reply
});
