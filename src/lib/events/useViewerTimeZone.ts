// Strefa czasowa OGLĄDAJĄCEGO - bezpieczna dla hydratacji.
//
// `browserTimeZone()` na serwerze zwraca strefę MASZYNY renderującej (w CI
// i na workerze - UTC), a w przeglądarce strefę uczestnika. Wywołane wprost
// w renderze daje dwa różne HTML-e: serwer w UTC pisze pod programem
// wydarzenia z Warszawy „godziny w innej strefie niż Twoja”, klient
// w Warszawie tego zdania nie ma - React zgłasza niezgodność hydratacji,
// a dokument z cache'u brzegowego niesie zdanie prawdziwe tylko dla serwera.
//
// `useSyncExternalStore` z migawką serwerową `null` daje w SSR i w pierwszym
// renderze klienta TEN SAM wynik („strefa nieznana” = brak podpowiedzi),
// a właściwą strefę dopiero po hydratacji. Strefa nie zmienia się w trakcie
// wizyty, więc subskrypcja jest pusta.
import { useSyncExternalStore } from "react";

import { browserTimeZone } from "@/lib/events/timezone";

const subscribe = (): (() => void) => () => undefined;
const serverSnapshot = (): string | null => null;

export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(subscribe, browserTimeZone, serverSnapshot);
}
