// Podstrony wydarzenia - odczyt poddrzewa `pages`.
//
// NIE BUDUJEMY DRUGIEGO SILNIKA STRON. Strona wydarzenia to zwykla strona
// z `public.pages` przypieta do korzenia wydarzenia (`events.root_page_id`),
// a ekran „Strony i menu" jest nad nia WYGODNA POWIERZCHNIA: lista podstron,
// kolejnosc w menu, wejscie do edytora. Wlasny CRUD stron per wydarzenie
// oznaczalby drugie zrodlo prawdy dla SEO, okruszkow, harmonogramu publikacji
// i rewizji - to jest ryzyko nr 1 projektu modulu
// (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §0.1, §9.1).
//
// ZAPYTANIE TABELARYCZNE, NIE RPC: `pages` nie ma kolumn odcietych grantem,
// a polityka odczytu dla staffa juz istnieje (tak samo czyta lista
// `/admin/pages`). RPC bylby tu obrzedem bez tresci.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Ksztalt WYPROWADZONY z wygenerowanych typow, nie przepisany recznie:
 * przepisany rozjechalby sie z baza przy pierwszej migracji, a bramka
 * `check:db-row-casts` istnieje wlasnie po to, zeby tego pilnowac.
 */
export type EventPageRow = Pick<
  Database["public"]["Tables"]["pages"]["Row"],
  "id" | "slug" | "title_pl" | "title_en" | "status" | "menu_order" | "template_type" | "updated_at"
>;

const COLUMNS = "id, slug, title_pl, title_en, status, menu_order, template_type, updated_at";

/**
 * Podstrony wydarzenia w kolejnosci menu.
 *
 * Brak korzenia (`root_page_id IS NULL`) znaczy „wydarzenie nie ma jeszcze
 * wlasnej strony" - i to jest stan poprawny, nie blad. Zwracamy pusta liste,
 * a ekran pokazuje instrukcje zalozenia strony, a nie komunikat o awarii.
 */
export async function fetchEventPages(rootPageId: string | null): Promise<EventPageRow[]> {
  if (rootPageId === null || rootPageId === "") return [];
  const { data, error } = await supabase
    .from("pages")
    .select(COLUMNS)
    .eq("parent_id", rootPageId)
    .is("deleted_at", null)
    .order("menu_order", { ascending: true })
    .order("title_pl", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Strona-korzen wydarzenia albo `null`. */
export async function fetchEventRootPage(rootPageId: string | null): Promise<EventPageRow | null> {
  if (rootPageId === null || rootPageId === "") return null;
  const { data, error } = await supabase
    .from("pages")
    .select(COLUMNS)
    .eq("id", rootPageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Podzial na „Strony w menu" i „Pozostale strony".
 *
 * MAPOWANIE TYMCZASOWE: docelowo rozstrzyga `event_pages.in_menu` (§4.7
 * projektu modulu). Do czasu tej tabeli granica jest `menu_order` - kolumna,
 * ktora juz dzis ustawia kolejnosc w menu serwisu. Zero znaczy „poza menu".
 */
export function splitEventPages(rows: readonly EventPageRow[]): {
  menu: EventPageRow[];
  other: EventPageRow[];
} {
  return {
    menu: rows.filter((row) => row.menu_order > 0),
    other: rows.filter((row) => row.menu_order <= 0),
  };
}
