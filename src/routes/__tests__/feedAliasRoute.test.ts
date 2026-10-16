// ALIAS WORDPRESSA `/feed` -> `/rss.xml`.
//
// PO CO TEN PLIK ISTNIEJE. WordPress podawał kanał pod `/feed` (i `/feed/`),
// a czytniki subskrybentów odpytują ten adres latami po migracji. Trasa jest
// pięciolinijkowym przekierowaniem i stała na 0% pokrycia, choć każda jej
// pomyłka jest cicha: czytnik dostaje 404 albo kanał w złym języku i po prostu
// przestaje pokazywać nowe wpisy - nikt tego nie zgłasza.
//
// CO DOWODZIMY:
//   1. 301 (nie 302) - czytniki aktualizują zapisany adres tylko po trwałym
//      przekierowaniu, więc ruch na alias z czasem wygasa,
//   2. prefiks języka z adresu żądania przechodzi na kanał: `/en/feed` ->
//      `/en/rss.xml`, także ze slashem na końcu i wielkimi literami (WordPress
//      i ręcznie wpisane adresy dają oba warianty; rewrite routera zdejmuje
//      prefiks bez względu na wielkość liter, więc oba trafiają tutaj),
//   3. adres docelowy jest kanoniczny - zapytanie z aliasu nie przecieka do
//      `Location`, które edge trzyma dobę,
//   4. `Cache-Control` na dobę - alias nie kosztuje workera przy każdym odpytaniu,
//   5. brak kontekstu żądania albo nieczytelny adres kończy się kanałem
//      w języku domyślnym, a nie 500 dla czytnika.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: `getRequest` z `@tanstack/react-start/server` -
// poza runtime'em Start nie ma kontekstu żądania. Mapowanie języka
// (`@/lib/i18n/localePath`) zostaje PRAWDZIWE, bo to jego wynik jest kontraktem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  /**
   * Kontekst żądania widziany przez trasę; funkcja może rzucić jak runtime Start.
   * Kształt zawężony do `url` - tylko to pole trasa czyta.
   */
  getRequest: (): { url: string } => {
    throw new Error("test: kontekst żądania nie został ustawiony");
  },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => h.getRequest(),
}));

import { routeServerHandlers, type RouteServerHandler } from "@/test/routeHarness";
import { Route } from "@/routes/feed";

function get(): RouteServerHandler {
  const handler = routeServerHandlers(Route as AnyRoute).GET;
  if (!handler) throw new Error("test: alias /feed nie ma handlera GET");
  return handler;
}

/** Odpowiedź aliasu na żądanie pod podaną ścieżką. */
async function hit(path: string): Promise<Response> {
  const request = new Request(`https://neweuropeanstrategies.com${path}`);
  h.getRequest = () => request;
  return get()({ request });
}

beforeEach(() => {
  h.getRequest = () => {
    throw new Error("test: kontekst żądania nie został ustawiony");
  };
});

describe("/feed - trwałe przekierowanie na kanoniczny kanał", () => {
  it("wystawia wyłącznie GET", () => {
    expect(Object.keys(routeServerHandlers(Route as AnyRoute))).toEqual(["GET"]);
  });

  it("odpowiada 301 na /rss.xml bez treści", async () => {
    const response = await hit("/feed");

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/rss.xml");
    expect(await response.text()).toBe("");
  });

  it("przekierowanie jest cache'owalne przez dobę", async () => {
    const response = await hit("/feed");

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });
});

describe("/feed - język kanału z prefiksu adresu", () => {
  it.each([
    ["/feed", "/rss.xml"],
    ["/feed/", "/rss.xml"],
    ["/en/feed", "/en/rss.xml"],
    ["/en/feed/", "/en/rss.xml"],
    ["/EN/feed", "/en/rss.xml"],
    ["/En/Feed/", "/en/rss.xml"],
  ])("%s -> %s", async (path, location) => {
    expect((await hit(path)).headers.get("Location")).toBe(location);
  });

  it("zapytanie z aliasu nie przecieka do adresu docelowego", async () => {
    // WordPressowe `?paged=2` nie ma odpowiednika w `/rss.xml`, a doba cache
    // na edge'u zamroziłaby każdy wariant zapytania osobno.
    expect((await hit("/en/feed/?paged=2")).headers.get("Location")).toBe("/en/rss.xml");
  });
});

describe("/feed - awaria odczytu żądania kończy się kanałem domyślnym, nie 500", () => {
  it("brak kontekstu żądania (getRequest rzuca)", async () => {
    h.getRequest = () => {
      throw new Error("No StartEvent found in AsyncLocalStorage");
    };

    const response = await get()({});

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/rss.xml");
  });

  it("nieczytelny adres żądania", async () => {
    h.getRequest = () => ({ url: "nie-adres" });

    const response = await get()({});

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/rss.xml");
  });
});
