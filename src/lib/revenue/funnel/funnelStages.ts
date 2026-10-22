// ETAPY LEJKA CZYTELNIKA HUBA „PRZYCHÓD I LEJEK" (S3) - kontrakt kroków,
// źródeł rejestracji i etapów toru sprzedaży.
//
// JEDNO ŹRÓDŁO KOLEJNOŚCI. Mapa lejka (S7, `FunnelStageMap`), kafle kokpitu
// i migawka BI czytają tę samą listę: inaczej każdy ekran układałby kroki po
// swojemu, a „konwersja paywalla" w kokpicie znaczyłaby co innego niż na
// zakładce Lejek.
//
// STRUMIEŃ PRZY KAŻDYM KROKU. Odwiedzający pochodzą z analityki ze zgodą
// (`first_party`), reszta - z księgi (`lifecycle`). Iloraz przez granicę
// strumieni dzieliłby dwie różne populacje, więc `FunnelBars` pokazuje tam
// powód zamiast procentu (reguła `assertSameStreamRatio`, S6) - stąd pole
// `stream` w definicji, a nie w komponencie.
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (wyłącznie `import type`): moduł czytają serwer,
// testy i panel; nie może wciągnąć klienta bazy ani React Query.
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import type { StreamId } from "@/lib/analytics/semantic/streams";
import type { RevenueFunnelDto, RevenueFunnelSelfServe } from "./dto";

/** Kroki lejka samoobsługowego w kolejności mapy. */
export const REVENUE_FUNNEL_STAGES = [
  "visitors",
  "accounts",
  "paywall",
  "checkout",
  "paid",
] as const;
export type RevenueFunnelStage = (typeof REVENUE_FUNNEL_STAGES)[number];

/** Liczba kroku w DTO - nazwa pola, żeby definicja nie duplikowała parsera. */
type CountField = Extract<
  keyof RevenueFunnelSelfServe,
  "visitorsFirstParty" | "accounts" | "paywallHitAccounts" | "checkoutStarted" | "checkoutPaid"
>;

export interface RevenueFunnelStageDef {
  readonly stage: RevenueFunnelStage;
  readonly count: CountField;
  readonly stream: Extract<StreamId, "first_party" | "lifecycle">;
  /**
   * Odwiedzający są obok lejka, NIGDY mianownikiem: to inna populacja
   * (tylko osoby ze zgodą analityczną), a nie „pierwszy krok" tych samych ludzi.
   */
  readonly separate: boolean;
  /** Wskaźnik rejestru S6, który opisuje przejście DO tego kroku. */
  readonly metricId: MetricId | null;
}

export const REVENUE_FUNNEL_STAGE_DEFS: readonly RevenueFunnelStageDef[] = [
  {
    stage: "visitors",
    count: "visitorsFirstParty",
    stream: "first_party",
    separate: true,
    metricId: null,
  },
  { stage: "accounts", count: "accounts", stream: "lifecycle", separate: false, metricId: null },
  {
    stage: "paywall",
    count: "paywallHitAccounts",
    stream: "lifecycle",
    separate: false,
    metricId: "paywall_hit_rate",
  },
  // Start kasy liczy ZAMÓWIENIA, uderzenia w paywall - KONTA: iloraz tych
  // dwóch liczb nie jest żadnym wskaźnikiem, więc krok nie ma ani udziału,
  // ani wskaźnika. Konwersję paywalla (PSCR) pokazuje para z PHR.
  {
    stage: "checkout",
    count: "checkoutStarted",
    stream: "lifecycle",
    separate: false,
    metricId: null,
  },
  {
    stage: "paid",
    count: "checkoutPaid",
    stream: "lifecycle",
    separate: false,
    metricId: "checkout_conversion_rate",
  },
];

/**
 * Źródła rejestracji z białej listy `account.registered.v1` - LUSTRO listy
 * w migracji 20261020120000 (i w `_funnel_counts`). Test parytetu czyta obie
 * migracje: źródło dopisane tylko tutaj dawałoby w hubie zawsze zero,
 * dopisane tylko w SQL - surowy klucz w panelu.
 */
export const SIGNUP_SOURCES = [
  "auth_page",
  "login_popup",
  "popup",
  "club_gate",
  "register_widget",
  "paywall",
  "pricing",
  "checkout",
  "club_apply",
  "join_us_form",
] as const;
export type SignupSource = (typeof SIGNUP_SOURCES)[number] | "unknown";

export function isSignupSource(raw: unknown): raw is SignupSource {
  return raw === "unknown" || (SIGNUP_SOURCES as readonly unknown[]).includes(raw);
}

/** Etapy toru sprzedaży (historia `lifecycle` w CRM) w kolejności lejka. */
export const SALES_FUNNEL_STAGES = ["lead", "mql", "sql", "opportunity", "customer"] as const;
export type SalesFunnelStage = (typeof SALES_FUNNEL_STAGES)[number];

/**
 * Para wskaźników paywalla - zasięg (PHR) i konwersja (PSCR) zawsze razem:
 * sam wysoki zasięg nie mówi, czy ściana sprzedaje, a sama konwersja - na
 * jak małej próbie stoi (SPEC §2.2, zakładka Lejek).
 */
export const PAYWALL_PAIR_METRICS = ["paywall_hit_rate", "paywall_conversion_rate"] as const;

/** Krok gotowy do narysowania (`FunnelBars`) - bez etykiety (tłumaczy panel). */
export interface RevenueFunnelStep {
  readonly stage: RevenueFunnelStage;
  readonly value: number | null;
  /** Udział w poprzednim kroku tego samego strumienia; `null` = brak mianownika. */
  readonly rate: number | null;
  readonly stream: RevenueFunnelStageDef["stream"];
  readonly separate: boolean;
  readonly metricId: MetricId | null;
}

/**
 * Kroki lejka z DTO. Udział liczony WYŁĄCZNIE wewnątrz strumienia księgi;
 * dla przejść, które SQL liczy kohortowo (zasięg paywalla względem AKTYWNYCH
 * kont, konwersja kasy na kohorcie startu), bierzemy ułamek z SQL, a nie
 * prosty iloraz sąsiednich liczb - inaczej mapa pokazywałaby inną liczbę niż
 * kafel tego samego wskaźnika.
 */
export function revenueFunnelSteps(dto: RevenueFunnelDto | null): RevenueFunnelStep[] {
  const self = dto?.selfServe ?? null;
  return REVENUE_FUNNEL_STAGE_DEFS.map((def) => {
    const value = self ? self[def.count] : null;
    let rate: number | null = null;
    if (self) {
      if (def.stage === "paywall") rate = self.rates.paywallHit;
      else if (def.stage === "paid") rate = self.rates.checkoutConversion;
    }
    return {
      stage: def.stage,
      value,
      rate,
      stream: def.stream,
      separate: def.separate,
      metricId: def.metricId,
    };
  });
}
