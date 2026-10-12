-- ============================================================================
-- KSZTALT ZAMOWIENIA PLATNICZEGO PILNUJE TEZ BAZA (audyt biletow TIX-01, TIX-02).
--
-- TIX-02. `createCheckoutOrder` przyjmowal `kind = one_time` z `plan_id`
-- DOWOLNEGO planu, a `entitlementForOrder` robi z takiego zamowienia dostep
-- DOZYWOTNI (`current_period_end = NULL`). Miesieczny plan za 49 zl kupiony
-- „jednorazowo" dawal subskrypcje bez konca (i co roku bilet z puli planu).
-- Kasa odmawia juz `plan_not_one_time`; ten trigger odmawia tego samego przy
-- zapisie zamowienia przez uzytkownika (RLS - kasa pisze jako on).
--
-- TIX-01. Metadane biletu (`event_id`, `registration_id`) trafialy do
-- zamowienia wycenionego INNA sciezka (plan, artykul). Bilet jest zamowieniem
-- `one_time` bez planu i bez encji, a wskazanie zgloszenia wymaga wskazania
-- biletu i wydarzenia - dokladnie to, co wycenia `priceEventTicket`.
--
-- Rola serwisowa (webhooki, narzedzia) nadal omija walidacje - jak dotad.
--
-- Cialo: 20260730175806; zmiany oznaczone `TIX-01` / `TIX-02`.
-- IDEMPOTENTNA: CREATE OR REPLACE.
-- DOWOD: supabase/tests/event_ticket_payment_binding_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  plan_row public.access_plans%ROWTYPE;
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
    -- TIX-02: zakup jednorazowy planu = dostep dozywotni, wiec wolno go zlozyc
    -- wylacznie na plan jednorazowy. Plan cykliczny idzie subskrypcja.
    IF NEW.kind::text = 'one_time' AND plan_row.interval::text <> 'one_time' THEN
      RAISE EXCEPTION 'plan_not_one_time: a recurring plan cannot be bought as a one-time purchase';
    END IF;
    -- Kwota nie może przewyższać ceny planu w jego walucie. Rabaty (kupony)
    -- obniżają kwotę i pozostają dozwolone; przeliczenie na inną walutę
    -- prezentacji odbywa się poza tym warunkiem.
    IF NEW.currency = upper(plan_row.currency) AND NEW.amount_cents > plan_row.price_cents THEN
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
