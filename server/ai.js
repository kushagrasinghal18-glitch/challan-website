// AI replies on WhatsApp (Google Gemini). On when GEMINI_API_KEY is set in the server environment
// (Render → Environment). GEMINI_MODEL picks the model; otherwise gemini-flash-latest (with older names as fallbacks).
// The AI answers questions about Niptao, asks for the vehicle number and name, and says when the
// customer claims to have paid or needs a person. It never sends anything on its own: autopilot.js decides.
import { PLATE_RE, normalizePlate } from './plate.js';

export const aiConfigured = (env = process.env) => !!env.GEMINI_API_KEY;
const MODEL = (env) => env.GEMINI_MODEL || 'gemini-2.5-flash';
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const CITY = { noida: 'Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };

const BASE = `You are the WhatsApp assistant of Niptao (niptao.co.in), replying to customers on Niptao's WhatsApp number.

About Niptao:
- Niptao helps vehicle owners in Delhi NCR (Delhi, Noida, Ghaziabad, Gurugram) settle pending traffic e-challans at the Lok Adalat.
- Checking challans is free. The customer pays a flat 50% of the challan amount they choose to settle (some offers are lower). Nothing is charged until the team has checked the challans and the customer has approved the list and amount in writing.
- The customer does not need to go to court. Niptao's team attends the Lok Adalat on their behalf with a signed authorisation letter.
- 100% refund promise: if a challan is not cleared at the Lok Adalat, the full amount paid for it is refunded after the Lok Adalat date.
- Most compoundable offences (over-speeding, red light, helmet/seatbelt, parking, documents) are usually taken up. Drunk driving, accident cases and challans already sent to regular court usually are not. The team confirms each challan.
- A Lok Adalat settlement is final. Niptao is a private service, not a government website, court or police.

How the process works:
1. Customer shares the vehicle number(s) and their name. 2. The team checks every pending challan and contacts them with the eligible challans and the price. 3. The customer replies "I APPROVE" to the approval message. 4. Payment details (UPI) are sent; the customer pays and sends the payment screenshot. 5. Customer shares RC, driving licence and Aadhaar (an upload link is sent). 6. The team settles the challans at the Lok Adalat and sends the receipt.

Rules:
- Reply in the customer's language and script (English, Hindi, or Hinglish in Roman letters). Short and friendly, like a person on WhatsApp: 1 to 4 short lines. WhatsApp formatting only (*bold*), no markdown headings or links other than niptao.co.in.
- Your main job early on: get the vehicle registration number(s) and the customer's name, then say the team will check the challans and get back on WhatsApp.
- Never invent challan numbers, amounts, dates or results. Only use amounts and dates given below in "This customer". If you don't know, say the team will confirm.
- Never name a court; courts are decided later. Never ask for OTPs, passwords, card or bank details. Payment details are only sent by the system.
- Never say a payment has been received or confirmed; say the team will check and confirm.
- Don't argue or promise anything beyond the facts above. If the customer is upset, asks for a call or a person, asks something you can't answer from these facts, or talks about something unrelated, set "handoff" to true and tell them a team member will reply soon.
- If the customer says they have paid (or sends a payment screenshot), set "paid" to true and thank them; say the team will check and confirm.
- "plates": every vehicle registration number the customer gave in their latest messages, as written (e.g. "UP16AB1234"). Empty if none.
- "name": the customer's name if they told you, else empty.

Answer only with JSON: {"reply": string, "plates": string[], "name": string, "paid": boolean, "handoff": boolean}.`;

// What the AI knows about this customer: their vehicles and where each stands.
export function customerFacts(leads, site = {}, today = new Date().toISOString().slice(0, 10)) {
  const lines = [];
  const named = leads.find((l) => l.name && l.name !== 'WhatsApp customer');
  lines.push(`Name: ${named ? named.name : 'not known yet'}`);
  const withPlate = leads.filter((l) => l.plate);
  if (!withPlate.length) lines.push('Vehicles: none shared yet.');
  for (const l of withPlate) {
    const ok = (l.challans || []).filter((c) => c.approved);
    const rate = [50, 40, 30].includes(l.feeRate) ? l.feeRate : 50;
    const payable = Math.round((ok.reduce((n, c) => n + (c.amount || 0), 0) * rate) / 100);
    const parts = [`Vehicle ${l.plate}: stage "${l.status}"`];
    if (!l.challans) parts.push('challans not checked yet');
    else if (!l.challans.length) parts.push('no pending challans found');
    else parts.push(`${l.challans.length} challan(s) found`);
    if (l.waApproval?.state === 'sent') parts.push(`approval message sent, waiting for "I APPROVE" (${ok.length} challan(s), customer pays ${inr(payable)})`);
    if (l.waApproval?.state === 'received') parts.push(`customer approved ${ok.length} challan(s), pays ${inr(payable)}`);
    if (l.paymentSent && !l.payment) parts.push('payment details sent, payment not confirmed yet');
    if (l.paymentClaim && !l.payment) parts.push('customer said they paid; team is checking');
    if (l.payment) parts.push(`payment of ${inr(l.payment.amount)} confirmed`);
    lines.push(parts.join('; ') + '.');
  }
  const dates = (site.lokAdalatDates || []).filter((d) => d.date >= today).slice(0, 6);
  lines.push(dates.length ? `Upcoming Lok Adalat dates: ${dates.map((d) => `${CITY[d.city] || d.city} ${d.date}`).join(', ')}.` : 'Upcoming Lok Adalat dates: not announced yet.');
  return lines.join('\n');
}

export function systemPrompt(leads, site, notes = '') {
  return `${BASE}\n\n${notes.trim() ? `Extra notes from the Niptao team (follow these too):\n${notes.trim()}\n\n` : ''}This customer:\n${customerFacts(leads, site)}`;
}

// The chat as Gemini turns: customer → user, Niptao → model, neighbours of the same side joined.
export function toContents(chat) {
  const out = [];
  for (const m of chat.slice(-30)) {
    const role = m.dir === 'in' ? 'user' : 'model';
    const text = String(m.text || '').slice(0, 1500);
    if (!text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += `\n${text}`;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// Model answer → { reply, plates, name, paid, handoff }, or null when it can't be used.
export function parseAnswer(text) {
  let j;
  try { j = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; }
  const reply = String(j?.reply || '').trim().slice(0, 1200);
  if (!reply) return null;
  const plates = [...new Set((Array.isArray(j.plates) ? j.plates : []).map(normalizePlate).filter((p) => PLATE_RE.test(p)))].slice(0, 20);
  const name = String(j.name || '').replace(/[^\p{L} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { reply, plates, name: name.length >= 2 ? name : '', paid: j.paid === true, handoff: j.handoff === true };
}

// Which model to use. Google retires model names over time (gemini-2.5-flash now answers 404 for many
// keys), so the server asks Google which models this key can use and picks the best Flash model:
// GEMINI_MODEL if set and available, else gemini-flash-latest, else the newest stable Flash.
const FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
let working = '';
let listed = { at: 0, names: null };
export const aiModel = () => working;
const API = 'https://generativelanguage.googleapis.com/v1beta';
const keyOf = (env) => String(env.GEMINI_API_KEY || '').trim();

async function gfetch(url, opts, ms) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
  catch (err) { throw new Error(err.name === 'TimeoutError' ? 'Gemini took too long to answer. Try again.' : `Could not reach Gemini: ${err.message}`); }
}

// Models this key can call for text, from Google's own list. Throws a plain reason if the key is refused.
export async function listModels(env = process.env) {
  if (listed.names && Date.now() - listed.at < 6 * 3600e3) return listed.names;
  const res = await gfetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': keyOf(env) } }, 15_000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(explainError(res.status, data.error?.message)), { status: res.status });
  const names = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
  listed = { at: Date.now(), names };
  return names;
}

// Best text model from a list of names: chosen one, then the "latest" alias, then the newest plain Flash.
export function pickModel(names, wanted = '') {
  if (wanted && names.includes(wanted)) return wanted;
  if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest';
  const ver = (n) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const flash = names.filter((n) => /^gemini-[\d.]+-flash(-\d+)?$/.test(n)).sort((a, b) => ver(b) - ver(a));
  return flash[0] || names.find((n) => /flash/.test(n) && !/(lite|image|tts|live|audio|embedding|thinking)/.test(n)) || '';
}

export async function modelsToTry(env = process.env) {
  let best = '';
  try { best = pickModel(await listModels(env), env.GEMINI_MODEL); }
  catch (err) { if (err.status) throw err; /* list unreachable: fall back to known names */ }
  return [...new Set([working, best, env.GEMINI_MODEL, ...FALLBACKS].filter(Boolean))];
}

// Plain-English reason for a failed call, shown in Settings.
export function explainError(status, message = '') {
  const m = String(message);
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return 'The GEMINI_API_KEY in Render is not valid. Copy it again from aistudio.google.com.';
  if (status === 403) return `Google refused the key (${m.slice(0, 120)}). Check the key in Render and that the Gemini API is enabled for it.`;
  if (status === 429) return 'The Gemini key has run out of free requests for now (quota). Wait a bit, or turn on billing for the key in Google AI Studio.';
  return `Gemini error ${status || ''}: ${m.slice(0, 200)}`.trim();
}

export async function aiAnswer({ chat, leads, site, notes }, env = process.env) {
  const contents = toContents(chat);
  if (!contents.length || contents[contents.length - 1].role !== 'user') return null;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt(leads, site, notes) }] },
    contents,
    generationConfig: {
      // Newer models "think" first and that counts towards this limit, so leave plenty of room.
      temperature: 0.4, maxOutputTokens: 8192, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', required: ['reply', 'plates', 'name', 'paid', 'handoff'], properties: {
        reply: { type: 'STRING' }, plates: { type: 'ARRAY', items: { type: 'STRING' } }, name: { type: 'STRING' }, paid: { type: 'BOOLEAN' }, handoff: { type: 'BOOLEAN' } } },
    },
  });
  let last = null;
  for (const model of await modelsToTry(env)) {
    const res = await gfetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyOf(env) }, body,
    }, 25_000);
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) { last = `model ${model} not available`; if (working === model) working = ''; continue; }
    if (!res.ok) throw Object.assign(new Error(explainError(res.status, data.error?.message)), { status: res.status });
    working = model;
    const cand = data.candidates?.[0];
    const answer = parseAnswer(cand?.content?.parts?.map((p) => p.text || '').join(''));
    if (!answer) throw new Error(`Gemini (${model}) gave no usable answer${cand?.finishReason ? ` (${cand.finishReason})` : data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''}.`);
    return answer;
  }
  throw new Error(`No Gemini model answered (${last}). Set GEMINI_MODEL in Render to a current model name from aistudio.google.com.`);
}

// Settings → "Check Gemini": is the key accepted, which model will be used, and does a tiny request work?
export async function checkGemini(env = process.env) {
  if (!keyOf(env)) return { ok: false, error: 'GEMINI_API_KEY is not set in Render → Environment.' };
  let names;
  try { names = await listModels({ ...env }); } catch (err) { return { ok: false, error: err.message }; }
  const model = pickModel(names, env.GEMINI_MODEL);
  if (!model) return { ok: false, error: 'This key has no Flash model available. Set GEMINI_MODEL in Render to one of the models listed.', models: names.slice(0, 30) };
  try {
    const a = await aiAnswer({ chat: [{ dir: 'in', text: 'Hi' }], leads: [], site: {} }, env);
    return { ok: true, model: working || model, sample: a?.reply || '', wanted: env.GEMINI_MODEL || '', wantedMissing: !!env.GEMINI_MODEL && !names.includes(env.GEMINI_MODEL) };
  } catch (err) { return { ok: false, model, error: err.message }; }
}
