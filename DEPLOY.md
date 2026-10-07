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

## 2. See your leads in a Google Sheet

The site collects name, vehicle number and mobile number. Render's free plan wipes
the server's files on restart, so send every lead to a Google Sheet as well:

1. Create a new Google Sheet (sheets.new).
2. Click **Extensions** → **Apps Script**. Delete what's there and paste in everything
   from `docs/google-sheet-leads.gs` in this repo. Click the save icon.
3. Click **Deploy** → **New deployment**. Click the gear next to "Select type" and pick
   **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**,
   allow the permissions Google asks for, and copy the **Web app URL**.
4. In Render, open the service → **Environment** → **Add Environment Variable**:
   `LEADS_WEBHOOK_URL` = the URL you copied. Click **Save, rebuild, and deploy**.

Every new lead now appears as a row in the sheet. If the sheet is ever unreachable,
the full lead is still written to Render's **Logs**.

## 3. Admin panel

The admin panel is at `/admin` on your site (e.g. `https://niptao-challan-site.onrender.com/admin`).
It lists every lead, lets you change status, assign a person, add notes, call or WhatsApp
the customer, and download a CSV.

**Database (Neon, free)** — so leads are kept permanently:
1. Go to **neon.tech** and sign up with Google.
2. Create a project. Name: `niptao`. Region: **Asia Pacific (Singapore)**.
3. On the project dashboard click **Connect** and copy the connection string
   (it starts with `postgresql://`).
4. In Render → **Environment** add `DATABASE_URL` = that string.

**Password:** in Render → **Environment** add `ADMIN_PASSWORD` = a password of at least
8 characters that only your team knows.

Click **Save, rebuild, and deploy**. Sign in at `/admin` with your name and that password.
The table is created automatically on first use.

## 4. Later: switch on automatic challan lookup

The site currently only collects leads. The OTP and InstantPay challan lookup code is
still in `server/` and can be switched back on later.

In Render, open the service → **Environment** → **Add Environment Variable** for the
two keys, and edit `CHALLAN_PROVIDER`:

| Key | Value |
|---|---|
| `INSTANTPAY_CLIENT_ID` | from your InstantPay dashboard |
| `INSTANTPAY_CLIENT_SECRET` | from your InstantPay dashboard |
| `CHALLAN_PROVIDER` | change `mock` to `instantpay` |

Save. Render restarts the site, and challan lookups are live. Test with a vehicle
number you know has challans. If something is wrong with the keys, customers see the
"we'll check manually" form, and **Logs** in Render says why.

## 5. Before taking real customers

- **Leads:** connect the Neon database above. Without it, leads are lost when the free
  server restarts (the Google Sheet is an optional extra copy).
- **The free plan sleeps.** After 15 minutes of no visitors the site takes ~30 seconds
  to wake up. Render's paid plan removes that.
- **Contact details** in the footer and the WhatsApp button are still placeholders.
  Set `VITE_PHONE`, `VITE_WHATSAPP` and `VITE_EMAIL` in Render, then redeploy.
