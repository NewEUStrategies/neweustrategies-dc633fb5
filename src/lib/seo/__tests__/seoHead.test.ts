// `activeLang` z `src/lib/seo/head.ts` - reguła "jakim językiem jest to
// żądanie?" dla <head> (canonical, og:url, hreflang, <html lang>). Do
// 21.08.2026 plik miał 0% wykonanych linii.
//
// CO TEN PLIK DOWODZI:
//   1) PIERWSZEŃSTWO PREFIKSU ŚCIEŻKI - "/en/..." i samo "/en" (bez ukośnika
//      końcowego) rozstrzygają język, niezależnie od tego, co zwraca
//      `currentLang()`. To jest warunek spójności z kluczem cache'u brzegowego:
//      dokument z /en/* MUSI nieść EN-owy canonical, bo jest współdzielony.
//   2) SPADEK NA `currentLang()` DLA ŚCIEŻKI NAGIEJ - i to, że spadek jest
//      REALNIE odczytem funkcji (atrapa oddaje kolejno "pl" i "en", a wynik
//      idzie za nią), a nie zaszytą stałą "pl".
//   3) DOMYŚLNE ŹRÓDŁO ADRESU - bez argumentu czyta `getRequestUrl()`, dokładnie
//      raz, i rozstrzyga język z TEGO adresu.
//   4) FAIL-SOFT NA ZŁYM ADRESIE - niepoprawny adres wpada w `catch` i schodzi
//      na `currentLang()`, więc render <head> nigdy nie wybucha.
//   5) ODPORNOŚĆ NA DEFEKT PREFIKSU - "/enigma/wpis" NIE jest EN. Bez tego
//      każdy adres zaczynający się od liter "en" emitowałby kanoniczny link w
//      złym języku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `request.test.ts` - składania adresu żądania; tutaj `getRequestUrl` jest
//     atrapą i sprawdzane jest wyłącznie, ŻE i JAK jest wołane.
//   - testów `stripLangPrefix` / `localizedPath` w `src/lib/i18n/__tests__` -
//     `localePath.ts` zostaje PRAWDZIWY, badana jest kompozycja, nie tablica
//     prefiksów.
//   - `meta.test.ts` i `headContract.test.ts` - treści znaczników <head>
//     budowanych z już rozstrzygniętego języka.
//   - E2E: `e2e/seo.spec.ts`, testy "head contract on /" i "head contract on
//     /en", dowodzą html[lang] i absolutnego canonical na żywym SSR. Ten plik
//     nie renderuje ani jednej trasy i nie wykonuje ani jednego żądania -
//     wejściem jest napis z adresem, wyjściem kod języka.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeLang } from "@/lib/seo/head";
import type { AppLang } from "@/lib/i18n/localePath";

const state = vi.hoisted(() => ({
  /** Adres, który oddaje atrapa `getRequestUrl` (pusty = fail-closed serwera). */
  requestUrl: "",
  requestUrlCalls: 0,
  /** Język, który oddaje atrapa `currentLang` - spadek dla ścieżek nagich. */
  lang: "pl" as "pl" | "en",
  langCalls: 0,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => {
    state.requestUrlCalls += 1;
    return state.requestUrl;
  },
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => {
    state.langCalls += 1;
    return state.lang;
  },
}));

beforeEach(() => {
  state.requestUrl = "";
  state.requestUrlCalls = 0;
  state.lang = "pl";
  state.langCalls = 0;
});

describe("activeLang - prefiks ścieżki jest rozstrzygający", () => {
  it("adres z prefiksem /en/... daje 'en'", () => {
    expect(activeLang("/en/analizy/wpis")).toBe("en");
    expect(state.langCalls).toBe(0);
  });

  it("samo /en BEZ ukośnika końcowego daje 'en' (strona główna EN)", () => {
    expect(activeLang("/en")).toBe("en");
  });

  it("/en/ z ukośnikiem końcowym daje 'en'", () => {
    expect(activeLang("/en/")).toBe("en");
  });

  it("adres ABSOLUTNY z prefiksem daje 'en' (new URL obsługuje oba kształty)", () => {
    expect(activeLang("https://example.com/en/analizy/wpis")).toBe("en");
    expect(state.langCalls).toBe(0);
  });

  it("prefiks IGNORUJE wielkość liter - /EN/x też jest EN", () => {
    // Przypięcie faktycznego zachowania: wyrażenie prefiksu ma flagę `i`, więc
    // adres z wielkimi literami nie emituje canonicala w domyślnym języku.
    expect(activeLang("/EN/analizy")).toBe("en");
  });

  it("prefiks NIEJĘZYKOWY /enigma/... NIE może dać 'en'", () => {
    // Klasyczny defekt prefiksu: dopasowanie po samym `startsWith("/en")`
    // sprawiłoby, że KAŻDY adres zaczynający się od liter "en" emituje
    // kanoniczny link w złym języku (a przy okazji hreflang wskazujący sam
    // siebie). Tu granica segmentu jest wymagana, więc spada na `currentLang()`.
    state.lang = "pl";
    expect(activeLang("/enigma/wpis")).toBe("pl");
    expect(state.langCalls).toBe(1);
  });

  it("/pl/... NIE jest prefiksem języka - PL jest serwowany na ścieżce nagiej", () => {
    // PL to język domyślny, więc "/pl/x" nie jest kanonicznym adresem PL, tylko
    // zwykłą ścieżką; język bierze się z `currentLang()`.
    state.lang = "en";
    expect(activeLang("/pl/analizy")).toBe("en");
    expect(state.langCalls).toBe(1);
  });
});

describe("activeLang - spadek na currentLang() dla ścieżki nagiej", () => {
  it("idzie ZA wynikiem currentLang(), a nie za zaszytą stałą - oba wyniki atrapy", () => {
    state.lang = "pl";
    expect(activeLang("/analizy/wpis")).toBe("pl");
    state.lang = "en";
    expect(activeLang("/analizy/wpis")).toBe("en");
    expect(state.langCalls).toBe(2);
  });

  it("ścieżka nagła '/' też schodzi na currentLang()", () => {
    state.lang = "en";
    const lang: AppLang = activeLang("/");
    expect(lang).toBe("en");
  });
});

describe("activeLang - domyślne źródło adresu i fail-soft", () => {
  it("BEZ argumentu czyta getRequestUrl() dokładnie raz i rozstrzyga z tego adresu", () => {
    state.requestUrl = "https://neweuropeanstrategies.com/en/analizy/wpis?strona=2";
    expect(activeLang()).toBe("en");
    expect(state.requestUrlCalls).toBe(1);
    expect(state.langCalls).toBe(0);
  });

  it("BEZ argumentu i z nagim adresem żądania schodzi na currentLang()", () => {
    state.requestUrl = "https://neweuropeanstrategies.com/analizy/wpis";
    state.lang = "pl";
    expect(activeLang()).toBe("pl");
    expect(state.requestUrlCalls).toBe(1);
    expect(state.langCalls).toBe(1);
  });

  it("PUSTY adres (fail-closed getRequestUrl) schodzi na currentLang(), nie wybucha", () => {
    // Serwerowa gałąź `getRequestUrl` oddaje "" przy braku nagłówka `host`.
    // `new URL("", "http://x")` daje ścieżkę "/", więc to spadek zwykłą drogą,
    // nie przez `catch` - i tak ma być: <head> renderuje się dalej.
    state.requestUrl = "";
    state.lang = "en";
    expect(activeLang()).toBe("en");
    expect(state.langCalls).toBe(1);
  });

  it("NIEPOPRAWNY adres wpada w catch i schodzi na currentLang()", () => {
    // "http://" przechodzi walidację schematu, ale nie ma hosta - `new URL`
    // rzuca TypeError. Bez `catch` render <head> padłby na całej odpowiedzi SSR.
    state.lang = "pl";
    expect(activeLang("http://")).toBe("pl");
    expect(state.langCalls).toBe(1);
  });

  it("niepoprawny adres NIE gubi języka EN - catch oddaje aktualny język, nie domyślny", () => {
    state.lang = "en";
    expect(activeLang("http://")).toBe("en");
  });
});
