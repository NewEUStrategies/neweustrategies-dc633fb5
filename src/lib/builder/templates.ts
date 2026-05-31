// Section template store (saves/loads SectionNode blueprints to Supabase).
// Now with revision history per template (auto-snapshotted by DB trigger).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SectionNode } from "./types";
import { cloneSection } from "./operations";

export interface SectionTemplate {
  id: string;
  name: string;
  data: SectionNode;
  created_at: string;
  created_by: string | null;
}

export interface TemplateRevision {
  id: string;
  template_id: string;
  name: string;
  data: SectionNode;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

interface RawRow {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  created_by: string | null;
}

interface RawRevRow {
  id: string;
  template_id: string;
  name: string;
  data: unknown;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

const toTemplate = (r: RawRow): SectionTemplate | null => {
  const d = r.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return { id: r.id, name: r.name, data: d, created_at: r.created_at, created_by: r.created_by };
};

const toRevision = (r: RawRevRow): TemplateRevision | null => {
  const d = r.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return {
    id: r.id, template_id: r.template_id, name: r.name, data: d,
    note: r.note, created_at: r.created_at, created_by: r.created_by,
  };
};

export function useSectionTemplates() {
  const [items, setItems] = useState<SectionTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("builder_templates")
      .select("id, name, data, created_at, created_by")
      .eq("scope", "section")
      .order("created_at", { ascending: false })
      .limit(100);
    setItems(((data ?? []) as RawRow[]).map(toTemplate).filter((x): x is SectionTemplate => !!x));
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (name: string, section: SectionNode) => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const payload = cloneSection(section); // fresh ids
    await supabase.from("builder_templates").insert({
      name, scope: "section", data: JSON.parse(JSON.stringify(payload)), created_by: uid,
    });
    await reload();
  }, [reload]);

  const update = useCallback(async (id: string, opts: { name?: string; section?: SectionNode }) => {
    const patch: { name?: string; data?: unknown } = {};
    if (opts.name !== undefined) patch.name = opts.name;
    if (opts.section) patch.data = JSON.parse(JSON.stringify(cloneSection(opts.section)));
    if (Object.keys(patch).length === 0) return;
    await supabase.from("builder_templates").update(patch).eq("id", id);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await supabase.from("builder_templates").delete().eq("id", id);
    await reload();
  }, [reload]);

  return { items, loading, reload, save, update, remove };
}

// Revision history (separate hook, lazy on demand).
export function useTemplateRevisions(templateId: string | null) {
  const [items, setItems] = useState<TemplateRevision[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!templateId) { setItems([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from("builder_template_revisions")
      .select("id, template_id, name, data, note, created_at, created_by")
      .eq("template_id", templateId)
      .order("created_at", { ascending: false })
      .limit(50);
    setItems(((data ?? []) as RawRevRow[]).map(toRevision).filter((x): x is TemplateRevision => !!x));
    setLoading(false);
  }, [templateId]);

  useEffect(() => { void reload(); }, [reload]);

  return { items, loading, reload };
}
