// WKLEJENIE ARKUSZA DO TEXTAREI MAPY (`clipboardToMapText`) - ten sam
// układ tabeli co podgląd siatki i importu.
//
// Do poprawki textarea czytała kraj zawsze z pierwszej kolumny i nagłówek
// zgadywała po swojemu: „Lp. | Kraj | Wartość" dawało nieznane kraje „1",
// „2" i puste pole, tabela obrócona („Rok | PL | DE") i „kod | nazwa |
// wartość" - tak samo. Teraz textarea liczy wartości przez
// `initialMapTableLayout` + `mapTableValues`, czyli dokładnie tak, jak
// podgląd po „Zastosuj", i oddaje także same wartości (`values`), żeby pole
// mogło je dołożyć do swoich wierszy, zamiast zastąpić całe pole.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCountryIndex } from "@/lib/charts/importTable";
import type { GeoAsset } from "@/lib/charts/types";
import { clipboardToMapText } from "../textareaPaste";

const EUROPA = buildCountryIndex(
  (JSON.parse(readFileSync("public/geo/europe-50m.v2.json", "utf8")) as GeoAsset).countries,
);

describe("clipboardToMapText - kształty tabel z arkusza", () => {
  it.each([
    ["kod | nazwa | wartość", "PL\tPolska\t5\nDE\tNiemcy\t7", ["PL", "DE"]],
    ["Lp. | Kraj | Wartość", "Lp\tKraj\tWartość\n1\tWłochy\t59\n2\tHiszpania\t48", ["IT", "ES"]],
    ["obrócona: Rok | PL | DE", "Rok\tPL\tDE\n2024\t5\t7", ["PL", "DE"]],
    ["jeden wiersz skopiowany z arkusza", "IT\t59", ["IT"]],
  ])("%s", (_, text, ids) => {
    const wynik = clipboardToMapText({ text }, EUROPA);
    expect(wynik?.values.map((v) => v.id)).toEqual(ids);
    expect(wynik?.text.split("\n").map((l) => l.split(";")[0])).toEqual(ids);
  });

  it("nic nierozpoznane - puste wartości i problemy (wołający decyduje, co z polem)", () => {
    const wynik = clipboardToMapText({ text: "Narnia\t5\nMordor\t7" }, EUROPA);
    expect(wynik?.values).toEqual([]);
    expect(wynik?.text).toBe("");
    expect(wynik?.problems).toContainEqual({
      code: "unknownCountries",
      labels: ["Narnia", "Mordor"],
    });
  });

  it("zwykły tekst bez tabulatorów nie jest arkuszem - null (wklejenie po staremu)", () => {
    expect(clipboardToMapText({ text: "PL; 12" }, EUROPA)).toBeNull();
  });
});
