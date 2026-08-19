// Jedno źródło etykiety cyklu rozliczeniowego (karta planu, strona szczegółów
// planu, podsumowanie checkoutu, karta warstwy w cenniku).
//
// Mapa jest DESKRYPTOREM: zwraca KLUCZ słownika, nie gotowy napis. Powód jest
// praktyczny - ten sam cykl trzeba pokazać w czterech miejscach, raz jako
// samodzielny podpis („miesięcznie"), raz jako sufiks przy kwocie („/ mies."),
// a odmiana i skrót należą do słownika, nie do kodu. Wyczerpujący `Record` po
// `plan_interval` obleje typecheck, gdy w bazie pojawi się nowa wartość enuma -
// zamiast cicho wypaść z etykiety.
import type { AccessPlan } from "@/lib/billing/types";

const INTERVAL_KEY: Record<AccessPlan["interval"], string> = {
  day: "pricing.perDay",
  week: "pricing.perWeek",
  two_weeks: "pricing.perTwoWeeks",
  month: "pricing.perMonth",
  quarter: "pricing.perQuarter",
  year: "pricing.perYear",
  one_time: "pricing.perOnce",
};

/** Klucz słownika dla cyklu - do miejsc, które same wołają `t()`. */
export function intervalLabelKey(interval: AccessPlan["interval"]): string {
  return INTERVAL_KEY[interval];
}

/** Gotowa etykieta cyklu dla podanego `t`. */
export function intervalLabel(
  interval: AccessPlan["interval"],
  t: (key: string) => string,
): string {
  return t(intervalLabelKey(interval));
}
