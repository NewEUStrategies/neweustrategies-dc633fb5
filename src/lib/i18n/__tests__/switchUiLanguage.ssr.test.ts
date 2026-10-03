// @vitest-environment node
//
// `switchUiLanguage` poza przeglądarką: przełącznik jest renderowany w SSR, a
// moduł bywa wołany z kodu bez `window`/`document`. Wywołanie nie może tam
// rzucić ReferenceErrorem - ustawia język klienta i i18next, a nawiguje tylko
// wtedy, gdy ma czym (routerem); bez routera i bez okna nie ma dokąd.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => "pl",
  setClientLang: (next: string) => {
    h.calls.push(`setClientLang:${next}`);
  },
}));

import { switchUiLanguage } from "../switchUiLanguage";

const i18n = {
  changeLanguage: (next: string) => {
    h.calls.push(`changeLanguage:${next}`);
    return Promise.resolve();
  },
};

beforeEach(() => {
  h.calls.length = 0;
});

describe("switchUiLanguage bez window/document", () => {
  it("środowisko naprawdę nie ma DOM-u", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("bez routera przestawia język i nie rzuca", () => {
    expect(() => switchUiLanguage("en", "pl", { i18n, router: null })).not.toThrow();
    expect(h.calls).toEqual(["setClientLang:en", "changeLanguage:en"]);
  });

  it("router bez lokalizacji nawiguje na stronę główną w nowym języku", () => {
    const navigate = vi.fn(() => Promise.resolve());

    switchUiLanguage("en", "pl", { i18n, router: { navigate } });

    expect(navigate).toHaveBeenCalledWith({
      href: "/en",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
  });

  it("odrzucona nawigacja bez okna nie zostawia nieobsłużonego odrzucenia", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      switchUiLanguage("en", "pl", {
        i18n,
        router: {
          state: { location: { pathname: "/blog" } },
          navigate: () => Promise.reject(new Error("boom")),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
