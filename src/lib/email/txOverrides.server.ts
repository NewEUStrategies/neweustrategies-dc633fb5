// Odczyt edytowalnych treści maili (site_settings.tx_email_overrides) po
// stronie serwera - używany przez sender oraz podgląd w panelu.
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseTxOverrides, TX_OVERRIDES_DEFAULTS, TX_OVERRIDES_SETTING_KEY, type TxOverrides } from "./txOverrides";

/**
 * Pobiera nadpisania treści. Fail-soft: każdy błąd (brak wiersza, brak
 * uprawnień, zły kształt) sprowadza się do domyślnych treści z `tx-copy`.
 */
export async function loadTxOverrides(client: SupabaseClient): Promise<TxOverrides> {
  try {
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("key", TX_OVERRIDES_SETTING_KEY)
      .limit(1)
      .maybeSingle();
    if (error || !data) return TX_OVERRIDES_DEFAULTS;
    return parseTxOverrides((data as { value: unknown }).value);
  } catch {
    return TX_OVERRIDES_DEFAULTS;
  }
}
