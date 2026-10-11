// Delhi Traffic Police notices (traffic.delhipolice.gov.in/notice/pay-notice). Not a published API: this
// copies what the public page does (cookie + CSRF token from the page, then the search request) so the
// team can see from the live server whether the site answers. Nothing is saved; the result is shown as is.
const BASE = 'https://traffic.delhipolice.gov.in/notice';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const cookiesOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

export async function tryDelhi(plate, { fetchFn = fetch, timeoutMs = 15000 } = {}) {
  const steps = [];
  const go = async (url, opts) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetchFn(url, { ...opts, signal: ctl.signal, redirect: 'manual' }); }
    finally { clearTimeout(t); }
  };
  try {
    const page = await go(`${BASE}/pay-notice`, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    const html = await page.text();
    const token = (html.match(/name=["'](?:meta-)?csrf-token["'][^>]*content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]*name=["'](?:meta-)?csrf-token/i) || [])[1] || '';
    const captcha = /captcha/i.test(html);
    steps.push(`Page: HTTP ${page.status}, ${token ? 'security token found' : 'no security token found'}${captcha ? ', the page mentions a captcha' : ''}.`);
    if (!page.ok || !token) return { ok: false, steps };
    const body = new URLSearchParams({ search_type: 'vehicle_number', rc_number: plate, _token: token });
    const res = await go(`${BASE}/pending-notice1`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/pay-notice`, Origin: 'https://traffic.delhipolice.gov.in', Cookie: cookiesOf(page), Accept: 'application/json, text/html, */*' },
      body,
    });
    const text = await res.text();
    steps.push(`Search: HTTP ${res.status}${res.headers.get('location') ? ` (redirect to ${res.headers.get('location')})` : ''}, ${res.headers.get('content-type') || 'unknown type'}, ${text.length} characters.`);
    return { ok: res.ok && text.length > 0, steps, sample: text.replace(/\s+/g, ' ').slice(0, 1500) };
  } catch (err) {
    steps.push(err.name === 'AbortError' ? 'The Delhi Police site did not answer in 15 seconds (it may block servers outside India).' : `Could not reach the Delhi Police site: ${err.cause?.code || err.message}.`);
    return { ok: false, steps };
  }
}
