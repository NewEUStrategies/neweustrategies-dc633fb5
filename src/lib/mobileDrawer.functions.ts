// Server functions dla konfiguracji mobilnego drawera.
// - `getMobileDrawerConfig` -> odczyt publiczny (host-aware przez RLS +
//   `public_tenant_id()`); używa klienta z kluczem publikowalnym, nie
//   `supabaseAdmin` (Data API z JWT-key jest bardziej przewidywalne dla
//   publicznych odczytów).
// - `upsertMobileDrawerConfig` -> zapis chroniony `requireSupabaseAuth`;
//   dodatkowy hard-guard sprawdza `is_super_admin` (RLS też to wymusza,
//   ale wolimy jasny błąd zamiast enigmatycznego 42501).
import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_DRAWER_CONFIG,
  drawerConfigSchema,
  parseDrawerConfig,
  type DrawerConfig,
} from "@/lib/mobileDrawer";

function serverPublicClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
    // Host-awareness deklarowana w nagłówku pliku wymaga nagłówka
    // x-tenant-host - bez tego RLS czyta konfigurację DOMYŚLNEGO tenanta.
    global: { fetch: fetchWithTenantHost },
  });
}

/**
 * Ciała handlerów są zwykłymi funkcjami z WSTRZYKIWANYM klientem, a
 * `createServerFn` zostaje cienką obwolutą - server fn nie da się wywołać bez
 * kontekstu żądania frameworka, więc inaczej cały plik (razem z bramką
 * super-admina) zostawał poza pomiarem. Produkcja bez zmian: klient ma wartość
 * domyślną.
 */
export type DrawerReadClient = Pick<ReturnType<typeof serverPublicClient>, "from">;

export async function readMobileDrawerConfig(
  supabase: DrawerReadClient = serverPublicClient(),
): Promise<DrawerConfig> {
  // RLS filtruje po `public_tenant_id()` (host-aware), więc `.maybeSingle()`
  // zwróci rekord bieżącego tenanta albo null.
  const { data, error } = await supabase
    .from("mobile_drawer_configs")
    .select("section_order, top_tools, nav_items")
    .maybeSingle();
  if (error) {
    // Szuflada jest jedyną nawigacją telefonu - brak konfiguracji ma dać
    // układ domyślny, a nie pusty ekran.
    console.error("[getMobileDrawerConfig]", error.message);
    return DEFAULT_DRAWER_CONFIG;
  }
  if (!data) return DEFAULT_DRAWER_CONFIG;
  return parseDrawerConfig(data);
}

export const getMobileDrawerConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<DrawerConfig> => readMobileDrawerConfig(),
);

/** Klient użytkownika: tabele + RPC bramki `is_super_admin`. */
/**
 * Klient użytkownika: tabele + RPC bramki `is_super_admin`. Zawężony do dwóch
 * metod - kontrakt zostaje ten sam co w produkcji (wygenerowane typy pilnują
 * nazw tabel i kolumn), a test podaje atrapę zamiast całego klienta.
 */
export type DrawerWriteClient = Pick<SupabaseClient<Database>, "from" | "rpc">;

/**
 * Zapis konfiguracji szuflady. Bramka `is_super_admin` jest tu PONAD RLS-em -
 * RLS też ją wymusza, ale zwraca 42501, którego nie da się pokazać
 * administratorowi. Tenant bierzemy z profilu użytkownika i wstawiamy JAWNIE,
 * żeby upsert nie liczył na domyślną wartość kolumny.
 */
export async function writeMobileDrawerConfig(
  supabase: DrawerWriteClient,
  userId: string,
  data: DrawerConfig,
): Promise<DrawerConfig> {
  const client = supabase;

  const { data: isSuper, error: rpcErr } = await client.rpc("is_super_admin", {
    _user_id: userId,
  });
  if (rpcErr) throw new Error(`is_super_admin: ${rpcErr.message}`);
  if (!isSuper) throw new Error("Forbidden: super_admin required");

  const { data: profile, error: profileErr } = await client
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw new Error(`profile: ${profileErr.message}`);
  if (!profile?.tenant_id) throw new Error("No tenant context");

  const { data: saved, error } = await client
    .from("mobile_drawer_configs")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        section_order: data.section_order,
        top_tools: data.top_tools,
        nav_items: data.nav_items,
        updated_by: userId,
      },
      { onConflict: "tenant_id" },
    )
    .select("section_order, top_tools, nav_items")
    .single();
  if (error) throw new Error(error.message);
  return parseDrawerConfig(saved);
}

export const upsertMobileDrawerConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => drawerConfigSchema.parse(input))
  .handler(async ({ data, context }): Promise<DrawerConfig> =>
    writeMobileDrawerConfig(context.supabase, context.userId, data as DrawerConfig),
  );
