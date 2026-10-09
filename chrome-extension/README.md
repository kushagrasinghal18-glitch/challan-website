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
are no challans, the lead shows "No challans found". The owner's name shown by Parivahan is saved too, so the admin panel can flag a lead whose name doesn't match.

## Delhi court token in one click

In the admin panel, open a lead and click **Delhi court token**. The Delhi Traffic Police
page opens with the vehicle number already filled. Type the captcha (and the OTP when it
comes) yourself and continue.

## WhatsApp Web

Open the Niptao admin panel once in Chrome and log in, so the add-on knows who you are.
Then open web.whatsapp.com and a chat with a customer. A small **Niptao** box appears at
the top right:

- **Save chat to Niptao** saves the messages on screen to that customer's lead (a new
  number becomes a new lead). The box then shows the lead, its status and whether the
  customer has approved.
- **Add as lead** just creates the lead from the number and name.

If the mobile number box is empty, type the customer's number once (or click the name at
the top of the chat so WhatsApp shows the number); it's remembered for that chat. When the
customer writes "I APPROVE", the box saves the chat by itself so the approval shows in the
admin panel. Everything else waits for a button press, the add-on never sends WhatsApp
messages, and group chats are skipped.

After an approval, the box puts the payment message (details, UPI ID and refund note) in
WhatsApp's message box and copies the QR code. Check it and press Enter, then Ctrl+V and
Enter to send the QR. Once the message is sent, the lead is marked "payment details sent". Set the UPI ID and QR in the admin panel under Settings. You can
also press "Put payment details in the chat" under a lead at any time.

If something isn't read correctly, press
"Not working? Copy page details" and paste the result to support (it contains no names,
numbers or message text).

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
