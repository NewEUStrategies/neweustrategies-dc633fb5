import { describe, expect, it } from "vitest";
import {
  asBool,
  asNum,
  asNumInRange,
  asOneOf,
  asStr,
  asStrArray,
  isContentValueSet,
  pickI18n,
  pickI18nArray,
} from "@/lib/content-model/contentValue";

// `contentValue` to JEDYNE miejsce, w którym zapisany `WidgetNode.content`
// (paleta z natywnymi `boolean`/`number`, kontrolki panelu ze stringami
// "0"/"1", stare rewizje - mieszanka) zamienia się w wartość, którą renderer
// rysuje. Do tej pory moduł był wykonywany wyłącznie pośrednio, przez
// edytory widgetów - nikt nie dowodził jego kontraktu wprost, a każdy błąd
// tutaj jest błędem WSZYSTKICH widgetów naraz (ustawienie „0" czytane jako
// włączone, kolumny „4" spadające do domyślnych, wariant spoza listy).
// Moduł jest czysty - zero atrap.

describe("asBool - wszystkie historyczne zapisy przełącznika", () => {
  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ["1", true],
    ["0", false],
    [" TRUE ", true],
    ["False", false],
    ["yes", true],
    ["no", false],
    ["on", true],
    ["off", false],
    ["Tak", true],
    ["NIE", false],
    ["", false],
  ])("%j -> %s niezależnie od wartości domyślnej", (value, expected) => {
    expect(asBool(value, true)).toBe(expected);
    expect(asBool(value, false)).toBe(expected);
  });

  it.each([null, undefined, 2, -1, Number.NaN, "maybe", {}, []])(
    "wartość nierozpoznana %j zwraca fallback zamiast zgadywać",
    (value) => {
      expect(asBool(value, true)).toBe(true);
      expect(asBool(value, false)).toBe(false);
    },
  );
});

describe("asNum / asNumInRange - liczby zapisane jako liczba albo napis", () => {
  it.each([
    [4, 4],
    ["4", 4],
    [" 2.5 ", 2.5],
    ["-3", -3],
    [0, 0],
    ["0", 0],
  ])("%j -> %s", (value, expected) => {
    expect(asNum(value, 99)).toBe(expected);
  });

  it.each<[unknown, string]>([
    ["", "pusty napis"],
    ["   ", "same spacje"],
    ["4px", "jednostka CSS"],
    ["abc", "tekst"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "nieskończoność"],
    ["Infinity", "napis Infinity"],
    [null, "null"],
    [true, "boolean"],
  ])("%j (%s) daje fallback, nigdy NaN", (value) => {
    expect(asNum(value, 3)).toBe(3);
  });

  it("asNumInRange domyka wynik do granic pola", () => {
    expect(asNumInRange("12", 3, 1, 6)).toBe(6);
    expect(asNumInRange(-5, 3, 1, 6)).toBe(1);
    expect(asNumInRange("4", 3, 1, 6)).toBe(4);
  });

  it("asNumInRange domyka także fallback spoza zakresu", () => {
    expect(asNumInRange("zepsute", 50, 1, 6)).toBe(6);
  });
});

describe("asStr / asStrArray / isContentValueSet", () => {
  it.each([null, undefined, 1, true, {}, ["a"]])("asStr(%j) daje pusty napis", (value) => {
    expect(asStr(value)).toBe("");
  });

  it("asStr zwraca napis bez zmian (bez trim)", () => {
    expect(asStr("  a  ")).toBe("  a  ");
  });

  it("asStrArray zostawia tylko napisy, w kolejności", () => {
    expect(asStrArray(["a", 1, null, "b", { c: 1 }, ""])).toEqual(["a", "b", ""]);
    expect(asStrArray("a")).toEqual([]);
    expect(asStrArray(undefined)).toEqual([]);
  });

  it("świadome wyłączenie (false, 0) jest USTAWIENIEM, brak wartości nie", () => {
    expect([false, 0, "0", " ", []].map(isContentValueSet)).toEqual([true, true, true, true, true]);
    expect([undefined, null, ""].map(isContentValueSet)).toEqual([false, false, false]);
  });
});

describe("pickI18n - żądany język -> PL -> EN", () => {
  it("bierze żądany język, gdy jest wypełniony", () => {
    expect(pickI18n({ title_pl: "Tytuł", title_en: "Title" }, "title", "en")).toBe("Title");
  });

  it("pusty EN spada na PL (język źródłowy redakcji)", () => {
    expect(pickI18n({ title_pl: "Tytuł", title_en: "" }, "title", "en")).toBe("Tytuł");
  });

  it("treść tylko po angielsku jest widoczna w podglądzie PL", () => {
    expect(pickI18n({ title_en: "Only EN" }, "title", "pl")).toBe("Only EN");
  });

  it("wartość nie-tekstowa jest traktowana jak brak i nie wycieka jako [object Object]", () => {
    expect(pickI18n({ title_pl: { x: 1 }, title_en: 5 }, "title", "pl")).toBe("");
  });
});

describe("pickI18nArray - żądany język -> PL -> EN -> klucz bezjęzykowy", () => {
  it("bierze żądany język", () => {
    expect(pickI18nArray({ items_pl: ["a"], items_en: ["b"] }, "items", "en")).toEqual(["b"]);
  });

  it("pusta lista EN spada na PL, potem na EN dla PL", () => {
    expect(pickI18nArray({ items_pl: ["a"], items_en: [] }, "items", "en")).toEqual(["a"]);
    expect(pickI18nArray({ items_pl: [], items_en: ["b"] }, "items", "pl")).toEqual(["b"]);
  });

  it("treść sprzed dwujęzyczności (klucz bezjęzykowy) nie ginie przy migracji", () => {
    expect(pickI18nArray({ items: ["stare", 3] }, "items", "pl")).toEqual(["stare"]);
  });

  it("lista z samych nie-napisów liczy się jak pusta i przechodzi do kolejnego ogniwa", () => {
    expect(pickI18nArray({ items_pl: [1, null], items: ["x"] }, "items", "pl")).toEqual(["x"]);
  });
});

describe("asOneOf - zamknięty zbiór wariantów", () => {
  const LAYOUTS = ["grid", "list", "carousel"] as const;

  it("wariant z listy przechodzi (po trim)", () => {
    expect(asOneOf(" list ", LAYOUTS, "grid")).toBe("list");
  });

  it.each(["GRID", "masonry", "", null, 1, "constructor"])(
    "%j spoza listy daje fallback",
    (value) => {
      expect(asOneOf(value, LAYOUTS, "grid")).toBe("grid");
    },
  );
});
