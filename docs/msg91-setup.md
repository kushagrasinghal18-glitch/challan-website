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

The easiest way: admin panel → **Settings → WhatsApp templates → Create the approval template** → **Send to Meta for review**. When it shows **Approved** (press **Check status**), pick it under "Template for approval requests".

The ready-made wording lists every challan with whether we can settle it, then asks for approval:

   Hi {{1}}, we have checked the challans on your vehicle {{2}}. It has {{3}} in total.
   All challans: {{4}}
   We can settle {{5}} for you. Amount you pay: {{6}}.
   Please reply I APPROVE to give your written approval for Niptao to settle these challans. Reference: {{7}}

with a **Quick reply** button `I APPROVE`. The blanks are filled from the lead: 1 name, 2 vehicle, 3 all challans (count and amount), 4 each challan with "we will settle", "not included" or "cannot settle now (reason)", 5 what we will settle, 6 amount to pay, 7 reference.

The "Send approval request" button on a lead then uses the template whenever the 24-hour window is closed. Inside the window it sends the full challan list with an **I APPROVE** button under it (for a very long list, the list comes first and the button in a short message right after). A tap on the button, or typing I APPROVE, marks the lead approved and sends the payment details.

## Conversation starter

To message a customer who hasn't written in the last 24 hours (for example a website lead):
1. Settings → WhatsApp templates → **Create the conversation starter** → **Send to Meta for review**.
2. When it shows Approved, pick it under "Template to start a conversation".
3. On a lead with challans fetched, press **Start conversation** under the WhatsApp chat. The customer gets: "Hi Ravi, your vehicle UP 16 AB 1234 has a total of ₹4,500 (3 challans) in pending traffic challans. To know the details and how Niptao can help you settle them, just tap Know more." with a **Know more** button.
4. Their tap opens the 24-hour window, so you (or the AI) can reply with the details and send the approval request.

## 6. A second number (the old number)

1. Connect the number in MSG91 (WhatsApp → Numbers shows it as **Connected**).
2. Render → **niptao-challan-site** → **Environment** → **Add Environment Variable**: key `MSG91_OLD_NUMBER`, value the old number with 91 in front, e.g. `919812345678`. Save. Keep `MSG91_WA_NUMBER` as it is.
3. In MSG91, set the same inbound webhook address on the old number as on the new one.
4. Settings → Automatic WhatsApp then shows both numbers.

How replies are routed:
- Each customer is answered from the number they last wrote to, automatically.
- Customers who only ever chatted with the old number (the linked-phone days) are answered from the old number.
- Brand-new customers who have not written yet get the main number (`MSG91_WA_NUMBER`).
- Templates made in Settings are sent to Meta for both numbers.

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
