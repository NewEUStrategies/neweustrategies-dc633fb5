// Discussion Club - loader nagłówka trasy LIŚCIOWEJ (`/club/$clubSlug/*`).
//
// DLACZEGO OSOBNY PLIK, A NIE `clubHead.ts`. Splitter TanStacka wydziela
// z modułu trasy tylko loader/komponenty; `head()` zostaje w shellu trasy,
// a shell KAŻDEJ trasy ląduje w chunku wejściowym przeglądarki. Dopóki
// `clubHeadLoader` mieszkał obok `buildClubHead`, piętnaście shelli klubowych
// wciągało przez niego `queryKeys.ts` (13,7 KB przed minifikacją) do bootu
// każdego czytelnika - także tego, który nigdy nie wejdzie do klubu
// (pomiar entry 2026-10-02). Tutaj importerami są wyłącznie LOADERY, czyli
// kod już wydzielony do chunków tras; `clubHead.ts` zostaje czysty.
import type { QueryClient } from "@tanstack/react-query";
import { clubKeys } from "./queryKeys";
import { toClubHeadSource, type ClubHeadSource } from "./clubHead";
import type { ClubViewRow } from "./types";

/** Ładunek loadera trasy liściowej - wyłącznie to, czego potrzebuje `head()`. */
export interface ClubHeadLoaderData {
  club: ClubHeadSource | null;
}

/**
 * Dane nagłówka trasy LIŚCIOWEJ klubu - z karty rozgrzanej przez loader
 * UKŁADU `/club/$clubSlug`. ZERO round-tripów: `club_view` czyta układ, raz na
 * dokument (audyt CWV 2026-09-20, F09).
 *
 * DLACZEGO `await parentMatchPromise`, a nie samo `getQueryData`. Loadery
 * całego łańcucha dopasowań startują RÓWNOLEGLE (`@tanstack/router-core`,
 * `load-server.js`: `createLoaderTask` dla każdego indeksu naraz), więc bez
 * tego oczekiwania cache jest w chwili odczytu jeszcze pusty i KAŻDA trasa
 * liściowa emitowałaby `noindex` - czyli dokładnie tę regresję, przed którą
 * broni `isClubIndexable`. `parentMatchPromise` to obietnica zadania RODZICA
 * i nie odrzuca (framework normalizuje wynik do krotki), więc nie potrzebuje
 * własnego `catch`.
 *
 * Brak wpisu w cache'u (układ zdegradował albo nie zdążył) daje `null`, czyli
 * bezpieczny domyślny `noindex` - ta sama polityka pustki, co przy awarii RPC.
 */
export async function clubHeadLoader(
  queryClient: QueryClient,
  slug: string,
  parentMatchPromise: Promise<unknown>,
): Promise<ClubHeadLoaderData> {
  await parentMatchPromise;
  const row = queryClient.getQueryData<ClubViewRow | null>(clubKeys.bySlugViewer(slug, null));
  return { club: toClubHeadSource(row ?? null) };
}
