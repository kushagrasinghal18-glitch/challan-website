// Server-free stand-in for api.js, used by `npm run build:static` so the page
// can be hosted as plain files for demos. Runs the same mock provider and
// eligibility rules as the server, in the browser. Never use it in production.
import { fetchChallans as mockFetch } from '../server/providers/mock.js';
import { classify, lookupOffence } from '../server/offences.js';


export const getConfig = async () => ({ otpMode: 'demo', challanSource: 'mock' });
export const sendOtp = async () => ({ ok: true, resendAfter: 30 });
export const verifyOtp = async () => {};
export async function fetchChallans(plate) {
  const p = plate.replace(/\s/g, '');
  const rows = await mockFetch(p);
  return { plate: p, source: 'mock', fetchedAt: new Date().toISOString(), challans: rows.map((c) => ({ ...c, offenceHi: lookupOffence(c.offence)?.hi ?? null, ...classify(c) })) };
}
export const createLead = async ({ city, plate, extraPlates = [] }) => {
  const plates = [plate, ...extraPlates];
  const refs = plates.map(() => ({ ghaziabad: 'GZB', delhi: 'DEL', gurugram: 'GGN' }[city] || 'GBN') + '-26' + Math.floor(10000 + Math.random() * 89999));
  return { ref: refs[0], refs, plates };
};
export const checkPromo = async (code) => {
  if (String(code).toUpperCase() !== 'FLAT50') throw Object.assign(new Error('invalid_promo'), { status: 404 });
  return { code: 'FLAT50', title: 'Flat 50% off your challans', pays: 50 };
};
