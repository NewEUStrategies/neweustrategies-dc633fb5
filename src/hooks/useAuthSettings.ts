// Odczyt i zapis ustawień logowania.
//
// Odczyt idzie przez `readAuthSettings` (czysty moduł `lib/authSettingsRules`),
// nie przez rozlanie surowego wiersza na domyślne: wiersz w `site_settings.value`
// to `jsonb`, więc baza potrafi zwrócić wartość spoza enuma albo złego typu,
// a `{...DEFAULTS, ...row}` wpuszczałby ją prosto do widoku. Reguły tego odczytu
// (brak wiersza, wiersz częściowy, wartość nieznana) mają tabelę przypadków
// w `src/lib/__tests__/authSettingsRules.test.ts`.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_DEFAULTS, AUTH_SETTINGS_KEY, type AuthSettings } from "@/lib/authSettings";
import { readAuthSettings } from "@/lib/authSettingsRules";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { toJson } from "@/lib/builder/types";

export function useAuthSettings(): AuthSettings {
  const { data } = useQuery({
    queryKey: ["site_settings_public", AUTH_SETTINGS_KEY],
    queryFn: async ({ client }): Promise<AuthSettings> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      return readAuthSettings(settings[AUTH_SETTINGS_KEY]);
    },
    staleTime: 60_000,
  });
  // `undefined` z `useQuery` znaczy „zapytanie w locie ALBO nieudane" - w obu
  // przypadkach widok dostaje domyślne, bo strona logowania musi się wyrenderować
  // także wtedy, gdy ustawienia nie przyszły. Rozdzielenie tych dwóch stanów
  // wystawia `useAuthSettingsQuery` niżej (panel admina musi je rozróżniać).
  return data ?? AUTH_DEFAULTS;
}

export interface AuthSettingsQueryState {
  settings: AuthSettings;
  /** Zapytanie w locie - panel nie ma jeszcze CZEGO pokazać. */
  isPending: boolean;
  /**
   * Odczyt się nie udał. To NIE to samo, co „ustawienia nie były nigdy zapisane":
   * pierwszy stan znaczy „nie wiem, co jest w bazie", drugi „w bazie nie ma nic,
   * obowiązują domyślne". Panel, który je zlewa, każe administratorowi zapisać
   * domyślne na wierzch wartości, których po prostu nie zdołał odczytać.
   */
  isError: boolean;
  /** Czy w bazie stoi wiersz z ustawieniami (odróżnia pustkę od awarii). */
  isConfigured: boolean;
}

export function useAuthSettingsQuery(): AuthSettingsQueryState {
  const { data, isPending, isError } = useQuery({
    queryKey: ["site_settings_public", AUTH_SETTINGS_KEY, "admin"],
    queryFn: async ({ client }) => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      const raw = settings[AUTH_SETTINGS_KEY];
      return { settings: readAuthSettings(raw), isConfigured: raw !== null && raw !== undefined };
    },
    staleTime: 60_000,
  });
  return {
    settings: data?.settings ?? AUTH_DEFAULTS,
    isPending,
    isError,
    isConfigured: data?.isConfigured ?? false,
  };
}

export function useSaveAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: AuthSettings) => {
      const { error } = await supabase
        .from("site_settings")
        .upsert({ key: AUTH_SETTINGS_KEY, value: toJson(value) }, { onConflict: "tenant_id,key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", AUTH_SETTINGS_KEY] });
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
    },
  });
}
