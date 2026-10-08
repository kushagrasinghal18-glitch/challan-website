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
