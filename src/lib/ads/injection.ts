// Czysta logika WYBORU wstawek reklamowych: KTÓRE placementy wchodzą, ILE ich
// wchodzi i PRZY KTÓRYM paragrafie / karcie. Bez DOM, bez react-query, bez
// portali - żeby decyzję o liczbie reklam na oczy czytelnika dało się
// udowodnić tabelką przypadków, a nie przejazdem po JSX.
//
// WYCIĄGNIĘTE ZNAK W ZNAK z `components/ads/MidPostAds.tsx`
// i `components/ads/useInFeedAds.tsx` (razem z wadami - patrz niżej).
// Renderery importują te funkcje; ich zachowanie nie zmieniło się o jotę.
//
// WADY PRZENIESIONE ŚWIADOMIE (naprawa osobnym krokiem, nie ekstrakcją):
//   * `?? 4` i `?? 5` to CZWARTA i PIĄTA kopia tych samych domyślnych liczb
//     (panel `AdPlacementConfigFields` pokazuje je w polach formularza, ale
//     nie zapisuje do `config`). Żadne wiązanie ich nie pilnuje.
//   * Wartość nieliczbowa w `config` (redakcja wpisze "co drugi") daje `NaN`,
//     a `NaN` nie jest tu nigdzie odrzucany: w `mid_post` wstawka jest CICHO
//     pomijana, w `in_feed` NIGDY się nie pojawia, a w komparatorze sortowania
//     `NaN` znaczy "równe" - czyli decyduje kolejność z bazy.
//   * Placementy powyżej `MAX_MID_POST_ADS` są odrzucane BEZ ŚLADU - ani
//     ostrzeżenia w konsoli, ani sygnału w panelu.
import type { AdPlacementWithSlot } from "./types";

// Twardy sufit wstrzyknięć mid-post na jeden artykuł. Konfiguracja placementów
// jest nieograniczona po stronie CMS, więc bez capa artykuł mógł dostać dowolną
// liczbę śródtekstowych reklam (audyt UX: presja monetyzacyjna). Dwie
// najwcześniejsze (wg config.paragraph) wygrywają; reszta jest pomijana.
export const MAX_MID_POST_ADS = 2;

/**
 * Kolejność i sufit wstrzyknięć `mid_post`: rosnąco po `config.paragraph`
 * (brak wartości = 4), potem twarde odcięcie na `MAX_MID_POST_ADS`.
 *
 * Sortowanie jest STABILNE (`Array.prototype.sort` od ES2019), więc dwa
 * placementy z tym samym `paragraph` zachowują kolejność z zapytania
 * (`order("sort_order")`). Komparator zwracający `NaN` (wartość nieliczbowa
 * w konfiguracji) jest traktowany jak "równe" - taki placement nie wędruje
 * ani na początek, ani na koniec listy.
 */
export function sortAndCapMidPost(
  data: readonly AdPlacementWithSlot[] | null | undefined,
): AdPlacementWithSlot[] {
  if (!data) return [];
  return [...data]
    .sort((a, b) => {
      const ap = Number((a.config as { paragraph?: number }).paragraph ?? 4);
      const bp = Number((b.config as { paragraph?: number }).paragraph ?? 4);
      return ap - bp;
    })
    .slice(0, MAX_MID_POST_ADS);
}

/**
 * Indeks paragrafu (0-based), PO którym ma stanąć kontener reklamy, dla
 * konfiguracji liczonej od 1.
 *
 * Dwa przycięcia i oba są widoczne dla czytelnika:
 *  - `Math.max(1, ...)` - `paragraph` równy 0 lub ujemny znaczy "po pierwszym
 *    paragrafie", nie "nigdzie";
 *  - `Math.min(..., paragraphCount - 1)` - `paragraph` większy niż liczba
 *    paragrafów ląduje na OSTATNIM paragrafie, czyli reklama zaplanowana
 *    "w połowie tekstu" leży na końcu wpisu.
 *
 * Wartość nieliczbowa daje `NaN` - wywołujący indeksuje wtedy tablicę
 * `paragraphs[NaN]`, dostaje `undefined` i pomija wstawkę bez śladu.
 */
export function targetParagraphIndex(
  config: Record<string, unknown>,
  paragraphCount: number,
): number {
  const after = Math.max(1, Number((config as { paragraph?: number }).paragraph ?? 4));
  return Math.min(after - 1, paragraphCount - 1);
}

/**
 * Placementy `in_feed`, które mają się pokazać PO karcie o indeksie
 * `cardIndex` (0-based). `config.every` (brak = 5) liczy karty od 1, więc
 * `every: 5` trafia karty o indeksach 4, 9, 14...
 *
 * `Math.max(1, ...)` sprawia, że `every: 0` znaczy "przy KAŻDEJ karcie",
 * a nie "nigdy". `every` nieliczbowy daje `NaN`, a `x % NaN` nigdy nie jest
 * zerem - wstawka nie pojawia się w ogóle.
 */
export function placementsAfterCard(
  placements: readonly AdPlacementWithSlot[],
  cardIndex: number,
): AdPlacementWithSlot[] {
  return placements.filter((p) => {
    const every = Math.max(1, Number((p.config as { every?: number }).every ?? 5));
    return (cardIndex + 1) % every === 0;
  });
}
