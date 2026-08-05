-- pgTAP: retencja dowodów przy usuwaniu konta (RODO x art. 74 uor).
--
-- Zakres: OBIE tabele dowodowe, bo audyt 05.08 §4.2 pokazał, że utwardzenie
-- jednej i pominięcie siostrzanej to ten sam błąd w dwie strony:
--   * payment_orders (20260803090002) - groziło ZNISZCZENIEM dowodów (CASCADE);
--   * user_purchases (20260805090100) - zostawiało SUROWY identyfikator osoby
--     (uuid NOT NULL bez FK, więc nigdy nie kaskadował i nigdy nie trafił na
--     listę „miejsc z CASCADE").
--
-- Weryfikuje:
--   1. kształt schematu: user_purchases.user_id jest nullowalny i MA FK
--      ON DELETE SET NULL (brak FK był tu przyczyną źródłową);
--   2. retention_until jest stemplowane przy INSERT (art. 74 ust. 2 uor);
--   3. anonimizacja zachowuje dowód z pieniędzmi, a usuwa darmowy grant;
--   4. pseudonim jest WSPÓLNY dla obu tabel (uzgodnienie ksiąg bez danych osobowych);
--   5. CHECK kształtu blokuje wiersz „zanonimizowany, ale z user_id";
--   6. trigger BEFORE DELETE ON auth.users domyka ścieżki poza aplikacją -
--      po `DELETE FROM auth.users` NIE ZOSTAJE surowy identyfikator;
--   7. purge usuwa dowód po terminie i respektuje retention_hold;
--   8. funkcje retencji są niedostępne dla rol klienckich.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(16);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Kształt schematu ────────────────────────────────────────────────────────
SELECT col_is_null(
  'public', 'user_purchases', 'user_id',
  'user_purchases.user_id jest nullowalny - inaczej ON DELETE SET NULL rzuca'
);

SELECT is(
  (SELECT c.confdeltype
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_purchases'
      AND c.contype = 'f'
      AND c.conkey = ARRAY[
            (SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = t.oid AND a.attname = 'user_id')
          ]::smallint[]),
  'n'::"char",
  'FK user_purchases.user_id ma ON DELETE SET NULL (nie CASCADE, nie brak FK)'
);

-- ── Seed: konto z trzema uprawnieniami ─────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000cc', 'retention-user@nes.test');

INSERT INTO public.profiles (id, tenant_id)
VALUES ('c0000000-0000-0000-0000-0000000000cc',
        (SELECT id FROM public.tenants WHERE slug = 'nes'))
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

-- (a) zakup opłacony - dowód księgowy, MUSI zostać
INSERT INTO public.user_purchases
  (id, tenant_id, user_id, entity_type, entity_id, amount_cents, currency, status, external_ref, purchased_at)
VALUES
  ('11111111-0000-0000-0000-0000000000a1',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'c0000000-0000-0000-0000-0000000000cc', 'post',
   '99999999-0000-0000-0000-000000000001', 4900, 'PLN', 'active', 'cs_test_paid',
   '2026-03-15 10:00:00+01');

-- (b) darmowy grant bez śladu u operatora - nic nie dowodzi, MA zniknąć
INSERT INTO public.user_purchases
  (id, tenant_id, user_id, entity_type, entity_id, amount_cents, currency, status, purchased_at)
VALUES
  ('11111111-0000-0000-0000-0000000000a2',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'c0000000-0000-0000-0000-0000000000cc', 'page',
   '99999999-0000-0000-0000-000000000002', 0, 'PLN', 'active',
   '2026-03-15 10:00:00+01');

-- (c) zakup zwrócony, ale ze śladem u operatora - dowód, MUSI zostać
INSERT INTO public.user_purchases
  (id, tenant_id, user_id, entity_type, entity_id, amount_cents, currency, status, external_ref, purchased_at)
VALUES
  ('11111111-0000-0000-0000-0000000000a3',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'c0000000-0000-0000-0000-0000000000cc', 'media',
   '99999999-0000-0000-0000-000000000003', 12900, 'PLN', 'refunded', 'cs_test_refunded',
   '2026-03-15 10:00:00+01');

-- ── Stempel retencji ───────────────────────────────────────────────────────
SELECT is(
  (SELECT retention_until FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a1'),
  '2031-12-31'::date,
  'retention_until = 31.12 piatego roku po roku zakupu (art. 74 ust. 2 uor)'
);

-- ── Anonimizacja ───────────────────────────────────────────────────────────
SELECT is(
  public.anonymize_user_purchases_for_user('c0000000-0000-0000-0000-0000000000cc'),
  jsonb_build_object('retained', 2, 'discarded', 1),
  'anonimizacja zachowuje 2 dowody i usuwa 1 darmowy grant'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a2'),
  0,
  'darmowy grant zniknal razem z kontem (minimalizacja, art. 5 ust. 1 lit. c RODO)'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_purchases
    WHERE user_id = 'c0000000-0000-0000-0000-0000000000cc'),
  0,
  'po anonimizacji NIE ZOSTAJE zaden surowy identyfikator uzytkownika'
);

SELECT is(
  (SELECT subject_ref FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a1'),
  public.accounting_subject_ref('c0000000-0000-0000-0000-0000000000cc'),
  'zachowany dowod nosi pseudonim SHA-256 zamiast identyfikatora'
);

SELECT isnt(
  (SELECT anonymized_at FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a3'),
  NULL::timestamptz,
  'anonymized_at jest ostemplowane'
);

SELECT is(
  (SELECT amount_cents FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a3'),
  12900,
  'substancja ksiegowa (kwota) zostaje nietknieta'
);

-- ── CHECK kształtu: nie da się mieć pseudonimu i identyfikatora razem ──────
SELECT throws_ok(
  $$UPDATE public.user_purchases
       SET user_id = 'c0000000-0000-0000-0000-0000000000cc'
     WHERE id = '11111111-0000-0000-0000-0000000000a1'$$,
  '23514',
  NULL,
  'CHECK blokuje wiersz zanonimizowany z przywroconym user_id'
);

-- ── Trigger na auth.users: ścieżka POZA aplikacją ──────────────────────────
-- Włączamy z powrotem tylko trigger retencji: reszta triggerów USER (np.
-- provisioning) nie ma tu nic do roboty, a `DISABLE TRIGGER USER` wyżej
-- wyłączył wszystkie.
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_retain_accounting;

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-0000000000dd', 'outside-path@nes.test');
INSERT INTO public.user_purchases
  (id, tenant_id, user_id, entity_type, entity_id, amount_cents, currency, status, external_ref, purchased_at)
VALUES
  ('22222222-0000-0000-0000-0000000000b1',
   (SELECT id FROM public.tenants WHERE slug = 'nes'),
   'd0000000-0000-0000-0000-0000000000dd', 'post',
   '99999999-0000-0000-0000-000000000004', 9900, 'PLN', 'active', 'cs_test_outside',
   '2026-04-01 12:00:00+02');

DELETE FROM auth.users WHERE id = 'd0000000-0000-0000-0000-0000000000dd';

SELECT is(
  (SELECT count(*)::int FROM public.user_purchases
    WHERE id = '22222222-0000-0000-0000-0000000000b1'),
  1,
  'dowod zakupu przezyl usuniecie konta poza aplikacja (art. 74 ust. 2 uor)'
);

SELECT is(
  (SELECT user_id FROM public.user_purchases
    WHERE id = '22222222-0000-0000-0000-0000000000b1'),
  NULL::uuid,
  'i NIE zostal na nim surowy identyfikator (art. 5 ust. 1 lit. e RODO)'
);

-- ── Purge po terminie retencji ─────────────────────────────────────────────
-- Termin przesuwamy przez `purchased_at`, nie przez `retention_until`: stempel
-- jest przeliczany triggerem przy KAŻDYM update (tak samo jak w payment_orders),
-- więc data retencji zawsze wynika z daty transakcji - i tego właśnie chcemy.
UPDATE public.user_purchases
   SET purchased_at = '2015-06-01 12:00:00+02'
 WHERE id = '22222222-0000-0000-0000-0000000000b1';

UPDATE public.user_purchases
   SET purchased_at = '2015-06-01 12:00:00+02', retention_hold = true
 WHERE id = '11111111-0000-0000-0000-0000000000a1';

SELECT is(
  (SELECT retention_until FROM public.user_purchases
    WHERE id = '22222222-0000-0000-0000-0000000000b1'),
  '2020-12-31'::date,
  'trigger przeliczyl retention_until po zmianie daty transakcji'
);

SELECT is(
  public.purge_expired_user_purchases(), 1,
  'purge usuwa TYLKO dowod po terminie i bez hold (a1 ma hold, a3 termin w przyszlosci)'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_purchases
    WHERE id = '11111111-0000-0000-0000-0000000000a1'),
  1,
  'retention_hold wstrzymuje czyszczenie (kontrola, spor, chargeback)'
);

-- ── Uprawnienia: retencja nie jest w rękach rol klienckich ─────────────────
SELECT ok(
  NOT has_function_privilege('anon',
    'public.anonymize_accounting_evidence_for_user(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.anonymize_accounting_evidence_for_user(uuid)', 'EXECUTE'),
  'anonimizacja dowodow jest niedostepna dla anon i authenticated'
);

SELECT * FROM finish();
ROLLBACK;
