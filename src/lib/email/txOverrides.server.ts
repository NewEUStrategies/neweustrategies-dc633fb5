// Odczyt edytowalnych treści maili (site_settings.tx_email_overrides) po
// stronie serwera - używany przez sender oraz podgląd w panelu.
//
// GRANICA NAJEMCY. `site_settings` ma klucz główny (tenant_id, key) od migracji
// 20260714113000 - każdy najemca trzyma WŁASNY wiersz nadpisań. Sender czyta
// kluczem serwisowym, czyli ponad RLS, więc filtr `tenant_id` jest tu JEDYNĄ
// granicą. Wcześniej zapytanie szło po samym kluczu z `.limit(1)`: przy dwóch
// najemcach baza oddawała wiersz któregokolwiek z nich, a mail odbiorcy z
// organizacji A wychodził z tematem i treścią redakcji organizacji B. `limit`
// nie naprawiał niejednoznaczności, tylko ją uciszał - z pełnym kluczem
// głównym wiersz jest co najwyżej jeden, więc `maybeSingle()` wystarcza.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";
import {
  EMPTY_TX_COPY_OVERRIDE,
  isEditableTxType,
  overrideFor,
  parseTxOverrides,
  TX_OVERRIDES_DEFAULTS,
  TX_OVERRIDES_SETTING_KEY,
  type TxCopyOverride,
  type TxOverrides,
} from "./txOverrides";

/**
 * Pobiera nadpisania treści najemcy `tenantId`. Fail-soft: każdy błąd (brak
 * wiersza, brak uprawnień, zły kształt) sprowadza się do domyślnych treści z
 * `tx-copy`.
 *
 * `tenantId` jest WYMAGANY w sygnaturze, żeby żaden wołający nie mógł już
 * zapytać „bez zakresu". `null` (najemca nierozstrzygnięty) daje treści
 * domyślne BEZ zapytania: domyślna treść jest poprawna dla każdego odbiorcy,
 * cudza nie jest poprawna dla nikogo.
 */
export async function loadTxOverrides(
  client: SupabaseClient,
  tenantId: string | null,
): Promise<TxOverrides> {
  if (!tenantId) return TX_OVERRIDES_DEFAULTS;
  try {
    const { data, error } = await client
      .from("site_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("key", TX_OVERRIDES_SETTING_KEY)
      .maybeSingle();
    if (error || !data) return TX_OVERRIDES_DEFAULTS;
    return parseTxOverrides((data as { value: unknown }).value);
  } catch {
    return TX_OVERRIDES_DEFAULTS;
  }
}

/**
 * Nadpisanie JEDNEGO maila (typ + język) - wejście sendera. `tenantId` to
 * najemca z wiersza domenowego nadawcy (organizacja, miejsce), a nie
 * rozstrzygnięty z adresu odbiorcy - patrz `TxSendInput.tenantId`.
 *
 * Edytowalne są 3 z 19 typów (`EDITABLE_TX_TYPES`), a sender pytał bazę przy
 * KAŻDEJ wysyłce: potwierdzenie płatności czy rejestracja na wydarzenie płaciły
 * round-trip za wiersz, który `overrideFor` i tak wyrzucał. Zapytanie pada
 * teraz wyłącznie dla typu, którego treść redakcja w ogóle może zmienić.
 */
export async function loadTxOverrideFor(
  client: SupabaseClient,
  tenantId: string | null,
  type: TxEmailType,
  lang: EmailLang,
): Promise<TxCopyOverride> {
  if (!isEditableTxType(type)) return EMPTY_TX_COPY_OVERRIDE;
  return overrideFor(await loadTxOverrides(client, tenantId), type, lang);
}
