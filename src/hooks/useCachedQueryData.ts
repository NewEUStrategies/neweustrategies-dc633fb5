// Odczyt danych zapytania PROSTO Z CACHE'U react-query, bez obserwatora
// i bez `queryFn`.
//
// PO CO. `<ThemeDesignStyle/>` musi reagować na wpisy, które panel admina
// zapisuje pod kluczami pochodnymi (`["site_settings","theme_design"]` -
// podgląd na żywo `useLiveThemeDesignPreview`, zapis `useSaveThemeDesign`),
// ale NIE MOŻE importować hooków z `lib/theme/themeDesign.ts` - to właśnie
// ten moduł (22 kB) zdejmujemy ze ścieżki bootowania. `useQuery` z `enabled:
// false` też odpada: na serwerze tworzyłby w cache'u wpis „pending bez
// obserwatora", który zamiatarka SSR (`lib/ssr/postRenderSweep`) usuwa z
// ostrzeżeniem w logu przy każdym żądaniu. Subskrypcja cache'u nic nie
// tworzy: `QueryCache.get()` zwraca `undefined`, dopóki ktoś zapytania nie
// zbuduje.
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

export function useCachedQueryData<T>(queryKey: QueryKey): T | undefined {
  const cache = useQueryClient().getQueryCache();
  const queryHash = hashKey(queryKey);
  const subscribe = useCallback(
    (onChange: () => void) =>
      cache.subscribe((event) => {
        if (event.query.queryHash === queryHash) onChange();
      }),
    [cache, queryHash],
  );
  const read = useCallback(
    () => cache.get(queryHash)?.state.data as T | undefined,
    [cache, queryHash],
  );
  // Ta sama migawka na serwerze i w pierwszym renderze klienta: obie czytają
  // ten sam (dehydratowany) cache.
  return useSyncExternalStore(subscribe, read, read);
}
