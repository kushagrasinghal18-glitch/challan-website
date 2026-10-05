import * as mock from './mock.js';
import * as http from './http.js';
import * as instantpay from './instantpay.js';
import { classify, lookupOffence } from '../offences.js';

const PROVIDERS = { mock, http, instantpay };

// Live lookups cost money per call, so repeat checks of the same plate
// (back button, OTP resend, a second tab) reuse a recent answer.
const CACHE_MS = 10 * 60_000;
const cache = new Map(); // plate → { at, value }

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
