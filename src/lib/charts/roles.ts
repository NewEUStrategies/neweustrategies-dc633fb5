// ROLE KOLORYSTYCZNE SYSTEMU WYKRESÓW - nazwy ze specyfikacji (2026-10)
// przypięte do tokenów arkusza.
//
// PO CO OSOBNY MODUŁ, SKORO TOKENY JUŻ SĄ. Specyfikacja mówi językiem ról
// („akcent", „łupek główny", „tusz trzeci", „linia osi"), a arkusz mówi
// nazwami historycznymi (`--chart-accent`, `--chart-axis`). Kod rysujący ma
// czytać ROLE, nie zgadywać, który token pełni którą: dzięki temu zmiana
// koloru roli jest zmianą jednej wartości w arkuszu, a nie przeszukaniem
// czternastu komponentów.
//
// WARTOŚCI HEX są tu WYŁĄCZNIE dla bramki (`__tests__/roles.test.ts`), która
// porównuje je z arkuszem i liczy progi kontrastu. Komponent ich nie czyta -
// podaje `var(...)` i pozwala kaskadzie wybrać motyw, tak samo jak paleta
// slotów. Hex w kodzie rysującym psuje tryb ciemny i druk.
//
// ODSTĘPSTWA OD WZORCA, każde z pomiaru:
//   * dodatni zostaje naszym morskim (#1b6f8c / #6fb3c9), nie #2d7a6a:
//     wzorcowa para z czerwienią ma przy protanopii odległość 8,5, nasza 34,6;
//   * „powyżej przedziału" jest fioletem, nie bursztynem - bursztyn leży
//     w rodzinie pomarańczu marki;
//   * łupek drugi jest przyciemniony z #9aa6b5 (2,47:1) do #8794a4 (3,09:1);
//   * tekst akcentu na jasnym to #ab5517 (5,19:1), bo #ed751a ma 2,93:1
//     i nie przechodzi progu tekstu;
//   * siatka i oś na ciemnym są przeliczone pod naszą płytę #0f0f0f z tym
//     samym kontrastem, jaki wzorzec miał na #1f1e1d.

/** Rola -> wyrażenie CSS. Jedyne, czego używa kod rysujący. */
export const ROLE = {
  /** Seria główna, pasmo optimum, wypełnienie suwaka, sparkline. */
  acc: "var(--chart-accent)",
  /** Etykiety pasma optimum, tekst akcentu (próg 4,5:1). */
  accText: "var(--chart-accent-audit)",
  /** Linia „Źródło" w tooltipie. */
  accLight: "var(--chart-acc-l)",
  /** Obwódka fokusu - akcent dociągnięty do progu 3,0:1. */
  accFocus: "var(--chart-accent-audit-graphic)",
  /** Druga seria, sumy w wykresie kaskadowym, kroki lejka. */
  sMain: "var(--chart-s-main)",
  /** Trzecia seria, tło danych w suwaku, „brak benchmarku". */
  sAlt: "var(--chart-s-alt)",
  sAltText: "var(--chart-s-alt-t)",
  /** Wzrost, „w normie" na mapie ciepła, zmiana korzystna. */
  pos: "var(--chart-positive)",
  posText: "var(--chart-positive-text)",
  /** Spadek, wartości ujemne, „poniżej przedziału". */
  neg: "var(--chart-negative)",
  negText: "var(--chart-negative-text)",
  /** „Powyżej przedziału". */
  warn: "var(--chart-warn)",
  /** Tusz: tytuł / etykiety danych / opisy osi. */
  ink: "var(--chart-ink)",
  ink2: "var(--chart-ink2)",
  ink3: "var(--chart-ink3)",
  /** Linie siatki / linia osi X i nieaktywna pozycja legendy. */
  line: "var(--chart-grid)",
  line2: "var(--chart-axis)",
  /** Tło wykresu, obwódka punktów i komórek. */
  panel: "var(--card)",
  /** Tooltip: tło / tekst / etykiety wierszy. */
  ttBg: "var(--chart-tip-bg)",
  ttInk: "var(--chart-tip-ink)",
  ttMute: "var(--chart-tip-mute)",
} as const;

export type ChartRole = keyof typeof ROLE;

/**
 * Wartości ról per motyw - KOPIA arkusza dla bramki. Klucz to nazwa tokenu
 * w arkuszu, nie nazwa roli: bramka szuka dokładnie tego zapisu.
 */
export const ROLE_TOKEN_VALUES = {
  light: {
    "--chart-acc-l": "#fdb078",
    "--chart-s-main": "#3e4c5e",
    "--chart-s-alt": "#8794a4",
    "--chart-s-alt-t": "#66717f",
    "--chart-warn": "#7c4dbf",
    "--chart-ink": "#141313",
    "--chart-ink2": "#3f3c3a",
    "--chart-ink3": "#6b6662",
    "--chart-grid": "#e7e3df",
    "--chart-axis": "#d5cfc9",
    "--chart-tip-bg": "#141313",
    "--chart-tip-ink": "#f8f6f4",
    "--chart-tip-mute": "#b9b2ab",
  },
  dark: {
    "--chart-acc-l": "#fdb078",
    "--chart-s-main": "#a9b6c6",
    "--chart-s-alt": "#5d6876",
    "--chart-s-alt-t": "#7d8897",
    "--chart-warn": "#ab92ec",
    "--chart-ink": "#ede9e7",
    "--chart-ink2": "#d2ccc6",
    "--chart-ink3": "#9d968f",
    "--chart-grid": "#22201f",
    "--chart-axis": "#363331",
    "--chart-tip-bg": "#2c2a28",
    "--chart-tip-ink": "#ede9e7",
    "--chart-tip-mute": "#a9a29b",
  },
} as const;

/**
 * Tokeny GRAFICZNE ról (linie, wypełnienia) - bramka wymaga 3,0:1 na płycie.
 * Akcentu tu nie ma: #FA9346 na bieli ma 2,25:1 i zostaje, bo jest kolorem
 * marki. Seria w akcencie nigdy nie jest jedynym nośnikiem - niesie ją też
 * kształt punktu, etykieta na końcu linii, tooltip i tabela danych.
 */
export const ROLE_GRAPHIC_TOKENS = ["--chart-s-main", "--chart-s-alt", "--chart-warn"] as const;

/** Tokeny TEKSTOWE ról na płycie - próg 4,5:1. */
export const ROLE_TEXT_TOKENS = [
  "--chart-s-main",
  "--chart-s-alt-t",
  "--chart-warn",
  "--chart-ink",
  "--chart-ink2",
  "--chart-ink3",
] as const;

/** Tokeny TEKSTOWE na tle tooltipa - próg 4,5:1 względem `--chart-tip-bg`. */
export const ROLE_TOOLTIP_TEXT_TOKENS = [
  "--chart-tip-ink",
  "--chart-tip-mute",
  "--chart-acc-l",
] as const;

/**
 * Warianty napisów OCENY wewnątrz tooltipa (który jest ciemny w obu motywach) -
 * kopia reguły `.neh-tooltip` z `charts.css` dla bramki. Muszą mieć 4,5:1 na
 * tle tooltipa jasnego motywu i ciemnego.
 */
export const TOOLTIP_STATUS_TEXT = {
  "--chart-positive-text": "#6fb3c9",
  "--chart-negative-text": "#f07070",
  "--chart-warn": "#b49cf0",
  "--chart-s-alt-t": "#9aa6b5",
} as const;
