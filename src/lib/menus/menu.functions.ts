// Server functions dla menedżera menu.
// - `listMenus` + `getMenuWithItems` - odczyt publiczny (host-aware przez RLS
//   `menus_read_public` / `menu_items_read_public`).
// - `saveMenu` - zapis chroniony `requireSupabaseAuth` + hard-guard staff.
//   Strategia zapisu: wewnątrz jednej transakcji nie da się zrobić z klienta
//   PostgREST-owego, więc robimy delete-all + insert-all sekwencyjnie na
//   user-scoped kliencie (RLS filtruje po tenant_id menu, więc dane innych
//   tenantów są nietykalne).
import { createServerFn } from "@tanstack/react-start";
import { edgeTtlCache } from "@/lib/ssrCache";
import { createClient } from "@supabase/supabase-js";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  parseMegaConfig,
  saveMenuInputSchema,
  type SaveMenuInput,
  type MenuItemRow,
  type MenuItemType,
  type MenuWithItems,
} from "./types";
import { z } from "zod";

function serverPublicClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTenantHost },
  });
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

export const getMenuWithItems = createServerFn({ method: "GET" })
  .validator((input: unknown) => getMenuInputSchema.parse(input))
  .handler(async ({ data }): Promise<MenuWithItems | null> => {
    // Per-isolate TTL cache (wzorzec jak tenant-directory/ticker): menu jest
    // od 2026-07-20 grzane w loaderze ROOTA na każdej trasie z chrome (SSR
    // renderuje nawigację od pierwszego bajtu zamiast fallbacku "Menu jest
    // puste"), więc bez cache każdy request płaciłby 2 sekwencyjne
    // round-tripy do bazy. 60 s świeżości = zmiany menu w adminie widoczne
    // niemal od razu, a w stanie ustalonym koszt to zero dodatkowych zapytań.
    return edgeTtlCache(`menu-with-items:${data.key}`, 60_000, () => fetchMenuWithItems(data.key));
  });

export async function fetchMenuWithItems(
  key: string,
  supabase: MenuReadClient = serverPublicClient(),
): Promise<MenuWithItems | null> {
  // Jedno okrążenie zamiast dwóch sekwencyjnych: nagłówek pokazywał się
  // dopiero po dwóch round-tripach do bazy (menu -> pozycje). Pozycje
  // filtrujemy przez inner join po `menus.key`, więc obie odpowiedzi lecą
  // równolegle i cold-start nawigacji jest ~2x krótszy.
  const [menuRes, itemsRes] = await Promise.all([
    supabase.from("menus").select("id, key, name").eq("key", key).maybeSingle(),
    supabase
      .from("menu_items")
      .select(
        "id, menu_id, parent_id, position, item_type, ref_id, label_pl, label_en, href, target, css_class, icon, mega_enabled, mega_config, menus!inner(key)",
      )
      .eq("menus.key", key)
      .order("position"),
  ]);
  const { data: menu, error: menuErr } = menuRes;
  const { data: items, error: itemsErr } = itemsRes;
  if (menuErr || !menu) {
    if (menuErr) console.error("[getMenuWithItems]", menuErr.message);
    return null;
  }

  if (itemsErr) {
    console.error("[getMenuWithItems items]", itemsErr.message);
    return { id: menu.id, key: menu.key, name: menu.name, items: [] };
  }
  const normalized: MenuItemRow[] = (items ?? []).map((row) => ({
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
    icon: ((row as { icon?: string | null }).icon as string | null) ?? "",
    mega_enabled: Boolean(row.mega_enabled),
    mega_config: parseMegaConfig(row.mega_config),
  }));
  return { id: menu.id, key: menu.key, name: menu.name, items: normalized };
}

/**
 * Klient użytkownika (z sesją) - `from` do tabel i `rpc` do bramek ról.
 * Kształt jest zawężony strukturalnie, żeby test mógł podać atrapę bez
 * odtwarzania całego `SupabaseClient`.
 */
export interface MenuWriteClient {
  from: (table: string) => never;
  rpc: (fn: string, args: Record<string, unknown>) => never;
}

/**
 * Zapis menu: bramka roli, wyczyszczenie starych pozycji, wstawienie nowych
 * POZIOMAMI (BFS).
 *
 * DLACZEGO POZIOMAMI: `parent_id` wskazuje wiersz z tej samej partii, a klucz
 * obcy sprawdzany jest per wiersz - wstawienie wszystkiego naraz wywala się na
 * dziecku, które wyprzedziło rodzica.
 *
 * SIEROTA (pozycja wskazująca rodzica nieobecnego w payloadzie) zapisuje się
 * na NAJWYŻSZYM poziomie: mapowanie `local_id -> uuid` nie zna takiego rodzica,
 * więc `parent_id` wychodzi `null`. Zgadza się to z tym, co edytor pokazuje po
 * poprawce z 18.08.2026 - pozycja jest widoczna u góry drzewa i tam też ląduje.
 * (Komentarz w tym miejscu twierdził wcześniej, że taki wpis „nigdy nie zostanie
 * wstawiony" - nieprawda, wpis wchodzi jako pozycja najwyższego poziomu.)
 */
export async function saveMenuItems(
  supabase: MenuWriteClient,
  userId: string,
  data: SaveMenuInput,
  makeId: () => string = () => crypto.randomUUID(),
): Promise<{ ok: true }> {
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: unknown,
        ) => {
          maybeSingle: () => Promise<{
            data: { id: string; tenant_id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
      delete: () => {
        eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }>;
      };
      insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>;
    };
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  };

  // Twarda bramka staff (admin/editor). RLS też to wymusi, ale komunikat
  // „Forbidden" jest czytelniejszy niż 42501 z bazy.
  const [{ data: isAdmin }, { data: isEditor }] = await Promise.all([
    client.rpc("has_role", { _user_id: userId, _role: "admin" }),
    client.rpc("has_role", { _user_id: userId, _role: "editor" }),
  ]);
  if (!isAdmin && !isEditor) throw new Error("Forbidden: staff role required");

  const { data: menu, error: menuErr } = await client
    .from("menus")
    .select("id, tenant_id")
    .eq("key", data.menu_key)
    .maybeSingle();
  if (menuErr) throw new Error(`menu lookup: ${menuErr.message}`);
  if (!menu) throw new Error(`Menu '${data.menu_key}' nie istnieje`);

  // Wyczyść stare pozycje. RLS ograniczy do tenanta użytkownika.
  const { error: delErr } = await client.from("menu_items").delete().eq("menu_id", menu.id);
  if (delErr) throw new Error(`delete items: ${delErr.message}`);

  if (data.items.length === 0) return { ok: true };

  // Mapuj local_id -> nowe UUID, żeby zachować hierarchię.
  const localToUuid = new Map<string, string>();
  for (const it of data.items) localToUuid.set(it.local_id, makeId());

  const rows = data.items.map((it) => ({
    id: localToUuid.get(it.local_id)!,
    menu_id: menu.id,
    parent_id: it.parent_local_id ? (localToUuid.get(it.parent_local_id) ?? null) : null,
    position: it.position,
    item_type: it.item_type,
    ref_id: it.ref_id,
    label_pl: it.label_pl,
    label_en: it.label_en,
    href: it.href,
    target: it.target,
    css_class: it.css_class,
    icon: it.icon,
    mega_enabled: it.mega_enabled,
    mega_config: it.mega_config,
  }));

  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const k = r.parent_id;
    const arr = byParent.get(k) ?? [];
    arr.push(r);
    byParent.set(k, arr);
  }
  const queue: (string | null)[] = [null];
  while (queue.length) {
    const parent = queue.shift() ?? null;
    const batch = byParent.get(parent) ?? [];
    if (batch.length === 0) continue;
    const { error: insErr } = await client.from("menu_items").insert(batch);
    if (insErr) throw new Error(`insert items: ${insErr.message}`);
    for (const r of batch) queue.push(r.id);
  }
  return { ok: true };
}

export const saveMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => saveMenuInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> =>
    saveMenuItems(
      context.supabase as unknown as MenuWriteClient,
      context.userId,
      data as SaveMenuInput,
    ),
  );
