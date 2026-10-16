import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";
import { edgeTtlCache } from "@/lib/ssrCache";

export const postLayoutSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["post-layout-settings"] as const,
    queryFn: async (): Promise<PostLayoutSettings> =>
      // Per-isolate TTL (per tenant host): root loader grzeje to na każdej
      // trasie, więc bez cache był to stały round-trip każdego renderu SSR.
      // Na kliencie edgeTtlCache jest przezroczyste (świeżością rządzi
      // react-query), a błąd degraduje do defaultów jak dotąd.
      edgeTtlCache("post_layout_settings:row", 60_000, async (): Promise<PostLayoutSettings> => {
        const { data, error } = await supabase
          .from("post_layout_settings")
          .select("*")
          .maybeSingle();
        // Presentation settings warmed by the root loader on every route: on any
        // fetch error fall back to the defaults instead of throwing, so a single
        // failed query here cannot take the whole site down.
        if (error && error.code !== "PGRST116") return defaultPostLayoutSettings();
        return (data as PostLayoutSettings | null) ?? defaultPostLayoutSettings();
      }).catch(() => defaultPostLayoutSettings()),
    staleTime: 5 * 60_000,
  });

export function usePostLayoutSettings() {
  return useQuery(postLayoutSettingsQueryOptions());
}

/**
 * Odczyt EDYTORA `/admin/content-area` - ten sam wiersz, odwrotny kontrakt niż
 * odczyt prezentacyjny wyżej.
 *
 * DLACZEGO NIE `postLayoutSettingsQueryOptions`. Tamten zamienia KAŻDY błąd
 * (sieć, RLS, wygasły JWT, wyjątek klienta) w `defaultPostLayoutSettings()`
 * ze świeżym `dataUpdatedAt` - dla CSS czytelnika to właściwa degradacja, dla
 * edytora utrata danych: domyślne mają `tenant_id: ""`, czyli wyglądają jak
 * „najemca bez wiersza", a pierwszy zapis takiego szkicu upsertuje WSZYSTKIE
 * kolumny wiersza (także układy wpisu, odstęp akapitów i typografię innych
 * ekranów) wartościami domyślnymi. Tu błąd RZUCA; domyślne daje wyłącznie
 * `null` z `maybeSingle()`, czyli naprawdę brak wiersza.
 *
 * Klucz pod prefiksem publicznego: unieważnienie prefiksem (zapis niżej,
 * Theme Design) obejmuje oba, a zasiew korzenia i podgląd Theme Design piszą
 * tylko klucz publiczny. `refetchOnMount: "always"`, bo szkic edytora startuje
 * z bazy, nie z cache'u sprzed minut - a polityka okna bootu w `router.tsx`
 * wpisu z danymi przy montażu nie odświeża.
 */
export const adminPostLayoutSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["post-layout-settings", "admin"] as const,
    queryFn: async (): Promise<PostLayoutSettings> => {
      const { data, error } = await supabase.from("post_layout_settings").select("*").maybeSingle();
      if (error) throw error;
      return (data as PostLayoutSettings | null) ?? defaultPostLayoutSettings();
    },
    refetchOnMount: "always",
  });

export function useAdminPostLayoutSettings() {
  return useQuery(adminPostLayoutSettingsQueryOptions());
}

export function useSavePostLayoutSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PostLayoutSettings>) => {
      // Resolve tenant_id explicitly so first-time inserts are deterministic
      // (DB default current_tenant_id() also works, but being explicit lets us
      // upsert idempotently regardless of whether a row exists).
      const { data: tRow, error: tErr } = await supabase.rpc("current_tenant_id");
      if (tErr) throw tErr;
      const tenant_id = (tRow as string | null) ?? undefined;
      const payload = { ...patch, ...(tenant_id ? { tenant_id } : {}) };
      const { error } = await supabase
        .from("post_layout_settings")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    // Prefiks obejmuje też odczyt edytora (`["post-layout-settings", "admin"]`).
    onSuccess: () => qc.invalidateQueries({ queryKey: ["post-layout-settings"] }),
  });
}
