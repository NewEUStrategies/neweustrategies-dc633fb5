// Section template store (saves/loads SectionNode blueprints to Supabase).
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

interface RawRow {
  id: string;
  name: string;
  data: unknown;
  created_at: string;
  created_by: string | null;
}

const toTemplate = (r: RawRow): SectionTemplate | null => {
  const d = r.data as SectionNode | undefined;
  if (!d || typeof d !== "object" || d.kind !== "section") return null;
  return { id: r.id, name: r.name, data: d, created_at: r.created_at, created_by: r.created_by };
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

  const remove = useCallback(async (id: string) => {
    await supabase.from("builder_templates").delete().eq("id", id);
    await reload();
  }, [reload]);

  return { items, loading, reload, save, remove };
}
