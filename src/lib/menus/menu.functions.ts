// Server functions dla menedżera menu.
// - `listMenus` + `getMenuWithItems` - odczyt publiczny (host-aware przez RLS
//   `menus_read_public` / `menu_items_read_public`).
// - `saveMenu` - zapis chroniony `requireSupabaseAuth`. Całe drzewo idzie
//   JEDNYM wywołaniem RPC `save_menu_items` (migracja 20261002190000), które
//   kasuje stare pozycje i wstawia nowe w jednej transakcji, z bramką roli
//   i zakresem tenanta w bazie. Do 02.10.2026 był tu delete-all + insert
//   poziomami jako osobne żądania PostgREST - błąd w połowie zostawiał
//   publicznie puste albo obcięte menu.
import { createServerFn } from "@tanstack/react-start";
import { edgeTtlCache, invalidateEdgeTtlCache } from "@/lib/ssrCache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { normalizeMenuVisibility } from "./visibility";
import {
  parseMegaConfig,
  saveMenuInputSchema,
  type SaveMenuInput,
  type MenuItemRow,
  type MenuItemType,
  type MenuWithItems,
} from "./types";
import { z } from "zod";

function createServerPublicClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTenantHost },
  });
}

// JEDEN klient na izolat, budowany LENIWIE - ten sam wzorzec i to samo
// uzasadnienie co w `lib/views/postViews.functions.ts`.
//
// DLACZEGO WOLNO GO WSPÓŁDZIELIĆ W IZOLACIE WIELOTENANTOWYM (jedyne pytanie,
// które się tu liczy): egzemplarz nie niesie ŻADNEGO stanu żądania. Opcje
// globalne nie ustawiają `headers`, a `x-tenant-host` dokłada
// `fetchWithTenantHost` PER WYWOŁANIE, czytając kontekst bieżącego żądania -
// nie kontekst z chwili konstrukcji. `persistSession: false` daje storage
// pamięciowy, do którego ten moduł nigdy nie pisze, więc `Authorization` to
// zawsze klucz anon i RLS (`menus_read_public`) rozstrzyga tenanta sama.
//
// PO CO: menu jest grzane w loaderze ROOTA na każdej trasie z chrome, więc
// `createClient` per wywołanie palił czas CPU (zasób bilowany na Workers) przy
// każdym chybieniu w `edgeTtlCache`.
//
// LENIWIE, nie `const` na poziomie modułu: `createClient` rzuca przy braku
// `SUPABASE_URL` - przy inicjalizacji modułu wywróciłoby to cały chunk zamiast
// jednego wywołania server function.
let cachedPublicClient: ReturnType<typeof createServerPublicClient> | undefined;

function serverPublicClient(): ReturnType<typeof createServerPublicClient> {
  cachedPublicClient ??= createServerPublicClient();
  return cachedPublicClient;
}

export interface MenuSummary {
  id: string;
  key: string;
  name: string;
}

/**
 * Ciała handlerów są zwykłymi funkcjami, a `createServerFn` zostaje CIENKĄ
 * OBWOLUTĄ. Powód jest praktyczny: server fn nie da się wywołać bez kontekstu
 * żądania frameworka, więc dopóki orkiestracja siedziała w `.handler(...)`,
 * cały plik stał na 0% - łącznie z bramką roli i kolejnością wstawiania,
 * czyli miejscami, w których błąd kosztuje najwięcej. Klient jest parametrem
 * z wartością domyślną, więc produkcja nie zmienia zachowania, a test podaje
 * własną atrapę łańcucha PostgREST.
 */
export type MenuReadClient = Pick<ReturnType<typeof serverPublicClient>, "from">;

export async function listMenuSummaries(
  supabase: MenuReadClient = serverPublicClient(),
): Promise<MenuSummary[]> {
  const { data, error } = await supabase.from("menus").select("id, key, name").order("key");
  if (error) {
    // Lista menu to ekran administracyjny - pusta lista jest czytelniejsza
    // niż pięćset z błędem, a powód zostaje w logu serwera.
    console.error("[listMenus]", error.message);
    return [];
  }
  return (data ?? []) as MenuSummary[];
}

export const listMenus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MenuSummary[]> => listMenuSummaries(),
);

const getMenuInputSchema = z.object({ key: z.string().min(1).max(64) });

/**
 * Klucz migawki menu w `edgeTtlCache`. Jedna definicja dla odczytu i dla
 * unieważnienia po zapisie - rozjazd tych dwóch napisów nie jest błędem
 * kompilacji, tylko cichym „zapis nie odświeża menu".
 */
export function menuCacheKey(key: string): string {
  return `menu-with-items:${key}`;
}

export const getMenuWithItems = createServerFn({ method: "GET" })
  .validator((input: unknown) => getMenuInputSchema.parse(input))
  .handler(async ({ data }): Promise<MenuWithItems | null> => {
    // Per-isolate TTL cache (wzorzec jak tenant-directory/ticker): menu jest
    // od 2026-07-20 grzane w loaderze ROOTA na każdej trasie z chrome (SSR
    // renderuje nawigację od pierwszego bajtu zamiast fallbacku "Menu jest
    // puste"), więc bez cache każdy request płaciłby round-trip do bazy -
    // i to w t0, o gniazdo współdzielone z resztą odczytów korzenia. 60 s
    // świeżości = zmiany menu w adminie widoczne niemal od razu, a w stanie
    // ustalonym koszt to zero dodatkowych zapytań.
    return edgeTtlCache(menuCacheKey(data.key), 60_000, () => fetchMenuWithItems(data.key));
  });

export async function fetchMenuWithItems(
  key: string,
  supabase: MenuReadClient = serverPublicClient(),
): Promise<MenuWithItems | null> {
  // JEDNO połączenie zamiast dwóch: dwa równoległe zapytania (menu + pozycje)
  // zajmowały dwa z sześciu równoległych gniazd wychodzących Workera, a menu
  // `main` i `footer` grzane naraz w loaderze ROOTA brały ich cztery - właśnie
  // w t0 fali 1, gdy o te same gniazda biją się wszystkie pozostałe odczyty
  // korzenia. Osadzenie PostgREST (`menus -> menu_items` po kluczu obcym
  // `menu_items_menu_id_fkey`) oddaje ten sam komplet danych jednym żądaniem.
  //
  // RLS: osadzony zasób przechodzi WŁASNĄ politykę (`menu_items_read_public`
  // sprawdza tenanta przez `menus`), więc anon widzi dokładnie to, co widział
  // przy osobnym zapytaniu - zmienia się liczba round-tripów, nie zakres.
  //
  // SORTOWANIE musi być zaadresowane do zasobu osadzonego (`referencedTable`),
  // bo `.order("position")` bez tego sortowałby WIERSZE MENU, a pozycje
  // wróciłyby w kolejności fizycznej - czyli z losowo poprzestawianą nawigacją.
  const { data: menu, error: menuErr } = await supabase
    .from("menus")
    .select(
      "id, key, name, menu_items(id, menu_id, parent_id, position, item_type, ref_id, label_pl, label_en, href, target, css_class, visibility, icon, mega_enabled, mega_config)",
    )
    .eq("key", key)
    .order("position", { referencedTable: "menu_items" })
    .maybeSingle();
  if (menuErr || !menu) {
    if (menuErr) console.error("[getMenuWithItems]", menuErr.message);
    return null;
  }

  const items = menu.menu_items;
  const normalized: MenuItemRow[] = (Array.isArray(items) ? items : []).map((row) => ({
    id: row.id as string,
    menu_id: row.menu_id as string,
    parent_id: (row.parent_id as string | null) ?? null,
    position: (row.position as number) ?? 0,
    item_type: row.item_type as MenuItemType,
    ref_id: (row.ref_id as string | null) ?? null,
    label_pl: (row.label_pl as string) ?? "",
    label_en: (row.label_en as string) ?? "",
    href: (row.href as string) ?? "",
    target: (row.target as string) ?? "_self",
    css_class: (row.css_class as string) ?? "",
    visibility: normalizeMenuVisibility((row as { visibility?: string | null }).visibility),
    icon: ((row as { icon?: string | null }).icon as string | null) ?? "",
    mega_enabled: Boolean(row.mega_enabled),
    mega_config: parseMegaConfig(row.mega_config),
  }));
  return { id: menu.id, key: menu.key, name: menu.name, items: normalized };
}

/**
 * Klient użytkownika (z sesją). Zapis to jedno wywołanie RPC, więc z całego
 * klienta potrzebne jest wyłącznie `rpc` - zawężenie do jednej metody, a nie
 * własny opis klienta: kontrakt zostaje TEN SAM co w produkcji (wygenerowane
 * typy `Database` pilnują nazwy funkcji i argumentów), a test nadal może podać
 * atrapę zamiast całego klienta. Brak `from` w typie jest celowy - zapis menu
 * NIE ma prawa wrócić do osobnych `delete`/`insert` na tabeli.
 */
export type MenuWriteClient = Pick<SupabaseClient<Database>, "rpc">;

/** Błąd RPC w kształcie, który czyta mapowanie komunikatów. */
interface SaveMenuRpcError {
  message: string;
  code?: string;
}

/**
 * Komunikaty dla edytora z błędów bazy. Bramka roli i rozstrzygnięcie menu
 * żyją teraz w `save_menu_items`, więc te same czytelne komunikaty, które
 * dotąd składał kod aplikacji, odtwarzamy z kodów/treści wyjątków funkcji.
 */
function saveMenuError(error: SaveMenuRpcError, menuKey: string): Error {
  // 42501 to także „permission denied for function" (brak EXECUTE) - dla
  // edytora to ta sama odmowa.
  if (error.code === "42501" || /forbidden|not_authenticated/i.test(error.message)) {
    return new Error("Forbidden: staff role required");
  }
  if (/menu_not_found/.test(error.message)) {
    return new Error(`Menu '${menuKey}' nie istnieje`);
  }
  return new Error(`save menu: ${error.message}`);
}

/**
 * Zapis menu: CAŁE drzewo jednym wywołaniem `save_menu_items`, czyli w jednej
 * transakcji - stare pozycje znikają wyłącznie razem z wstawieniem nowych.
 *
 * DLACZEGO RPC, A NIE ŁAŃCUCH ŻĄDAŃ: każde żądanie PostgREST to osobna
 * transakcja. Stary przebieg (bramka -> odczyt menu -> `delete` wszystkich
 * pozycji -> `insert` poziomami BFS) zatwierdzał skasowanie, zanim cokolwiek
 * wstawił, więc błąd sieci, limit czasu albo naruszenie ograniczenia w jednej
 * pozycji zostawiał menu PUSTE albo OBCIĘTE - publicznie i bez odtworzenia.
 * Przy okazji znika od trzech do sześciu sekwencyjnych fal round-tripów
 * (zależnie od głębokości drzewa): zostaje jedna.
 *
 * Bramka roli (admin/editor w tenancie domowym), zakres tenanta, mapowanie
 * `local_id -> uuid` i rodziców (SIEROTA ląduje na najwyższym poziomie,
 * pozycja w pierścieniu nie jest zapisywana - jak dotąd w BFS) oraz blokada
 * na równoległe zapisy żyją w funkcji bazy; tu zostaje transport, komunikaty
 * i odświeżenie migawki.
 *
 * `invalidate` jest parametrem z wartością domyślną z tego samego powodu co
 * klient: produkcja nie zmienia zachowania, a test sprawdza, że migawkę
 * unieważnia WYŁĄCZNIE udany zapis.
 */
export async function saveMenuItems(
  supabase: MenuWriteClient,
  data: SaveMenuInput,
  invalidate: (cacheKey: string) => Promise<void> = invalidateEdgeTtlCache,
): Promise<{ ok: true }> {
  const { data: saved, error } = await supabase.rpc("save_menu_items", {
    p_menu_key: data.menu_key,
    p_items: data.items,
  });
  if (error) throw saveMenuError(error, data.menu_key);

  // Mniej zapisanych niż wysłanych = pozycje w pierścieniu `parent_local_id`.
  // Edytor ich nie pokazuje, więc zapis ich nie wstawia (tak było i w BFS) -
  // ale po cichu znikać nie powinny, stąd ślad w logu serwera.
  if (typeof saved === "number" && saved < data.items.length) {
    console.warn(
      `[saveMenu] '${data.menu_key}': pominięto ${data.items.length - saved} pozycji spoza drzewa (pierścień rodziców)`,
    );
  }

  // Menu jest w `edgeTtlCache` (60 s świeżości + migawka kolonii), więc bez
  // tego edytor po „Zapisz" i powrocie na ekran wczytałby STARE menu z tego
  // izolatu - a kolejny zapis cofnąłby właśnie zapisane zmiany. Best-effort:
  // inne izolaty dogania TTL, a porażka unieważnienia nie może zamienić
  // ZATWIERDZONEGO zapisu w komunikat o błędzie.
  try {
    await invalidate(menuCacheKey(data.menu_key));
  } catch (e) {
    console.warn("[saveMenu] unieważnienie migawki menu nie powiodło się", e);
  }
  return { ok: true };
}

export const saveMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => saveMenuInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> =>
    saveMenuItems(context.supabase, data as SaveMenuInput),
  );
