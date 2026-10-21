// Kroki „Zacznij tutaj" Kokpitu z faktów diagnostyki (SPEC §2.2 `overview`).
//
// PO CO. Nowy najemca otwiera hub i widzi same kreski: bez planu w sprzedaży,
// ustawień licznika, retencji i silnika ścieżek hub nie ma czego mierzyć.
// Karta zamienia te braki w listę kroków z odnośnikami do EKRANÓW-WŁAŚCICIELI
// (SPEC §2.6) - hub niczego tu nie zapisuje sam.
//
// Z FAKTÓW S7-A, BEZ WŁASNYCH ZAPYTAŃ. Te same fakty czyta „Wymaga uwagi"
// i Diagnostyka (`revenueKeys.facts`), więc karta nie kosztuje żądania.
// Fakt nieobecny (obszar `null`, pole `undefined`) to krok „nie wiadomo",
// nigdy „gotowe" - brak odczytu nie może udawać skonfigurowanego serwisu.
//
// MODUŁ CZYSTY (wyłącznie `import type`).
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";

export const GETTING_STARTED_STEPS = ["plans", "metering", "retention", "journeys"] as const;
export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number];

export type GettingStartedStatus = "done" | "todo" | "unknown";

export interface GettingStartedLink {
  to: string;
  search?: Readonly<Record<string, string>>;
}

export interface GettingStartedStep {
  id: GettingStartedStepId;
  status: GettingStartedStatus;
  link: GettingStartedLink;
}

/** Ekran-właściciel każdego kroku (kontrakt deep linków SPEC §2.6). */
export const GETTING_STARTED_LINKS: Readonly<Record<GettingStartedStepId, GettingStartedLink>> = {
  plans: { to: "/admin/paywall", search: { tab: "plans" } },
  metering: { to: "/admin/paywall", search: { tab: "metering" } },
  retention: { to: "/admin/pricing", search: { tab: "retention" } },
  journeys: { to: "/admin/revenue/journeys" },
};

function plansStatus(facts: RevenueFacts): GettingStartedStatus {
  const plans = facts.areas.catalog?.plans;
  if (plans === undefined) return "unknown";
  return plans.some((plan) => plan.active && plan.forSale) ? "done" : "todo";
}

function meteringStatus(facts: RevenueFacts): GettingStartedStatus {
  const row = facts.areas.metering?.settingsRow;
  if (row === undefined) return "unknown";
  return row ? "done" : "todo";
}

function retentionStatus(facts: RevenueFacts): GettingStartedStatus {
  const retention = facts.areas.retention;
  if (retention?.settingsRow === undefined) return "unknown";
  if (!retention.settingsRow) return "todo";
  if (retention.enabled === undefined || retention.enabled === null) return "unknown";
  return retention.enabled ? "done" : "todo";
}

function journeysStatus(facts: RevenueFacts): GettingStartedStatus {
  const enabled = facts.areas.journeys?.engineEnabled;
  if (enabled === undefined) return "unknown";
  return enabled ? "done" : "todo";
}

const STATUS_OF: Readonly<
  Record<GettingStartedStepId, (facts: RevenueFacts) => GettingStartedStatus>
> = {
  plans: plansStatus,
  metering: meteringStatus,
  retention: retentionStatus,
  journeys: journeysStatus,
};

/** Kroki w stałej kolejności (najpierw to, bez czego nie ma sprzedaży). */
export function gettingStartedSteps(facts: RevenueFacts): GettingStartedStep[] {
  return GETTING_STARTED_STEPS.map((id) => ({
    id,
    status: STATUS_OF[id](facts),
    link: GETTING_STARTED_LINKS[id],
  }));
}

/**
 * Karta pojawia się, gdy choć jeden krok jest do zrobienia. Serwis
 * skonfigurowany (same „gotowe" i „nie wiadomo") jej nie widzi - „Zacznij
 * tutaj" dla działającego serwisu byłoby szumem nad „Wymaga uwagi".
 */
export function needsGettingStarted(steps: readonly GettingStartedStep[]): boolean {
  return steps.some((step) => step.status === "todo");
}
