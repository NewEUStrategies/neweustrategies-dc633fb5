// Model karty warstwy - decyzje CENY i PRZYCISKU ZAKUPU jako czyste dane.
//
// DLACZEGO TO ISTNIEJE. `TierCard.tsx` miał 476 linii, w których dwa automaty
// stanów siedziały wprost w JSX-ie: co pokazać w miejscu ceny (bezpłatnie /
// kwota / „na zapytanie" / „tylko na zaproszenie") i który przycisk dostaje
// klient (checkout / rozmowa z zespołem / rejestracja / wsparcie / żaden).
// Razem kilkanaście gałęzi, z których żadnej nie dało się sprawdzić bez
// wyrenderowania całej karty razem z routerem, i18n oraz analityką.
//
// A to najdroższe reguły w całym module: przycisk decyduje, CZY klient może
// kupić, a blok ceny - ILE widzi. Pomyłka nie wywala strony; po cichu zabiera
// przychód (brak przycisku) albo obiecuje złą kwotę.
//
// Deskryptory zwracają KLUCZ tłumaczenia i LICZBY, nigdy gotowego napisu -
// formatowanie kwoty i odmiana okresu należą do warstwy prezentacji i do
// słownika (patrz `lib/i18n/format`). Dzięki temu ta reguła jest jedna dla obu
// języków, a testy nie zależą od ICU.
import type { AccessPlan } from "@/lib/billing/types";
import type { MembershipTierRow, TierBenefit } from "@/lib/billing/tiers";
import {
  benefitText,
  intervalPair,
  pickPlanForInterval,
  tierCtaMode,
  tierPriceNote,
  yearlySavingsPct,
  type BillingInterval,
} from "@/lib/pricing/selectors";

// --- BLOK CENY --------------------------------------------------------------

/** Klucz sufiksu okresu w słowniku cennika (`pricing.perMonth` itd.). */
const INTERVAL_SUFFIX_KEY: Record<AccessPlan["interval"], string> = {
  day: "pricing.perDay",
  week: "pricing.perWeek",
  two_weeks: "pricing.perTwoWeeks",
  month: "pricing.perMonth",
  quarter: "pricing.perQuarter",
  year: "pricing.perYear",
  one_time: "pricing.perOnce",
};

/** Sufiks okresu jako KLUCZ, nie napis - odmiana należy do słownika. */
export function intervalSuffixKey(interval: AccessPlan["interval"]): string {
  return INTERVAL_SUFFIX_KEY[interval];
}

export type PriceDisplay =
  /** Warstwa domyślna - dostęp bez płatności. */
  | { kind: "free"; note: string | null }
  /** Brak planu i `cta_mode='none'` - wartość leży w niedostępności. */
  | { kind: "invitationOnly"; note: string | null }
  /** Brak planu w sprzedaży samoobsługowej - oferta po rozmowie. */
  | { kind: "onRequest"; note: string | null }
  /** Konkretna kwota - dokładnie ta, którą pobierze operator płatności. */
  | {
      kind: "amount";
      cents: number;
      currency: string;
      intervalKey: string;
      /** Cena „od" - plan rozliczany za miejsce. */
      fromPrefix: boolean;
      /** Dopisek „za miejsce" przy okresie. */
      perSeat: boolean;
      /** Realna oszczędność planu rocznego wobec dwunastu miesięcznych. */
      savingsPct: number | null;
      note: string | null;
    };

/**
 * Co pokazać w miejscu ceny. Kolejność gałęzi jest regułą, nie przypadkiem:
 * warstwa DOMYŚLNA jest bezpłatna niezależnie od tego, czy ktoś przypisał do
 * niej plan, a „tylko na zaproszenie" wyprzedza „na zapytanie", bo w tym trybie
 * nie ma czego pytać.
 */
export function priceDisplay(
  tier: MembershipTierRow,
  plans: AccessPlan[],
  interval: BillingInterval,
  lang: string,
): PriceDisplay {
  const note = tierPriceNote(tier, lang);
  if (tier.is_default) return { kind: "free", note };

  const plan = pickPlanForInterval(plans, interval);
  if (!plan) {
    return tierCtaMode(tier) === "none"
      ? { kind: "invitationOnly", note }
      : { kind: "onRequest", note };
  }

  // Procent oszczędności liczymy WYŁĄCZNIE dla planu rocznego i tylko wtedy,
  // gdy w tej samej walucie istnieje plan miesięczny - inaczej „oszczędzasz X%"
  // byłoby liczbą bez odniesienia.
  const savingsPct =
    plan.interval === "year"
      ? (() => {
          const pair = intervalPair(plans);
          return yearlySavingsPct(pair.month, pair.year);
        })()
      : null;

  return {
    kind: "amount",
    cents: plan.price_cents,
    currency: plan.currency,
    intervalKey: intervalSuffixKey(plan.interval),
    fromPrefix: tier.per_seat,
    perSeat: tier.per_seat,
    savingsPct,
    note,
  };
}

// --- PRZYCISK ZAKUPU -------------------------------------------------------

export type CtaDescriptor =
  /** Bez przycisku - „tylko na zaproszenie" albo zalogowany na warstwie domyślnej. */
  | { kind: "none" }
  /** Klient ma DOKŁADNIE ten plan - przycisk wyłączony. */
  | { kind: "currentPlan" }
  /** Klient jest na tej warstwie (innym planem) - przycisk wyłączony. */
  | { kind: "currentTier" }
  /** Warstwa domyślna dla niezalogowanego - rejestracja, nie płatność. */
  | { kind: "signup" }
  /** Zakup przez rozmowę, adres wskazany przez redakcję. */
  | { kind: "contactLink"; href: string }
  /** Zakup przez rozmowę, formularz w oknie. */
  | { kind: "contactDialog" }
  /** Zakup samoobsługowy - checkout konkretnego planu. */
  | { kind: "checkout"; planId: string; priceCents: number; currency: string }
  /** Warstwa wspierająca - darowizna, nie subskrypcja. */
  | { kind: "supporter" };

/**
 * Który przycisk dostaje klient. Kolejność gałęzi jest kontraktem:
 *
 *   1. `cta_mode='none'` wygrywa ZAWSZE - warstwy zamkniętej nie da się kupić
 *      ani „zapytać o ofertę", nawet gdy ktoś przypisał do niej plan.
 *   2. Warstwa DOMYŚLNA nie ma checkoutu; niezalogowany dostaje rejestrację,
 *      zalogowany - nic (już ją ma).
 *   3. `cta_mode='contact'` wyprzedza checkout, nawet gdy plan istnieje:
 *      sprzedaż per miejsce przez checkout jednego miejsca byłaby nieuczciwa.
 *   4. Stan „to jest twój plan" wyprzedza zakup - inaczej klient kupiłby
 *      drugi raz to samo.
 */
export function ctaDescriptor(input: {
  tier: MembershipTierRow;
  plans: AccessPlan[];
  interval: BillingInterval;
  isCurrentTier: boolean;
  currentPlanId: string | null;
  isAuthenticated: boolean;
}): CtaDescriptor {
  const { tier, plans, interval, isCurrentTier, currentPlanId, isAuthenticated } = input;
  const mode = tierCtaMode(tier);

  if (mode === "none") return { kind: "none" };

  if (tier.is_default) {
    if (isCurrentTier) return { kind: "currentTier" };
    return isAuthenticated ? { kind: "none" } : { kind: "signup" };
  }

  if (mode === "contact") {
    if (isCurrentTier) return { kind: "currentTier" };
    return tier.contact_url
      ? { kind: "contactLink", href: tier.contact_url }
      : { kind: "contactDialog" };
  }

  const plan = pickPlanForInterval(plans, interval);
  if (plan) {
    if (currentPlanId === plan.id) return { kind: "currentPlan" };
    if (isCurrentTier) return { kind: "currentTier" };
    return {
      kind: "checkout",
      planId: plan.id,
      priceCents: plan.price_cents,
      currency: plan.currency,
    };
  }

  // Warstwa bez planu w sprzedaży samoobsługowej.
  if (tier.key === "supporter") return { kind: "supporter" };
  if (isCurrentTier) return { kind: "currentTier" };
  return tier.contact_url
    ? { kind: "contactLink", href: tier.contact_url }
    : { kind: "contactDialog" };
}

/** Wariant wizualny przycisku - wyróżniona warstwa dostaje pełny kolor. */
export function ctaVariant(tier: Pick<MembershipTierRow, "highlight">): "default" | "outline" {
  return tier.highlight ? "default" : "outline";
}

// --- BENEFITY ---------------------------------------------------------------

/** Ile pozycji zostaje pod spotlightem - z wyróżnieniami mniej, bez nich więcej. */
const REST_CAP_WITH_HIGHLIGHTS = 4;
const REST_CAP_WITHOUT_HIGHLIGHTS = 8;

/**
 * Podział benefitów na spotlight („Co wyróżnia ten plan") i pozostałe.
 *
 * Reguła, o którą tu chodzi: benefit użyty w spotlighcie NIE MOŻE wrócić na
 * pełnej liście - klient widzi każdy punkt dokładnie raz. Porównanie idzie po
 * znormalizowanym tekście W JĘZYKU STRONY, bo to ten tekst czyta klient (ta sama
 * obietnica wpisana raz z wielką, raz z małą literą to jedna obietnica).
 */
export function splitBenefits(
  all: TierBenefit[],
  highlights: TierBenefit[] | undefined,
  lang: string,
): { highlights: TierBenefit[]; rest: TierBenefit[] } {
  const spotlight = highlights ?? [];
  const norm = (value: string): string => value.trim().toLowerCase();
  const shown = new Set(spotlight.map((benefit) => norm(benefitText(benefit, lang))));
  const rest = all.filter((benefit) => !shown.has(norm(benefitText(benefit, lang))));
  const cap = spotlight.length > 0 ? REST_CAP_WITH_HIGHLIGHTS : REST_CAP_WITHOUT_HIGHLIGHTS;
  return { highlights: spotlight, rest: rest.slice(0, cap) };
}
