// Pasek zakładek tematycznych dla /admin/pages.
//
// Zliczamy tematy CLIENT-SIDE: pobieramy same slugi bieżącego widoku
// (aktywne / kosz), po tenancie — RLS gwarantuje izolację. Dla ~dziesiątek/setek
// stron to jednorazowe zapytanie tańsze niż N-krotny COUNT per topic.
// Cache trzyma się `view + tenant` (nie zależy od pozostałych filtrów), więc
// liczniki nie mrugają przy każdej zmianie języka/autora/statusu.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TOPICS, topicForSlug, topicLabel, type PageTopicKey } from "@/lib/admin/pageTopics";
import { cn } from "@/lib/utils";

interface TopicTabsProps {
  tenantId: string | null | undefined;
  view: "active" | "trash";
  value: PageTopicKey;
  onChange: (next: PageTopicKey) => void;
  lang: string;
}

export function TopicTabs({ tenantId, view, value, onChange, lang }: TopicTabsProps) {
  const { data: slugs } = useQuery({
    enabled: !!tenantId,
    queryKey: ["admin-pages-topic-slugs", tenantId, view] as const,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      let q = supabase.from("pages").select("slug").eq("tenant_id", tenantId!);
      q = view === "trash" ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
      const { data, error } = await q.limit(2000);
      if (error) throw error;
      return (data ?? []).map((r) => r.slug as string);
    },
  });

  const counts = useMemo(() => {
    const map = new Map<PageTopicKey, number>();
    for (const t of TOPICS) map.set(t.key, 0);
    const total = slugs?.length ?? 0;
    map.set("all", total);
    for (const s of slugs ?? []) {
      const key = topicForSlug(s);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [slugs]);

  return (
    <div
      className="mb-3 flex flex-wrap gap-1.5 border-b border-border pb-2"
      role="tablist"
      aria-label="Tematy stron"
    >
      {TOPICS.map((topic) => {
        const active = topic.key === value;
        const count = counts.get(topic.key) ?? 0;
        // Ukryj puste kubełki (poza „Wszystkie"), żeby pasek nie puchł.
        if (topic.key !== "all" && count === 0 && !active) return null;
        return (
          <button
            key={topic.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(topic.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 h-7 text-xs transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground/80 border-border hover:bg-muted/50",
            )}
          >
            <span>{topicLabel(topic.key, lang)}</span>
            <span
              className={cn(
                "tabular-nums text-[10px] rounded px-1 py-0.5",
                active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
