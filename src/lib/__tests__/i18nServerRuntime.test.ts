// @vitest-environment node
//
// `src/lib/i18n.ts` NA SERWERZE. Jeden izolat obsługuje współbieżne żądania
// w RÓŻNYCH językach, więc:
//   * init ładuje OBA rdzenie (żaden render nie czeka na chunk),
//   * współdzielony singleton NIGDY nie zmienia języka z powodu żądania
//     (`syncI18nToRequest` to na serwerze czysty odczyt),
//   * render dostaje KLON per żądanie (`getRenderI18n`) z własnym językiem i
//     wspólnym store zasobów,
//   * handler `languageChanged` i wrapper `changeLanguage` są wyłącznie
//     klienckie (ciasteczko, localStorage, <html lang> nie istnieją).
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  setClientLang: [] as string[],
  syncedHrefs: [] as string[],
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => h.lang,
  setClientLang: (next: string) => void h.setClientLang.push(next),
  syncClientLangToUrl: (href: string) => void h.syncedHrefs.push(href),
}));

const {
  default: i18n,
  getRenderI18n,
  syncI18nToRequest,
  ensureCoreLanguage,
} = await import("@/lib/i18n");

describe("i18n na serwerze", () => {
  it("init ładuje OBA rdzenie, singleton startuje w języku domyślnym żądania", () => {
    expect(i18n.hasResourceBundle("pl", "translation")).toBe(true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18n.language).toBe("pl");
  });

  it("ensureCoreLanguage po init to no-op (rdzenie już w store)", async () => {
    const add = vi.spyOn(i18n, "addResourceBundle");
    await ensureCoreLanguage("en");
    await ensureCoreLanguage("pl");
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it("getRenderI18n: klon per żądanie z językiem żądania, singleton nietknięty", () => {
    h.lang = "en";
    const en = getRenderI18n();
    h.lang = "pl";
    const pl = getRenderI18n();

    expect(en).not.toBe(i18n);
    expect(en.language).toBe("en");
    expect(pl.language).toBe("pl");
    expect(i18n.language).toBe("pl");
    // Wspólny store: klon nie jest pustą instancją.
    expect(en.t("auth.signin")).toBe("Sign in");
    expect(pl.t("auth.signin")).toBe("Zaloguj się");
  });

  it("syncI18nToRequest to czysty odczyt - singleton nie zmienia języka", async () => {
    h.lang = "en";
    await expect(syncI18nToRequest("/en/o-nas")).resolves.toBe("en");
    expect(i18n.language).toBe("pl");
    // Wyprowadzenie refu klienta jest no-opem na serwerze (samo
    // `localeRuntime` to pilnuje) - tu tylko przekazanie adresu.
    expect(h.syncedHrefs).toEqual(["/en/o-nas"]);
    h.lang = "pl";
  });

  it("bez handlera languageChanged: zmiana singletona nie dotyka refu klienta", async () => {
    await i18n.changeLanguage("en");
    expect(h.setClientLang).toEqual([]);
    await i18n.changeLanguage("pl");
  });
});
