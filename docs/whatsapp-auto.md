# Automatic WhatsApp: setup guide

This links a WhatsApp number to the admin panel, the same way WhatsApp Web links to your phone. After that:

- A customer messages the number → the AI replies, explains Niptao, and asks for the vehicle number and name.
- The vehicle numbers and the name go on the lead (each vehicle is its own lead, as usual). A new number becomes a lead.
- You check the challans, tick the approved ones, and press **Send on WhatsApp** in the lead's approval box.
- The customer replies **I APPROVE** → it's marked on the lead, and the payment message and QR go out straight away.
- The customer sends the payment screenshot → it's saved on the lead and the list shows **💰 says paid**. You check your account and press **Mark payment received**.

It only ever replies. It never sends anyone a first message.

## 1. Pick the number

Use a **second number**, not your main business number. WhatsApp can block numbers that send automated messages, and this keeps your main number safe. A normal WhatsApp or WhatsApp Business app on any phone is fine. The number keeps working on that phone as usual.

## 2. Keep the site awake

Replies only go out while the site is running. Render's free plan puts the site to sleep after 15 minutes with no visitors, so pick one:

- **Simplest:** in Render, open the service → **Settings** → **Instance type** → **Starter** (about $7 a month). It never sleeps.
- **Free:** make a free account at uptimerobot.com → **Add New Monitor** → type **HTTP(s)**, URL `https://www.niptao.co.in/api/config`, every **5 minutes**. Render's free hours cover one site running all month.

Also make sure **DATABASE_URL** is set (it already is if your leads survive restarts). The WhatsApp login is kept there, so you don't have to scan again after every update.

## 3. Turn on the AI

1. Go to **aistudio.google.com** → **Get API key** → **Create API key**. Copy it. (You can reuse the Gemini key from your other CRM.)
2. In Render, open the service → **Environment** → **Add Environment Variable**. Key: `GEMINI_API_KEY`, value: the key. Save. The site restarts by itself.

Never paste the key in a chat or in the code.

## 4. Link the number

1. In the admin panel go to **Settings** → **Automatic WhatsApp** → **Link with QR code**.
2. On the phone with that number: WhatsApp → **⋮** (or **Settings** on iPhone) → **Linked devices** → **Link a device**, and scan the QR code.
3. The box turns green: **Linked**.

If you're on the same phone, type the number and press **Get a code instead**, then in **Link a device** tap **Link with phone number instead** and type the 8-character code.

## 5. Settings you can change

- **AI replies**: on or off for everyone. On a lead, the WhatsApp chat has **Pause AI** for one customer.
- **Send payment details by itself**: on or off. Off means you send them from the lead as before.
- **Extra notes for the AI**: offers, office hours, anything it should tell customers.
- **Try the AI**: type as a customer and see exactly what the AI would answer, using the notes as typed. Nothing is sent on WhatsApp and no lead is created. Works even when the number isn't linked or the switch is off.

The AI goes quiet in a chat for 2 hours after anyone from the team writes there (on the phone or from the panel). When a customer asks for a person or something it can't answer, it pauses itself on that chat and the list shows **🙋 needs you**. Press **Turn AI back on** in the lead when you're done.

## Good to know

- Sending caps: 60 messages an hour and 400 a day for the whole number. Change them with `WA_MAX_PER_HOUR` / `WA_MAX_PER_DAY` in Render if you need to.
- **To switch it all off:** untick **Automatic WhatsApp is ON** at the top of the section. No AI replies and no automatic messages; the panel works exactly as before (WhatsApp buttons on each lead and the add-on). The number stays linked, so ticking it again needs no new scan.
- To remove the number completely: **Unlink this number**, or set `WA_BAILEYS=off` in Render.
- After an update, if Settings says "Another copy of the site took over", press **Link with QR code** once. It reconnects without a new scan.
- The AI never sends payment details, never says a payment was received, and never quotes amounts that aren't on the lead.
