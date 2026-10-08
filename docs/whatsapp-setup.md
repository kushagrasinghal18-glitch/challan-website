# Connect WhatsApp (99906 61629) to the Niptao admin panel

Once this is done:
- A customer who messages your WhatsApp number shows up as a lead in the admin panel by themselves. A vehicle number in their message is picked up too.
- Staff can read and reply to the chat inside each lead.
- **Send on WhatsApp** sends the approval message straight from the admin panel, and you can see when it is delivered and read.
- When the customer replies **I APPROVE**, the lead is marked approved automatically.

It stays switched off until the keys from steps 5 to 7 are saved in Render. Never paste these keys into a chat. They go only into Render.

---

## Before you start: an important point about the number

With Meta's direct setup, a number connected to the API **can no longer be used in the WhatsApp or WhatsApp Business app on a phone**. All chats then happen in the admin panel.
- If 99906 61629 is already set up in the WhatsApp Business app, **back up the chats** first. Then in the app go to **Settings → Account → Delete my account**. This frees the number. Old chats are not moved over.
- If you'd rather keep using the phone app too, tell me. Some Meta partners offer a "coexistence" setup that keeps both, but it goes through a partner and not this direct route.

## 1. Create a Meta Business account
1. Go to **business.facebook.com** and log in with your Facebook account.
2. Click **Create an account**. Enter Business name: **Niptao**, your name and your business email (help@niptao.co.in).
3. Fill in the business details (address, website https://www.niptao.co.in).

## 2. Create the app
1. Go to **developers.facebook.com** → **My Apps** → **Create app**.
2. App name: **Niptao Admin**. Contact email: your email.
3. When it asks for a use case, pick **Connect with customers through WhatsApp**. If you don't see it, pick **Other**, then **Business**.
4. Select the **Niptao** business account from step 1, then click **Create app**.

## 3. Add your phone number
1. In the app, open **WhatsApp → API Setup** in the left menu.
2. Under "Send and receive messages", click **Add phone number**.
3. Display name: **Niptao**. Category: **Professional services**. Add a short description.
4. Enter **+91 99906 61629**, choose SMS or voice call, and type the code you receive.

## 4. Add a payment method
1. Open **WhatsApp Manager** (business.facebook.com → **WhatsApp accounts** → **WhatsApp Manager**).
2. Go to **Payment settings** and add a card.

Replies within 24 hours of the customer's last message are free. Only messages you start after that are charged by Meta.

## 5. Get the permanent key (token)
1. Go to **business.facebook.com/settings** → **Users → System users** → **Add**.
2. Name: **niptao-server**. Role: **Admin**. Click **Create system user**.
3. Click **Assign assets**:
   - Pick **Apps → Niptao Admin**, turn on **Full control** and save.
   - Do the same for **WhatsApp accounts → Niptao**.
4. Click **Generate new token**, pick the app **Niptao Admin**, and set expiry to **Never**.
5. Tick these two permissions:
   - **whatsapp_business_messaging**
   - **whatsapp_business_management**
6. Click **Generate** and copy the long token. Keep this window open for step 8.

## 6. Get the Phone number ID
In **developers.facebook.com** → your app → **WhatsApp → API Setup**, select your number in "From". Copy the **Phone number ID** shown under it. It's a long number, not your mobile number.

## 7. Get the App secret
In your app go to **App settings → Basic**. Next to **App secret**, click **Show** (it asks for your Facebook password) and copy it.

## 8. Put the keys into Render
1. Go to **dashboard.render.com** → **niptao-challan-site** → **Environment**.
2. Click **+ Add Environment Variable** for each of these:

| Key | Value |
|---|---|
| `WHATSAPP_TOKEN` | the token from step 5 |
| `WHATSAPP_PHONE_ID` | the Phone number ID from step 6 |
| `WHATSAPP_APP_SECRET` | the App secret from step 7 |
| `WHATSAPP_VERIFY_TOKEN` | make up any phrase, e.g. `niptao-hook-7391` (you'll type it again in step 9) |

3. Click **Save, rebuild and deploy** and wait until it says **Live**.

## 9. Connect the webhook (how messages reach the admin panel)
1. In **developers.facebook.com** → your app → **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit** and enter:
   - Callback URL: `https://www.niptao.co.in/api/whatsapp/webhook`
   - Verify token: the same phrase you used for `WHATSAPP_VERIFY_TOKEN`
3. Click **Verify and save**.
4. Under **Webhook fields**, click **Manage** and turn on **messages**.

## 10. Make the app Live
1. In the app go to **App settings → Basic** and add these, then save:
   - Privacy policy URL: `https://www.niptao.co.in/privacy.html`
   - Category: **Business and pages**
2. At the top of the app dashboard, switch **App mode** from Development to **Live**.

## 11. Approval template (for customers who haven't messaged in the last 24 hours)
WhatsApp only lets you start a conversation with a pre-approved template.
1. In **WhatsApp Manager**, open **Message templates** → **Create template**.
2. Category: **Utility**. Name: `approval_request`. Language: **English**.
3. Body (copy exactly):

   ```
   Hi {{1}}, the challan settlement details for your vehicle {{2}} are ready. We will settle {{3}} challan(s) and you pay {{4}}. Please reply I APPROVE to confirm, or reply to this message to see the full list. Reference: {{5}}
   ```
4. Add sample values when asked (e.g. Rahul, UP16AB1234, 2, ₹1,250, GBN-2612345), then click **Submit**.
5. Once Meta approves it (usually within a day), add one more variable in Render: `WHATSAPP_APPROVAL_TEMPLATE` = `approval_request`.

## 12. Test it
1. From another phone, send "Hi, my car is UP16AB1234" to 99906 61629.
2. Within a few seconds, a new lead with a green **WhatsApp** tag appears in the admin panel, and the buzzer plays.
3. Open the lead, type a reply in **WhatsApp chat** and press **Send**. It should arrive on the phone.

## Good to know
- **Business verification:** Meta may ask you to verify the business (Business settings → Security centre). Until then, you can start chats with about 250 new customers a day, which is plenty to begin with.
- **24-hour rule:** for 24 hours after a customer's last message, you can send anything for free. After that, only the approval template can be sent.
- **If the API isn't set up yet:** the admin panel keeps the old "Open in WhatsApp" button, which uses whatever WhatsApp is open on the staff member's computer.
