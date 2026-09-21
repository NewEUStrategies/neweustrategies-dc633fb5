// Warstwa danych widgetu „Cennik" w trybie synchronizacji z katalogiem
// (`pricing`, `content.source === "plans"` -> `PricingPlansView`).
//
// CO NAPRAWIA. Widget czytał `useQuery({ queryKey: billingKeys.plansActive(),
// queryFn: fetchActivePlans })`, ale rejestr prefetchu SSR go nie znał, więc
// sekcja z cennikiem wychodziła z serwera jako trzy szkieletowe karty
// (`plansQ.isLoading`), a ceny wskakiwały po hydratacji. Ta sama sekcja miała
// przy tym PUSTĄ listę zapytań, więc `shouldStreamSection` liczyła ją jako
// statyczną i `ServerSectionGate` nawet nie próbował na nią czekać.
//
// KLUCZ I FETCHER SĄ WSPÓŁDZIELONE, NIE PRZEPISANE. Bierzemy dokładnie
// `billingKeys.plansActive()` i `fetchActivePlans` - te same wartości, po które
// sięga widok - więc rozjazd klucza jest strukturalnie niewyrażalny (nie ma
// drugiego literału, który mógłby się rozjechać).
//
// BEZPIECZEŃSTWO SERWEROWE JEST ZMIERZONE, NIE ZAŁOŻONE. `fetchActivePlans`
// jedzie już w loaderach `routes/pricing.tsx`, `routes/membership-join.tsx`
// i `routes/plans.$planId.tsx` (`ensureQueryData`), czyli wykonuje się na
// serwerze przy każdym SSR tych tras: czyta `access_plans` z `active = true`
// przez publiczny klient anonimowy, zero API przeglądarki.
//
// KOSZT CHUNKU WEJŚCIOWEGO: ZERO. `prefetch.ts` jest statycznym importem
// `routes/__root.tsx`, czyli siedzi w chunku startowym przeglądarki - ale
// `lib/billing/queries.ts` JUŻ tam jest, wciągnięte przez eager-owe loadery
// trzech tras wyżej (zmierzone w artefakcie buildu: literał `PLAN_COLUMNS`
// obecny w chunku `index-*.js`). Ta krawędź nie sprowadza więc do bootu ani
// jednego nowego modułu. Ciała funkcji serwerowych z `checkout.functions.ts`
// (`createServerFn`) w kliencie nie ma wcale - build zamienia je na stuby,
// co również sprawdzono w artefakcie (zero wystąpień literałów z ich ciał).
import { queryOptions } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";

/**
 * Świeżość katalogu planów. Widok nie deklaruje `staleTime`, więc obowiązuje
 * domyślna wartość klienta zapytań (`router.tsx`: `5 * 60_000`); ta stała jest
 * jej jawnym powtórzeniem - semantyka świeżości NIE ZMIENIA SIĘ, a
 * `widgetCacheTargets` przestaje raportować zero (przy zerze bramka SWR
 * `useSectionPreload.isSectionFresh` grzałaby sekcję po każdym renderze).
 */
const PRICING_PLANS_STALE_MS = 5 * 60_000;

/**
 * Czy widget „Cennik" czyta katalog `access_plans`, a nie ręczne wartości
 * z panelu. Mirror bramki z `SimpleWidgets.tsx` (`getStr(c, "source") ===
 * "plans"`, gdzie `getStr` zwraca "" dla nie-stringa) - tryb ręczny nie ma
 * żadnego zapytania, więc nie wolno go zgłaszać jako sekcji z danymi.
 */
export function pricingUsesPlansSource(c: WidgetContent): boolean {
  return c["source"] === "plans";
}

export function activePlansQueryOptions() {
  return queryOptions({
    queryKey: billingKeys.plansActive(),
    queryFn: fetchActivePlans,
    staleTime: PRICING_PLANS_STALE_MS,
  });
}
