// Ścieżka kanału RSS trackera - moduł BEZ ŻADNYCH importów.
//
// Czyta ją `head()` tras `tracker.index.tsx` i `tracker.$slug.tsx` (link autodiscovery). `head()`
// zostaje w module OPCJI trasy, a ten jest `$initial` (importuje go drzewo tras z wejścia).
// Rolldown liczy ten tag przed tree-shakingiem, więc import stałej z `feed.ts` zabierał do
// chunku bootu KAŻDEJ strony całe `feed.ts` i jego zależność `stages.ts` (etykiety etapów
// legislacyjnych), z których korzystają tylko leniwe chunki trackera i klubów
// (scripts/lib/clientChunkGroups.ts, grupa `app-initial`). Rollup nieużyty kod wycinał.

/**
 * Ścieżka kanału (atom:link rel="self", link autodiscovery, wejście dla ludzi).
 * Stała żyje w module CZYSTYM, bo czytają ją zarówno handler serwerowy, jak i
 * komponenty tras - import z `feed.server.ts` wciągnąłby kod serwerowy do
 * bundla klienta.
 */
export const TRACKER_FEED_PATH = "/tracker/rss.xml";
