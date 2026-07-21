// Metering paywalla ("N darmowych artykułów / miesiąc") - warstwa kliencka.
//
// Egzekwowanie jest WYŁĄCZNIE serwerowe (RPC SECURITY DEFINER
// consume_metered_view - patrz migracja 20260721120000): klient nigdy nie
// widzi body inaczej niż przez policzone odblokowanie. Ten moduł dostarcza:
//   * odczyt konfiguracji (metering_settings, publiczne),
//   * czyste reguły uczestnictwa/wariantów paywalla (unit-testowalne),
//   * tożsamość gościa (uuid w localStorage - miękki licznik anonimów;
//     twardą walutą lejka jest limit KONTA egzekwowany po auth.uid()),
//   * hooki: useMeteringSettings + useMeteredAccess (konsumpcja po stronie
//     klienta PO hydracji, żeby boty/prefetch nie paliły limitu).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { EMPTY_BODY, hasRenderableBody, type BodyParts } from "@/lib/access/gating";
import type { AccessMode } from "@/hooks/useContentAccess";

export type MeteringPolicy = "inherit" | "metered" | "exempt";

export interface MeteringSettings {
  enabled: boolean;
  member_monthly_limit: number;
  anon_monthly_limit: number;
  meter_paid: boolean;
  meter_members: boolean;
  show_counter: boolean;
}

export const DEFAULT_METERING_SETTINGS: MeteringSettings = {
  enabled: false,
  member_monthly_limit: 3,
  anon_monthly_limit: 0,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
};

/** Stan licznika zwracany przez consume_metered_view / metering_state. */
export interface MeterState {
  granted: boolean;
  consumed: boolean;
  used: number;
  monthlyLimit: number;
  remaining: number;
  requiresRegistration: boolean;
  showCounter: boolean;
}

/** Wynik próby odblokowania na licznik: stan + (ewentualnie) body. */
export interface MeteredUnlock {
  body: BodyParts | null;
  meter: MeterState | null;
  /** true, gdy zapytanie konsumujące zakończyło się (sukcesem lub odmową). */
  settled: boolean;
}

export function normalizeMeteringPolicy(value: string | null | undefined): MeteringPolicy {
  return value === "metered" || value === "exempt" ? value : "inherit";
}

/**
 * Czy dany byt uczestniczy w meteringu - czysta reguła współdzielona przez
 * klienta (czy w ogóle próbować konsumpcji) i testy. Serwer podejmuje
 * ostateczną decyzję niezależnie; tu tylko unikamy zbędnych wywołań RPC.
 */
export function meteringApplies(
  settings: MeteringSettings | null | undefined,
  mode: AccessMode | null | undefined,
  policy: string | null | undefined,
): boolean {
  if (!settings || !settings.enabled) return false;
  if (mode !== "members" && mode !== "paid") return false;
  const p = normalizeMeteringPolicy(policy);
  if (p === "exempt") return false;
  if (p === "metered") return true;
  return mode === "paid" ? settings.meter_paid : settings.meter_members;
}

/**
 * Wariant komunikatu paywalla wynikający z meteringu:
 *  - "register": anonim bez własnego limitu - CTA "załóż konto i czytaj N/mies."
 *    (brakujące ogniwo lejka anonim -> członek),
 *  - "exhausted": tożsamość wykorzystała miesięczny limit,
 *  - null: metering nie zmienia komunikatu (standardowy paywall).
 */
export function meterPaywallVariant(input: {
  isLoggedIn: boolean;
  settings: MeteringSettings | null | undefined;
  applies: boolean;
  state: MeterState | null;
}): "register" | "exhausted" | null {
  const { isLoggedIn, settings, applies, state } = input;
  if (!settings || !settings.enabled || !applies) return null;
  if (!isLoggedIn && settings.anon_monthly_limit <= 0) {
    return settings.member_monthly_limit > 0 ? "register" : null;
  }
  if (state && !state.granted && state.monthlyLimit > 0 && state.used >= state.monthlyLimit) {
    return "exhausted";
  }
  return null;
}

const VISITOR_STORAGE_KEY = "nes:metering:visitor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tożsamość gościa dla miękkiego licznika anonimów. Trwały uuid per
 * przeglądarka; SSR zwraca null (konsumpcja i tak startuje po hydracji).
 */
export function getVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const fresh = window.crypto.randomUUID();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Prywatny tryb / zablokowany storage: bez tożsamości nie ma licznika
    // anonimowego; użytkownik zobaczy wariant rejestracyjny.
    return null;
  }
}

interface ConsumeRow {
  granted: boolean;
  consumed: boolean;
  used: number;
  monthly_limit: number;
  remaining: number;
  requires_registration: boolean;
  show_counter: boolean;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
}

function toMeterState(row: ConsumeRow): MeterState {
  return {
    granted: row.granted,
    consumed: row.consumed,
    used: row.used,
    monthlyLimit: row.monthly_limit,
    remaining: row.remaining,
    requiresRegistration: row.requires_registration,
    showCounter: row.show_counter,
  };
}

export async function fetchMeteringSettings(): Promise<MeteringSettings | null> {
  const { data, error } = await supabase
    .from("metering_settings")
    .select(
      "enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter",
    )
    .maybeSingle();
  if (error) throw error;
  return (data as MeteringSettings | null) ?? null;
}

/** Konfiguracja meteringu (publiczna, singleton per tenant). */
export function useMeteringSettings(): UseQueryResult<MeteringSettings | null> {
  return useQuery({
    queryKey: ["metering-settings"] as const,
    queryFn: fetchMeteringSettings,
    staleTime: 5 * 60_000,
  });
}

/**
 * Odblokowanie na licznik. Wywołuje consume_metered_view dokładnie raz na
 * (byt, tożsamość, miesiąc nie jest w kluczu - serwer i tak jest idempotentny
 * per byt/miesiąc). `enabled` musi już zawierać werdykt meteringApplies oraz
 * "SSR/entitled unlock nie przyniósł body".
 */
export function useMeteredAccess(
  entityType: "post" | "page",
  entityId: string | null,
  enabled: boolean,
): MeteredUnlock {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const visitorId = uid ? null : getVisitorId();

  const query = useQuery({
    queryKey: ["metered-unlock", entityType, entityId, uid ?? visitorId ?? "none"] as const,
    enabled: enabled && !!entityId && (!!uid || !!visitorId),
    // Konsumpcja jest efektem ubocznym - nie ponawiamy automatycznie i nie
    // odświeżamy w tle, żeby licznik nie skakał w trakcie czytania.
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ body: BodyParts | null; meter: MeterState | null }> => {
      const { data, error } = await supabase.rpc("consume_metered_view", {
        _entity_type: entityType,
        _entity_id: entityId as string,
        ...(uid ? {} : { _visitor_id: visitorId as string }),
      });
      if (error) throw error;
      const row = ((data ?? []) as ConsumeRow[])[0];
      if (!row) return { body: null, meter: null };
      const body: BodyParts = {
        content_pl: row.content_pl,
        content_en: row.content_en,
        builder_data: row.builder_data,
        blocks_data: row.blocks_data,
      };
      return {
        body: row.granted && hasRenderableBody(body) ? body : EMPTY_BODY,
        meter: toMeterState(row),
      };
    },
  });

  return {
    body: query.data?.body ?? null,
    meter: query.data?.meter ?? null,
    settled: !enabled || query.isFetched,
  };
}
