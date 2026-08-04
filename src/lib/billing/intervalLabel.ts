// Jedno źródło etykiety cyklu rozliczeniowego (karta planu, strona szczegółów
// planu, podsumowanie checkoutu). Wyczerpujący switch po `plan_interval` -
// dodanie nowej wartości enuma w DB obleje typecheck zamiast cicho wypaść.
import type { AccessPlan } from "@/lib/billing/types";

export function intervalLabel(
  interval: AccessPlan["interval"],
  t: (key: string) => string,
): string {
  switch (interval) {
    case "day":
      return t("pricing.perDay");
    case "week":
      return t("pricing.perWeek");
    case "two_weeks":
      return t("pricing.perTwoWeeks");
    case "month":
      return t("pricing.perMonth");
    case "quarter":
      return t("pricing.perQuarter");
    case "year":
      return t("pricing.perYear");
    case "one_time":
      return t("pricing.perOnce");
  }
}
