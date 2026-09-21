CREATE TABLE public.user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'amber',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notes TO authenticated;
GRANT ALL ON public.user_notes TO service_role;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_notes owner select" ON public.user_notes FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_notes owner insert" ON public.user_notes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_notes owner update" ON public.user_notes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_notes owner delete" ON public.user_notes FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE INDEX user_notes_owner_idx ON public.user_notes (tenant_id, user_id, pinned DESC, updated_at DESC);
CREATE TRIGGER user_notes_touch BEFORE UPDATE ON public.user_notes
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE public.user_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  title text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  due_at timestamptz,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  source_task_id uuid REFERENCES public.crm_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_todos_priority_check CHECK (priority IN ('urgent','high','medium','low')),
  CONSTRAINT user_todos_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 500)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_todos TO authenticated;
GRANT ALL ON public.user_todos TO service_role;
ALTER TABLE public.user_todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_todos owner select" ON public.user_todos FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_todos owner insert" ON public.user_todos FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_todos owner update" ON public.user_todos FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_todos owner delete" ON public.user_todos FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE INDEX user_todos_owner_idx ON public.user_todos (tenant_id, user_id, done, created_at DESC);
CREATE TRIGGER user_todos_touch BEFORE UPDATE ON public.user_todos
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE public.user_read_later (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text,
  url text,
  state text NOT NULL DEFAULT 'unread',
  note text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_read_later_state_check CHECK (state IN ('unread','read','archived')),
  CONSTRAINT user_read_later_entity_check CHECK (entity_type IN ('post','page','event','document','external'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_read_later TO authenticated;
GRANT ALL ON public.user_read_later TO service_role;
ALTER TABLE public.user_read_later ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_read_later owner select" ON public.user_read_later FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_read_later owner insert" ON public.user_read_later FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_read_later owner update" ON public.user_read_later FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE POLICY "user_read_later owner delete" ON public.user_read_later FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id());
CREATE UNIQUE INDEX user_read_later_unique_idx ON public.user_read_later (tenant_id, user_id, entity_type, entity_id);
CREATE INDEX user_read_later_state_idx ON public.user_read_later (tenant_id, user_id, state, created_at DESC);
CREATE TRIGGER user_read_later_touch BEFORE UPDATE ON public.user_read_later
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();