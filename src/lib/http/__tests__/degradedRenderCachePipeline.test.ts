// KOLEJNOŚĆ, NIE CZYSTA FUNKCJA.
//
// `defaultCacheControl.test.ts` sprawdza czystą `planDefaultCacheControl` na
// syntetycznej `Response` - i przechodził na zielono przez cały okres, w którym
// opt-out `no-store` dla renderu ZDEGRADOWANEGO był w produkcji MARTWY. Powód
// jest w kolejności, której syntetyczna Response nie ma:
//
//   loader --setResponseHeader--> nagłówki ZDARZENIA h3
//                                   ↑ scalane dopiero w toResponse(),
//                                     ZA CAŁYM łańcuchem middleware
//   łańcuch: ... documentCacheMiddleware -> defaultCacheControlMiddleware -> router
//   droga powrotna:  router -> defaultCacheControl -> documentCache -> ... -> toResponse
//
// Czyli w chwili, w której `documentStorePolicy` decyduje o ZAPISIE, nagłówka
// trasy fizycznie nie ma na odpowiedzi. Skutek do 2026-09-01: czytelnik na MISS
// dostawał `private, no-store`, a do L1/L2 wchodziło domyślne
// `public, max-age=60, s-maxage=900, stale-while-revalidate=86400` - pusta
// powłoka archiwum zamarzała na brzegu na 24 h po JEDNEJ czkawce bazy.
//
// Ten plik odtwarza tę kolejność na PRAWDZIWYCH elementach potoku:
//   * `requestHandler` z @tanstack/react-start/server - realny zasięg żądania
//     (AsyncLocalStorage + zdarzenie h3 + scalenie nagłówków w toResponse),
//   * prawdziwe `setCacheControlHeader` / `readRouteCacheDirective`,
//   * prawdziwa `planDefaultCacheControl`,
//   * prawdziwe `handleDocumentRequest` + `applyDeferredDocumentStore`
//     (ten sam duet, który składa `src/server.ts`).
//
// Zero sieci, zero sekretów, zero atrap warstwy transportowej.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestHandler } from "@tanstack/react-start/server";

import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  resetDocumentCacheForTests,
} from "../documentCache.server";
import { liveCacheControl, planDefaultCacheControl } from "../defaultCacheControl";
import { readRouteCacheDirective, setCacheControlHeader } from "../responseHeaders";
import { contentCacheControl } from "../cachePolicy";
import { resilientCacheControl } from "@/lib/ssr/resilientLoad";

const HTML = "content-type";
const HTML_VALUE = "text/html; charset=utf-8";

/**
 * Odwzorowanie `defaultCacheControlMiddleware` z `src/start.ts` - NAJGŁĘBSZE
 * middleware, przechodzone na drodze powrotnej PRZED `documentCacheMiddleware`.
 * Kopiuje jego trzy kroki 1:1: odczyt dyrektywy trasy, plan polityki, nadanie
 * nagłówka na przebudowanej odpowiedzi.
 */
function defaultCacheControlLayer(request: Request, response: Response): Response {
  const plan = planDefaultCacheControl(request, response, readRouteCacheDirective());
  if (!plan) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", plan);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Jedno żądanie dokumentu przez PEŁNĄ kolejność produkcyjną: zasięg żądania →
 * (documentCache → defaultCacheControl → loader trasy) → scalenie nagłówków
 * zdarzenia w `toResponse()` → odroczony zapis z `src/server.ts`.
 */
async function documentRequest(
  path: string,
  loader: () => void,
  body = "<html><body>ok</body></html>",
  host = "tenant-a.eu",
): Promise<Response> {
  const handler = requestHandler(async (request: Request) => {
    const routed = await handleDocumentRequest(request, () => {
      // Loader trasy: ustawia swoją intencję cache'ową tak jak produkcja.
      loader();
      const rendered = new Response(body, {
        status: 200,
        headers: { [HTML]: HTML_VALUE },
      });
      // Najgłębsze middleware zamyka drogę powrotną renderu.
      return defaultCacheControlLayer(request, rendered);
    });
    return routed as Response;
  });

  const response = await handler(
    new Request(`https://${host}${path}`, {
      method: "GET",
      headers: { "x-forwarded-host": host },
    }),
    {},
  );
  // `src/server.ts` wykonuje tee do cache'a ZA egzekutorem middleware.
  return applyDeferredDocumentStore(response);
}

/** Zapis zbiera się asynchronicznie - domknij mikrotaski/timery. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Ile dokumentów naprawdę wylądowało w magazynie L1. */
function storedEntries(): number {
  return getDocumentCacheSnapshot().entries;
}

beforeEach(() => {
  resetDocumentCacheForTests();
});

afterEach(() => {
  resetDocumentCacheForTests();
});

describe("render zdegradowany a ZAPIS do NES Edge Cache (kolejność potoku)", () => {
  it("opt-out `no-store` z loadera realnie BLOKUJE zapis, nie tylko nagłówek dla czytelnika", async () => {
    const response = await documentRequest("/blog", () => {
      setCacheControlHeader(resilientCacheControl(true));
    });
    await response.text();
    await settle();

    // Czytelnik: nagłówek zdarzenia h3 nadpisuje politykę domyślną w toResponse().
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // Brzeg: TO jest regresja, której ten plik pilnuje. Przed naprawą tu było 1.
    expect(storedEntries()).toBe(0);
  });

  it("czysty render nadal wchodzi do magazynu (naprawa nie wyłączyła cache'a)", async () => {
    const response = await documentRequest("/blog", () => {
      setCacheControlHeader(resilientCacheControl(false));
    });
    await response.text();
    await settle();

    expect(response.headers.get("cache-control")).toBe(contentCacheControl());
    expect(storedEntries()).toBe(1);
  });

  it("trasa bez własnej intencji dostaje politykę domyślną i wchodzi do magazynu", async () => {
    const response = await documentRequest("/category/geopolityka", () => {});
    await response.text();
    await settle();

    expect(response.headers.get("cache-control")).toContain("s-maxage=900");
    expect(storedEntries()).toBe(1);
  });

  it("`/live` zapisuje się z krótką świeżością, którą deklaruje - nie z 900 s", async () => {
    const response = await documentRequest("/live", () => {
      setCacheControlHeader(resilientCacheControl(false, liveCacheControl()));
    });
    await response.text();
    await settle();

    // Zarówno czytelnik, jak i brzeg widzą TĘ SAMĄ, żywą politykę.
    expect(response.headers.get("cache-control")).toBe(liveCacheControl());
    expect(response.headers.get("cache-control")).toContain("s-maxage=30");
    expect(storedEntries()).toBe(1);
  });

  it("zdegradowana relacja live też nie zamraża pustki na brzegu", async () => {
    const response = await documentRequest("/live", () => {
      setCacheControlHeader(resilientCacheControl(true, liveCacheControl()));
    });
    await response.text();
    await settle();

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(storedEntries()).toBe(0);
  });

  it.each([true, false])(
    "root/child opt-out wins in both completion orders (root first: %s)",
    async (degradedFirst) => {
      const policies = [resilientCacheControl(true), resilientCacheControl(false)];
      if (!degradedFirst) policies.reverse();
      const response = await documentRequest("/", () => {
        for (const policy of policies) setCacheControlHeader(policy);
        expect(readRouteCacheDirective()).toBe("private, no-store");
      });
      await response.text();
      await settle();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(storedEntries()).toBe(0);
    },
  );

  it("dyrektywa NIE przecieka między żądaniami (klucz to obiekt Request)", async () => {
    const degraded = await documentRequest("/blog", () => {
      setCacheControlHeader(resilientCacheControl(true));
    });
    await degraded.text();
    await settle();
    expect(storedEntries()).toBe(0);

    // Kolejne żądanie tej samej trasy, tym razem czyste: WeakMap jest kluczowana
    // obiektem Request, więc poprzedni `no-store` nie ma jak się przenieść.
    const clean = await documentRequest("/blog", () => {
      setCacheControlHeader(resilientCacheControl(false));
    });
    await clean.text();
    await settle();
    expect(clean.headers.get("cache-control")).toBe(contentCacheControl());
    expect(storedEntries()).toBe(1);
  });

  it("dyrektywa `public` z trasy NIE obchodzi bariery żądań sesyjnych", async () => {
    // Ta gałąź jest sprawdzana na czystej funkcji, bo żądanie z ciasteczkiem
    // `sb-*` jest przez NES Edge Cache BYPASS-owane wcześniej i nie dociera do
    // decyzji o zapisie - a mimo to nagłówek `public` byłby mylący dla
    // pośredników i dlatego dyrektywa nie może tej bariery przeskoczyć.
    const request = {
      method: "GET",
      url: "https://tenant-a.eu/blog",
      headers: {
        get: (name: string) => (name.toLowerCase() === "cookie" ? "sb-access-token=abc" : null),
      },
    };
    const response = {
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === HTML ? HTML_VALUE : null) },
    };
    expect(planDefaultCacheControl(request, response, contentCacheControl())).toBeNull();
    // …ale opt-out zawsze przechodzi: `no-store` wyłącznie zawęża.
    expect(planDefaultCacheControl(request, response, "private, no-store")).toBe(
      "private, no-store",
    );
  });

  it("czysta dyrektywa NIE nadpisuje własnego nagłówka odpowiedzi (feedy, sitemapy)", () => {
    const request = {
      method: "GET",
      url: "https://tenant-a.eu/blog",
      headers: { get: () => null },
    };
    const response = {
      status: 200,
      headers: {
        get: (name: string) => {
          const key = name.toLowerCase();
          if (key === HTML) return HTML_VALUE;
          if (key === "cache-control") return "public, max-age=300";
          return null;
        },
      },
    };
    // Czysta dyrektywa ustępuje nagłówkowi, który trasa nadała wprost.
    expect(planDefaultCacheControl(request, response, contentCacheControl())).toBeNull();
    // OPT-OUT jednak wygrywa: `no-store` wyłącznie zawęża, a bez tej kolejności
    // jest martwy na każdej odpowiedzi non-ok (h3 scala nagłówki zdarzenia tylko
    // dla `val.ok`) - patrz defaultCacheControl.test.ts.
    expect(planDefaultCacheControl(request, response, "private, no-store")).toBe(
      "private, no-store",
    );
  });
});
