// WARSTWA HTTP PUBLICZNEGO /mcp: trasy `[.mcp]/list-tools` i `[.mcp]/invoke-tool/$tool`.
//
// PO CO TEN PLIK ISTNIEJE. Oba pliki tras stały na 0/3 linii i 0/1 funkcji -
// bez ani jednego testu. Handlery są CIENKIE i to jest ich zaletą: cały
// protokół MCP, weryfikacja tokenu przez JWKS i wyzwanie 401 mieszkają
// w `@lovable.dev/mcp-js`. Dlatego dowodzimy DOKŁADNIE tego, co robi warstwa
// HTTP, i nic ponadto:
//   1. że handler `ANY` w ogóle ISTNIEJE (bez niego trasa jest 404, a klient
//      MCP nie ma jak wyliczyć narzędzi ani ich zawołać),
//   2. że deleguje do właściwej fabryki pakietu,
//   3. z jakimi opcjami: `resourcePath`, `metadataPath`, `trustForwardedHost`,
//   4. że przekazuje kontekst żądania DALEJ, a nie buduje własnego,
//   5. że oddaje odpowiedź delegata BEZ modyfikacji,
//   6. że import pakietu i definicji MCP dzieje się w CZASIE ŻĄDANIA, a nie
//      przy ładowaniu modułu.
//
// PUNKT 6 JEST TU NAJWAŻNIEJSZY I MA ZAPISANĄ HISTORIĘ. Komentarz w obu
// plikach mówi „Request-time MCP boundary", a `src/routes/mcp.ts` rozwija to
// wprost: „the optional MCP SDK must not initialize with the global SSR route
// graph and take unrelated document/asset requests down". Drzewo tras SSR
// importuje KAŻDY plik trasy przy każdym żądaniu - także żądaniu strony
// głównej. Górny `import ... from "@lovable.dev/mcp-js/stacks/tanstack"`
// wciągnąłby SDK (i tranzytywnie `src/lib/mcp/index.ts`) do tego grafu, więc
// awaria inicjalizacji pakietu położyłaby CAŁĄ witrynę, a nie tylko /mcp.
// W RUNTIME TESTU TEJ ZMIANY NIE WIDAĆ - atrapa odpowiada identycznie przy
// imporcie górnym i dynamicznym - dlatego granica jest sprawdzana na ŹRÓDLE
// pliku, tą samą techniką co w `src/routes/api/public/-jobs-tick.test.ts`.
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO:
//   * `@lovable.dev/mcp-js/stacks/tanstack` - fabryki handlerów. To pakiet
//     zewnętrzny: jego prawdziwy handler poszedłby po JWKS wystawcy, czyli do
//     SIECI, a testy w tym repo nie chodzą do sieci. Atrapa jest tu
//     instrumentem pomiarowym - mierzy ARGUMENTY delegacji, bo tylko one są po
//     stronie tego repo.
// PRAWDZIWE zostają oba pliki tras ORAZ `@/lib/mcp/index` - to definicja
// z tego samego zlecenia i przekazanie właśnie JEJ jest przedmiotem dowodu.
//
// NAZWA PLIKU. Prefiks `-` zgodnie z konwencją katalogu
// `src/routes/api/public/`: generator drzewa tras pomija zarówno pliki
// `*.test.ts`, jak i pliki z prefiksem `-` (`routeFileIgnorePattern`
// w `vite.config.ts`), więc plik testowy nie rejestruje się jako trasa.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { routeServerHandlers, type RouteServerHandler } from "@/test/routeHarness";

// --- atrapa granicy: fabryki handlerów pakietu ------------------------------

/** Opcje, z jakimi trasa woła fabrykę - pełny obiekt, żeby nadmiarowe pole też było widoczne. */
interface StackHandlerOptions {
  readonly resourcePath?: string;
  readonly metadataPath?: string;
  readonly trustForwardedHost?: boolean;
}

interface FactoryCall {
  readonly fabryka: string;
  readonly mcp: unknown;
  readonly options: StackHandlerOptions;
}

interface DelegateCall {
  readonly fabryka: string;
  readonly context: unknown;
}

const h = vi.hoisted(() => ({
  factoryCalls: [] as FactoryCall[],
  delegateCalls: [] as DelegateCall[],
  /** Odpowiedź, którą oddaje delegat - do dowodu o przekazaniu bez modyfikacji. */
  response: null as Response | null,
}));

vi.mock("@lovable.dev/mcp-js/stacks/tanstack", () => {
  const fabryka = (nazwa: string) => (mcp: unknown, options: StackHandlerOptions) => {
    h.factoryCalls.push({ fabryka: nazwa, mcp, options });
    return (context: unknown) => {
      h.delegateCalls.push({ fabryka: nazwa, context });
      return h.response ?? new Response(null, { status: 204 });
    };
  };
  return {
    createTanStackMcpHandler: fabryka("mcp"),
    createTanStackListToolsHandler: fabryka("list-tools"),
    createTanStackInvokeToolHandler: fabryka("invoke-tool"),
    createTanStackOAuthProtectedResourceMetadataHandler: fabryka("metadata"),
  };
});

import { Route as ListToolsRoute } from "@/routes/[.mcp]/list-tools";
import { Route as InvokeToolRoute } from "@/routes/[.mcp]/invoke-tool/$tool";

// --- pomocnicy --------------------------------------------------------------

const LIST_TOOLS_FILE = "src/routes/[.mcp]/list-tools.ts";
const INVOKE_TOOL_FILE = "src/routes/[.mcp]/invoke-tool/$tool.ts";

/** Opcje delegacji identyczne dla wszystkich powierzchni MCP - patrz opis niżej. */
const OCZEKIWANE_OPCJE: StackHandlerOptions = {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
};

function request(path: string): Request {
  return new Request(`https://neweuropeanstrategies.com${path}`, { method: "POST" });
}

/**
 * Handler `ANY` trasy, z twardym błędem, gdy go nie ma. Brak handlera to 404 na
 * publicznym API, więc test „przechodzący" na `undefined` byłby bezwartościowy.
 */
function anyHandler(route: Parameters<typeof routeServerHandlers>[0]): RouteServerHandler {
  const handler = routeServerHandlers(route).ANY;
  if (!handler) throw new Error("test: trasa nie ma handlera ANY");
  return handler;
}

/** Ostatnie wywołanie fabryki, z twardym błędem, gdy delegacji nie było. */
function lastFactoryCall(): FactoryCall {
  const call = h.factoryCalls.at(-1);
  if (!call) throw new Error("test: trasa nie zawołała fabryki handlera");
  return call;
}

beforeEach(() => {
  h.factoryCalls.length = 0;
  h.delegateCalls.length = 0;
  h.response = null;
  // Definicja MCP ładuje się dopiero w czasie żądania i czyta env WTEDY.
  // Adres skonfigurowany, żeby przebieg nie hałasował ostrzeżeniem
  // fail-closed - a jego dowód mieszka w `src/lib/mcp/__tests__/mcpDefinition.test.ts`.
  vi.stubEnv("SUPABASE_URL", "https://db.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[.mcp]/list-tools - handler ANY i delegacja", () => {
  it("wystawia handler ANY i tylko jego", () => {
    expect(Object.keys(routeServerHandlers(ListToolsRoute))).toEqual(["ANY"]);
  });

  // `ANY` zamiast `GET`/`POST` jest tu konieczne: klienci MCP negocjują
  // wyliczanie narzędzi różnymi metodami, a wybór metody należy do pakietu.
  it("deleguje do fabryki listowania narzędzi pakietu", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(h.factoryCalls).toHaveLength(1);
    expect(lastFactoryCall().fabryka).toBe("list-tools");
  });

  it("przekazuje kontekst żądania delegatowi BEZ podmiany", async () => {
    const context = { request: request("/.mcp/list-tools") };

    await anyHandler(ListToolsRoute)(context);

    expect(h.delegateCalls).toHaveLength(1);
    expect(h.delegateCalls[0].context).toBe(context);
  });

  it("oddaje odpowiedź delegata bez modyfikacji", async () => {
    h.response = new Response('{"tools":[]}', { status: 200 });

    const response = await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(response).toBe(h.response);
  });
});

describe("[.mcp]/invoke-tool/$tool - handler ANY i delegacja", () => {
  it("wystawia handler ANY i tylko jego", () => {
    expect(Object.keys(routeServerHandlers(InvokeToolRoute))).toEqual(["ANY"]);
  });

  it("deleguje do fabryki wywoływania narzędzia pakietu", async () => {
    await anyHandler(InvokeToolRoute)({ request: request("/.mcp/invoke-tool/get_post") });

    expect(h.factoryCalls).toHaveLength(1);
    expect(lastFactoryCall().fabryka).toBe("invoke-tool");
  });

  // Nazwa narzędzia jest PARAMETREM ŚCIEŻKI i trasa nie czyta jej sama - musi
  // dojść do delegata w kontekście, inaczej pakiet nie wie, co wywołać.
  it("przekazuje parametr ścieżki z nazwą narzędzia dalej", async () => {
    const context = {
      request: request("/.mcp/invoke-tool/get_post"),
      params: { tool: "get_post" },
    };

    await anyHandler(InvokeToolRoute)(context);

    expect(h.delegateCalls[0].context).toBe(context);
    expect(h.delegateCalls[0].context).toMatchObject({ params: { tool: "get_post" } });
  });

  it("oddaje odpowiedź delegata bez modyfikacji", async () => {
    h.response = new Response('{"content":[]}', { status: 200 });

    const response = await anyHandler(InvokeToolRoute)({
      request: request("/.mcp/invoke-tool/get_post"),
      params: { tool: "get_post" },
    });

    expect(response).toBe(h.response);
  });
});

describe("opcje delegacji - jedna tożsamość zasobu OAuth dla obu tras", () => {
  // `resourcePath` i `metadataPath` MUSZĄ być identyczne na wszystkich
  // powierzchniach MCP: to one budują adres zasobu chronionego ogłaszany
  // w wyzwaniu `WWW-Authenticate: resource_metadata` przy 401. Rozjazd między
  // trasami oznacza, że klient odkrywa metadane pod jednym adresem, a token
  // dostaje wystawiony na inny zasób - i pętla autoryzacji nigdy się nie domyka.
  it("list-tools deleguje z pełnym, dokładnym zestawem opcji", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(lastFactoryCall().options).toEqual(OCZEKIWANE_OPCJE);
  });

  it("invoke-tool deleguje z pełnym, dokładnym zestawem opcji", async () => {
    await anyHandler(InvokeToolRoute)({ request: request("/.mcp/invoke-tool/get_post") });

    expect(lastFactoryCall().options).toEqual(OCZEKIWANE_OPCJE);
  });

  it("obie trasy podają IDENTYCZNE opcje", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });
    await anyHandler(InvokeToolRoute)({ request: request("/.mcp/invoke-tool/get_post") });

    expect(h.factoryCalls[1].options).toEqual(h.factoryCalls[0].options);
  });

  // `trustForwardedHost: true` nie jest kosmetyką: aplikacja stoi za proxy,
  // więc bez tej opcji pakiet zbudowałby adres zasobu z wewnętrznego
  // originu, a klient OAuth dostałby w wyzwaniu 401 adres, którego nie ma
  // w publicznym internecie.
  it("ufa nagłówkowi X-Forwarded-Host - adres zasobu musi być publiczny", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(lastFactoryCall().options.trustForwardedHost).toBe(true);
  });

  it("ogłasza metadane pod standardową ścieżką RFC 9728", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(lastFactoryCall().options.metadataPath).toBe("/.well-known/oauth-protected-resource");
  });
});

describe("delegacja niesie PRAWDZIWĄ definicję MCP", () => {
  // Trasa musi podać TĘ definicję, w której siedzi bramka `auth`. Świeżo
  // zbudowana albo pusta definicja przeszłaby test o samych opcjach
  // i jednocześnie zdjęła uwierzytelnianie z publicznego endpointu.
  it("list-tools przekazuje domyślny eksport @/lib/mcp/index", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });
    const { default: mcp } = await import("@/lib/mcp/index");

    expect(lastFactoryCall().mcp).toBe(mcp);
  });

  it("invoke-tool przekazuje domyślny eksport @/lib/mcp/index", async () => {
    await anyHandler(InvokeToolRoute)({ request: request("/.mcp/invoke-tool/get_post") });
    const { default: mcp } = await import("@/lib/mcp/index");

    expect(lastFactoryCall().mcp).toBe(mcp);
  });

  it("obie trasy dzielą DOKŁADNIE tę samą instancję definicji", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });
    await anyHandler(InvokeToolRoute)({ request: request("/.mcp/invoke-tool/get_post") });

    expect(h.factoryCalls[1].mcp).toBe(h.factoryCalls[0].mcp);
  });

  // Bramka `auth` jedzie razem z definicją. Ta asercja jest tu, a nie tylko
  // w teście definicji, bo dopiero tutaj widać, że to UWIERZYTELNIONA
  // definicja trafia na publiczny adres HTTP.
  it("definicja podana trasie niesie konfigurację uwierzytelniania", async () => {
    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });
    const { default: mcp } = await import("@/lib/mcp/index");

    expect(mcp.auth).toBeDefined();
    expect(lastFactoryCall().mcp).toBe(mcp);
  });
});

describe("granica czasu żądania - pakiet nie wchodzi do grafu tras SSR", () => {
  // Delegacja NIE MOŻE zdarzyć się przy ładowaniu modułu. Trasy są już
  // zaimportowane (górne `import` w tym pliku), więc gdyby fabryka była wołana
  // na poziomie modułu, licznik byłby niepusty PRZED pierwszym żądaniem.
  it("import trasy nie woła jeszcze żadnej fabryki", () => {
    expect(h.factoryCalls).toHaveLength(0);
    expect(h.delegateCalls).toHaveLength(0);
  });

  it("fabryka rusza dopiero na pierwszym żądaniu", async () => {
    expect(h.factoryCalls).toHaveLength(0);

    await anyHandler(ListToolsRoute)({ request: request("/.mcp/list-tools") });

    expect(h.factoryCalls).toHaveLength(1);
  });

  // Handler jest budowany PER ŻĄDANIE. Przypinamy to, bo to jest cena tej
  // granicy - i jednocześnie gwarancja, że między żądaniami nie zostaje stan
  // zbudowany na poprzednim nagłówku `X-Forwarded-Host`.
  it("każde żądanie buduje handler od nowa", async () => {
    const handler = anyHandler(ListToolsRoute);

    await handler({ request: request("/.mcp/list-tools") });
    await handler({ request: request("/.mcp/list-tools") });

    expect(h.factoryCalls).toHaveLength(2);
    expect(h.delegateCalls).toHaveLength(2);
  });
});

describe("źródło tras: granica ładowania i adres publiczny", () => {
  const zrodla = [
    {
      plik: LIST_TOOLS_FILE,
      sciezka: "/.mcp/list-tools",
      fabryka: "createTanStackListToolsHandler",
    },
    {
      plik: INVOKE_TOOL_FILE,
      sciezka: "/.mcp/invoke-tool/$tool",
      fabryka: "createTanStackInvokeToolHandler",
    },
  ] as const;

  for (const { plik, sciezka, fabryka } of zrodla) {
    // Sanity pomiaru: czytamy TEN plik, który testujemy, a nie pustkę. Adresu
    // nie da się odczytać z obiektu `Route` - `id`/`path` doklepuje dopiero
    // generator drzewa (`routeTree.gen.ts`), więc w teście są `undefined`.
    // Adres jest kontraktem PUBLICZNYM, więc jego dowód idzie po źródle.
    it(`${plik} rejestruje adres ${sciezka} i handler ANY`, () => {
      const source = readFileSync(plik, "utf8");

      expect(source).toContain(`createFileRoute("${sciezka}")`);
      expect(source).toContain("ANY:");
    });

    // TO JEST DOWÓD OPISANEGO INCYDENTU. Import GÓRNY wciągnąłby SDK do grafu
    // tras SSR, który ładuje się przy KAŻDYM żądaniu - także żądaniu strony
    // niezwiązanej z MCP. Atrapa odpowiada identycznie w obu wariantach, więc
    // runtime tej zmiany nie zobaczy: dowód musi patrzeć na źródło.
    it(`${plik} ładuje pakiet MCP TYLKO przez await import w handlerze`, () => {
      const source = readFileSync(plik, "utf8");
      const importyGorne = [...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";$/gm)].map(
        (m) => m[1],
      );

      expect(source).toContain('import("@lovable.dev/mcp-js/stacks/tanstack")');
      expect(importyGorne).not.toContain("@lovable.dev/mcp-js/stacks/tanstack");
      expect(importyGorne).toEqual(["@tanstack/react-router"]);
    });

    it(`${plik} ładuje definicję MCP TYLKO przez await import w handlerze`, () => {
      const source = readFileSync(plik, "utf8");
      const importyGorne = [...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";$/gm)].map(
        (m) => m[1],
      );

      expect(source).toMatch(/import\("(\.\.\/)+lib\/mcp\/index"\)/);
      expect(importyGorne.some((m) => m.includes("lib/mcp/index"))).toBe(false);
      expect(source).toContain(fabryka);
    });
  }
});
