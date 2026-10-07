-- ============================================================================
-- KOLEJKI POCZTY (pgmq): WRAPPERY TYLKO DLA ROLI SERWISOWEJ.
--
-- KRYTYCZNE. `enqueue_email`, `read_email_batch`, `delete_email` i `move_to_dlq`
-- (20260728154925_email_infra.sql:120-211) sa SECURITY DEFINER bez zadnej bramki
-- w ciele - wykonuja sie jako wlasciciel, wiec maja pelny dostep do pgmq.
-- Migracja zdjela EXECUTE tylko z PUBLIC (komentarz w niej mowi wprost: „Restrict
-- queue RPC wrappers to service_role only"), ale domyslne uprawnienia platformy
-- nadaja EXECUTE na kazda nowa funkcje w `public` JAWNIE rolom anon
-- i authenticated (ta sama klasa co 20261002140000 i 20261007120500) - REVOKE
-- z PUBLIC ich nie zdejmuje. Skutek przez `POST /rest/v1/rpc/...` z kluczem
-- publikowalnym:
--   * `read_email_batch('auth_emails', ...)` - odczyt kolejki maili
--     autoryzacyjnych (webhook auth: `src/routes/platform/email/auth/webhook.ts`
--     wklada tam pelny HTML z linkiem akcji - reset hasla, magic link,
--     potwierdzenie adresu), czyli przejecie cudzego konta; przy okazji
--     `vt` chowa wiadomosc przed prawdziwym drenem;
--   * `enqueue_email(...)` - dowolny mail z adresu platformy (phishing z naszej
--     domeny i reputacja nadawcy);
--   * `delete_email` / `move_to_dlq` - kasowanie i przestawianie cudzej poczty.
--
-- KTO WOLA LEGALNIE (wszyscy klientem service-role):
--   * `src/routes/platform/email/auth/webhook.ts` (enqueue, SUPABASE_SERVICE_ROLE_KEY),
--   * `src/routes/platform/email/transactional/send.ts` i
--     `src/lib/email/transactional.server.ts` (enqueue, `serviceClient()`),
--   * `src/lib/email/queueDrain.server.ts` (read/delete/move, klient admina).
-- Odebranie EXECUTE rolom klienta niczego wiec nie psuje.
--
-- KOLEJNOSC WDROZENIA: dowolna - zastosuj OD RAZU (panel Lovable), niezaleznie
-- od kodu.
--
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/email_queue_grants_test.sql.
-- ============================================================================

REVOKE ALL ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
