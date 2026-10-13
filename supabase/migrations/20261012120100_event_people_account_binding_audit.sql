-- events-harness: include
-- ============================================================================
-- KARTOTEKA UCZESTNIKA WYDARZEN (B2, CZESC 2): AUDYT DOWIAZAN KONT, DZIENNIK
-- ODWIAZAN I NARZEDZIA ORGANIZATORA (REG-01, decyzja D14).
--
-- DEFEKT. Do 20261012 kazdy zapis wiazal konto wolajacego z osoba o adresie
-- z ladunku (`event_register` 20261007140400:507-516, :535), a profil
-- uczestnika pozwalal przestawic adres kartoteki na cudzy (20260828140004:127,
-- 20260828105751:494). Poprawki pisarzy (20261012120000, 20261012140000,
-- seria B3) zamykaja nowe przejecia, ale dowiazania zrobione wczesniej
-- zostaja: konto napastnika dalej widzi „Moje zgloszenia", panel, platnosci
-- i rezygnacje ofiary (wlasnosc to wszedzie `user_id = auth.uid()`).
-- Nie ma tez sladu, KIEDY `user_id` zostal zapisany - przejecia nie da sie
-- odroznic od dowiazania wlasciciela inaczej niz regula D1.
--
-- ZMIANA
--   A. `event_person_account_unbinds` - dziennik kazdego odwiazania (naprawa
--      historii i administrator) z ryzykiem, liczba zgloszen zalozonych przez
--      konto i przywroceniem. RLS bez polityk (deny-all), tylko service_role;
--      organizator czyta go wylacznie przez RPC z bramka administratora.
--   B. `_event_person_account_risk(konto, adres, tworca)` - JEDNA klasyfikacja
--      dowiazania: verified (D1 spelnione), no_email, foreign_record (osobe
--      zalozyl ktos inny niz dowiazane konto - podpis przejecia),
--      account_unconfirmed, self_created (konto samo zalozylo osobe na adres,
--      ktorego nie potwierdzilo - adres sluzbowy albo zawlaszczenie).
--   C. `event_people_account_binding_audit(p_tenant DEFAULT NULL)` (service_role) -
--      kazde dowiazanie niespelniajace D1, bez jawnie przywroconych przez
--      administratora (atest na adres osoby z chwili przywrocenia).
--      Kryterium ukonczenia REG-01: po naprawie historii 0 wierszy.
--   D. `_event_people_unbind_unverified(p_reason)` - odwiazuje kazdy wiersz
--      audytu i zapisuje go w dzienniku. Wola ja migracja 20261012190000 -
--      PO wszystkich poprawkach pisarzy.
--   E. Ekran organizatora: `admin_event_people_account_bindings`
--      (niezweryfikowane dowiazania + dziennik), `admin_event_person_account_unbind`
--      i `admin_event_person_account_restore` (jawny, logowany wyjatek od D1).
--      Najemca WYLACZNIE z `assert_event_admin_tenant()`, nigdy z ladunku.
--
-- CZEGO TO NIE ZAMYKA
--   * Naprawa jest scisla: odwiazuje takze dowiazania prawdziwych wlascicieli,
--     ktorzy zapisali sie adresem innym niz adres konta albo nie potwierdzili
--     konta. Odzyskuja panel przez `event_my_account_link` (adres konta =
--     adres osoby), ponowny zapis albo przywrocenie przez organizatora; klucz
--     samoobslugi z maila i wlasnosc platnosci po `created_by` dzialaja dalej.
--   * Odwiazanie przez administratora dowiazania SPELNIAJACEGO D1 nie jest
--     trwale: wlasciciel adresu dowiaze sie znow zapisem albo
--     `event_my_account_link`. Ekran sluzy do dowiazan niezweryfikowanych.
--   * Powiadomienie osob, ktorych kartoteke przejeto (RODO art. 33/34), to
--     decyzja inspektora ochrony danych - dziennik daje liste i ryzyko.
--
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu (ekran organizatora jest nowy,
-- przy 42883/PGRST202 pokazuje blad ladowania). Samo odwiazanie historii to
-- osobna migracja 20261012190000. Przed wdrozeniem: liczby z
-- `SELECT tenant_id, risk, count(*) FROM event_people_account_binding_audit()
-- GROUP BY 1, 2` na produkcji (raport REG, runbook).
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE,
-- bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_people_account_binding_test.sql,
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- A) DZIENNIK ODWIAZAN -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_person_account_unbinds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  -- Konto, ktore bylo dowiazane. SET NULL przy usunieciu konta: dziennik
  -- zostaje (dowod naprawy), a przywrocenie odmawia `account_deleted`.
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Adres osoby i adres konta w chwili odwiazania - podstawa decyzji
  -- organizatora o przywroceniu (adres konta pokazywany wylacznie zamaskowany).
  email_norm text,
  account_email_norm text,
  risk text NOT NULL,
  reason text NOT NULL,
  registrations_by_account integer NOT NULL DEFAULT 0,
  unbound_at timestamptz NOT NULL DEFAULT now(),
  unbound_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Adres osoby, ktory administrator widzial, przywracajac dowiazanie. Atest
  -- dotyczy TEGO stanu: zmiana adresu osoby po przywroceniu wraca do audytu.
  restored_email_norm text,
  CONSTRAINT event_person_account_unbinds_risk_values CHECK (risk IN (
    'verified', 'no_email', 'foreign_record', 'account_unconfirmed', 'self_created'
  )),
  CONSTRAINT event_person_account_unbinds_reason_values CHECK (reason IN (
    'reg01_remediation', 'admin_unbind'
  )),
  -- Naprawa historii odwiazuje wylacznie dowiazania niespelniajace D1.
  CONSTRAINT event_person_account_unbinds_remediation_unverified
    CHECK (reason <> 'reg01_remediation' OR risk <> 'verified'),
  CONSTRAINT event_person_account_unbinds_registrations_nonneg
    CHECK (registrations_by_account >= 0),
  CONSTRAINT event_person_account_unbinds_restored_stamp
    CHECK ((restored_by IS NULL OR restored_at IS NOT NULL)
           AND (restored_email_norm IS NULL OR restored_at IS NOT NULL)),
  CONSTRAINT event_person_account_unbinds_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_person_account_unbinds_person_fkey
    FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS event_person_account_unbinds_tenant_idx
  ON public.event_person_account_unbinds (tenant_id, unbound_at DESC, id);
CREATE INDEX IF NOT EXISTS event_person_account_unbinds_person_idx
  ON public.event_person_account_unbinds (tenant_id, person_id, unbound_at DESC);

ALTER TABLE public.event_person_account_unbinds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_person_account_unbinds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.event_person_account_unbinds TO service_role;

COMMENT ON TABLE public.event_person_account_unbinds IS
  'REG-01 (D14): dziennik odwiazan kont od osob wydarzen - naprawa historii (reg01_remediation) i administrator (admin_unbind), z ryzykiem, adresami z chwili odwiazania i przywroceniem (restored_*; atest administratora wylacza wiersz z audytu). RLS bez polityk, tylko service_role; organizator przez admin_event_people_account_bindings / _unbind / _restore.';

-- B) KLASYFIKACJA DOWIAZANIA -----------------------------------------------------------
-- Kolejnosc galezi jest czescia reguly:
--   * verified - konto ma potwierdzony adres osoby (D1). Jedyny stan poprawny;
--   * no_email - osoba nie ma adresu (wyczyszczony po dowiazaniu): nic nie
--     potwierdza wlasnosci;
--   * foreign_record - osobe zalozyl KTOS INNY niz dowiazane konto (gosc,
--     organizator, import, lider grupy, wspolprelegent), a konto doszlo
--     pozniej: dokladnie tak wygladalo przejecie przez formularz;
--   * account_unconfirmed - konto samo zalozylo osobe, ale nie potwierdzilo
--     zadnego adresu;
--   * self_created - konto samo zalozylo osobe na adres, ktory nie jest jego
--     potwierdzonym adresem (adres sluzbowy, zmiana adresu konta albo
--     zawlaszczenie przez edycje profilu).
-- Brak konta (user_id NULL) - NULL: nie ma czego klasyfikowac.
CREATE OR REPLACE FUNCTION public._event_person_account_risk(p_user_id uuid, p_email_norm text, p_created_by uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    WHEN public._event_uid_owns_email(p_user_id, p_email_norm) THEN 'verified'
    WHEN NULLIF(btrim(COALESCE(p_email_norm, '')), '') IS NULL THEN 'no_email'
    WHEN p_created_by IS DISTINCT FROM p_user_id THEN 'foreign_record'
    WHEN NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
    ) THEN 'account_unconfirmed'
    ELSE 'self_created'
  END;
$$;
REVOKE ALL ON FUNCTION public._event_person_account_risk(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_account_risk(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public._event_person_account_risk(uuid, text, uuid) IS
  'REG-01: klasyfikacja dowiazania konta do osoby wydarzen - verified (D1: potwierdzony adres osoby) | no_email | foreign_record (osobe zalozyl ktos inny niz konto) | account_unconfirmed | self_created; NULL bez konta. Jedna regula dla audytu, naprawy historii i ekranu organizatora. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- C) AUDYT ---------------------------------------------------------------------------
-- Kazde dowiazanie, ktore nie spelnia D1, poza jawnie przywroconymi przez
-- administratora dla DOKLADNIE tego stanu (konto, osoba, adres osoby).
-- `registrations_by_account` - zgloszenia tej osoby zalozone przez to konto:
-- przy przejeciu to slady napastnika, przy dowiazaniu wlasciciela - jego
-- historia. `p_tenant` NULL = wszyscy najemcy (kontrola po wdrozeniu).
CREATE OR REPLACE FUNCTION public.event_people_account_binding_audit(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (
  tenant_id uuid,
  person_id uuid,
  user_id uuid,
  email_norm text,
  account_email_norm text,
  account_email_confirmed boolean,
  risk text,
  registrations_by_account bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.tenant_id,
         p.id,
         p.user_id,
         p.email_norm,
         NULLIF(lower(btrim(COALESCE(u.email, ''))), ''),
         COALESCE(u.email_confirmed_at IS NOT NULL, false),
         x.risk,
         (SELECT count(*)
            FROM public.event_registrations r
           WHERE r.tenant_id = p.tenant_id
             AND r.person_id = p.id
             AND r.created_by = p.user_id)
    FROM public.event_people p
    LEFT JOIN auth.users u ON u.id = p.user_id
    CROSS JOIN LATERAL (
      SELECT public._event_person_account_risk(p.user_id, p.email_norm, p.created_by) AS risk
    ) x
   WHERE p.user_id IS NOT NULL
     AND (p_tenant IS NULL OR p.tenant_id = p_tenant)
     AND x.risk <> 'verified'
     AND NOT EXISTS (
       SELECT 1
         FROM public.event_person_account_unbinds b
        WHERE b.tenant_id = p.tenant_id
          AND b.person_id = p.id
          AND b.user_id = p.user_id
          AND b.restored_at IS NOT NULL
          AND b.restored_email_norm IS NOT DISTINCT FROM p.email_norm
     );
$$;
REVOKE ALL ON FUNCTION public.event_people_account_binding_audit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_people_account_binding_audit(uuid) TO service_role;

COMMENT ON FUNCTION public.event_people_account_binding_audit(uuid) IS
  'REG-01 (D14): dowiazania kont do osob wydarzen niespelniajace D1 (konto bez potwierdzonego adresu osoby), bez jawnie przywroconych przez administratora dla tego samego adresu osoby. p_tenant NULL = wszyscy najemcy. Po naprawie historii (20261012190000) zwraca 0 wierszy. Tylko service_role.';

-- D) NAPRAWA HISTORII --------------------------------------------------------------------
-- Jeden przebieg: odwiazanie i wpis dziennika z TYCH SAMYCH wierszy (UPDATE
-- ... RETURNING), wiec dziennik nigdy nie mowi o odwiazaniu, ktorego nie bylo
-- (rownolegly zapis, ktory zmienil dowiazanie po odczycie audytu, nie
-- pasuje do warunku `p.user_id = a.user_id`). Nic nie jest usuwane:
-- zgloszenia, platnosci (`created_by`) i klucze samoobslugi zostaja.
CREATE OR REPLACE FUNCTION public._event_people_unbind_unverified(p_reason text DEFAULT 'reg01_remediation')
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('reg01_remediation', 'admin_unbind') THEN
    RAISE EXCEPTION 'invalid_payload: unbind reason must be reg01_remediation or admin_unbind';
  END IF;

  WITH a AS (
    SELECT * FROM public.event_people_account_binding_audit(NULL)
  ), unbound AS (
    UPDATE public.event_people p
       SET user_id = NULL
      FROM a
     WHERE p.tenant_id = a.tenant_id
       AND p.id = a.person_id
       AND p.user_id = a.user_id
    RETURNING a.tenant_id, a.person_id, a.user_id, a.email_norm, a.account_email_norm,
              a.risk, a.registrations_by_account
  )
  INSERT INTO public.event_person_account_unbinds (
    tenant_id, person_id, user_id, email_norm, account_email_norm, risk, reason,
    registrations_by_account, unbound_by
  )
  SELECT u.tenant_id, u.person_id, u.user_id, u.email_norm, u.account_email_norm, u.risk, p_reason,
         LEAST(u.registrations_by_account, 2147483647)::integer, auth.uid()
    FROM unbound u;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._event_people_unbind_unverified(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_people_unbind_unverified(text) TO service_role;

COMMENT ON FUNCTION public._event_people_unbind_unverified(text) IS
  'REG-01 (D14): odwiazuje od kont wszystkie osoby z event_people_account_binding_audit() i zapisuje kazde odwiazanie w event_person_account_unbinds (reason reg01_remediation, ryzyko, adresy). Zwraca liczbe odwiazan. Nic nie usuwa. Wolana przez migracje 20261012190000 po poprawkach wszystkich pisarzy; tylko service_role.';

-- E) EKRAN ORGANIZATORA -------------------------------------------------------------------
-- Lista: niezweryfikowane dowiazania najemcy i dziennik odwiazan (najnowsze
-- najpierw, po 200). Adres KONTA zamaskowany: konto nie nalezy do kartoteki
-- najemcy (auth.users jest wspolne), a do decyzji wystarczy domena.
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
  v_unbinds jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'person_id', a.person_id,
           'first_name', p.first_name,
           'last_name', p.last_name,
           'email', p.email,
           'account_email_hint', public._event_email_hint(a.account_email_norm),
           'account_email_confirmed', a.account_email_confirmed,
           'risk', a.risk,
           'registrations_by_account', a.registrations_by_account,
           'created_at', p.created_at
         ) ORDER BY
           CASE a.risk WHEN 'foreign_record' THEN 0 WHEN 'no_email' THEN 1
                       WHEN 'account_unconfirmed' THEN 2 ELSE 3 END,
           p.last_name, p.first_name, a.person_id), '[]'::jsonb)
    INTO v_unverified
    FROM (
      SELECT x.* FROM public.event_people_account_binding_audit(v_tenant) x
       ORDER BY x.person_id
       LIMIT 200
    ) a
    JOIN public.event_people p ON p.tenant_id = a.tenant_id AND p.id = a.person_id;

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

  RETURN jsonb_build_object('unverified', v_unverified, 'unbinds', v_unbinds);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_people_account_bindings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_people_account_bindings(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_people_account_bindings(jsonb) IS
  'REG-01 (D14), ekran organizatora: niezweryfikowane dowiazania kont najemcy (audyt + imie, nazwisko, adres osoby, zamaskowany adres konta, ryzyko) i dziennik odwiazan (najnowsze 200). Najemca z assert_event_admin_tenant() (admin albo super_admin), nigdy z ladunku.';

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

  v_risk := public._event_person_account_risk(v_person.user_id, v_person.email_norm, v_person.created_by);
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
  'REG-01 (D14): administrator odwiazuje konto od osoby wydarzen najemcy ({person_id}); wpis w event_person_account_unbinds (admin_unbind, ryzyko). not_bound gdy osoba nie ma konta. Najemca z assert_event_admin_tenant().';

-- Przywrocenie to JAWNY, LOGOWANY wyjatek od D1: administrator poswiadcza
-- dowiazanie, ktorego regula nie potwierdza (np. adres sluzbowy uczestnika
-- znanego organizatorowi). Atest dotyczy obecnego adresu osoby.
CREATE OR REPLACE FUNCTION public.admin_event_person_account_restore(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_unbind_id uuid;
  v_log public.event_person_account_unbinds;
  v_person public.event_people;
BEGIN
  IF p_payload IS NULL OR COALESCE(p_payload->>'unbind_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'invalid_payload: unbind_id is required';
  END IF;
  v_unbind_id := (p_payload->>'unbind_id')::uuid;

  SELECT b.* INTO v_log
    FROM public.event_person_account_unbinds b
   WHERE b.tenant_id = v_tenant AND b.id = v_unbind_id
   FOR UPDATE;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'not_found: unbind record does not exist';
  END IF;
  IF v_log.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_restored: this account link has already been restored';
  END IF;
  IF v_log.user_id IS NULL THEN
    RAISE EXCEPTION 'account_deleted: the account no longer exists';
  END IF;

  SELECT p.* INTO v_person
    FROM public.event_people p
   WHERE p.tenant_id = v_tenant AND p.id = v_log.person_id
   FOR UPDATE;
  IF v_person.id IS NULL THEN
    RAISE EXCEPTION 'not_found: person does not exist';
  END IF;
  IF v_person.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'person_bound: this person is already linked to an account';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_people p2
     WHERE p2.tenant_id = v_tenant AND p2.user_id = v_log.user_id
  ) THEN
    RAISE EXCEPTION 'account_in_use: this account is linked to another person';
  END IF;

  -- Jedyny zapis `event_people.user_id` poza `_event_bind_uid_for_email`
  -- (wyjatek D1): poprzedza go wiersz dziennika i stempel administratora.
  UPDATE public.event_people p
     SET user_id = v_log.user_id
   WHERE p.tenant_id = v_tenant AND p.id = v_person.id AND p.user_id IS NULL;

  UPDATE public.event_person_account_unbinds b
     SET restored_at = now(),
         restored_by = auth.uid(),
         restored_email_norm = v_person.email_norm
   WHERE b.tenant_id = v_tenant AND b.id = v_log.id;

  RETURN jsonb_build_object('ok', true, 'person_id', v_person.id, 'unbind_id', v_log.id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_person_account_restore(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_person_account_restore(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_person_account_restore(jsonb) IS
  'REG-01 (D14): administrator przywraca dowiazanie z dziennika ({unbind_id}) - jawny, logowany wyjatek od D1 (restored_at/by i adres osoby z chwili przywrocenia; audyt pomija ten stan). Odmowy: not_found, already_restored, account_deleted, person_bound, account_in_use. Najemca z assert_event_admin_tenant().';
