// Niptao's helper in Mumbai (Fly.io, region bom). Government sites such as Delhi Traffic Police often
// refuse servers outside India, so the main site (on Render, outside India) asks through this helper.
// It only forwards requests to the hosts below, and only for callers that send DELHI_PROXY_KEY.
import http from 'node:http';

const KEY = process.env.DELHI_PROXY_KEY || '';
const HOSTS = new Set(['traffic.delhipolice.gov.in']);
const PORT = Number(process.env.PORT) || 8080;

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  if (req.url === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/fetch') return send(res, 404, { error: 'not_found' });
  if (!KEY || req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: 'bad_key' });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return send(res, 413, { error: 'too_big' }); }
  let job;
  try { job = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad_json' }); }
  let url;
  try { url = new URL(job.url); } catch { return send(res, 400, { error: 'bad_url' }); }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return send(res, 403, { error: 'host_not_allowed' });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { method: job.method === 'POST' ? 'POST' : 'GET', headers: job.headers || {}, body: job.method === 'POST' ? String(job.body || '') : undefined, redirect: 'manual', signal: ctl.signal });
    const body = (await r.text()).slice(0, 2_000_000);
    send(res, 200, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || '', location: r.headers.get('location') || '', 'set-cookie': r.headers.getSetCookie?.() || [] }, body });
  } catch (err) {
    send(res, 502, { error: err.name === 'AbortError' ? 'timeout' : (err.cause?.code || err.message) });
  } finally { clearTimeout(timer); }
}).listen(PORT, () => console.log(`delhi helper on :${PORT}`));
