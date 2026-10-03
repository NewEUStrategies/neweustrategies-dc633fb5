// `localeRuntime` - JEDNA reguła „jaki język renderuje ten adres" po obu
// stronach: serwer (per żądanie, z adresu żądania i ciasteczka) i klient (żywy
// ref zasiany z adresu, przestawiany przez przełącznik i wyprowadzany ponownie
// z adresu przy każdej nawigacji).
//
// Bez kompilatora Startu stub `createIsomorphicFn` zawsze bierze gałąź
// SERWEROWĄ, a `getRequest()` poza runtime'em Startu rzuca - dlatego obie
// zależności są tu podmienione per scenariusz, a moduł ładowany od nowa
// (`clientLocale` zasiewa się przy imporcie).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLang } from "../localePath";

type Side = "server" | "client";

async function loadRuntime({
  side,
  path = "/",
  request,
}: {
  side: Side;
  path?: string;
  /** Żądanie widziane przez `getRequest()`; brak = poza kontekstem Startu (rzut). */
  request?: Request;
}) {
  vi.resetModules();
  window.history.replaceState(null, "", path);
  vi.doMock("@tanstack/react-start", () => ({
    createIsomorphicFn: () => ({
      server: <S>(serverImpl: S) => ({
        client: <C>(clientImpl: C) => (side === "server" ? serverImpl : clientImpl),
      }),
    }),
  }));
  vi.doMock("@tanstack/react-start/server", () => ({
    getRequest: () => {
      if (!request) throw new Error("No Start context found in AsyncLocalStorage");
      return request;
    },
  }));
  return import("../localeRuntime");
}

function setCookie(lang: AppLang | null) {
  document.cookie =
    lang === null ? "nes_lang=; path=/; max-age=0" : `nes_lang=${lang}; path=/; max-age=60`;
}

beforeEach(() => setCookie(null));
afterEach(() => {
  vi.doUnmock("@tanstack/react-start");
  vi.doUnmock("@tanstack/react-start/server");
  setCookie(null);
});

describe("langForPath - jedna reguła adres -> język", () => {
  it("prefiks wygrywa; preferencji nawet nie czyta", async () => {
    const { langForPath } = await loadRuntime({ side: "client" });
    const preferred = vi.fn(() => "pl" as const);
    expect(langForPath("/en/post/x", preferred)).toBe("en");
    expect(langForPath("/en", preferred)).toBe("en");
    expect(preferred).not.toHaveBeenCalled();
  });

  it("adres treści bez prefiksu to polski kanoniczny - preferencja NIE ma głosu", async () => {
    const { langForPath } = await loadRuntime({ side: "client" });
    const preferred = vi.fn(() => "en" as const);
    expect(langForPath("/post/x", preferred)).toBe("pl");
    expect(langForPath("/", preferred)).toBe("pl");
    expect(preferred).not.toHaveBeenCalled();
  });

  it("strona aplikacji/systemu idzie za preferencją, a bez niej - domyślny", async () => {
    const { langForPath } = await loadRuntime({ side: "client" });
    expect(langForPath("/admin/posts", () => "en")).toBe("en");
    expect(langForPath("/sitemap.xml", () => "en")).toBe("en");
    expect(langForPath("/login", () => null)).toBe("pl");
  });
});

// Gałąź serwerowa z nagłówkiem `Cookie` - w `localeRuntime.server.test.ts`
// (środowisko node): `Request` happy-dom wycina `cookie` jako nagłówek
// zakazany w przeglądarce.
describe("currentLang - SERWER (per żądanie)", () => {
  it("poza kontekstem żądania (getRequest rzuca) - język domyślny, bez rzutu", async () => {
    const { currentLang } = await loadRuntime({ side: "server" });
    expect(currentLang()).toBe("pl");
  });

  it("serwer NIE czyta żywego refu klienta - przełącznik nie przecieka między żądaniami", async () => {
    const rt = await loadRuntime({
      side: "server",
      request: new Request("https://x.test/post/a"),
    });
    rt.setClientLang("en");
    expect(rt.currentLang()).toBe("pl");
  });
});

describe("currentLang - KLIENT (żywy ref)", () => {
  it.each<[string, AppLang | null, AppLang]>([
    ["/en/post/a", "pl", "en"],
    ["/post/a", "en", "pl"],
    ["/admin/posts", "en", "en"],
    ["/admin/posts", null, "pl"],
  ])("zasiew z adresu %s (ciasteczko %s) -> %s", async (path, cookie, expected) => {
    setCookie(cookie);
    const { currentLang } = await loadRuntime({ side: "client", path });
    expect(currentLang()).toBe(expected);
  });

  it("setClientLang przestawia ref synchronicznie", async () => {
    const { currentLang, setClientLang } = await loadRuntime({ side: "client", path: "/a" });
    setClientLang("en");
    expect(currentLang()).toBe("en");
  });
});

describe("syncClientLangToUrl - ponowne wyprowadzenie z adresu przy nawigacji", () => {
  it("wstecz/dalej: nowy adres w pasku przestawia język w obie strony", async () => {
    const rt = await loadRuntime({ side: "client", path: "/en/b" });
    expect(rt.currentLang()).toBe("en");

    window.history.replaceState(null, "", "/a");
    rt.syncClientLangToUrl("/a");
    expect(rt.currentLang()).toBe("pl");

    window.history.replaceState(null, "", "/en/b");
    rt.syncClientLangToUrl("/en/b?q=1#sekcja");
    expect(rt.currentLang()).toBe("en");
  });

  it("przyjmuje też pełny adres (publicHref po rewrite zmieniającym origin)", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    window.history.replaceState(null, "", "/en/a");
    rt.syncClientLangToUrl(`${window.location.origin}/en/a`);
    expect(rt.currentLang()).toBe("en");
  });

  it("adres INNY niż w pasku (preload najechanego odnośnika) - bez zmian", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    rt.syncClientLangToUrl("/en/c");
    expect(rt.currentLang()).toBe("pl");
  });

  it("preload innego adresu nie przesuwa kotwicy jawnego wyboru (także mikrozadanie później)", async () => {
    const rt = await loadRuntime({ side: "client", path: "/en/a" });
    rt.setClientLang("pl"); // jawny wybór; adres zostaje /en/a
    // Najechanie na odnośnik /c - język celu ZGODNY z wybranym, ale adres w
    // pasku się nie zmienia, więc kotwica nie może przejść na /c.
    rt.syncClientLangToUrl("/c");
    await Promise.resolve();
    // Kotwica została na /en/a: kolejny load /en/a (`router.invalidate`) nie cofa wyboru.
    rt.syncClientLangToUrl("/en/a");
    expect(rt.currentLang()).toBe("pl");
  });

  it("setClientLang kotwiczy wybór na adresie z paska w chwili wywołania", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    // Adres zmienił się bez wyprowadzenia (np. push, którego kotwica jeszcze
    // nie dogoniła) - wybór złożony TERAZ dotyczy /en/b, nie zasiewu /a.
    window.history.replaceState(null, "", "/en/b");
    rt.setClientLang("pl");
    rt.syncClientLangToUrl("/en/b");
    expect(rt.currentLang()).toBe("pl");
  });

  // Historia TanStack zapisuje push do paska dopiero w mikrozadaniu PO
  // `beforeLoad` korzenia - w chwili wywołania pasek pokazuje jeszcze stary adres.
  it("push: kotwica przechodzi na nowy adres, gdy historia go zapisze - powrót znów wyprowadza", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    rt.setClientLang("en"); // np. baner zgody: język bez zmiany adresu
    rt.syncClientLangToUrl("/en/c"); // load nawigacji, pasek wciąż "/a"
    expect(rt.currentLang()).toBe("en");
    window.history.pushState(null, "", "/en/c"); // flush historii (wcześniejsze mikrozadanie)
    await Promise.resolve();

    window.history.replaceState(null, "", "/a"); // wstecz
    rt.syncClientLangToUrl("/a");
    expect(rt.currentLang()).toBe("pl");
  });

  it("push adresu w INNYM języku (surowy history.push) nie przesuwa kotwicy - kolejny load wyprowadza", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    rt.syncClientLangToUrl("/en/x");
    window.history.pushState(null, "", "/en/x");
    await Promise.resolve();
    expect(rt.currentLang()).toBe("pl");
    rt.syncClientLangToUrl("/en/x");
    expect(rt.currentLang()).toBe("en");
  });

  it("jawny wybór na BIEŻĄCYM adresie wygrywa, dopóki adres się nie zmieni", async () => {
    const rt = await loadRuntime({ side: "client", path: "/en/a" });
    rt.setClientLang("pl");
    // Ten sam adres (router nie zapisał przełączenia do historii albo
    // `router.invalidate()`) - ponowny odczyt "/en" NIE cofa wyboru.
    rt.syncClientLangToUrl("/en/a");
    expect(rt.currentLang()).toBe("pl");

    window.history.replaceState(null, "", "/en/b");
    rt.syncClientLangToUrl("/en/b");
    expect(rt.currentLang()).toBe("en");
  });

  it("strona aplikacji zachowuje żywą preferencję (nie ciasteczko, nie domyślny)", async () => {
    setCookie("pl");
    const rt = await loadRuntime({ side: "client", path: "/en/a" });
    window.history.replaceState(null, "", "/admin/posts");
    rt.syncClientLangToUrl("/admin/posts");
    expect(rt.currentLang()).toBe("en");
  });

  it("drugie wywołanie dla tego samego adresu jest no-opem (bez ponownego wyprowadzenia)", async () => {
    const rt = await loadRuntime({ side: "client", path: "/a" });
    window.history.replaceState(null, "", "/en/a");
    rt.syncClientLangToUrl("/en/a");
    expect(rt.currentLang()).toBe("en");
    // Coś innego przestawia ref bez zmiany adresu...
    rt.setClientLang("pl");
    // ...a kolejny load tego samego adresu tego nie cofa.
    rt.syncClientLangToUrl("/en/a");
    expect(rt.currentLang()).toBe("pl");
  });
});
