-- events-harness: include
-- ============================================================================
-- PRZEGLAD DOWIAZAN: PODEJRZENIE PRZEJECIA Z PODMIANA ADRESU (SYGNAL DO
-- DECYZJI ORGANIZATORA) I LIMIT LISTY PO RYZYKU
-- (PRZEGLAD R12: USTALENIE 3 I UWAGA O LIMICIE; REG-01, decyzja D14).
--
-- DEFEKT
--   1. (20261012120100:129-143, naprawa 20261012190000) Przejecie z audytu
--      REG-01 mialo drugi krok: napastnik T dowiazany do kartoteki ofiary
--      przestawial jej adres starym edytorem profilu (dowolny adres) na
--      SWOJ potwierdzony adres - zeby bilety szly do niego. Po tym kroku
--      dowiazanie spelnia D1 (T ma potwierdzony OBECNY adres osoby), audyt
--      zwraca 0 wierszy, naprawa historii go nie rusza, a T zachowuje
--      historie zgloszen ofiary, telefon, platnosci i rezygnacje
--      (powtorzone: review/R12-identity-consents/p2_identity.sql, czesc A).
--      Baza nie zapisywala, KIEDY zmienil sie adres osoby, wiec regula nie
--      odrozni tego od goscia, ktory pozniej zalozyl konto.
--   2. (20261012120100:287-289) `admin_event_people_account_bindings` bral
--      200 wierszy audytu po `person_id`, a dopiero potem sortowal po ryzyku -
--      przy ponad 200 niezweryfikowanych dowiazaniach `foreign_record`
--      (podpis przejecia) mogl wypasc z ekranu.
--
-- ZMIANA 20261012 (R12)
--   A. `event_people_account_binding_review(p_tenant DEFAULT NULL)`
--      (service_role) - WYLACZNIE SYGNAL DO PRZEGLADU, bez automatycznego
--      odwiazania: dowiazania SPELNIAJACE D1 na kartotece zalozonej przez
--      kogos innego niz konto (`created_by IS DISTINCT FROM user_id`), gdy:
--        * `mails_elsewhere` - `email_send_log` ma maile dla zgloszen tej
--          osoby (klucz idempotencji `event-...:<id zgloszenia>`) wyslane na
--          adres INNY niz obecny adres kartoteki - adres osoby zmienil sie po
--          wysylce (podpis podmiany);
--        * `registrations_by_others` - zgloszenia osoby zalozyl INNE konto,
--          ktore nie jest personelem najemcy (admin/editor/super_admin) i nie
--          jest liderem grupy (`group_lead_registration_id`). Zgloszenia goscia
--          (`created_by` NULL) sie nie licza: gosc, ktory potem zalozyl konto,
--          to typowa, uczciwa sciezka.
--      Bez wierszy przywroconych przez organizatora dla tego samego stanu
--      (atest jak w audycie). Ryzyko: `suspect_takeover`.
--   B. `admin_event_people_account_bindings` - nowy klucz `suspect` (lista
--      przegladu, najwyzej 200, najmocniejszy sygnal najpierw); `unverified`
--      bierze 200 wierszy PO uporzadkowaniu wedlug ryzyka (foreign_record
--      najpierw), nie po `person_id`.
--   C. `admin_event_person_account_unbind` - odwiazanie osoby z listy
--      przegladu zapisuje w dzienniku ryzyko `suspect_takeover`.
--   Audyt (`event_people_account_binding_audit`) i naprawa historii BEZ
--   zmian: kryterium REG-01 (0 wierszy) dotyczy D1; przeglad jest osobna
--   kategoria, liczona w runbooku obok audytu (20261012190100).
--
-- CZEGO TO NIE ZAMYKA (REZYDUUM, swiadomie): podmiana sprzed wdrozenia, po
--   ktorej nie zostal mail w `email_send_log` (retencja, wysylka spoza
--   dziennika) i nie ma zgloszenia innego konta, jest nie do odroznienia od
--   uczciwego dowiazania - nie pojawi sie na liscie. Sygnal moze tez
--   wskazac uczciwa zmiane adresu (literowka poprawiona przez wlasciciela):
--   decyzje podejmuje organizator, stad brak automatycznego odwiazania.
-- KOLEJNOSC WDROZENIA: po 20261012180600 (klasa `suspect_takeover` w CHECK).
--   Wzgledem kodu dowolna: stary ekran ignoruje klucz `suspect`, nowy ekran
--   na starej bazie pokazuje pusta liste przegladu.
-- IDEMPOTENTNA: CREATE OR REPLACE, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_identity_consents_r12_test.sql (przejecie
--   z podmiana adresu na liscie przegladu, nie w audycie; gosc, ktory
--   zalozyl konto - nie; LIMIT po ryzyku),
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- A) PRZEGLAD: PODEJRZENIE PRZEJECIA --------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_people_account_binding_review(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (
  tenant_id uuid,
  person_id uuid,
  user_id uuid,
  email_norm text,
  account_email_norm text,
  risk text,
  registrations_by_others bigint,
  mails_elsewhere bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH bound AS (
    SELECT p.tenant_id, p.id, p.user_id, p.email_norm
      FROM public.event_people p
     WHERE p.user_id IS NOT NULL
       AND (p_tenant IS NULL OR p.tenant_id = p_tenant)
       AND p.created_by IS DISTINCT FROM p.user_id
       AND public._event_uid_owns_email(p.user_id, p.email_norm)
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_person_account_unbinds b
          WHERE b.tenant_id = p.tenant_id
            AND b.person_id = p.id
            AND b.user_id = p.user_id
            AND b.restored_at IS NOT NULL
            AND b.restored_email_norm IS NOT DISTINCT FROM p.email_norm
       )
  ), regs AS (
    SELECT bo.tenant_id, bo.id AS person_id, count(*) AS n
      FROM bound bo
      JOIN public.event_registrations r
        ON r.tenant_id = bo.tenant_id AND r.person_id = bo.id
     WHERE r.created_by IS NOT NULL
       AND r.created_by <> bo.user_id
       AND r.group_lead_registration_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.user_roles ur
          WHERE ur.user_id = r.created_by
            AND ur.tenant_id = r.tenant_id
            AND ur.role IN ('admin', 'editor', 'super_admin')
       )
     GROUP BY bo.tenant_id, bo.id
  ), mail AS (
    -- Klucze idempotencji poczty uczestnika: `event-<rodzaj>:<id zgloszenia>...`
    -- (registrationSelfNotify, registrationOutcomeNotify, eventRegistration).
    SELECT bo.tenant_id, bo.id AS person_id, count(*) AS n
      FROM public.email_send_log l
      JOIN public.event_registrations r
        ON r.tenant_id = l.tenant_id
       AND r.id::text = substring(l.metadata->>'idempotency_key'
                                  from '^event-[a-z-]+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')
      JOIN bound bo
        ON bo.tenant_id = r.tenant_id AND bo.id = r.person_id
     WHERE (p_tenant IS NULL OR l.tenant_id = p_tenant)
       AND l.metadata->>'idempotency_key' LIKE 'event-%'
       AND NULLIF(lower(btrim(l.recipient_email)), '') IS DISTINCT FROM bo.email_norm
     GROUP BY bo.tenant_id, bo.id
  )
  SELECT bo.tenant_id,
         bo.id,
         bo.user_id,
         bo.email_norm,
         NULLIF(lower(btrim(COALESCE(u.email, ''))), ''),
         'suspect_takeover'::text,
         COALESCE(rg.n, 0),
         COALESCE(ml.n, 0)
    FROM bound bo
    LEFT JOIN auth.users u ON u.id = bo.user_id
    LEFT JOIN regs rg ON rg.tenant_id = bo.tenant_id AND rg.person_id = bo.id
    LEFT JOIN mail ml ON ml.tenant_id = bo.tenant_id AND ml.person_id = bo.id
   WHERE COALESCE(rg.n, 0) > 0 OR COALESCE(ml.n, 0) > 0;
$$;
REVOKE ALL ON FUNCTION public.event_people_account_binding_review(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_people_account_binding_review(uuid) TO service_role;

COMMENT ON FUNCTION public.event_people_account_binding_review(uuid) IS
  'R12 (REG-01, D14): SYGNAL DO PRZEGLADU, bez odwiazania - dowiazania spelniajace D1 na kartotece zalozonej przez kogos innego niz konto, gdy mail zgloszenia osoby poszedl na adres inny niz obecny (mails_elsewhere) albo zgloszenia osoby zalozylo inne konto spoza personelu i nie lider grupy (registrations_by_others). Ryzyko suspect_takeover. Bez przywroconych przez administratora dla tego stanu. p_tenant NULL = wszyscy najemcy. Tylko service_role.';

-- B) EKRAN ORGANIZATORA --------------------------------------------------------------
-- Cialo z 20261012120100:259-321; zmiany oznaczone.
CREATE OR REPLACE FUNCTION public.admin_event_people_account_bindings(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_unverified jsonb;
  v_suspect jsonb;
  v_unbinds jsonb;
BEGIN
  -- ZMIANA 20261012 (R12): LIMIT PO uporzadkowaniu wedlug ryzyka - przy
  -- ponad 200 niezweryfikowanych dowiazaniach `foreign_record` (podpis
  -- przejecia) nie moze wypasc z ekranu przez kolejnosc `person_id`.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'person_id', a.person_id,
           'first_name', a.first_name,
           'last_name', a.last_name,
           'email', a.email,
           'account_email_hint', public._event_email_hint(a.account_email_norm),
           'account_email_confirmed', a.account_email_confirmed,
           'risk', a.risk,
           'registrations_by_account', a.registrations_by_account,
           'created_at', a.created_at
         ) ORDER BY a.risk_rank, a.last_name, a.first_name, a.person_id), '[]'::jsonb)
    INTO v_unverified
    FROM (
      SELECT x.person_id, x.account_email_norm, x.account_email_confirmed, x.risk,
             x.registrations_by_account, p.first_name, p.last_name, p.email, p.created_at,
             CASE x.risk WHEN 'foreign_record' THEN 0 WHEN 'no_email' THEN 1
                         WHEN 'account_unconfirmed' THEN 2 WHEN 'admin_provisioned' THEN 3
                         ELSE 4 END AS risk_rank
        FROM public.event_people_account_binding_audit(v_tenant) x
        JOIN public.event_people p ON p.tenant_id = x.tenant_id AND p.id = x.person_id
       ORDER BY risk_rank, p.last_name, p.first_name, x.person_id
       LIMIT 200
    ) a;

  -- ZMIANA 20261012 (R12): lista PRZEGLADU - dowiazania spelniajace D1
  -- z sygnalem przejecia (podmiana adresu). Bez automatu: decyzja
  -- organizatora (odwiaz albo zostaw).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'person_id', s.person_id,
           'first_name', s.first_name,
           'last_name', s.last_name,
           'email', s.email,
           'account_email_hint', public._event_email_hint(s.account_email_norm),
           'risk', s.risk,
           'registrations_by_others', s.registrations_by_others,
           'mails_elsewhere', s.mails_elsewhere,
           'created_at', s.created_at
         ) ORDER BY s.mails_elsewhere DESC, s.registrations_by_others DESC,
                    s.last_name, s.first_name, s.person_id), '[]'::jsonb)
    INTO v_suspect
    FROM (
      SELECT x.person_id, x.account_email_norm, x.risk, x.registrations_by_others,
             x.mails_elsewhere, p.first_name, p.last_name, p.email, p.created_at
        FROM public.event_people_account_binding_review(v_tenant) x
        JOIN public.event_people p ON p.tenant_id = x.tenant_id AND p.id = x.person_id
       ORDER BY x.mails_elsewhere DESC, x.registrations_by_others DESC,
                p.last_name, p.first_name, x.person_id
       LIMIT 200
    ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'person_id', b.person_id,
           'first_name', p.first_name,
           'last_name', p.last_name,
           'email', p.email,
           'account_email_hint', public._event_email_hint(b.account_email_norm),
           'risk', b.risk,
           'reason', b.reason,
           'registrations_by_account', b.registrations_by_account,
           'unbound_at', b.unbound_at,
           'restored_at', b.restored_at,
           'account_deleted', (b.user_id IS NULL),
           'person_bound', (p.user_id IS NOT NULL)
         ) ORDER BY b.unbound_at DESC, b.id), '[]'::jsonb)
    INTO v_unbinds
    FROM (
      SELECT x.* FROM public.event_person_account_unbinds x
       WHERE x.tenant_id = v_tenant
       ORDER BY x.unbound_at DESC, x.id
       LIMIT 200
    ) b
    JOIN public.event_people p ON p.tenant_id = b.tenant_id AND p.id = b.person_id;

  RETURN jsonb_build_object('unverified', v_unverified, 'suspect', v_suspect, 'unbinds', v_unbinds);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_people_account_bindings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_people_account_bindings(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_people_account_bindings(jsonb) IS
  'REG-01 (D14), ekran organizatora: niezweryfikowane dowiazania kont najemcy (audyt; 200 wierszy PO uporzadkowaniu wedlug ryzyka, foreign_record najpierw), lista przegladu suspect (R12: dowiazania spelniajace D1 z sygnalem przejecia - mails_elsewhere, registrations_by_others; najwyzej 200) i dziennik odwiazan (najnowsze 200). Imie, nazwisko, adres osoby, zamaskowany adres konta. Najemca z assert_event_admin_tenant() (admin albo super_admin), nigdy z ladunku.';

-- C) ODWIAZANIE PRZEZ ORGANIZATORA ---------------------------------------------------
-- Cialo z 20261012120100:326-380; zmiana oznaczona.
CREATE OR REPLACE FUNCTION public.admin_event_person_account_unbind(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_person_id uuid;
  v_person public.event_people;
  v_account_email text;
  v_unbind_id uuid;
  v_risk text;
BEGIN
  IF p_payload IS NULL OR COALESCE(p_payload->>'person_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'invalid_payload: person_id is required';
  END IF;
  v_person_id := (p_payload->>'person_id')::uuid;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.id = v_person_id
   FOR UPDATE;
  IF v_person.id IS NULL THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.user_id IS NULL THEN
    RAISE EXCEPTION 'not_bound: this person is not linked to an account';
  END IF;

  -- ZMIANA 20261012 (R12): osoba z listy przegladu (sygnal przejecia) trafia
  -- do dziennika jako `suspect_takeover` - organizator widzi pozniej, ze to
  -- odwiazanie z podejrzenia, a nie z niezgodnosci z D1.
  IF EXISTS (
    SELECT 1 FROM public.event_people_account_binding_review(v_tenant) x
     WHERE x.person_id = v_person.id AND x.user_id = v_person.user_id
  ) THEN
    v_risk := 'suspect_takeover';
  ELSE
    v_risk := public._event_person_account_risk(v_person.user_id, v_person.email_norm, v_person.created_by);
  END IF;
  SELECT NULLIF(lower(btrim(COALESCE(u.email, ''))), '') INTO v_account_email
    FROM auth.users u WHERE u.id = v_person.user_id;

  INSERT INTO public.event_person_account_unbinds (
    tenant_id, person_id, user_id, email_norm, account_email_norm, risk, reason,
    registrations_by_account, unbound_by
  ) VALUES (
    v_tenant, v_person.id, v_person.user_id, v_person.email_norm, v_account_email, v_risk,
    'admin_unbind',
    (SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.person_id = v_person.id
        AND r.created_by = v_person.user_id),
    auth.uid()
  )
  RETURNING id INTO v_unbind_id;

  UPDATE public.event_people p
     SET user_id = NULL
   WHERE p.tenant_id = v_tenant AND p.id = v_person.id;

  RETURN jsonb_build_object('ok', true, 'person_id', v_person.id, 'unbind_id', v_unbind_id,
                            'risk', v_risk);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_person_account_unbind(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_person_account_unbind(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_person_account_unbind(jsonb) IS
  'REG-01 (D14): administrator odwiazuje konto od osoby wydarzen najemcy ({person_id}); wpis w event_person_account_unbinds (admin_unbind, ryzyko; osoba z listy przegladu R12 - suspect_takeover). not_bound gdy osoba nie ma konta. Najemca z assert_event_admin_tenant().';
