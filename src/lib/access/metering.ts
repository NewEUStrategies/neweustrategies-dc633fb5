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
//     klienta PO hydracji, żeby boty/prefetch nie paliły limitu),
//   * useMeterQuota (RPC metering_state - stan miesięcznego limitu BEZ
//     konsumpcji) jako jedno źródło "zostało N" dla warstwy treści; każda
//     konsumpcja zasiewa ten sam cache, więc licznik nigdy nie pokazuje
//     nieaktualnych wartości z zamrożonego stanu per artykuł.
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
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
  enabled: true,
  member_monthly_limit: 5,
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

/**
 * Stan miesięcznego limitu czytelnika (RPC metering_state - odczyt bez
 * konsumpcji). W odróżnieniu od MeterState nie jest przypięty do bytu:
 * opisuje CAŁY bieżący miesiąc tożsamości, więc nadaje się na licznik
 * "zostało N" w dowolnym miejscu warstwy treści.
 */
export interface MeterQuota {
  enabled: boolean;
  monthlyLimit: number;
  used: number;
  remaining: number;
  requiresRegistration: boolean;
  showCounter: boolean;
}

/** Liczby prezentowane czytelnikowi przez licznik (po scaleniu źródeł). */
export interface MeterNumbers {
  used: number;
  monthlyLimit: number;
  remaining: number;
}

/**
 * Widoczność licznika w warstwie treści - czysta reguła współdzielona przez
 * trasę ($.tsx), MeterBanner i testy: licznik istnieje wyłącznie dla treści
 * odblokowanej "na licznik" (granted), przy włączonym przełączniku
 * show_counter i realnym limicie. Uprawniony czytelnik (subskrypcja/zakup/
 * organizacja) dostaje z RPC monthly_limit=0, więc nigdy go nie widzi.
 */
export function meterCounterVisible(meter: MeterState | null | undefined): boolean {
  return !!meter && meter.granted && meter.showCounter && meter.monthlyLimit > 0;
}

/**
 * Scala zamrożony stan per artykuł (consume, staleTime: Infinity) z żywym
 * stanem miesiąca (metering_state / zasiew po konsumpcji). Bez tego powrót do
 * wcześniej odblokowanego artykułu pokazywał licznik z chwili PIERWSZEGO
 * odblokowania - np. "zostały 4", gdy realnie zostały 3. `used` jest w obrębie
 * miesiąca monotoniczne, więc świeższym źródłem jest zawsze większa wartość;
 * limit bierzemy z quota (admin mógł go zmienić w trakcie miesiąca).
 */
export function latestMeterNumbers(
  entity: MeterState,
  quota: MeterQuota | null | undefined,
): MeterNumbers {
  if (!quota || !quota.enabled || quota.monthlyLimit <= 0) {
    return { used: entity.used, monthlyLimit: entity.monthlyLimit, remaining: entity.remaining };
  }
  const monthlyLimit = quota.monthlyLimit;
  const used = Math.max(entity.used, quota.used);
  return { used, monthlyLimit, remaining: Math.max(monthlyLimit - used, 0) };
}

/**
 * Moment odnowienia limitu: pierwszy dzień kolejnego miesiąca kalendarzowego
 * (serwer trzyma zużycie per period_month = date_trunc('month', now())).
 */
export function nextMeterResetDate(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/** Data odnowienia limitu w formacie aktywnego języka, np. "1 sierpnia" / "1 August". */
export function formatMeterResetDate(lang: "pl" | "en", now: Date = new Date()): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "long",
  }).format(nextMeterResetDate(now));
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

/**
 * Werdykt konsumpcji jako stan miesiąca. Ma sens wyłącznie dla wierszy z
 * realnym limitem (monthly_limit > 0) - ścieżki "metering nieaktywny" oraz
 * skrót dla uprawnionych zwracają zera, które NIE opisują quoty czytelnika.
 */
export function quotaFromMeterState(state: MeterState): MeterQuota {
  return {
    enabled: true,
    monthlyLimit: state.monthlyLimit,
    used: state.used,
    remaining: state.remaining,
    requiresRegistration: state.requiresRegistration,
    showCounter: state.showCounter,
  };
}

interface QuotaRow {
  enabled: boolean;
  monthly_limit: number;
  used: number;
  remaining: number;
  requires_registration: boolean;
  show_counter: boolean;
}

function toMeterQuota(row: QuotaRow): MeterQuota {
  return {
    enabled: row.enabled,
    monthlyLimit: row.monthly_limit,
    used: row.used,
    remaining: row.remaining,
    requiresRegistration: row.requires_registration,
    showCounter: row.show_counter,
  };
}

/**
 * Klucz cache stanu miesiąca - per tożsamość (konto albo klucz gościa), żeby
 * login/logout naturalnie przełączał licznik na właściwe zużycie.
 */
function meterQuotaQueryKey(identity: string | null) {
  return ["metering-quota", identity ?? "anon"] as const;
}

async function fetchMeterQuota(visitorId: string | null): Promise<MeterQuota | null> {
  const { data, error } = await supabase.rpc(
    "metering_state",
    visitorId ? { _visitor_id: visitorId } : {},
  );
  if (error) throw error;
  const row = ((data ?? []) as QuotaRow[])[0];
  return row ? toMeterQuota(row) : null;
}

/**
 * Żywy stan miesięcznego limitu czytelnika (bez konsumpcji). Zwykle NIE
 * odpytuje serwera: każda konsumpcja (useMeteredAccess) zasiewa ten cache
 * świeżym werdyktem, więc RPC wychodzi dopiero, gdy licznik montuje się bez
 * niedawnej konsumpcji (np. powrót do przeczytanego artykułu po chwili).
 */
export function useMeterQuota(enabled: boolean = true): UseQueryResult<MeterQuota | null> {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const visitorId = uid ? null : getVisitorId();
  return useQuery({
    queryKey: meterQuotaQueryKey(uid ?? visitorId),
    enabled: enabled && (!!uid || !!visitorId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchMeterQuota(uid ? null : visitorId),
  });
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
  const queryClient = useQueryClient();
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
      // Zasiew żywego licznika miesiąca: werdykt konsumpcji to najświeższy
      // znany stan quoty, więc każdy zamontowany licznik "zostało N"
      // aktualizuje się natychmiast i bez dodatkowego RPC. Wiersze bez
      // realnego limitu (metering nieaktywny dla bytu / skrót dla
      // uprawnionych) nie opisują quoty czytelnika - tych nie zasiewamy.
      if (row.monthly_limit > 0) {
        queryClient.setQueryData(
          meterQuotaQueryKey(uid ?? visitorId),
          quotaFromMeterState(toMeterState(row)),
        );
      }
      const body: BodyParts = {
        content_pl: row.content_pl,
        content_en: row.content_en,
        builder_data: row.builder_data,
        blocks_data: row.blocks_data,
      };
      // Debug log dla dashboardu monetyzacji: odmowa / registration-wall.
      // Sukces ("consumed") loguje trigger po INSERT na metered_views.
      if (!row.granted) {
        const outcome = row.requires_registration ? "requires_registration" : "denied";
        const reason = row.requires_registration
          ? "anon_limit_zero"
          : row.monthly_limit > 0 && row.used >= row.monthly_limit
            ? "monthly_limit_reached"
            : "no_access";
        void supabase.rpc("log_metering_event", {
          _entity_type: entityType,
          _entity_id: entityId as string,
          _outcome: outcome,
          _reason: reason,
          _visitor_id: uid ? undefined : (visitorId as string | undefined),
          _used_before: row.used,
          _monthly_limit: row.monthly_limit,
        });
      }
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
