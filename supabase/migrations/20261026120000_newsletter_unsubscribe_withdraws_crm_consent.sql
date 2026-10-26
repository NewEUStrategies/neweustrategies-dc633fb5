-- ============================================================================
-- WYPIS Z NEWSLETTERA WYCOFUJE ZGODĘ MARKETINGOWĄ KONTAKTU CRM (AUDYT ED14,
-- „DANE MIĘDZY MODUŁAMI", WAGA WYSOKA).
--
-- DEFEKT
--   1. Przejście subskrybenta na `unsubscribed` (link wypisu, token globalny,
--      personel, wypis ze ścieżki, odbicie, skarga) zmieniało w CRM wyłącznie
--      `crm_leads.newsletter_status`. Oba wyzwalacze newslettera scalają zgodę
--      przez OR: `newsletter_to_lead` -> `crm_upsert_lead(..., _marketing =
--      status = 'subscribed')` (`marketing_consent OR false`, 20260630060254)
--      i `subscriber_sync_crm_lead` -> `crm_upsert_lead_from_subscriber`
--      (`marketing_consent OR EXCLUDED.marketing_consent`, 20260722080948).
--      Flaga zostawała `true`, rejestr zgód nie dostawał wiersza
--      `given = false`, a zgoda płynęła dalej do integracji wychodzących
--      (src/lib/integrations/formats.ts) i liczników panelu
--      (`admin_dashboard_aggregates`). Wycofanie w CRM robił wyłącznie most
--      wydarzeń - dla adresów osób wydarzeń (`_event_consent_withdraw_by_email`).
--      Kod modułu deklaruje odwrotnie: „wypis jest wycofaniem zgody
--      marketingowej" (src/lib/billing/premiumNewsletter.ts).
--   2. Czytelnik zgody ścieżek `_journey_marketing_consent` (S5) traktował
--      ostatni wpis łańcucha `marketing` jako ostateczny: osoba wypisana ze
--      ścieżki (`_journey_unsubscribe`), która potem ponownie zapisała się na
--      newsletter i potwierdziła zapis (świeży wpis `newsletter` „tak"),
--      dostawała dalej `no_consent`. Po zmianie A dotyczyłoby to KAŻDEGO
--      ponownego zapisu po wypisie.
--
-- ZMIANA
--   A. Wyzwalacz `trg_newsletter_unsubscribed_withdraw_crm` (AFTER UPDATE OF
--      status, przejście na `unsubscribed`) -> wspólny pomocnik
--      `_crm_marketing_consent_withdraw` (Z-S5-04): flaga zdjęta kontaktom,
--      które ją mają, i wpis `marketing`/`given = false` (źródło `newsletter`,
--      id subskrybenta, formularz `newsletter:unsubscribe`, język subskrybenta,
--      treść neutralna - wypis, odbicie, skarga albo decyzja personelu).
--      Kontakty zanonimizowane pominięte (jak przy wygaszaniu). Nazwa sortuje
--      się PO `trg_newsletter_to_lead` (scalanie OR nie przywróci flagi) i PO
--      `trg_newsletter_unsubscribed_measurement` (łańcuch pomiaru domyka kanał
--      `measurement:unsubscribe`, a nie `measurement:opt_out`). Funkcja jest
--      prosta i sama niczego nie rzuca (R1.3: wypis przez odbicie/skargę idzie
--      wyzwalaczem listy wyłączeń, który połyka błędy RAZEM ze zmianą statusu).
--   B. `_journey_marketing_consent` (CIALO-Z niżej): wycofanie z łańcucha
--      `marketing` przestaje obowiązywać, gdy osoba PÓŹNIEJ udzieliła zgody na
--      komunikację (wpis „tak" o kluczu `marketing*`/`newsletter*` - ta sama
--      definicja co w `_newsletter_sunset_delete`). „Przywróć" w panelu nie
--      pisze wpisu „tak", więc zgody ścieżek nie wskrzesza.
--   C. Uzgodnienie danych `_newsletter_unsubscribe_crm_reconcile()`
--      (wewnętrzna, wołana raz na końcu pliku): kontakt z flagą zgody, którego
--      subskrybent jest dziś `unsubscribed`, a rejestr od chwili wypisu
--      (`unsubscribed_at`, bez niej `updated_at`) nie ma wpisu „tak"
--      marketing*/newsletter* - wycofanie tym samym pomocnikiem (formularz
--      `newsletter:unsubscribe`, nazwa `newsletter_unsubscribe_reconcile`,
--      chwila naprawy).
--
-- CZEGO TO NIE ZAMYKA
--   * „Przywróć" w panelu i każdy UPDATE statusu na `subscribed` dalej
--     zapalają flagę przez OR w obu wyzwalaczach (stan sprzed tej zmiany;
--     flaga z decyzji personelu bez dowodu zgody osoby - osobna decyzja).
--   * INSERT od razu ze statusem `unsubscribed` (import listy wypisanych) to
--     nie przejście - bez wycofania; taki kontakt i tak nie dostaje zgody
--     z newslettera (`_marketing = false`).
--   * C cofa też ręczne zaznaczenie zgody przez personel PO wypisie, jeśli nie
--     zostawiło wpisu „tak" w rejestrze (personel nie pisze dowodu,
--     20261012180900) - kierunek bezpieczny, raport w opisie PR.
--
-- KOLEJNOŚĆ WDROŻENIA: dowolna względem frontu (kształt RPC bez zmian);
-- wymaga 20261020162700 (pomocnik), 20261020140200 (czytelnik ścieżek)
-- i 20261023090000 (wyzwalacz pomiaru). Okno: nocne - `CREATE TRIGGER` na
-- gorącej `newsletter_subscribers` (§6.2), C pisze do `crm_leads`
-- i `crm_consent_log`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE
-- TRIGGER, bezstanowe REVOKE/COMMENT; powtórka uzgodnienia C = 0 (flaga już
-- zdjęta).
-- DOWÓD: supabase/tests/newsletter_unsubscribe_crm_consent_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Wypis -> wycofanie zgody marketingowej kontaktu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_newsletter_unsubscribed_withdraw_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lang text := CASE WHEN NEW.language = 'en' THEN 'en' ELSE 'pl' END;
  v_leads uuid[];
BEGIN
  SELECT array_agg(l.id ORDER BY l.id) INTO v_leads
    FROM public.crm_leads l
   WHERE l.tenant_id = NEW.tenant_id
     AND l.email_norm = lower(btrim(NEW.email))
     AND l.anonymized_at IS NULL;
  IF v_leads IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public._crm_marketing_consent_withdraw(
    NEW.tenant_id, v_leads, 'newsletter'::public.crm_source_type, NEW.id,
    'newsletter:unsubscribe', 'newsletter_unsubscribe',
    CASE WHEN v_lang = 'en'
      THEN 'Marketing consent withdrawn - the newsletter subscription ended (unsubscribe, bounce, complaint or staff decision).'
      ELSE 'Wycofanie zgody marketingowej - koniec subskrypcji newslettera (wypis, odbicie, skarga albo decyzja personelu).'
    END,
    v_lang);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_unsubscribed_withdraw_crm() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_newsletter_unsubscribed_withdraw_crm ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_unsubscribed_withdraw_crm
  AFTER UPDATE OF status ON public.newsletter_subscribers
  FOR EACH ROW
  WHEN (NEW.status = 'unsubscribed' AND OLD.status IS DISTINCT FROM 'unsubscribed')
  EXECUTE FUNCTION public.tg_newsletter_unsubscribed_withdraw_crm();
RESET lock_timeout;

COMMENT ON FUNCTION public.tg_newsletter_unsubscribed_withdraw_crm() IS
  'Audyt ED14: przejście subskrybenta na unsubscribed (każdy kanał) -> _crm_marketing_consent_withdraw dla kontaktów CRM tego adresu w najemcy wiersza (bez zanonimizowanych): marketing_consent = false i wpis crm_consent_log marketing/given=false (źródło newsletter, id subskrybenta, form_id newsletter:unsubscribe, język subskrybenta). Biegnie po trg_newsletter_to_lead (OR nie przywraca flagi) i po trg_newsletter_unsubscribed_measurement. Wyzwalacz.';

-- ----------------------------------------------------------------------------
-- B) Czytelnik zgody ścieżek - późniejsza zgoda wygrywa z wycofaniem.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020140200; zmiana oznaczona `ZMIANA (audyt ED14)`.
-- CIALO-Z: 20261020140200
CREATE OR REPLACE FUNCTION public._journey_marketing_consent(p_tenant uuid, p_lead uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead record;
  v_sub text;
  v_doi boolean;
  v_last boolean;
  v_last_at timestamptz;
BEGIN
  SELECT l.email_norm, l.marketing_consent INTO v_lead
    FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN 'no_consent';
  END IF;
  SELECT s.status INTO v_sub FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND lower(s.email) = v_lead.email_norm
   ORDER BY s.updated_at DESC LIMIT 1;
  IF v_sub = 'unsubscribed' THEN
    RETURN 'unsubscribed';
  END IF;
  -- Ostatnie słowo księgi zgód wygrywa z flagą leada (wycofanie po zgodzie).
  SELECT c.given, c.created_at INTO v_last, v_last_at FROM public.crm_consent_log c
   WHERE c.tenant_id = p_tenant AND lower(c.email) = v_lead.email_norm AND c.consent_key = 'marketing'
   ORDER BY c.created_at DESC LIMIT 1;
  -- ZMIANA (audyt ED14): ... chyba że osoba PÓŹNIEJ znów udzieliła zgody na
  -- komunikację (ponowny zapis na newsletter, „Chcę dalej otrzymywać", most
  -- wydarzeń) - wpis „tak" marketing*/newsletter* nowszy niż wycofanie.
  IF v_last IS FALSE AND NOT EXISTS (
       SELECT 1 FROM public.crm_consent_log c
        WHERE c.tenant_id = p_tenant AND lower(c.email) = v_lead.email_norm
          AND c.consent_key ~ '^(marketing|newsletter)' AND c.given
          AND c.created_at > v_last_at) THEN
    RETURN 'no_consent';
  END IF;
  SELECT ns.double_opt_in INTO v_doi FROM public.newsletter_settings ns WHERE ns.tenant_id = p_tenant;
  IF v_lead.marketing_consent OR v_sub = 'confirmed'
     OR (v_sub = 'subscribed' AND v_doi IS FALSE) THEN
    RETURN 'ok';
  END IF;
  RETURN 'no_consent';
END;
$$;

REVOKE ALL ON FUNCTION public._journey_marketing_consent(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Uzgodnienie: kontakty wypisane przed wyzwalaczem A.
-- ----------------------------------------------------------------------------
-- Funkcja, nie blok DO: pgTAP sprawdza ją na tych samych danych co produkcję
-- (wzór `_email_measurement_close_backfill`). Zwraca liczbę wpisów rejestru.
CREATE OR REPLACE FUNCTION public._newsletter_unsubscribe_crm_reconcile()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.tenant_id, CASE WHEN s.language = 'en' THEN 'en' ELSE 'pl' END AS lang,
           COALESCE(s.unsubscribed_at, s.updated_at) AS unsubscribed_at,
           array_agg(l.id ORDER BY l.id) AS lead_ids
      FROM public.newsletter_subscribers s
      JOIN public.crm_leads l
        ON l.tenant_id = s.tenant_id
       AND l.email_norm = lower(btrim(s.email))
       AND l.anonymized_at IS NULL
       AND l.marketing_consent
     WHERE s.status = 'unsubscribed'
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_consent_log c
          WHERE c.tenant_id = s.tenant_id
            AND lower(c.email) = lower(btrim(s.email))
            AND c.consent_key ~ '^(marketing|newsletter)'
            AND c.given
            AND c.created_at > COALESCE(s.unsubscribed_at, s.updated_at))
     GROUP BY s.id, s.tenant_id, s.language, s.unsubscribed_at, s.updated_at
     ORDER BY s.tenant_id, s.id
  LOOP
    v_n := v_n + public._crm_marketing_consent_withdraw(
      r.tenant_id, r.lead_ids, 'newsletter'::public.crm_source_type, r.id,
      'newsletter:unsubscribe', 'newsletter_unsubscribe_reconcile',
      CASE WHEN r.lang = 'en'
        THEN format('Marketing consent withdrawn on reconciliation - the newsletter unsubscribe of %s did not withdraw it in the CRM.',
                    to_char(r.unsubscribed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
        ELSE format('Wycofanie zgody marketingowej przy uzgodnieniu - wypis z newslettera z %s nie wycofał jej w CRM.',
                    to_char(r.unsubscribed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
      END,
      r.lang);
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._newsletter_unsubscribe_crm_reconcile() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._newsletter_unsubscribe_crm_reconcile() IS
  'Audyt ED14 (jednorazowe uzgodnienie, powtórka = 0): kontakty CRM z marketing_consent, których subskrybent jest unsubscribed, a rejestr od chwili wypisu (unsubscribed_at, bez niej updated_at) nie ma wpisu „tak" marketing*/newsletter* -> _crm_marketing_consent_withdraw (źródło newsletter, id subskrybenta, form_id newsletter:unsubscribe, form_name newsletter_unsubscribe_reconcile). Zwraca liczbę wpisów rejestru. Wewnętrzna.';

SELECT public._newsletter_unsubscribe_crm_reconcile();
