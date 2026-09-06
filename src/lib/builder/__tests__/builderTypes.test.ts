// PRYMITYWY DOKUMENTU BUDOWNICZEGO - `emptyDocument` i `isEmptyDocument`.
//
// `types.ts` to niemal wylacznie deklaracje typow; kodu wykonywalnego sa w nim
// DWIE linie. I wlasnie dlatego nie mial wlasnego testu: pokrycie "przechodzilo"
// przy okazji importow, a jedyne wywolanie `isEmptyDocument` w tescie
// (`src/components/popups/__tests__/PopupHost.test.tsx:66`) jest ATRAPA - tamten
// plik podmienia funkcje na wlasna, wiec o PRAWDZIWEJ nie dowodzi niczego.
//
// CO TU JEST DO OBRONY
//
// 1. `isEmptyDocument` to wspolna bramka DWOCH powierzchni o przeciwnych
//    skutkach: edytor (`Builder.tsx:674`) pokazuje na niej zachete "dodaj
//    pierwsza sekcje", a publiczny host popupow (`PopupHost.tsx:72`) na jej
//    podstawie POMIJA render. Falszywe "puste" chowa tresc czytelnikowi;
//    falszywe "niepuste" wystawia mu pusta warstwe modalna, ktora trzeba
//    zamknac. Obie pomylki sa widoczne dla uzytkownika.
// 2. Bramka dostaje dane SPRZED walidacji. `PopupHost` podaje surowe
//    `builder_data` z JSONB, wiec `doc.sections` bywa czymkolwiek - i wtedy
//    liczy sie galaz `!Array.isArray(...)`, a nie `length === 0`.
// 3. `emptyDocument()` musi budowac NOWA tablice przy kazdym wywolaniu. Gdyby
//    zwracala wspoldzielona stala, dolozenie sekcji do jednego pustego
//    dokumentu dolozyloby ja wszystkim naraz.
//
// GRANICA DOWODU: `isEmptyDocument` liczy WYLACZNIE sekcje, a nie ich
// zawartosc. Sekcja bez dzieci nadal uchodzi za tresc - i slusznie, bo moze
// niesc tlo, dzielnik ksztaltu albo wymuszona wysokosc. Ten plik przypina taki
// wynik jako stan faktyczny i nie zglasza go jako defektu.
import { describe, expect, it } from "vitest";
import { emptyDocument, isEmptyDocument } from "@/lib/builder/types";
import type { BuilderDocument, SectionNode } from "@/lib/builder/types";

const sekcja = (id: string): SectionNode => ({ id, kind: "section", children: [] });

describe("emptyDocument", () => {
  it("daje dokument w wersji 1 bez sekcji", () => {
    expect(emptyDocument()).toEqual({ version: 1, sections: [] });
  });

  it("daje ZA KAZDYM RAZEM nowa tablice sekcji", () => {
    // Wspoldzielona tablica sprawilaby, ze dodanie sekcji do jednego swiezego
    // dokumentu pojawia sie w kazdym innym utworzonym ta sama funkcja.
    const a = emptyDocument();
    const b = emptyDocument();
    a.sections.push(sekcja("s1"));

    expect(b.sections).toEqual([]);
    expect(a.sections).not.toBe(b.sections);
  });

  it("swiezy dokument jest z definicji pusty", () => {
    expect(isEmptyDocument(emptyDocument())).toBe(true);
  });
});

describe("isEmptyDocument", () => {
  it("uznaje brak dokumentu za pusty", () => {
    expect(isEmptyDocument(null)).toBe(true);
    expect(isEmptyDocument(undefined)).toBe(true);
  });

  it("uznaje dokument z zerowa liczba sekcji za pusty", () => {
    expect(isEmptyDocument({ version: 1, sections: [] })).toBe(true);
  });

  it("uznaje dokument, w ktorym sections NIE JEST tablica, za pusty", () => {
    // Wejscie z JSONB: `PopupHost` podaje surowe `builder_data`, wiec pole
    // bywa napisem, obiektem albo w ogole go nie ma. Kazde takie wejscie musi
    // dac "pusto", zamiast wywalac sie na `.length`.
    expect(isEmptyDocument({ version: 1, sections: "brak" } as unknown as BuilderDocument)).toBe(
      true,
    );
    expect(isEmptyDocument({ version: 1, sections: {} } as unknown as BuilderDocument)).toBe(true);
    expect(isEmptyDocument({ version: 1 } as unknown as BuilderDocument)).toBe(true);
    expect(isEmptyDocument({} as unknown as BuilderDocument)).toBe(true);
  });

  it("uznaje dokument z choc jedna sekcja za NIEPUSTY", () => {
    expect(isEmptyDocument({ version: 1, sections: [sekcja("s1")] })).toBe(false);
  });

  it("STAN FAKTYCZNY: sekcja BEZ dzieci nadal liczy sie jako tresc", () => {
    // Granica dowodu z naglowka: bramka patrzy na liczbe sekcji, nie na to, co
    // w nich jest. Sekcja bez widgetow moze byc calkowicie zamierzona (tlo,
    // dzielnik, odstep), wiec to NIE jest defekt - ale jest wynikiem, ktory
    // trzeba miec przypiety, zanim ktos "poprawi" bramke na liczenie widgetow
    // i wygasi w ten sposob dekoracyjne sekcje na produkcji.
    const dokument: BuilderDocument = { version: 1, sections: [sekcja("tylko-tlo")] };

    expect(isEmptyDocument(dokument)).toBe(false);
  });

  it("STAN FAKTYCZNY: pusta tablica podana zamiast dokumentu uchodzi za pusta", () => {
    // Tablica jest prawdziwa, wiec pierwsza galaz jej nie lapie; ratuje dopiero
    // brak pola `sections`. Wejscie realne, bo `builder_data` z bazy bywa
    // tablica blokow ze starego silnika tresci.
    expect(isEmptyDocument([] as unknown as BuilderDocument)).toBe(true);
    expect(isEmptyDocument([{ type: "paragraph" }] as unknown as BuilderDocument)).toBe(true);
  });
});
