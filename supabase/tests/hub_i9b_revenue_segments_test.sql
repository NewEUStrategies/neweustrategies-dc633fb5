-- pgTAP: segment przychodu z typu klienta (I9b, migracja 20261020160000;
-- decyzja właściciela 2026-10-20 - Z-01, Z-S2-02).
--
-- CO PRZYPINA:
--   * `revenue_segment_of_tier` = mapa `REVENUE_SEGMENT_BY_TIER` dla KAŻDEGO
--     klucza katalogu (14 `TIER_RANKS` + `decision_lab`), nieznanego klucza
--     i NULL: partnerzy, Krąg i NGO -> b2b_institution;
--   * `_revenue_segments_recompute()` przelicza ZAPISANY segment ruchów
--     partnera i NGO (churn - warstwa przed ruchem, reszta - po), nie rusza
--     wierszy już zgodnych z mapą;
--   * niezmiennik S2 zamkniętego miesiąca po przeliczeniu: start + Σ ruchów =
--     koniec PER SEGMENT, a suma segmentów = most bez filtra (dryf 0);
--   * idempotencja: druga runda zwraca 0 i nie zmienia ani jednego wiersza
--     (ctid zostaje);
--   * funkcje bez EXECUTE dla ról API, `search_path` z `pg_temp`.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_revenue_segments
BEGIN;
SELECT plan(10);

-- ── 1. Mapa ──────────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT k, public.revenue_segment_of_tier(k)
       FROM unnest(ARRAY['reader','supporter','member','student','educator','pro','ngo','vip','team',
                         'business','corporate','partner','partner_general','presidents_circle',
                         'decision_lab','i9b_unknown_tier']) WITH ORDINALITY AS t(k, n)
      ORDER BY n $$,
  $$ VALUES ('reader', 'other'), ('supporter', 'other'), ('member', 'b2c_individual'),
            ('student', 'b2c_reduced'), ('educator', 'b2c_reduced'), ('pro', 'b2c_individual'),
            ('ngo', 'b2b_institution'), ('vip', 'other'), ('team', 'b2b_institution'),
            ('business', 'b2b_institution'), ('corporate', 'b2b_institution'),
            ('partner', 'b2b_institution'), ('partner_general', 'b2b_institution'),
            ('presidents_circle', 'b2b_institution'), ('decision_lab', 'other'),
            ('i9b_unknown_tier', 'other') $$,
  'mapa: każdy klucz katalogu wg typu klienta (organizacja / osoba katalogowa / ulga / reszta)');
SELECT is(public.revenue_segment_of_tier(NULL), 'other', 'mapa: NULL -> other');

-- ── 2. Fikstura: księga sprzed decyzji (partner i NGO zapisane jako other) ──
INSERT INTO public.tenants (id, slug, name)
VALUES ('19b00000-0000-0000-0000-0000000000a0', 'hub-i9b-seg', 'Hub I9b segmenty');

CREATE FUNCTION pg_temp.mv(p_sub text, p_at timestamptz, p_kind text, p_reason text,
  p_before integer, p_after integer, p_tier_before text, p_tier_after text, p_seg text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.mrr_movements (tenant_id, subscription_id, user_id, environment, occurred_at, kind,
    reason, mrr_before_minor, mrr_after_minor, currency, tier_key_before, tier_key_after, interval_after,
    segment)
  VALUES ('19b00000-0000-0000-0000-0000000000a0', ('19b00000-0000-0000-0000-0000000005' || p_sub)::uuid,
          NULL, 'live', p_at, p_kind, p_reason, p_before, p_after, 'PLN', p_tier_before, p_tier_after,
          'year', p_seg)
$$;
-- Partner: przychód od lipca, rozszerzenie we wrześniu, odejście w październiku.
SELECT pg_temp.mv('a1', '2026-07-01', 'new', 'signup', 0, 200000, NULL, 'partner', 'other');
SELECT pg_temp.mv('a1', '2026-09-10', 'expansion', 'price', 200000, 250000, 'partner', 'partner', 'other');
SELECT pg_temp.mv('a1', '2026-10-05', 'churn', 'canceled', 250000, 0, 'partner', 'partner', 'other');
-- NGO: nowy we wrześniu.
SELECT pg_temp.mv('a2', '2026-09-15', 'new', 'signup', 0, 100000, NULL, 'ngo', 'other');
-- Zespół: już w instytucjach (bez zmiany); Członek - indywidualny (bez zmiany).
SELECT pg_temp.mv('a3', '2026-08-01', 'new', 'signup', 0, 26700, NULL, 'team', 'b2b_institution');
SELECT pg_temp.mv('a4', '2026-08-01', 'new', 'signup', 0, 3900, NULL, 'member', 'b2c_individual');
SELECT pg_temp.mv('a4', '2026-09-20', 'churn', 'canceled', 3900, 0, 'member', 'member', 'b2c_individual');

CREATE TEMP TABLE before_ctid ON COMMIT DROP AS
  SELECT id, ctid::text AS c FROM public.mrr_movements
   WHERE tenant_id = '19b00000-0000-0000-0000-0000000000a0';

-- ── 3. Przeliczenie ─────────────────────────────────────────────────────────
SELECT is(public._revenue_segments_recompute() >= 4, true,
  'przeliczenie: zmienia co najmniej 4 ruchy partnera i NGO (inne najemcy mogą mieć własne)');
SELECT results_eq(
  $$ SELECT subscription_id::text, kind, segment FROM public.mrr_movements
      WHERE tenant_id = '19b00000-0000-0000-0000-0000000000a0'
      ORDER BY subscription_id, occurred_at, id $$,
  $$ VALUES ('19b00000-0000-0000-0000-0000000005a1', 'new', 'b2b_institution'),
            ('19b00000-0000-0000-0000-0000000005a1', 'expansion', 'b2b_institution'),
            ('19b00000-0000-0000-0000-0000000005a1', 'churn', 'b2b_institution'),
            ('19b00000-0000-0000-0000-0000000005a2', 'new', 'b2b_institution'),
            ('19b00000-0000-0000-0000-0000000005a3', 'new', 'b2b_institution'),
            ('19b00000-0000-0000-0000-0000000005a4', 'new', 'b2c_individual'),
            ('19b00000-0000-0000-0000-0000000005a4', 'churn', 'b2c_individual') $$,
  'przeliczenie: partner i NGO w instytucjach, zgodne wiersze bez zmian');
SELECT is_empty(
  $$ SELECT 1 FROM public.mrr_movements m JOIN before_ctid b ON b.id = m.id
      WHERE m.subscription_id IN ('19b00000-0000-0000-0000-0000000005a3', '19b00000-0000-0000-0000-0000000005a4')
        AND m.ctid::text <> b.c $$,
  'przeliczenie: wiersze już zgodne z mapą nietknięte (ctid)');

-- ── 4. Niezmiennik zamkniętego miesiąca (wrzesień 2026) per segment ────────
SELECT is_empty(
  $$ WITH seg(s) AS (VALUES ('b2b_institution'), ('b2c_individual'), ('b2c_reduced'), ('other')),
     calc AS (
       SELECT s,
              COALESCE((SELECT sum(mrr_minor) FROM public._revenue_mrr_at('19b00000-0000-0000-0000-0000000000a0',
                        '2026-09-01', s, '2026-10-01')), 0) AS start_mrr,
              COALESCE((SELECT sum(amount_minor) FROM public._revenue_movements('19b00000-0000-0000-0000-0000000000a0',
                        '2026-09-01', '2026-10-01', s)), 0) AS moves,
              COALESCE((SELECT sum(mrr_minor) FROM public._revenue_mrr_at('19b00000-0000-0000-0000-0000000000a0',
                        '2026-10-01', s, '2026-10-01')), 0) AS end_mrr
         FROM seg)
     SELECT s FROM calc WHERE start_mrr + moves <> end_mrr $$,
  'niezmiennik S2: start + Σ ruchów = koniec w każdym segmencie (wrzesień 2026)');
SELECT results_eq(
  $$ SELECT
       (SELECT sum(mrr_minor) FROM public._revenue_mrr_at('19b00000-0000-0000-0000-0000000000a0', '2026-10-01', 'b2b_institution', '2026-10-01'))::bigint,
       (SELECT sum(mrr_minor) FROM public._revenue_mrr_at('19b00000-0000-0000-0000-0000000000a0', '2026-10-01', NULL, NULL))::bigint $$,
  $$ VALUES (376700::bigint, 376700::bigint) $$,
  'koniec września: całe MRR (partner 2500 zł + NGO 1000 zł + Zespół 267 zł) w instytucjach - suma segmentów = most bez filtra');

-- ── 5. Idempotencja ─────────────────────────────────────────────────────────
CREATE TEMP TABLE after_ctid ON COMMIT DROP AS
  SELECT id, ctid::text AS c FROM public.mrr_movements
   WHERE tenant_id = '19b00000-0000-0000-0000-0000000000a0';
SELECT is(public._revenue_segments_recompute(), 0, 'idempotencja: druga runda nie zmienia żadnego wiersza');
SELECT is_empty(
  $$ SELECT 1 FROM public.mrr_movements m JOIN after_ctid a ON a.id = m.id WHERE m.ctid::text <> a.c $$,
  'idempotencja: ctid bez zmian (brak nowej wersji krotki)');

-- ── 6. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._revenue_segments_recompute()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._revenue_segments_recompute()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._revenue_segments_recompute()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.revenue_segment_of_tier(text)', 'EXECUTE')
  AND (SELECT bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c
                                WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp%'))
         FROM pg_proc p
        WHERE p.oid IN ('public._revenue_segments_recompute()'::regprocedure,
                        'public.revenue_segment_of_tier(text)'::regprocedure)),
  'acl: przeliczenie i mapa bez EXECUTE dla ról API, search_path z pg_temp');

SELECT * FROM finish();
ROLLBACK;
