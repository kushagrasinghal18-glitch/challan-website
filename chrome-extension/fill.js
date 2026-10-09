// These functions run inside the token website's page (injected with chrome.scripting),
// so each one must be self-contained: no imports, no outside variables.
//
// They never touch captcha or OTP boxes. They only fill the lead's own details,
// then put the cursor in the captcha box so a person can type it.

// Fill every matching box on the page with the lead's details.
export async function fillPage(lead) {
  const SKIP = /captcha|otp|one.?time|security.?code|verification|password|pin\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

  // Everything a person could read about a box: its label, placeholder, nearby text.
  const describe = (el) => {
    const bits = [el.id, el.name, el.placeholder, el.title, el.getAttribute('aria-label'), el.getAttribute('formcontrolname')];
    if (el.id) document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => bits.push(l.textContent));
    const wrap = el.closest('label');
    if (wrap) bits.push(wrap.textContent);
    // Text just before the box, e.g. "<td>Vehicle No.</td><td><input></td>".
    let node = el.parentElement;
    for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
      const prev = node.previousElementSibling;
      if (prev && prev.textContent.trim().length < 60) { bits.push(prev.textContent); break; }
    }
    return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ');
  };

  const setValue = (el, value) => {
    // Use the browser's own setter so React / Angular pages notice the change.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const set = (v) => Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.focus();
    set(value);
    for (const type of ['input', 'change', 'keyup']) el.dispatchEvent(new Event(type, { bubbles: true }));
    // Some pages only accept typed keys (they clear or reject anything else): type it one key at a time.
    if (el.value !== value) {
      set('');
      for (const ch of value) {
        const key = { key: ch, code: /\d/.test(ch) ? 'Digit' + ch : 'Key' + ch.toUpperCase(), bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', key));
        el.dispatchEvent(new KeyboardEvent('keypress', { ...key, charCode: ch.charCodeAt(0) }));
        set(el.value + ch);
        el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', key));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.style.outline = '3px solid #16a34a';
  };

  // Pages like Parivahan ask "search by Challan / Vehicle / DL" first: pick Vehicle Number.
  const VEHICLE_CHOICE = /vehicle\s*(no|number|num)/i;
  const choice = [...document.querySelectorAll('input[type=radio], [role=tab], .nav-link')]
    .find((el) => visible(el) && VEHICLE_CHOICE.test(el.type === 'radio' ? describe(el) + ' ' + el.value : el.textContent));
  const option = [...document.querySelectorAll('select option')]
    .find((o) => visible(o.closest('select')) && VEHICLE_CHOICE.test(o.textContent));
  if (choice && !(choice.type === 'radio' && choice.checked)) { choice.click(); await sleep(500); }
  else if (option && !option.selected) {
    const sel = option.closest('select');
    sel.value = option.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500);
  }

  const boxes = [...document.querySelectorAll('input, textarea')].filter((el) =>
    visible(el) && !el.disabled && !el.readOnly && /^(text|tel|search|number|email|)$/i.test(el.type || 'text'));

  const RULES = [
    { field: 'mobile', value: lead.phone, test: (d) => /mobile|phone|contact|whatsapp/i.test(d) },
    { field: 'name', value: lead.name, test: (d) => /name/i.test(d) && !/user\s*name|login/i.test(d) },
    { field: 'vehicle number', value: lead.plate, test: (d) => /vehicle|regn|registration|reg\.?\s*no|rc\s*no|number\s*plate/i.test(d) },
  ];

  const filled = [];
  let captcha = null;
  const used = new Set();
  for (const el of boxes) {
    const d = describe(el);
    if (SKIP.test(d)) { if (!captcha && /captcha|security.?code/i.test(d)) captcha = el; continue; }
    const rule = RULES.find((r) => r.value && !filled.includes(r.field) && r.test(d));
    if (!rule || used.has(el)) continue;
    setValue(el, rule.value);
    used.add(el);
    filled.push(rule.field);
  }
  if (captcha) captcha.focus();
  return { filled, captcha: Boolean(captcha) };
}

// Fill just the box the person right-clicked (for pages the automatic match misses).
export function fillFocused(value) {
  const el = document.activeElement;
  if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = (v) => Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  set('');
  for (const ch of value) {
    const key = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', key));
    el.dispatchEvent(new KeyboardEvent('keypress', { ...key, charCode: ch.charCodeAt(0) }));
    set(el.value + ch);
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', key));
  }
  for (const type of ['change', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }));
  el.style.outline = '3px solid #16a34a';
  return true;
}
