// Server functions dla menedżera menu.
// - `listMenus` + `getMenuWithItems` - odczyt publiczny (host-aware przez RLS
//   `menus_read_public` / `menu_items_read_public`).
// - `saveMenu` - zapis chroniony `requireSupabaseAuth` + hard-guard staff.
//   Strategia zapisu: wewnątrz jednej transakcji nie da się zrobić z klienta
//   PostgREST-owego, więc robimy delete-all + insert-all sekwencyjnie na
//   user-scoped kliencie (RLS filtruje po tenant_id menu, więc dane innych
//   tenantów są nietykalne).
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  parseMegaConfig,
  saveMenuInputSchema,
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

export const listMenus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MenuSummary[]> => {
    const supabase = serverPublicClient();
    const { data, error } = await supabase
      .from("menus")
      .select("id, key, name")
      .order("key");
    if (error) {
      console.error("[listMenus]", error.message);
      return [];
    }
    return (data ?? []) as MenuSummary[];
  },
);

const getMenuInputSchema = z.object({ key: z.string().min(1).max(64) });

export const getMenuWithItems = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => getMenuInputSchema.parse(input))
  .handler(async ({ data }): Promise<MenuWithItems | null> => {
    const supabase = serverPublicClient();
    const { data: menu, error: menuErr } = await supabase
      .from("menus")
      .select("id, key, name")
      .eq("key", data.key)
      .maybeSingle();
    if (menuErr || !menu) {
      if (menuErr) console.error("[getMenuWithItems]", menuErr.message);
      return null;
    }
    const { data: items, error: itemsErr } = await supabase
      .from("menu_items")
      .select(
        "id, menu_id, parent_id, position, item_type, ref_id, label_pl, label_en, href, target, css_class, mega_enabled, mega_config",
      )
      .eq("menu_id", menu.id)
      .order("position");
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
      mega_enabled: Boolean(row.mega_enabled),
      mega_config: parseMegaConfig(row.mega_config),
    }));
    return { id: menu.id, key: menu.key, name: menu.name, items: normalized };
  });

export const saveMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveMenuInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    // Hard guard: staff (admin/editor) - RLS też to wymusi, ale chcemy jasny błąd.
    const [{ data: isAdmin }, { data: isEditor }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "editor" }),
    ]);
    if (!isAdmin && !isEditor) throw new Error("Forbidden: staff role required");

    const { data: menu, error: menuErr } = await supabase
      .from("menus")
      .select("id, tenant_id")
      .eq("key", data.menu_key)
      .maybeSingle();
    if (menuErr) throw new Error(`menu lookup: ${menuErr.message}`);
    if (!menu) throw new Error(`Menu '${data.menu_key}' nie istnieje`);

    // Wyczyść stare pozycje. RLS ograniczy do tenanta użytkownika.
    const { error: delErr } = await supabase
      .from("menu_items")
      .delete()
      .eq("menu_id", menu.id);
    if (delErr) throw new Error(`delete items: ${delErr.message}`);

    if (data.items.length === 0) return { ok: true };

    // Mapuj local_id -> nowe UUID, żeby zachować hierarchię.
    const localToUuid = new Map<string, string>();
    for (const it of data.items) localToUuid.set(it.local_id, crypto.randomUUID());

    const rows = data.items.map((it) => ({
      id: localToUuid.get(it.local_id)!,
      menu_id: menu.id as string,
      parent_id: it.parent_local_id ? (localToUuid.get(it.parent_local_id) ?? null) : null,
      position: it.position,
      item_type: it.item_type,
      ref_id: it.ref_id,
      label_pl: it.label_pl,
      label_en: it.label_en,
      href: it.href,
      target: it.target,
      css_class: it.css_class,
      mega_enabled: it.mega_enabled,
      mega_config: it.mega_config,
    }));

    // Insert w batchach, żeby parent_id do własnego wpisu w tej samej partii
    // nie wywalił FK - najpierw poziom 0, potem kolejne.
    const byParent = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const k = r.parent_id;
      const arr = byParent.get(k) ?? [];
      arr.push(r);
      byParent.set(k, arr);
    }
    const inserted = new Set<string>();
    // BFS insert
    const queue: (string | null)[] = [null];
    while (queue.length) {
      const parent = queue.shift() ?? null;
      const batch = (byParent.get(parent) ?? []).filter(
        (r) => parent === null || inserted.has(parent),
      );
      if (batch.length === 0) continue;
      const { error: insErr } = await supabase.from("menu_items").insert(batch);
      if (insErr) throw new Error(`insert items: ${insErr.message}`);
      for (const r of batch) {
        inserted.add(r.id);
        queue.push(r.id);
      }
    }
    return { ok: true };
  });
