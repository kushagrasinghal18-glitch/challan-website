# Niptao: challan settlement site

> **Current mode: lead capture only.** The check button opens one form (name, vehicle number, mobile). Leads are saved to Postgres when `DATABASE_URL` is set (otherwise `data/leads.json`) and optionally sent to `LEADS_WEBHOOK_URL`. The admin panel at `/admin` (`src/admin/`, password `ADMIN_PASSWORD`) lists and manages them. The OTP and challan lookup described below are built but not used by the page right now.

The customer-facing page from the Claude Design file *Traffic Challan Settlement Platform* (`Challan Site.dc.html`), built as a React (Vite) front end with a small Express API that fetches challan data.

Hosting it: see [DEPLOY.md](DEPLOY.md).

## Run it

```bash
npm install
cp .env.example .env     # optional, the defaults run fully on mock data
npm run dev              # web on http://localhost:5173, API on :8787
```

Production: `npm run build && npm start` serves the built page and the API from one Node process on `PORT`.

Tests for the provider adapter: `npm test`.

Server-free demo: `npm run build:static` writes plain files to `dist-static/` that run the same mock data in the browser, for quick hosting (no OTP or real API).

### Trying the flow on mock data

| Vehicle number ends in | What you see |
|---|---|
| `0000` (e.g. `UP16 AB 0000`) | No pending challans, WhatsApp alert offer |
| `9999` | Provider outage, "we'll check manually" form |
| anything else | A stable set of 2–5 sample challans for that plate |

In `OTP_MODE=demo` any 6 digits pass verification.

## How the challan API is wired

```
Browser ──► /api/otp/send ─► /api/otp/verify ──(session token)──► /api/challans?plate=…
                                                                    │
                                                         server/providers/index.js
                                                            ├─ mock.js        (default)
                                                            ├─ instantpay.js  (InstantPay)
                                                            └─ http.js        (any other provider)
```

The browser never calls the challan provider itself, so the provider's API key stays on the server. Challan data is only returned after OTP verification, as the design requires.

`GET /api/challans` returns:

```json
{
  "plate": "UP16AB1234",
  "source": "mock",
  "fetchedAt": "2026-10-03T16:19:04.242Z",
  "challans": [
    {
      "challanNo": "UP54783987265064",
      "date": "2026-09-09",
      "offence": "Over-speeding",
      "offenceHi": "तेज़ गति",
      "location": "Sector 18, Noida",
      "amount": 2000,
      "status": "Pending",
      "eligibility": "eligible",
      "reason": null
    }
  ]
}
```

`eligibility` is `eligible`, `not` or `paid`, worked out in `server/offences.js` from the offence name and status (drunk driving, accident cases and challans already sent to court come back as `not`). The page shows a "Sample data" badge whenever `source` is `mock`.

When the provider fails or times out the endpoint returns `502` and the page switches to the "we'll check manually and call you" form, exactly as in the design.

### InstantPay (live challan data)

`server/providers/instantpay.js` calls InstantPay's [Vehicle Challan API](https://developers.instantpay.in/reference/identity-verification-vehicle-challan) (`POST https://api.instantpay.in/identity/vehicleChallan`). To switch it on, set these in `.env` on the server:

```
CHALLAN_PROVIDER=instantpay
INSTANTPAY_CLIENT_ID=...        # from your InstantPay dashboard
INSTANTPAY_CLIENT_SECRET=...
TRUST_PROXY=1                   # when hosted behind a load balancer
```

Notes:
- InstantPay needs the customer's IP (`X-Ipay-Endpoint-Ip`), consent (`"Y"`), a latitude/longitude and a unique `externalRef`. The server fills these in. Location defaults to Noida and can be changed with `INSTANTPAY_LATITUDE` / `INSTANTPAY_LONGITUDE`. The phone step tells the customer that continuing allows the lookup.
- Every successful lookup is debited from your InstantPay pool. The server reuses a plate's result for 10 minutes so repeat checks don't cost twice.
- InstantPay doesn't return where the challan was issued, so cards show date only.
- Offences are joined when one challan has several (e.g. "Parking, No PUC").
- If InstantPay errors or times out, the customer sees the "we'll check manually" form and the reason is logged on the server.
- Tested against the response shape from InstantPay's docs, not a live call. Try one known plate in their sandbox first.

### Connecting another provider

For a provider other than InstantPay:

1. Set `CHALLAN_PROVIDER=http` in `.env`.
2. Fill in `CHALLAN_API_URL` (use `{plate}` where the vehicle number goes), `CHALLAN_API_METHOD`, `CHALLAN_API_BODY` for POST, and the key settings.
3. Set `CHALLAN_API_LIST_PATH` to where the challan array sits in their JSON (e.g. `data.challans`).
4. If their field names aren't in the `PICK` table at the top of `server/providers/http.js`, add them there.

The adapter already understands the usual field names (`challan_no`, `challan_date` in `DD-MM-YYYY`, `offence_name`, `place`, `amount` with `₹` and commas, `challan_status`, and so on). It has only been tested against a stubbed response, so check the first real response against it.

## Other endpoints

- `GET /api/config`: tells the page whether OTP is in demo mode and which challan source is active.
- `POST /api/leads`: saves a booking, manual-check request or WhatsApp-alert sign-up to `data/leads.json` and returns the reference number (`GBN-26xxxxx`). This is the data the Admin Dashboard design works from.

## Before going live

- **OTP delivery.** `OTP_MODE=console` already generates and checks real codes; plug your SMS or WhatsApp gateway into `sendOtp()` in `server/auth.js`.
- **Storage.** Leads go to a JSON file, which is fine for a pilot. Move to a database before real traffic.
- **Contact details.** Phone, WhatsApp and email are placeholders from the design; set the `VITE_*` values.
- **City.** `VITE_CITY` switches the page between Noida, Ghaziabad, Delhi and Gurugram (court, address, plate hint, Lok Adalat date). Dates live in `src/content.js`.
- Set a long random `SESSION_SECRET`.

## Files

```
server/
  index.js            Express app and routes
  auth.js             OTP + signed session token
  offences.js         offence dictionary and Lok Adalat eligibility rules
  store.js            leads file
  providers/          mock.js, http.js, index.js (picks one, adds eligibility)
src/
  App.jsx             landing page sections
  CheckFlow.jsx       phone → OTP → challans → booking modal
  content.js          English/Hindi copy and city settings, ported from the design
  api.js              browser API client
  styles.css          design tokens and styles
```
