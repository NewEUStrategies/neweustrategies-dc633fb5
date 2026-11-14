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
//
// BŁĄD ODCZYTU NIE JEST WYNIKIEM NEGATYWNYM (2026-11-14). Do tej pory błąd
// PostgREST przy odczycie wpisu albo ścieżki rodzica kończył się `null`
// WEWNĄTRZ funkcji cache'owanej, więc jedna czkawka bazy przypinała w izolacie
// „takiego wpisu nie ma" na 5 minut świeżości (i do 25 minut okna serve-stale):
// stary adres z linkami z indeksu odpowiadał 404 zamiast 301 długo po tym, jak
// baza wróciła. Ta sama klasa defektu, co 404 z odczytu zdegradowanego
// (`lib/ssr/notFoundIfClean.ts`), tylko schowana w pamięci izolatu. Odczyt
// rdzenia (`fetchLegacyPostPath`) teraz RZUCA przy błędzie, więc do cache
// trafia wyłącznie odpowiedź bazy; `resolveLegacyPostPath` nadal nigdy nie
// rzuca i przy błędzie oddaje `null` temu jednemu żądaniu.
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";

/**
 * Odczyt BEZ cache: kanoniczna ścieżka opublikowanego wpisu o danym slugu albo
 * `null`, gdy takiego wpisu nie ma (albo nie ma z czego złożyć ścieżki).
 * RZUCA przy błędzie bazy - wołający decyduje, czy błąd wolno zapamiętać
 * (nie wolno) i co oddać czytelnikowi.
 */
export async function fetchLegacyPostPath(slug: string): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await supabase
    .from("posts")
    .select("slug, parent_page_id")
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data?.parent_page_id) return null;
  const { data: pathRow, error: pathError } = await supabase.rpc("page_full_path", {
    _page_id: data.parent_page_id,
  });
  if (pathError) throw pathError;
  const path = typeof pathRow === "string" ? pathRow : null;
  if (!path) return null;
  return `${path}/${data.slug}`;
}

export async function resolveLegacyPostPath(slug: string): Promise<string | null> {
  if (!slug) return null;
  try {
    return await edgeTtlCache(`public:post-redirect:${slug}`, 5 * 60_000, () =>
      fetchLegacyPostPath(slug),
    );
  } catch {
    // Błąd bazy: `null` dla TEGO żądania (loader trasy `/$` nie może się
    // wywrócić), ale nic nie trafia do pamięci izolatu - następne żądanie pyta
    // ponownie.
    return null;
  }
}
