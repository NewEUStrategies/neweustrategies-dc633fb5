// Publikacja STRONY TESTOWEJ wymusza `seo_noindex` - warstwa zapisu reguły
// z `lib/seo/testContent.ts`.
//
// PO CO (2026-10 audyt SEO). `/test-e2e-zakup` i `/test-e2e-zakup-2` były
// opublikowane i indeksowalne. Dwie możliwe reguły to „odmów publikacji" albo
// „opublikuj, ale z noindex"; wybrana jest druga, bo:
//   * strona testowa bywa POTRZEBNA publicznie (zasiew stron wydarzenia e2e,
//     strona próbna redakcji) - liczy się tylko to, żeby nie trafiła do indeksu,
//   * odmowa w autozapisie edytora zamieniłaby każdy zapis opublikowanej strony
//     testowej w błąd, a wymuszenie jest NIEZMIENNIKIEM: każdy zapis kończący
//     się stanem „publiczna" przywraca `noindex`, więc ręczne odznaczenie nic
//     nie psuje.
// Serwer oddaje znacznik (`noindexForced`), żeby panel mógł o tym powiedzieć.
// Warstwy publiczne (meta robots, mapy, llms.txt) wykluczają takie strony
// niezależnie od flagi - ta warstwa pilnuje, żeby flaga w bazie mówiła prawdę.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isTestContentPath, testPageNeedsNoindex } from "@/lib/seo/testContent";

type PagesClient = Pick<SupabaseClient<Database>, "from" | "rpc">;

/** Stan strony po zapisie, z którego wynika decyzja. */
export interface TestPageSaveState {
  /** Status PO zapisie (`updates.status ?? existing.status`). */
  status: string;
  /** `seo_noindex` PO zapisie. */
  seoNoindex: boolean | null | undefined;
  /** Slug PO zapisie. */
  slug: string | null | undefined;
  /** Rodzic PO zapisie. */
  parentId: string | null | undefined;
  /**
   * Czy sprawdzać przodków (jedno RPC `page_full_path`). Wystarczy przy
   * publikacji i przy zmianie rodzica: autozapis opublikowanej strony bez
   * zmiany miejsca w drzewie nie płaci round-tripu, a ewentualną zmianę
   * slugu PRZODKA i tak łapią warstwy publiczne, które czytają pełną ścieżkę.
   */
  checkAncestors: boolean;
}

/**
 * Czy zapis strony musi ustawić `seo_noindex = true`. Ścieżka rodzica jest
 * czytana tylko wtedy, gdy własny slug niczego nie przesądza.
 */
export async function testPageForcesNoindex(
  supabase: PagesClient,
  state: TestPageSaveState,
): Promise<boolean> {
  const decide = (parentPath: string | null) =>
    testPageNeedsNoindex({
      status: state.status,
      seoNoindex: state.seoNoindex,
      slug: state.slug,
      parentPath,
    });
  if (decide(null)) return true;
  // Szkic albo strona już noindex - przodkowie niczego nie zmienią.
  if (state.status !== "published" && state.status !== "scheduled") return false;
  if (state.seoNoindex || !state.checkAncestors || !state.parentId) return false;
  const { data } = await supabase.rpc("page_full_path", { _page_id: state.parentId });
  return decide(typeof data === "string" ? data : null);
}

/**
 * Ścieżka hurtowa: strony z listy, które są testowe (slug własny albo
 * przodka - `page_full_paths` zwraca pełną ścieżkę, więc jedno RPC rozstrzyga
 * oba przypadki), dostają `seo_noindex = true`. Woła się PRZED publikacją,
 * żeby strona testowa nie była ani chwili publiczna i indeksowalna. Zwraca
 * identyfikatory faktycznie zmienione (po RLS). Best-effort: awaria tej
 * kontroli nie blokuje publikacji (warstwy publiczne i tak wykluczają stronę).
 */
export async function noindexTestPages(
  supabase: PagesClient,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const { data: paths, error } = await supabase.rpc("page_full_paths", {
      _page_ids: [...ids],
    });
    if (error) throw error;
    const testIds = (paths ?? [])
      .filter((row) => ids.includes(row.page_id) && isTestContentPath(row.full_path))
      .map((row) => row.page_id);
    if (testIds.length === 0) return [];
    const { data: updated, error: updateError } = await supabase
      .from("pages")
      .update({ seo_noindex: true })
      .in("id", testIds)
      .eq("seo_noindex", false)
      .select("id");
    if (updateError) throw updateError;
    return (updated ?? []).map((row) => row.id);
  } catch (e) {
    console.warn("[pages] noindex stron testowych nie powiódł się:", e);
    return [];
  }
}
