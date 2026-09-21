// Ruch przestrzeni roboczej doku - LICZBY, nie style.
//
// PO CO OSOBNY MODUŁ NA CZTERY LICZBY. Warstwa CSS (`styles.css`, blok
// `--- Przestrzeń robocza członka (WorkspaceDock) ---`) odgrywa przejścia,
// ale JEDNA z tych liczb jest potrzebna także w JS: czas WYJŚCIA panelu
// decyduje, jak długo hak `useDockPresence` trzyma zamykany węzeł w drzewie.
// Gdy obie strony trzymają tę liczbę u siebie, rozjazd jest kwestią czasu -
// ktoś skróci przejście w CSS, a React zdejmie węzeł 60 ms za późno (panel
// wisi już niewidoczny) albo 60 ms za wcześnie (wyjście ucięte w połowie).
//
// Dlatego liczby żyją TUTAJ, a bramka `dockMotion.gate.test.ts` czyta
// `src/styles.css` i dowodzi, że każdy token `--wd-*-ms` niesie DOKŁADNIE tę
// wartość. Zmiana w jednym miejscu bez drugiego oblewa test - i to jest cały
// mechanizm, żadnego czytania `getComputedStyle` w czasie działania (to byłby
// wymuszony odczyt układu przy każdym otwarciu panelu).
//
// SKĄD TE KONKRETNE CZASY. Afordancja „w miejscu" (rozwinięcie etykiety
// zakładki, zapalenie tła) czyta się jako natychmiastowa w zakresie
// 150-200 ms; powierzchnia, która WCHODZI na ekran, potrzebuje 200-250 ms,
// żeby oko złapało kierunek ruchu; wyjście robi się o ~30% krócej od wejścia,
// bo element schodzący ze scenerii nie ma się już czym przedstawiać.
// Poprzednia wersja (framer-motion: `duration: 0.6` + `delay: 0.1`) dawała
// 700 ms na reakcję zakładki - i to jest cała odpowiedź na „panele otwierają
// się za wolno" w warstwie odczucia, obok realnego kosztu pobrania paczki
// panelu, którym zajmuje się `useDockPrefetch`.

/** Czas rozwinięcia etykiety aktywnej zakładki i zapalenia jej tła. */
export const DOCK_TAB_MS = 190;

/** Wejście panelu nad paskiem (i samego paska po pierwszym pomiarze). */
export const DOCK_PANEL_IN_MS = 200;

/** Wyjście panelu - tyle czasu węzeł zostaje w drzewie po zamknięciu. */
export const DOCK_PANEL_OUT_MS = 140;

/** Wysunięcie skrzynki czatu od lewej krawędzi. */
export const DOCK_DRAWER_IN_MS = 240;

/** Schowanie skrzynki czatu. */
export const DOCK_DRAWER_OUT_MS = 160;

/**
 * Mapa: nazwa właściwości niestandardowej w CSS -> wartość w milisekundach.
 * Czyta ją bramka porównująca ten moduł ze `src/styles.css`.
 */
export const DOCK_MOTION_TOKENS: Readonly<Record<string, number>> = {
  "--wd-tab-ms": DOCK_TAB_MS,
  "--wd-panel-in-ms": DOCK_PANEL_IN_MS,
  "--wd-panel-out-ms": DOCK_PANEL_OUT_MS,
  "--wd-drawer-in-ms": DOCK_DRAWER_IN_MS,
  "--wd-drawer-out-ms": DOCK_DRAWER_OUT_MS,
};

/** Faza życia animowanej powierzchni doku (panel, skrzynka czatu). */
export type DockPresenceState = "entering" | "entered" | "exiting";

/**
 * Czas wyjścia dla danej powierzchni. Wydzielony, bo hak prezencji jest jeden
 * dla panelu i dla skrzynki, a czasy się różnią (skrzynka jedzie dłuższą
 * drogę, więc i dłużej schodzi).
 */
export function dockExitMs(surface: "panel" | "drawer"): number {
  return surface === "drawer" ? DOCK_DRAWER_OUT_MS : DOCK_PANEL_OUT_MS;
}
