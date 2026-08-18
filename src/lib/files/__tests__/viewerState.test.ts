// Reguła stanu podglądu dokumentu.
//
// Każdy przypadek poniżej odpowiada gałęzi, która przed wyprowadzeniem tej
// reguły z `DocumentViewerBody.tsx` istniała w TRZECH kopiach (docx/xlsx/pptx)
// i nie dała się sprawdzić inaczej niż pełnym renderem z fetchem i parserem.
import { describe, expect, it } from "vitest";
import {
  activeSheetIndex,
  clampText,
  csvRows,
  CSV_MAX_ROWS,
  officePanel,
  textPanel,
  TEXT_MAX_CHARS,
  VIEWER_LABEL_KEYS,
  type OfficePanelInput,
} from "@/lib/files/viewerState";

/** Stan „wszystko poszło dobrze, dokument gotowy do pokazania". */
function healthy(overrides: Partial<OfficePanelInput> = {}): OfficePanelInput {
  return {
    fileName: "raport.docx",
    legacyExtension: "doc",
    fetchFailed: false,
    parseFailed: false,
    loading: false,
    hasContent: true,
    isEmpty: false,
    ...overrides,
  };
}

describe("officePanel - kolejność decyzji", () => {
  it("gotowy dokument nie ma nic do zakomunikowania", () => {
    expect(officePanel(healthy())).toEqual({ kind: "ready" });
  });

  it("stary format Office rozstrzyga się z NAZWY, przed pobraniem", () => {
    // .doc/.xls/.ppt to formaty sprzed OOXML - żaden z parserów ich nie otworzy.
    // Decyzja musi zapaść z samej nazwy, bo inaczej ściągamy kilkanaście
    // megabajtów transferu użytkownika po to, żeby powiedzieć „pobierz plik".
    const panel = officePanel(healthy({ fileName: "umowa.doc", loading: true }));
    expect(panel).toEqual({
      kind: "failure",
      labelKey: VIEWER_LABEL_KEYS.legacyFormat,
      hintKey: null,
    });
  });

  it.each([
    ["umowa.doc", "doc"],
    ["budzet.xls", "xls"],
    ["deck.ppt", "ppt"],
  ] as const)("%s trafia na komunikat o starym formacie", (fileName, legacyExtension) => {
    expect(officePanel(healthy({ fileName, legacyExtension })).kind).toBe("failure");
  });

  it("stary format każdego czytnika ocenia się osobno", () => {
    // Czytnik arkusza nie ma prawa odrzucić .doc jako „starego formatu" - to
    // nie jego plik. Ta asercja pilnuje, że `legacyExtension` naprawdę wchodzi
    // do decyzji, zamiast być ignorowanym parametrem.
    expect(officePanel(healthy({ fileName: "umowa.doc", legacyExtension: "xls" })).kind).toBe(
      "ready",
    );
  });

  it("nieudane pobranie wygrywa z ładowaniem - spinner nie kręci się w nieskończoność", () => {
    const panel = officePanel(healthy({ fetchFailed: true, loading: true, hasContent: false }));
    expect(panel).toMatchObject({ kind: "failure", labelKey: VIEWER_LABEL_KEYS.error });
  });

  it("odrzucenie przez parser daje ten sam komunikat, co nieudane pobranie", () => {
    // Z punktu widzenia użytkownika to jedna sytuacja: „nie pokażemy ci tego
    // pliku". Rozróżnianie ich w UI nie dałoby mu następnego kroku.
    expect(officePanel(healthy({ parseFailed: true }))).toMatchObject({
      labelKey: VIEWER_LABEL_KEYS.error,
    });
  });

  it("podpowiedź przy błędzie jest opcjonalna i domyślnie jej nie ma", () => {
    expect(officePanel(healthy({ fetchFailed: true }))).toMatchObject({ hintKey: null });
  });

  it("czytnik Worda dokłada podpowiedź o pliku zaszyfrowanym lub uszkodzonym", () => {
    const panel = officePanel(
      healthy({ fetchFailed: true, failureHintKey: VIEWER_LABEL_KEYS.protectedHint }),
    );
    expect(panel).toEqual({
      kind: "failure",
      labelKey: VIEWER_LABEL_KEYS.error,
      hintKey: VIEWER_LABEL_KEYS.protectedHint,
    });
  });

  it("jawne `null` w podpowiedzi zachowuje się jak jej brak", () => {
    expect(officePanel(healthy({ parseFailed: true, failureHintKey: null }))).toMatchObject({
      hintKey: null,
    });
  });

  it("trwające pobieranie pokazuje stan zajętości", () => {
    expect(officePanel(healthy({ loading: true, hasContent: false }))).toEqual({
      kind: "busy",
      labelKey: VIEWER_LABEL_KEYS.parsing,
    });
  });

  it("brak wyniku parsera to nadal zajętość, nawet gdy pobieranie się skończyło", () => {
    // Między „bufor jest" a „parser skończył" mija czas. Bez tego warunku
    // dokument mrugnąłby komunikatem „brak treści" przy każdym otwarciu.
    expect(officePanel(healthy({ loading: false, hasContent: false })).kind).toBe("busy");
  });

  it("pusty dokument dostaje własny komunikat, a nie błąd", () => {
    // Plik, który wczytał się poprawnie i po prostu nic nie zawiera, NIE jest
    // awarią - komunikat o błędzie kazałby użytkownikowi szukać winy u siebie.
    expect(officePanel(healthy({ isEmpty: true }))).toEqual({
      kind: "empty",
      labelKey: VIEWER_LABEL_KEYS.emptyDocument,
    });
  });

  it("pustka nie przykrywa błędu", () => {
    expect(officePanel(healthy({ isEmpty: true, parseFailed: true })).kind).toBe("failure");
  });

  it("pustka nie przykrywa trwającego ładowania", () => {
    expect(officePanel(healthy({ isEmpty: true, hasContent: false })).kind).toBe("busy");
  });
});

describe("textPanel", () => {
  it("wczytany tekst jest gotowy do pokazania", () => {
    expect(textPanel({ fetchFailed: false, hasText: true })).toEqual({ kind: "ready" });
  });

  it("czeka na treść z etykietą wczytywania, nie przetwarzania", () => {
    // Tekst nie przechodzi przez parser, więc „Przetwarzam plik..." byłoby
    // nieprawdą - użytkownik czeka na sieć, nie na obliczenia.
    expect(textPanel({ fetchFailed: false, hasText: false })).toEqual({
      kind: "busy",
      labelKey: VIEWER_LABEL_KEYS.loading,
    });
  });

  it("nieudane pobranie kończy oczekiwanie", () => {
    expect(textPanel({ fetchFailed: true, hasText: false })).toMatchObject({
      kind: "failure",
      labelKey: VIEWER_LABEL_KEYS.error,
    });
  });

  it("błąd wygrywa nawet wtedy, gdy część treści zdążyła dojść", () => {
    expect(textPanel({ fetchFailed: true, hasText: true }).kind).toBe("failure");
  });
});

describe("activeSheetIndex", () => {
  it("zwraca wskazany arkusz, gdy mieści się w skoroszycie", () => {
    expect(activeSheetIndex(2, 5)).toBe(2);
  });

  it("przycina indeks, gdy skoroszyt się SKURCZYŁ", () => {
    // Użytkownik otwiera w tym samym popupie drugi plik z mniejszą liczbą
    // arkuszy. Bez przycięcia `sheets[4]` to `undefined`, a odczyt `.html`
    // wywraca cały podgląd.
    expect(activeSheetIndex(4, 2)).toBe(1);
  });

  it("nie schodzi poniżej zera", () => {
    expect(activeSheetIndex(-3, 5)).toBe(0);
  });

  it("pusty skoroszyt daje zero, a nie -1", () => {
    // `count - 1` dla zera arkuszy to -1 - indeks, który w tablicy nic nie
    // znaczy, a w kolejnym renderze zapamiętałby się jako „aktywny".
    expect(activeSheetIndex(0, 0)).toBe(0);
    expect(activeSheetIndex(3, 0)).toBe(0);
  });

  it("skoroszyt jednoarkuszowy zawsze wskazuje na zero", () => {
    expect(activeSheetIndex(7, 1)).toBe(0);
  });
});

describe("clampText", () => {
  it("krótki tekst zostaje nietknięty", () => {
    expect(clampText("ala ma kota")).toBe("ala ma kota");
  });

  it("obcina do twardego limitu", () => {
    expect(clampText("x".repeat(TEXT_MAX_CHARS + 5_000))).toHaveLength(TEXT_MAX_CHARS);
  });

  it("tekst dokładnie na limicie nie jest ruszany", () => {
    expect(clampText("x".repeat(TEXT_MAX_CHARS))).toHaveLength(TEXT_MAX_CHARS);
  });
});

describe("csvRows", () => {
  it("dzieli po przecinku", () => {
    expect(csvRows("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  it("dzieli po ŚREDNIKU - tak eksportuje polski Excel", () => {
    // Bez średnika w separatorach cały wiersz z polskiego eksportu lądował
    // w jednej komórce, a tabela wyglądała na uszkodzoną.
    expect(csvRows("a;b;c")).toEqual([["a", "b", "c"]]);
  });

  it("dzieli po tabulatorze", () => {
    expect(csvRows("a\tb\tc")).toEqual([["a", "b", "c"]]);
  });

  it("czyta końce wierszy w obu konwencjach", () => {
    expect(csvRows("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(csvRows("a,b\nc,d")).toHaveLength(2);
  });

  it("obcina do twardego limitu wierszy", () => {
    const text = Array.from({ length: CSV_MAX_ROWS + 500 }, (_, i) => `${i},x`).join("\n");
    expect(csvRows(text)).toHaveLength(CSV_MAX_ROWS);
  });

  it("pusty tekst daje jeden pusty wiersz, nie wywrotkę", () => {
    expect(csvRows("")).toEqual([[""]]);
  });
});
