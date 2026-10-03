// `langCookie` - odczyt/zapis ciasteczka preferencji języka i wykrycie języka
// przeglądarki. Ciasteczko przychodzi spoza naszej kontroli (inna aplikacja na
// domenie, rozszerzenie, ręczna edycja) i żyje rok, więc parser musi znieść
// każdą wartość: zepsuta = brak preferencji, nigdy wyjątek.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LANG_COOKIE_MAX_AGE,
  detectBrowserLang,
  readLangCookieClient,
  readLangCookieFromHeader,
  writeLangCookieClient,
} from "../langCookie";
import { detectLangFromAcceptLanguage } from "../langNegotiation";

const MALFORMED = ["%", "%E0%A4%A", "%zz", "en%"];

function clearCookies() {
  for (const name of ["nes_lang", "lovable_lang", "xnes_lang"]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(clearCookies);
afterEach(() => {
  clearCookies();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readLangCookieFromHeader - nagłówek `Cookie:`", () => {
  it("bez nagłówka nie ma preferencji", () => {
    expect(readLangCookieFromHeader(null)).toBeNull();
    expect(readLangCookieFromHeader(undefined)).toBeNull();
    expect(readLangCookieFromHeader("")).toBeNull();
    expect(readLangCookieFromHeader("theme=dark; sb-x=1")).toBeNull();
  });

  it("znajduje ciasteczko na każdej pozycji i z każdym odstępem po średniku", () => {
    expect(readLangCookieFromHeader("nes_lang=en")).toBe("en");
    expect(readLangCookieFromHeader("a=1; nes_lang=en; b=2")).toBe("en");
    expect(readLangCookieFromHeader("a=1;nes_lang=en")).toBe("en");
    expect(readLangCookieFromHeader("a=1;   nes_lang=en")).toBe("en");
  });

  it("normalizuje wartość jak reszta i18n (wielkość liter, region)", () => {
    expect(readLangCookieFromHeader("nes_lang=EN-gb")).toBe("en");
    expect(readLangCookieFromHeader("nes_lang=pl-PL")).toBe("pl");
  });

  it("dekoduje wartość symetrycznie do zapisu (encodeURIComponent)", () => {
    expect(readLangCookieFromHeader("nes_lang=%65n")).toBe("en");
  });

  it("nie myli ciasteczka, którego nazwa tylko KOŃCZY się albo ZACZYNA na nes_lang", () => {
    expect(readLangCookieFromHeader("xnes_lang=en")).toBeNull();
    expect(readLangCookieFromHeader("a=1; xnes_lang=en")).toBeNull();
    expect(readLangCookieFromHeader("a=1;xnes_lang=en")).toBeNull();
    expect(readLangCookieFromHeader("nes_lang_old=en")).toBeNull();
    // Obok obcego ciasteczka o podobnej nazwie wygrywa właściwe.
    expect(readLangCookieFromHeader("xnes_lang=en; nes_lang=pl")).toBe("pl");
    expect(readLangCookieFromHeader("xlovable_lang=en")).toBeNull();
  });

  it.each(MALFORMED)("zepsuta sekwencja procentowa %s = brak preferencji, nie wyjątek", (raw) => {
    // Bez osłony decodeURIComponent rzucał URIError: na serwerze prosto w
    // homepageLangMiddleware -> errorMiddleware -> 500 na "/" dla tego
    // odwiedzającego (na rok, tyle żyje ciasteczko).
    expect(() => readLangCookieFromHeader(`nes_lang=${raw}`)).not.toThrow();
    expect(readLangCookieFromHeader(`nes_lang=${raw}`)).toBeNull();
    expect(readLangCookieFromHeader(`lovable_lang=${raw}`)).toBeNull();
  });

  it("zepsuta nowa nazwa nadal oddaje głos nazwie zapasowej", () => {
    expect(readLangCookieFromHeader("nes_lang=%E0%A4%A; lovable_lang=en")).toBe("en");
    expect(readLangCookieFromHeader("lovable_lang=en; nes_lang=%")).toBe("en");
  });

  it("zepsutej wartości nie zgadujemy z surowego tekstu, nawet gdy przypomina kod języka", () => {
    // `en-%` po normalizacji surowego tekstu dałoby "en" - zepsuta wartość ma
    // jednak oddać głos nazwie zapasowej / Accept-Language, a nie wygrać.
    expect(readLangCookieFromHeader("nes_lang=en-%")).toBeNull();
    expect(readLangCookieFromHeader("nes_lang=en-%E0%A4%A; lovable_lang=pl")).toBe("pl");
  });

  it("zduplikowana nazwa: zepsuty/obcy egzemplarz nie przesłania poprawnego", () => {
    // Ciasteczko z Domain= rodzica (inna aplikacja na domenie) i nasze host-only
    // przychodzą w JEDNYM nagłówku pod tą samą nazwą; starsze idzie pierwsze.
    // Czytanie tylko pierwszego wystąpienia unieważniało każdy zapis klienta, a
    // negocjacja "/" nadpisywała świadomy wybór języka z Accept-Language.
    expect(readLangCookieFromHeader("nes_lang=%E0%A4%A; nes_lang=en")).toBe("en");
    expect(readLangCookieFromHeader("nes_lang=de;nes_lang=en; lovable_lang=pl")).toBe("en");
    // Pierwsze poprawne wystąpienie wygrywa, a nowa nazwa nadal przed zapasową.
    expect(readLangCookieFromHeader("nes_lang=pl; nes_lang=en")).toBe("pl");
    expect(readLangCookieFromHeader("lovable_lang=pl; nes_lang=%; nes_lang=en")).toBe("en");
  });

  it("wartość nieobsługiwana, pusta, w cudzysłowie albo ze spacją = brak preferencji", () => {
    // Nigdy takiej nie zapisujemy - lepiej oddać decyzję Accept-Language niż
    // zgadywać. Nazwa zapasowa wciąż ma głos.
    for (const raw of ["de", "", '"en"', "e n", "%20en"]) {
      expect(readLangCookieFromHeader(`nes_lang=${raw}`)).toBeNull();
    }
    expect(readLangCookieFromHeader("nes_lang=de; lovable_lang=en")).toBe("en");
    expect(readLangCookieFromHeader('nes_lang="en"; lovable_lang=pl')).toBe("pl");
  });
});

describe("readLangCookieClient - document.cookie", () => {
  it("czyta preferencję zapisaną w przeglądarce (także pod starą nazwą)", () => {
    expect(readLangCookieClient()).toBeNull();
    document.cookie = "lovable_lang=en; path=/";
    expect(readLangCookieClient()).toBe("en");
    document.cookie = "nes_lang=pl; path=/";
    expect(readLangCookieClient()).toBe("pl");
  });

  it("parsuje document.cookie także bez spacji po średniku", () => {
    vi.spyOn(document, "cookie", "get").mockReturnValue("theme=dark;nes_lang=en");
    expect(readLangCookieClient()).toBe("en");
  });

  it("nie myli obcego ciasteczka o nazwie kończącej się na nes_lang", () => {
    document.cookie = "xnes_lang=en; path=/";
    expect(readLangCookieClient()).toBeNull();
  });

  it("zapis klienta naprawia preferencję także obok zepsutego egzemplarza z innej domeny", () => {
    // document.cookie podaje oba egzemplarze; nasz zapis (host-only) musi zostać
    // odczytany, inaczej backfill w i18n.ts pisałby ciasteczko przy każdym wejściu.
    vi.spyOn(document, "cookie", "get").mockReturnValue("nes_lang=%; theme=dark; nes_lang=en");
    expect(readLangCookieClient()).toBe("en");
  });

  it("zepsuta wartość nie wywraca klienta i oddaje głos nazwie zapasowej", () => {
    document.cookie = "nes_lang=%E0%A4%A; path=/";
    expect(() => readLangCookieClient()).not.toThrow();
    expect(readLangCookieClient()).toBeNull();
    document.cookie = "lovable_lang=en; path=/";
    expect(readLangCookieClient()).toBe("en");
  });
});

describe("writeLangCookieClient", () => {
  function captureWrite(lang: "pl" | "en"): string {
    const set = vi.spyOn(document, "cookie", "set");
    writeLangCookieClient(lang);
    expect(set).toHaveBeenCalledOnce();
    return String(set.mock.calls[0][0]);
  }

  it("zapisuje WYŁĄCZNIE nową nazwę - i czyta ją z powrotem", () => {
    expect(captureWrite("en")).toMatch(/^nes_lang=en;/);
    vi.restoreAllMocks();
    writeLangCookieClient("en");
    expect(readLangCookieClient()).toBe("en");
  });

  it("po http bez Secure", () => {
    expect(location.protocol).toBe("http:");
    expect(captureWrite("en")).toBe(
      `nes_lang=en; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });

  it("po https z Secure (bez wycieku przy degradacji do http)", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    expect(captureWrite("pl")).toBe(
      `nes_lang=pl; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax; Secure`,
    );
  });

  it("bez obiektu location nadal zapisuje, tylko bez Secure", () => {
    vi.stubGlobal("location", undefined);
    expect(captureWrite("en")).not.toContain("Secure");
  });

  it("naprawia zepsute ciasteczko: zapis nadpisuje je poprawną wartością", () => {
    document.cookie = "nes_lang=%; path=/";
    expect(readLangCookieClient()).toBeNull();
    writeLangCookieClient("en");
    expect(readLangCookieClient()).toBe("en");
  });
});

describe("detectBrowserLang - preferencja przeglądarki", () => {
  function browser(languages: readonly string[] | undefined, language: string) {
    // `undefined` = starsza przeglądarka bez navigator.languages.
    vi.spyOn(navigator, "languages", "get").mockReturnValue(languages as readonly string[]);
    vi.spyOn(navigator, "language", "get").mockReturnValue(language);
  }

  it("polski na czele listy -> pl, każdy inny język na czele -> en", () => {
    browser(["pl-PL", "en-US"], "pl-PL");
    expect(detectBrowserLang()).toBe("pl");
    browser(["de-DE", "fr"], "de-DE");
    expect(detectBrowserLang()).toBe("en");
    browser(["PL"], "PL");
    expect(detectBrowserLang()).toBe("pl");
  });

  it("decyduje NAJWYŻSZA preferencja, nie samo wystąpienie polskiego na liście", () => {
    browser(["en-US", "pl"], "en-US");
    expect(detectBrowserLang()).toBe("en");
  });

  it("pusta lista języków -> navigator.language", () => {
    browser([], "pl");
    expect(detectBrowserLang()).toBe("pl");
    browser([], "de-AT");
    expect(detectBrowserLang()).toBe("en");
    browser(undefined, "pl-PL");
    expect(detectBrowserLang()).toBe("pl");
  });

  it("pusty wpis na czele listy nie jest preferencją", () => {
    browser(["", "pl-PL"], "en-US");
    expect(detectBrowserLang()).toBe("pl");
  });

  it("język o kodzie zaczynającym się od 'pl' (np. plt - malgaski) to nie polski", () => {
    browser(["plt-MG", "pl"], "plt-MG");
    expect(detectBrowserLang()).toBe("en");
  });

  it("przeglądarka bez żadnej preferencji -> null (nic nie zgadujemy)", () => {
    browser([], "");
    expect(detectBrowserLang()).toBeNull();
  });

  it("brak navigator -> null", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectBrowserLang()).toBeNull();
  });

  it.each([
    [["pl-PL", "en"]],
    [["en-US", "pl"]],
    [["de", "pl-PL", "en"]],
    [["fr-CA"]],
    [["PL-pl"]],
  ])(
    "ta sama lista preferencji daje tę samą decyzję na kliencie i na serwerze: %j",
    (languages) => {
      // Klient (backfill ciasteczka przy wejściu głębokim linkiem) i serwer
      // (negocjacja gołego "/") muszą zgadzać się co do reguły - inaczej język
      // tego samego czytelnika zależy od strony, którą wszedł.
      browser(languages, languages[0]);
      expect(detectBrowserLang()).toBe(detectLangFromAcceptLanguage(languages.join(", ")));
    },
  );
});

describe("konsekwencje po stronie klienta: localeRuntime zasiewa język przy imporcie", () => {
  async function loadRuntimeAt(path: string) {
    vi.resetModules();
    window.history.replaceState(null, "", path);
    vi.doMock("@tanstack/react-start", () => ({
      createIsomorphicFn: () => ({
        server: () => ({ client: <C>(clientImpl: C) => clientImpl }),
      }),
    }));
    vi.doMock("@tanstack/react-start/server", () => ({
      getRequest: () => {
        throw new Error("poza kontekstem Startu");
      },
    }));
    return import("../localeRuntime");
  }

  afterEach(() => {
    vi.doUnmock("@tanstack/react-start");
    vi.doUnmock("@tanstack/react-start/server");
    window.history.replaceState(null, "", "/");
  });

  it("zepsute ciasteczko na stronie aplikacji nie wywraca ewaluacji modułu", async () => {
    // Strona nielokalizowalna czyta preferencję JUŻ przy imporcie modułu
    // (resolveClientInitial) - URIError zabijał cały graf modułów klienta.
    document.cookie = "nes_lang=%E0%A4%A; path=/";
    const runtime = await loadRuntimeAt("/admin");
    expect(runtime.currentLang()).toBe("pl");
  });

  it("…a nazwa zapasowa nadal decyduje o języku strony aplikacji", async () => {
    document.cookie = "nes_lang=%; path=/";
    document.cookie = "lovable_lang=en; path=/";
    const runtime = await loadRuntimeAt("/profile");
    expect(runtime.currentLang()).toBe("en");
  });
});
