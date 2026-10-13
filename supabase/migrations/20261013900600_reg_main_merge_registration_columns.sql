-- events-harness: include
-- ============================================================================
-- SCALENIE Z MAIN (PR #504), CZ. 7: GRANTY KOLUMNOWE `event_registrations`
-- DLA KOLUMN MAIN = REG-06/R45 (SELECT kolumnowy dla authenticated) + INV-14
-- + (runda 4) OPS-01/OPS-04.
--
-- RUNDA 4 (origin/main @ 6733f8ef, plik niewdrozony - poprawiony w miejscu):
-- main dodal do `event_registrations` cztery kolumny - 20261013110000
-- (`consent_partner_sharing_at`, `consent_partner_withdrawn_at`) i
-- 20261013110500 (`badge_token_hash`, `badge_issued_at`). W replayu powstaja
-- PO bloku REG 20261012181500 (bez grantu kolumnowego - prywatne), w produkcji
-- PRZED nim (blok REG daje je authenticated). Ten blok liczy granty z katalogu
-- po wszystkich plikach obu stron, wiec obie kolejnosci koncza tym samym:
-- `badge_token_hash` (skrot poswiadczenia identyfikatora - ta sama kategoria
-- co `qr_token_hash`) PRYWATNY; stemple zgody partnerskiej i chwila wydania
-- identyfikatora czytelne przez RLS (wlasne zgloszenie uczestnika, personel).
--
-- POCHODZENIE
--   * main: 20261012100000 (INV-14) - kolumny wplaty zaksiegowanej przez
--     organizatora: `paid_amount_cents`, `paid_amount_currency`,
--     `paid_amount_recorded_at`, `paid_amount_recorded_by` (konto organizatora).
--   * REG: 20261012170200 (REG-06, D10) i 20261012181500 (R45) - authenticated
--     czyta `event_registrations` WYLACZNIE kolumnowo; prywatne sa notatki,
--     skroty tokenow, profil przyslany przez niezweryfikowanego i slad
--     organizatora (`decided_by` - konto organizatora, `cancel_reason`).
--
-- DEFEKT (stan po samym scaleniu, ten sam w obu kolejnosciach - kolumny main
--   istnieja, zanim biegnie blok REG): blok REG daje authenticated KAZDA
--   kolumne spoza listy prywatnych, wiec `paid_amount_recorded_by` (konto
--   organizatora, ktory zaksiegowal przelew) bylo czytelne dla uczestnika przez
--   RLS - ta sama kategoria co `decided_by`, ktore R45 schowal.
--
-- ZMIANA: ten sam blok co 20261012181500 (lista z katalogu MINUS jawne
--   prywatne) z `paid_amount_recorded_by` na liscie prywatnych. Kwota, waluta
--   i chwila zaksiegowania zostaja czytelne (to wplata samego uczestnika -
--   "Moje zgloszenia" i tak pokazuja kwote).
--
-- CZEGO TO NIE ZAMYKA. Kolumna dodana pozniej nadal wymaga decyzji w swojej
--   migracji (komentarz tabeli).
-- KOLEJNOSC WDROZENIA: dowolna (kod klienta nie czyta `paid_amount_recorded_by`
--   z tabeli; panel organizatora - przez RPC SECURITY DEFINER). PO wszystkich
--   migracjach main i REG.
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT liczone z katalogu, COMMENT ON.
-- DOWOD: supabase/tests/reg_main_merge_test.sql (F3, H9).
-- ============================================================================

DO $grants$
DECLARE
  v_spec record;
  v_cols text;
  v_private text;
BEGIN
  FOR v_spec IN
    SELECT *
      FROM (VALUES
        ('public.event_registrations'::regclass,
         ARRAY['decision_note', 'submitted_profile', 'manage_token_hash', 'qr_token_hash',
               'decided_by', 'cancel_reason',
               -- ZMIANA (scalenie z main, INV-14): konto organizatora, ktory
               -- zaksiegowal wplate - jak `decided_by`.
               'paid_amount_recorded_by',
               -- ZMIANA (scalenie z main, runda 4, OPS-04 z 20261013110500):
               -- skrot kodu identyfikatora - poswiadczenie jak `qr_token_hash`.
               'badge_token_hash']),
        ('public.event_people'::regclass, ARRAY['notes'])
      ) AS t(rel, private_cols)
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE NOT a.attname = ANY (v_spec.private_cols)),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
            FILTER (WHERE a.attname = ANY (v_spec.private_cols))
      INTO v_cols, v_private
      FROM pg_attribute a
     WHERE a.attrelid = v_spec.rel
       AND a.attnum > 0
       AND NOT a.attisdropped;

    EXECUTE format('REVOKE SELECT ON %s FROM authenticated', v_spec.rel);
    EXECUTE format('GRANT SELECT (%s) ON %s TO authenticated', v_cols, v_spec.rel);
    IF v_private IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT (%s) ON %s FROM authenticated, anon', v_private, v_spec.rel);
    END IF;
  END LOOP;
END
$grants$;

COMMENT ON TABLE public.event_registrations IS
  'Zapis osoby na wydarzenie: osiem stanow cyklu zycia, tryb zapisu, bilet, grupa, odpowiedzi formularza, slad decyzji i HASZ tokenu QR. Jeden aktywny zapis na osobe i wydarzenie. REG-06 (D10): authenticated ma SELECT KOLUMNOWY - bez decision_note, submitted_profile, manage_token_hash, qr_token_hash (20261012170200), decided_by i cancel_reason (20261012181500) oraz paid_amount_recorded_by i badge_token_hash (20261013900600). Kolumna dodana pozniej jest PRYWATNA, dopoki jej migracja nie nada jawnie GRANT SELECT (kolumna) TO authenticated.';
