TAPFLOW UPDATE — EMAIL RECEIPTS + REAL RECEIPT + FIXES (Nov 8, 2026)
====================================================================

WHAT'S NEW
----------
1. REAL EMAIL RECEIPTS (works for staff and customers)
   - Staff: any receipt (POS sale, transaction list, Test Receipt) now has an
     "Email" button in the receipt window's TOP BAR. Type the customer's email
     and it sends a real, nicely formatted receipt email.
   - Customers: on the QR pay page, after paying, they see the receipt and a
     "Email this receipt to me" box. One tap and it lands in their inbox.
   - Emails are sent by YOUR server through SMTP (nodemailer).

2. RECEIPT LOOKS REAL
   - The receipt is now styled like actual thermal receipt paper: torn
     zigzag edges, mono font, dotted item lines, payment line, auth code,
     tilted PAID stamp and a barcode. Header/footer come from
     Settings -> Store & Receipt (Receipt Header / Receipt Footer).
   - The Print/Email buttons and the "Auto-print" info box were REMOVED from
     the receipt paper — they now live in the receipt window's top bar, so
     the receipt itself is clean (also on the customer's phone).
   - Printing prints ONLY the receipt paper — no app, buttons or page chrome.

3. STRIPE "Cannot POST /api/stripe/checkout" — FIXED
   That error happened because the OLD server.js (without the Stripe routes)
   was still running while the new page was loaded. This zip contains a
   MATCHED server.js + public/index.html. Upload the WHOLE zip, then:
       npm install     <- required, adds nodemailer
       npm start
   Products do NOT need to be pushed to Stripe separately — checkout sends
   the cart items (name + price) to Stripe live. Any product you create in
   Products is immediately chargeable via the Stripe payment link/QR.

4. DASHBOARD GRAPHS NOW SHOW SALES CORRECTLY (daily sales)
   - Fixed a timezone bug: sales were bucketed by UTC date, so evening sales
     landed on the NEXT day's bar and "Today Revenue" missed them.
     All buckets now use your local timezone (America/Chicago by default —
     change with APP_TIMEZONE in .env).
   - "Daily Revenue — Last 7 Days" chart now also has a per-day breakdown
     under it: date · revenue · number of sales.
   - After every sale the dashboard refreshes instantly (if you're a manager),
     and while you're LOOKING at the dashboard it refreshes every 20 seconds
     — so QR/Stripe sales that complete on the customer's phone show up too.

SET UP EMAIL (5 minutes, one time)
----------------------------------
Gmail (easiest):
  1. Turn on 2-Step Verification on your Google account.
  2. Create an App Password: myaccount.google.com/apppasswords
  3. In the .env file of this folder set:
       SMTP_HOST=smtp.gmail.com
       SMTP_PORT=587
       SMTP_USER=you@gmail.com
       SMTP_PASS=your-16-char-app-password
  4. npm install && npm start — send a test receipt to yourself.

Or any other mail provider — host/port/user/pass from their docs
(SendGrid, Mailgun, Zoho, your own domain...). Until SMTP is filled in,
trying to email shows a clear "email not set up yet" message; everything
else works.

YOUR ACCOUNT (unchanged)
------------------------
davin@tapflow.local / Davin2026!Mod  (Webmaster/admin)

TO DEPLOY
---------
1. Upload the whole zip to your host (Render/Fly/your server).
2. npm install   (REQUIRED — adds nodemailer)
3. npm start
4. Fill SMTP_* in .env, restart, send yourself a test receipt.
