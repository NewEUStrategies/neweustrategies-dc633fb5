// Bramka dostępu do klubu - DESKRYPTOR STANU. Czysty moduł, zero React.
//
// DLACZEGO TO WYSZŁO Z KOMPONENTU. Reguły dostępu do klubu są w tym repo
// dowiedzione: `capabilityMatrix`, `hubAccess`, `minisiteAccess` i 19 plików
// pgTAP mają własne testy. Nie była dowiedziona ich PREZENTACJA - a to ona
// decyduje, czy ktoś zobaczy formularz rejestracji, upsell do wyższego planu,
// czy prośbę o dostęp. `ClubAccessGate.tsx` (493 linie) stał na 0%, a reguły
// siedziały w ciele komponentu wymieszane z JSX-em i z formularzem rejestracji.
//
// Trzy decyzje są tu nietrywialne i każda ma widoczny skutek:
//
//   1. CZEGO SPRZEDAJEMY. Bramka nigdy nie sprzedaje planu „free" ani „plus" -
//      najniższy sensowny próg to domyślny próg klubu (PRO), inaczej wezwanie
//      do działania brzmi jak zaproszenie donikąd. Etykieta idzie ze SŁOWNIKA
//      progów, nie z lokalnej mapy: po rozszerzeniu katalogu o rangi 30-60
//      (corporate, partner, partner_general, presidents_circle) lokalna mapa
//      pokazywała „PRO" albo puste miejsce.
//
//   2. KTO MOŻE PROSIĆ O DOSTĘP. Ekspert to JEDYNA ścieżka wejścia bez planu:
//      odznaka `expert` jest nadawana redakcyjnie, więc prośba ma wtedy sens.
//      Wszyscy pozostali bez wymaganego planu widzą wyłącznie upsell -
//      zgłoszenie bez planu i tak nie mogłoby zostać przyjęte.
//
//   3. CO ZNACZY „ZA NISKI PLAN" DLA ANONIMA. Osoba niezalogowana jest
//      traktowana jak osoba z za niskim planem, bo z punktu widzenia bramki
//      to ten sam stan: nie ma czym wejść. Różni je tylko AKCJA (rejestracja
//      zamiast upsellu).
//
// Deskryptor zwraca KLUCZE i18n, nie gotowe zdania - odmiana i copy zostają
// w słowniku PL/EN, a test reguły nie zależy od treści.
import { DEFAULT_CLUB_PLAN_TIER, planTierFromRank, type ClubPlanTier } from "./planTiers";

/** Minimum, którego bramka potrzebuje z karty klubu. */
export interface ClubGateClub {
  /** Ranga progu planu; brak = 0, czyli „free". */
  min_tier_rank: number | null;
  /** `tier_too_low` znaczy: konto jest, ale plan nie sięga progu. */
  reason: string | null;
  /** `open` = dołącz od razu, `request` = poproś, `invite` = tylko zaproszenie. */
  join_policy: string;
}

export interface ClubGateInput {
  club: ClubGateClub;
  /** Sesja rozstrzygnięta i niepusta. */
  signedIn: boolean;
  /** Odznaka `expert` na profilu - redakcyjna ścieżka wejścia bez planu. */
  isExpert: boolean;
}

/** Akcja pokazywana w kolumnie działania. Kolejność listy = kolejność na ekranie. */
export type ClubGateAction =
  | { kind: "signup" }
  | { kind: "upgrade"; ctaKey: "clubGate.upgradeCta" }
  | { kind: "plans"; ctaKey: "clubGate.plansCta" }
  | { kind: "request"; ctaKey: "clubGate.joinCta" | "clubGate.requestCta"; muted: boolean };

export interface ClubGateView {
  /** Plan, który bramka SPRZEDAJE (nie zawsze równy progowi klubu). */
  sellTier: ClubPlanTier;
  /** Klucz etykiety planu w słowniku progów. */
  planLabelKey: string;
  /** Zdanie wiodące nad listą korzyści. */
  leadKey: "clubGate.anonLead" | "clubGate.upgradeLead" | "clubGate.joinLead";
  /** Plan nie sięga progu klubu ALBO nikt nie jest zalogowany. */
  tierTooLow: boolean;
  /** Wolno poprosić o dostęp (plan wystarcza albo odznaka eksperta). */
  canRequest: boolean;
  /** Pokaż notkę „masz odznakę eksperta, więc prośba ma sens". */
  showExpertNote: boolean;
  /** Pokaż zdanie „tu wchodzi się wyłącznie przez podniesienie planu". */
  showUpgradeOnlyNote: boolean;
  actions: readonly ClubGateAction[];
}

/**
 * Rozstrzyga, CO bramka pokazuje. Kolejność akcji w tablicy jest kolejnością
 * na ekranie - pierwszą pozycją jest zawsze ta, którą chcemy, żeby kliknięto.
 */
export function clubGateView(input: ClubGateInput): ClubGateView {
  const { club, signedIn, isExpert } = input;

  const tier = planTierFromRank(club.min_tier_rank ?? 0);
  // Progi poniżej domyślnego nie są ofertą: klub „za darmo" i tak nie
  // bramkowałby wejścia, więc sprzedajemy najniższy próg, który coś znaczy.
  const sellTier: ClubPlanTier = tier === "free" || tier === "plus" ? DEFAULT_CLUB_PLAN_TIER : tier;

  const tierTooLow = club.reason === "tier_too_low" || !signedIn;
  const canRequest = club.join_policy !== "invite" && (!tierTooLow || isExpert);

  const leadKey = !signedIn
    ? ("clubGate.anonLead" as const)
    : tierTooLow
      ? ("clubGate.upgradeLead" as const)
      : ("clubGate.joinLead" as const);

  const actions: ClubGateAction[] = [];
  if (!signedIn) {
    actions.push({ kind: "signup" });
  } else {
    if (tierTooLow) {
      actions.push({ kind: "upgrade", ctaKey: "clubGate.upgradeCta" });
      actions.push({ kind: "plans", ctaKey: "clubGate.plansCta" });
    }
    if (canRequest) {
      actions.push({
        kind: "request",
        ctaKey: club.join_policy === "open" ? "clubGate.joinCta" : "clubGate.requestCta",
        // Przy za niskim planie prośba jest drugorzędna wobec upsellu, więc
        // przycisk jest wyciszony - ale nadal obecny, bo ekspert wejdzie tędy.
        muted: tierTooLow,
      });
    }
  }

  return {
    sellTier,
    planLabelKey: `club.planTier.${sellTier}`,
    leadKey,
    tierTooLow,
    canRequest,
    // Notka eksperta stoi NAD przyciskiem prośby i tłumaczy, dlaczego ten
    // przycisk w ogóle tu jest mimo za niskiego planu. Bez `canRequest`
    // pojawiałaby się także w klubie „tylko z zaproszenia", gdzie żadnej
    // prośby nie ma - czyli wyjaśniałaby nieistniejący przycisk.
    showExpertNote: signedIn && tierTooLow && isExpert && canRequest,
    showUpgradeOnlyNote: signedIn && tierTooLow && !canRequest,
    actions,
  };
}

/** Katalog korzyści pokazywanych w kolumnie wartości - stała kolejność. */
export const CLUB_GATE_BENEFITS = [
  "threads",
  "library",
  "calendar",
  "network",
  "chatham",
  "briefs",
] as const;

export type ClubGateBenefit = (typeof CLUB_GATE_BENEFITS)[number];
