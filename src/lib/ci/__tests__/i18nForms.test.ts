// Testy pomocnika bramek `i18nForms`. Pomocnik bramki bez testu może przestać
// cokolwiek widzieć i nikt tego nie zauważy, bo cicho zielona bramka wygląda
// dokładnie jak spełniony inwariant.
import { describe, expect, it } from "vitest";
import { SUFIKSY_LICZEBNIKA, bazaLiczebnika, kluczeFormy, maTresc } from "@/lib/ci/i18nForms";

const slownik = (klucze: string[]) => (k: string) => klucze.includes(k);

describe("bazaLiczebnika - nazwa klucza bez formy", () => {
  it("odcina każdą kategorię i18next", () => {
    for (const s of SUFIKSY_LICZEBNIKA) {
      expect(bazaLiczebnika(`droppedValues_${s}`)).toBe("droppedValues");
    }
  });

  it("NIE rusza nazwy, która tylko kończy się podobnie", () => {
    // `readOnly` kończy się na „only", nie na `_one`. Odcinanie po fragmencie
    // zamiast po sufiksie zjadłoby nazwy zwykłych kluczy.
    expect(bazaLiczebnika("readOnly")).toBe("readOnly");
    expect(bazaLiczebnika("someone")).toBe("someone");
    expect(bazaLiczebnika("other")).toBe("other");
    expect(bazaLiczebnika("droppedValues")).toBe("droppedValues");
  });

  it("odcina TYLKO ostatni sufiks", () => {
    expect(bazaLiczebnika("a_one_many")).toBe("a_one");
  });
});

describe("maTresc - klucz ma treść wprost albo w formach", () => {
  it("widzi klucz stojący wprost", () => {
    expect(maTresc(slownik(["a.b"]), "a.b")).toBe(true);
  });

  it("widzi klucz rozpisany na formy", () => {
    expect(maTresc(slownik(["a.b_one", "a.b_few", "a.b_many"]), "a.b")).toBe(true);
    expect(maTresc(slownik(["a.b_one", "a.b_other"]), "a.b")).toBe(true);
  });

  it("SAM `_one` to za mało - dla dwóch i więcej i18next wypisze surowy klucz", () => {
    expect(maTresc(slownik(["a.b_one"]), "a.b")).toBe(false);
  });

  it("sama forma mnoga bez pojedynczej też jest połową wdrożenia", () => {
    expect(maTresc(slownik(["a.b_many", "a.b_other"]), "a.b")).toBe(false);
  });

  it("brak klucza to brak treści", () => {
    expect(maTresc(slownik(["a.c"]), "a.b")).toBe(false);
  });
});

describe("kluczeFormy - gdzie naprawdę leży treść", () => {
  it("klucz zwykły to on sam", () => {
    expect(kluczeFormy(slownik(["a.b"]), "a.b")).toEqual(["a.b"]);
  });

  it("klucz liczebnikowy to WSZYSTKIE jego formy", () => {
    const k = kluczeFormy(slownik(["a.b_one", "a.b_few", "a.b_many"]), "a.b");
    expect(new Set(k)).toEqual(new Set(["a.b_one", "a.b_few", "a.b_many"]));
  });

  it("ścieżka bez treści nie daje żadnego klucza", () => {
    expect(kluczeFormy(slownik(["a.c"]), "a.b")).toEqual([]);
  });
});
