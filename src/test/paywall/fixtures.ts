// Atomy testowe powierzchni PAYWALLA (atomic design zastosowany do testów,
// wzorem src/test/network/fixtures.ts): jedno źródło prawdy dla reguł dostępu,
// planów, stanów licznika i surowych wierszy RPC meteringu. Suity paywalla
// (Paywall, MeterBanner, QuotaMeter, hooki meteringu, bramka i18n) składają się
// z tych samych atomów, więc zmiana kontraktu warstwy dostępu psuje JEDEN plik.
//
// Świadomie BEZ JSX i bez importu komponentów - moduł bywa wciągany z wnętrza
// fabryk `vi.mock`, więc musi być tani i wolny od side-effectów.
import type { AccessPlan, ContentAccessRule } from "@/hooks/useContentAccess";
import type { MeteringSettings, MeterQuota, MeterState } from "@/lib/access/metering";

/**
 * Identyfikatory testowe. Tenant jest tu jawny, bo cały łańcuch paywalla jest
 * tenant-scoped po stronie serwera (reguły dostępu, plany, metering_settings i
 * RPC SECURITY DEFINER filtrują po tenancie wołającego) - klient NIGDY nie
 * przekazuje tenant_id jawnie, a testy izolacji mają odwoływać się do tych
 * stałych, nie do literałów rozsypanych po plikach.
 */
export const PAYWALL_IDS = {
  tenant: "tenant-alfa",
  foreignTenant: "tenant-beta",
  entity: "post-1",
  page: "page-1",
  rule: "rule-1",
  plan: "plan-monthly",
  planAlt: "plan-yearly",
  order: "order-1",
  visitor: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  user: "user-me",
} as const;

/** Reguła dostępu: domyślnie płatny wpis bez teaserów i bez ceny jednorazowej. */
export function accessRule(overrides: Partial<ContentAccessRule> = {}): ContentAccessRule {
  return {
    id: PAYWALL_IDS.rule,
    entity_type: "post",
    entity_id: PAYWALL_IDS.entity,
    mode: "paid",
    plan_ids: [],
    one_time_price_cents: null,
    one_time_currency: null,
    teaser_pl: null,
    teaser_en: null,
    ...overrides,
  };
}

/** Plan dostępu w kształcie wiersza `access_plans` (kontrakt paywalla i cennika). */
export function accessPlan(overrides: Partial<AccessPlan> = {}): AccessPlan {
  return {
    id: PAYWALL_IDS.plan,
    name_pl: "Miesięczny",
    name_en: "Monthly",
    description_pl: "Pełny dostęp do analiz.",
    description_en: "Full access to analyses.",
    price_cents: 4900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 1,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    ...overrides,
  };
}

/** Konfiguracja meteringu tenanta: włączona, 3 artykuły/mies. dla kont, anonim bez puli. */
export function meterSettings(overrides: Partial<MeteringSettings> = {}): MeteringSettings {
  return {
    enabled: true,
    member_monthly_limit: 3,
    anon_monthly_limit: 0,
    meter_paid: true,
    meter_members: true,
    show_counter: true,
    ...overrides,
  };
}

/** Stan licznika per byt (werdykt consume_metered_view po stronie klienta). */
export function meterState(overrides: Partial<MeterState> = {}): MeterState {
  return {
    granted: true,
    consumed: true,
    used: 1,
    monthlyLimit: 3,
    remaining: 2,
    requiresRegistration: false,
    showCounter: true,
    ...overrides,
  };
}

/** Żywy stan miesiąca (RPC metering_state po zmapowaniu). */
export function meterQuota(overrides: Partial<MeterQuota> = {}): MeterQuota {
  return {
    enabled: true,
    monthlyLimit: 3,
    used: 1,
    remaining: 2,
    requiresRegistration: false,
    showCounter: true,
    ...overrides,
  };
}

// --- surowe wiersze RPC -------------------------------------------------------
// Kształty 1:1 z kontraktem SECURITY DEFINER (snake_case), więc rozjazd kolumny
// w migracji wychodzi w każdym teście hooków, a nie dopiero w runtime.

/** Wiersz `consume_metered_view`: werdykt + (dla granted) odblokowane body. */
export interface ConsumeMeteredViewRow {
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

export function consumeRow(overrides: Partial<ConsumeMeteredViewRow> = {}): ConsumeMeteredViewRow {
  return {
    granted: true,
    consumed: true,
    used: 1,
    monthly_limit: 3,
    remaining: 2,
    requires_registration: false,
    show_counter: true,
    content_pl: "<p>Pełna treść analizy.</p>",
    content_en: null,
    builder_data: null,
    blocks_data: null,
    ...overrides,
  };
}

/** Wiersz `metering_state` (odczyt stanu miesiąca bez konsumpcji). */
export interface MeteringStateRow {
  enabled: boolean;
  monthly_limit: number;
  used: number;
  remaining: number;
  requires_registration: boolean;
  show_counter: boolean;
}

export function meteringStateRow(overrides: Partial<MeteringStateRow> = {}): MeteringStateRow {
  return {
    enabled: true,
    monthly_limit: 3,
    used: 1,
    remaining: 2,
    requires_registration: false,
    show_counter: true,
    ...overrides,
  };
}
