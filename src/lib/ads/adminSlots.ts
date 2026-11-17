// Pełne wiersze slotów reklamowych (z notatkami operatora) dla panelu reklam.
//
// `ad_slots.notes` nie jest czytelne dla `anon` ani `authenticated` (migracja
// 20261007120100: SELECT kolumnowy bez `notes`), więc `select("*")` kończy się
// odmową uprawnień NAWET dla redakcji. Formularz slotu czyta przez
// `admin_list_ad_slots()` - funkcję z predykatem polityki redakcji (najemca
// z `current_tenant_id()`, rola admin albo editor).
//
// BEZ ŚCIEŻKI ZAPASOWEJ. Kod wyszedł przed migracją, więc brak funkcji
// (PGRST202) cofał odczyt do `select("*")` na tabeli. To okno jest zamknięte:
// produkcja ma `admin_list_ad_slots()` - typy regenerowane z bazy produkcji
// przez bota Lovable (68ba76e1 z 22.10.2026, bb61b8b7 z 25.10.2026) usuwały
// obiekty, których produkcja nie ma, a tę funkcję zostawiły. Ta sama migracja
// odbiera `authenticated` SELECT tabelowy, więc na bazie z nią `select("*")`
// kończy się odmową (pomiar kontraktu TS<->SQL na PG16). Każdy błąd idzie do
// panelu: 42501 dla konta bez roli jak dotąd, a teraz także brak funkcji.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

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
  return { slots: [], error };
}
