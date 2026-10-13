-- events-harness: include
-- ============================================================================
-- WYDARZENIA: ZGODA NA PRZEKAZANIE DANYCH PARTNEROM - PER ZGLOSZENIE (OPS-01).
--
-- PROBLEM. Zgoda partnerska siedziala WYLACZNIE na `event_people`, a osoba jest
-- jedna na najemce (`event_people_tenant_email_uniq`). Stempel byl wiec
-- globalny i „lepki":
--   * zgoda przy wydarzeniu A, brak zgody przy B -> skan stoiska sponsora B
--     oddawal e-mail i telefon, bo czytal stempel z A;
--   * `event_register()` przy kazdym zapisie ustawial `consent_withdrawn_at =
--     NULL`, wiec wycofanie znikalo przy zapisie na kolejne wydarzenie - bez
--     zadnego dzialania osoby.
-- To lamie wymog zgody KONKRETNEJ i rownie latwej do wycofania jak do
-- udzielenia (art. 4 pkt 11 i art. 7 ust. 3 RODO).
--
-- ZMIANA (fundament; konsumenci przepinaja sie w kolejnych migracjach):
--   * `event_registrations.consent_partner_sharing_at` - stempel zgody udzielonej
--     W TYM zgloszeniu, czyli na TO wydarzenie;
--   * `event_registrations.consent_partner_withdrawn_at` - stempel wycofania tej
--     zgody. Osobna kolumna, nie skasowanie stempla nadania: dowod rozliczalnosci
--     (art. 7 ust. 1 RODO) potrzebuje obu dat;
--   * `public._event_partner_consent_at(tenant, event, person)` - JEDYNE miejsce,
--     ktore rozstrzyga, czy dane osoby wolno pokazac partnerowi tego wydarzenia.
--     Czyta NAJNOWSZE zgloszenie osoby na to wydarzenie (ostatnia wyrazona wola),
--     a zgoda liczy sie tylko wtedy, gdy jest POZNIEJSZA niz kazde wycofanie -
--     zarowno wycofanie tej zgody w zgloszeniu, jak i globalne wycofanie zgod
--     osoby (`event_people.consent_withdrawn_at`).
--
-- BACKFILL - FAIL-CLOSED. Stempel osoby nie mowi, przy ktorym wydarzeniu zgode
-- zaznaczono. Da sie to udowodnic tylko w jednym przypadku: `event_register()`
-- ustawial stempel osoby na `now()` w TEJ SAMEJ transakcji, w ktorej wstawial
-- zgloszenie (`created_at DEFAULT now()`), a `COALESCE(stary, now())` nie
-- przesuwal go pozniej. Rownosc `created_at = consent_partner_sharing_at` jest
-- wiec dowodem, ze zgode zaznaczono w tym zgloszeniu. Wszystkie pozostale
-- zgloszenia dostaja NULL: administrator musi umiec WYKAZAC zgode, a nie ja
-- domniemywac. Wycofanie globalne zostaje uszanowane przez funkcje pomocnicza.
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, backfill tylko
-- tam, gdzie kolumna jest jeszcze pusta.
-- ============================================================================

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS consent_partner_sharing_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_partner_withdrawn_at timestamptz;

COMMENT ON COLUMN public.event_registrations.consent_partner_sharing_at IS
  'Stempel zgody na przekazanie danych partnerom TEGO wydarzenia, udzielonej w tym zgloszeniu. NULL = brak zgody. Rozstrzyga _event_partner_consent_at().';
COMMENT ON COLUMN public.event_registrations.consent_partner_withdrawn_at IS
  'Stempel wycofania zgody partnerskiej tego zgloszenia. Osobna kolumna, nie skasowanie stempla nadania - dowod potrzebuje obu dat.';

UPDATE public.event_registrations r
   SET consent_partner_sharing_at = p.consent_partner_sharing_at
  FROM public.event_people p
 WHERE p.tenant_id = r.tenant_id
   AND p.id = r.person_id
   AND r.consent_partner_sharing_at IS NULL
   AND p.consent_partner_sharing_at IS NOT NULL
   AND r.created_at = p.consent_partner_sharing_at;

COMMENT ON COLUMN public.event_people.consent_partner_sharing_at IS
  'HISTORYCZNY stempel pierwszej zgody partnerskiej osoby (dowolne wydarzenie). NIE rozstrzyga o przekazaniu danych - zgoda jest per zgloszenie: event_registrations.consent_partner_sharing_at i _event_partner_consent_at().';

CREATE OR REPLACE FUNCTION public._event_partner_consent_at(
  p_tenant uuid,
  p_event_id uuid,
  p_person_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN r.consent_partner_sharing_at IS NOT NULL
     AND (r.consent_partner_withdrawn_at IS NULL
          OR r.consent_partner_withdrawn_at < r.consent_partner_sharing_at)
     AND (p.consent_withdrawn_at IS NULL
          OR p.consent_withdrawn_at < r.consent_partner_sharing_at)
    THEN r.consent_partner_sharing_at
  END
  FROM public.event_registrations r
  JOIN public.event_people p
    ON p.tenant_id = r.tenant_id AND p.id = r.person_id
  WHERE r.tenant_id = p_tenant
    AND r.event_id = p_event_id
    AND r.person_id = p_person_id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
$function$;

COMMENT ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) IS
  'Skuteczny stempel zgody partnerskiej osoby na TO wydarzenie albo NULL. Czyta najnowsze zgloszenie osoby na wydarzenie; zgoda liczy sie tylko, gdy jest pozniejsza niz wycofanie w zgloszeniu i globalne wycofanie osoby. Jedyne zrodlo prawdy dla skanu leadu, linku sponsora i eksportu.';

REVOKE ALL ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_partner_consent_at(uuid, uuid, uuid) TO service_role;
