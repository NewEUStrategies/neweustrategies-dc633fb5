-- Newsletter double opt-in (DOI) must be driven server-side.
--
-- Problem: the public signup forms generated the confirmation token IN THE
-- BROWSER and INSERTed the pending subscriber directly (policy
-- "newsletter public subscribe" + GRANT INSERT TO anon, authenticated), while
-- nothing ever sent the confirmation e-mail. Two consequences:
--   1. DOI was broken - a genuine subscriber never received a confirm link and
--      stayed 'pending' forever.
--   2. DOI was bypassable - because the client picked the token, an attacker
--      could immediately call the public confirm endpoint with that same token
--      and flip an arbitrary address to 'subscribed' without ever proving
--      control of the mailbox (consent forgery / list poisoning). Direct
--      inserts were also unauthenticated write amplification (spam).
--
-- Fix: subscriptions now flow exclusively through the `subscribeToNewsletter`
-- server function (service_role), which mints the token server-side and sends
-- the confirm mail via Resend - mirroring the contact-form DOI flow. Removing
-- the public INSERT grant/policy guarantees the token is never known to the
-- client. Staff read/update/delete policies and service_role stay untouched, so
-- the admin subscriber list and the confirm endpoint keep working.

DROP POLICY IF EXISTS "newsletter public subscribe" ON public.newsletter_subscribers;
REVOKE INSERT ON public.newsletter_subscribers FROM anon, authenticated;
