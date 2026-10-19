// Metering paywalla ("N darmowych artykułów / miesiąc") - warstwa kliencka.
//
// Egzekwowanie jest WYŁĄCZNIE serwerowe (RPC SECURITY DEFINER
// consume_metered_view - patrz migracja 20260721120000): klient nigdy nie
// widzi body inaczej niż przez policzone odblokowanie. Ten moduł dostarcza:
//   * odczyt konfiguracji (metering_settings, publiczne),
//   * czyste reguły uczestnictwa/wariantów paywalla (unit-testowalne),
//   * dwie ścieżki tożsamości (audyt billingowy SUB-17): KONTO woła RPC
//     wprost (tożsamość z auth.uid()), GOŚĆ - funkcję serwerową
//     (meteringVisitor.functions.ts), która bierze identyfikator z podpisanego
//     cookie HttpOnly, najemcę z hosta i skrót adresu z jedynej definicji
//     „kto dzwoni". Klient nie podaje bazie ŻADNEGO klucza gościa,
//   * hooki: useMeteringSettings + useMeteredAccess (konsumpcja po stronie
//     klienta PO hydracji, żeby boty/prefetch nie paliły limitu),
//   * useMeterQuota (RPC metering_state - stan miesięcznego limitu BEZ
//     konsumpcji) jako jedno źródło "zostało N" dla warstwy treści; każda
//     konsumpcja zasiewa ten sam cache, więc licznik nigdy nie pokazuje
//     nieaktualnych wartości z zamrożonego stanu per artykuł.
import { queryOptions, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { EMPTY_BODY, hasRenderableBody, type BodyParts } from "@/lib/access/gating";
// Liście bez importów runtime - bezpieczne dla bundla `public` (ten moduł
// jedzie do czytelnika przez `routes/$.tsx`; żadnego modułu panelu tutaj).
import { meteringKeys } from "@/lib/access/keys";
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
// Gość: tożsamość i najemcę rozstrzyga serwer (cookie HttpOnly z HMAC-iem) -
// przeglądarka nie zna nawet identyfikatora, więc nie ma czego podmienić.
import {
  consumeMeteredVisitorView,
  getMeteredVisitorQuota,
} from "@/lib/access/meteringVisitor.functions";
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

/**
 * Wiersz ustawień z tokenem współbieżności. `updated_at` to SUROWY napis
 * z PostgREST (mikrosekundy) - edytor paywalla zapisuje z nim przez CAS,
 * czytelnik go ignoruje.
 */
export interface MeteringSettingsRow extends MeteringSettings {
  updated_at: string;
}

/**
 * Domyślna konfiguracja = `METERING_DEFAULTS` (kontrakt TS ⇄ SQL
 * `metering_defaults()`, I0). Do S1 stała miała tu własną kopię, a formularz
 * paywalla podstawiał ją przy BRAKU wiersza - admin widział „włączony, 5
 * artykułów", podczas gdy serwer bez wiersza meteringu nie liczy wcale
 * (def. 14). Dziś to jedna wartość, a „brak wiersza" pokazuje UI jako stan
 * serwera (`MeteringServerState` w `meteringQueries.ts`).
 */
export const DEFAULT_METERING_SETTINGS: Readonly<MeteringSettings> = METERING_DEFAULTS;

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
 *
 * `remaining` NIE jest tu przeliczane z samego `limit - used`: serwer liczy je
 * dla gościa jako min(własny limit, sufit adresu - 5 x limit różnych artykułów
 * na adres; audyt SUB-17), a tego sufitu klient nie zna. Bierzemy więc liczbę
 * serwera ze ŚWIEŻSZEGO źródła (większe `used`; przy remisie quota - zasiewa
 * ją każda konsumpcja) i ograniczamy ją z góry własnym limitem. Inaczej za
 * NAT-em biura licznik mówił "zostały 2", a następny artykuł odbijał sufit.
 *
 * Inwariant: oba źródła opisują TEN SAM okres rozliczeniowy - klucze zapytań
 * obu hooków zawierają currentMeterPeriod(), więc po przełomie miesiąca każdy
 * remount czyta świeże stany nowego okresu, a zeszłomiesięczne wpisy cache są
 * nieosiągalne (monotoniczny max nigdy nie scala danych z różnych miesięcy).
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
  const serverRemaining = entity.used > quota.used ? entity.remaining : quota.remaining;
  return {
    used,
    monthlyLimit,
    remaining: Math.max(Math.min(monthlyLimit - used, serverRemaining), 0),
  };
}

/**
 * Bieżący okres rozliczeniowy licznika w ujęciu serwera, np. "2026-07".
 * Serwer trzyma zużycie per period_month = date_trunc('month', now()) w UTC,
 * więc okres liczymy z zegara UTC - wchodzi do kluczy zapytań licznika, żeby
 * stany z różnych miesięcy nigdy się nie mieszały (patrz latestMeterNumbers).
 */
export function currentMeterPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Moment odnowienia limitu: pierwszy dzień kolejnego miesiąca kalendarzowego (UTC). */
export function nextMeterResetDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Data odnowienia limitu w formacie aktywnego języka, np. "1 sierpnia" /
 * "1 August". Formatowana w UTC (strefa serwera), żeby czytelnik na zachód od
 * Greenwich nie zobaczył "31 lipca" przez przesunięcie północy UTC na lokalną.
 */
export function formatMeterResetDate(lang: "pl" | "en", now: Date = new Date()): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
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
 *    (brakujące ogniwo lejka anonim -> członek); także gość, którego serwer
 *    zatrzymał ścianą rejestracji przy NIEwyczerpanym własnym limicie
 *    (`requiresRegistration`: sufit adresu za NAT-em, brak tożsamości gościa) -
 *    konto ma własny licznik poza sufitem adresu, więc to jest droga wyjścia,
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
  // Odmowa sufitu adresu ma used < limit, więc bez tej gałęzi gość dostawał
  // goły paywall bez żadnej informacji, choć nie przeczytał nic za darmo.
  if (!isLoggedIn && state && !state.granted && state.requiresRegistration) {
    return settings.member_monthly_limit > 0 ? "register" : null;
  }
  if (state && !state.granted && state.monthlyLimit > 0 && state.used >= state.monthlyLimit) {
    return "exhausted";
  }
  return null;
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
 * Tożsamość gościa w kluczach cache. Prawdziwy identyfikator zna wyłącznie
 * serwer (cookie HttpOnly), a przeglądarka ma najwyżej jednego gościa naraz -
 * stała etykieta wystarcza, żeby login/logout przełączał wpisy.
 */
const VISITOR_IDENTITY = "visitor";

/**
 * Klucz cache stanu miesiąca - per tożsamość (konto albo gość) ORAZ
 * okres rozliczeniowy: login/logout naturalnie przełącza licznik na właściwe
 * zużycie, a przełom miesiąca unieważnia zeszłomiesięczny stan zamiast
 * przenosić go w nowy okres.
 */
function meterQuotaQueryKey(identity: string, period: string) {
  return ["metering-quota", identity, period] as const;
}

async function fetchMeterQuota(isAccount: boolean): Promise<MeterQuota | null> {
  if (!isAccount) {
    const row = await getMeteredVisitorQuota();
    return row ? toMeterQuota(row) : null;
  }
  const { data, error } = await supabase.rpc("metering_state");
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
  const period = currentMeterPeriod();
  return useQuery({
    queryKey: meterQuotaQueryKey(uid ?? VISITOR_IDENTITY, period),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: () => fetchMeterQuota(!!uid),
  });
}

/**
 * Wiersz ustawień najemcy albo `null` (najemca nigdy nie zapisał ustawień -
 * serwer traktuje to jak metering WYŁĄCZONY). `updated_at` jedzie razem
 * z kolumnami, bo ten sam wpis cache czyta edytor paywalla: jeden klucz
 * = jedna `queryFn` = jeden kształt danych.
 */
export async function fetchMeteringSettings(): Promise<MeteringSettingsRow | null> {
  const { data, error } = await supabase
    .from("metering_settings")
    .select(
      "enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter, updated_at",
    )
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Konfiguracja meteringu pod kluczem z fabryki `meteringKeys.settings()` -
 * tym samym, który unieważnia reguła szyny `metering_settings.changed.v1`
 * i mutator panelu (`useSaveMeteringSettings`). Czytelnik i panel dzielą
 * wpis cache, więc zapis w panelu widać na stronie bez drugiego zapytania.
 */
export function meteringSettingsQueryOptions() {
  return queryOptions({
    queryKey: meteringKeys.settings(),
    queryFn: fetchMeteringSettings,
    staleTime: 5 * 60_000,
  });
}

/** Konfiguracja meteringu (publiczna, singleton per tenant). */
export function useMeteringSettings(): UseQueryResult<MeteringSettings | null> {
  return useQuery(meteringSettingsQueryOptions());
}

/**
 * Odblokowanie na licznik. Wywołuje consume_metered_view dokładnie raz na
 * (byt, tożsamość, okres) - okres w kluczu sprawia, że po przełomie miesiąca
 * ponowna wizyta konsumuje slot NOWEGO miesiąca (serwer i tak jest
 * idempotentny per byt/miesiąc), a zamrożony stan zeszłego miesiąca nie
 * zawyża licznika. `enabled` musi już zawierać werdykt meteringApplies oraz
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
  const identity = uid ?? VISITOR_IDENTITY;
  const period = currentMeterPeriod();

  const query = useQuery({
    queryKey: ["metered-unlock", entityType, entityId, identity, period] as const,
    enabled: enabled && !!entityId,
    // Konsumpcja jest efektem ubocznym - nie ponawiamy automatycznie i nie
    // odświeżamy w tle, żeby licznik nie skakał w trakcie czytania.
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ body: BodyParts | null; meter: MeterState | null }> => {
      let row: ConsumeRow | undefined;
      if (uid) {
        const { data, error } = await supabase.rpc("consume_metered_view", {
          _entity_type: entityType,
          _entity_id: entityId as string,
        });
        if (error) throw error;
        row = ((data ?? []) as ConsumeRow[])[0];
      } else {
        // Gość: serwer wystawia/weryfikuje podpisane cookie i woła wersję
        // `service_role` - błąd leci jak błąd RPC (paywall zostaje zamknięty).
        row =
          (await consumeMeteredVisitorView({
            data: { entityType, entityId: entityId as string },
          })) ?? undefined;
      }
      if (!row) return { body: null, meter: null };
      // Zasiew żywego licznika miesiąca: werdykt konsumpcji to najświeższy
      // znany stan quoty, więc każdy zamontowany licznik "zostało N"
      // aktualizuje się natychmiast i bez dodatkowego RPC. Wiersze bez
      // realnego limitu (metering nieaktywny dla bytu / skrót dla
      // uprawnionych) nie opisują quoty czytelnika - tych nie zasiewamy.
      if (row.monthly_limit > 0) {
        queryClient.setQueryData(
          meterQuotaQueryKey(identity, period),
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
      // Sukces ("consumed") loguje trigger po INSERT na metered_views, a
      // odmowy GOŚCIA - sama baza (rdzeń licznika), bo anon nie ma już
      // EXECUTE na log_metering_event. Tu loguje wyłącznie konto.
      if (uid && !row.granted) {
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
