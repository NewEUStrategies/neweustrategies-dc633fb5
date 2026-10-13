-- pgTAP: deduplikacja uprawnien sprzed indeksu `external_ref`
-- (migracja `user_subscriptions_external_ref_unique`, audyt PAY-10, przeglad 1.6).
--
-- `user_subscriptions_external_ref_unique_test.sql` sprawdza indeks na bazie,
-- w ktorej duplikatow juz nie ma. Produkcja ma je z dawnego wyscigu
-- `created` + `updated`, a o tym, ktory wiersz zostaje kanoniczny i co dzieje
-- sie z pozostalymi, decyduje WYLACZNIE krok deduplikacji migracji. Ten test
-- odtwarza stan sprzed indeksu (zrzuca go w transakcji testu), zasiewa
-- duplikaty i uruchamia TEN SAM blok co migracja.
--
-- UWAGA: blok ponizej jest kopia ciala migracji (bez komentarzy). Zmiana
-- deduplikacji w migracji wymaga tej samej zmiany tutaj - inaczej test
-- sprawdza nieaktualna regule.
BEGIN;
SELECT plan(10);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e7f10000-0000-0000-0000-0000000000aa', 'ext-ref-dedupe', 'Ext Ref Dedupe',
   'ext-ref-dedupe.example');
INSERT INTO auth.users (id, email) VALUES
  ('e7f10000-0000-0000-0000-0000000000b1', 'ext-ref-dedupe@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e7f10000-0000-0000-0000-0000000000b1', 'ext-ref-dedupe@example.org', 'D',
   'e7f10000-0000-0000-0000-0000000000aa');
INSERT INTO public.access_plans
  (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key, active)
VALUES
  ('e7f10000-0000-0000-0000-0000000000c1', 'e7f10000-0000-0000-0000-0000000000aa',
   'Pro', 'Pro', 4900, 'PLN', 'month', 'pro', true);

-- Stan sprzed migracji: bez indeksu unikalnego (DROP wycofa ROLLBACK).
DROP INDEX public.user_subscriptions_external_ref_key;

-- `now()` jest stale w transakcji, wiec kolejnosc wierszy ustalamy jawnym
-- `created_at`.
INSERT INTO public.user_subscriptions
  (id, user_id, tenant_id, plan_id, status, external_ref, current_period_end, canceled_at,
   created_at)
VALUES
  -- Trzy wiersze jednej subskrypcji: najstarszy jest kanoniczny.
  ('e7f10000-0000-0000-0000-0000000000d1', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', 'sub_dedupe_a', now() + interval '20 days', NULL, '2026-01-01 10:00:00+00'),
  ('e7f10000-0000-0000-0000-0000000000d2', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', 'sub_dedupe_a', now() + interval '20 days', NULL, '2026-01-01 10:00:05+00'),
  ('e7f10000-0000-0000-0000-0000000000d3', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'refunded', 'sub_dedupe_a', now() + interval '20 days', '2026-02-01 08:00:00+00',
   '2026-01-01 10:00:09+00'),
  -- Ten sam `created_at`: rozstrzyga `id` (mniejszy zostaje).
  ('e7f10000-0000-0000-0000-0000000000e2', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', 'sub_dedupe_b', now() + interval '20 days', NULL, '2026-03-01 10:00:00+00'),
  ('e7f10000-0000-0000-0000-0000000000e1', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', 'sub_dedupe_b', now() + interval '20 days', NULL, '2026-03-01 10:00:00+00'),
  -- Klucz bez duplikatu i wiersze bez klucza operatora - nietykalne.
  ('e7f10000-0000-0000-0000-0000000000f1', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', 'sub_dedupe_single', now() + interval '20 days', NULL, '2026-01-01 10:00:00+00'),
  ('e7f10000-0000-0000-0000-0000000000f2', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', NULL, NULL, NULL, '2026-01-01 10:00:00+00'),
  ('e7f10000-0000-0000-0000-0000000000f3', 'e7f10000-0000-0000-0000-0000000000b1',
   'e7f10000-0000-0000-0000-0000000000aa', 'e7f10000-0000-0000-0000-0000000000c1',
   'active', NULL, NULL, NULL, '2026-01-01 10:00:00+00');

-- Cialo migracji `user_subscriptions_external_ref_unique` (kopia).
DO $$
BEGIN
  LOCK TABLE public.user_subscriptions IN SHARE ROW EXCLUSIVE MODE;

  WITH ranked AS (
    SELECT us.id,
           row_number() OVER (
             PARTITION BY us.external_ref
             ORDER BY us.created_at, us.id
           ) AS rn
      FROM public.user_subscriptions us
     WHERE us.external_ref IS NOT NULL
  )
  UPDATE public.user_subscriptions AS us
     SET external_ref = us.external_ref || '#dup:' || us.id::text,
         status = CASE
                    WHEN us.status = 'refunded'::public.purchase_status THEN us.status
                    ELSE 'canceled'::public.purchase_status
                  END,
         canceled_at = COALESCE(us.canceled_at, now())
    FROM ranked
   WHERE ranked.id = us.id
     AND ranked.rn > 1;

  CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_external_ref_key
    ON public.user_subscriptions (external_ref);
END
$$;

SELECT is(
  (SELECT external_ref || '|' || status::text || '|' || coalesce(canceled_at::text, 'null')
     FROM public.user_subscriptions WHERE id = 'e7f10000-0000-0000-0000-0000000000d1'),
  'sub_dedupe_a|active|null',
  'najstarszy wiersz zostaje kanoniczny - klucz, stan i brak daty anulowania bez zmian');

SELECT is(
  (SELECT external_ref || '|' || status::text
     FROM public.user_subscriptions WHERE id = 'e7f10000-0000-0000-0000-0000000000d2'),
  'sub_dedupe_a#dup:e7f10000-0000-0000-0000-0000000000d2|canceled',
  'mlodszy duplikat: klucz z sufiksem #dup:<id> (slad pochodzenia) i status canceled');

SELECT isnt(
  (SELECT canceled_at FROM public.user_subscriptions
    WHERE id = 'e7f10000-0000-0000-0000-0000000000d2'),
  NULL,
  'zneutralizowany duplikat dostaje date anulowania');

SELECT is(
  (SELECT external_ref || '|' || status::text || '|' || canceled_at::text
     FROM public.user_subscriptions WHERE id = 'e7f10000-0000-0000-0000-0000000000d3'),
  'sub_dedupe_a#dup:e7f10000-0000-0000-0000-0000000000d3|refunded|'
    || ('2026-02-01 08:00:00+00'::timestamptz)::text,
  'zwrot zostaje zwrotem, a jego data korekty nie jest nadpisywana (COALESCE)');

SELECT is(
  (SELECT string_agg(id::text || '=' || external_ref, ',' ORDER BY id)
     FROM public.user_subscriptions
    WHERE id IN ('e7f10000-0000-0000-0000-0000000000e1',
                 'e7f10000-0000-0000-0000-0000000000e2')),
  'e7f10000-0000-0000-0000-0000000000e1=sub_dedupe_b,'
    || 'e7f10000-0000-0000-0000-0000000000e2=sub_dedupe_b#dup:e7f10000-0000-0000-0000-0000000000e2',
  'remis created_at rozstrzyga id - deterministycznie, niezaleznie od kolejnosci wstawienia');

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions
    WHERE id IN ('e7f10000-0000-0000-0000-0000000000f1',
                 'e7f10000-0000-0000-0000-0000000000f2',
                 'e7f10000-0000-0000-0000-0000000000f3')
      AND status = 'active' AND canceled_at IS NULL
      AND (external_ref = 'sub_dedupe_single' OR external_ref IS NULL)),
  3,
  'klucz bez duplikatu i wiersze bez klucza operatora (NULL) sa nietkniete');

SELECT has_index('public', 'user_subscriptions', 'user_subscriptions_external_ref_key',
  'po deduplikacji indeks unikalny powstaje');

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions WHERE external_ref = 'sub_dedupe_a'),
  1,
  'klucz operatora ma dokladnie jeden wiersz - kod czyta go przez maybeSingle()');

-- Drugi przebieg (migracja jest IDEMPOTENTNA): nic sie nie zmienia.
DO $$
BEGIN
  LOCK TABLE public.user_subscriptions IN SHARE ROW EXCLUSIVE MODE;

  WITH ranked AS (
    SELECT us.id,
           row_number() OVER (
             PARTITION BY us.external_ref
             ORDER BY us.created_at, us.id
           ) AS rn
      FROM public.user_subscriptions us
     WHERE us.external_ref IS NOT NULL
  )
  UPDATE public.user_subscriptions AS us
     SET external_ref = us.external_ref || '#dup:' || us.id::text,
         status = CASE
                    WHEN us.status = 'refunded'::public.purchase_status THEN us.status
                    ELSE 'canceled'::public.purchase_status
                  END,
         canceled_at = COALESCE(us.canceled_at, now())
    FROM ranked
   WHERE ranked.id = us.id
     AND ranked.rn > 1;

  CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_external_ref_key
    ON public.user_subscriptions (external_ref);
END
$$;

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions
    WHERE external_ref LIKE 'sub_dedupe_%#dup:%#dup:%'),
  0,
  'drugi przebieg nie dokleja kolejnego sufiksu - deduplikacja jest idempotentna');

SELECT throws_ok(
  $$INSERT INTO public.user_subscriptions
      (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
    VALUES ('e7f10000-0000-0000-0000-0000000000b1', 'e7f10000-0000-0000-0000-0000000000aa',
      'e7f10000-0000-0000-0000-0000000000c1', 'active', 'sub_dedupe_a', now() + interval '30 days')$$,
  '23505', NULL,
  'po migracji kolejny wiersz z kluczem kanonicznym odbija sie od indeksu (23505)');

SELECT * FROM finish();
ROLLBACK;
