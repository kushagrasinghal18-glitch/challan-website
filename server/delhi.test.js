import test from 'node:test';
import assert from 'node:assert/strict';
import { tryDelhi } from './delhi.js';

test('Delhi check sends the page token and cookie, and reports what came back', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    if (calls.length === 1) return new Response('<meta name="csrf-token" content="tok123">', { headers: { 'set-cookie': 'sess=abc; path=/' } });
    return new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } });
  };
  const r = await tryDelhi('DL3CAB1234', { fetchFn });
  assert.equal(r.ok, true);
  assert.equal(calls[1].opts.headers['X-CSRF-TOKEN'], 'tok123');
  assert.equal(calls[1].opts.headers.Cookie, 'sess=abc');
  assert.match(String(calls[1].opts.body), /rc_number=DL3CAB1234/);
  assert.equal(r.sample, '{"data":[]}');
});

test('Delhi check explains a site that cannot be reached', async () => {
  const r = await tryDelhi('DL3CAB1234', { fetchFn: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }); } });
  assert.equal(r.ok, false);
  assert.match(r.steps[0], /ECONNRESET/);
});
