CREATE TABLE IF NOT EXISTS public.auth_admin_provisioned_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Adres, dla ktorego administrator nadal potwierdzenie (ASCII-lower).
  email_norm text NOT NULL,
  -- Najemca i zaproszenie, z ktorego wynika wpis - slad dla audytu.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  invitation_id uuid,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_admin_provisioned_accounts_source_values
    CHECK (source IN ('invitation_temp_password', 'team_provision')),
  CONSTRAINT auth_admin_provisioned_accounts_email_shape
    CHECK (email_norm = btrim(email_norm) AND email_norm <> '')
);

ALTER TABLE public.auth_admin_provisioned_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_admin_provisioned_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.auth_admin_provisioned_accounts TO service_role;

COMMENT ON TABLE public.auth_admin_provisioned_accounts IS
  'R12 (D1): konta zalozone przez administratora z potwierdzonym adresem (zaproszenie temp_password, import zespolu) PRZED znacznikiem app_metadata.provisioned_by_admin - wypelniane migracja z user_invitations. Potwierdzenie takiego konta nie dowodzi skrzynki (_event_account_admin_provisioned). RLS bez polityk, tylko service_role.';

CREATE OR REPLACE FUNCTION public._event_account_admin_provisioned(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users u
     WHERE u.id = p_uid
       AND (
         (COALESCE(u.raw_app_meta_data->>'provisioned_by_admin', '') = 'true'
          AND COALESCE(NULLIF(lower(btrim(u.raw_app_meta_data->>'provisioned_email') COLLATE "C"), ''),
                       NULLIF(lower(btrim(u.email) COLLATE "C"), ''))
              IS NOT DISTINCT FROM NULLIF(lower(btrim(u.email) COLLATE "C"), ''))
         OR EXISTS (
           SELECT 1
             FROM public.auth_admin_provisioned_accounts a
            WHERE a.user_id = u.id
              AND a.email_norm = NULLIF(lower(btrim(u.email) COLLATE "C"), '')
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION public._event_account_admin_provisioned(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_account_admin_provisioned(uuid) TO service_role;

COMMENT ON FUNCTION public._event_account_admin_provisioned(uuid) IS
  'R12 (D1): true, gdy potwierdzenie OBECNEGO adresu konta nadal administrator (app_metadata.provisioned_by_admin + provisioned_email albo wiersz auth_admin_provisioned_accounts). Potwierdzona zmiana adresu konta zdejmuje blokade dla nowego adresu. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public._event_uid_owns_email(p_uid uuid, p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  -- ZMIANA 20261012 (R12): `lower(... COLLATE "C")` zwija wylacznie A-Z.
  -- Z kolacja bazy UTF-8 `lower()` sprowadzal 'İ' (U+0130) i znak kelwina
  -- (U+212A) do ASCII, wiec konto 'kate@vİctim.com' „mialo" kate@victim.com.
  SELECT p_uid IS NOT NULL
     AND NULLIF(lower(btrim(p_email) COLLATE "C"), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM auth.users u
        WHERE u.id = p_uid
          AND u.email_confirmed_at IS NOT NULL
          AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = NULLIF(lower(btrim(p_email) COLLATE "C"), '')
          -- ZMIANA 20261012 (R12): potwierdzenie nadane przez administratora
          -- (`email_confirm: true`) nie jest kliknieciem w skrzynce.
          AND NOT public._event_account_admin_provisioned(u.id)
     );
$$;
REVOKE ALL ON FUNCTION public._event_uid_owns_email(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_uid_owns_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_uid_owns_email(uuid, text) IS
  'REG-01 (D1): true wtedy i tylko wtedy, gdy konto ma POTWIERDZONY (auth.users.email_confirmed_at) adres rowny podanemu po btrim i zwinieciu wielkosci liter WYLACZNIE A-Z (COLLATE "C", R12) i to potwierdzenie nie zostalo nadane przez administratora (_event_account_admin_provisioned, R12). Brak konta, adresu lub potwierdzenia -> false (nigdy NULL). Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public._event_person_account_risk(p_user_id uuid, p_email_norm text, p_created_by uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    WHEN public._event_uid_owns_email(p_user_id, p_email_norm) THEN 'verified'
    WHEN NULLIF(btrim(COALESCE(p_email_norm, '')), '') IS NULL THEN 'no_email'
    WHEN p_created_by IS DISTINCT FROM p_user_id THEN 'foreign_record'
    -- ZMIANA 20261012 (R12): konto samo zalozylo osobe na SWOJ adres, ale ten
    -- adres potwierdzil administrator - nie podpis przejecia, tylko brak dowodu.
    WHEN public._event_account_admin_provisioned(p_user_id)
         AND EXISTS (
           SELECT 1 FROM auth.users u
            WHERE u.id = p_user_id
              AND u.email_confirmed_at IS NOT NULL
              AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = NULLIF(lower(btrim(p_email_norm) COLLATE "C"), '')
         ) THEN 'admin_provisioned'
    WHEN NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
    ) THEN 'account_unconfirmed'
    ELSE 'self_created'
  END;
$$;
REVOKE ALL ON FUNCTION public._event_person_account_risk(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_account_risk(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public._event_person_account_risk(uuid, text, uuid) IS
  'REG-01: klasyfikacja dowiazania konta do osoby wydarzen - verified (D1: potwierdzony adres osoby) | no_email | foreign_record (osobe zalozyl ktos inny niz konto) | admin_provisioned (R12: adres osoby = adres konta, ale potwierdzenie nadal administrator) | account_unconfirmed | self_created; NULL bez konta. Jedna regula dla audytu, naprawy historii i ekranu organizatora. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

ALTER TABLE public.event_person_account_unbinds
  DROP CONSTRAINT IF EXISTS event_person_account_unbinds_risk_values;
ALTER TABLE public.event_person_account_unbinds
  ADD CONSTRAINT event_person_account_unbinds_risk_values CHECK (risk IN (
    'verified', 'no_email', 'foreign_record', 'account_unconfirmed', 'self_created',
    'admin_provisioned', 'suspect_takeover'
  ));
ALTER TABLE public.event_person_account_unbinds
  DROP CONSTRAINT IF EXISTS event_person_account_unbinds_remediation_unverified;
ALTER TABLE public.event_person_account_unbinds
  ADD CONSTRAINT event_person_account_unbinds_remediation_unverified
    CHECK (reason <> 'reg01_remediation' OR risk NOT IN ('verified', 'suspect_takeover'));