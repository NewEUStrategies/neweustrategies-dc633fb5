-- ============================================================================
-- CENNIK v6.2 (5/5): STRAŻNIK ZAMÓWIEŃ - PLAN POZA SPRZEDAŻĄ
--
-- Drugi zamek decyzji 3 (Partner Biznesowy wycofany ze sprzedaży) i 5
-- (Decision Lab wyłącznie na zapytanie - dotąd dało się go kupić, wchodząc
-- bezpośrednio na /checkout/<id>), a także Zespołu sprzedawanego przez
-- rozmowę (v6.2: 3-20 miejsc - kasa nie zna liczby miejsc). Pierwszym zamkiem jest kasa w TS
-- (`planPurchaseRefusal`, oba silniki), która odmawia PRZED kuponem
-- i zamówieniem; ten warunek łapie każde wstawienie zamówienia z konta
-- użytkownika, które ominęłoby serwer aplikacji (np. PostgREST wprost).
-- Rola serwisowa omija strażnika jak dotąd - narzędzia admina i webhooki.
--
-- Ciało: 20261013100400_payment_orders_per_seat_plan_amount (TIX-01, TIX-02,
-- PAY-01 bez zmian) + jedna gałąź `for_sale` tuż po kontroli `active`.
-- Migracja niesie CAŁE ciało, bo CREATE OR REPLACE zastępuje funkcję w całości
-- - inaczej cofnęłaby kontrole TIX i PAY-01. search_path z `pg_temp` na końcu
-- (reguła repo dla SECURITY DEFINER).
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWÓD: supabase/tests/payment_orders_for_sale_guard_test.sql,
--        supabase/tests/payment_orders_per_seat_amount_test.sql,
--        supabase/tests/event_ticket_payment_binding_test.sql.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  plan_row public.access_plans%ROWTYPE;
  plan_cap bigint;
  v_meta jsonb;
BEGIN
  -- Service role (webhooki, narzędzia serwerowe) omija walidację.
  IF current_setting('role', true) = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Wymuszenie bezpiecznego stanu początkowego dla zamówień użytkownika.
  NEW.status := 'pending';
  NEW.provider_session_id := NULL;
  NEW.provider_intent_id := NULL;
  NEW.invoice_url := NULL;
  NEW.paid_at := NULL;

  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payment_orders.user_id must match auth.uid()';
  END IF;

  -- Waluta: kod ISO 4217, znormalizowany do wielkich liter.
  NEW.currency := upper(coalesce(NEW.currency, ''));
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'payment_orders.currency must be a 3-letter ISO code';
  END IF;

  -- Kwota: nieujemna i w rozsądnym zakresie (ochrona przed śmieciowymi rekordami).
  IF NEW.amount_cents IS NULL OR NEW.amount_cents < 0 OR NEW.amount_cents > 100000000 THEN
    RAISE EXCEPTION 'payment_orders.amount_cents out of allowed range';
  END IF;

  -- Plan musi należeć do tenanta wywołującego i być aktywny.
  IF NEW.plan_id IS NOT NULL THEN
    SELECT * INTO plan_row
      FROM public.access_plans
     WHERE id = NEW.plan_id
       AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_orders.plan_id does not belong to this tenant';
    END IF;
    IF NOT plan_row.active THEN
      RAISE EXCEPTION 'payment_orders.plan_id refers to an inactive plan';
    END IF;
    -- v6.2: plan wycofany ze sprzedaży (Partner Biznesowy) albo sprzedawany
    -- wyłącznie przez rozmowę (Decision Lab, Zespół) nie przyjmuje NOWEGO zamówienia
    -- z konta użytkownika. Odnowienia trwających subskrypcji nie zakładają
    -- `payment_orders`, więc obecni klienci tego warunku nie dotykają.
    IF NOT plan_row.for_sale THEN
      RAISE EXCEPTION 'plan_not_for_sale: this plan is not open for self-serve purchase';
    END IF;
    -- TIX-02: zakup jednorazowy planu = dostep dozywotni, wiec wolno go zlozyc
    -- wylacznie na plan jednorazowy. Plan cykliczny idzie subskrypcja.
    IF NEW.kind::text = 'one_time' AND plan_row.interval::text <> 'one_time' THEN
      RAISE EXCEPTION 'plan_not_one_time: a recurring plan cannot be bought as a one-time purchase';
    END IF;
    -- PAY-01: kierunek odwrotny - plan jednorazowy nie zakłada subskrypcji.
    IF NEW.kind::text = 'subscription' AND plan_row.interval::text = 'one_time' THEN
      RAISE EXCEPTION 'kind_mismatch: a one-time plan cannot be bought as a subscription';
    END IF;
    -- Kwota nie może przewyższać ceny planu w jego walucie - dla planu za
    -- miejsce ceny 100 miejsc (PAY-01, patrz nagłówek). Rabaty (kupony)
    -- obniżają kwotę i pozostają dozwolone; przeliczenie na inną walutę
    -- prezentacji odbywa się poza tym warunkiem.
    plan_cap := plan_row.price_cents::bigint
      * CASE WHEN plan_row.tier_key = 'team' THEN 100 ELSE 1 END;
    IF NEW.currency = upper(plan_row.currency) AND NEW.amount_cents > plan_cap THEN
      RAISE EXCEPTION 'payment_orders.amount_cents exceeds plan price';
    END IF;
  END IF;

  -- Spójność referencji do encji (bilet/wydarzenie itp.).
  IF NEW.entity_id IS NOT NULL AND NEW.entity_type IS NULL THEN
    RAISE EXCEPTION 'payment_orders.entity_type is required when entity_id is set';
  END IF;

  -- TIX-01: metadane biletu wylacznie na zamowieniu biletowym.
  v_meta := COALESCE(NEW.metadata, '{}'::jsonb);
  IF (v_meta ? 'event_id' OR v_meta ? 'registration_id' OR v_meta ? 'ticket_type_id')
     AND (NEW.kind::text <> 'one_time' OR NEW.plan_id IS NOT NULL OR NEW.entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ticket_order_conflict: ticket metadata on a plan or content order';
  END IF;
  IF v_meta ? 'registration_id' AND NOT (v_meta ? 'ticket_type_id' AND v_meta ? 'event_id') THEN
    RAISE EXCEPTION 'ticket_order_conflict: a registration is paid only with its ticket and event';
  END IF;

  RETURN NEW;
END;
$function$;

-- Funkcja wyzwalacza: wykonuje ją silnik przy INSERT, nie wołający - nikt nie
-- potrzebuje do niej prawa EXECUTE wprost.
REVOKE EXECUTE ON FUNCTION public.payment_orders_secure_insert() FROM PUBLIC, anon, authenticated;
