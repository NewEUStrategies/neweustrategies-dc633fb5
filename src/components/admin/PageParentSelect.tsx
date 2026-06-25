// Select a parent page from the tree, excluding a given subtree (typically the
// page being edited and its descendants).
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface PageRow {
  id: string; slug: string; title_pl: string; title_en: string;
  parent_id: string | null;
}

export interface PageParentSelectProps {
  tenantId: string;
  value: string | null;
  onChange: (v: string | null) => void;
  /** Exclude this page id and all of its descendants from the picker. */
  excludeId?: string;
  label?: string;
  /** Optional null label, defaults to "- top-level -". */
  noneLabel?: string;
}

export function PageParentSelect(props: PageParentSelectProps) {
  const { tenantId, value, onChange, excludeId, label = "Strona nadrzędna", noneLabel = "- najwyższy poziom -" } = props;
  const { data: pages = [] } = useQuery({
    queryKey: ["admin-page-tree", tenantId],
    queryFn: async (): Promise<PageRow[]> => {
      const { data, error } = await supabase
        .from("pages")
        .select("id, slug, title_pl, title_en, parent_id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("menu_order").order("title_pl");
      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  const options = useMemo(() => {
    // Build a children map; do DFS in title order; compute depth and skip excluded subtree.
    const byParent = new Map<string | null, PageRow[]>();
    for (const p of pages) {
      const arr = byParent.get(p.parent_id) ?? [];
      arr.push(p); byParent.set(p.parent_id, arr);
    }
    const result: Array<{ id: string; label: string; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = byParent.get(parentId) ?? [];
      for (const c of children) {
        if (c.id === excludeId) continue; // skip self + descendants
        const title = c.title_pl || c.title_en || c.slug;
        result.push({ id: c.id, label: `${"- ".repeat(depth)}${title}`, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return result;
  }, [pages, excludeId]);

  return (
    <div>
      <Label>{label}</Label>
      <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="__none__">{noneLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
