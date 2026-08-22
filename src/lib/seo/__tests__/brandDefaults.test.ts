// CO DOWODZI TEN PLIK
//
// Redakcyjny tytuł i opis serwisu (`site_settings["seo"]`) przekazywane do
// CZYSTYCH builderów `<head>` przez pamięć kluczowaną hostem. Moduł nie miał
// własnego pliku testowego - jego 50% gałęzi brało się z przypadkowego
// przejścia przez testy `meta.ts`.
//
// Trzy rzeczy, które są tu jedynym miejscem obrony:
//   1. IZOLACJA NAJEMCÓW. Klucz to host, więc współbieżny SSR w jednym isolate
//      nie może podać tytułu tenanta A na domenie tenanta B. Ten moduł jest
//      całą tą gwarancją - buildery `<head>` są czyste i nie mają dostępu do
//      site_settings, więc nie zweryfikują, czyj tytuł dostały.
//   2. NORMALIZACJA. `clean()` przycina i zamienia brak na pusty napis, bo
//      buildery rozstrzygają nadpisanie warunkiem „napis niepusty" - napis
//      z samych spacji przeszedłby jako tytuł i wyprodukował puste `<title>`.
//   3. SUFIT WPISÓW i kolejność eksmisji: isolate obsługujący wiele domen
//      musi trzymać te NAJŚWIEŻSZE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//
// * `meta.test.ts` i `siteIdentity.test.ts` - one dowodzą, jak buildery
//   `<head>` UŻYWAJĄ tych nadpisań (pierwszeństwo nad stałymi marki, sufiks
//   tytułu, `og:title`). Tutaj przedmiotem dowodu jest sama PAMIĘĆ.
// * `socialDefaults.test.ts` - `socialHostKey` jest wspólny dla obu modułów
//   i ma tam własną tabelę wejść; tu sprawdzamy tylko, że ten moduł go
//   faktycznie używa (a więc że oba trafiają w ten sam klucz hosta).
// * `e2e/seo.spec.ts` - jego test „head contract on ${path}" sprawdza gotowy
//   `<head>` na żywym SSR (obecność `og:title`, `canonical`, brak „lovable"
//   w tytule). Nie dotyka pamięci per-host, bo z zewnątrz jej nie widać.
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_BRAND_DEFAULTS,
  brandDefaultsFor,
  resetBrandDefaults,
  rememberBrandDefaults,
} from "@/lib/seo/brandDefaults";
import { socialHostKey } from "@/lib/seo/socialDefaults";

const FULL = {
  title: { pl: "Nowe Strategie Europejskie", en: "New European Strategies" },
  description: { pl: "Analizy polityki europejskiej.", en: "European policy analysis." },
};

beforeEach(() => resetBrandDefaults());

describe("rememberBrandDefaults / brandDefaultsFor", () => {
  it("zapamiętuje pełny zestaw i oddaje go dla tego hosta", () => {
    rememberBrandDefaults("nes.example", FULL);
    expect(brandDefaultsFor("nes.example")).toEqual(FULL);
  });

  it("host BEZ wpisu oddaje puste napisy, nie undefined", () => {
    // Buildery `<head>` rozstrzygają nadpisanie warunkiem „napis niepusty".
    // `undefined` w tym miejscu wywaliłoby `head()` KAŻDEJ trasy.
    expect(brandDefaultsFor("nieznany.example")).toEqual(EMPTY_BRAND_DEFAULTS);
  });

  it("dwa hosty trzymają OSOBNE wpisy - to cała izolacja najemców", () => {
    rememberBrandDefaults("a.example", {
      title: { pl: "A", en: "A" },
      description: { pl: "", en: "" },
    });
    rememberBrandDefaults("b.example", {
      title: { pl: "B", en: "B" },
      description: { pl: "", en: "" },
    });
    expect(brandDefaultsFor("a.example").title.pl).toBe("A");
    expect(brandDefaultsFor("b.example").title.pl).toBe("B");
  });

  it("używa TEGO SAMEGO klucza hosta co domyślna karta społecznościowa", () => {
    // Gdyby moduły normalizowały host inaczej, tytuł i karta rozeszłyby się
    // na tej samej domenie - jedno by zadziałało, drugie spadło na fallback.
    rememberBrandDefaults("NES.Example:443", FULL);
    expect(socialHostKey("NES.Example:443")).toBe(socialHostKey("https://nes.example/blog"));
    expect(brandDefaultsFor("https://nes.example/blog").title.pl).toBe(FULL.title.pl);
  });
});

describe("normalizacja wartości (`clean`)", () => {
  it.each([
    ["  Tytuł  ", "Tytuł"],
    ["Tytuł", "Tytuł"],
    ["   ", ""],
    ["", ""],
  ])("tytuł %j zapisuje się jako %j", (input, expected) => {
    // Napis z samych spacji MUSI wyjść jako pusty: inaczej przeszedłby przez
    // warunek „napis niepusty" w builderze i strona dostałaby puste `<title>`.
    rememberBrandDefaults("nes.example", {
      title: { pl: input, en: input },
      description: { pl: "", en: "" },
    });
    expect(brandDefaultsFor("nes.example").title).toEqual({ pl: expected, en: expected });
  });

  it("BRAK gałęzi `title` w zapisie daje puste napisy dla obu języków", () => {
    // `Partial<BrandDefaults>` znaczy, że root loader może podać tylko opis -
    // to jest ramię `value.title?.pl` z `?.`, którego nikt nie dowodził.
    rememberBrandDefaults("nes.example", { description: { pl: "Opis", en: "Desc" } });
    expect(brandDefaultsFor("nes.example")).toEqual({
      title: { pl: "", en: "" },
      description: { pl: "Opis", en: "Desc" },
    });
  });

  it("BRAK gałęzi `description` daje puste napisy dla obu języków", () => {
    rememberBrandDefaults("nes.example", { title: { pl: "Tytuł", en: "Title" } });
    expect(brandDefaultsFor("nes.example")).toEqual({
      title: { pl: "Tytuł", en: "Title" },
      description: { pl: "", en: "" },
    });
  });

  it("zapis PUSTEGO obiektu daje pełny zestaw pustych napisów", () => {
    rememberBrandDefaults("nes.example", {});
    expect(brandDefaultsFor("nes.example")).toEqual(EMPTY_BRAND_DEFAULTS);
  });

  it("jeden język podany, drugi nie - każdy rozstrzygany osobno", () => {
    rememberBrandDefaults("nes.example", {
      title: { pl: "Tylko PL", en: "" },
      description: { pl: "", en: "Only EN" },
    });
    expect(brandDefaultsFor("nes.example")).toEqual({
      title: { pl: "Tylko PL", en: "" },
      description: { pl: "", en: "Only EN" },
    });
  });
});

describe("sufit wpisów i kolejność eksmisji", () => {
  it("powtórny zapis tego samego hosta NADPISUJE, nie mnoży wpisów", () => {
    rememberBrandDefaults("nes.example", {
      title: { pl: "Stary", en: "Old" },
      description: { pl: "", en: "" },
    });
    rememberBrandDefaults("nes.example", {
      title: { pl: "Nowy", en: "New" },
      description: { pl: "", en: "" },
    });
    expect(brandDefaultsFor("nes.example").title).toEqual({ pl: "Nowy", en: "New" });
  });

  it("po przekroczeniu stu hostów wypada NAJSTARSZY wpis, a nie najnowszy", () => {
    // Pętla `while (byHost.size > MAX_HOSTS)` stała niepokryta. Eksmisja od
    // końca wyrzucałaby host, który właśnie odpowiada na żądanie - i strona
    // wracałaby do stałych marki bez żadnego błędu w logach.
    for (let i = 0; i < 105; i += 1) {
      rememberBrandDefaults(`host-${i}.example`, {
        title: { pl: `T${i}`, en: `T${i}` },
        description: { pl: "", en: "" },
      });
    }
    expect(brandDefaultsFor("host-0.example")).toEqual(EMPTY_BRAND_DEFAULTS);
    expect(brandDefaultsFor("host-4.example")).toEqual(EMPTY_BRAND_DEFAULTS);
    expect(brandDefaultsFor("host-5.example").title.pl).toBe("T5");
    expect(brandDefaultsFor("host-104.example").title.pl).toBe("T104");
  });

  it("ponowny zapis ODŚWIEŻA pozycję hosta w kolejce eksmisji", () => {
    // `byHost.delete(key)` przed `set` istnieje właśnie po to: host odpytywany
    // bez przerwy nie może wypaść tylko dlatego, że w tle przewinęło się sto
    // innych domen.
    rememberBrandDefaults("staly.example", {
      title: { pl: "S1", en: "S1" },
      description: { pl: "", en: "" },
    });
    for (let i = 0; i < 99; i += 1) {
      rememberBrandDefaults(`h${i}.example`, {
        title: { pl: `H${i}`, en: `H${i}` },
        description: { pl: "", en: "" },
      });
    }
    rememberBrandDefaults("staly.example", {
      title: { pl: "S2", en: "S2" },
      description: { pl: "", en: "" },
    });
    for (let i = 0; i < 5; i += 1) {
      rememberBrandDefaults(`n${i}.example`, {
        title: { pl: `N${i}`, en: `N${i}` },
        description: { pl: "", en: "" },
      });
    }
    expect(brandDefaultsFor("staly.example").title.pl).toBe("S2");
  });

  it("`resetBrandDefaults` czyści WSZYSTKIE hosty", () => {
    rememberBrandDefaults("a.example", FULL);
    rememberBrandDefaults("b.example", FULL);
    resetBrandDefaults();
    expect(brandDefaultsFor("a.example")).toEqual(EMPTY_BRAND_DEFAULTS);
    expect(brandDefaultsFor("b.example")).toEqual(EMPTY_BRAND_DEFAULTS);
  });
});
