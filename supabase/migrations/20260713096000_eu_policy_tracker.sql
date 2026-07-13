-- ============================================================================
-- SPOŁECZNOŚĆ 7/10: tracker legislacyjny UE (flagowe narzędzie powracalne).
--
-- Wzorzec ECFR/Bruegel: interaktywne narzędzie, które daje powód do powrotu
-- i pozycję "źródła prawdy". Dossier legislacyjne z etapem procedury,
-- osią czasu aktualizacji i obserwowaniem z alertami:
--
--   eu_policy_items     dossier (etap: proposal -> parliament -> council ->
--                       trilogue -> adopted -> in_force | rejected | withdrawn),
--                       obszar polityki, waga, referencja COM/2026/..., źródło.
--   eu_policy_updates   oś czasu; wpis może przestawić etap dossier
--                       (stage_to) - trigger aktualizuje item i zapamiętuje
--                       stage_from dla historii.
--   eu_policy_follows   obserwowanie dossier; każda aktualizacja -> alert
--                       in-app (a stamtąd push/digest z 3/10) dla obserwujących.
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eu_policy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  summary_pl text,
  summary_en text,
  policy_area text NOT NULL DEFAULT 'general'
    CHECK (policy_area IN ('general', 'energy', 'digital', 'security',
                           'enlargement', 'economy', 'cohesion', 'climate',
                           'trade', 'migration')),
  stage text NOT NULL DEFAULT 'proposal'
    CHECK (stage IN ('proposal', 'parliament', 'council', 'trilogue',
                     'adopted', 'in_force', 'rejected', 'withdrawn')),
  importance integer NOT NULL DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  reference text,
  source_url text,
  next_milestone_pl text,
  next_milestone_en text,
  next_milestone_at date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> '')
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_items_tenant
  ON public.eu_policy_items (tenant_id, status, policy_area, stage);

DROP TRIGGER IF EXISTS eu_policy_items_set_updated_at ON public.eu_policy_items;
CREATE TRIGGER eu_policy_items_set_updated_at
  BEFORE UPDATE ON public.eu_policy_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.eu_policy_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_items TO authenticated;
GRANT ALL ON public.eu_policy_items TO service_role;
ALTER TABLE public.eu_policy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy items public read" ON public.eu_policy_items;
CREATE POLICY "policy items public read" ON public.eu_policy_items
  FOR SELECT TO anon, authenticated
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "policy items staff all" ON public.eu_policy_items;
CREATE POLICY "policy items staff all" ON public.eu_policy_items
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Oś czasu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eu_policy_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  note_pl text NOT NULL CHECK (length(btrim(note_pl)) BETWEEN 3 AND 2000),
  note_en text NOT NULL CHECK (length(btrim(note_en)) BETWEEN 3 AND 2000),
  stage_from text,
  stage_to text
    CHECK (stage_to IS NULL OR stage_to IN ('proposal', 'parliament', 'council',
           'trilogue', 'adopted', 'in_force', 'rejected', 'withdrawn')),
  source_url text,
  happened_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_updates_item
  ON public.eu_policy_updates (item_id, happened_on DESC, created_at DESC);

GRANT SELECT ON public.eu_policy_updates TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.eu_policy_updates TO authenticated;
GRANT ALL ON public.eu_policy_updates TO service_role;
ALTER TABLE public.eu_policy_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy updates public read" ON public.eu_policy_updates;
CREATE POLICY "policy updates public read" ON public.eu_policy_updates
  FOR SELECT TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
       WHERE i.id = eu_policy_updates.item_id AND i.status = 'published'
    )
  );

DROP POLICY IF EXISTS "policy updates staff all" ON public.eu_policy_updates;
CREATE POLICY "policy updates staff all" ON public.eu_policy_updates
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- Obserwowanie dossier
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eu_policy_follows (
  item_id uuid NOT NULL REFERENCES public.eu_policy_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_eu_policy_follows_user
  ON public.eu_policy_follows (user_id);

GRANT SELECT, INSERT, DELETE ON public.eu_policy_follows TO authenticated;
GRANT ALL ON public.eu_policy_follows TO service_role;
ALTER TABLE public.eu_policy_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy follows owner all" ON public.eu_policy_follows;
CREATE POLICY "policy follows owner all" ON public.eu_policy_follows
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
       WHERE i.id = eu_policy_follows.item_id
         AND i.status = 'published'
         AND i.tenant_id = eu_policy_follows.tenant_id
    )
  );

-- Publiczny licznik obserwujących (wiersze są owner-only).
CREATE OR REPLACE FUNCTION public.get_policy_follower_counts(p_item_ids uuid[])
RETURNS TABLE (item_id uuid, followers integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.item_id, count(*)::integer
    FROM public.eu_policy_follows f
    JOIN public.eu_policy_items i ON i.id = f.item_id
   WHERE f.item_id = ANY (p_item_ids)
     AND i.tenant_id = public.public_tenant_id()
     AND i.status = 'published'
   GROUP BY f.item_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_policy_follower_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_policy_follower_counts(uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Aktualizacja: przestaw etap dossier + alert dla obserwujących
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_eu_policy_update_applied()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.eu_policy_items%ROWTYPE;
  v_row record;
BEGIN
  SELECT * INTO v_item FROM public.eu_policy_items WHERE id = NEW.item_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.tenant_id := v_item.tenant_id;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  IF NEW.stage_to IS NOT NULL AND NEW.stage_to <> v_item.stage THEN
    NEW.stage_from := v_item.stage;
    UPDATE public.eu_policy_items
       SET stage = NEW.stage_to
     WHERE id = NEW.item_id;
  END IF;

  -- Alerty tylko dla opublikowanych dossier.
  IF v_item.status = 'published' THEN
    FOR v_row IN
      SELECT user_id FROM public.eu_policy_follows WHERE item_id = NEW.item_id
    LOOP
      PERFORM public.enqueue_notification(
        v_row.user_id,
        'content',
        'Aktualizacja dossier: ' || v_item.title_pl,
        'Dossier update: ' || v_item.title_en,
        left(btrim(NEW.note_pl), 160),
        left(btrim(NEW.note_en), 160),
        '/tracker/' || v_item.slug,
        'Landmark'
      );
    END LOOP;

    PERFORM public.emit_domain_event(
      v_item.tenant_id, 'eu_policy_item', v_item.id::text, 'policy.updated.v1',
      jsonb_build_object(
        'slug', v_item.slug,
        'stage_to', NEW.stage_to,
        'title_pl', v_item.title_pl,
        'title_en', v_item.title_en
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tracker: update fan-out failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eu_policy_update_applied ON public.eu_policy_updates;
CREATE TRIGGER eu_policy_update_applied
  BEFORE INSERT ON public.eu_policy_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_eu_policy_update_applied();
