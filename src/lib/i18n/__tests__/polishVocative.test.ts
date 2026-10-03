// Wołacz polskich imion - JEDYNY silnik odmiany w repo. Korzystają z niego
// e-maile systemowe (`polishVocative` / `emailGreeting`) i nagłówek widgetu
// "Tailored must-reads" (`toPlVocative` w `../plVocative`), więc tabela niżej
// jest kontraktem dla obu miejsc. Oczekiwane formy to wołacz z gramatyki
// (Mateuszu, Pawle, Erneście, Kasiu, Olu), a dla form, których silnik nie
// umie odmienić pewnie, mianownik - zasada "lepiej neutralnie niż błędnie".
import { describe, expect, it } from "vitest";

import {
  detectPolishGender,
  emailGreeting,
  polishVocative,
  polishVocativeParts,
} from "../polishVocative";

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
    expect(emailGreeting("pl", "Marek")).toBe("Dzień dobry, Marku");
    expect(emailGreeting("pl", "Marek", "male", "Mareczku")).toBe("Dzień dobry, Mareczku");
    expect(emailGreeting("pl", null)).toBe("Dzień dobry");

    expect(emailGreeting("en", "Marek")).toBe("Hi Marek,");
    expect(emailGreeting("en", "")).toBe("Hello,");
  });
});

// Imiona męskie, pogrupowane po zakończeniu tematu - każda grupa to osobna
// reguła silnika, więc zepsucie jednej gałęzi wywraca konkretny wiersz.
const MALE: ReadonlyArray<readonly [string, string]> = [
  // -ek gubi ruchome "e": Marek -> Marku
  ["Marek", "Marku"],
  ["Jacek", "Jacku"],
  ["Leszek", "Leszku"],
  ["Franciszek", "Franciszku"],
  // -sz/-cz/-rz/-ż/-dz/-c/-j/-l + -u (w tym -usz/-esz: Mateusz -> Mateuszu)
  ["Mateusz", "Mateuszu"],
  ["Tadeusz", "Tadeuszu"],
  ["Dariusz", "Dariuszu"],
  ["Janusz", "Januszu"],
  ["Bartosz", "Bartoszu"],
  ["Łukasz", "Łukaszu"],
  ["Grzegorz", "Grzegorzu"],
  ["Kazimierz", "Kazimierzu"],
  ["Andrzej", "Andrzeju"],
  ["Mikołaj", "Mikołaju"],
  ["Karol", "Karolu"],
  ["Kamil", "Kamilu"],
  ["Daniel", "Danielu"],
  // tylnojęzykowe -k/-g/-ch/-h + -u
  ["Henryk", "Henryku"],
  ["Ludwik", "Ludwiku"],
  ["Wojciech", "Wojciechu"],
  ["Lech", "Lechu"],
  ["Noah", "Noahu"],
  // miękkie ś/ź/ć/ń przed samogłoską piszemy si/zi/ci/ni (Staś -> Stasiu)
  ["Staś", "Stasiu"],
  ["Jaś", "Jasiu"],
  ["Kubuś", "Kubusiu"],
  // -ł -> -le (Bogumił z reguły; Michał/Rafał/Paweł z tabeli wyjątków)
  ["Bogumił", "Bogumile"],
  ["Michał", "Michale"],
  ["Rafał", "Rafale"],
  ["Paweł", "Pawle"],
  // -r -> -rze (z ruchomym "e" w tabeli wyjątków)
  ["Piotr", "Piotrze"],
  ["Igor", "Igorze"],
  ["Wiktor", "Wiktorze"],
  ["Aleksander", "Aleksandrze"],
  ["Kacper", "Kacprze"],
  // -st -> -ście, -t -> -cie, -d -> -dzie
  ["Ernest", "Erneście"],
  ["August", "Auguście"],
  ["Robert", "Robercie"],
  ["Benedykt", "Benedykcie"],
  ["Dawid", "Dawidzie"],
  ["Witold", "Witoldzie"],
  ["Konrad", "Konradzie"],
  // -n/-m/-b/-p/-w/-f/-s/-z + -ie
  ["Jan", "Janie"],
  ["Szymon", "Szymonie"],
  ["Adam", "Adamie"],
  ["Jakub", "Jakubie"],
  ["Filip", "Filipie"],
  ["Stanisław", "Stanisławie"],
  ["Józef", "Józefie"],
  ["Borys", "Borysie"],
  ["Feliks", "Feliksie"],
  // spółgłoski spoza rodzimego alfabetu odmieniamy jak -w/-s
  ["Gustav", "Gustavie"],
  ["Max", "Maxie"],
  // samogłoska na końcu - wołacz równy mianownikowi
  ["Jerzy", "Jerzy"],
  ["Ignacy", "Ignacy"],
  ["Antoni", "Antoni"],
  ["Konstanty", "Konstanty"],
  ["Iwo", "Iwo"],
  ["Aleksy", "Aleksy"],
  // męskie na -a odmieniają się jak twardotematowe żeńskie
  ["Kuba", "Kubo"],
  ["Barnaba", "Barnabo"],
  ["Kosma", "Kosmo"],
  ["Bonawentura", "Bonawenturo"],
];

const FEMALE: ReadonlyArray<readonly [string, string]> = [
  ["Anna", "Anno"],
  ["Ewa", "Ewo"],
  ["Katarzyna", "Katarzyno"],
  ["Agnieszka", "Agnieszko"],
  ["Małgorzata", "Małgorzato"],
  ["Gabriela", "Gabrielo"],
  ["Urszula", "Urszulo"],
  ["Nikola", "Nikolo"],
  // pełne imiona na -ia/-ja -> -io/-jo
  ["Maria", "Mario"],
  ["Julia", "Julio"],
  ["Zofia", "Zofio"],
  ["Natalia", "Natalio"],
  ["Klaudia", "Klaudio"],
  ["Stefania", "Stefanio"],
  ["Melania", "Melanio"],
  ["Eugenia", "Eugenio"],
  ["Antonia", "Antonio"],
  ["Apolonia", "Apolonio"],
  ["Leonia", "Leonio"],
  ["Pelagia", "Pelagio"],
  ["Maja", "Majo"],
  ["Lucja", "Lucjo"],
  ["Patrycja", "Patrycjo"],
  // zdrobnienia z miękkim tematem -> -iu
  ["Kasia", "Kasiu"],
  ["Zosia", "Zosiu"],
  ["Basia", "Basiu"],
  ["Asia", "Asiu"],
  ["Marysia", "Marysiu"],
  ["Jadzia", "Jadziu"],
  // dwusylabowe -nia to zdrobnienia -> -niu
  ["Ania", "Aniu"],
  ["Hania", "Haniu"],
  ["Sonia", "Soniu"],
  ["Bronia", "Broniu"],
  ["Gienia", "Gieniu"],
  ["Ksenia", "Kseniu"],
  // "i" przed "n" jest samogłoską sylaby (Ki-nia), a nie zmiękczeniem (Gie-nia)
  ["Kinia", "Kiniu"],
  // krótkie zdrobnienia na -la -> -lu
  ["Ola", "Olu"],
  ["Ala", "Alu"],
  ["Ula", "Ulu"],
  ["Ela", "Elu"],
  ["Pola", "Polu"],
  ["Iza", "Izo"],
];

describe("polishVocative - tabela odmiany", () => {
  it.each(MALE)("męskie: %s -> %s", (nominative, vocative) => {
    expect(polishVocative(nominative)).toBe(vocative);
    // Jawnie podany rodzaj (słownik imion / metadane) daje ten sam wynik.
    expect(polishVocative(nominative, "male")).toBe(vocative);
  });

  it.each(FEMALE)("żeńskie: %s -> %s", (nominative, vocative) => {
    expect(polishVocative(nominative)).toBe(vocative);
    expect(polishVocative(nominative, "female")).toBe(vocative);
  });

  it("zapisuje każdą miękką spółgłoskę przed końcówką -u przez -i-", () => {
    // Reguła ortograficzna, nie lista imion: ś/ź/ć/ń + samogłoska = si/zi/ci/ni.
    expect(polishVocative("Kać")).toBe("Kaciu");
    expect(polishVocative("Gaź")).toBe("Gaziu");
    expect(polishVocative("Szczepań")).toBe("Szczepaniu");
  });

  it("dopisuje -u do tematu na -dz, zamiast traktować go jak zwykłe -z", () => {
    // Reguła, nie lista imion: -dz jest miękkie jak -sz/-cz, a samo -z bierze -ie.
    expect(polishVocative("Gadz")).toBe("Gadzu");
    expect(polishVocative("Bolz")).toBe("Bolzie");
  });

  it("nie doczepia końcówki -o do żeńskich imion spoza wzorca -a (są nieodmienne)", () => {
    // Rodzaj "female" przychodzi ze słownika imion albo z metadanych konta.
    for (const name of ["Nicole", "Karin", "Miriam", "Ruth", "Beatrycze"]) {
      expect(polishVocative(name, "female")).toBe(name);
    }
    // Nawet błędnie oznaczony rodzaj nie produkuje bełkotu ("Jao").
    expect(polishVocative("Jan", "female")).toBe("Jan");
  });

  it("męskie imię na -a z jawnym rodzajem nadal dostaje wołacz", () => {
    expect(polishVocative("Jarema", "male")).toBe("Jaremo");
  });
});

describe("polishVocative - wielkość liter", () => {
  it("zachowuje małe litery, kapitalik i WERSALIKI", () => {
    expect(polishVocative("mateusz")).toBe("mateuszu");
    expect(polishVocative("Mateusz")).toBe("Mateuszu");
    expect(polishVocative("MATEUSZ")).toBe("MATEUSZU");
    expect(polishVocative("ANNA")).toBe("ANNO");
    expect(polishVocative("PAWEŁ")).toBe("PAWLE");
    expect(polishVocative("paweł")).toBe("pawle");
  });

  it("nie gubi wielkich liter we wnętrzu imienia", () => {
    expect(polishVocative("McDonald")).toBe("McDonaldzie");
    expect(polishVocative("O'Brien")).toBe("O'Brienie");
  });
});

describe("polishVocative - imiona złożone i formy nietypowe", () => {
  it("odmienia każdy człon imienia z łącznikiem, zostawiając łącznik i wielkość liter", () => {
    expect(polishVocative("Anna-Maria")).toBe("Anno-Mario");
    expect(polishVocative("Anna-Maria", "female")).toBe("Anno-Mario");
    expect(polishVocative("Jan-Paweł Nowak")).toBe("Janie-Pawle");
  });

  it("zwraca mianownik dla inicjałów, cyfr, obcych znaków i pustych wejść", () => {
    // Jürgen/Björn kończą się "polską" spółgłoską - bez sprawdzenia alfabetu
    // dostałyby "-ie" ("Jürgenie"), choć silnik nie zna ich odmiany.
    for (const odd of ["J.", "X", "1", "Ann3", "Zoë", "José", "Łukasz2", "Jürgen", "Björn"]) {
      expect(polishVocative(odd)).toBe(odd);
    }
    expect(polishVocative("   ")).toBe("");
    expect(polishVocative("  Marek  ")).toBe("Marku");
  });

  it("nie rzuca i nie zwraca kodu dla kluczy prototypu Object", () => {
    // Tabela wyjątków była zwykłym obiektem: "constructor" trafiał w
    // Object.prototype.constructor i odmiana rzucała TypeError.
    expect(polishVocative("constructor")).toBe("constructorze");
    expect(polishVocative("Constructor")).toBe("Constructorze");
    expect(polishVocative("__proto__")).toBe("__proto__");
    for (const key of ["toString", "valueOf", "hasOwnProperty", "isPrototypeOf"]) {
      const out = polishVocative(key);
      expect(typeof out).toBe("string");
      expect(out).not.toMatch(/native code|function/);
      expect(out.startsWith(key)).toBe(true);
    }
  });
});

describe("polishVocativeParts", () => {
  it("odmienia każdy człon rozdzielony spacją lub łącznikiem, zachowując separatory", () => {
    expect(polishVocativeParts("Jan Paweł")).toBe("Janie Pawle");
    expect(polishVocativeParts("Anna-Maria")).toBe("Anno-Mario");
    expect(polishVocativeParts("Jan  Maria")).toBe("Janie  Mario");
    expect(polishVocativeParts("J. Paweł")).toBe("J. Pawle");
    expect(polishVocativeParts("")).toBe("");
  });

  it("przekazuje jawny rodzaj każdemu członowi", () => {
    expect(polishVocativeParts("Nicole Anna", "female")).toBe("Nicole Anno");
  });
});

describe("detectPolishGender", () => {
  it("rozpoznaje męskie imiona na -a i ignoruje wielkość liter oraz spacje", () => {
    expect(detectPolishGender("KUBA")).toBe("male");
    expect(detectPolishGender("  Barnaba ")).toBe("male");
    expect(detectPolishGender("Kosma")).toBe("male");
    expect(detectPolishGender("Bonawentura")).toBe("male");
    expect(detectPolishGender("Aleksy")).toBe("male");
    expect(detectPolishGender("Anna")).toBe("female");
    expect(detectPolishGender("")).toBe("unknown");
    expect(detectPolishGender("   ")).toBe("unknown");
  });
});

describe("emailGreeting", () => {
  it("PL: wołacz z silnika, z override ze słownika imion i bez imienia", () => {
    expect(emailGreeting("pl", "Mateusz")).toBe("Dzień dobry, Mateuszu");
    expect(emailGreeting("pl", "  Kasia  ")).toBe("Dzień dobry, Kasiu");
    expect(emailGreeting("pl", "Nicole", "female")).toBe("Dzień dobry, Nicole");
    expect(emailGreeting("pl", undefined)).toBe("Dzień dobry");
    expect(emailGreeting("pl", "   ")).toBe("Dzień dobry");
    // Pusty / biały override nie wygrywa z odmianą silnika.
    expect(emailGreeting("pl", "Paweł", "male", "   ")).toBe("Dzień dobry, Pawle");
    expect(emailGreeting("pl", "Paweł", "male", null)).toBe("Dzień dobry, Pawle");
    // Override działa także wtedy, gdy imienia brak.
    expect(emailGreeting("pl", null, "unknown", "Szefie")).toBe("Dzień dobry, Szefie");
  });

  it("PL: nie wywraca się na imieniu będącym kluczem prototypu", () => {
    expect(emailGreeting("pl", "Constructor")).toBe("Dzień dobry, Constructorze");
  });

  it("EN: mianownik pierwszego członu albo neutralne powitanie", () => {
    expect(emailGreeting("en", "Anna Maria")).toBe("Hi Anna,");
    expect(emailGreeting("en", "  Mateusz  ")).toBe("Hi Mateusz,");
    expect(emailGreeting("en", null)).toBe("Hello,");
    expect(emailGreeting("en", undefined, "female", "Anno")).toBe("Hello,");
  });
});
