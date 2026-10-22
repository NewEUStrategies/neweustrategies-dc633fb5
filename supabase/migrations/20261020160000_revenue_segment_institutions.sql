-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, 1/5): SEGMENT PRZYCHODU Z TYPU KLIENTA -
-- PARTNERZY I NGO DO INSTYTUCJI, PRZELICZENIE ZAPISANEJ HISTORII.
-- Decyzja właściciela 2026-10-20 (zgoda delegowana): Z-01 i Z-S2-02.
--
-- DEFEKT
--   1. `revenue_segment_of_tier` (20261020090500) wkładał partnerów
--      instytucjonalnych (`partner`, `partner_general`, `presidents_circle`)
--      i `ngo` do `other` - obok czytelnika, darowizny i jednorazowego
--      Decision Labu. Segmenty służą do ocen churnu i ARPA według TYPU
--      klienta, a benchmarki B2B i B2C różnią się kilkukrotnie: organizacja
--      w umowie instytucjonalnej (także w stawce ulgowej NGO) odchodzi i płaci
--      jak B2B, nie jak „pozostali".
--   2. Segment jest ZAPISANY w historii (`mrr_movements.segment`) w chwili
--      ruchu - sama zmiana funkcji zostawiłaby stare wiersze w starym
--      segmencie, a most z filtrem segmentu mieszałby dwie mapy.
--
-- ZMIANA
--   A. Reguła segmentu (lustro: `REVENUE_SEGMENT_BY_TIER`, segments.ts):
--        konto organizacyjne (flaga `corporate_seats` albo umowa
--        instytucjonalna / firmowa) -> b2b_institution:
--          team, business, corporate, partner, partner_general,
--          presidents_circle, ngo;
--        płatna cykliczna subskrypcja osoby po cenie katalogowej ->
--          b2c_individual: member, pro;
--        płatna cykliczna subskrypcja osoby w stawce ulgowej ->
--          b2c_reduced: student, educator;
--        bezpłatne, grzecznościowe, jednorazowe i bez planu -> other:
--          reader, supporter (status po darowiźnie, nie próg członkostwa),
--          vip (cena „od", umowa osoby bez planu w katalogu), decision_lab,
--          klucze nieznane i NULL.
--      Sprawdzone na katalogu v6.2 (20261018160100) i najemcy domyślnym:
--      siedem kluczy b2b ma `corporate_seats` albo plan firmowy (`business_*`),
--      member/pro mają plany 39/119 zł, student/kadra 19/29 zł.
--   B. Przeliczenie historii: `mrr_movements.segment` = segment `tier_key`
--      tej samej strony ruchu, którą wybiera pisarz (110100/110200):
--      `churn` - warstwa PRZED ruchem, pozostałe rodzaje - warstwa PO ruchu.
--      UPDATE tylko wierszy, w których segment się zmienia (IS DISTINCT
--      FROM). Most liczy segment subskrypcji z ostatniego ruchu przed końcem
--      okna (`_revenue_mrr_at`, 110300), więc po jednolitym przeliczeniu
--      niezmiennik S2 „start + Σ ruchów = koniec" per segment trzyma się
--      z konstrukcji (dowód: pgTAP niżej).
--   C. Z-S2-02 (AKCEPTACJA): subskrypcja, która zmieniła segment w oknie,
--      liczy się w całości w segmencie KOŃCOWYM mostu - standardowa
--      atrybucja do segmentu na koniec okresu (jak ARR „na koniec kwartału"):
--      ten sam zbiór subskrypcji na początku i końcu okna domyka most, a
--      podział ruchów per segment dałby dwa częściowe mosty bez sumy.
--
-- CO ZOSTAJE BEZ PRZELICZENIA (z uzasadnieniem):
--   * `mrr_daily_snapshots` - migawka nie niesie `tier_key` (jest obrazem
--     tabeli `subscriptions` z danej doby), więc segmentu nie da się z niej
--     odtworzyć. Mapa zmienia wyłącznie progi BEZ ceny w katalogu operatora
--     (`billing_catalog_entry`: student, educator, member, pro, team,
--     business, decision_lab) - żadna migawka nie mogła zawierać ich kwot.
--     strażnik D (niżej) przerywa migrację, gdyby katalog miał taki próg.
--   * `revenue_manual_inputs.segment` - segment wybiera admin w formularzu,
--     nie wynika z warstwy.
--   * lejek (`admin_revenue_funnel`, 120400) - liczy segment w zapytaniu,
--     więc po tej migracji od razu używa nowej mapy.
--   * indeksy wyrażeniowe i widoki na funkcji - nie istnieją (przegląd
--     migracji 2026102009-2026102015), REINDEX zbędny.
--
-- KOLEJNOŚĆ WDROŻENIA: po 2026102011* (S2), ale bezpieczna także bez nich:
-- przeliczenie i strażnik dotykają tabel I0 (090000) i katalogu S2 tylko,
-- gdy istnieją (`to_regclass` / `to_regprocedure`) - pusta księga to no-op.
-- `SET lock_timeout` przy UPDATE księgi (55P03 = ponów plik).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (redefinicja - CIALO-Z niżej;
-- `_revenue_segments_recompute` - nowa nazwa), UPDATE z warunkiem IS DISTINCT
-- FROM - powtórka nie zmienia ani jednego wiersza (funkcja zwraca 0).
-- DOWÓD: supabase/tests/hub_i9b_revenue_segments_test.sql (każdy klucz mapy,
-- przeliczenie partner/ngo, most per segment zamkniętego miesiąca, druga
-- runda bez zmian), supabase/tests/hub_shared_helpers_test.sql (§6),
-- src/lib/revenue/__tests__/segmentsParity.test.ts (TS ⇄ SQL).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Mapa segmentów.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020090500
CREATE OR REPLACE FUNCTION public.revenue_segment_of_tier(p_tier_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_tier_key IN ('student','educator') THEN 'b2c_reduced'
              WHEN p_tier_key IN ('member','pro') THEN 'b2c_individual'
              WHEN p_tier_key IN ('team','business','corporate','partner','partner_general','presidents_circle','ngo') THEN 'b2b_institution'
              ELSE 'other' END
$$;

REVOKE ALL ON FUNCTION public.revenue_segment_of_tier(text) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.revenue_segment_of_tier(text) IS
  'Hub: segment przychodu z typu klienta (lustro REVENUE_SEGMENT_BY_TIER): konto organizacyjne -> b2b_institution, osoba po cenie katalogowej -> b2c_individual, osoba w stawce ulgowej -> b2c_reduced, reszta -> other. Wewnętrzny: bez EXECUTE dla ról API.';

-- ----------------------------------------------------------------------------
-- B) Przeliczenie zapisanego segmentu ruchów MRR. Funkcja (a nie anonimowy
--    blok), żeby pgTAP mógł dowieść przeliczenia i drugiej rundy bez zmian
--    na tej samej logice, którą wykonuje migracja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_segments_recompute()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.mrr_movements') IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.mrr_movements m
     SET segment = public.revenue_segment_of_tier(
           CASE WHEN m.kind = 'churn' THEN m.tier_key_before ELSE m.tier_key_after END)
   WHERE m.segment IS DISTINCT FROM public.revenue_segment_of_tier(
           CASE WHEN m.kind = 'churn' THEN m.tier_key_before ELSE m.tier_key_after END);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public._revenue_segments_recompute() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._revenue_segments_recompute() IS
  'Hub I9b: przelicza zapisany segment ruchów MRR z tier_key (churn - warstwa przed, reszta - po) według bieżącej revenue_segment_of_tier; zwraca liczbę zmienionych wierszy (0 przy powtórce). Wewnętrzny: bez EXECUTE dla ról API.';

SET lock_timeout = '5s';
SELECT public._revenue_segments_recompute();
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- D) Strażnik migawek dziennych: żaden próg ze zmienionym segmentem nie ma
--    ceny w katalogu operatora (inaczej migawki niosłyby jego kwoty w starym
--    segmencie, a odtworzyć ich nie można - patrz nagłówek).
-- ----------------------------------------------------------------------------
DO $guard$
DECLARE
  v_hit text;
BEGIN
  IF to_regprocedure('public.billing_catalog_entry(text)') IS NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(DISTINCT c.tier_key, ', ') INTO v_hit
    FROM public.billing_catalog_entry(NULL) c
   WHERE c.tier_key IN ('partner', 'partner_general', 'presidents_circle', 'ngo');
  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'revenue_segment_institutions: katalog operatora ma plan progu (%) - migawki dzienne wymagają przebudowy przed zmianą mapy', v_hit
      USING ERRCODE = '55000';
  END IF;
END
$guard$;
