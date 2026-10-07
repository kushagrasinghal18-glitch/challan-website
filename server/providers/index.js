import * as mock from './mock.js';
import * as http from './http.js';
import * as instantpay from './instantpay.js';
import { classify, lookupOffence } from '../offences.js';

const PROVIDERS = { mock, http, instantpay };

// Live lookups cost money per call, so repeat checks of the same plate
// (back button, OTP resend, a second tab) reuse a recent answer.
const CACHE_MS = 10 * 60_000;
const cache = new Map(); // plate → { at, value }

// Safety cap on paid lookups per day (India time), so a misbehaving bot can't
// drain the InstantPay balance. Over the cap, customers get the manual-check form.
const usage = { day: '', count: 0 };
const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
function takeLiveLookup(env) {
  const max = Number(env.MAX_LIVE_LOOKUPS_PER_DAY ?? 100);
  if (usage.day !== todayIST()) Object.assign(usage, { day: todayIST(), count: 0 });
  if (max > 0 && usage.count >= max) throw new Error(`Daily live lookup cap (${max}) reached`);
  usage.count++;
}

export function providerName(env = process.env) {
  return PROVIDERS[env.CHALLAN_PROVIDER] ? env.CHALLAN_PROVIDER : 'mock';
}

function enrich(c) {
  const known = lookupOffence(c.offence);
  return {
    ...c,
    offenceHi: known?.hi ?? null,
    ...classify(c),
  };
}

// → { source: 'mock' | 'http', challans: [...] }; throws when the provider is unreachable.
export async function getChallans(plate, env = process.env, ctx = {}) {
  const name = providerName(env);
  const hit = cache.get(plate);
  if (name !== 'mock' && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    if (name !== 'mock') takeLiveLookup(env);
    const rows = await PROVIDERS[name].fetchChallans(plate, env, ctx);
    const value = { source: name, challans: rows.map(enrich) };
    if (name !== 'mock') cache.set(plate, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (name !== 'mock' && env.CHALLAN_FALLBACK_TO_MOCK === 'true') {
      console.warn(`[challans] ${name} failed (${err.message}); serving mock data`);
      const rows = await mock.fetchChallans(plate);
      return { source: 'mock', challans: rows.map(enrich) };
    }
    throw err;
  }
}
