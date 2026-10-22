-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 4/8): RETENCJA DANYCH - UCZESTNICY
-- WYDARZEŃ (Z-I9c-07, kategoria `event_attendees`). Decyzja właściciela
-- 2026-10-20: anonimizacja 24 mies. od ostatniego udziału/rejestracji
-- (zakres 12-36); wyjątki: osoba powiązana z ISTNIEJĄCYM kontem, płatne
-- zamówienie (nie wcześniej niż koniec przechowywania dowodów księgowych),
-- mechanizmy zgód sponsorów/stoisk nietknięte. Podstawa: RODO art. 6 ust. 1
-- lit. b i f, art. 5 ust. 1 lit. e.
--
-- DEFEKT
--   Kartoteka uczestników (`public.event_people`) i kopie danych w
--   zgłoszeniach (`public.event_registrations`: odpowiedzi formularza,
--   profil przysłany przy zapisie, powody decyzji i anulowania) żyją bez
--   końca - także osób, które od lat nie przyszły na żadne wydarzenie.
--
-- ZMIANA (DECYZJE WYKONAWCZE orkiestratora I9d, dziennik §21.22)
--   A. `event_people.anonymized_at` - znacznik anonimizacji (idempotencja,
--      filtr kandydatów, etykieta w interfejsie - moduł wydarzeń poza
--      zakresem I9d, zgłoszenie w dzienniku).
--   B. Kandydat (`_data_retention_event_attendee_candidates`): osoba bez
--      konta (`user_id` NULL - klucz obcy SET NULL, więc NOT NULL = konto
--      istnieje; po usunięciu konta osoba wchodzi w regułę 24 mies.), nie
--      prelegent (karta prelegenta jest publiczna i należy do archiwum
--      wydarzeń - poza kategorią), ostatnia aktywność starsza niż okres:
--      założenie osoby, zgłoszenia (utworzenie, obecność, anulowanie,
--      płatność, termin wydarzenia - wydarzenie w przyszłości chroni zapis),
--      wejścia, skany stoisk, członkostwo w grupie, zamówienia pakietów,
--      zgłoszenia CFP. `updated_at` się nie liczy (zmienia go każda edycja
--      i sama anonimizacja). Płatne: zgłoszenie opłacone/zwrócone, pakiet
--      opłacony/zwrócony albo wystawiona faktura nabywcy -> nie wcześniej niż
--      `accounting_retention_until` ostatniej transakcji.
--   C. Anonimizacja (`_data_retention_event_attendees`): imię i nazwisko ->
--      `[redacted]` (NOT NULL, CHECK 1-80; konwencja repozytorium
--      `DATA_RETENTION_REDACTED`), e-mail, telefon, stanowisko, firma
--      wpisana, profil społecznościowy, notatki, zdjęcie (adres), bio,
--      „szukam/oferuję" -> NULL, linki społecznościowe -> `{}`, widoczność
--      kontaktu -> false. W zgłoszeniach osoby: odpowiedzi -> `{}`, profil
--      przysłany, powód dla uczestnika i powód anulowania -> NULL, notatka
--      decyzji -> `[redacted]` (CHECK: odrzucenie przez organizatora wymaga
--      powodu). ZOSTAJĄ: obecność, typ biletu, status, płatność, daty,
--      źródło, firma z kartoteki (`company_id` - statystyki firm
--      i sponsorów), branża i specjalizacja (pola zgrubne), KAŻDA kolumna
--      zgód (`consent_*`, zgoda partnerska zgłoszenia), księga zgód
--      i skany stoisk - liczniki „leady ze zgodą" w raportach sponsorów bez
--      zmian. Telefon -> NULL wyłącza przypomnienia SMS osoby (wyzwalacz
--      modułu - zamierzone). Plik zdjęcia w bibliotece mediów zostaje
--      (usunięcie pliku tylko przez API magazynu - zgłoszenie w dzienniku).
--
-- KOLEJNOŚĆ WDROŻENIA: po module wydarzeń (kolumny osób i zgłoszeń)
-- i 20261020161100 (`_data_retention_bounded`). Kategoria wchodzi do
-- katalogu w 20261020162200 (rdzeń).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- bezstanowe REVOKE. Osoba zanonimizowana nie jest kandydatem (powtórka 0).
-- DOWÓD: supabase/tests/hub_i9d_event_attendees_test.sql.
-- ============================================================================

SET lock_timeout = '5s';
ALTER TABLE public.event_people ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
RESET lock_timeout;

COMMENT ON COLUMN public.event_people.anonymized_at IS
  'Retencja danych (I9d, kategoria event_attendees): chwila anonimizacji uczestnika - imię i nazwisko [redacted], dane kontaktowe i opisowe NULL; obecność, bilety, statusy, daty, źródło i zgody zostają.';

-- ----------------------------------------------------------------------------
-- B) Kandydaci.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_event_attendee_candidates(
  p_tenant uuid, p_cutoff timestamptz, p_limit integer)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
    FROM public.event_people p
   WHERE p.tenant_id = p_tenant AND p.anonymized_at IS NULL AND p.user_id IS NULL
     AND p.created_at < p_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.speaker_profiles sp
                      WHERE sp.tenant_id = p.tenant_id AND sp.person_id = p.id)
     -- Ostatni udział albo rejestracja (GREATEST pomija NULL).
     AND NOT EXISTS (SELECT 1 FROM public.event_registrations r
                       JOIN public.events e ON e.id = r.event_id
                      WHERE r.tenant_id = p.tenant_id AND r.person_id = p.id
                        AND GREATEST(r.created_at, r.attended_at, r.cancelled_at, r.paid_at, e.starts_at, e.ends_at)
                            >= p_cutoff)
     AND NOT EXISTS (SELECT 1 FROM public.event_checkins c
                      WHERE c.tenant_id = p.tenant_id AND c.person_id = p.id
                        AND GREATEST(c.scanned_at, c.occurred_at) >= p_cutoff)
     AND NOT EXISTS (SELECT 1 FROM public.event_lead_scans ls
                      WHERE ls.tenant_id = p.tenant_id AND ls.person_id = p.id AND ls.last_scanned_at >= p_cutoff)
     AND NOT EXISTS (SELECT 1 FROM public.event_group_members g
                      WHERE g.tenant_id = p.tenant_id AND g.person_id = p.id AND g.created_at >= p_cutoff)
     AND NOT EXISTS (SELECT 1 FROM public.event_package_orders o
                      WHERE o.tenant_id = p.tenant_id AND o.buyer_person_id = p.id
                        AND GREATEST(o.created_at, o.paid_at) >= p_cutoff)
     AND NOT EXISTS (SELECT 1 FROM public.event_cfp_submission_speakers cs
                      WHERE cs.tenant_id = p.tenant_id AND cs.person_id = p.id AND cs.created_at >= p_cutoff)
     -- Płatne: dowód księgowy ostatniej transakcji jeszcze w terminie.
     AND NOT EXISTS (SELECT 1 FROM public.event_registrations r
                      WHERE r.tenant_id = p.tenant_id AND r.person_id = p.id
                        AND r.payment_status IN ('paid', 'partially_refunded', 'refunded')
                        AND public.accounting_retention_until(COALESCE(r.paid_at, r.created_at)) >= current_date)
     AND NOT EXISTS (SELECT 1 FROM public.event_package_orders o
                      WHERE o.tenant_id = p.tenant_id AND o.buyer_person_id = p.id AND o.status IN ('paid', 'refunded')
                        AND public.accounting_retention_until(COALESCE(o.paid_at, o.created_at)) >= current_date)
     AND NOT EXISTS (SELECT 1 FROM public.event_invoices i
                      WHERE i.tenant_id = p.tenant_id AND i.buyer_person_id = p.id AND i.issued_at IS NOT NULL
                        AND public.accounting_retention_until(i.issued_at) >= current_date)
   ORDER BY p.created_at, p.id
   LIMIT GREATEST(p_limit, 0)
$$;

REVOKE ALL ON FUNCTION public._data_retention_event_attendee_candidates(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Funkcja kategorii.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._data_retention_event_attendees(
  p_tenant uuid, p_cutoff timestamptz, p_execute boolean, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_REDACTED (src/lib/privacy/dataRetention.ts).
  c_redacted constant text := '[redacted]';
  v_ids uuid[];
  v_people integer := 0;
  v_registrations integer := 0;
BEGIN
  IF NOT p_execute THEN
    SELECT public._data_retention_bounded(count(*), p_limit) INTO v_people
      FROM public._data_retention_event_attendee_candidates(p_tenant, p_cutoff, p_limit);
    RETURN jsonb_build_object('affected', v_people, 'backlog', v_people >= p_limit, 'cutoff', p_cutoff);
  END IF;

  v_ids := ARRAY(SELECT c FROM public._data_retention_event_attendee_candidates(p_tenant, p_cutoff, p_limit) c);
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('affected', 0, 'backlog', false, 'cutoff', p_cutoff);
  END IF;

  UPDATE public.event_people p
     SET first_name = c_redacted, last_name = c_redacted, email = NULL, phone = NULL, job_title = NULL,
         company_text = NULL, social_profile_url = NULL, notes = NULL, photo_url = NULL, bio_pl = NULL,
         bio_en = NULL, seeking_pl = NULL, seeking_en = NULL, offering_pl = NULL, offering_en = NULL,
         social_links = '{}'::jsonb, email_visible = false, phone_visible = false, anonymized_at = now()
   WHERE p.tenant_id = p_tenant AND p.id = ANY (v_ids) AND p.anonymized_at IS NULL;
  GET DIAGNOSTICS v_people = ROW_COUNT;

  -- Kopie danych osoby w zgłoszeniach. Kolumny statusu, płatności, biletu
  -- i kodów nie są ruszane - wyzwalacze modułu (bilety, portfel, zwroty)
  -- śpią, budzi się tylko dotyk `updated_at`.
  UPDATE public.event_registrations r
     SET answers = '{}'::jsonb, submitted_profile = NULL, participant_reason = NULL,
         decision_note = CASE WHEN r.decision_note IS NULL THEN NULL ELSE c_redacted END,
         cancel_reason = NULL
   WHERE r.tenant_id = p_tenant AND r.person_id = ANY (v_ids)
     AND (r.answers <> '{}'::jsonb OR r.submitted_profile IS NOT NULL OR r.participant_reason IS NOT NULL
          OR r.cancel_reason IS NOT NULL OR (r.decision_note IS NOT NULL AND r.decision_note <> c_redacted));
  GET DIAGNOSTICS v_registrations = ROW_COUNT;

  RETURN jsonb_build_object('affected', v_people, 'registrations', v_registrations,
                            'backlog', v_people >= p_limit, 'cutoff', p_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public._data_retention_event_attendees(uuid, timestamptz, boolean, integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_event_attendees(uuid, timestamptz, boolean, integer) IS
  'Retencja danych (I9d, kategoria event_attendees): uczestnik bez konta, nie prelegent, bez aktywności od progu i bez płatności w terminie dowodów księgowych -> anonimizacja kartoteki i kopii w zgłoszeniach; obecność, bilety, statusy, daty, źródło i zgody zostają. Podgląd liczy. Wewnętrzny.';
