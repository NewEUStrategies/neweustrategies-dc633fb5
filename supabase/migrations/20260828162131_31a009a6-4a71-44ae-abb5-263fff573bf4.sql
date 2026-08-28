-- ============================================================
-- HISTORIA ZMIAN UPRAWNIEN DO STAWEK (audyt nadan ulgowych)
-- ------------------------------------------------------------
-- Nadanie stawki ulgowej tlumaczy, dlaczego ktos zaplacil mniej. Sam wiersz
-- w event_audience_grants mowi o STANIE, nie o DRODZE: kto przedluzyl waznosc,
-- kto podmienil uzasadnienie, kto wycofal. Dziennik audytu (public.audit_log)
-- istnieje juz dla innych powierzchni uprzywilejowanych - tu podpinamy pod
-- niego tabele nadan, zamiast budowac druga ksiege.
-- ============================================================

CREATE OR REPLACE FUNCTION public._tg_event_audience_grant_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_field text;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'event_audience_grant.granted';
    v_after := jsonb_build_object(
      'audience', NEW.audience,
      'evidence', NEW.evidence,
      'valid_from', NEW.valid_from,
      'valid_until', NEW.valid_until,
      'company_id', NEW.company_id,
      'event_id', NEW.event_id
    );
  ELSE
    -- Rozrozniamy wycofanie od zwyklej korekty: to dwa rozne zdarzenia
    -- rozliczeniowe i audytor pyta o nie osobno.
    v_action := CASE
      WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN 'event_audience_grant.revoked'
      WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN 'event_audience_grant.restored'
      ELSE 'event_audience_grant.updated'
    END;

    FOREACH v_field IN ARRAY ARRAY['audience','evidence','valid_from','valid_until','revoked_at','company_id','event_id','user_id','person_id'] LOOP
      v_old := to_jsonb(OLD) -> v_field;
      v_new := to_jsonb(NEW) -> v_field;
      IF v_old IS DISTINCT FROM v_new THEN
        v_changed := v_changed || v_field;
        v_before := v_before || jsonb_build_object(v_field, v_old);
        v_after := v_after || jsonb_build_object(v_field, v_new);
      END IF;
    END LOOP;

    -- Dotkniecie wiersza bez zmiany pola istotnego (np. sam updated_at)
    -- nie jest zdarzeniem audytowym - nie zasmiecamy ksiegi.
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    v_action,
    'event_audience_grant',
    NEW.id,
    jsonb_build_object(
      'audience', NEW.audience,
      'event_id', NEW.event_id,
      'user_id', NEW.user_id,
      'person_id', NEW.person_id,
      'changed', to_jsonb(v_changed),
      'before', v_before,
      'after', v_after
    )
  );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_audience_grant_audit() FROM PUBLIC, anon;

COMMENT ON FUNCTION public._tg_event_audience_grant_audit() IS
  'Wpisuje kazde nadanie, korekte i wycofanie uprawnienia do stawki do public.audit_log. SECURITY DEFINER, bo wpis do ksiegi nie moze zalezec od polityki RLS wolajacego.';

DROP TRIGGER IF EXISTS event_audience_grants_audit ON public.event_audience_grants;
CREATE TRIGGER event_audience_grants_audit
  AFTER INSERT OR UPDATE ON public.event_audience_grants
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_audience_grant_audit();

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON public.audit_log (tenant_id, entity_type, entity_id, created_at DESC);

-- ------------------------------------------------------------
-- ODCZYT HISTORII DLA PANELU
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_audience_grant_history(jsonb);
CREATE FUNCTION public.admin_event_audience_grant_history(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  id uuid,
  grant_id uuid,
  action text,
  created_at timestamptz,
  actor_id uuid,
  actor_name text,
  actor_email text,
  audience text,
  event_id uuid,
  event_title text,
  subject_email text,
  subject_name text,
  changed text[],
  before_values jsonb,
  after_values jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_grant_id uuid := NULLIF(p_payload->>'grant_id', '')::uuid;
  v_search text := NULLIF(lower(btrim(COALESCE(p_payload->>'search', ''))), '');
  v_limit integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'limit', ''))::integer, 100), 1), 500);
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.entity_id,
    a.action,
    a.created_at,
    a.actor_id,
    NULLIF(btrim(COALESCE(pr.full_name, '')), ''),
    lower(btrim(au.email)),
    COALESCE(g.audience, a.metadata->>'audience'),
    COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid),
    e.title,
    COALESCE(lower(btrim(su.email)), lower(btrim(pe.email))),
    NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), ''),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(a.metadata->'changed')),
      ARRAY[]::text[]
    ),
    COALESCE(a.metadata->'before', '{}'::jsonb),
    COALESCE(a.metadata->'after', '{}'::jsonb)
  FROM public.audit_log a
  LEFT JOIN public.event_audience_grants g
    ON g.id = a.entity_id AND g.tenant_id = a.tenant_id
  LEFT JOIN auth.users au ON au.id = a.actor_id
  LEFT JOIN public.profiles pr ON pr.id = a.actor_id
  LEFT JOIN auth.users su ON su.id = g.user_id
  LEFT JOIN public.event_people pe ON pe.id = g.person_id AND pe.tenant_id = a.tenant_id
  LEFT JOIN public.events e
    ON e.id = COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid)
   AND e.tenant_id = a.tenant_id
  WHERE a.tenant_id = v_tenant
    AND a.entity_type = 'event_audience_grant'
    AND (v_grant_id IS NULL OR a.entity_id = v_grant_id)
    AND (
      v_event_id IS NULL
      OR COALESCE(g.event_id, NULLIF(a.metadata->>'event_id', '')::uuid) = v_event_id
    )
    AND (
      v_search IS NULL
      OR lower(COALESCE(au.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pr.full_name, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(su.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(pe.email, '')) LIKE '%' || v_search || '%'
      OR lower(COALESCE(g.evidence, '')) LIKE '%' || v_search || '%'
    )
  ORDER BY a.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_audience_grant_history(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_audience_grant_history(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_audience_grant_history(jsonb) IS
  'Historia zmian uprawnien do stawek dla panelu: kto, kiedy i co zmienil. Czyta public.audit_log w granicach najemcy wolajacego (assert_editor_tenant).';