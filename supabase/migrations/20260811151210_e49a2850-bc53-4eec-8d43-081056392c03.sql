CREATE OR REPLACE FUNCTION public.club_export_my_data(p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_limit  integer := greatest(1, least(COALESCE(p_limit, 2000), 5000));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'clubs: authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'clubs: profile not found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'club_memberships', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug            AS club_slug,
            c.name_pl         AS club_name_pl,
            c.name_en         AS club_name_en,
            m.role,
            m.status,
            m.notify_level,
            m.role_expires_at,
            m.rules_accepted_at,
            m.invite_source,
            m.banned_reason,
            m.joined_at,
            m.last_read_at,
            m.unread_count,
            m.created_at,
            m.updated_at
          FROM public.club_members m
          JOIN public.clubs c ON c.id = m.club_id
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_tenant
           AND c.tenant_id = v_tenant
         ORDER BY m.joined_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_applications', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            a.specialization_slug,
            c.name_pl AS club_name_pl,
            c.name_en AS club_name_en,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.company,
            a.job_position,
            a.seniority,
            a.industry,
            a.country,
            a.city,
            a.linkedin_url,
            a.years_experience,
            a.expertise,
            a.languages,
            a.motivation,
            a.goals,
            a.contribution,
            a.availability,
            a.referral_source,
            a.consent,
            a.marketing_consent,
            a.tier_key,
            a.tier_rank,
            a.status,
            a.reviewed_at,
            a.created_at,
            a.lang
          FROM public.club_applications a
          LEFT JOIN public.clubs c ON c.id = a.club_id
         WHERE a.user_id = v_uid
           AND a.tenant_id = v_tenant
         ORDER BY a.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_threads_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            th.id,
            c.slug   AS club_slug,
            g.slug   AS group_slug,
            th.slug  AS thread_slug,
            th.title,
            th.body,
            th.kind,
            th.status,
            th.is_anonymous,
            th.anchor_type,
            th.anchor_id,
            th.pinned_at,
            th.locked_at,
            th.reply_count,
            th.participant_count,
            th.reaction_count,
            th.last_reply_at,
            th.created_at,
            th.updated_at,
            th.edited_at,
            th.edit_count
          FROM public.club_threads th
          JOIN public.clubs c       ON c.id = th.club_id
          JOIN public.club_groups g ON g.id = th.group_id
         WHERE th.author_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY th.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_replies_authored', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            r.id,
            c.slug  AS club_slug,
            r.thread_id,
            th.slug AS thread_slug,
            r.parent_id,
            r.depth,
            r.body,
            r.is_anonymous,
            r.status,
            r.reaction_count,
            r.created_at,
            r.updated_at,
            r.edited_at,
            r.edit_count
          FROM public.club_replies r
          JOIN public.clubs c        ON c.id = r.club_id
          JOIN public.club_threads th ON th.id = r.thread_id
         WHERE r.author_id = v_uid
           AND r.tenant_id = v_tenant
         ORDER BY r.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_stances', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            s.thread_id,
            th.slug AS thread_slug,
            th.title AS thread_title,
            c.slug  AS club_slug,
            s.stance,
            s.rationale,
            s.created_at,
            s.updated_at
          FROM public.club_stances s
          JOIN public.club_threads th ON th.id = s.thread_id
          JOIN public.clubs c         ON c.id = s.club_id
         WHERE s.user_id = v_uid
           AND s.tenant_id = v_tenant
         ORDER BY s.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_reactions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            rx.target_type,
            rx.target_id,
            rx.kind,
            rx.created_at
          FROM public.club_reactions rx
          JOIN public.clubs c ON c.id = rx.club_id
         WHERE rx.user_id = v_uid
           AND rx.tenant_id = v_tenant
         ORDER BY rx.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_thread_subscriptions', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            sub.thread_id,
            th.slug  AS thread_slug,
            th.title AS thread_title,
            c.slug   AS club_slug,
            sub.state,
            sub.created_at
          FROM public.club_thread_subscriptions sub
          JOIN public.club_threads th ON th.id = sub.thread_id
          JOIN public.clubs c         ON c.id = th.club_id
         WHERE sub.user_id = v_uid
           AND th.tenant_id = v_tenant
         ORDER BY sub.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb),

    'club_invitations_received', COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
        FROM (
          SELECT
            c.slug AS club_slug,
            g.slug AS group_slug,
            i.club_role,
            i.message,
            i.status,
            i.created_at,
            i.responded_at,
            i.expires_at
          FROM public.club_invitations i
          JOIN public.clubs c            ON c.id = i.club_id
          LEFT JOIN public.club_groups g ON g.id = i.group_id
         WHERE i.invitee_id = v_uid
           AND i.tenant_id = v_tenant
         ORDER BY i.created_at DESC
         LIMIT v_limit
        ) t
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.club_export_my_data(integer) IS
  'Eksport RODO modulu klubow: zgloszenia, czlonkostwa, tematy, odpowiedzi, stanowiska, reakcje, subskrypcje i zaproszenia WYWOLUJACEGO. Cudze wypowiedzi i notatki komisji (admin_note) sa wylaczeniem swiadomym (art. 15 ust. 4 RODO).';

REVOKE EXECUTE ON FUNCTION public.club_export_my_data(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_export_my_data(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anonymize_club_applications_for_user(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.club_applications
     SET first_name      = '',
         last_name       = '',
         email           = '',
         phone           = '',
         linkedin_url    = '',
         city            = '',
         company         = '',
         job_position    = '',
         motivation      = '',
         goals           = '',
         contribution    = '',
         expertise       = '',
         referral_source = '',
         admin_note      = '',
         updated_at      = now()
   WHERE user_id = _user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.anonymize_club_applications_for_user(uuid) IS
  'Usuwa dane osobowe ze zgloszen klubowych usuwanego konta, zostawiajac wiersz statystyczny (specjalizacja, status, plan, daty). Zwraca liczbe zanonimizowanych wierszy.';

REVOKE EXECUTE ON FUNCTION public.anonymize_club_applications_for_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_club_applications_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.club_my_applications()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  specialization_slug text,
  club_id uuid,
  club_name_pl text,
  club_name_en text,
  status text,
  reviewed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.created_at, a.specialization_slug,
         a.club_id, c.name_pl AS club_name_pl, c.name_en AS club_name_en,
         a.status, a.reviewed_at
    FROM public.club_applications a
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.user_id = auth.uid()
   ORDER BY a.created_at DESC
   LIMIT 50;
$$;

COMMENT ON FUNCTION public.club_my_applications() IS
  'Wlasne zgloszenia wywolujacego: status i daty, bez notatki komisji. Piecdziesiat najnowszych - to lista w formularzu, nie archiwum.';

REVOKE ALL ON FUNCTION public.club_my_applications() FROM public;
GRANT EXECUTE ON FUNCTION public.club_my_applications() TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_auth_user_deleted_retain_accounting()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.anonymize_accounting_evidence_for_user(OLD.id);
  BEGIN
    PERFORM public.anonymize_club_applications_for_user(OLD.id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.tg_auth_user_deleted_retain_accounting() IS
  'BEFORE DELETE ON auth.users: anonimizuje dowody ksiegowe ORAZ zgloszenia klubowe. Drugie w bloku EXCEPTION - prawo do usuniecia konta nie moze zalezec od modulu spolecznego.';