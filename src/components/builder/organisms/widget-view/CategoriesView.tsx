// Organism: categories chip list (live data).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

type Lang = "pl" | "en";

export function CategoriesView({ lang }: { lang: Lang }) {
  const { data } = useQuery({
    // Korzen z WIDGET_QUERY_ROOTS - ten sam literal zasila zbior inwalidacji
    // live, wiec zmiana kategorii faktycznie odswieza ten widget.
    queryKey: [WIDGET_QUERY_ROOTS.categories],
    queryFn: async () =>
      (await supabase.from("categories").select("id, slug, name_pl, name_en")).data ?? [],
  });
  return (
    <div className="flex flex-wrap gap-2">
      {(data ?? []).map((c) => (
        <span key={c.id} className="cms-meta px-3 py-1 rounded-full border border-border">
          {lang === "pl" ? c.name_pl : c.name_en}
        </span>
      ))}
    </div>
  );
}
