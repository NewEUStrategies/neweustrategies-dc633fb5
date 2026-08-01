-- ============================================================================
-- P1 REGRESJA GRANTÓW (finding 2026-07-18: content_access hints/hash).
-- 20260722215942, odbierając password_hash, RE-GRANTował kolumny
-- password_hint_pl/en dla anon ORAZ authenticated; 20260723052553 odebrał je
-- ponownie wyłącznie dla anon. Efekt: każdy zalogowany użytkownik czytał
-- podpowiedzi haseł wprost z tabeli, z pominięciem RPC get_password_hint
-- (który ogranicza je do trybu 'password'). Odbieramy kolumny obu rolom
-- (dla anon idempotentnie). Klienci (Paywall, panel dostępu w adminie)
-- korzystają wyłącznie z SECURITY DEFINER get_password_hint(); service_role
-- i funkcje definer zachowują pełny dostęp.
-- ============================================================================
REVOKE SELECT (password_hash, password_hint_pl, password_hint_en)
  ON public.content_access FROM anon, authenticated;
