// LICZNIK PASKA HUBA „Ścieżki = aktywne” (Z-S6-08) - osobny liść.
//
// DLACZEGO NIE W `summaries.ts`. Licznik czyta układ huba
// (`RevenueHubLayout`), który ładuje się na KAŻDEJ zakładce. Bundler przydziela
// chunkom całe moduły: import z `summaries.ts` przeniósłby do grafu układu
// opisy kroków, paletę i fakty szablonów (z `graph`/`ops`/`triggers`), które
// potrzebne są dopiero w zakładce Ścieżek i w edytorze. Liść ma wyłącznie
// import typu, a `summaries.ts` re-eksportuje tę samą funkcję - jedno źródło.
import type { JourneyListItem } from "@/lib/journeys/dto";

/** Liczba ścieżek ze statusem `active` (szkice, wstrzymane i archiwum - nie). */
export function activeJourneyCount(
  list: readonly Pick<JourneyListItem, "status">[] | null | undefined,
): number {
  return (list ?? []).filter((item) => item.status === "active").length;
}
