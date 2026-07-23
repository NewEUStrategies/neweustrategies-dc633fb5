
-- 1) content_access: revoke anon SELECT on password hint columns (hash already revoked)
REVOKE SELECT (password_hint_pl, password_hint_en, password_hash) ON public.content_access FROM anon;

-- 2) push_subscriptions: block SSRF-shaped endpoints at insert time (defense in depth;
--    sendWebPush additionally runs the full DNS-aware egress guard).
DELETE FROM public.push_subscriptions
WHERE endpoint !~* '^https://'
   OR endpoint ~* '://(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|0\.0\.0\.0|\[?::1\]?|\[?fe80|\[?fc|\[?fd|metadata\.google\.internal)'
   OR endpoint ~* '\.(internal|local|localhost)(:|/|$)';

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_public_https;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_public_https
  CHECK (
    endpoint ~* '^https://'
    AND endpoint !~* '://(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|0\.0\.0\.0|\[?::1\]?|\[?fe80|\[?fc|\[?fd|metadata\.google\.internal)'
    AND endpoint !~* '\.(internal|local|localhost)(:|/|$)'
  );

-- 3) Pin search_path on pricing_catalog_v3_rows (Supabase linter 0011).
ALTER FUNCTION public.pricing_catalog_v3_rows() SET search_path = public, pg_temp;
