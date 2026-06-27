// Publiczny renderer: lista taksonomii (kategorie/tagi/archiwa miesięczne).
// Pobiera dane z Supabase (publishable - RLS = published only).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";

type Kind = "categories" | "tags" | "archives";

interface Item { label: string; href: string; count: number; }

interface Props {
  kind: Kind;
  lang: "pl" | "en";
  showCount: boolean;
  layout: "list" | "dropdown";
  /** Tag cloud: maksymalna liczba pozycji. */
  limit?: number;
}

export function TaxonomyListView({ kind, lang, showCount, layout, limit }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Item[] = [];
      if (kind === "categories") {
        const { data } = await supabase
          .from("categories")
          .select("slug, name_pl, name_en")
          .order(lang === "en" ? "name_en" : "name_pl");
        if (cancelled) return;
        if (data) {
          for (const c of data as Array<{ slug: string; name_pl: string | null; name_en: string | null }>) {
            const label = (lang === "en" ? c.name_en : c.name_pl) ?? c.name_pl ?? c.name_en ?? c.slug;
            out.push({ label, href: `/category/${c.slug}`, count: 0 });
          }
        }
      } else if (kind === "tags") {
        const { data } = await supabase.from("tags").select("slug, name").order("name").limit(limit ?? 200);
        if (cancelled) return;
        if (data) {
          for (const t of data as Array<{ slug: string; name: string }>) {
            out.push({ label: t.name, href: `/tag/${t.slug}`, count: 0 });
          }
        }
      } else {
        // Archiwa miesięczne - grupujemy published_at po YYYY-MM.
        const { data } = await supabase
          .from("posts")
          .select("published_at, status")
          .eq("status", "published")
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (data) {
          const m = new Map<string, number>();
          for (const r of data as Array<{ published_at: string | null }>) {
            if (!r.published_at) continue;
            const d = new Date(r.published_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            m.set(key, (m.get(key) ?? 0) + 1);
          }
          const fmt = new Intl.DateTimeFormat(lang === "en" ? "en" : "pl", { year: "numeric", month: "long" });
          for (const [k, count] of m) {
            const [y, mo] = k.split("-").map(Number);
            const label = fmt.format(new Date(y, mo - 1, 1));
            out.push({ label, href: `/archive/${k}`, count });
          }
        }
      }
      setItems(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [kind, lang, limit]);

  if (loading) return <div className="text-sm text-muted-foreground py-2">…</div>;
  if (items.length === 0) return null;

  if (layout === "dropdown") {
    return (
      <select
        className="not-prose bg-background border border-border rounded px-3 py-2 text-sm"
        onChange={(e) => { if (e.target.value && typeof window !== "undefined") window.location.href = e.target.value; }}
        defaultValue=""
      >
        <option value="" disabled>
          {lang === "en" ? "Choose…" : "Wybierz…"}
        </option>
        {items.map((it) => (
          <option key={it.href} value={it.href}>{it.label}{showCount && it.count ? ` (${it.count})` : ""}</option>
        ))}
      </select>
    );
  }

  return (
    <ul className="not-prose m-0 p-0 list-none space-y-1">
      {items.map((it) => (
        <li key={it.href} className="flex items-center justify-between gap-2">
          <AppLink href={it.href} className="text-foreground hover:text-primary text-sm">{it.label}</AppLink>
          {showCount && it.count > 0 && (
            <span className="text-xs text-muted-foreground">({it.count})</span>
          )}
        </li>
      ))}
    </ul>
  );
}
