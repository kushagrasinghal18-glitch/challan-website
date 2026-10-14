# Official WhatsApp through MSG91

Once this is set up, the website sends and receives WhatsApp on your business number through the official API (MSG91 → Meta). Every chat shows in the admin panel's **WhatsApp** tab, AI replies and the automatic payment message work again, and the number is not at risk of being blocked the way the linked phone was.

## What you need first

- Meta business verification approved for Boxsmith Packaging Private Limited.
- An MSG91 account with the WhatsApp number connected (MSG91 → WhatsApp → Numbers shows it as **Connected**).

## 1. Copy two things from MSG91

1. **Auth key:** MSG91 → your name (top right) → **Authkey** → copy the key.
2. **Number:** the WhatsApp number as connected in MSG91, with 91 in front, for example `919990661629`.

## 2. Add them in Render

Render → **niptao-challan-site** → **Environment** → **Add Environment Variable**, one at a time:

| Key | Value |
| --- | --- |
| `MSG91_AUTH_KEY` | the auth key from step 1 |
| `MSG91_WA_NUMBER` | the number, e.g. `919990661629` |
| `MSG91_WEBHOOK_SECRET` | any long made-up phrase with no spaces, at least 12 characters, e.g. `niptao-wa-7f3k9q2m` |

Press **Save changes**. Render restarts the site by itself (about two minutes).

Type these only in Render. Never send them in chat or email.

## 3. Tell MSG91 where to send incoming messages

1. MSG91 → **WhatsApp** → **Numbers** (or **Webhook**) → your number → **Inbound webhook** / **Configure webhook**.
2. Paste this address, with your secret phrase from step 2 at the end:

   `https://www.niptao.co.in/api/whatsapp/msg91/YOUR-SECRET-PHRASE`

3. Tick incoming messages, and also outgoing/delivery reports if MSG91 offers them (that shows ✓✓ delivered and read in the panel, and messages your team types inside MSG91).
4. Save.

## 4. Check it works

1. From any other phone, send "Hi" to the business number.
2. Open the admin panel → **WhatsApp** tab. The chat appears within 15 seconds.
3. Type a reply there and press **Send**. It arrives on the phone.
4. Settings → Automatic WhatsApp now says **Official WhatsApp API through MSG91**.

## 5. Approval template (for customers who wrote more than 24 hours ago)

WhatsApp only allows free text within 24 hours of the customer's last message. After that only pre-approved templates can go out.

1. MSG91 → WhatsApp → **Templates** → **Create template**.
2. Name `approval_request`, category **Utility**, language **English**, body:

   Hi {{1}}, the challan settlement details for your vehicle {{2}} are ready. We will settle {{3}} challan(s) and you pay {{4}}. Please reply I APPROVE to confirm, or reply to this message to see the full list. Reference: {{5}}

3. When it shows **Approved**, add one more variable in Render: `MSG91_APPROVAL_TEMPLATE` = `approval_request`.

The "Send approval request" button on a lead then uses the template whenever the 24-hour window is closed.

## How AI replies work on the official API

- Meta allows an AI assistant that answers questions about your own business. Niptao's AI only talks about challan settlement, asks for vehicle numbers and names, and shares status, which fits.
- Meta does not allow general-purpose chatbots ("ask me anything" AI). Don't add notes that make the AI answer unrelated questions.
- The AI only replies to customers who wrote to you, and only within 12 hours of their message (inside WhatsApp's 24-hour window).
- When a customer asks for a person, the AI hands the chat over and pauses itself on that chat; it shows as **🙋 Needs you** in the WhatsApp tab.
- Switch AI replies on or off in Settings → Automatic WhatsApp, or pause it on one chat with **Pause AI**.

## Good to know

- With MSG91 set up, the linked-phone method is no longer used. You can unlink the phone in WhatsApp → Linked devices.
- The payment QR is sent as an image from a private link on the website that only MSG91 is given.
- To switch MSG91 off, delete `MSG91_AUTH_KEY` in Render. Chats already saved stay on the leads.
