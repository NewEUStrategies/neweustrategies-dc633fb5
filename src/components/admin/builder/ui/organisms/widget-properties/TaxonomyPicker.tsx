// Shared category/tag multi-select picker — fetches from DB, shows post counts.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ChevronDown, X } from "lucide-react";

type Mode = "categories" | "tags";

type Row = { id: string; slug: string; label: string; count: number };

function useTaxonomy(mode: Mode) {
  return useQuery<Row[]>({
    queryKey: ["taxonomy-picker", mode],
    queryFn: async () => {
      if (mode === "categories") {
        const { data: cats } = await supabase.from("categories").select("id, slug, name_pl").order("name_pl");
        const { data: pcs } = await supabase.from("post_categories").select("category_id");
        const counts = new Map<string, number>();
        (pcs ?? []).forEach((r: { category_id: string }) => counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1));
        return (cats ?? []).map((c: { id: string; slug: string; name_pl: string }) => ({
          id: c.id, slug: c.slug, label: c.name_pl, count: counts.get(c.id) ?? 0,
        }));
      }
      const { data: tags } = await supabase.from("tags").select("id, slug, name").order("name");
      const { data: pts } = await supabase.from("post_tags").select("tag_id");
      const counts = new Map<string, number>();
      (pts ?? []).forEach((r: { tag_id: string }) => counts.set(r.tag_id, (counts.get(r.tag_id) ?? 0) + 1));
      return (tags ?? []).map((t: { id: string; slug: string; name: string }) => ({
        id: t.id, slug: t.slug, label: t.name, count: counts.get(t.id) ?? 0,
      }));
    },
    staleTime: 60_000,
  });
}

interface Props {
  mode: Mode;
  /** Comma-separated slugs */
  value: string;
  onChange: (csv: string) => void;
  placeholder?: string;
}

export function TaxonomyPicker({ mode, value, onChange, placeholder }: Props) {
  const { data: rows = [], isLoading } = useTaxonomy(mode);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const selected = useMemo(
    () => new Set(value.split(",").map((s) => s.trim()).filter(Boolean)),
    [value]
  );

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    onChange(Array.from(next).join(","));
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const selectedRows = rows.filter((r) => selected.has(r.slug));
  const displayLabel = selectedRows.length === 0
    ? (placeholder ?? "- Wszystkie -")
    : selectedRows.length === 1
      ? selectedRows[0].label
      : `${selectedRows.length} wybrane`;

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full h-8 px-2 inline-flex items-center justify-between rounded-md border border-input bg-background text-xs hover:bg-muted/40"
          >
            <span className="truncate text-left">{displayLabel}</span>
            <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Szukaj…"
            className="h-7 text-xs mb-2"
          />
          <div className="max-h-64 overflow-y-auto -mx-1 px-1">
            {isLoading && <div className="text-[11px] text-muted-foreground p-2">Wczytywanie…</div>}
            {!isLoading && filtered.length === 0 && (
              <div className="text-[11px] text-muted-foreground p-2">Brak wyników.</div>
            )}
            {filtered.map((r) => {
              const checked = selected.has(r.slug);
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${checked ? "bg-accent" : "hover:bg-muted/60"}`}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(r.slug)} className="h-3 w-3" />
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="text-[10px] text-muted-foreground">{r.count}</span>
                </label>
              );
            })}
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="mt-2 w-full h-7 text-[11px] rounded border border-border hover:bg-muted inline-flex items-center justify-center gap-1"
            >
              <X className="w-3 h-3" /> Wyczyść wybór
            </button>
          )}
        </PopoverContent>
      </Popover>
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedRows.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px]">
              {r.label}
              <button type="button" onClick={() => toggle(r.slug)} className="hover:text-destructive">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
