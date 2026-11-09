STRIPE ONLINE PAYMENTS - TEST MODE (added Nov 8)
================================================
What you got: a new "Stripe Online" payment option in the POS. The
customer scans a QR / opens a link and pays by card on Stripe's secure
page. The POS flips to PAID automatically (verified with Stripe every
few seconds - no webhook setup needed).

ONE-TIME SETUP (2 minutes)
--------------------------
1. Create a free Stripe account: dashboard.stripe.com/register
2. While in TEST MODE, go to Developers -> API keys
3. Copy the Secret key (sk_test_...) and Publishable key (pk_test_...)
4. In your POS: Settings -> Payments -> Stripe -> paste both -> Save

TEST A PAYMENT
--------------
POS -> add items to cart -> select "Stripe Online" -> the Charge button
says "Send Stripe Payment Link" -> generate -> QR appears.
Scan it with a phone (or open the link) -> Stripe checkout page ->
card: 4242 4242 4242 4242, any future expiry (12/34), any CVC (123),
any email -> Pay -> the POS screen flips to "Paid" and the sale is
logged like any other (Transactions, Dashboard revenue, receipt).

GO LIVE LATER
-------------
Activate your Stripe account (bank details), replace sk_test_/pk_test_
with sk_live_/pk_live_ in Settings -> Save. Real cards then work.
Webhooks are optional; add one later if you want (endpoint:
/api/stripe/verify is built in - or just keep auto-verify).
