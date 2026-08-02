// Organism: tag chip list (live data).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

export function TagsView() {
  const { data } = useQuery({
    // Korzen z WIDGET_QUERY_ROOTS - ten sam literal zasila zbior inwalidacji
    // live, wiec zmiana tagow faktycznie odswieza ten widget.
    queryKey: [WIDGET_QUERY_ROOTS.tags],
    queryFn: async () => (await supabase.from("tags").select("id, slug, name")).data ?? [],
  });
  return (
    <div className="flex flex-wrap gap-1.5">
      {(data ?? []).map((t) => (
        <span key={t.id} className="px-2 py-0.5 rounded bg-muted text-xs">
          #{t.name}
        </span>
      ))}
    </div>
  );
}
