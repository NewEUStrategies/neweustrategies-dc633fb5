// Rozwiązywanie kanonicznej ścieżki wpisu dla "starych" adresów URL:
//   * płaskich, poWordPressowych: /minister-radoslaw-sikorski-...
//   * z nieaktualnym rodzicem:    /stara-sekcja/slug-wpisu
//   * legacy /post/<slug>
// Wszystkie sprowadzamy do jednego 301 na `<pełna-ścieżka-rodzica>/<slug>`.
//
// Ruch na tych adresach to głównie boty i stare indeksy - ten sam slug w kółko
// - więc rezolucja (dwa round-tripy: wpis -> ścieżka rodzica) jest cache'owana
// per isolate na 5 minut. Wynik `null` (wpis nie istnieje) też trafia do cache,
// żeby usunięte wpisy nie młóciły bazy.
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";

export async function resolveLegacyPostPath(slug: string): Promise<string | null> {
  if (!slug) return null;
  return edgeTtlCache(`public:post-redirect:${slug}`, 5 * 60_000, async () => {
    const { data, error } = await supabase
      .from("posts")
      .select("slug, parent_page_id")
      .eq("slug", slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data?.parent_page_id) return null;
    const { data: pathRow } = await supabase.rpc("page_full_path", {
      _page_id: data.parent_page_id,
    });
    const path = typeof pathRow === "string" ? pathRow : null;
    if (!path) return null;
    return `${path}/${data.slug}`;
  });
}
