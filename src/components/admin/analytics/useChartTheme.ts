/**
 * `useChartTheme()` - ROZWIĄZANY motyw wykresów dla panelu BI.
 *
 * PO CO TO JEST. Głębokie złączenie opcji z bazą (`mergeChartOption`
 * w `./chartTheme.ts`) zamyka jedną klasę usterek: panel nadpisujący sekcję
 * `xAxis`/`yAxis`/`tooltip`/`legend` NIE traci już umotywowanych kolorów bazy.
 * Zostaje druga klasa, której złączenie zamknąć NIE MOŻE - pola, których baza
 * w ogóle nie zna, bo są specyficzne dla jednego typu wykresu:
 *
 *   * `calendar.dayLabel.color`, `calendar.monthLabel.color` (mapa kalendarza),
 *   * `radar.splitLine.lineStyle.color`, `radar.axisName.color`,
 *   * `series[].itemStyle.borderColor` (kafle treemapy, przerwy w pierścieniu),
 *   * `markLine.lineStyle.color`, `rich` w formatterze etykiety.
 *
 * Dziś stoją tam napisy `"hsl(var(--border))"` i `"hsl(var(--muted-foreground))"`.
 * To NIE DZIAŁA i nie jest kwestią gustu: `var()` rozwiązuje CSS, a ECharts
 * podaje ten napis wprost kanwie jako `fillStyle`/`strokeStyle`. Kanwa przy
 * nieparsowalnej wartości ZOSTAJE PRZY POPRZEDNIEJ - awaria wygląda jak
 * „ten element ma jakiś losowy kolor", nie jak błąd. Ten hook daje panelowi
 * wartość JUŻ ROZWIĄZANĄ (`#hex`, `oklch(...)`, `hsl(...)` - to, co naprawdę
 * siedzi w tokenie), więc kanwa ma co pomalować.
 *
 * DLACZEGO WŁAŚNIE `useSyncExternalStore` NA TYM SAMYM MAGAZYNIE. Panel i jego
 * wykresy MUSZĄ widzieć TĘ SAMĄ migawkę motywu w jednym renderze. Gdyby panel
 * wołał `resolveChartTheme()` na własną rękę, dostałby świeży odczyt tokenów
 * w chwili renderu, a `EChartClient` - migawkę z magazynu; po zmianie palety
 * tenanta (`DesignTokensStyle` dowozi ją zapytaniem react-query) panel
 * malowałby ramki treemapy nowym kolorem tła na wykresie, który bazę ma jeszcze
 * ze starej migawki. Stąd dokładnie ta sama trójka co w `EChartClient`:
 * `subscribeChartTheme` + `chartThemeSnapshot` (także jako migawka serwerowa).
 *
 * KONTRAKT DLA PANELU:
 *   * zwraca `ResolvedTheme` - obiekt o STABILNEJ referencji, dopóki tokeny się
 *     nie zmieniły. Wolno go podać jako zależność `useMemo` budującego opcję;
 *   * pola: `palette: string[]` (5 kolorów, `--chart-1..5`), `primary`,
 *     `muted` (`--muted-foreground`), `border`, `foreground`, `background`
 *     oraz STAŁE kolory statusowe `success` / `warning` / `danger`
 *     (te trzy nie pochodzą z tokenów i nie zmieniają się z motywem);
 *   * wszystkie pola to napisy gotowe dla kanwy - NIGDY nie owijaj ich
 *     w `hsl(...)`, `var(...)` ani w żaden inny nawias;
 *   * zmiana tokenów przerenderuje panel dokładnie raz i tylko wtedy, gdy
 *     kolory naprawdę wyszły inne;
 *   * na SSR (worker Cloudflare) hook oddaje paletę zapasową TENANTOWO
 *     NEUTRALNĄ - nie da się przez niego wyciec kolorów tenanta między
 *     żądaniami.
 *
 * CZEGO TU NIE MA. Hook nie zastępuje bazy: kolorów, które `baseOption` już
 * ustawia (etykiety i linie osi, tło i ramka dymka, tekst legendy), NIE
 * przepisuj w panelu ręcznie. Głębokie złączenie dowozi je samo, a druga kopia
 * tej samej wartości to drugie miejsce do zapomnienia przy następnej zmianie.
 */
import { useEffect, useSyncExternalStore } from "react";

import {
  chartThemeSnapshot,
  scheduleChartThemeRefresh,
  subscribeChartTheme,
  type ResolvedTheme,
} from "./chartTheme";

export function useChartTheme(): ResolvedTheme {
  const theme = useSyncExternalStore(subscribeChartTheme, chartThemeSnapshot, chartThemeSnapshot);

  // Ta sama gwarancja, którą daje sobie `EChartClient`: tokeny tenanta mogą
  // dojechać PO pierwszym malowaniu, więc po zamontowaniu prosimy o przeliczenie.
  // Koszt zerowy przy panelu, który renderuje wykresy: `scheduleChartThemeRefresh`
  // koalescencjonuje wszystkie zgłoszenia z jednej tury w JEDNO przeliczenie,
  // więc panel plus dziesięć wykresów to nadal jedno wywołanie `getComputedStyle`
  // (ZMIERZONE w `__tests__/chartTheme.test.ts`).
  useEffect(() => {
    scheduleChartThemeRefresh();
  }, []);

  return theme;
}
