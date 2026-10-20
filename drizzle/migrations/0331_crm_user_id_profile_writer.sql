-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 2/8): LEAD Z KONTA - `user_id`, SEGMENT
-- `registered` I CYKL ŻYCIA (P16) + BACKFILL KONT I ETAPÓW.
--
-- DEFEKT
--   1. P16: rejestracja konta zakłada lead (`profile_sync_crm_lead` ->
--      `crm_upsert_lead_from_profile`) z `source_type = 'manual'` - wartość
--      `registered` nadał tylko jednorazowy backfill z 20260722094744, więc
--      lejek „zapis -> konto -> płatność" nie widzi rejestracji, a segment
--      CRM kłamie o pochodzeniu kontaktu.
--   2. Lead nie zna konta: kolumna `crm_leads.user_id` z I0 jest pusta,
--      a resolver ścieżek (S5), test na sobie (`crm_leads.user_id =
--      auth.uid()`) i lejek huba łączą po niej, nie po e-mailu.
--   3. `lifecycle_stage` z I0 ma dla każdego istniejącego leada wartość
--      domyślną `subscriber` - także dla płacących klientów.
--
-- ZMIANA
--   A. `crm_upsert_lead_from_profile(uuid)` - ciało z najnowszej definicji
--      (CIALO-Z niżej) bez zmiany zachowania upsertu, plus po zapisie:
--      `user_id` (tylko gdy pusty; konto powiązane z innym leadem tego
--      najemcy = ślad w `domain_event_emit_errors`, bez wymuszania),
--      `source_type` podniesiony do `registered` WYŁĄCZNIE w górę rangi
--      (`_crm_source_type_rank`: `paid_subscriber` zostaje), cykl życia
--      `registered` przez `crm_set_lifecycle_stage(..., 'system')` (pierwszeństwo:
--      nie cofa klienta ani etapu ustawionego przez człowieka). Część hubowa
--      w bloku z EXCEPTION: awaria nie może zablokować rejestracji konta.
--   B. Backfill `user_id` po `(tenant_id, email_norm)` = `lower(btrim(
--      profiles.email))`. Konflikty (ten sam adres u dwóch kont najemcy albo
--      konto już powiązane z innym leadem) trafiają do
--      `domain_event_emit_errors` ze źródłem `crm_user_id_backfill`
--      i identyfikatorem leada (bez adresu - PII) i NIE są wymuszane.
--   C. Backfill `lifecycle_stage` (źródło `backfill`, historia z wyzwalacza):
--      tylko leady nietknięte (`subscriber` bez `lifecycle_changed_at`):
--        tag `churned`                               -> former_customer
--        tag `customer` albo `paid_subscriber`       -> customer
--        etap `proposal`                             -> opportunity
--        etap `qualified`                            -> sql
--        konto (`user_id`) albo segment `registered` -> registered
--        segment spoza newslettera i ręcznego albo
--        etap `contacted`                            -> lead
--        reszta                                      -> subscriber (bez zmian)
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020130000 (strażnik, źródło `backfill`,
-- `crm_set_lifecycle_stage`). Backfill przechodzi przez gorącą tabelę
-- `crm_leads` - `lock_timeout` 5 s, ponowienie całego pliku przy 55P03.
-- IDEMPOTENTNA: CREATE OR REPLACE, backfille tylko dla wierszy nietkniętych
-- (`user_id IS NULL`, `subscriber` bez znacznika), log konfliktów z NOT EXISTS
-- na wcześniejszym wpisie tego leada.
-- DOWÓD: supabase/tests/crm_user_id_backfill_test.sql (dopasowanie po
-- `(tenant_id, email_norm)`, konflikt zalogowany bez przerwania, `registered`
-- i `user_id` dla nowych kont, ranga `paid_subscriber` nietknięta).
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- A) Pisarz leada z profilu.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260722093022
CREATE OR REPLACE FUNCTION public.crm_upsert_lead_from_profile(_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  p RECORD;
  _phone_norm text;
  _safe_phone text;
  v_tenant uuid;
  v_lead uuid;
  v_prev_trusted text;
BEGIN
  SELECT id, email, tenant_id, first_name, last_name, display_name, phone,
         current_company, current_company_id, job_title, linkedin_url, location
    INTO p
    FROM public.profiles WHERE id = _profile_id;
  IF NOT FOUND OR p.email IS NULL OR length(trim(p.email)) = 0 THEN
    RETURN;
  END IF;
  v_tenant := COALESCE(p.tenant_id, public_tenant_id());

  _phone_norm := NULLIF(regexp_replace(COALESCE(p.phone, ''), '\s+', '', 'g'), '');
  _safe_phone := p.phone;
  IF _phone_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_leads
     WHERE tenant_id = v_tenant
       AND phone_norm = _phone_norm
       AND email_norm <> lower(trim(p.email))
  ) THEN
    _safe_phone := NULL;
  END IF;

  -- Upsert 1:1 z ciała 20260722093022 (wyjątek unikalności telefonu =
  -- druga próba bez telefonu); różnica: oba warianty oddają id leada.
  BEGIN
    INSERT INTO public.crm_leads (
      tenant_id, email, email_norm, first_name, last_name, phone, company, company_id, position, linkedin_url, country,
      stage, marketing_consent, last_activity_at
    ) VALUES (
      v_tenant,
      p.email, lower(trim(p.email)),
      COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
      COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
      _safe_phone, p.current_company, p.current_company_id, p.job_title, p.linkedin_url, p.location,
      'new'::crm_stage, false, now()
    )
    ON CONFLICT (tenant_id, email_norm) DO UPDATE
      SET first_name   = COALESCE(EXCLUDED.first_name, public.crm_leads.first_name),
          last_name    = COALESCE(EXCLUDED.last_name, public.crm_leads.last_name),
          phone        = COALESCE(public.crm_leads.phone, EXCLUDED.phone),
          company      = COALESCE(EXCLUDED.company, public.crm_leads.company),
          company_id   = COALESCE(EXCLUDED.company_id, public.crm_leads.company_id),
          position     = COALESCE(EXCLUDED.position, public.crm_leads.position),
          linkedin_url = COALESCE(EXCLUDED.linkedin_url, public.crm_leads.linkedin_url),
          country      = COALESCE(EXCLUDED.country, public.crm_leads.country),
          updated_at   = now()
    RETURNING id INTO v_lead;
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.crm_leads (
      tenant_id, email, email_norm, first_name, last_name, company, company_id, position, linkedin_url, country,
      stage, marketing_consent, last_activity_at
    ) VALUES (
      v_tenant,
      p.email, lower(trim(p.email)),
      COALESCE(p.first_name, split_part(COALESCE(p.display_name, ''), ' ', 1)),
      COALESCE(p.last_name, NULLIF(split_part(COALESCE(p.display_name, ''), ' ', 2), '')),
      p.current_company, p.current_company_id, p.job_title, p.linkedin_url, p.location,
      'new'::crm_stage, false, now()
    )
    ON CONFLICT (tenant_id, email_norm) DO NOTHING
    RETURNING id INTO v_lead;
  END;

  IF v_lead IS NULL THEN
    SELECT l.id INTO v_lead
      FROM public.crm_leads l
     WHERE l.tenant_id = v_tenant AND l.email_norm = lower(trim(p.email));
  END IF;
  IF v_lead IS NULL THEN
    RETURN;
  END IF;

  -- Część hubowa (P16). Odrębny blok: rejestracja konta (AFTER INSERT na
  -- profiles) nie może paść przez konto powiązane z innym leadem ani przez
  -- odmowę pierwszeństwa - to ślad, nie błąd zapisu.
  BEGIN
    v_prev_trusted := current_setting('app.crm_trusted_writer', true);
    PERFORM set_config('app.crm_trusted_writer', 'on', true);
    BEGIN
      UPDATE public.crm_leads
         SET user_id = _profile_id
       WHERE id = v_lead AND user_id IS NULL;
    EXCEPTION WHEN unique_violation THEN
      PERFORM public._log_emit_error(
        v_tenant, 'crm_upsert_lead_from_profile', 'crm_lead.user_id_conflict', SQLSTATE,
        'konto jest już powiązane z innym leadem najemcy; lead ' || v_lead::text
      );
    END;
    PERFORM set_config('app.crm_trusted_writer', COALESCE(v_prev_trusted, ''), true);

    -- Segment pochodzenia rośnie wyłącznie w górę rangi.
    UPDATE public.crm_leads l
       SET source_type = 'registered'
     WHERE l.id = v_lead
       AND public._crm_source_type_rank(l.source_type) < public._crm_source_type_rank('registered');

    PERFORM public.crm_set_lifecycle_stage(v_lead, 'registered', 'system', false);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.crm_trusted_writer', COALESCE(v_prev_trusted, ''), true);
    PERFORM public._log_emit_error(
      v_tenant, 'crm_upsert_lead_from_profile', 'crm_lead.lifecycle_changed.v1', SQLSTATE, SQLERRM
    );
  END;
END $function$;

-- Granty jak w 20261007140500 (tylko service_role; wyzwalacze i przyjęcie
-- zaproszenia są SECURITY DEFINER, więc dalej ją wołają).
REVOKE ALL ON FUNCTION public.crm_upsert_lead_from_profile(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead_from_profile(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- B + C) Backfill kont i cyklu życia - jeden blok, jedna transakcja.
--
-- Emiter `crm_lead.*` (`trg_crm_leads_emit_events`) jest na czas backfillu
-- WYŁĄCZONY (wzór 20261012121000): `crm_lead.updated.v1` dla każdego leada
-- najemcy zalałby realtime personelu, a router integracji wysłałby partnerom
-- CRM (`forward_stages`) tysiące webhooków o zmianie, której nie było -
-- konto i etap odtwarzamy, a nie zmieniamy. Wyłączenie jest transakcyjne
-- (inne sesje go nie widzą, błąd wycofuje je razem z backfillem). Historia
-- etapów zostaje (wyzwalacz S4 zapisuje ją ze źródłem `backfill` i dla tego
-- źródła nie emituje zdarzenia).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_emitter boolean := EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.crm_leads'::regclass
       AND tgname = 'trg_crm_leads_emit_events'
       AND NOT tgisinternal
  );
BEGIN
  IF v_emitter THEN
    EXECUTE 'ALTER TABLE public.crm_leads DISABLE TRIGGER trg_crm_leads_emit_events';
  END IF;

  -- B1. Konflikty: dwa konta najemcy z adresem leada albo konto, które ma
  -- już innego leada (indeks unikalny i tak by je odrzucił). Ślad bez adresu
  -- (PII) - z identyfikatorem leada; jeden wpis na lead (powtórka nie dubluje).
  FOR r IN
    WITH cand AS (
      SELECT l.id AS lead_id, l.tenant_id, p.id AS user_id,
             count(*) OVER (PARTITION BY l.id) AS profiles_per_lead
        FROM public.crm_leads l
        JOIN public.profiles p
          ON p.tenant_id = l.tenant_id
         AND p.email IS NOT NULL
         AND lower(btrim(p.email)) = l.email_norm
       WHERE l.user_id IS NULL
    )
    SELECT DISTINCT c.lead_id, c.tenant_id,
           CASE WHEN c.profiles_per_lead > 1 THEN 'wiele kont z adresem leada'
                ELSE 'konto powiązane z innym leadem' END AS reason
      FROM cand c
     WHERE c.profiles_per_lead > 1
        OR EXISTS (
          SELECT 1 FROM public.crm_leads o
           WHERE o.tenant_id = c.tenant_id AND o.user_id = c.user_id AND o.id <> c.lead_id
        )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.domain_event_emit_errors e
       WHERE e.source = 'crm_user_id_backfill' AND e.tenant_id = r.tenant_id
         AND e.error LIKE '%' || r.lead_id::text || '%'
    ) THEN
      PERFORM public._log_emit_error(
        r.tenant_id, 'crm_user_id_backfill', 'crm_lead.user_id_conflict', '23505',
        r.reason || '; lead ' || r.lead_id::text
      );
    END IF;
  END LOOP;

  -- B2. Przypisanie jednoznaczne (email_norm jest unikalny w najemcy, więc
  -- konto bez konfliktu pasuje do dokładnie jednego leada).
  UPDATE public.crm_leads l
     SET user_id = c.user_id
    FROM (
      SELECT l2.id AS lead_id, min(p.id::text)::uuid AS user_id
        FROM public.crm_leads l2
        JOIN public.profiles p
          ON p.tenant_id = l2.tenant_id
         AND p.email IS NOT NULL
         AND lower(btrim(p.email)) = l2.email_norm
       WHERE l2.user_id IS NULL
       GROUP BY l2.id
      HAVING count(*) = 1
    ) c
   WHERE l.id = c.lead_id
     AND l.user_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.crm_leads o
        WHERE o.tenant_id = l.tenant_id AND o.user_id = c.user_id AND o.id <> l.id
     );

  -- B3. Konto = co najmniej segment `registered` (wyłącznie w górę rangi).
  UPDATE public.crm_leads l
     SET source_type = 'registered'
   WHERE l.user_id IS NOT NULL
     AND public._crm_source_type_rank(l.source_type) < public._crm_source_type_rank('registered');

  -- C. Cykl życia. Źródło `backfill` przepuszcza etapy klienta przez
  -- strażnika i trafia do historii (etap odtworzony, nie zmieniony dziś).
  PERFORM set_config('app.change_source', 'backfill', true);
  UPDATE public.crm_leads l
     SET lifecycle_stage = CASE
           WHEN 'churned' = ANY (l.tags) THEN 'former_customer'
           WHEN 'customer' = ANY (l.tags) OR l.source_type = 'paid_subscriber' THEN 'customer'
           WHEN l.stage = 'proposal' THEN 'opportunity'
           WHEN l.stage = 'qualified' THEN 'sql'
           WHEN l.user_id IS NOT NULL OR l.source_type = 'registered' THEN 'registered'
           WHEN l.source_type NOT IN ('newsletter', 'manual') OR l.stage = 'contacted' THEN 'lead'
           ELSE l.lifecycle_stage
         END
   WHERE l.lifecycle_stage = 'subscriber'
     AND l.lifecycle_changed_at IS NULL
     AND (
       'churned' = ANY (l.tags)
       OR 'customer' = ANY (l.tags)
       OR l.source_type NOT IN ('newsletter', 'manual')
       OR l.stage IN ('proposal', 'qualified', 'contacted')
       OR l.user_id IS NOT NULL
     );
  PERFORM set_config('app.change_source', '', true);

  IF v_emitter THEN
    EXECUTE 'ALTER TABLE public.crm_leads ENABLE TRIGGER trg_crm_leads_emit_events';
  END IF;
END $$;

RESET lock_timeout;
