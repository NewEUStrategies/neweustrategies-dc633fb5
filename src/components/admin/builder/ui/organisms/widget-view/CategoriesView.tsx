// Organism: categories chip list (live data).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Lang = "pl" | "en";

export function CategoriesView({ lang }: { lang: Lang }) {
  const { data } = useQuery({
    queryKey: ["builder-cats"],
    queryFn: async () =>
      (await supabase.from("categories").select("id, slug, name_pl, name_en")).data ?? [],
  });
  return (
    <div className="flex flex-wrap gap-2">
      {(data ?? []).map((c) => (
        <span key={c.id} className="px-3 py-1 rounded-full border border-border text-sm">
          {lang === "pl" ? c.name_pl : c.name_en}
        </span>
      ))}
    </div>
  );
}
