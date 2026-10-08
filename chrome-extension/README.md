# Niptao Lead Filler (Chrome add-on)

Pick a lead from the Niptao admin panel and fill its vehicle number, mobile and name
into Parivahan e-Challan or the Lok Adalat token website. **You type the captcha and
OTP yourself**; the add-on never reads or fills those boxes.

## Install (once per computer)

1. Download `niptao-lead-filler.zip` and unzip it. You get a folder called `niptao-lead-filler`.
2. In Chrome, open `chrome://extensions` (type it in the address bar).
3. Turn on **Developer mode** (switch at the top right).
4. Click **Load unpacked** and choose the `niptao-lead-filler` folder.
5. Click the puzzle-piece icon next to the address bar and pin **Niptao Lead Filler**.

## Parivahan in one click

In the admin panel, open a lead and click **Open Parivahan e-Challan**. Parivahan opens with
"Vehicle Number" picked and the plate already filled. Type the captcha and continue.
When Parivahan shows the challans, the add-on saves them to that lead in the admin panel
(a small green-bordered box in the corner says "Saved N challans"). If Parivahan says there
are no challans, the lead shows "No challans found".

## WhatsApp Web

Open the Niptao admin panel once in Chrome and log in, so the add-on knows who you are.
Then open web.whatsapp.com and a chat with a customer. A small **Niptao** box appears at
the top right:

- **Save chat to Niptao** saves the messages on screen to that customer's lead (a new
  number becomes a new lead). The box then shows the lead, its status and whether the
  customer has approved.
- **Add as lead** just creates the lead from the number and name.

If the mobile number box is empty, type the customer's number in it first. When the
customer's last message says "I APPROVE", the box reminds you to press Save. Nothing is
sent unless you press a button, and group chats are skipped.

## Use it on any other page

1. Click the green **N** icon and log in with your admin username and password
   (staff see only their own leads).
2. Click a lead in the list. It shows at the top as "Selected lead".
3. Open the token website (or use the **Open Parivahan** / **Open Lok Adalat** links).
4. Click the **N** icon again and press **Fill this page**. Filled boxes get a green border
   and the cursor jumps to the captcha box.
5. Type the captcha, then the OTP when it arrives (it goes to the customer's phone), and submit.

If a box isn't filled, right-click inside it and pick **Niptao: fill vehicle number**
(or mobile / name).

## Update

Unzip the new version over the old folder, then press the round **reload** arrow on the
add-on's card in `chrome://extensions`. Reload any open admin panel, Parivahan and WhatsApp Web tabs.
