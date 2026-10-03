// toPlVocative - wołacz w nagłówku widgetu "Tailored must-reads"
// ("Twoje wybrane must-reads, Mateuszu"). Wcześniej był to osobny silnik,
// który rozjeżdżał się z e-mailami (Mateusz -> "Mateusu", Paweł -> "Pawele",
// Ola -> "Olo", "constructor" -> kod funkcji). Teraz deleguje odmianę członu do
// `polishVocative`, a sam dokłada tylko swój kontrakt: wszystkie człony imienia
// (spacja i łącznik), separatory bez zmian, wielkość liter źródła, "" dla null.
import { describe, expect, it } from "vitest";

import { toPlVocative } from "../plVocative";
import { polishVocative } from "../polishVocative";

// Formy z gramatyki, które audyt wskazał jako wzorcowe dla widgetu.
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["Mateusz", "Mateuszu"],
  ["Tadeusz", "Tadeuszu"],
  ["Paweł", "Pawle"],
  ["Ola", "Olu"],
  ["Kasia", "Kasiu"],
  ["Ernest", "Erneście"],
  ["Piotr", "Piotrze"],
  ["Marek", "Marku"],
  ["Anna", "Anno"],
  ["Julia", "Julio"],
  ["Zofia", "Zofio"],
  ["Maja", "Majo"],
  ["Kuba", "Kubo"],
  ["Jerzy", "Jerzy"],
  ["Iwo", "Iwo"],
  ["Konstanty", "Konstanty"],
  ["Staś", "Stasiu"],
  ["Stefania", "Stefanio"],
  ["Kacper", "Kacprze"],
];

describe("toPlVocative", () => {
  it.each(EXPECTED)("%s -> %s", (nominative, vocative) => {
    expect(toPlVocative(nominative)).toBe(vocative);
  });

  it("daje ten sam wynik co silnik e-maili dla imion jednoczłonowych", () => {
    // Jeden silnik: nagłówek widgetu i powitanie w mailu nie mogą się różnić.
    const names = [
      ...EXPECTED.map(([n]) => n),
      "Bonawentura",
      "Noah",
      "ANNA",
      "marek",
      "McDonald",
      "J.",
      "constructor",
    ];
    for (const name of names) {
      expect(toPlVocative(name), name).toBe(polishVocative(name));
    }
  });

  it("zwraca pusty napis dla null, undefined i samych białych znaków", () => {
    expect(toPlVocative(null)).toBe("");
    expect(toPlVocative(undefined)).toBe("");
    expect(toPlVocative("")).toBe("");
    expect(toPlVocative(" \t ")).toBe("");
  });

  it("odmienia każdy człon imienia złożonego, zachowując separatory", () => {
    expect(toPlVocative("Anna-Maria")).toBe("Anno-Mario");
    expect(toPlVocative("Jan Paweł")).toBe("Janie Pawle");
    expect(toPlVocative("Maria Magdalena")).toBe("Mario Magdaleno");
    expect(toPlVocative("Jan  Paweł")).toBe("Janie  Pawle");
    expect(toPlVocative("  Anna  ")).toBe("Anno");
  });

  it("zachowuje wielkość liter: WERSALIKI, małe litery i wielkie litery w środku", () => {
    expect(toPlVocative("ANNA")).toBe("ANNO");
    expect(toPlVocative("MATEUSZ")).toBe("MATEUSZU");
    expect(toPlVocative("ANNA-MARIA")).toBe("ANNO-MARIO");
    expect(toPlVocative("anna")).toBe("anno");
    expect(toPlVocative("jan paweł")).toBe("janie pawle");
    expect(toPlVocative("O'Brien")).toBe("O'Brienie");
    expect(toPlVocative("McDonald")).toBe("McDonaldzie");
  });

  it("zostawia bez zmian inicjały, cyfry i obce znaki", () => {
    // Stary silnik doklejał końcówki do wszystkiego: "J." -> "J.IE", "X" -> "XIE".
    expect(toPlVocative("J.")).toBe("J.");
    expect(toPlVocative("J. Paweł")).toBe("J. Pawle");
    expect(toPlVocative("X")).toBe("X");
    expect(toPlVocative("1")).toBe("1");
    expect(toPlVocative("R2D2")).toBe("R2D2");
    expect(toPlVocative("Zoë")).toBe("Zoë");
    expect(toPlVocative("José")).toBe("José");
  });

  it("nie rzuca i nie zwraca kodu dla kluczy prototypu Object", () => {
    // Pusta mapa wyjątków czytana przez obj[key] zwracała dla "constructor"
    // funkcję Object, a "Constructor" / "__proto__" rzucały TypeError.
    expect(toPlVocative("constructor")).toBe("constructorze");
    expect(toPlVocative("Constructor")).toBe("Constructorze");
    expect(toPlVocative("__proto__")).toBe("__proto__");
    for (const key of ["toString", "valueOf", "hasOwnProperty"]) {
      expect(() => toPlVocative(key)).not.toThrow();
      expect(toPlVocative(key)).not.toMatch(/native code|function/);
    }
  });
});
