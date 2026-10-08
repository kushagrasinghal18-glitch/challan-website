// Runs on Parivahan.
// 1. If a plate was clicked in the admin panel in the last two minutes, fill it in and
//    leave the captcha to the person.
// 2. Once Parivahan shows the challans, read the table and send it to that lead in the
//    admin panel (through background.js, which is allowed to call the Niptao site).
(async () => {
  const FRESH_CLICK = 2 * 60_000, ACTIVE_FOR = 30 * 60_000;
  const store = chrome.storage.local;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let { pendingPlate, activeLead } = await store.get(['pendingPlate', 'activeLead']);
  if (pendingPlate && Date.now() - pendingPlate.at < FRESH_CLICK) {
    activeLead = { ...pendingPlate, at: Date.now() };
    await store.set({ activeLead });
    await store.remove('pendingPlate');
    const { fillPage } = await import(chrome.runtime.getURL('fill.js'));
    for (let i = 0; i < 20; i++) {
      if ((await fillPage({ plate: activeLead.plate })).filled.length) break;
      await sleep(500);
    }
  }
  if (!activeLead || Date.now() - activeLead.at > ACTIVE_FOR || !activeLead.ref) return;

  // ── Small floating box so the person can see what the add-on is doing ──
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .box{font:13px system-ui,sans-serif;background:#fff;color:#111827;border:2px solid #0f766e;border-radius:10px;padding:10px 12px;width:260px;box-shadow:0 6px 20px rgba(0,0,0,.2)}
    b{color:#0f766e} p{margin:6px 0 0} button{margin-top:8px;padding:6px 10px;border:0;border-radius:6px;background:#0f766e;color:#fff;font:inherit;cursor:pointer}
    .x{float:right;background:none;color:#6b7280;margin:0;padding:0}</style>
    <div class="box"><button class="x" title="Hide">✕</button><b>Niptao</b> · <span id="lead"></span><p id="msg"></p><button id="send" hidden>Send again</button></div>`;
  const $ = (s) => root.querySelector(s);
  $('#lead').textContent = `${activeLead.plate} (${activeLead.ref})`;
  $('.x').onclick = () => host.remove();
  const say = (t) => { $('#msg').textContent = t; };
  say('Type the captcha and search. Challans found here will be saved to this lead.');
  document.documentElement.appendChild(host);

  // ── Read the challan table(s) on the page ──
  const FIELDS = [
    ['challanNo', /challan\s*(no|number|id)/i],
    ['date', /date/i],
    ['offence', /offen[cs]e|violation|section/i],
    ['location', /location|place|area/i],
    ['amount', /amount|fine|penalty/i],
    ['status', /status/i],
  ];
  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  // The owner's name as Parivahan shows it (often part-hidden, e.g. "RA*** KUMAR").
  const NAME_COL = /violator|owner|accused|name/i, NOT_NAME = /challan|payment|department|officer|state/i;
  let ownerNames = [];
  const ownerName = () => {
    const count = {};
    for (const n of ownerNames) count[n] = (count[n] || 0) + 1;
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || '';
  };

  function readChallans() {
    const out = [];
    ownerNames = [];
    for (const table of document.querySelectorAll('table')) {
      if (!table.offsetParent) continue;
      const rows = [...table.rows];
      const headIdx = rows.findIndex((r) => /challan/i.test(r.textContent) && r.cells.length > 2);
      if (headIdx < 0) continue;
      const heads = [...rows[headIdx].cells].map((c) => clean(c.textContent));
      const cols = {};
      for (const [key, re] of FIELDS) {
        const i = heads.findIndex((h, j) => re.test(h) && !Object.values(cols).includes(j));
        if (i >= 0) cols[key] = i;
      }
      if (cols.challanNo === undefined) continue;
      const nameCol = heads.findIndex((h) => NAME_COL.test(h) && !NOT_NAME.test(h));
      for (const row of rows.slice(headIdx + 1)) {
        if (row.cells.length < heads.length - 1) continue;
        const c = {};
        for (const [key, i] of Object.entries(cols)) {
          const v = clean(row.cells[i]?.textContent || '');
          if (v) c[key] = v;
        }
        if (c.challanNo && !/challan/i.test(c.challanNo) && !out.some((o) => o.challanNo === c.challanNo)) {
          out.push(c);
          const n = nameCol >= 0 ? clean(row.cells[nameCol]?.textContent || '') : '';
          if (n && /[a-z]/i.test(n)) ownerNames.push(n.toUpperCase());
        }
      }
    }
    return out;
  }
  const saysNone = () => /no\s+(pending\s+)?(challans?|records?|data)\s+(found|available|exists?)/i.test(document.body.innerText);

  let lastSent = null;
  async function send(challans) {
    say(`Saving ${challans.length} challan${challans.length === 1 ? '' : 's'} to ${activeLead.ref}…`);
    const owner = challans.length ? ownerName() : '';
    const res = await chrome.runtime.sendMessage({ type: 'saveChallans', ref: activeLead.ref, challans, ownerName: owner });
    const why = { login: 'Click the N icon and log in, then press Send again.', not_your_lead: 'This lead is assigned to someone else.', not_found: 'This lead no longer exists in the admin panel.' };
    say(res?.ok
      ? (challans.length ? `Saved ${challans.length} challan${challans.length === 1 ? '' : 's'} to ${activeLead.ref}.${owner ? ` Owner on Parivahan: ${owner}${{ match: ' (matches ✓)', partial: ' (partly matches, check with the customer)', mismatch: ' (⚠ doesn\'t match the name given)' }[res.lead?.rcOwner?.match] || ''}.` : ''}` : `Saved "No challans found" to ${activeLead.ref}.`)
      : `Not saved. ${why[res?.error] || `(${res?.error || 'no answer'})`}`);
    $('#send').hidden = false;
  }
  $('#send').onclick = () => send(lastSent || []);

  // Wait until the page stops changing for a moment, then send if the results changed.
  let timer;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const challans = readChallans();
      if (!challans.length && !saysNone()) return;
      const sig = JSON.stringify(challans);
      if (sig === JSON.stringify(lastSent)) return;
      lastSent = challans;
      send(challans);
    }, 1500);
  };
  new MutationObserver(check).observe(document.body, { childList: true, subtree: true, characterData: true });
  check();
})();
