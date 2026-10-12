-- ============================================================================
-- DAROWIZNY: jedna wpłata = jeden wiersz, zwrot trafia w darowiznę, środowisko
-- z sesji (audyt rozliczeń SUB-09 / SUB-10, 2026-10-12).
--
-- DEFEKTY:
--   (1) Wpłata cykliczna liczyła się podwójnie. `checkout.session.completed`
--       (tryb subskrypcji) księgował pierwszą ratę kluczem `cs_...`, a
--       `invoice.paid` tej samej raty zakładał drugi wiersz `renewal:in_...` -
--       różne klucze, żaden unikat nie łapał duplikatu. Od tej zmiany ratę
--       (także pierwszą) księguje WYŁĄCZNIE faktura, a jej identyfikator ma
--       własną kolumnę z unikatem (`provider_invoice_id`).
--   (2) Zwrot nie trafiał w darowiznę: wpłata jednorazowa zapisywała w
--       `provider_intent_id` sesję (`cs_...`), rata cykliczna - fakturę, a
--       `charge.refunded` niesie intencję (`pi_...`). Kod (`refunds.server`)
--       szuka teraz po intencji, a dla wierszy bez niej idzie mostem u
--       operatora (faktura / sesja intencji). Zwrot częściowy - jak przy
--       zamówieniach - zostawia wpłatę opłaconą i podnosi
--       `refunded_amount_cents`.
--   (3) Status wspierającego przeżywał zwrot, gdy zwrócona wpłata nie była
--       ostatnią wpłatą darczyńcy (trigger odbierał przydział wyłącznie po
--       `source_donation_id`), a każde ponowienie zapisu `paid -> paid`
--       przedłużało go o kolejne 12 miesięcy. Trigger przelicza teraz
--       przydział z POZOSTAŁYCH opłaconych wpłat i ignoruje `paid -> paid`.
--   (4) Wiersze sesji testowych (`cs_test_...`) mają `environment = 'live'`,
--       bo wstawienie nie podawało środowiska (DEFAULT 'live'). Identyfikator
--       sesji Stripe NIESIE tryb, więc przeklasyfikowanie jest pewne.
--
-- DANE ZASTANE (jednorazowo, bezpiecznie):
--   * `provider_invoice_id` z dotychczasowej konwencji (`provider_intent_id`
--     faktury = `in_...`) - unikat intencji gwarantuje unikat faktury,
--   * pary sesja/faktura PIERWSZEJ raty tej samej subskrypcji: duplikat dostaje
--     status `canceled` i klucz `duplicate:...` (ślad zostaje, statystyki
--     i trigger wspierającego go nie liczą). Kryteria w funkcji niżej -
--     wyłącznie przypadki jednoznaczne; reszta zostaje nietknięta.
--
-- IDEMPOTENTNA: IF NOT EXISTS / CREATE OR REPLACE / warunki na danych.
-- DOWÓD: supabase/tests/donations_ledger_integrity_test.sql.
-- ============================================================================

ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS provider_invoice_id text,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.donations
    ADD CONSTRAINT donations_refunded_amount_cents_check CHECK (refunded_amount_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.donations.provider_invoice_id IS
  'Faktura operatora (in_...), z której zaksięgowano ratę darowizny cyklicznej - klucz idempotencji raty (unikat provider+environment+faktura). invoice.paid i invoice.payment_succeeded tej samej faktury trafiają w ten sam unikat. Sesja checkout w trybie subskrypcji NIE jest ratą (audyt SUB-09).';
COMMENT ON COLUMN public.donations.refunded_amount_cents IS
  'Narastająca kwota zwrotu u operatora (amount_refunded), zaciśnięta do kwoty wpłaty. Zwrot częściowy zostawia status paid (statystyki liczą kwotę netto), pełny - status refunded. Spór nie rusza tej kolumny.';

-- Konwencja sprzed tej migracji: rata cykliczna miała w `provider_intent_id`
-- identyfikator faktury. Unikat `(provider, provider_intent_id)` gwarantuje,
-- że przeniesienie nie zderzy się z unikatem faktury.
UPDATE public.donations
   SET provider_invoice_id = provider_intent_id
 WHERE provider_invoice_id IS NULL
   AND provider_intent_id LIKE 'in\_%';

CREATE UNIQUE INDEX IF NOT EXISTS donations_provider_invoice_id_key
  ON public.donations (provider, environment, provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

-- (4) Sesje testowe stemplowane jako produkcyjne. Raty ich subskrypcji
-- dziedziczą tryb sesji (subskrypcja z sesji testowej żyje w piaskownicy).
WITH test_subscriptions AS (
  SELECT DISTINCT d.provider_subscription_id
    FROM public.donations d
   WHERE d.environment = 'live'
     AND d.provider_session_id LIKE 'cs\_test\_%'
     AND d.provider_subscription_id IS NOT NULL
)
UPDATE public.donations d
   SET environment = 'sandbox'
 WHERE d.environment = 'live'
   AND (
     d.provider_session_id LIKE 'cs\_test\_%'
     OR d.provider_session_id LIKE 'renewal:cs\_test\_%'
     OR d.provider_subscription_id IN (SELECT t.provider_subscription_id FROM test_subscriptions t)
   );

-- ----------------------------------------------------------------------------
-- (3) Status wspierającego z darowizny.
--
-- Przejście `paid -> cokolwiek` (zwrot, spór, korekta duplikatu) PRZELICZA
-- przydział z pozostałych opłaconych wpłat darczyńcy w tym samym środowisku,
-- tą samą regułą, którą przydział powstaje (każda wpłata: +12 miesięcy od
-- późniejszej z dat: zapłaty i dotychczasowego końca). Wynik może przydział
-- wyłącznie SKRÓCIĆ (LEAST z obecnym końcem) - zwrot nigdy go nie wydłuża,
-- a ręczne skrócenie przez redakcję zostaje. Brak uzasadnienia = odebranie.
--
-- `paid -> paid` (ponowiony zapis księgujący, `UPDATE OF status` odpala się
-- także bez zmiany wartości) nie przedłuża już przydziału.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_donations_grant_supporter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grant public.membership_grants%ROWTYPE;
  v_until timestamptz;
  v_last uuid;
  r record;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    SELECT * INTO v_grant
      FROM public.membership_grants
     WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
       AND source = 'donation' AND revoked_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    v_until := NULL;
    v_last := NULL;
    FOR r IN
      SELECT d.id, COALESCE(d.paid_at, d.created_at) AS paid_at
        FROM public.donations d
       WHERE d.tenant_id = NEW.tenant_id
         AND d.user_id = NEW.user_id
         AND d.environment = NEW.environment
         AND d.status = 'paid'
         AND d.id <> NEW.id
       ORDER BY COALESCE(d.paid_at, d.created_at), d.id
    LOOP
      v_until := GREATEST(COALESCE(v_until, r.paid_at), r.paid_at) + interval '12 months';
      v_last := r.id;
    END LOOP;

    IF v_until IS NULL OR v_until <= now() THEN
      UPDATE public.membership_grants
         SET revoked_at = now()
       WHERE id = v_grant.id;
    ELSE
      UPDATE public.membership_grants
         SET expires_at = LEAST(COALESCE(v_grant.expires_at, v_until), v_until),
             source_donation_id = v_last
       WHERE id = v_grant.id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'paid' THEN
    RETURN NEW;
  END IF;
  -- Ponowiony zapis księgujący (`paid -> paid`) to ta sama wpłata.
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  -- Tenant bez warstwy 'supporter' (usunięta w panelu) = brak automatu.
  IF NOT EXISTS (
    SELECT 1 FROM public.membership_tiers
     WHERE tenant_id = NEW.tenant_id AND key = 'supporter' AND active
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_grant
    FROM public.membership_grants
   WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
     AND source = 'donation' AND revoked_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.membership_grants
       SET expires_at = GREATEST(COALESCE(v_grant.expires_at, now()), now())
                        + interval '12 months',
           source_donation_id = NEW.id
     WHERE id = v_grant.id;
  ELSE
    INSERT INTO public.membership_grants
      (tenant_id, user_id, tier_key, source, source_donation_id, expires_at)
    VALUES
      (NEW.tenant_id, NEW.user_id, 'supporter', 'donation', NEW.id,
       now() + interval '12 months');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS donations_grant_supporter ON public.donations;
CREATE TRIGGER donations_grant_supporter
  AFTER INSERT OR UPDATE OF status, user_id ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.tg_donations_grant_supporter();

-- ----------------------------------------------------------------------------
-- (1) Korekta zastanych par sesja/faktura PIERWSZEJ raty.
--
-- Wiersz „z sesji" to: kotwica (`provider_session_id` bez prefiksu) z
-- `provider_intent_id = cs_...` (sesja doszła pierwsza) albo wiersz
-- `renewal:cs_...` (faktura doszła pierwsza). Wiersz „z faktury" to wiersz tej
-- samej subskrypcji z `provider_invoice_id` - ten NAJWCZEŚNIEJSZY, bo pierwsza
-- rata jest pierwszą fakturą.
--
-- Para jest duplikatem WYŁĄCZNIE gdy: ten sam najemca, środowisko,
-- subskrypcja, kwota i waluta, oba `paid`, a zapłaty dzieli najwyżej 7 dni.
-- Interwał darowizny to miesiąc (`donations.server`), więc druga rata nie może
-- wpaść w to okno - a ponowienia operatora (do 3 dób) się w nim mieszczą.
--
-- Zostaje KOTWICA (wiersz z formularza: id w metadanych, wiadomość, data
-- otwarcia kasy) z kluczem faktury; drugi wiersz dostaje `canceled`
-- i `duplicate:<stary klucz>`, a przejście `paid -> canceled` przelicza
-- status wspierającego (trigger wyżej).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.donations_dedupe_session_invoice_pairs()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pair record;
  v_count integer := 0;
  v_keep uuid;
  v_drop uuid;
  v_invoice text;
BEGIN
  FOR v_pair IN
    WITH invoice_rows AS (
      SELECT d.id, d.tenant_id, d.environment, d.provider_subscription_id,
             d.amount_cents, d.currency, d.status, d.provider_session_id,
             d.provider_invoice_id,
             COALESCE(d.paid_at, d.created_at) AS paid_at,
             row_number() OVER (
               PARTITION BY d.tenant_id, d.environment, d.provider_subscription_id
               ORDER BY COALESCE(d.paid_at, d.created_at), d.id
             ) AS rn
        FROM public.donations d
       WHERE d.recurring
         AND d.provider_subscription_id IS NOT NULL
         AND d.provider_invoice_id IS NOT NULL
    ),
    session_rows AS (
      SELECT d.id, d.tenant_id, d.environment, d.provider_subscription_id,
             d.amount_cents, d.currency, d.provider_session_id,
             COALESCE(d.paid_at, d.created_at) AS paid_at
        FROM public.donations d
       WHERE d.recurring
         AND d.status = 'paid'
         AND d.provider_subscription_id IS NOT NULL
         AND d.provider_invoice_id IS NULL
         AND (
           (d.provider_session_id NOT LIKE 'renewal:%' AND d.provider_intent_id LIKE 'cs\_%')
           OR d.provider_session_id LIKE 'renewal:cs\_%'
         )
    )
    SELECT s.id AS session_row, s.provider_session_id AS session_key,
           i.id AS invoice_row, i.provider_session_id AS invoice_key,
           i.provider_invoice_id AS invoice_id
      FROM session_rows s
      JOIN invoice_rows i
        ON i.tenant_id = s.tenant_id
       AND i.environment = s.environment
       AND i.provider_subscription_id = s.provider_subscription_id
       AND i.rn = 1
       AND i.status = 'paid'
       AND i.id <> s.id
       AND i.amount_cents = s.amount_cents
       AND i.currency = s.currency
       AND abs(EXTRACT(EPOCH FROM (i.paid_at - s.paid_at))) <= 7 * 86400
  LOOP
    v_invoice := v_pair.invoice_id;
    IF v_pair.session_key NOT LIKE 'renewal:%' THEN
      -- Sesja doszła pierwsza: kotwica zostaje i przejmuje klucz faktury.
      v_keep := v_pair.session_row;
      v_drop := v_pair.invoice_row;
    ELSIF v_pair.invoice_key NOT LIKE 'renewal:%' THEN
      -- Faktura doszła pierwsza: kotwica ma już klucz faktury.
      v_keep := v_pair.invoice_row;
      v_drop := v_pair.session_row;
    ELSE
      -- Ani jeden z wierszy nie jest kotwicą - przypadek niejednoznaczny.
      CONTINUE;
    END IF;

    -- Najpierw zwolnienie unikatów duplikatu, potem przeniesienie klucza.
    UPDATE public.donations
       SET status = 'canceled',
           provider_session_id = 'duplicate:' || provider_session_id,
           provider_intent_id = NULL,
           provider_invoice_id = NULL
     WHERE id = v_drop AND status = 'paid';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.donations
       SET provider_invoice_id = v_invoice,
           provider_intent_id = v_invoice
     WHERE id = v_keep AND provider_invoice_id IS DISTINCT FROM v_invoice;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.donations_dedupe_session_invoice_pairs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.donations_dedupe_session_invoice_pairs() TO service_role;

COMMENT ON FUNCTION public.donations_dedupe_session_invoice_pairs() IS
  'Jednorazowa korekta par sesja/faktura pierwszej raty darowizny cyklicznej (audyt SUB-09): duplikat -> canceled + duplicate:<klucz>, kotwica przejmuje klucz faktury. Wyłącznie pary jednoznaczne (ten sam najemca/środowisko/subskrypcja/kwota/waluta, oba paid, <= 7 dni). Idempotentna - kolejne wywołanie nie znajduje par. Tylko service_role.';

DO $$
DECLARE
  v_fixed integer;
BEGIN
  v_fixed := public.donations_dedupe_session_invoice_pairs();
  RAISE NOTICE 'donations: corrected % duplicated first recurring payment(s)', v_fixed;
END $$;
