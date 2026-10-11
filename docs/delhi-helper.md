# India helper for the Delhi challan check

The site runs on Render, outside India, and the Delhi Traffic Police site doesn't answer servers outside India.
`delhi-proxy/` is a tiny helper that runs on Fly.io in Mumbai and passes the Delhi check through India.
It only talks to traffic.delhipolice.gov.in and only for callers that know its password.

## Set it up (once)

1. Sign up at fly.io and add a payment card (the helper sleeps when unused; expect a few dollars a month at most).
2. On fly.io: **Account → Access Tokens → Create token**. Copy the token.
3. On GitHub, open the challan-website repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name `FLY_API_TOKEN`, value: the token from step 2.
   - Name `DELHI_PROXY_KEY`, value: any long password you make up (30+ letters and numbers). Keep it for step 5.
4. On GitHub: **Actions → Deploy Delhi helper to Fly.io → Run workflow → Run workflow**. Wait for the green tick.
   The last step prints the address, normally `https://niptao-delhi.fly.dev`. If the name is taken, run it again with another name.
5. On Render: **niptao-challan-site → Environment → Add**:
   - `DELHI_PROXY_URL` = the address from step 4
   - `DELHI_PROXY_KEY` = the same password as step 3
   Save; Render redeploys.
6. In the admin panel, open a lead with a Delhi number and press **Try automatic Delhi check**. It should say "Through the India helper".

To switch it off, delete `DELHI_PROXY_URL` in Render.
