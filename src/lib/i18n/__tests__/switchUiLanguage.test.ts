// Wspólna ścieżka przełączenia języka interfejsu (`switchUiLanguage`) -
// kontrakt, na którym stoją trzy przełączniki (header, mobilna szuflada,
// widget buildera). Każdy przypadek opisuje zachowanie widoczne dla
// czytelnika albo dla routera:
//   * który język jest aktywny (prefiks ścieżki > kod i18next po prefiksie),
//   * no-op na aktywnym języku,
//   * `setClientLang` PRZED nawigacją (rewrite `output` routera czyta go przy
//     budowaniu adresu), `replace`, bez resetu scrolla,
//   * ten sam adres w drugim języku - z query i hashem,
//   * twardy fallback na `window.location`: brak routera, synchroniczny wyjątek
//     i ODRZUCONA obietnica `navigate` (router TanStack nawiguje async),
//   * żadnych zapisów localStorage (martwy "i18nextLng" zniknął).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { AppLang } from "../localePath";

const h = vi.hoisted(() => ({
  clientLang: "pl" as string,
  calls: [] as string[],
  language: "pl" as string | undefined,
  router: null as null | {
    state?: { location?: { pathname?: string; searchStr?: string; hash?: string } };
    navigate: (opts: { href: string; replace: boolean; resetScroll: boolean }) => unknown;
  },
}));

// W vitest `createIsomorphicFn` wybiera gałąź serwerową, więc prawdziwe
// `currentLang()` nie widzi `setClientLang` - atrapa trzyma żywy język klienta.
vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => h.clientLang,
  setClientLang: (next: string) => {
    h.calls.push(`setClientLang:${next}`);
    h.clientLang = next;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      language: h.language,
      changeLanguage: (next: string) => {
        h.calls.push(`changeLanguage:${next}`);
        return Promise.resolve();
      },
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => h.router,
}));

import {
  resolveUiLang,
  switchUiLanguage,
  useUiLangSwitch,
  type UiLangRouter,
} from "../switchUiLanguage";

const i18n = {
  changeLanguage: (next: string) => {
    h.calls.push(`changeLanguage:${next}`);
    return Promise.resolve();
  },
};

/** Router-atrapa: zapisuje adres i język klienta widziany w chwili nawigacji. */
function fakeRouter(
  location: { pathname?: string; searchStr?: string; hash?: string } | undefined,
  result: () => unknown = () => Promise.resolve(),
) {
  const navigate = vi.fn((opts: Parameters<UiLangRouter["navigate"]>[0]) => {
    h.calls.push(`navigate:${opts.href}@${h.clientLang}`);
    return result();
  });
  const router: UiLangRouter = { state: location ? { location } : undefined, navigate };
  return { router, navigate };
}

/** Dwa takty mikrozadań - tyle trwa dojście `.catch` po odrzuconej obietnicy. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  h.clientLang = "pl";
  h.calls.length = 0;
  h.language = "pl";
  h.router = null;
  window.history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("lang");
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveUiLang - aktywny język przełącznika", () => {
  it.each<[string | undefined, string | undefined, AppLang, string]>([
    ["/en/post/raport", "pl", "en", "prefiks ścieżki wygrywa z i18n"],
    ["/en", "pl", "en", "goły prefiks strony głównej"],
    ["/EN/blog", "pl", "en", "prefiks bez względu na wielkość liter"],
    ["/post/raport", "en-GB", "en", "regionalny kod angielskiego"],
    ["/post/raport", "pl-PL", "pl", "regionalny kod polskiego"],
    ["/english-summary", "pl", "pl", "segment zaczynający się od 'en' to nie prefiks"],
    ["/admin/posts", "en", "en", "strona bez prefiksów idzie za i18n"],
    [undefined, undefined, "pl", "bez routera i bez języka - domyślny polski"],
  ])("%s + i18n=%s -> %s (%s)", (pathname, language, expected) => {
    expect(resolveUiLang(pathname, language)).toBe(expected);
  });
});

describe("switchUiLanguage - sekwencja przełączenia", () => {
  it("na aktywnym języku nie robi nic", () => {
    const { router, navigate } = fakeRouter({ pathname: "/o-nas" });

    switchUiLanguage("pl", "pl", { i18n, router });

    expect(h.calls).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
  });

  it("język klienta PRZED changeLanguage i nawigacją; replace bez resetu scrolla", () => {
    const { router, navigate } = fakeRouter({ pathname: "/post/raport" });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(h.calls).toEqual([
      "setClientLang:en",
      "changeLanguage:en",
      "navigate:/en/post/raport@en",
    ]);
    expect(navigate).toHaveBeenCalledWith({
      href: "/en/post/raport",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("z EN zdejmuje prefiks i ustawia <html lang> na polski", () => {
    h.clientLang = "en";
    document.documentElement.lang = "en";
    const { router } = fakeRouter({ pathname: "/en/blog" });

    switchUiLanguage("pl", "en", { i18n, router });

    expect(h.calls).toEqual(["setClientLang:pl", "changeLanguage:pl", "navigate:/blog@pl"]);
    expect(document.documentElement.lang).toBe("pl");
  });

  it("oznacza wpis historii nowym językiem i zachowuje resztę stanu", () => {
    // Router porównuje adresy bez prefiksu ("/en/blog" i "/blog" to dla niego
    // "/blog") - bez innego stanu nie zapisałby przełączenia EN -> PL w pasku.
    h.clientLang = "en";
    const { router, navigate } = fakeRouter({ pathname: "/en/blog" });

    switchUiLanguage("pl", "en", { i18n, router });

    const { state } = navigate.mock.calls[0][0];
    // Stan wpisu z routera (klucze TanStack) i dowolny stan aplikacji.
    const previous = {
      key: "k1",
      __TSR_index: 3,
      __hashScrollIntoViewOptions: false,
      __uiLang: "en",
      formDraft: "x",
    };
    expect(state(previous)).toEqual({
      key: "k1",
      __TSR_index: 3,
      __hashScrollIntoViewOptions: false,
      __uiLang: "pl",
      formDraft: "x",
    });
  });

  it("nie przepisuje <html lang>, gdy dokument ma już docelowy język", () => {
    document.documentElement.lang = "en";
    const setLang = vi.spyOn(document.documentElement, "lang", "set");
    const { router } = fakeRouter({ pathname: "/" });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(h.calls).toContain("navigate:/en@en");
    expect(setLang).not.toHaveBeenCalled();
  });

  it("nie zapisuje niczego do localStorage (martwy klucz i18nextLng zniknął)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { router } = fakeRouter({ pathname: "/" });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("i18nextLng")).toBeNull();
  });
});

describe("switchUiLanguage - adres docelowy", () => {
  it("zachowuje query i hash z lokalizacji routera", () => {
    const { router, navigate } = fakeRouter({
      pathname: "/search",
      searchStr: "?q=nato&page=2",
      hash: "wyniki",
    });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/en/search?q=nato&page=2#wyniki" }),
    );
  });

  it("pusty query i hash (kształt lokalizacji TanStack) nie doklejają '?' ani '#'", () => {
    // Prawdziwy router trzyma `searchStr: ""` i `hash: ""`, nie `undefined` -
    // adres bez query/hasha musi zostać czystą ścieżką, bez wiszącego "#".
    const { router, navigate } = fakeRouter({ pathname: "/o-nas", searchStr: "", hash: "" });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(navigate).toHaveBeenCalledWith({
      href: "/en/o-nas",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
  });

  it("na stronie bez prefiksów zostawia ścieżkę i nie gubi ?redirect=", () => {
    const { router, navigate } = fakeRouter({
      pathname: "/login",
      searchStr: "?redirect=%2Fprofile",
    });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(h.calls[0]).toBe("setClientLang:en");
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/login?redirect=%2Fprofile" }),
    );
  });

  it("router bez stanu lokalizacji bierze adres z okna, ale nawiguje routerem", () => {
    window.history.replaceState(null, "", "/en/wydarzenia?miasto=krakow#mapa");
    const { router, navigate } = fakeRouter(undefined);

    switchUiLanguage("pl", "en", { i18n, router });

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/wydarzenia?miasto=krakow#mapa" }),
    );
    // Udana nawigacja routerem - okno nie dostaje twardego przeładowania.
    expect(window.location.pathname).toBe("/en/wydarzenia");
  });
});

describe("switchUiLanguage - twardy fallback na window.location", () => {
  it("bez routera nawiguje twardo z bieżącego adresu okna", () => {
    window.history.replaceState(null, "", "/o-nas?tab=zespol#historia");

    switchUiLanguage("en", "pl", { i18n, router: null });

    expect(h.calls).toEqual(["setClientLang:en", "changeLanguage:en"]);
    expect(window.location.pathname).toBe("/en/o-nas");
    expect(window.location.search).toBe("?tab=zespol");
    expect(window.location.hash).toBe("#historia");
  });

  it("synchroniczny wyjątek navigate kończy się twardą nawigacją", () => {
    const { router } = fakeRouter({ pathname: "/o-nas" }, () => {
      throw new Error("router w budowie");
    });

    switchUiLanguage("en", "pl", { i18n, router });

    expect(window.location.pathname).toBe("/en/o-nas");
  });

  it("odrzucona obietnica navigate (navigate jest async) też kończy się twardą nawigacją", async () => {
    const { router } = fakeRouter({ pathname: "/o-nas", searchStr: "?x=1" }, () =>
      Promise.reject(new Error("SecurityError: replaceState throttled")),
    );

    switchUiLanguage("en", "pl", { i18n, router });
    // Przed rozstrzygnięciem obietnicy okno stoi w miejscu.
    expect(window.location.pathname).toBe("/");
    await flushMicrotasks();

    expect(window.location.pathname).toBe("/en/o-nas");
    expect(window.location.search).toBe("?x=1");
  });

  it("udana nawigacja routerem nie dotyka window.location", async () => {
    window.history.replaceState(null, "", "/o-nas");
    const { router } = fakeRouter({ pathname: "/o-nas" });

    switchUiLanguage("en", "pl", { i18n, router });
    await flushMicrotasks();

    expect(window.location.pathname).toBe("/o-nas");
  });
});

// Wyrenderowane `<Link>`-i TanStack przeliczają href dopiero, gdy magazyn
// lokalizacji poda INNY wewnętrzny `href` - a przełączenie zmienia tylko
// prefiks, którego router nie widzi. Dowód na prawdziwym routerze:
// `urlLanguageNavigation.test.tsx`; tu kontrakt zapisów do magazynu.
describe("switchUiLanguage - odświeżenie wyrenderowanych odnośników", () => {
  type Loc = { href: string; pathname: string; publicHref: string };

  /** Magazyn lokalizacji jak w routerze: `get` zwraca ostatni zapis. */
  function locationStore(initial: Loc, fail?: (next: Loc) => boolean) {
    let current = initial;
    const writes: Loc[] = [];
    const store = {
      get: () => current,
      set: (next: Loc) => {
        writes.push(next);
        current = next;
        if (fail?.(next)) throw new Error("render kopii rzucił");
      },
    };
    return { store, writes, current: () => current };
  }

  const blog: Loc = { href: "/blog?x=1", pathname: "/blog", publicHref: "/en/blog?x=1" };

  it("po udanej nawigacji: kopia z INNYM href, potem ta sama lokalizacja", async () => {
    const { store, writes, current } = locationStore(blog);
    let finish!: () => void;
    const { router } = fakeRouter(
      { pathname: "/blog", searchStr: "?x=1" },
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    router.stores = { location: store };

    switchUiLanguage("en", "pl", { i18n, router });
    await flushMicrotasks();
    // Przed rozstrzygnięciem nawigacji magazyn zostaje nietknięty.
    expect(writes).toEqual([]);

    finish();
    await flushMicrotasks();
    expect(writes).toHaveLength(2);
    // Kopia różni się WYŁĄCZNIE wewnętrznym href.
    const { href, ...rest } = writes[0]!;
    expect(href).not.toBe(blog.href);
    expect(rest).toEqual({ pathname: "/blog", publicHref: "/en/blog?x=1" });
    // ...a router kończy z tym samym obiektem lokalizacji co przed odświeżeniem.
    expect(writes[1]).toBe(blog);
    expect(current()).toBe(blog);
  });

  it("odrzucona nawigacja: twardy fallback, magazyn nietknięty", async () => {
    const { store, writes } = locationStore(blog);
    const { router } = fakeRouter({ pathname: "/blog" }, () => Promise.reject(new Error("x")));
    router.stores = { location: store };

    switchUiLanguage("en", "pl", { i18n, router });
    await flushMicrotasks();

    expect(writes).toEqual([]);
    expect(window.location.pathname).toBe("/en/blog");
  });

  it("błąd renderu kopii nie wywraca przełączenia i nie zostawia kopii w routerze", async () => {
    const { store, writes, current } = locationStore(blog, (next) => next !== blog);
    const { router } = fakeRouter({ pathname: "/blog" });
    router.stores = { location: store };

    switchUiLanguage("en", "pl", { i18n, router });
    await flushMicrotasks();

    expect(writes).toHaveLength(2);
    expect(current()).toBe(blog);
    // Udana nawigacja routerem - bez twardego przeładowania.
    expect(window.location.pathname).toBe("/");
  });

  it("router bez magazynu lokalizacji (np. bez `location`) - nawigacja bez odświeżenia", async () => {
    const { router, navigate } = fakeRouter({ pathname: "/blog" });
    router.stores = {};

    switchUiLanguage("en", "pl", { i18n, router });
    await flushMicrotasks();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/");
  });
});

describe("useUiLangSwitch - hak dla przełączników", () => {
  it("aktywny język z prefiksu ścieżki routera, a switchTo przełącza na ten sam adres", () => {
    const { router, navigate } = fakeRouter({ pathname: "/en/blog", searchStr: "?page=2" });
    h.router = router as typeof h.router;

    const { result } = renderHook(() => useUiLangSwitch());
    expect(result.current.current).toBe("en");

    result.current.switchTo("pl");
    expect(navigate).toHaveBeenCalledWith({
      href: "/blog?page=2",
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
      state: expect.any(Function),
    });
  });

  it("switchTo na aktywny język jest no-opem", () => {
    const { router, navigate } = fakeRouter({ pathname: "/blog" });
    h.router = router as typeof h.router;

    const { result } = renderHook(() => useUiLangSwitch());
    result.current.switchTo(result.current.current);

    expect(h.calls).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("poza RouterProvider (router null) język idzie za i18n", () => {
    h.language = "en-GB";

    const { result } = renderHook(() => useUiLangSwitch());

    expect(result.current.current).toBe("en");
  });
});
