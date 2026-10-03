// `src/lib/i18n.ts` NA KLIENCIE - ścieżki, których dotąd nie dotykał żaden test
// (aplikacja importuje moduł raz, a testy dostawały już zainicjalizowany
// singleton):
//   * top-level await dociąga WYŁĄCZNIE słownik aktywnego języka,
//   * strony EN dociągają PL w tle po bezczynności (requestIdleCallback, bez
//     niego - setTimeout), strony PL nie pobierają EN wcale,
//   * wrapper `changeLanguage` ładuje słownik PRZED `languageChanged` i znosi
//     awarię importu chunku,
//   * handler `languageChanged` (ref klienta, lustro localStorage, ciasteczko,
//     <html lang> tylko przy realnej zmianie), dosiew ciasteczka preferencji,
//   * `syncI18nToRequest` z adresem nawigacji i `getRenderI18n` na kliencie.
//
// Każdy przypadek ładuje moduł od nowa (`vi.resetModules`) ze ŚWIEŻĄ instancją
// i18next - singleton z `node_modules` przeżywa resetModules, a zainicjalizowany
// pomija cały blok init.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLang } from "@/lib/i18n/localePath";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  setClientLang: [] as string[],
  syncedHrefs: [] as string[],
  cookie: null as "pl" | "en" | null,
  cookieThrows: false,
  cookieWrites: [] as string[],
  detected: null as "pl" | "en" | null,
  /** Skutek wyprowadzenia refu z adresu (atrapa `syncClientLangToUrl`). */
  onSync: undefined as ((href: string) => void) | undefined,
}));

async function loadI18n({
  lang,
  cookie = "pl",
  detected = null,
  failingCore,
  instance,
}: {
  lang: AppLang;
  cookie?: AppLang | null;
  detected?: AppLang | null;
  /** Słownik, którego chunk „nie dojedzie" (dynamiczny import odrzuca). */
  failingCore?: AppLang;
  /** Istniejąca instancja i18next (ponowna ewaluacja modułu, np. HMR). */
  instance?: unknown;
}) {
  vi.resetModules();
  h.lang = lang;
  h.cookie = cookie;
  h.detected = detected;
  vi.doMock("i18next", async () => {
    const actual = await vi.importActual<typeof import("i18next")>("i18next");
    return { ...actual, default: instance ?? actual.createInstance() };
  });
  vi.doMock("@/lib/i18n/localeRuntime", () => ({
    currentLang: () => h.lang,
    setClientLang: (next: AppLang) => {
      h.setClientLang.push(next);
      h.lang = next;
    },
    syncClientLangToUrl: (href: string) => {
      h.syncedHrefs.push(href);
      h.onSync?.(href);
    },
  }));
  vi.doMock("@/lib/i18n/langCookie", () => ({
    readLangCookieClient: () => {
      if (h.cookieThrows) throw new Error("document.cookie zablokowane");
      return h.cookie;
    },
    writeLangCookieClient: (next: string) => {
      h.cookieWrites.push(next);
    },
    detectBrowserLang: () => h.detected,
  }));
  if (failingCore) {
    vi.doMock(`@/lib/locale/${failingCore}`, () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
  }
  return import("@/lib/i18n");
}

const hasCore = (i18n: { hasResourceBundle: (l: string, ns: string) => boolean }, l: AppLang) =>
  i18n.hasResourceBundle(l, "translation");

beforeEach(() => {
  h.setClientLang = [];
  h.syncedHrefs = [];
  h.cookieWrites = [];
  h.cookieThrows = false;
  h.onSync = undefined;
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

afterEach(() => {
  vi.doUnmock("@/lib/locale/en");
  vi.doUnmock("@/lib/locale/pl");
  Reflect.deleteProperty(window, "requestIdleCallback");
  vi.restoreAllMocks();
});

describe("init na kliencie - tylko słownik aktywnego języka", () => {
  it("strona PL: rdzeń PL w store, EN nie pobrany i nie planowany", async () => {
    const ric = vi.fn();
    Object.assign(window, { requestIdleCallback: ric });
    const timeout = vi.spyOn(window, "setTimeout");
    const { default: i18n } = await loadI18n({ lang: "pl" });

    expect(i18n.language).toBe("pl");
    expect(hasCore(i18n, "pl")).toBe(true);
    expect(hasCore(i18n, "en")).toBe(false);
    expect(i18n.t("auth.signin")).toBe("Zaloguj się");
    expect(ric).not.toHaveBeenCalled();
    expect(timeout.mock.calls.some(([, ms]) => ms === 3000)).toBe(false);
    expect(document.documentElement.getAttribute("lang")).toBe("pl");
  });

  it("strona EN: tylko EN; PL dociąga requestIdleCallback (limit 5 s)", async () => {
    const ric = vi.fn();
    Object.assign(window, { requestIdleCallback: ric });
    const { default: i18n } = await loadI18n({ lang: "en" });

    expect(i18n.language).toBe("en");
    expect(hasCore(i18n, "en")).toBe(true);
    expect(hasCore(i18n, "pl")).toBe(false);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0]![1]).toEqual({ timeout: 5000 });

    (ric.mock.calls[0]![0] as () => void)();
    await vi.waitFor(() => expect(hasCore(i18n, "pl")).toBe(true));
    // Dociągnięty w tle - język strony się nie zmienia.
    expect(i18n.language).toBe("en");
  });

  it("strona EN bez requestIdleCallback: fallback setTimeout 3 s", async () => {
    const timeout = vi.spyOn(window, "setTimeout");
    const { default: i18n } = await loadI18n({ lang: "en" });

    const call = timeout.mock.calls.find(([, ms]) => ms === 3000);
    expect(call).toBeDefined();
    expect(hasCore(i18n, "pl")).toBe(false);
    (call![0] as () => void)();
    await vi.waitFor(() => expect(hasCore(i18n, "pl")).toBe(true));
  });
});

describe("ponowna ewaluacja modułu (HMR)", () => {
  it("zainicjalizowany i18next nie jest inicjalizowany drugi raz ani nie dostaje drugiego handlera", async () => {
    const { default: first } = await loadI18n({ lang: "pl" });
    const { default: second } = await loadI18n({ lang: "en", instance: first });
    expect(second).toBe(first);
    // Język z pierwszego startu - drugi init by go przestawił na "en".
    expect(second.language).toBe("pl");
    h.setClientLang = [];
    second.emit("languageChanged", "en");
    expect(h.setClientLang).toEqual(["en"]);
  });
});

describe("wrapper changeLanguage", () => {
  it("słownik nowego języka jest w store, ZANIM i18next wyemituje languageChanged", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl" });
    const seen: { lng: string; core: boolean; text: string }[] = [];
    i18n.on("languageChanged", (lng) =>
      seen.push({ lng, core: hasCore(i18n, "en"), text: i18n.t("auth.signin") }),
    );

    await i18n.changeLanguage("en");

    expect(seen).toEqual([{ lng: "en", core: true, text: "Sign in" }]);
  });

  it("awaria importu chunku NIE blokuje zmiany języka (overlaye + fallback działają dalej)", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl", failingCore: "en" });

    await expect(i18n.changeLanguage("en")).resolves.toBeTypeOf("function");
    expect(i18n.language).toBe("en");
    expect(hasCore(i18n, "en")).toBe(false);
    // Brak klucza EN -> fallback PL zamiast surowego klucza.
    expect(i18n.t("auth.signin")).toBe("Zaloguj się");
    expect(h.setClientLang).toContain("en");
  });

  it("wywołanie bez języka nie dociąga żadnego słownika", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl" });
    await i18n.changeLanguage();
    expect(hasCore(i18n, "en")).toBe(false);
  });

  it("ensureCoreLanguage jest idempotentne i nie nadpisuje kluczy overlayów", async () => {
    const { default: i18n, ensureCoreLanguage } = await loadI18n({ lang: "pl" });
    // Overlay zarejestrowany przed rdzeniem EN - z kluczem, który rdzeń też ma.
    i18n.addResourceBundle("en", "translation", { auth: { signin: "Overlay" } }, true, true);
    await ensureCoreLanguage("en");
    expect(i18n.getFixedT("en")("auth.signin")).toBe("Overlay");
    const add = vi.spyOn(i18n, "addResourceBundle");
    await ensureCoreLanguage("en");
    await ensureCoreLanguage("pl");
    expect(add).not.toHaveBeenCalled();
  });
});

describe("handler languageChanged", () => {
  it("synchronizuje ref klienta, lustro localStorage, ciasteczko i <html lang>", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl" });
    h.setClientLang = [];
    h.cookieWrites = [];

    await i18n.changeLanguage("en");
    expect(h.setClientLang).toEqual(["en"]);
    expect(window.localStorage.getItem("nes.lang")).toBe("en");
    expect(h.cookieWrites).toEqual(["en"]);
    expect(document.documentElement.getAttribute("lang")).toBe("en");

    await i18n.changeLanguage("pl");
    expect(h.setClientLang).toEqual(["en", "pl"]);
    expect(window.localStorage.getItem("nes.lang")).toBe("pl");
    expect(document.documentElement.getAttribute("lang")).toBe("pl");
  });

  it("<html lang> zapisywany TYLKO przy realnej zmianie (zapis unieważnia style dokumentu)", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl" });
    const setAttr = vi.spyOn(document.documentElement, "setAttribute");
    i18n.emit("languageChanged", "pl");
    expect(setAttr).not.toHaveBeenCalled();
    i18n.emit("languageChanged", "en");
    expect(setAttr).toHaveBeenCalledWith("lang", "en");
  });

  it("zablokowany localStorage nie wywraca zmiany języka", async () => {
    const { default: i18n } = await loadI18n({ lang: "pl" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    await expect(i18n.changeLanguage("en")).resolves.toBeTypeOf("function");
    expect(i18n.language).toBe("en");
    expect(h.setClientLang).toContain("en");
  });
});

describe("init: <html lang> i dosiew ciasteczka preferencji", () => {
  it("<html lang> z poprzedniego języka jest poprawiany przy starcie", async () => {
    document.documentElement.setAttribute("lang", "en");
    await loadI18n({ lang: "pl" });
    expect(document.documentElement.getAttribute("lang")).toBe("pl");
  });

  it("zgodny <html lang> nie jest zapisywany ponownie", async () => {
    document.documentElement.setAttribute("lang", "pl");
    const setAttr = vi.spyOn(document.documentElement, "setAttribute");
    await loadI18n({ lang: "pl" });
    expect(setAttr).not.toHaveBeenCalled();
  });

  it.each<[AppLang, AppLang | null, AppLang]>([
    ["pl", "en", "en"],
    ["en", "pl", "pl"],
    ["pl", null, "pl"],
    ["en", null, "en"],
  ])(
    "brak ciasteczka na stronie %s, przeglądarka %s -> dosiew %s",
    async (lang, detected, expected) => {
      await loadI18n({ lang, cookie: null, detected });
      // Pierwszy zapis to dosiew przy starcie (przed przekierowaniem strony głównej).
      expect(h.cookieWrites[0]).toBe(expected);
    },
  );

  it("istniejące ciasteczko NIE jest nadpisywane wykrytym językiem przeglądarki", async () => {
    await loadI18n({ lang: "pl", cookie: "pl", detected: "en" });
    expect(h.cookieWrites).not.toContain("en");
  });

  it("zablokowane ciasteczka nie wywracają startu modułu", async () => {
    h.cookieThrows = true;
    const { default: i18n } = await loadI18n({ lang: "pl" });
    expect(i18n.isInitialized).toBe(true);
    expect(h.cookieWrites).toEqual([]);
  });
});

describe("syncI18nToRequest / getRenderI18n na kliencie", () => {
  it("z adresem nawigacji: najpierw wyprowadza ref z URL-a, potem dociąga i18next", async () => {
    const { default: i18n, syncI18nToRequest } = await loadI18n({ lang: "pl" });
    // Atrapa `syncClientLangToUrl` przestawia ref tak, jak prawdziwy dla "/en/x"
    // - język odczytany PRZED wyprowadzeniem zostawiłby i18next po polsku.
    h.onSync = (href) => {
      h.lang = href.startsWith("/en") ? "en" : "pl";
    };
    await expect(syncI18nToRequest("/en/x")).resolves.toBe("en");
    expect(h.syncedHrefs).toEqual(["/en/x"]);
    expect(i18n.language).toBe("en");
    expect(hasCore(i18n, "en")).toBe(true);
  });

  it("bez adresu (dotychczasowe wywołanie) nie wyprowadza refu ponownie", async () => {
    const { syncI18nToRequest } = await loadI18n({ lang: "pl" });
    await expect(syncI18nToRequest()).resolves.toBe("pl");
    expect(h.syncedHrefs).toEqual([]);
  });

  it("język już zgodny - bez changeLanguage", async () => {
    const { default: i18n, syncI18nToRequest } = await loadI18n({ lang: "pl" });
    const change = vi.spyOn(i18n, "changeLanguage");
    await syncI18nToRequest("/x");
    expect(change).not.toHaveBeenCalled();
  });

  it("getRenderI18n na kliencie to wspólny singleton (przełącznik i handler działają)", async () => {
    const { default: i18n, getRenderI18n } = await loadI18n({ lang: "pl" });
    expect(getRenderI18n()).toBe(i18n);
  });
});
