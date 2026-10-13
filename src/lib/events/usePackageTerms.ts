// Hook warunków zakupu i profilu podatkowego pakietów wydarzenia (TIX-07, TIX-09).
//
// KLUCZ SIEDZI W GAŁĘZI WYDARZENIA (`packageKeys.event`), więc zapis, usunięcie
// i każda inna mutacja pakietów (`useEventInvalidation` w `useEventPackages.ts`)
// unieważnia go razem z listą - dialog otwarty po zapisie nie startuje od
// warunków sprzed zapisu.
//
// ODDAJEMY STAN, A NIE SUROWE ZAPYTANIE. Formularz potrzebuje wiedzieć jedno:
// czy warunki są ZNANE. „W drodze", „baza bez migracji" i „odczyt padł" różnią
// się tylko zdaniem na ekranie - w każdym z nich zapis nie niesie kluczy
// warunków (`PackageTermsLookup`).
import { useQuery } from "@tanstack/react-query";
import type { PackageTermsLookup } from "@/lib/events/packageDraft";
import { fetchEventPackageTerms, type EventPackageTermsRow } from "@/lib/events/packagesApi";
import { packageKeys } from "@/lib/events/useEventPackages";

export function packageTermsKey(eventId: string) {
  return [...packageKeys.event(eventId), "terms"] as const;
}

/**
 * Stan zapytania -> stan warunków. Dane wygrywają z błędem: nieudane
 * odświeżenie w tle zostawia w pamięci ostatnią poprawną odpowiedź, a ta
 * nadal opisuje bazę lepiej niż „nie wiadomo".
 */
export function packageTermsLookupFrom(query: {
  data: ReadonlyMap<string, EventPackageTermsRow> | null | undefined;
  error: unknown;
}): PackageTermsLookup {
  if (query.data === undefined) {
    return query.error === null || query.error === undefined
      ? { status: "loading" }
      : { status: "failed", error: query.error };
  }
  if (query.data === null) return { status: "unavailable" };
  return { status: "ready", byPackage: query.data };
}

export function usePackageTerms(eventId: string): PackageTermsLookup {
  const query = useQuery({
    queryKey: packageTermsKey(eventId),
    queryFn: () => fetchEventPackageTerms(eventId),
    staleTime: 30_000,
  });
  return packageTermsLookupFrom(query);
}
