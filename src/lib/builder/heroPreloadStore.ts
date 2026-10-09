// PRELOADY OBRAZU LCP POZA ŁADUNKIEM ROUTERA (fala 3, P3.7b, T6).
//
// Loader trasy (`routes/index.tsx`, `routes/$.tsx`) liczy na serwerze
// deskryptory preloadu obrazów kandydatów LCP (`builderHeroPreloads`), a
// komponent trasy oddaje je `preload()` z react-dom (`usePreloadLcpImages`,
// który działa WYŁĄCZNIE w SSR - `lib/builder/aboveFold.tsx`). Klient ich nie
// czyta, a jako pole danych loadera jechały w `$tsr` KAŻDEGO dokumentu
// (z pełnym `imageSrcSet`: ok. 1,8 KB na produkcji, diagnoza
// `faza3/diagnoza/waga-dokumentu.md` §2.1).
//
// Teraz loader zapisuje listę w magazynie ŻĄDANIA - `WeakMap` kluczowanej
// `QueryClient`em, który na serwerze żyje dokładnie jedno żądanie (ten sam
// wzorzec co `lib/ssr/routeSsrDeadline.ts` i `lib/ssr/chromeWarmup.tsx`) - a
// komponent czyta ją przez `useQueryClient()`. Nagłówek `Link` loader dalej
// emituje sam (z tej samej listy).
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { isServerRender, type LcpImagePreload } from "@/lib/builder/aboveFold";

const heroPreloadsByRequest = new WeakMap<QueryClient, readonly LcpImagePreload[]>();

/** Loader (serwer): zapamiętaj preloady kandydatów LCP dokumentu tego żądania. */
export function rememberHeroPreloads(
  queryClient: QueryClient,
  preloads: readonly LcpImagePreload[],
): void {
  heroPreloadsByRequest.set(queryClient, preloads);
}

/** Odczyt bez hooka (testy i kod poza renderem). `undefined` = loader nic nie zapisał. */
export function heroPreloadsFor(queryClient: QueryClient): readonly LcpImagePreload[] | undefined {
  return heroPreloadsByRequest.get(queryClient);
}

/**
 * Komponent trasy: preloady zapisane przez loader TEGO żądania. Na kliencie
 * zawsze `undefined` - render czysto kliencki nie ma kandydata ani preloadu.
 */
export function useHeroPreloads(): readonly LcpImagePreload[] | undefined {
  const queryClient = useQueryClient();
  return isServerRender() ? heroPreloadsByRequest.get(queryClient) : undefined;
}
