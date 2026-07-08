-- Enforce case-insensitive email uniqueness per tenant for newsletter
-- subscribers. The app already lowercases on every write path (subscribe + CSV
-- import), so UNIQUE (tenant_id, email) was effectively case-insensitive in
-- practice - but a direct/manual insert of "Foo@x" alongside "foo@x" would slip
-- through and double-send. This adds the DB-level guarantee.
--
-- The exact-match UNIQUE (tenant_id, email) is KEPT: subscribeToNewsletter
-- upserts with onConflict "tenant_id,email", which needs that exact index. The
-- functional index below is an additional, stricter guard.

-- 1) Collapse any pre-existing case-variant duplicates (no-op when the app's
--    lowercasing already held). Keep the most meaningful row per
--    (tenant_id, lower(email)): a subscribed one over pending over anything
--    else, then the earliest created; delete the rest so the unique index below
--    can be built.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, lower(email)
      ORDER BY
        (status = 'subscribed') DESC,
        (status = 'pending') DESC,
        created_at ASC
    ) AS rn
  FROM public.newsletter_subscribers
)
DELETE FROM public.newsletter_subscribers ns
USING ranked r
WHERE ns.id = r.id
  AND r.rn > 1;

-- 2) Normalize surviving addresses so the stored value matches how the app
--    writes and looks them up.
UPDATE public.newsletter_subscribers
   SET email = lower(email)
 WHERE email <> lower(email);

-- 3) The DB-level case-insensitive guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_tenant_email_ci_uniq
  ON public.newsletter_subscribers (tenant_id, lower(email));
