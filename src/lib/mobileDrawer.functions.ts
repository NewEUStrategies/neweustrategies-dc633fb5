// Server functions dla konfiguracji mobilnego drawera.
// - `getMobileDrawerConfig` -> odczyt publiczny (host-aware przez RLS +
//   `public_tenant_id()`); używa klienta z kluczem publikowalnym, nie
//   `supabaseAdmin` (Data API z JWT-key jest bardziej przewidywalne dla
//   publicznych odczytów).
// - `upsertMobileDrawerConfig` -> zapis chroniony `requireSupabaseAuth`;
//   dodatkowy hard-guard sprawdza `is_super_admin` (RLS też to wymusza,
//   ale wolimy jasny błąd zamiast enigmatycznego 42501).
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_DRAWER_CONFIG,
  drawerConfigSchema,
  parseDrawerConfig,
  type DrawerConfig,
} from "@/lib/mobileDrawer";

function serverPublicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        storage: undefined,
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export const getMobileDrawerConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<DrawerConfig> => {
    const supabase = serverPublicClient();
    // RLS filtruje po `public_tenant_id()` (host-aware), więc `.maybeSingle()`
    // zwróci rekord bieżącego tenanta albo null.
    const { data, error } = await supabase
      .from("mobile_drawer_configs")
      .select("section_order, top_tools, nav_items")
      .maybeSingle();
    if (error) {
      console.error("[getMobileDrawerConfig]", error.message);
      return DEFAULT_DRAWER_CONFIG;
    }
    if (!data) return DEFAULT_DRAWER_CONFIG;
    return parseDrawerConfig(data);
  },
);

export const upsertMobileDrawerConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => drawerConfigSchema.parse(input))
  .handler(async ({ data, context }): Promise<DrawerConfig> => {
    const { supabase, userId } = context;

    // Hard guard - RLS też to wymusza, ale komunikat błędu jest jaśniejszy.
    const { data: isSuper, error: rpcErr } = await supabase.rpc("is_super_admin", {
      _user_id: userId,
    });
    if (rpcErr) throw new Error(`is_super_admin: ${rpcErr.message}`);
    if (!isSuper) throw new Error("Forbidden: super_admin required");

    // Pobierz tenanta użytkownika, żeby jawnie ustawić `tenant_id` w upsercie.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) throw new Error(`profile: ${profileErr.message}`);
    if (!profile?.tenant_id) throw new Error("No tenant context");

    const { data: saved, error } = await supabase
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
  });
