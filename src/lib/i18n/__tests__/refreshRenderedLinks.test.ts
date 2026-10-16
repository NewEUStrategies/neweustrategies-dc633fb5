// Odświeżenie wyrenderowanych `<Link>`-ów po zmianie języka renderu.
//
// Wyrenderowane odnośniki TanStack trzymają zbudowaną lokalizację: router pamięta ją pod
// opcjami odnośnika (czyści to tylko `update()`), a przeliczenie rusza dopiero, gdy magazyn
// lokalizacji poda INNY obiekt. Zmiana języka zmienia tylko prefiks, którego router nie
// widzi. Dowód na prawdziwym routerze (przełącznik i „wstecz" przez granicę języka):
// `urlLanguageNavigation.test.tsx`; tu kontrakt wywołań `update`, zapisów do magazynu
// i chwili, w której hak `onResolved` odświeża odnośniki.
import { describe, expect, it, vi } from "vitest";

import {
  installLanguageLinkRefresh,
  refreshRenderedLinks,
  type LanguageAwareRouter,
  type RenderedLinksRouter,
} from "../refreshRenderedLinks";

type Loc = { href: string; pathname: string; publicHref: string };

/** Magazyn lokalizacji jak w routerze: `get` zwraca ostatni zapis. */
function locationStore(initial: Loc, log: string[], fail?: (next: Loc) => boolean) {
  let current = initial;
  const writes: Loc[] = [];
  const store = {
    get: () => current,
    set: (next: Loc) => {
      log.push("set");
      writes.push(next);
      current = next;
      if (fail?.(next)) throw new Error("subskrybent kopii rzucił");
    },
  };
  return { store, writes, current: () => current };
}

const blog: Loc = { href: "/blog?x=1", pathname: "/blog", publicHref: "/en/blog?x=1" };
const options = { defaultPreload: "intent" };

describe("refreshRenderedLinks", () => {
  it("`update` z tymi samymi opcjami, kopia, potem ta sama lokalizacja", () => {
    const log: string[] = [];
    const { store, writes, current } = locationStore(blog, log);
    const update = vi.fn((_next: object) => {
      log.push("update");
    });
    const router: RenderedLinksRouter = { stores: { location: store }, options, update };

    refreshRenderedLinks(router);

    // Pamięć lokalizacji czyszczona PRZED zapisem, który każe odnośnikom
    // przeliczyć href - inaczej dostałyby z niej stary język.
    expect(log).toEqual(["update", "set", "set"]);
    // `update` dostaje bieżące opcje bez zmian (jak od `RouterProvider`).
    expect(update).toHaveBeenCalledWith(options);
    // Kopia to INNY obiekt o tych samych polach (odnośniki porównują
    // tożsamość, a subskrybenci czytający pola nie widzą zmiany)...
    expect(writes[0]).not.toBe(blog);
    expect(writes[0]).toEqual(blog);
    // ...a router kończy z tym samym obiektem lokalizacji co przed odświeżeniem.
    expect(writes[1]).toBe(blog);
    expect(current()).toBe(blog);
  });

  it("router bez `update` (atrapa, inny router): samo odświeżenie magazynu", () => {
    const { store, writes, current } = locationStore(blog, []);

    refreshRenderedLinks({ stores: { location: store } });

    expect(writes).toHaveLength(2);
    expect(current()).toBe(blog);
  });

  it("wyjątek subskrybenta przy zapisie kopii nie wylatuje i nie zostawia kopii w routerze", () => {
    const { store, writes, current } = locationStore(blog, [], (next) => next !== blog);

    expect(() => refreshRenderedLinks({ stores: { location: store } })).not.toThrow();

    expect(writes).toHaveLength(2);
    expect(current()).toBe(blog);
  });

  it("wyjątek `update` nie wylatuje; magazyn zostaje z tą samą lokalizacją", () => {
    const { store, current } = locationStore(blog, []);
    const router: RenderedLinksRouter = {
      stores: { location: store },
      update: () => {
        throw new Error("update padł");
      },
    };

    expect(() => refreshRenderedLinks(router)).not.toThrow();

    expect(current()).toBe(blog);
  });

  it("router bez magazynu lokalizacji - nic nie robi (także nie czyści pamięci)", () => {
    const update = vi.fn();

    refreshRenderedLinks({ stores: {}, update });

    // Bez magazynu nie ma powiadomienia, którym odnośniki przeliczyłyby href -
    // samo wyczyszczenie pamięci routera niczego by nie odświeżyło.
    expect(update).not.toHaveBeenCalled();
  });
});

describe("installLanguageLinkRefresh - hak `onResolved`", () => {
  /** Router-atrapa: zapamiętuje słuchacza `onResolved`, `resolve()` go woła. */
  function fakeRouter() {
    const log: string[] = [];
    const { store, writes } = locationStore(blog, log);
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const update = vi.fn(() => {
      log.push("update");
    });
    const router: LanguageAwareRouter = {
      stores: { location: store },
      options,
      update,
      subscribe: (eventType, fn) => {
        expect(eventType).toBe("onResolved");
        listener = fn;
        return unsubscribe;
      },
    };
    return {
      router,
      writes,
      update,
      unsubscribe,
      resolve: () => listener?.(),
    };
  }

  it("bez zmiany języka zwykła nawigacja nie płaci za `update` ani zapisy magazynu", async () => {
    const { router, writes, update, resolve } = fakeRouter();
    installLanguageLinkRefresh(router, () => "pl");

    resolve();
    resolve();
    await Promise.resolve();

    expect(update).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("po zmianie języka odświeża o mikrozadanie później, nie wewnątrz `onResolved`", async () => {
    let lang = "pl";
    const { router, writes, update, resolve } = fakeRouter();
    installLanguageLinkRefresh(router, () => lang);

    lang = "en";
    resolve();
    // `onResolved` biegnie w `router.batch` - odświeżenie wprost w słuchaczu
    // scaliłoby zapis kopii z przywróceniem w jedno powiadomienie bez skutku.
    expect(update).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(2);
  });

  it("odświeża raz na zmianę: kolejne ładowania w tym samym języku już nie", async () => {
    let lang = "pl";
    const { router, update, resolve } = fakeRouter();
    installLanguageLinkRefresh(router, () => lang);

    lang = "en";
    resolve();
    await Promise.resolve();
    resolve();
    resolve();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);

    // Powrót do polskiego to znów zmiana.
    lang = "pl";
    resolve();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("język startowy czytany przy instalacji: pierwsze ładowanie w nim nie odświeża", async () => {
    const { router, update, resolve } = fakeRouter();
    installLanguageLinkRefresh(router, () => "en");

    resolve();
    await Promise.resolve();

    expect(update).not.toHaveBeenCalled();
  });

  it("zwraca wypięcie słuchacza z `subscribe`", () => {
    const { router, unsubscribe } = fakeRouter();
    const off = installLanguageLinkRefresh(router, () => "pl");

    off();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
