// @vitest-environment node
//
// `localeRuntime` w procesie SERWERA (bez `window`): język renderu pochodzi
// wyłącznie z adresu żądania (a dla stron aplikacji - z ciasteczka
// preferencji), a żywy ref klienta jest tu stanem modułu współdzielonym przez
// WSZYSTKIE współbieżne żądania, więc nic, co przychodzi z nawigacji, nie może
// go mutować ani na niego wpływać.
import { describe, expect, it, vi } from "vitest";
import type { AppLang } from "../localePath";

const h = vi.hoisted(() => ({
  url: "https://x.test/post/a",
  cookie: undefined as string | undefined,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request(h.url, { headers: h.cookie ? { cookie: h.cookie } : {} }),
}));

const rt = await import("../localeRuntime");

describe("currentLang na serwerze - per żądanie", () => {
  it.each<[string, string | undefined, AppLang, string]>([
    ["https://x.test/en/post/a", "nes_lang=pl", "en", "prefiks wygrywa z ciasteczkiem"],
    ["https://x.test/en", undefined, "en", "goły prefiks strony głównej"],
    ["https://x.test/post/a", "nes_lang=en", "pl", "treść bez prefiksu = polski kanoniczny"],
    ["https://x.test/admin/posts", "nes_lang=en", "en", "strona aplikacji idzie za ciasteczkiem"],
    ["https://x.test/admin/posts", "lovable_lang=en", "en", "dawna nazwa ciasteczka też"],
    ["https://x.test/admin/posts", "inne=1", "pl", "strona aplikacji bez preferencji"],
    ["https://x.test/sitemap.xml", undefined, "pl", "zasób systemowy bez ciasteczka"],
  ])("%s (Cookie: %s) -> %s (%s)", (url, cookie, expected) => {
    h.url = url;
    h.cookie = cookie;
    expect(rt.currentLang()).toBe(expected);
  });

  it("syncClientLangToUrl i setClientLang nie zmieniają języka żądania", () => {
    h.url = "https://x.test/post/a";
    h.cookie = undefined;
    rt.syncClientLangToUrl("/en/post/a");
    rt.setClientLang("en");
    expect(rt.currentLang()).toBe("pl");
  });
});
