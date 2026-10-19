// KSZTAŁT LEJKA CZYTELNIKA HUBA „PRZYCHÓD I LEJEK" (S3, kontrakt §4.2/§5.2).
//
// MODUŁ CZYSTO TYPOWY - zero wartości w runtime, więc import typu z tego
// pliku (karty huba S7, migawka S6) nie zmienia grafu chunków.
//
// `null` ≠ 0. Agregat SQL (`admin_revenue_funnel`) oddaje `null` tam, gdzie
// liczby NIE DA SIĘ policzyć: ułamek bez mianownika (nikt nie uderzył
// w paywall, nikt nie zaczął płatności), kwoty dla roli bez prawa do kwot
// (editor). Liczności są zawsze liczbą (0 = zmierzyliśmy zero).
import type { MoneyByCurrency } from "@/lib/revenue/money";
import type { PaywallHitReason } from "@/lib/revenue/limits";
import type { RevenueSegment, RevenueTrack } from "@/lib/revenue/search";
import type { SalesFunnelStage, SignupSource } from "./funnelStages";

/** Ułamki w [0, 1]; `null` = zerowy mianownik. */
export interface RevenueFunnelRates {
  /** R2P: konta z okna, które zapłaciły ÷ konta z okna. */
  registeredToPaid: number | null;
  /** PSCR: konta, które zapłaciły po uderzeniu w paywall ÷ konta z uderzeniem. */
  paywallConversion: number | null;
  /** PHR: konta z uderzeniem ÷ aktywne konta. */
  paywallHit: number | null;
  /** CCR: zamówienia z okna opłacone ÷ zamówienia z okna. */
  checkoutConversion: number | null;
  /** CAR = 1 - CCR (ta sama kohorta). */
  checkoutAbandonment: number | null;
  /** Kody kampanii użyte w opłaconym zamówieniu ÷ kody wydane. */
  couponRedemption: number | null;
}

export interface RevenueFunnelSignupSource {
  source: SignupSource;
  accounts: number;
}

export interface RevenueFunnelPaywallReason {
  reason: PaywallHitReason;
  accounts: number;
  visitors: number;
  hits: number;
}

/** Tor samoobsługowy (`_funnel_counts`). */
export interface RevenueFunnelSelfServe {
  accounts: number;
  activeAccounts: number;
  paywallHitAccounts: number;
  paywallHitVisitors: number;
  paywallHits: number;
  paywallConvertedAccounts: number;
  checkoutStarted: number;
  checkoutPaid: number;
  /** Zamówienia z okna bez sukcesu (= started - paid). */
  checkoutAbandoned: number;
  /** Z nich - sesja kasy wygasła (porzucony koszyk). */
  checkoutExpired: number;
  firstPayments: number;
  registeredPaid: number;
  signupFormViews: number;
  signupFormSubmits: number;
  /** Strumień zgody analitycznej - obok lejka, nigdy jako mianownik. */
  visitorsFirstParty: number;
  rates: RevenueFunnelRates;
  /** Kwoty opłaconej kohorty per waluta; `null` = rola bez kwot. */
  paidAmount: MoneyByCurrency[] | null;
  signupSources: RevenueFunnelSignupSource[];
  paywallReasons: RevenueFunnelPaywallReason[];
  /** Pierwszy pomiar paywalla najemcy (ISO); `null` = jeszcze ani jednego. */
  paywallDataSince: string | null;
}

/** Tor sprzedaży (historia etapów cyklu życia w CRM). */
export interface RevenueFunnelSales {
  stages: { stage: SalesFunnelStage; leads: number }[];
  /** Zadania otwarte (bez anulowanych - D11). */
  openTasks: number;
  overdueTasks: number;
  /** Zadania zamknięte w oknie. */
  doneTasks: number;
}

export interface RevenueFunnelDto {
  /** Echo okna `[since, until)` z bazy. */
  since: string;
  until: string;
  segment: RevenueSegment;
  track: RevenueTrack;
  /** Czy rola widzi kwoty (admin). Editor: `false`, a `paidAmount` = `null`. */
  amountsVisible: boolean;
  /** `null`, gdy tor nie obejmuje samoobsługi. */
  selfServe: RevenueFunnelSelfServe | null;
  /** `null`, gdy tor nie obejmuje sprzedaży. */
  sales: RevenueFunnelSales | null;
}

/**
 * Wynik odczytu dla panelu. Odmowa roli i brak funkcji w bazie są STANAMI
 * karty, a nie wyjątkami: ponowienie ich nie naprawi.
 */
export type RevenueFunnelRead =
  | { state: "ready"; funnel: RevenueFunnelDto }
  /** 42501 - rola bez dostępu do lejka (autor). */
  | { state: "forbidden" }
  /** Funkcji jeszcze nie ma w bazie (migracja w drodze). */
  | { state: "unavailable" };
