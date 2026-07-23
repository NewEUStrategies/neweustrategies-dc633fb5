-- Nadaj wszystkim aktualnym użytkownikom bezterminową warstwę VIP
-- (nie duplikuje aktywnego nadania VIP, jeśli już istnieje).
INSERT INTO public.membership_grants (tenant_id, user_id, tier_key, source, note, starts_at, expires_at)
SELECT p.tenant_id, p.id, 'vip', 'manual',
       'Bulk grant: wszyscy aktualni użytkownicy platformy', now(), NULL
FROM public.profiles p
WHERE p.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.membership_grants g
    WHERE g.user_id = p.id
      AND g.tier_key = 'vip'
      AND g.revoked_at IS NULL
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );