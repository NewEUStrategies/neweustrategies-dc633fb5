// Granica izolacji najemcy (tenant) dla publicznego renderera bloków.
//
// KONTEKST ARCHITEKTONICZNY - CZYTAJ PRZED ZMIANAMI:
// Izolacja danych między obszarami roboczymi firm (tenantami) na planie
// publicznym jest egzekwowana w bazie przez RLS: każda polityka SELECT ma
// warunek `tenant_id = public.public_tenant_id()`, a `public_tenant_id()`
// rozwiązuje tenanta z nagłówka `x-tenant-host` (host, który przegląda
// odwiedzający). Nagłówek dokłada wrapper fetcha anonimowego klienta Supabase
// (integrations/supabase/tenant-host-fetch.ts). Dzięki temu bloki dynamiczne
// (latest-posts, query-loop, poll, related-posts, …) NIE muszą - i NIE mogą -
// filtrować po `tenant_id` w kodzie zapytań: robi to RLS, a klucze react-query
// celowo NIE zawierają tenanta, żeby prefetch SSR i render kliencki trafiały w
// ten sam wpis cache (inaczej hydratacja by się rozjechała).
//
// Ten moduł czyni tę - dotąd domyślną - granicę JAWNĄ i testowalną na poziomie
// aplikacji: `BlocksTenantProvider` udostępnia rozpoznany zakres tenanta
// (host) całemu poddrzewu bloków, a `useBlocksTenantScope()` pozwala go
// odczytać. Domyślny zakres `{ host: null }` oznacza "otoczeniowy" - tenant
// wynika z hosta żądania (RLS). Wartość NIE jest wstrzykiwana do kluczy
// react-query ani do zapytań; służy jako czytelny znacznik granicy oraz punkt
// zaczepienia dla bloków, które kiedyś mogłyby potrzebować zakresu klienckiego.

import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface BlocksTenantScope {
  /**
   * Host, który przegląda odwiedzający - dokładnie ta sama wartość, której RLS
   * używa (nagłówek `x-tenant-host`) do rozwiązania `tenant_id`. `null` =
   * zakres otoczeniowy (wynika z hosta żądania). Bloki prezentacyjne go
   * ignorują; jest to jawny, testowalny znacznik, że poddrzewo bloków jednego
   * tenanta nie może zostać wyrenderowane w zakresie innego.
   */
  readonly host: string | null;
}

const DEFAULT_SCOPE: BlocksTenantScope = { host: null };

const BlocksTenantContext = createContext<BlocksTenantScope>(DEFAULT_SCOPE);

interface ProviderProps {
  /** Jawny host tenanta. Pomiń, aby pozostać w zakresie otoczeniowym (RLS). */
  host?: string | null;
  children: ReactNode;
}

/**
 * Ustanawia jawną granicę tenanta dla poddrzewa bloków. Bezpieczne dla SSR:
 * gdy `host` nie zostanie podany, wartość jest stała (`null`) na serwerze i
 * kliencie, więc nie powoduje rozjazdu hydratacji.
 */
export function BlocksTenantProvider({ host = null, children }: ProviderProps) {
  const value = useMemo<BlocksTenantScope>(() => ({ host }), [host]);
  return <BlocksTenantContext.Provider value={value}>{children}</BlocksTenantContext.Provider>;
}

/** Odczytuje aktualny zakres tenanta widoczny dla bloków. */
export function useBlocksTenantScope(): BlocksTenantScope {
  return useContext(BlocksTenantContext);
}
