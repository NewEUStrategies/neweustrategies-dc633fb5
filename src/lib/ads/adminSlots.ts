// Pełne wiersze slotów reklamowych (z notatkami operatora) dla panelu reklam.
//
// `ad_slots.notes` nie jest czytelne dla `anon` ani `authenticated` (migracja
// 20261007120100: SELECT kolumnowy bez `notes`), więc `select("*")` kończy się
// odmową uprawnień NAWET dla redakcji. Formularz slotu czyta przez
// `admin_list_ad_slots()` - funkcję z predykatem polityki redakcji (najemca
// z `current_tenant_id()`, rola admin albo editor).
//
// OKNO WDROŻENIA: przed migracją funkcji nie ma (PGRST202), a tabela ma jeszcze
// SELECT tabelowy - wtedy i TYLKO wtedy wracamy do `select("*")`. Każdy inny
// błąd (np. 42501 dla konta bez roli) idzie do wołającego jak dotąd.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

import type { AdSlot } from "./types";

export interface AdminAdSlotsResult {
  slots: AdSlot[];
  error: { message: string } | null;
}

export async function fetchAdminAdSlots(
  client: SupabaseClient<Database>,
): Promise<AdminAdSlotsResult> {
  const { data, error } = await client.rpc("admin_list_ad_slots");
  if (!error) return { slots: (data ?? []) as AdSlot[], error: null };
  if (!isMigrationPending(error)) return { slots: [], error };

  const legacy = await client
    .from("ad_slots")
    .select("*")
    .order("created_at", { ascending: false });
  if (legacy.error) return { slots: [], error: legacy.error };
  return { slots: (legacy.data ?? []) as AdSlot[], error: null };
}
