// Ustawienia kasy (kupony/podatki/faktury) - JEDEN odczyt i JEDEN pisarz.
//
// Strona /checkout pokazuje na ich podstawie wskazówkę o kodach promocyjnych,
// `EventInvoicesPanel` - stan faktur, a paywall (`?tab=checkout`) edytuje
// singleton. Egzekwowanie i tak jest serwerowe (createCheckoutOrder czyta
// ustawienia własnym zapytaniem).
//
// MODUŁ CZYTA PUBLICZNA KASA (`routes/checkout.$planId.tsx`), więc importuje
// wyłącznie to, co kasa i tak ładuje, plus fabryki-liście kluczy - żadnego
// modułu panelu. Dlatego konflikt zapisu budujemy tu na miejscu zamiast
// importować `staleWriteError` z `lib/billing/planQueries.ts` (kod `40001`
// jest kontraktem, nie klasą - predykat `isStaleWriteError` rozpozna go).
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkoutKeys } from "@/lib/access/keys";
import { billingKeys } from "@/lib/billing/keys";
import {
  CHECKOUT_SETTINGS_COLUMNS,
  normalizeCheckoutSettings,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { revenueKeys } from "@/lib/revenue/keys";

/**
 * Ustawienia z tokenem współbieżności. `updated_at` = SUROWY napis z PostgREST
 * (mikrosekundy); `null` = najemca nie ma wiersza i działa na bezpiecznych
 * domyślnych (`DEFAULT_CHECKOUT_SETTINGS`) - zapis wtedy TWORZY wiersz.
 */
export type CheckoutSettingsState = CheckoutSettings & { updated_at: string | null };

const STATE_COLUMNS = `${CHECKOUT_SETTINGS_COLUMNS}, updated_at` as const;

async function fetchCheckoutSettingsState(): Promise<CheckoutSettingsState> {
  const { data, error } = await supabase
    .from("checkout_settings")
    .select(STATE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return { ...normalizeCheckoutSettings(data), updated_at: data?.updated_at ?? null };
}

export async function fetchCheckoutSettings(): Promise<CheckoutSettings> {
  return fetchCheckoutSettingsState();
}

/**
 * Klucz `checkoutKeys.settings()` - ten sam, który unieważnia reguła szyny
 * `checkout_settings.changed.v1`. Kasa, faktury wydarzeń i edytor paywalla
 * dzielą wpis cache, więc jeden kształt danych (z tokenem) dla wszystkich.
 */
export function checkoutSettingsQueryOptions() {
  return queryOptions({
    queryKey: checkoutKeys.settings(),
    queryFn: fetchCheckoutSettingsState,
    staleTime: 5 * 60_000,
  });
}

export function useCheckoutSettings(): UseQueryResult<CheckoutSettings> {
  return useQuery(checkoutSettingsQueryOptions());
}

export interface SaveCheckoutSettingsInput {
  settings: CheckoutSettings;
  /** Token z odczytu; `null` = wiersza nie było → INSERT. */
  expectedUpdatedAt: string | null;
}

/** SQLSTATE `40001` - ten sam kontrakt konfliktu co RPC i mutatory S1. */
function staleWrite(): Error & { code: "40001" } {
  return Object.assign(new Error("stale_write"), { code: "40001" as const });
}

/**
 * Zapis ustawień (bez haka - testy i naprawy huba). Patch to wyłącznie pięć
 * kolumn ustawień + `updated_by`. Dawny `upsert(onConflict: tenant_id)`
 * nadpisywał wiersz bez względu na to, co admin widział - teraz UPDATE
 * warunkowany tokenem (0 wierszy = `40001`), a przy braku wiersza INSERT,
 * w którym wyścig dwóch kart kończy się 23505 → `40001`. Najemca przy INSERT
 * z domyślnej kolumny (`public_tenant_id()`), nigdy z formularza.
 */
export async function saveCheckoutSettings(
  input: SaveCheckoutSettingsInput,
): Promise<CheckoutSettingsState> {
  const { data: auth } = await supabase.auth.getSession();
  const s = normalizeCheckoutSettings(input.settings);
  const patch = {
    allow_promotion_codes: s.allow_promotion_codes,
    automatic_tax: s.automatic_tax,
    tax_id_collection: s.tax_id_collection,
    billing_address_collection: s.billing_address_collection,
    invoice_creation: s.invoice_creation,
    updated_by: auth.session?.user.id ?? null,
  };

  if (input.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("checkout_settings")
      .insert(patch)
      .select(STATE_COLUMNS)
      .single();
    if (error?.code === "23505") throw staleWrite();
    if (error) throw error;
    return { ...normalizeCheckoutSettings(data), updated_at: data.updated_at };
  }

  const { data, error } = await supabase
    .from("checkout_settings")
    .update(patch)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(STATE_COLUMNS);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWrite();
  return { ...normalizeCheckoutSettings(row), updated_at: row.updated_at };
}

/**
 * Czytelnicy ustawień kasy: reguła rdzenia `checkout_settings.changed.v1`
 * (kasa, faktury wydarzeń, edytor) z pulpitem monetyzacji (DIAGNOZA #8 -
 * pulpit pokazuje tryb podatkowy kasy) + diagnostyka huba. Moduł nie zna
 * najemcy z sesji (zero importów panelu), więc diagnostyka idzie prefiksem
 * dziedziny u wszystkich najemców - nadmiarowe, nigdy fałszywie świeże.
 */
export function checkoutSettingsInvalidationKeys(): QueryKey[] {
  return [
    checkoutKeys.settings(),
    billingKeys.admin.monetization(),
    revenueKeys.domain("diagnostics"),
  ];
}

/** Jedyny pisarz `checkout_settings` (`syncManifest.ts`). Rzuca, nie pokazuje toastów. */
export function useSaveCheckoutSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCheckoutSettingsInput) => saveCheckoutSettings(input),
    onSuccess: async (state) => {
      // Nowy token od razu w cache - następny zapis z tej karty nie zderzy
      // się z własną zmianą, zanim przyjdzie odświeżenie.
      queryClient.setQueryData(checkoutKeys.settings(), state);
      await Promise.all(
        checkoutSettingsInvalidationKeys().map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
