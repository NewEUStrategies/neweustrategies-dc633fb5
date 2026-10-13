-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-03 (CZ. 1): DZIENNIK ZWROTOW ZNA KAZDE
-- ZAMKNIECIE OPLACONEGO ZGLOSZENIA, ZASADA ZWROTU MA KONSUMENTA I MIGAWKE.
--
-- DEFEKT
--   1. `event_registration_refund_jobs` (20260929113000:52-73) zna tylko
--      odrzucenie: trigger `_event_rejection_refund_queue` (:75-100) wstawia
--      zlecenie WYLACZNIE dla `status = 'rejected'`. Rezygnacja uczestnika
--      (`event_registration_cancel`, 20260824090214:596-602) i anulowanie przez
--      organizatora (`admin_event_registration_decide` 'cancel',
--      20260829071947:611-622) zamykaja OPLACONE zgloszenie bez zwrotu, bez
--      wpisu w dzienniku i bez sygnalu dla organizatora - pieniadze zostaja
--      pobrane, a nikt o tym nie wie.
--   2. Wplata poza operatorem (akcja organizatora 'paid', 20260829071947:551-564)
--      daje `payment_status = 'paid'` z `payment_order_id = NULL`, a tabela
--      zlecen wymaga zamowienia (`payment_order_id NOT NULL`) - takiego
--      zamkniecia nie dalo sie nawet zapisac.
--   3. `event_participant_settings.refund_mode/refund_deadline_hours`
--      (20260926153100:185-186) nie maja ZADNEGO konsumenta w SQL, a panel
--      obiecuje, ze „zasada zapisuje sie przy bilecie w chwili zaplaty"
--      (i18n-admin-event-participant.ts) - takiej kolumny nie bylo.
--   4. Po 10 nieudanych probach zlecenie milknie: `claim` pomija
--      `attempts >= 10` (:141), a `settle` (:161-172) niczego nie zglasza.
--
-- ZMIANA
--   A. Zlecenie bez zamowienia (wplata reczna) - tylko jako `needs_review`,
--      `cancelled` albo `completed` (CHECK), jedno na zgloszenie (indeks
--      czesciowy). Nowe kolumny: pochodzenie (`origin`), powod przegladu
--      (`review_reason`), kwota i waluta, termin zwrotu, kto zlecil, notatka
--      i stempel decyzji organizatora.
--   B. Migawka zasady zwrotu przy zgloszeniu w chwili zaplaty
--      (`refund_terms_mode`, `refund_terms_deadline_at`, trigger BEFORE).
--   C. Jedna regula skutku finansowego zamkniecia
--      (`_event_registration_refund_assess`), dzwonek do organizatorow
--      (`_event_refund_alert_organizers`, lustro TS `alertOrganizers`)
--      i zapis zlecenia (`_event_registration_cancel_refund`).
--   D. Siatka bezpieczenstwa w triggerze kolejki: KAZDE przejscie oplaconego
--      zgloszenia w zamkniete zostawia co najmniej `needs_review`; straznik
--      ponownego przyjecia, dzierzawa i rozliczenie znaja zlecenia reczne;
--      ostateczna porazka zwrotu dzwoni do organizatorow.
--   E. `admin_event_refund_jobs` oddaje nowe pola, nowe
--      `admin_event_refund_job_decide` (zwroc / oznacz zwrocone / nie zwracaj).
--
-- CZEGO TO NIE ZAMYKA. Rezygnacja i anulowanie przez organizatora przechodza
-- na te funkcje w 20261012170100. Odwolanie CALEGO wydarzenia nadal nie
-- zamyka oplaconych zgloszen (wlasciciel `tg_events_status_notify` wola
-- `_event_registration_cancel_refund(..., 'organizer_cancelled', ...)` -
-- ocena juz zwraca pelny zwrot dla odwolanego wydarzenia). Migawka nie ma
-- backfillu: bilety oplacone przed migracja maja zasade biezaca (dotychczasowe
-- zachowanie).
--
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu, ale RAZEM z 20261012170100
-- i PRZED nowym frontem dziennika (parser TS przyjmuje `payment_order_id`
-- NULL dopiero od tej serii - stary parser pokazalby blad wczytania).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS,
-- bezstanowe REVOKE/GRANT, UPDATE z warunkiem na stan docelowy.
-- DOWOD: supabase/tests/event_registration_cancel_refund_test.sql,
-- scripts/events-harness/runtime_test.d/24_cancel_refund_visibility.sql.
-- ============================================================================

-- A) ZLECENIA ZWROTU: KAZDE ZAMKNIECIE, TAKZE BEZ ZAMOWIENIA ---------------------
ALTER TABLE public.event_registration_refund_jobs
  ALTER COLUMN payment_order_id DROP NOT NULL;

ALTER TABLE public.event_registration_refund_jobs
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'organizer_rejected',
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS refund_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS amount_cents integer,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

ALTER TABLE public.event_registration_refund_jobs
  DROP CONSTRAINT IF EXISTS event_refund_jobs_origin_values,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_review_reason_values,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_amount_nonneg,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_currency_shape,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_review_note_len,
  DROP CONSTRAINT IF EXISTS event_refund_jobs_manual_needs_review;

ALTER TABLE public.event_registration_refund_jobs
  ADD CONSTRAINT event_refund_jobs_origin_values CHECK (
    origin IN ('organizer_rejected', 'organizer_cancelled', 'participant_cancelled', 'system')),
  ADD CONSTRAINT event_refund_jobs_review_reason_values CHECK (
    review_reason IS NULL OR review_reason IN (
      'outside_refund_window', 'refund_disabled', 'shared_payment', 'manual_payment',
      'organizer_waived', 'closed_without_refund_decision')),
  ADD CONSTRAINT event_refund_jobs_amount_nonneg CHECK (amount_cents IS NULL OR amount_cents >= 0),
  ADD CONSTRAINT event_refund_jobs_currency_shape CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT event_refund_jobs_review_note_len CHECK (
    review_note IS NULL OR char_length(review_note) <= 2000),
  -- Zlecenie bez zamowienia nie ma czego zwracac automatycznie: nigdy nie
  -- trafia do kolejki operatora (pending/processing/submitted/failed).
  ADD CONSTRAINT event_refund_jobs_manual_needs_review CHECK (
    payment_order_id IS NOT NULL OR state IN ('needs_review', 'cancelled', 'completed'));

-- Jedno zlecenie reczne na zgloszenie (zlecenia z zamowieniem trzyma
-- UNIQUE(payment_order_id) - jedno na zamowienie, jak dotad).
CREATE UNIQUE INDEX IF NOT EXISTS event_refund_jobs_manual_registration_uniq
  ON public.event_registration_refund_jobs (registration_id)
  WHERE payment_order_id IS NULL;

CREATE INDEX IF NOT EXISTS event_refund_jobs_event_idx
  ON public.event_registration_refund_jobs (tenant_id, event_id, created_at DESC);

-- Zlecenia odlozone przez dzierzawe z powodu wspolnej wplaty dostaja jawny
-- powod (dotad byl tylko w `last_error`).
UPDATE public.event_registration_refund_jobs
   SET review_reason = 'shared_payment'
 WHERE state = 'needs_review'
   AND last_error = 'active_registrations_share_payment'
   AND review_reason IS NULL;

COMMENT ON COLUMN public.event_registration_refund_jobs.origin IS
  'REG-03: kto zamknal zgloszenie - organizer_rejected | organizer_cancelled | participant_cancelled | system (siatka bezpieczenstwa: zamkniecie bez decyzji o zwrocie).';
COMMENT ON COLUMN public.event_registration_refund_jobs.review_reason IS
  'REG-03: dlaczego zwrot czeka na organizatora albo dlaczego go nie ma: outside_refund_window | refund_disabled | shared_payment | manual_payment | organizer_waived | closed_without_refund_decision.';
COMMENT ON COLUMN public.event_registration_refund_jobs.review_note IS
  'REG-03: wewnetrzna notatka organizatora przy decyzji o zwrocie (<= 2000). Nigdy nie trafia do uczestnika.';

-- B) MIGAWKA ZASADY ZWROTU W CHWILI ZAPLATY ------------------------------------
-- Panel organizatora obiecuje, ze pozniejsza zmiana zasady nie skraca praw
-- kupujacych. Obietnica wymaga zapisu przy bilecie: tryb i termin liczone
-- w chwili przejscia w `paid`. Brak migawki (bilety sprzed tej migracji,
-- zgloszenia bezplatne) = zasada biezaca.
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS refund_terms_mode text,
  ADD COLUMN IF NOT EXISTS refund_terms_deadline_at timestamptz;

ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_refund_terms_shape;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_refund_terms_shape CHECK (
    (refund_terms_mode IS NULL AND refund_terms_deadline_at IS NULL)
    OR (refund_terms_mode = 'none' AND refund_terms_deadline_at IS NULL)
    OR (refund_terms_mode = 'policy' AND refund_terms_deadline_at IS NOT NULL));

COMMENT ON COLUMN public.event_registrations.refund_terms_mode IS
  'REG-03: migawka event_participant_settings.refund_mode z chwili zaplaty (policy|none); NULL = brak migawki, obowiazuje zasada biezaca.';
COMMENT ON COLUMN public.event_registrations.refund_terms_deadline_at IS
  'REG-03: termin samodzielnego zwrotu z chwili zaplaty: LEAST(starts_at - refund_deadline_hours, zaplata + 30 dni); tylko przy trybie policy.';

-- Termin wedlug zasady z panelu: wczesniejsza chwila z „start minus godziny"
-- i „30 dni od zaplaty". Ponowna wplata (np. po zwrocie) to nowy zakup, wiec
-- nadpisuje migawke; INSERT z jawna migawka (import) jej nie dotyka.
CREATE OR REPLACE FUNCTION public._event_registration_refund_terms_snapshot()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.event_participant_settings;
  v_starts timestamptz;
BEGIN
  IF NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.refund_terms_mode IS NOT NULL THEN
      RETURN NEW;
    END IF;
  ELSIF OLD.payment_status IN ('paid', 'partially_refunded') THEN
    RETURN NEW;
  END IF;

  SELECT e.starts_at INTO v_starts
    FROM public.events e
   WHERE e.id = NEW.event_id AND e.tenant_id = NEW.tenant_id;
  v_settings := public._event_participant_settings_effective(NEW.tenant_id, NEW.event_id);

  IF v_settings.refund_mode = 'policy' AND v_starts IS NOT NULL THEN
    NEW.refund_terms_mode := 'policy';
    NEW.refund_terms_deadline_at := LEAST(
      v_starts - make_interval(hours => v_settings.refund_deadline_hours),
      COALESCE(NEW.paid_at, now()) + interval '30 days');
  ELSE
    NEW.refund_terms_mode := 'none';
    NEW.refund_terms_deadline_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refund_terms_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_registrations_01_refund_terms ON public.event_registrations;
CREATE TRIGGER event_registrations_01_refund_terms
  BEFORE INSERT OR UPDATE OF payment_status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public._event_registration_refund_terms_snapshot();

COMMENT ON FUNCTION public._event_registration_refund_terms_snapshot() IS
  'REG-03: migawka zasady zwrotu (tryb + termin) przy przejsciu zgloszenia w paid. Termin = LEAST(starts_at - refund_deadline_hours, zaplata + 30 dni) przy trybie policy, NULL przy none. Trigger BEFORE INSERT OR UPDATE OF payment_status.';

-- C1) SKUTEK FINANSOWY ZAMKNIECIA - JEDNA REGULA ----------------------------------
-- Czyta, niczego nie zapisuje. Ten sam wynik widzi uczestnik przed
-- potwierdzeniem (podglad), rezygnacja (potwierdzenie musi sie zgadzac),
-- organizator w oknie decyzji i zapis zlecenia. Skutki:
--   none            - nic do zwrotu (bezplatne, nieoplacone, juz zwrocone);
--   included_ticket - bilet z puli planu (wraca do puli, bez pieniedzy);
--   full_refund     - automatyczny zwrot calej pozostalej kwoty zamowienia;
--   no_refund       - poza terminem albo bez samodzielnych zwrotow -
--                     organizator decyduje w dzienniku (needs_review);
--   organizer_review - wspolna wplata grupy albo wplata poza operatorem -
--                     organizator decyduje w dzienniku (needs_review).
-- Kolejnosc regul:
--   1. goscie zamykani kaskada razem z prowadzacym nie „dziela" jego wplaty;
--   2. bez zaplaty - none; bez zamowienia - bilet z planu albo wplata reczna;
--   3. zamowienie zwrocone - none; nie Stripe albo nie `paid` - wplata reczna;
--   4. wspolna wplata z innym aktywnym zgloszeniem - przeglad, BEZ kwoty
--      (gosc nie poznaje sumy zaplaconej przez prowadzacego);
--   5. odwolane wydarzenie, miejsce nigdy nieprzyznane (draft/pending/
--      waitlist) albo decyzja organizatora - pelny zwrot;
--   6. uczestnik na przyznanym miejscu - korzystniejszy z terminow: biezacego
--      i migawki z chwili zaplaty.
CREATE OR REPLACE FUNCTION public._event_registration_refund_assess(
  _tenant uuid,
  _registration_id uuid,
  _origin text,
  _at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.event_registrations;
  v_starts timestamptz;
  v_event_status text;
  v_order_id uuid;
  v_order_status text;
  v_order_provider text;
  v_order_amount integer;
  v_order_refunded integer;
  v_order_currency text;
  v_order_paid_at timestamptz;
  v_settings public.event_participant_settings;
  v_guests integer := 0;
  v_amount integer;
  v_currency text;
  v_paid_at timestamptz;
  v_current timestamptz;
  v_deadline timestamptz;
  v_mode text;
  v_effect text;
  v_job text;
  v_reason text;
BEGIN
  IF _origin IS NULL OR _origin NOT IN ('participant_cancelled', 'organizer_cancelled') THEN
    RAISE EXCEPTION 'invalid_payload: refund origin must be participant_cancelled or organizer_cancelled';
  END IF;

  SELECT r.* INTO v_reg
    FROM public.event_registrations r
   WHERE r.id = _registration_id AND r.tenant_id = _tenant;
  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  SELECT e.starts_at, e.status INTO v_starts, v_event_status
    FROM public.events e
   WHERE e.id = v_reg.event_id AND e.tenant_id = _tenant;

  -- 1. Goscie, ktorych kaskada `_tg_event_group_follow_lead_status` zamknie
  --    razem z prowadzacym.
  IF v_reg.group_lead_registration_id IS NULL THEN
    SELECT count(*)::integer INTO v_guests
      FROM public.event_registrations g
     WHERE g.tenant_id = _tenant
       AND g.group_lead_registration_id = v_reg.id
       AND g.status IN ('draft', 'pending', 'waitlist', 'approved');
  END IF;

  -- Zasada zwrotu: korzystniejszy z terminow (biezacy i migawka). Liczona dla
  -- kazdego oplaconego zgloszenia - podglad pokazuje termin takze wtedy, gdy
  -- zwrot jeszcze przysluguje.
  IF v_reg.payment_status IN ('paid', 'partially_refunded') THEN
    v_settings := public._event_participant_settings_effective(_tenant, v_reg.event_id);
    IF v_reg.payment_order_id IS NOT NULL THEN
      SELECT o.id, o.status::text, o.provider, o.amount_cents,
             COALESCE(o.refunded_amount_cents, 0), o.currency, o.paid_at
        INTO v_order_id, v_order_status, v_order_provider, v_order_amount,
             v_order_refunded, v_order_currency, v_order_paid_at
        FROM public.payment_orders o
       WHERE o.id = v_reg.payment_order_id AND o.tenant_id = _tenant;
    END IF;
    v_paid_at := COALESCE(v_reg.paid_at, v_order_paid_at, v_reg.decided_at, v_reg.created_at);
    IF v_settings.refund_mode = 'policy' AND v_starts IS NOT NULL THEN
      v_current := LEAST(v_starts - make_interval(hours => v_settings.refund_deadline_hours),
                         v_paid_at + interval '30 days');
    END IF;
    -- GREATEST pomija NULL: brak migawki albo tryb none po jednej stronie
    -- zostawia termin drugiej.
    v_deadline := GREATEST(
      v_current,
      CASE WHEN v_reg.refund_terms_mode = 'policy' THEN v_reg.refund_terms_deadline_at END);
    v_mode := CASE
      WHEN v_settings.refund_mode = 'policy' OR v_reg.refund_terms_mode = 'policy' THEN 'policy'
      ELSE 'none'
    END;
  END IF;

  -- 2-6. Skutek.
  IF v_reg.payment_status NOT IN ('paid', 'partially_refunded') THEN
    v_effect := 'none';
  ELSIF v_reg.payment_order_id IS NULL OR v_order_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.plan_ticket_claims c
       WHERE c.registration_id = v_reg.id
          OR (v_reg.group_lead_registration_id IS NOT NULL
              AND c.registration_id = v_reg.group_lead_registration_id)
    ) THEN
      v_effect := 'included_ticket';
    ELSE
      v_effect := 'organizer_review';
      v_job := 'needs_review';
      v_reason := 'manual_payment';
    END IF;
  ELSIF v_order_status = 'refunded'
        OR (v_order_amount > 0 AND v_order_refunded >= v_order_amount) THEN
    v_effect := 'none';
  ELSIF v_order_provider IS DISTINCT FROM 'stripe' OR v_order_status IS DISTINCT FROM 'paid' THEN
    v_effect := 'organizer_review';
    v_job := 'needs_review';
    v_reason := 'manual_payment';
  ELSIF EXISTS (
    SELECT 1 FROM public.event_registrations x
     WHERE x.tenant_id = _tenant
       AND x.payment_order_id = v_order_id
       AND x.id <> v_reg.id
       AND x.status NOT IN ('cancelled', 'rejected')
       AND NOT (x.group_lead_registration_id IS NOT DISTINCT FROM v_reg.id
                AND v_reg.group_lead_registration_id IS NULL
                AND x.status IN ('draft', 'pending', 'waitlist', 'approved'))
  ) THEN
    v_effect := 'organizer_review';
    v_job := 'needs_review';
    v_reason := 'shared_payment';
  ELSE
    v_amount := GREATEST(COALESCE(v_order_amount, 0) - COALESCE(v_order_refunded, 0), 0);
    v_currency := v_order_currency;
    IF v_amount = 0 THEN
      v_effect := CASE
        WHEN EXISTS (SELECT 1 FROM public.plan_ticket_claims c WHERE c.registration_id = v_reg.id)
          THEN 'included_ticket'
        ELSE 'none'
      END;
      v_amount := NULL;
      v_currency := NULL;
    ELSIF v_event_status = 'cancelled'
          OR v_reg.status IN ('draft', 'pending', 'waitlist')
          OR _origin = 'organizer_cancelled' THEN
      v_effect := 'full_refund';
      v_job := 'pending';
    ELSIF v_deadline IS NOT NULL AND _at <= v_deadline THEN
      v_effect := 'full_refund';
      v_job := 'pending';
    ELSIF v_mode = 'none' THEN
      v_effect := 'no_refund';
      v_job := 'needs_review';
      v_reason := 'refund_disabled';
    ELSE
      v_effect := 'no_refund';
      v_job := 'needs_review';
      v_reason := 'outside_refund_window';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'effect', v_effect,
    'job_state', v_job,
    'review_reason', v_reason,
    'payment_order_id', CASE WHEN v_effect <> 'none' THEN v_order_id END,
    'amount_cents', v_amount,
    'currency', v_currency,
    'refund_mode', v_mode,
    'refund_deadline_at', CASE WHEN v_mode = 'policy' THEN v_deadline END,
    'group_guests_closing', v_guests,
    'event_cancelled', COALESCE(v_event_status = 'cancelled', false)
  );
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refund_assess(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refund_assess(uuid, uuid, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public._event_registration_refund_assess(uuid, uuid, text, timestamptz) IS
  'REG-03 (D9): skutek finansowy zamkniecia zgloszenia {effect none|included_ticket|full_refund|no_refund|organizer_review, job_state null|pending|needs_review, review_reason, payment_order_id, amount_cents, currency, refund_mode, refund_deadline_at, group_guests_closing, event_cancelled}. Origin participant_cancelled|organizer_cancelled. Tylko odczyt. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- C2) DZWONEK DO ORGANIZATOROW -----------------------------------------------------
-- Lustro TS `alertOrganizers` (registrationOutcomeNotify.server.ts):
-- administratorzy najemcy, rodzaj `billing` (zawsze doreczany), odnosnik do
-- listy zgloszen wydarzenia. Producent polyka bledy, wiec dzwonek nigdy nie
-- wywraca transakcji, ktora go wola. Zwraca liczbe wstawionych dzwonkow.
CREATE OR REPLACE FUNCTION public._event_refund_alert_organizers(
  _tenant uuid,
  _event_id uuid,
  _title_pl text,
  _title_en text,
  _body_pl text,
  _body_en text
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_sent integer := 0;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN 0;
  END IF;
  FOR v_uid IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.tenant_id = _tenant
       AND ur.role::text IN ('admin', 'super_admin')
     ORDER BY ur.user_id
  LOOP
    IF public.enqueue_notification(
         v_uid, 'billing', _title_pl, _title_en, _body_pl, _body_en,
         '/admin/events/' || _event_id::text || '/registration/list', 'credit-card') IS NOT NULL THEN
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  RETURN v_sent;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_alert_organizers(uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_refund_alert_organizers(uuid, uuid, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public._event_refund_alert_organizers(uuid, uuid, text, text, text, text) IS
  'REG-03: dzwonek billing do administratorow najemcy (user_roles admin|super_admin) z odnosnikiem do listy zgloszen wydarzenia. Lustro TS alertOrganizers. Zwraca liczbe wstawionych dzwonkow. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- C3) ZAPIS ZLECENIA PO ZAMKNIECIU ------------------------------------------------
-- Wolana PO zmianie statusu (kaskada gosci juz zamknieta). Siatka
-- bezpieczenstwa triggera mogla w tej samej transakcji wstawic `needs_review`
-- - ON CONFLICT ... WHERE state IN ('needs_review', 'cancelled') podnosi je do
-- decyzji z oceny. Zlecenie juz w drodze (pending/processing/submitted/
-- completed/failed) zostaje nietkniete. `_waive` (tylko organizator): zlecenie
-- `cancelled` z powodem `organizer_waived` i notatka.
CREATE OR REPLACE FUNCTION public._event_registration_cancel_refund(
  _tenant uuid,
  _registration_id uuid,
  _origin text,
  _actor uuid,
  _assessment jsonb,
  _waive boolean DEFAULT false,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text := NULLIF(_assessment->>'job_state', '');
  v_reason text := NULLIF(_assessment->>'review_reason', '');
  v_order uuid := NULLIF(_assessment->>'payment_order_id', '')::uuid;
  v_note text := NULLIF(btrim(COALESCE(_note, '')), '');
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_job_id uuid;
  v_job_state text;
  v_why_pl text;
  v_why_en text;
BEGIN
  IF _origin IS NULL OR _origin NOT IN ('participant_cancelled', 'organizer_cancelled') THEN
    RAISE EXCEPTION 'invalid_payload: refund origin must be participant_cancelled or organizer_cancelled';
  END IF;
  IF v_state IS NULL THEN
    RETURN _assessment || jsonb_build_object('job_id', NULL);
  END IF;
  IF COALESCE(_waive, false) THEN
    IF _origin <> 'organizer_cancelled' THEN
      RAISE EXCEPTION 'invalid_payload: only the organizer can waive a refund';
    END IF;
    v_state := 'cancelled';
    v_reason := 'organizer_waived';
  END IF;

  SELECT r.event_id, e.title_pl, COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
    INTO v_event_id, v_title_pl, v_title_en
    FROM public.event_registrations r
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.id = _registration_id AND r.tenant_id = _tenant;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF v_order IS NOT NULL THEN
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, v_order, _registration_id, v_state, _origin, v_reason,
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULLIF(_assessment->>'amount_cents', '')::integer,
      NULLIF(_assessment->>'currency', ''),
      _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (payment_order_id) DO UPDATE SET
      registration_id = EXCLUDED.registration_id,
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      attempts = 0,
      claim_token = NULL,
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
    WHERE j.state IN ('needs_review', 'cancelled')
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.payment_order_id = v_order AND j.tenant_id = _tenant;
    END IF;
  ELSE
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, NULL, _registration_id,
      -- Bez zamowienia nie ma kolejki operatora: tylko przeglad albo rezygnacja.
      CASE WHEN v_state = 'cancelled' THEN 'cancelled' ELSE 'needs_review' END,
      _origin, COALESCE(v_reason, 'manual_payment'),
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULL, NULL, _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO UPDATE SET
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      last_error = NULL,
      updated_at = now()
    WHERE j.state IN ('needs_review', 'cancelled')
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.registration_id = _registration_id
         AND j.payment_order_id IS NULL
         AND j.tenant_id = _tenant;
    END IF;
  END IF;

  -- Szyna: dziennik zwrotow odswieza sie w panelu (eventInvalidationMap).
  -- Bez danych osobowych - tylko identyfikatory i stan.
  PERFORM public.emit_domain_event(
    _tenant,
    'event_registration',
    _registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'job_id', v_job_id,
      'state', v_job_state,
      'origin', _origin,
      'review_reason', v_reason),
    _actor);

  -- Rezygnacja uczestnika: organizator dowiaduje sie od razu. Decyzja
  -- organizatora nie dzwoni - jej autor widzial skutek w oknie decyzji.
  IF _origin = 'participant_cancelled' THEN
    IF v_job_state = 'pending' THEN
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot zlecony',
        'Paid ticket cancelled: refund queued',
        format('„%s”: uczestnik zrezygnował w terminie zwrotu, zwrot trafił do operatora płatności. Szczegóły w dzienniku zwrotów.', v_title_pl),
        format('"%s": a participant cancelled within the refund window and the refund went to the payment provider. Details in the refund journal.', v_title_en));
    ELSIF v_job_state = 'needs_review' THEN
      v_why_pl := CASE v_reason
        WHEN 'outside_refund_window' THEN 'po terminie zwrotu'
        WHEN 'refund_disabled' THEN 'wydarzenie nie ma samodzielnych zwrotów'
        WHEN 'shared_payment' THEN 'wpłata obejmuje inne aktywne zgłoszenia'
        WHEN 'manual_payment' THEN 'wpłata poza operatorem płatności'
        ELSE 'zamknięcie bez decyzji o zwrocie'
      END;
      v_why_en := CASE v_reason
        WHEN 'outside_refund_window' THEN 'after the refund deadline'
        WHEN 'refund_disabled' THEN 'the event has no self-service refunds'
        WHEN 'shared_payment' THEN 'the payment covers other active registrations'
        WHEN 'manual_payment' THEN 'paid outside the payment provider'
        ELSE 'closed without a refund decision'
      END;
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot czeka na decyzję',
        'Paid ticket cancelled: refund needs a decision',
        format('„%s”: uczestnik zrezygnował (%s). Zdecyduj o zwrocie w dzienniku zwrotów.', v_title_pl, v_why_pl),
        format('"%s": a participant cancelled (%s). Decide on the refund in the refund journal.', v_title_en, v_why_en));
    END IF;
  END IF;

  RETURN _assessment || jsonb_build_object('job_id', v_job_id, 'job_state', v_job_state,
                                           'review_reason', v_reason);
END $$;
REVOKE ALL ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text) IS
  'REG-03: zapis zlecenia zwrotu po zamknieciu zgloszenia wedlug oceny _event_registration_refund_assess (pending albo needs_review; _waive = cancelled/organizer_waived, tylko organizator). Podnosi needs_review/cancelled z siatki bezpieczenstwa, nie rusza zlecenia w drodze. Emituje event.registration.refund_requested.v1; przy rezygnacji uczestnika dzwoni do organizatorow. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- D1) KOLEJKA ZWROTOW: ODRZUCENIE, SIATKA BEZPIECZENSTWA, ROZLICZENIE --------------
-- Cialo z 20260929113000:75-100. Zmiany (ZMIANA 20261012, REG-03):
--   (2) siatka bezpieczenstwa - KAZDE przejscie oplaconego zgloszenia
--       w zamkniete zostawia co najmniej `needs_review`: kaskada, wplata
--       z webhooka na odwolanym zgloszeniu, reczny UPDATE serwisu. Jawna
--       decyzja (C3) w tej samej transakcji podnosi wpis do swojej;
--   (3) zwrot oznaczony recznie (`refunded`) konczy takze zlecenie bez
--       zamowienia.
CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- (1) Odrzucenie przez organizatora: zwrot automatyczny (bez zmian).
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    INSERT INTO public.event_registration_refund_jobs(tenant_id, event_id, payment_order_id, registration_id)
    SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id FROM public.payment_orders o
    WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
      AND o.metadata->>'event_id' = NEW.event_id::text
      AND o.metadata->>'registration_id' = COALESCE(NEW.group_lead_registration_id, NEW.id)::text
    ON CONFLICT (payment_order_id) DO UPDATE SET state = 'pending', last_error = NULL,
      next_attempt_at = now(), updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled');
  END IF;

  -- ZMIANA 20261012 (REG-03): (2) siatka bezpieczenstwa.
  IF NEW.status IN ('cancelled', 'rejected')
     AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND (OLD.status NOT IN ('cancelled', 'rejected')
          OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    IF NEW.payment_order_id IS NOT NULL THEN
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id, 'needs_review',
             CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
             'closed_without_refund_decision'
        FROM public.payment_orders o
       WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
         AND o.status::text = 'paid'
         AND COALESCE(o.amount_cents, 0) - COALESCE(o.refunded_amount_cents, 0) > 0
      ON CONFLICT (payment_order_id) DO NOTHING;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.plan_ticket_claims c
       WHERE c.registration_id = NEW.id
          OR (NEW.group_lead_registration_id IS NOT NULL
              AND c.registration_id = NEW.group_lead_registration_id)
    ) THEN
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      VALUES (NEW.tenant_id, NEW.event_id, NULL, NEW.id, 'needs_review',
              CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
              'manual_payment')
      ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO NOTHING;
    END IF;
  END IF;

  IF NEW.payment_status = 'refunded' AND NEW.payment_order_id IS NOT NULL THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id;
  END IF;
  -- ZMIANA 20261012 (REG-03): (3) zlecenie bez zamowienia konczy reczne
  -- oznaczenie zwrotu na zgloszeniu.
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id IS NULL AND registration_id = NEW.id AND tenant_id = NEW.tenant_id
      AND state <> 'completed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_rejection_refund_queue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_zz_refund_queue ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_refund_queue AFTER UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_rejection_refund_queue();

COMMENT ON FUNCTION public._event_rejection_refund_queue() IS
  'Kolejka zwrotow (trigger AFTER UPDATE OF status, payment_status): odrzucenie oplaconego -> pending; KAZDE inne przejscie oplaconego zgloszenia w zamkniete -> co najmniej needs_review (closed_without_refund_decision, bez zamowienia: manual_payment) - jawna decyzja w tej samej transakcji podnosi wpis; payment_status refunded konczy zlecenie (po zamowieniu albo, bez zamowienia, po zgloszeniu).';

-- D2) PONOWNE PRZYJECIE: zlecenia reczne tez (cialo z 20260929113000:102-123).
CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    -- ZMIANA 20261012 (REG-03): zlecenie bez zamowienia dopasowujemy po zgloszeniu.
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
    FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
      WHERE j.tenant_id = NEW.tenant_id
        AND (j.payment_order_id = NEW.payment_order_id
             OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
        AND j.state IN ('processing', 'submitted')) THEN
      RAISE EXCEPTION 'invalid_transition: refund already in progress; create a new registration';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET state = 'cancelled', updated_at = now()
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
      AND j.state IN ('pending', 'failed', 'needs_review');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_refund_reapproval ON public.event_registrations;
CREATE TRIGGER event_registrations_refund_reapproval BEFORE UPDATE OF status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_refund_reapproval_guard();

-- D3) DZIERZAWA (cialo z 20260929113000:125-159). ZMIANA 20261012 (REG-03):
-- jawny powod `shared_payment` i pochodzenie zlecenia w odpowiedzi (worker
-- dobiera powod zwrotu u operatora).
CREATE OR REPLACE FUNCTION public._event_registration_refunds_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_jobs jsonb;
BEGIN
  UPDATE public.event_registration_refund_jobs j SET state = 'completed', claim_token = NULL, updated_at = now()
  FROM public.payment_orders o WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
    AND o.status = 'refunded' AND j.state <> 'completed';
  -- Cases needing a partial allocation stay visible in the admin journal.
  UPDATE public.event_registration_refund_jobs j SET state = 'needs_review',
    review_reason = 'shared_payment',
    last_error = 'active_registrations_share_payment', updated_at = now()
  WHERE j.state IN ('pending', 'failed') AND EXISTS (
    SELECT 1 FROM public.event_registrations r WHERE r.payment_order_id = j.payment_order_id
      AND r.tenant_id = j.tenant_id AND r.status NOT IN ('cancelled', 'rejected'));
  WITH picked AS (
    SELECT j.id FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id IS NOT NULL
      AND ((j.state IN ('pending', 'failed') AND j.next_attempt_at <= now() AND j.attempts < 10)
       OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes'))
    ORDER BY j.created_at, j.id LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.event_registration_refund_jobs j SET state = 'processing',
      claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), attempts = attempts + 1, updated_at = now()
    FROM picked p WHERE j.id = p.id RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', j.id, 'claim_token', j.claim_token, 'order_id', o.id, 'tenant_id', j.tenant_id,
    'environment', o.environment, 'provider', o.provider,
    'transaction_id', COALESCE(o.provider_payment_intent_id, o.provider_intent_id, o.provider_session_id),
    'order_status', o.status, 'origin', j.origin)), '[]'::jsonb) INTO v_jobs
  FROM claimed j JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_claim(integer) TO service_role;

-- D4) ROZLICZENIE PROBY (cialo z 20260929113000:161-174). ZMIANA 20261012
-- (REG-03): ostatnia nieudana proba (dzierzawa pomija attempts >= 10) nie
-- milknie - zdarzenie na szynie i dzwonek do organizatorow.
CREATE OR REPLACE FUNCTION public._event_registration_refunds_settle(
  p_job_id uuid, p_claim_token uuid, p_refund_id text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_attempts integer;
  v_tenant uuid;
  v_event_id uuid;
  v_registration_id uuid;
  v_title_pl text;
  v_title_en text;
BEGIN
  UPDATE public.event_registration_refund_jobs SET
    state = CASE WHEN p_error IS NULL AND p_refund_id IS NOT NULL THEN 'submitted' ELSE 'failed' END,
    provider_refund_id = p_refund_id, last_error = left(p_error, 500), claim_token = NULL,
    next_attempt_at = now() + make_interval(mins => LEAST(1440, (power(2, LEAST(attempts, 10)))::integer)), updated_at = now()
  WHERE id = p_job_id AND claim_token = p_claim_token AND state = 'processing'
  RETURNING state, attempts, tenant_id, event_id, registration_id
    INTO v_state, v_attempts, v_tenant, v_event_id, v_registration_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_state = 'failed' AND v_attempts >= 10 THEN
    PERFORM public.emit_domain_event(
      v_tenant, 'event_registration', v_registration_id::text,
      'event.registration.refund_failed.v1',
      jsonb_build_object('event_id', v_event_id, 'job_id', p_job_id),
      NULL);
    SELECT e.title_pl, COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
      INTO v_title_pl, v_title_en
      FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant;
    PERFORM public._event_refund_alert_organizers(
      v_tenant, v_event_id,
      'Automatyczny zwrot nie powiódł się',
      'Automatic refund failed',
      format('„%s”: operator płatności odrzucił zwrot %s razy. Zdecyduj o zwrocie w dzienniku zwrotów.', v_title_pl, v_attempts),
      format('"%s": the payment provider rejected the refund %s times. Decide on the refund in the refund journal.', v_title_en, v_attempts));
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) TO service_role;

-- E1) DZIENNIK ZWROTOW W PANELU (cialo z 20260929113000:176-195). ZMIANA
-- 20261012 (REG-03): pochodzenie, powod przegladu, kwota, termin, notatka
-- decyzji i zgloszenie; `payment_order_id` moze byc NULL (wplata reczna).
CREATE OR REPLACE FUNCTION public.admin_event_refund_jobs(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant(); v_jobs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs FROM (
    SELECT j.id, j.registration_id, j.payment_order_id, j.state, j.attempts, j.created_at,
      j.next_attempt_at, j.last_error, j.origin, j.review_reason, j.amount_cents, j.currency,
      j.refund_deadline_at, j.review_note, j.decided_at,
      concat_ws(' ', p.first_name, p.last_name) AS person_name
    FROM public.event_registration_refund_jobs j
    JOIN public.event_registrations r ON r.id = j.registration_id AND r.tenant_id = j.tenant_id
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE j.tenant_id = v_tenant AND j.event_id = p_event_id
    ORDER BY j.created_at DESC, j.id DESC LIMIT 100
  ) j;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_jobs(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_jobs(uuid) IS
  'Dziennik zwrotow wydarzenia (ostatnie 100): stan, proby, pochodzenie, powod przegladu, kwota, termin, notatka decyzji, osoba. Bez dzierzawy workera (claim_token). Bramka: assert_event_admin_tenant().';

-- E2) DECYZJA ORGANIZATORA O ZLECENIU ----------------------------------------------
--   refund        - zlecenie w przegladzie (albo po ostatecznej porazce) wraca
--                   do kolejki operatora: tylko zamowienie Stripe `paid`,
--                   ktorego nie dzieli zadne aktywne zgloszenie;
--   mark_refunded - pieniadze oddane poza operatorem (wplata reczna albo inny
--                   operator): zgloszenie dostaje `refunded`, trigger konczy
--                   zlecenie;
--   dismiss       - bez zwrotu, z wymagana notatka (>= 3 znaki).
-- Zlecenie blokowane FOR UPDATE w najemcy wolajacego; najemca nigdy z ladunku.
CREATE OR REPLACE FUNCTION public.admin_event_refund_job_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_job public.event_registration_refund_jobs;
  v_order_status text;
  v_order_provider text;
  v_state text;
BEGIN
  v_job_id := CASE
    WHEN COALESCE(p_payload->>'job_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p_payload->>'job_id')::uuid
  END;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: job_id is required';
  END IF;
  IF v_action NOT IN ('refund', 'mark_refunded', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_action: unknown refund decision %', v_action;
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long: at most 2000 characters';
  END IF;

  SELECT j.* INTO v_job
    FROM public.event_registration_refund_jobs j
   WHERE j.id = v_job_id AND j.tenant_id = v_tenant
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'not_found: refund job does not exist in this tenant';
  END IF;
  IF v_job.state NOT IN ('needs_review', 'failed') THEN
    RAISE EXCEPTION 'invalid_transition: refund job % cannot be %', v_job.state, v_action;
  END IF;

  IF v_job.payment_order_id IS NOT NULL THEN
    SELECT o.status::text, o.provider INTO v_order_status, v_order_provider
      FROM public.payment_orders o
     WHERE o.id = v_job.payment_order_id AND o.tenant_id = v_tenant;
  END IF;

  IF v_action = 'refund' THEN
    IF v_job.payment_order_id IS NULL OR v_order_provider IS DISTINCT FROM 'stripe' THEN
      RAISE EXCEPTION 'refund_manual_payment: this payment was taken outside the payment provider';
    END IF;
    IF v_order_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be refunded', COALESCE(v_order_status, 'missing');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant
         AND r.payment_order_id = v_job.payment_order_id
         AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'refund_shared_payment: other active registrations share this payment';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      state = 'pending', review_reason = NULL, attempts = 0, claim_token = NULL,
      last_error = NULL, next_attempt_at = now(), requested_by = v_uid,
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'pending';

  ELSIF v_action = 'mark_refunded' THEN
    IF v_job.payment_order_id IS NOT NULL AND v_order_provider = 'stripe' THEN
      RAISE EXCEPTION 'invalid_transition: a provider payment is refunded through the provider';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    -- Zgloszenie oznaczone jako zwrocone - trigger kolejki konczy zlecenie
    -- (po zamowieniu albo, bez zamowienia, po zgloszeniu).
    UPDATE public.event_registrations r SET
      payment_status = 'refunded',
      paid_at = NULL,
      updated_at = now()
    WHERE r.id = v_job.registration_id AND r.tenant_id = v_tenant
      AND r.payment_status IN ('paid', 'partially_refunded');
    -- Zgloszenie juz bez wplaty (np. oznaczone recznie wczesniej): konczymy
    -- zlecenie wprost.
    UPDATE public.event_registration_refund_jobs j SET state = 'completed', updated_at = now()
    WHERE j.id = v_job.id AND j.state <> 'completed';
    v_state := 'completed';

  ELSE
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a note is required when no refund is made';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      state = 'cancelled', review_reason = 'organizer_waived', claim_token = NULL,
      review_note = v_note, decided_by = v_uid, decided_at = now(), updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'cancelled';
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_job.registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object('event_id', v_job.event_id, 'job_id', v_job.id, 'state', v_state,
                       'origin', v_job.origin, 'decision', v_action),
    v_uid);

  RETURN jsonb_build_object('job_id', v_job.id, 'state', v_state, 'action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_job_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_job_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_job_decide(jsonb) IS
  'REG-03: decyzja organizatora o zleceniu zwrotu w przegladzie (needs_review albo failed): refund (zamowienie Stripe paid bez innych aktywnych zgloszen -> pending), mark_refunded (wplata poza operatorem -> zgloszenie refunded, zlecenie completed), dismiss (bez zwrotu, notatka >= 3 znaki). Najemca z assert_event_admin_tenant(), nigdy z ladunku.';
