// REJESTR WYJĄTKÓW KOERCJI TABELI EDYTORÓW - stan bieżący, nie historia.
//
// `COERCION_DEFECTS` w `blockEditMatrix.shared.tsx` zwalnia wymienione edytory
// z asercji „NIE przepuszcza niepoprawnej wartości do interfejsu". Wyjątek ma
// sens tylko, dopóki defekt żyje. Po naprawie wpis przestaje cokolwiek
// dokumentować, a zaczyna UKRYWAĆ regresję: edytor, który znów pokaże
// „[object Object]", przejdzie tabelę, bo jest z tej asercji zwolniony.
// Tak było z ośmioma wpisami po naprawach z 2026-10-18 - `AudioBlock`
// i `VideoBlock` (`mediaTextVideoAudioCompareEditors.test.tsx`) oraz wykres,
// nagłówek, obraz, lista, pasek postępu i odstęp
// (`blockEditCoercionDefects.test.tsx`).
//
// Dowodzimy dwóch rzeczy:
//   * każdy wpis rejestru NADAL przecieka na `INVALID_DATA` - wpis zostawiony
//     po naprawie oblewa tę bramkę, zamiast cicho wisieć;
//   * edytory dawniej zwolnione przechodzą PEŁNĄ tabelę
//     (`defineBlockEditMatrix`), z asercją przecieku włącznie.
//
// GRANICE. Mocki i render niesie moduł wspólny tabeli, dlatego jego import
// jest PIERWSZY. i18n jest prawdziwe.
import { describe, expect, it } from "vitest";

import {
  ALL_EDITORS,
  COERCION_DEFECTS,
  INVALID_DATA,
  defineBlockEditMatrix,
  leaksIn,
  renderEditor,
} from "./blockEditMatrix.shared";

/** Edytory, które były w rejestrze do naprawy koercji z 2026-10-18. */
const FORMERLY_EXEMPT = [
  "AudioBlock",
  "ChartBlock",
  "HeadingBlock",
  "ImageBlock",
  "ListBlockEdit",
  "ProgressBlock",
  "SpacerBlock",
  "VideoBlock",
] as const;

const formerEntries = ALL_EDITORS.filter(([name]) =>
  (FORMERLY_EXEMPT as readonly string[]).includes(name),
);

describe("rejestr COERCION_DEFECTS", () => {
  it("każdy wpis rejestru NADAL przecieka na danych w złych typach", () => {
    const stale = COERCION_DEFECTS.filter((name) => {
      const entry = ALL_EDITORS.find(([candidate]) => candidate === name);
      if (!entry) return true;
      const [, Editor, type] = entry;
      const { container, unmount } = renderEditor(Editor, {
        id: `blk-registry-${name}`,
        type,
        data: INVALID_DATA,
      });
      const leaks = leaksIn(container);
      unmount();
      return leaks.length === 0;
    });
    expect(stale, "wpisy rejestru, których defekt jest już naprawiony").toEqual([]);
  });

  it("edytory dawniej zwolnione są w tabeli i przechodzą przez tę samą asercję", () => {
    // Literówka w liście niżej zmniejszyłaby przejazd bez śladu w logu.
    expect(formerEntries.map(([name]) => name).sort()).toEqual([...FORMERLY_EXEMPT].sort());
    for (const [name, Editor, type] of formerEntries) {
      const { container, unmount } = renderEditor(Editor, {
        id: `blk-former-${name}`,
        type,
        data: INVALID_DATA,
      });
      expect(leaksIn(container), `${name}: przeciek na danych w złych typach`).toEqual([]);
      unmount();
    }
  });
});

defineBlockEditMatrix(formerEntries);
