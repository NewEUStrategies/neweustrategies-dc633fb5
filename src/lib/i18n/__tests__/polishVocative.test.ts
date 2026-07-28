import { describe, expect, it } from "vitest";

import { detectPolishGender, emailGreeting, polishVocative } from "../polishVocative";

describe("polishVocative", () => {
  it("odmienia typowe imiona męskie", () => {
    expect(polishVocative("Marek")).toBe("Marku");
    expect(polishVocative("Piotr")).toBe("Piotrze");
    expect(polishVocative("Jan")).toBe("Janie");
    expect(polishVocative("Adam")).toBe("Adamie");
    expect(polishVocative("Tomasz")).toBe("Tomaszu");
    expect(polishVocative("Michał")).toBe("Michale");
    expect(polishVocative("Paweł")).toBe("Pawle");
    expect(polishVocative("Jakub")).toBe("Jakubie");
    expect(polishVocative("Andrzej")).toBe("Andrzeju");
    expect(polishVocative("Dawid")).toBe("Dawidzie");
    expect(polishVocative("Robert")).toBe("Robercie");
    expect(polishVocative("Krzysztof")).toBe("Krzysztofie");
  });

  it("odmienia typowe imiona żeńskie", () => {
    expect(polishVocative("Anna")).toBe("Anno");
    expect(polishVocative("Maria")).toBe("Mario");
    expect(polishVocative("Katarzyna")).toBe("Katarzyno");
    expect(polishVocative("Kasia")).toBe("Kasiu");
    expect(polishVocative("Ania")).toBe("Aniu");
    expect(polishVocative("Ola")).toBe("Olu");
  });

  it("bierze tylko pierwszy człon i zachowuje wielkość liter", () => {
    expect(polishVocative("Anna Maria")).toBe("Anno");
    expect(polishVocative("marek")).toBe("marku");
  });

  it("zwraca wejście dla nietypowych form", () => {
    expect(polishVocative("")).toBe("");
    expect(polishVocative("X")).toBe("X");
    expect(polishVocative("J.")).toBe("J.");
  });

  it("wykrywa rodzaj z wyjątkami", () => {
    expect(detectPolishGender("Kuba")).toBe("male");
    expect(detectPolishGender("Ewa")).toBe("female");
    expect(detectPolishGender("Jan")).toBe("male");
  });

  it("buduje powitanie zależne od języka", () => {
    expect(emailGreeting("pl", "Marek")).toBe("Dzień dobry, Marku!");
    expect(emailGreeting("pl", null)).toBe("Dzień dobry!");
    expect(emailGreeting("en", "Marek")).toBe("Hi Marek,");
    expect(emailGreeting("en", "")).toBe("Hello,");
  });
});
