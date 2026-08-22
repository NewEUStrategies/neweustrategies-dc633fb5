// Izomorficzny odczyt adresu bieżącego żądania (`getRequestUrl`, `getOrigin`) -
// jedyne źródło absolutnych adresów dla canonical / og:url / hreflang. Do
// 21.08.2026 plik miał 19% gałęzi.
//
// CO TEN PLIK DOWODZI:
//   1) FAIL-CLOSED NA BRAKU HOSTA I NA WYJĄTKU - brak nagłówka `host`, wyjątek
//      z `getRequest()` oraz niepoprawny `req.url` dają PUSTY NAPIS, nie adres
//      zbudowany z połowy danych. Pusty napis jest sygnałem "nie wiem", który
//      wyżej blokuje emisję canonical; adres z podstawioną domeną trafiłby do
//      dokumentu współdzielonego przez cache i wskazywał cudzy host.
//   2) DOKŁADNY SKŁAD ADRESU - schemat z `x-forwarded-proto` (domyślnie https),
//      host DOSŁOWNIE z nagłówka `host` (port i poddomena ZACHOWANE), ścieżka i
//      query z `req.url`, BEZ fragmentu.
//   3) PRZYPINA, ŻE MODUŁ CZYTA `host`, A NIE `x-forwarded-host` - przy dwóch
//      różnych wartościach wygrywa `host`. To zamierzone: walidacja hosta
//      względem `tenants.domain` mieszka wyżej (`pickTrustedHost` w
//      `src/lib/server/tenant.server.ts`, `trustedPublicHost` w
//      `src/lib/http/requestHost.ts`), a nie w budowniczym adresu.
//   4) RÓŻNICĘ MIĘDZY OBIEMA GAŁĘZIAMI `createIsomorphicFn` - serwerową
//      (nagłówki żądania) i klienta (`window.location`), włącznie z jej
//      zabezpieczeniem `typeof window !== "undefined"`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `src/lib/http/__tests__/*` - walidacji hosta względem tenanta i
//     kanonicznego przekierowania hosta. Tutaj host jest przyjmowany dosłownie,
//     bo taki jest kontrakt TEGO modułu (patrz punkt 3).
//   - `seoHead.test.ts` - rozstrzygania języka; ten plik nie dotyka `activeLang`.
//   - `meta.test.ts` / `headContract.test.ts` - budowy samych znaczników z już
//     znanego adresu.
//   - E2E: `e2e/seo.spec.ts` dowodzi powierzchni maszynowych BAJTAMI na żywym
//     SSR - w szczególności test "robots.txt is served by the route, not by a
//     static asset" dowodzi, że SFAŁSZOWANY `x-forwarded-host` NIE otwiera
//     indeksowania. Ten plik dowodzi tylko, ŻE ten nagłówek nie wpływa na
//     `getRequestUrl`/`getOrigin`; nie ma tu ANI JEDNEGO żądania sieciowego.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrigin, getRequestUrl } from "@/lib/seo/request";

/** Minimalny kształt żądania, jaki czyta moduł: adres + nagłówki. */
interface StubRequest {
  url: string;
  headers: Headers;
}

const state = vi.hoisted(() => ({
  request: null as { url: string; headers: Headers } | null,
  /** Gdy ustawione, `getRequest()` rzuca - odwzorowuje brak kontekstu żądania. */
  throwing: false,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (state.throwing) throw new Error("test: brak kontekstu żądania");
    return state.request;
  },
}));

/** Ustawia atrapę żądania; nagłówki podawane wprost, bez `Request` (ten filtruje `host`). */
function givenRequest(url: string, headers: Record<string, string> = {}): void {
  const req: StubRequest = { url, headers: new Headers(headers) };
  state.request = req;
  state.throwing = false;
}

beforeEach(() => {
  state.request = null;
  state.throwing = false;
});

describe("getRequestUrl / getOrigin - gałąź serwerowa (vitest wybiera właśnie ją)", () => {
  it("BRAK nagłówka host to pusty napis w OBU eksportach (fail-closed)", () => {
    givenRequest("https://cokolwiek.test/analizy/wpis?strona=2");
    expect(getRequestUrl()).toBe("");
    expect(getOrigin()).toBe("");
  });

  it("zwykły host składa schemat, host, ścieżkę i query", () => {
    givenRequest("https://wewnetrzny.local/analizy/wpis?strona=2", {
      host: "neweuropeanstrategies.com",
    });
    expect(getRequestUrl()).toBe("https://neweuropeanstrategies.com/analizy/wpis?strona=2");
    expect(getOrigin()).toBe("https://neweuropeanstrategies.com");
  });

  it("ZACHOWUJE port w hoście (localhost:3000) - inaczej adres deweloperski byłby nieosiągalny", () => {
    givenRequest("http://localhost:3000/blog", {
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    });
    expect(getRequestUrl()).toBe("http://localhost:3000/blog");
    expect(getOrigin()).toBe("http://localhost:3000");
  });

  it("ZACHOWUJE poddomenę (en.example.com) - to osobny origin, nie alias domeny nadrzędnej", () => {
    givenRequest("https://wewnetrzny.local/analizy", { host: "en.example.com" });
    expect(getRequestUrl()).toBe("https://en.example.com/analizy");
    expect(getOrigin()).toBe("https://en.example.com");
  });

  it("x-forwarded-proto: http daje schemat http w OBU eksportach", () => {
    givenRequest("https://wewnetrzny.local/", {
      host: "podglad.example.com",
      "x-forwarded-proto": "http",
    });
    expect(getRequestUrl()).toBe("http://podglad.example.com/");
    expect(getOrigin()).toBe("http://podglad.example.com");
  });

  it("BRAK x-forwarded-proto domyślnie daje https, mimo http w req.url", () => {
    // Za proxy `req.url` bywa wewnętrznym adresem http - domyślka https pilnuje,
    // żeby canonical nie zjechał na schemat, którego publiczna domena nie serwuje.
    givenRequest("http://wewnetrzny.local/analizy", { host: "neweuropeanstrategies.com" });
    expect(getRequestUrl()).toBe("https://neweuropeanstrategies.com/analizy");
    expect(getOrigin()).toBe("https://neweuropeanstrategies.com");
  });

  it("przy DWÓCH różnych nagłówkach hosta wygrywa `host`, a `x-forwarded-host` jest ignorowany", () => {
    // ZAMIERZONE, nie defekt: ten moduł przyjmuje host dosłownie, a wybór
    // ZAUFANEGO hosta (walidacja względem tenants.domain) mieszka w
    // `pickTrustedHost` / `trustedPublicHost`. Powierzchnie crawlera są dzięki
    // temu fail-closed - dowodzi tego e2e "robots.txt is served by the route,
    // not by a static asset", gdzie sfałszowany `x-forwarded-host` nie otwiera
    // indeksowania. Gdyby ten moduł zaczął czytać `x-forwarded-host`, każdy
    // klient mógłby wstrzyknąć obcą domenę do canonical/og:url dokumentu
    // trzymanego we współdzielonym cache.
    givenRequest("https://wewnetrzny.local/analizy/wpis", {
      host: "neweuropeanstrategies.com",
      "x-forwarded-host": "squatter.invalid",
    });
    expect(getRequestUrl()).toBe("https://neweuropeanstrategies.com/analizy/wpis");
    expect(getRequestUrl()).not.toContain("squatter.invalid");
    expect(getOrigin()).toBe("https://neweuropeanstrategies.com");
  });

  it("ścieżka BEZ query nie dokleja pustego znaku zapytania", () => {
    givenRequest("https://wewnetrzny.local/analizy/wpis", { host: "example.com" });
    expect(getRequestUrl()).toBe("https://example.com/analizy/wpis");
  });

  it("FRAGMENT (#) NIE trafia do adresu - i tak nie jest wysyłany przez przeglądarkę", () => {
    // Przypięcie faktycznego zachowania: `URL.search` nie obejmuje `hash`, więc
    // canonical nigdy nie rozszczepi się na warianty per-kotwica.
    givenRequest("https://wewnetrzny.local/analizy/wpis?strona=2#sekcja", {
      host: "example.com",
    });
    expect(getRequestUrl()).toBe("https://example.com/analizy/wpis?strona=2");
    expect(getRequestUrl()).not.toContain("#");
  });

  it("WYJĄTEK z getRequest() daje pusty napis w OBU eksportach (gałąź catch)", () => {
    state.throwing = true;
    expect(getRequestUrl()).toBe("");
    expect(getOrigin()).toBe("");
  });

  it("brak żądania w kontekście (null) też kończy się pustym napisem, a nie wyjątkiem", () => {
    state.request = null;
    expect(getRequestUrl()).toBe("");
    expect(getOrigin()).toBe("");
  });

  it("NIEPOPRAWNY req.url daje pusty napis w getRequestUrl, ale getOrigin nadal składa origin", () => {
    // Przypięta ASYMETRIA: tylko `getRequestUrl` parsuje `req.url`, więc tylko
    // ono traci wynik. `getOrigin` potrzebuje wyłącznie nagłówków, więc origin
    // (np. dla og:image) pozostaje dostępny.
    givenRequest("nie-jest-adresem", { host: "example.com" });
    expect(getRequestUrl()).toBe("");
    expect(getOrigin()).toBe("https://example.com");
  });
});

// GAŁĄŹ KLIENTA. `createIsomorphicFn` z `@tanstack/start-fn-stubs` bez wtyczki
// budującej zwraca `serverImpl ?? clientImpl`, więc w vitest zawsze wykonuje się
// gałąź serwerowa. Żeby wykonać gałąź klienta (tę, która realnie ląduje w
// bundlu przeglądarki), moduł jest przeładowywany z atrapą łańcucha
// `createIsomorphicFn`, która oddaje implementację `.client(...)`.
type IsoImpl = () => string;

interface IsoChain {
  (): string;
  server: (impl: IsoImpl) => IsoChain;
  client: (impl: IsoImpl) => IsoChain;
}

/** Łańcuch `.server().client()`, który wykonuje gałąź KLIENTA. */
function clientFirstChain(clientImpl: IsoImpl | null): IsoChain {
  const call = (): string => {
    if (!clientImpl) throw new Error("test: łańcuch atrapy nie dostał gałęzi klienta");
    return clientImpl();
  };
  return Object.assign(call, {
    server: (): IsoChain => clientFirstChain(clientImpl),
    client: (impl: IsoImpl): IsoChain => clientFirstChain(impl),
  });
}

/** Świeży moduł `request.ts` zbudowany na gałęzi klienta. */
async function loadClientBranch(): Promise<typeof import("@/lib/seo/request")> {
  vi.doMock("@tanstack/react-start", () => ({
    createIsomorphicFn: () => clientFirstChain(null),
  }));
  vi.resetModules();
  return import("@/lib/seo/request");
}

describe("getRequestUrl / getOrigin - gałąź klienta (window.location)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@tanstack/react-start");
    vi.resetModules();
  });

  it("czyta window.location.href oraz window.location.origin", async () => {
    vi.stubGlobal("window", {
      location: {
        href: "https://neweuropeanstrategies.com/en/analizy/wpis?strona=2",
        origin: "https://neweuropeanstrategies.com",
      },
    });
    const mod = await loadClientBranch();
    expect(mod.getRequestUrl()).toBe("https://neweuropeanstrategies.com/en/analizy/wpis?strona=2");
    expect(mod.getOrigin()).toBe("https://neweuropeanstrategies.com");
  });

  it("na kliencie zachowuje port i poddomenę, bo bierze adres dosłownie", async () => {
    vi.stubGlobal("window", {
      location: { href: "http://en.localhost:3000/blog", origin: "http://en.localhost:3000" },
    });
    const mod = await loadClientBranch();
    expect(mod.getRequestUrl()).toBe("http://en.localhost:3000/blog");
    expect(mod.getOrigin()).toBe("http://en.localhost:3000");
  });

  it("BRAK window (gałąź klienta wykonana poza przeglądarką) daje pusty napis", async () => {
    // Zabezpieczenie `typeof window !== "undefined"`: bundel klienta bywa
    // wykonywany w prerenderze, gdzie DOM nie istnieje. Kontrakt jest ten sam,
    // co po stronie serwera - pusty napis, nie wyjątek w trakcie renderu <head>.
    vi.stubGlobal("window", undefined);
    const mod = await loadClientBranch();
    expect(mod.getRequestUrl()).toBe("");
    expect(mod.getOrigin()).toBe("");
  });
});
