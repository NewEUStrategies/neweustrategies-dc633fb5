// Hook: publiczny origin BIEŻĄCEGO tenanta dla ekranów kokpitu SEO.
//
// Reguła (co wygrywa z czym i dlaczego) mieszka w czystym
// `@/lib/seo/tenantPublicOrigin`; ten plik tylko dostarcza jej faktów:
//
//   * `tenants.domain` i `tenants.is_default` tenanta zalogowanej osoby -
//     polityka RLS „Tenant members read own tenant" (`id = current_tenant_id()`)
//     wpuszcza `authenticated` do WŁASNEGO wiersza, a zapytanie i tak zawęża po
//     `id` jawnie (obrona w głąb, jak w `src/lib/tenant.ts`). `is_default`
//     odróżnia markę bez wpisanej domeny od INNEGO tenanta, który domeny nie
//     zajął - bez tego oba dostawały origin marki;
//   * host karty przeglądarki - przez `useSyncExternalStore` z migawką
//     serwerową `null`, więc SSR i pierwszy render hydracji widzą origin
//     kanoniczny, a host podmienia się dopiero po hydracji (bez ostrzeżenia
//     o niezgodności drzewa). Żadnego `window` na poziomie modułu.
//
// TRZY STANY ODCZYTU (`status`). `pending` i `failed` dają origin TYMCZASOWY
// (z hosta karty) - wystarcza linkom i podglądom, które i tak przerysują się po
// odczycie. SONDY karty fundamentów ruszają WYŁĄCZNIE przy `resolved`: wynik
// sondy na originie tymczasowym to stan CUDZYCH plików, a po padniętym odczycie
// domeny origin tymczasowy NIE staje się originem tenanta - karta mówi wtedy
// „nie wiadomo" i daje ponowienie (`retry`).
//
// `origin: null` = tenant (wiadomo, że nie domyślny) nie ma publicznego adresu.
// Konsumenci pokazują wtedy komunikat zamiast linków/sond na markę.
import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { tenantPublicOrigin } from "@/lib/seo/tenantPublicOrigin";

/** Host karty nie zmienia się bez pełnego przeładowania - nie ma czego subskrybować. */
function subscribeNoop(): () => void {
  return () => {};
}

function browserHost(): string | null {
  return window.location.host || null;
}

function serverHost(): string | null {
  return null;
}

/** Klucz zapytania o domenę - wspólny dla wszystkich kart kokpitu (jeden odczyt). */
export function tenantDomainQueryKey(tenantId: string | null) {
  return ["tenant-public-domain", tenantId] as const;
}

/** Fakty z wiersza `tenants`, których potrzebuje reguła originu. */
interface TenantDomainRow {
  readonly domain: string | null;
  readonly isDefault: boolean | null;
}

/**
 * `pending` - odczyt domeny trwa; `resolved` - odczyt się udał (albo nie ma
 * tenanta, więc nie ma na co czekać); `failed` - odczyt padł.
 */
export type TenantOriginStatus = "pending" | "resolved" | "failed";

export interface TenantPublicOriginState {
  /** Origin bez końcowego ukośnika; `null` = tenant bez publicznego adresu. */
  readonly origin: string | null;
  /** Host karty przeglądarki (`null` podczas SSR). */
  readonly host: string | null;
  readonly status: TenantOriginStatus;
  /** Ponawia odczyt domeny (po `failed`). */
  readonly retry: () => void;
}

export function useTenantPublicOriginState(): TenantPublicOriginState {
  const { tenantId } = useAuth();
  const { data, status, refetch } = useQuery({
    queryKey: tenantDomainQueryKey(tenantId),
    enabled: !!tenantId,
    // Domena tenanta zmienia się rzadziej niż raz na sesję panelu.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<TenantDomainRow> => {
      const { data: row, error } = await supabase
        .from("tenants")
        .select("domain, is_default")
        .eq("id", tenantId ?? "")
        .maybeSingle();
      if (error) throw error;
      return { domain: row?.domain ?? null, isDefault: row?.is_default ?? null };
    },
  });
  const host = useSyncExternalStore(subscribeNoop, browserHost, serverHost);
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  // Bez tenanta zapytanie jest wyłączone (`status` zostaje `pending` na
  // zawsze) - wtedy nie ma na co czekać, a faktów z bazy nie bierzemy wcale.
  // Wiersz z udanego odczytu wygrywa z błędem PÓŹNIEJSZEGO odświeżenia
  // (react-query trzyma wtedy `data` obok `status: "error"`).
  const row = tenantId ? data : undefined;
  const settledStatus: TenantOriginStatus =
    !tenantId || row !== undefined ? "resolved" : status === "error" ? "failed" : "pending";
  return {
    origin: tenantPublicOrigin({ domain: row?.domain, isDefault: row?.isDefault, host }),
    host,
    status: settledStatus,
    retry,
  };
}

/**
 * Sam origin - dla linków i podglądów, którym wystarcza wartość tymczasowa.
 * `null` = tenant bez publicznego adresu (konsument pokazuje komunikat).
 */
export function useTenantPublicOrigin(): string | null {
  return useTenantPublicOriginState().origin;
}
