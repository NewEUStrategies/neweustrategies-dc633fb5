// Model szkicu planu dostępu (`access_plans`) - czysta logika edytora
// `AccessPlanEditorDialog` i listy `PaywallPlansSection`, bez Reacta.
//
// DLACZEGO OSOBNY MODUŁ. Reguły szkicu (co trafia do patcha, cena w
// jednostkach głównych, rebase po konflikcie `40001`) testujemy na macierzy
// przypadków, a hub S7 (macierz planów, drabina cen) liczy z nich to samo co
// paywall. Wspólne eksporty w pliku komponentu łamały Fast Refresh (plik
// komponentu ma eksportować tylko komponenty) - edycja formularza
// przeładowywała wtedy cały moduł zamiast samego komponentu.
import type { Json } from "@/integrations/supabase/types";
import { exactCatalogEntryForPlan } from "@/lib/billing/catalog";
import {
  centsToMoneyInput,
  parseMoneyInput,
  type MoneyDecimalSeparator,
} from "@/lib/billing/moneyInput";
import type { AccessPlanPatch, AccessPlanRow } from "@/lib/billing/planQueries";

export type PlanInterval = AccessPlanRow["interval"];

/**
 * Cykle w kolejności listy. `Record<PlanInterval, true>` wymusza KOMPLETNOŚĆ:
 * nowa wartość enumu `plan_interval` w `types.ts` bez wpisu tutaj to błąd
 * kompilacji, a nie plan, którego cyklu nie da się wybrać.
 */
const INTERVALS: Record<PlanInterval, true> = {
  month: true,
  quarter: true,
  year: true,
  two_weeks: true,
  one_time: true,
};
export const PLAN_INTERVALS = Object.keys(INTERVALS) as PlanInterval[];

/** Waluty kasy (te same co ceny biletów i przelicznik wyświetlania). */
export const PLAN_CURRENCIES = ["PLN", "EUR"] as const;

/** Szkic formularza - to, co admin widzi; kolumny bazy liczy `planColumns`. */
export interface PlanDraft {
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
  /** Cena w JEDNOSTKACH GŁÓWNYCH, tekst pola („19,00"). */
  price: string;
  currency: string;
  interval: PlanInterval;
  trial_days: number;
  sort_order: number;
  active: boolean;
  for_sale: boolean;
  highlighted: boolean;
  badge_pl: string;
  badge_en: string;
  /** Funkcje jako tekst pola (jedna w linii) - lista powstaje dopiero przy zapisie. */
  features_pl: string;
  features_en: string;
}

type PlanColumns = Required<AccessPlanPatch<"paywall">>;
type EditedColumn = Exclude<keyof PlanColumns, "volume_price_cents" | "volume_threshold_seats">;
type EditedColumns = Pick<PlanColumns, EditedColumn>;

function featureLines(value: Json): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : "";
}

/** Nowy plan - te same wartości startowe co dawny formularz (19 zł/mies., aktywny). */
export function emptyPlanDraft(separator: MoneyDecimalSeparator = ","): PlanDraft {
  return {
    name_pl: "",
    name_en: "",
    description_pl: "",
    description_en: "",
    price: centsToMoneyInput(1900, separator),
    currency: "PLN",
    interval: "month",
    trial_days: 0,
    sort_order: 0,
    active: true,
    for_sale: true,
    highlighted: false,
    badge_pl: "",
    badge_en: "",
    features_pl: "",
    features_en: "",
  };
}

export function draftFromPlan(
  plan: AccessPlanRow,
  separator: MoneyDecimalSeparator = ",",
): PlanDraft {
  return {
    name_pl: plan.name_pl,
    name_en: plan.name_en,
    description_pl: plan.description_pl ?? "",
    description_en: plan.description_en ?? "",
    price: centsToMoneyInput(plan.price_cents, separator),
    currency: plan.currency,
    interval: plan.interval,
    trial_days: plan.trial_days,
    sort_order: plan.sort_order,
    active: plan.active,
    for_sale: plan.for_sale,
    highlighted: plan.highlighted,
    badge_pl: plan.badge_pl ?? "",
    badge_en: plan.badge_en ?? "",
    features_pl: featureLines(plan.features_pl),
    features_en: featureLines(plan.features_en),
  };
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Szkic → kolumny bazy (znormalizowane). `null` = cena nieczytelna. Ta sama
 * normalizacja stoi po obu stronach różnicy w `planPatch`, więc pusty opis
 * (`null` w bazie, `""` w polu) nie jest „zmianą", a patch niesie tylko to,
 * co admin naprawdę zmienił.
 */
export function planColumns(draft: PlanDraft): EditedColumns | null {
  const price = parseMoneyInput(draft.price);
  if (price === null) return null;
  return {
    name_pl: draft.name_pl.trim(),
    name_en: draft.name_en.trim(),
    description_pl: draft.description_pl.trim() || null,
    description_en: draft.description_en.trim() || null,
    price_cents: price,
    currency: draft.currency.trim().toUpperCase(),
    interval: draft.interval,
    trial_days: Math.max(0, Math.round(draft.trial_days) || 0),
    sort_order: Math.round(draft.sort_order) || 0,
    active: draft.active,
    for_sale: draft.for_sale,
    highlighted: draft.highlighted,
    badge_pl: draft.badge_pl.trim() || null,
    badge_en: draft.badge_en.trim() || null,
    features_pl: splitLines(draft.features_pl),
    features_en: splitLines(draft.features_en),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Patch = kolumny, w których szkic różni się od wiersza bazowego. */
export function planPatch(draft: EditedColumns, base: EditedColumns): AccessPlanPatch<"paywall"> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as EditedColumn[]) {
    if (!same(draft[key], base[key])) patch[key] = draft[key];
  }
  return patch as AccessPlanPatch<"paywall">;
}

/**
 * Szkic nałożony na świeży wiersz (po konflikcie): pola, które admin zmienił
 * względem STAREJ bazy, wygrywają; reszta przychodzi z bazy świeżej - tam
 * siedzi cudza zmiana, której admin nie dotykał.
 */
export function rebaseDraft(draft: PlanDraft, oldBase: PlanDraft, freshBase: PlanDraft): PlanDraft {
  const out: PlanDraft = { ...freshBase };
  for (const key of Object.keys(draft) as (keyof PlanDraft)[]) {
    if (!same(draft[key], oldBase[key])) Object.assign(out, { [key]: draft[key] });
  }
  return out;
}

/**
 * Plan w sprzedaży, którego kasa nie umie sprzedać: brak pozycji katalogu dla
 * pary (warstwa, cykl). Jednorazowe zakupy idą własną ścieżką ceny, a plan
 * wycofany nie przyjmuje nowych zakupów - żaden z nich nie trafi na
 * `plan_price_missing`.
 */
export function planMissingCatalogPair(
  plan: Pick<AccessPlanRow, "for_sale" | "interval" | "tier_key">,
): boolean {
  return plan.for_sale && plan.interval !== "one_time" && exactCatalogEntryForPlan(plan) === null;
}
