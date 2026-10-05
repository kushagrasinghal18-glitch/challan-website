# Putting the site online

The site is two things in one: the page people see, and a small server that fetches
challans and saves bookings. It needs a host that can run Node, so a plain file host
(GitHub Pages, Netlify drop) won't do. These steps use [Render](https://render.com),
which has a free plan.

## 1. Deploy

1. Go to **render.com** and sign up with your GitHub account.
2. Click **New** → **Blueprint**.
3. Pick this repository. Render reads `render.yaml` and fills everything in.
4. Click **Apply**. The first build takes a few minutes.

Render gives the site an address like `https://niptao-challan-site.onrender.com`.
At this point it works on sample challan data.

## 2. Switch on real challan data

In Render, open the service → **Environment**:

| Key | Value |
|---|---|
| `INSTANTPAY_CLIENT_ID` | from your InstantPay dashboard |
| `INSTANTPAY_CLIENT_SECRET` | from your InstantPay dashboard |
| `CHALLAN_PROVIDER` | change `mock` to `instantpay` |

Save. Render restarts the site, and challan lookups are live. Test with a vehicle
number you know has challans. If something is wrong with the keys, customers see the
"we'll check manually" form, and **Logs** in Render says why.

## 3. Before taking real customers

- **OTP is not real yet.** Any 6 digits are accepted. Connect an SMS service and
  `OTP_MODE=console` to send real codes (see README).
- **Bookings reset.** On Render's free plan the server's files are wiped on every
  deploy and on restart, so `data/leads.json` is not safe storage. Add a Render disk
  (paid) mounted at `/data` with `LEADS_FILE=/data/leads.json`, or move to a database.
- **The free plan sleeps.** After 15 minutes of no visitors the site takes ~30 seconds
  to wake up. Render's paid plan removes that.
- **Contact details** in the footer and the WhatsApp button are still placeholders.
  Set `VITE_PHONE`, `VITE_WHATSAPP` and `VITE_EMAIL` in Render, then redeploy.
