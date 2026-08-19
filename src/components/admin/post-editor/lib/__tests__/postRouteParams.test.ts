import { describe, expect, it } from "vitest";
import {
  parsePostEditorSearch,
  resolveEditorLang,
  shouldStartPostCreation,
  type NewPostGate,
} from "../postRouteParams";
import { viewLangFor } from "../postsListQuery";

describe("parsePostEditorSearch", () => {
  it("przepuszcza dwa istniejące języki wpisu", () => {
    expect(parsePostEditorSearch({ lang: "pl" })).toEqual({ lang: "pl" });
    expect(parsePostEditorSearch({ lang: "en" })).toEqual({ lang: "en" });
  });

  it("REGRESJA: nieznany język znika z adresu zamiast trafić do edytora", () => {
    // Edytor czyta pola `title_<lang>` / `content_<lang>`, a tabela ma tylko
    // wersję PL i EN. Przepuszczony `?lang=de` otworzyłby panel dla wersji,
    // której nie ma - z pustymi polami, które autozapis zapisałby jako zmianę.
    expect(parsePostEditorSearch({ lang: "de" })).toEqual({});
    expect(parsePostEditorSearch({ lang: "" })).toEqual({});
    expect(parsePostEditorSearch({ lang: "PL" })).toEqual({});
    expect(parsePostEditorSearch({ lang: "pl-PL" })).toEqual({});
  });

  it("wartości nie-napisowe też odpadają", () => {
    // Parametry adresu potrafią przyjść jako tablica (`?lang=pl&lang=en`)
    // albo jako obiekt po deserializacji - żadna z tych form nie jest językiem.
    expect(parsePostEditorSearch({ lang: ["pl"] })).toEqual({});
    expect(parsePostEditorSearch({ lang: { value: "pl" } })).toEqual({});
    expect(parsePostEditorSearch({ lang: 1 })).toEqual({});
    expect(parsePostEditorSearch({ lang: null })).toEqual({});
    expect(parsePostEditorSearch({ lang: undefined })).toEqual({});
  });

  it("brak parametru daje puste wyszukiwanie, nie wyjątek", () => {
    expect(parsePostEditorSearch({})).toEqual({});
  });

  it("REGRESJA: obce parametry NIE przechodzą do stanu wyszukiwania trasy", () => {
    // `validateSearch` jest jedynym filtrem adresu dla tej trasy. Cokolwiek
    // z niego wyjdzie, TanStack Router trzyma jako stan i odtwarza w każdym
    // kolejnym linku - obce klucze zostałyby w pasku adresu na stałe.
    const parsed = parsePostEditorSearch({ lang: "en", redirect: "//evil", step: "content" });
    expect(parsed).toEqual({ lang: "en" });
    expect(Object.keys(parsed)).toEqual(["lang"]);
  });
});

describe("resolveEditorLang", () => {
  it("parametr z listy WYGRYWA z językiem interfejsu", () => {
    // Redaktor kliknął wiersz na liście zawężonej do wersji angielskich -
    // ma dostać edytor EN, choćby panel miał UI po polsku. Inaczej pisałby
    // poprawki do wersji polskiej i „poprawiona” wersja EN nigdy by nie powstała.
    expect(resolveEditorLang("en", "pl")).toBe("en");
    expect(resolveEditorLang("pl", "en")).toBe("pl");
  });

  it("bez parametru decyduje język interfejsu", () => {
    expect(resolveEditorLang(undefined, "en")).toBe("en");
    expect(resolveEditorLang(undefined, "en-GB")).toBe("en");
    expect(resolveEditorLang(undefined, "pl")).toBe("pl");
    expect(resolveEditorLang(undefined, "pl-PL")).toBe("pl");
  });

  it("nieznany albo brakujący język interfejsu schodzi na polski", () => {
    expect(resolveEditorLang(undefined, undefined)).toBe("pl");
    expect(resolveEditorLang(undefined, null)).toBe("pl");
    expect(resolveEditorLang(undefined, "")).toBe("pl");
    expect(resolveEditorLang(undefined, "de")).toBe("pl");
  });

  it("REGRESJA: język widoku listy przechodzi przez adres bez zgubienia", () => {
    // Kontrakt między dwiema trasami: lista buduje link `?lang=<viewLang>`,
    // a edytor waliduje go własną funkcją. Gdyby lista zaczęła oddawać
    // cokolwiek innego niż „pl”/„en”, walidacja wycięłaby parametr po cichu
    // i edytor otworzyłby wersję zgodną z UI - czyli nie tę, którą redaktor
    // przed chwilą filtrował.
    for (const langFilter of ["en_only", "has_en"] as const) {
      const viewLang = viewLangFor(langFilter, "pl");
      expect(parsePostEditorSearch({ lang: viewLang })).toEqual({ lang: "en" });
      expect(resolveEditorLang(parsePostEditorSearch({ lang: viewLang }).lang, "pl")).toBe("en");
    }
    for (const langFilter of ["pl_only", "has_pl"] as const) {
      const viewLang = viewLangFor(langFilter, "en");
      expect(parsePostEditorSearch({ lang: viewLang })).toEqual({ lang: "pl" });
      expect(resolveEditorLang(parsePostEditorSearch({ lang: viewLang }).lang, "en")).toBe("pl");
    }
  });
});

describe("shouldStartPostCreation", () => {
  function gate(over: Partial<NewPostGate> = {}): NewPostGate {
    return {
      loading: false,
      busy: false,
      user: { id: "user-1" },
      tenantId: "tenant-1",
      alreadyStarted: false,
      ...over,
    };
  }

  it("zalogowany użytkownik z rozwiązanym obszarem startuje tworzenie szkicu", () => {
    expect(shouldStartPostCreation(gate())).toBe(true);
  });

  it("REGRESJA: znacznik startu blokuje DRUGIE wejście, choć `busy` jest jeszcze false", () => {
    // Dokładny scenariusz StrictMode: React montuje efekt dwa razy, a `busy`
    // ze `useState` aktualizuje się dopiero w kolejnym renderze - drugie
    // wejście widzi `busy === false`. Bez blokady na znaczniku jedno
    // kliknięcie „Nowy wpis” zostawiłoby w bazie DWA puste szkice, a redaktor
    // otworzyłby tylko jeden - drugi zostałby na liście jako śmieć.
    expect(shouldStartPostCreation(gate({ busy: false, alreadyStarted: true }))).toBe(false);
  });

  it("nierozwiązana sesja wstrzymuje tworzenie", () => {
    // W trakcie ładowania `user` i `tenantId` bywają jeszcze puste; start
    // w tym momencie poleciałby bez tenanta albo bez autora.
    expect(shouldStartPostCreation(gate({ loading: true }))).toBe(false);
  });

  it("trwające tworzenie nie startuje po raz drugi", () => {
    expect(shouldStartPostCreation(gate({ busy: true }))).toBe(false);
  });

  it("brak użytkownika blokuje", () => {
    expect(shouldStartPostCreation(gate({ user: null }))).toBe(false);
    expect(shouldStartPostCreation(gate({ user: undefined }))).toBe(false);
  });

  it("REGRESJA: brak obszaru roboczego blokuje tak samo jak brak użytkownika", () => {
    // Szkic zapisany bez `tenant_id` nie należałby do żadnego obszaru: nie
    // pokazałby się na liście, a mimo to zająłby slug.
    expect(shouldStartPostCreation(gate({ tenantId: null }))).toBe(false);
    expect(shouldStartPostCreation(gate({ tenantId: undefined }))).toBe(false);
    expect(shouldStartPostCreation(gate({ tenantId: "" }))).toBe(false);
  });

  it("każdy warunek z osobna wystarczy do zablokowania", () => {
    const blockers: Partial<NewPostGate>[] = [
      { loading: true },
      { busy: true },
      { user: null },
      { tenantId: null },
      { alreadyStarted: true },
    ];
    for (const over of blockers) {
      expect(shouldStartPostCreation(gate(over)), JSON.stringify(over)).toBe(false);
    }
  });
});
