-- pgTAP: lead z konta - `user_id`, segment `registered`, cykl życia (P16)
-- i backfill kont (migracja 20261020130100, hub S4).
--
-- Sprawdza:
--   * nowe konto -> lead z `user_id`, `source_type = 'registered'`,
--     `lifecycle_stage = 'registered'` (historia ze źródłem `system`);
--   * segment rośnie tylko w górę: `paid_subscriber` zostaje, a etap klienta
--     z płatności nie cofa się do `registered`;
--   * konto powiązane już z innym leadem: ślad w `domain_event_emit_errors`,
--     rejestracja NIE pada;
--   * backfill: dopasowanie po `(tenant_id, email_norm)`, konflikt (ten sam
--     adres u dwóch kont najemcy) zalogowany i niewymuszony, adres z innego
--     najemcy niedopasowany, powtórka bez zmian i bez drugiego wpisu śladu;
--   * backfill etapu cyklu życia ze źródłem `backfill` bez zdarzenia.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test crm_user_id_backfill
BEGIN;
SELECT plan(14);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4200000-0000-0000-0000-0000000000a0', 'hub-s4-uid-a', 'Hub S4 konta A'),
  ('d4200000-0000-0000-0000-0000000000b0', 'hub-s4-uid-b', 'Hub S4 konta B');

INSERT INTO auth.users (id, email) VALUES
  ('d4200000-0000-0000-0000-00000000a001', 'nowy@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a002', 'klient@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a003', 'platnik@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a004', 'zmiana@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a005', 'stary@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a006', 'dubel-1@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000a007', 'dubel-2@hub-s4-uid.test'),
  ('d4200000-0000-0000-0000-00000000b001', 'obcy@hub-s4-uid.test');

-- 1. Nowe konto - lead powstaje z wyzwalacza profilu.
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4200000-0000-0000-0000-00000000a001', 'nowy@hub-s4-uid.test', 'Nowy Czytelnik', 'd4200000-0000-0000-0000-0000000000a0');

-- 2. Istniejący lead płacącego (segment 90) i klienta z płatności.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, source_type) VALUES
  ('d4200000-0000-0000-0000-0000000001a2', 'd4200000-0000-0000-0000-0000000000a0', 'klient@hub-s4-uid.test', 'klient@hub-s4-uid.test', 'paid_subscriber'),
  ('d4200000-0000-0000-0000-0000000001a3', 'd4200000-0000-0000-0000-0000000000a0', 'platnik@hub-s4-uid.test', 'platnik@hub-s4-uid.test', 'newsletter');
SET LOCAL ROLE service_role;
SELECT public.crm_set_lifecycle_stage('d4200000-0000-0000-0000-0000000001a3', 'customer', 'billing', false);
RESET ROLE;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4200000-0000-0000-0000-00000000a002', 'klient@hub-s4-uid.test', 'Klient', 'd4200000-0000-0000-0000-0000000000a0'),
  ('d4200000-0000-0000-0000-00000000a003', 'platnik@hub-s4-uid.test', 'Płatnik', 'd4200000-0000-0000-0000-0000000000a0');

-- ── 1. Nowe konto ────────────────────────────────────────────────────────────
SELECT is(
  (SELECT user_id::text || '|' || source_type || '|' || lifecycle_stage FROM public.crm_leads
    WHERE tenant_id = 'd4200000-0000-0000-0000-0000000000a0' AND email_norm = 'nowy@hub-s4-uid.test'),
  'd4200000-0000-0000-0000-00000000a001|registered|registered',
  'P16: nowe konto = lead z user_id, segmentem registered i etapem registered');
SELECT is(
  (SELECT h.source FROM public.crm_lead_stage_history h
     JOIN public.crm_leads l ON l.id = h.lead_id
    WHERE l.email_norm = 'nowy@hub-s4-uid.test' AND h.dimension = 'lifecycle'),
  'system', 'P16: historia etapu rejestracji ze źródłem system');

-- ── 2. Ranga i pierwszeństwo ─────────────────────────────────────────────────
SELECT is(
  (SELECT source_type || '|' || user_id::text FROM public.crm_leads WHERE id = 'd4200000-0000-0000-0000-0000000001a2'),
  'paid_subscriber|d4200000-0000-0000-0000-00000000a002',
  'ranga: konto nie obniża segmentu paid_subscriber, a user_id zostaje podpięty');
SELECT is(
  (SELECT lifecycle_stage || '|' || source_type FROM public.crm_leads WHERE id = 'd4200000-0000-0000-0000-0000000001a3'),
  'customer|registered',
  'pierwszeństwo: rejestracja nie cofa klienta z płatności (segment rośnie do registered)');

-- ── 3. Konto powiązane z innym leadem - ślad, bez awarii rejestracji ───────
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm) VALUES
  ('d4200000-0000-0000-0000-0000000001a4', 'd4200000-0000-0000-0000-0000000000a0', 'zmiana@hub-s4-uid.test', 'zmiana@hub-s4-uid.test');
SELECT set_config('app.crm_trusted_writer', 'on', true);
UPDATE public.crm_leads SET user_id = 'd4200000-0000-0000-0000-00000000a004'
 WHERE id = 'd4200000-0000-0000-0000-0000000001a4';
SELECT set_config('app.crm_trusted_writer', '', true);
SELECT lives_ok(
  $$ INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
       ('d4200000-0000-0000-0000-00000000a004', 'zmiana-nowy@hub-s4-uid.test', 'Zmiana', 'd4200000-0000-0000-0000-0000000000a0') $$,
  'konflikt: konto z leadem pod innym adresem rejestruje się bez błędu');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors e
           WHERE e.source = 'crm_upsert_lead_from_profile'
             AND e.tenant_id = 'd4200000-0000-0000-0000-0000000000a0'
             AND e.event_type = 'crm_lead.user_id_conflict'),
  'konflikt: konto powiązane z innym leadem zostawia ślad');
SELECT is(
  (SELECT user_id FROM public.crm_leads
    WHERE tenant_id = 'd4200000-0000-0000-0000-0000000000a0' AND email_norm = 'zmiana-nowy@hub-s4-uid.test'),
  NULL::uuid, 'konflikt: drugi lead nie dostaje cudzego konta');

-- ── 4. Backfill (stan sprzed migracji odtworzony bez wyzwalacza profilu) ────
ALTER TABLE public.profiles DISABLE TRIGGER profile_sync_crm_lead;
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4200000-0000-0000-0000-00000000a005', 'stary@hub-s4-uid.test', 'Stary', 'd4200000-0000-0000-0000-0000000000a0'),
  ('d4200000-0000-0000-0000-00000000a006', 'Dubel@hub-s4-uid.test', 'Dubel 1', 'd4200000-0000-0000-0000-0000000000a0'),
  ('d4200000-0000-0000-0000-00000000a007', 'dubel@hub-s4-uid.test', 'Dubel 2', 'd4200000-0000-0000-0000-0000000000a0'),
  ('d4200000-0000-0000-0000-00000000b001', 'obcy@hub-s4-uid.test', 'Obcy', 'd4200000-0000-0000-0000-0000000000b0');
ALTER TABLE public.profiles ENABLE TRIGGER profile_sync_crm_lead;
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, tags) VALUES
  ('d4200000-0000-0000-0000-0000000001a5', 'd4200000-0000-0000-0000-0000000000a0', 'stary@hub-s4-uid.test', 'stary@hub-s4-uid.test', '{}'),
  ('d4200000-0000-0000-0000-0000000001a6', 'd4200000-0000-0000-0000-0000000000a0', 'dubel@hub-s4-uid.test', 'dubel@hub-s4-uid.test', '{}'),
  -- adres konta z najemcy B, lead w A - nie wolno ich połączyć
  ('d4200000-0000-0000-0000-0000000001a7', 'd4200000-0000-0000-0000-0000000000a0', 'obcy@hub-s4-uid.test', 'obcy@hub-s4-uid.test', '{}'),
  -- klient sprzed huba (tag z billingu) bez konta
  ('d4200000-0000-0000-0000-0000000001a8', 'd4200000-0000-0000-0000-0000000000a0', 'tag-klient@hub-s4-uid.test', 'tag-klient@hub-s4-uid.test', ARRAY['customer']);

-- Kopia bloku B + C migracji (bez wyłączania emitera - test liczy zdarzenia
-- cyklu życia, których źródło `backfill` nie emituje).
CREATE FUNCTION pg_temp.backfill() RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    WITH cand AS (
      SELECT l.id AS lead_id, l.tenant_id, p.id AS user_id,
             count(*) OVER (PARTITION BY l.id) AS profiles_per_lead
        FROM public.crm_leads l
        JOIN public.profiles p
          ON p.tenant_id = l.tenant_id AND p.email IS NOT NULL
         AND lower(btrim(p.email)) = l.email_norm
       WHERE l.user_id IS NULL
    )
    SELECT DISTINCT c.lead_id, c.tenant_id,
           CASE WHEN c.profiles_per_lead > 1 THEN 'wiele kont z adresem leada'
                ELSE 'konto powiązane z innym leadem' END AS reason
      FROM cand c
     WHERE c.profiles_per_lead > 1
        OR EXISTS (SELECT 1 FROM public.crm_leads o
                    WHERE o.tenant_id = c.tenant_id AND o.user_id = c.user_id AND o.id <> c.lead_id)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.domain_event_emit_errors e
                    WHERE e.source = 'crm_user_id_backfill' AND e.tenant_id = r.tenant_id
                      AND e.error LIKE '%' || r.lead_id::text || '%') THEN
      PERFORM public._log_emit_error(r.tenant_id, 'crm_user_id_backfill', 'crm_lead.user_id_conflict',
        '23505', r.reason || '; lead ' || r.lead_id::text);
    END IF;
  END LOOP;
  UPDATE public.crm_leads l SET user_id = c.user_id
    FROM (SELECT l2.id AS lead_id, min(p.id::text)::uuid AS user_id
            FROM public.crm_leads l2
            JOIN public.profiles p ON p.tenant_id = l2.tenant_id AND p.email IS NOT NULL
             AND lower(btrim(p.email)) = l2.email_norm
           WHERE l2.user_id IS NULL GROUP BY l2.id HAVING count(*) = 1) c
   WHERE l.id = c.lead_id AND l.user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_leads o
                      WHERE o.tenant_id = l.tenant_id AND o.user_id = c.user_id AND o.id <> l.id);
  UPDATE public.crm_leads l SET source_type = 'registered'
   WHERE l.user_id IS NOT NULL
     AND public._crm_source_type_rank(l.source_type) < public._crm_source_type_rank('registered');
  PERFORM set_config('app.change_source', 'backfill', true);
  UPDATE public.crm_leads l
     SET lifecycle_stage = CASE
           WHEN 'churned' = ANY (l.tags) THEN 'former_customer'
           WHEN 'customer' = ANY (l.tags) OR l.source_type = 'paid_subscriber' THEN 'customer'
           WHEN l.stage = 'proposal' THEN 'opportunity'
           WHEN l.stage = 'qualified' THEN 'sql'
           WHEN l.user_id IS NOT NULL OR l.source_type = 'registered' THEN 'registered'
           WHEN l.source_type NOT IN ('newsletter', 'manual') OR l.stage = 'contacted' THEN 'lead'
           ELSE l.lifecycle_stage END
   WHERE l.lifecycle_stage = 'subscriber' AND l.lifecycle_changed_at IS NULL
     AND ('churned' = ANY (l.tags) OR 'customer' = ANY (l.tags)
          OR l.source_type NOT IN ('newsletter', 'manual')
          OR l.stage IN ('proposal', 'qualified', 'contacted') OR l.user_id IS NOT NULL);
  PERFORM set_config('app.change_source', '', true);
END $$;

SELECT pg_temp.backfill();
SELECT pg_temp.backfill();

SELECT is(
  (SELECT user_id::text || '|' || source_type || '|' || lifecycle_stage FROM public.crm_leads
    WHERE id = 'd4200000-0000-0000-0000-0000000001a5'),
  'd4200000-0000-0000-0000-00000000a005|registered|registered',
  'backfill: dopasowanie po (tenant_id, email_norm) - konto, segment i etap');
SELECT is(
  (SELECT user_id FROM public.crm_leads WHERE id = 'd4200000-0000-0000-0000-0000000001a6'),
  NULL::uuid, 'backfill: dwa konta z jednym adresem - lead niepowiązany');
SELECT is(
  (SELECT count(*)::int FROM public.domain_event_emit_errors
    WHERE source = 'crm_user_id_backfill' AND error LIKE '%d4200000-0000-0000-0000-0000000001a6%'),
  1, 'backfill: konflikt zalogowany jeden raz (powtórka bez drugiego wpisu)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.domain_event_emit_errors
               WHERE source = 'crm_user_id_backfill' AND error LIKE '%@%'),
  'backfill: ślad konfliktu bez adresu e-mail (PII)');
SELECT is(
  (SELECT user_id FROM public.crm_leads WHERE id = 'd4200000-0000-0000-0000-0000000001a7'),
  NULL::uuid, 'backfill: konto z innego najemcy nie jest dopasowane');
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4200000-0000-0000-0000-0000000001a8'),
  'customer', 'backfill etapu: tag customer z billingu -> customer (źródło backfill przechodzi strażnika)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.domain_events
               WHERE event_type = 'crm_lead.lifecycle_changed.v1'
                 AND aggregate_id IN ('d4200000-0000-0000-0000-0000000001a5', 'd4200000-0000-0000-0000-0000000001a8')),
  'backfill etapu: brak zdarzenia (odtworzenie, nie zmiana)');

SELECT * FROM finish();
ROLLBACK;
