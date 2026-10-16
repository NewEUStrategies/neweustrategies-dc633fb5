// WEJŚCIA MCP: `/mcp` (protokół) i `/.well-known/oauth-protected-resource`
// (metadane zasobu chronionego, RFC 9728).
//
// PO CO TEN PLIK ISTNIEJE. Oba pliki tras stały na 0% pokrycia. Trasy
// `[.mcp]/list-tools` i `[.mcp]/invoke-tool/$tool` mają już dowód warstwy HTTP
// w `src/routes/[.mcp]/-mcpRouteHandlers.test.ts`; ten plik NIE powtarza go dla
// nich, tylko domyka dwie pozostałe powierzchnie tym samym zestawem dowodów:
//   1. handler `ANY` istnieje i jest jedyny (bez niego adres to 404 - klient
//      MCP nie ma jak się połączyć ani odkryć serwera autoryzacji),
//   2. deleguje do WŁAŚCIWEJ fabryki pakietu (protokół vs metadane),
//   3. z opcjami IDENTYCZNYMI jak trasy `[.mcp]` - `resourcePath` "/mcp",
//      `metadataPath` "/.well-known/oauth-protected-resource",
//      `trustForwardedHost` true,
//   4. przekazuje kontekst żądania dalej bez podmiany i oddaje odpowiedź
//      delegata bez modyfikacji,
//   5. niesie PRAWDZIWĄ definicję `@/lib/mcp/index` z bramką `auth`,
//   6. ładuje pakiet i definicję w CZASIE ŻĄDANIA - dowód na źródle, bo atrapa
//      odpowiada identycznie przy imporcie górnym i dynamicznym. Źródło czyta
//      parser TypeScriptu: statyczny graf to KAŻDA deklaracja `import`/`export
//      ... from` (także goły import dla efektu ubocznego), a `import(...)` liczy
//      się tylko w ciele handlera `ANY`.
//
// DLACZEGO PUNKT 3 JEST TU NAJWAŻNIEJSZY. `/.well-known/oauth-protected-resource`
// ogłasza adres zasobu, a `/mcp` w wyzwaniu 401 (`WWW-Authenticate:
// resource_metadata`) wskazuje, gdzie tych metadanych szukać. Rozjazd opcji
// między tymi dwiema trasami oznacza, że klient odkrywa metadane pod jednym
// adresem, a token dostaje na inny zasób - pętla autoryzacji nigdy się nie domyka.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: `@lovable.dev/mcp-js/stacks/tanstack` (prawdziwy
// handler poszedłby po JWKS wystawcy, czyli do sieci). Atrapa mierzy ARGUMENTY
// delegacji - tylko one są po stronie tego repo. `@/lib/mcp/index` zostaje
// prawdziwe: przekazanie właśnie tej definicji jest przedmiotem dowodu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AnyRoute } from "@tanstack/react-router";
import ts from "typescript";

import { routeServerHandlers, type RouteServerHandler } from "@/test/routeHarness";

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

import { Route as McpRoute } from "@/routes/mcp";
import { Route as MetadataRoute } from "@/routes/[.well-known]/oauth-protected-resource";
import { Route as ListToolsRoute } from "@/routes/[.mcp]/list-tools";

// Stan atrapy ZARAZ po imporcie tras, zanim `beforeEach` go wyzeruje. Fabryka
// wołana przy ładowaniu modułu zostawiłaby tu ślad - licznik czytany dopiero
// w teście (po `beforeEach`) byłby zawsze pusty i niczego by nie dowodził.
const wywolaniaPrzyImporcie = {
  fabryki: h.factoryCalls.length,
  delegaci: h.delegateCalls.length,
};

/** Opcje delegacji identyczne dla WSZYSTKICH powierzchni MCP. */
const OCZEKIWANE_OPCJE: StackHandlerOptions = {
  resourcePath: "/mcp",
  metadataPath: "/.well-known/oauth-protected-resource",
  trustForwardedHost: true,
};

function request(path: string, method = "POST"): Request {
  return new Request(`https://neweuropeanstrategies.com${path}`, { method });
}

/** Handler `ANY` z twardym błędem, gdy go nie ma - brak handlera to 404 publicznego API. */
function anyHandler(route: AnyRoute): RouteServerHandler {
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

const powierzchnie = [
  {
    nazwa: "/mcp",
    route: McpRoute as AnyRoute,
    sciezka: "/mcp",
    metoda: "POST",
    fabryka: "mcp",
  },
  {
    nazwa: "/.well-known/oauth-protected-resource",
    route: MetadataRoute as AnyRoute,
    sciezka: "/.well-known/oauth-protected-resource",
    // Klient OAuth pobiera metadane GET-em, bez tokenu.
    metoda: "GET",
    fabryka: "metadata",
  },
] as const;

beforeEach(() => {
  h.factoryCalls.length = 0;
  h.delegateCalls.length = 0;
  h.response = null;
  // Definicja MCP ładuje się dopiero w czasie żądania i czyta env WTEDY.
  // Adres skonfigurowany, żeby przebieg nie hałasował ostrzeżeniem
  // fail-closed - jego dowód mieszka w `src/lib/mcp/__tests__/mcpDefinition.test.ts`.
  vi.stubEnv("SUPABASE_URL", "https://db.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("granica czasu żądania - import tras nie dotyka pakietu", () => {
  it("import tras nie woła jeszcze żadnej fabryki", () => {
    expect(wywolaniaPrzyImporcie).toEqual({ fabryki: 0, delegaci: 0 });
  });
});

describe.each(powierzchnie)("$nazwa - handler ANY i delegacja", (p) => {
  it("wystawia handler ANY i tylko jego", () => {
    expect(Object.keys(routeServerHandlers(p.route))).toEqual(["ANY"]);
  });

  it("deleguje do właściwej fabryki pakietu", async () => {
    await anyHandler(p.route)({ request: request(p.sciezka, p.metoda) });

    expect(h.factoryCalls).toHaveLength(1);
    expect(lastFactoryCall().fabryka).toBe(p.fabryka);
  });

  it("deleguje z pełnym, dokładnym zestawem opcji", async () => {
    await anyHandler(p.route)({ request: request(p.sciezka, p.metoda) });

    expect(lastFactoryCall().options).toEqual(OCZEKIWANE_OPCJE);
  });

  it("przekazuje kontekst żądania delegatowi BEZ podmiany", async () => {
    const context = { request: request(p.sciezka, p.metoda) };

    await anyHandler(p.route)(context);

    expect(h.delegateCalls).toHaveLength(1);
    expect(h.delegateCalls[0].fabryka).toBe(p.fabryka);
    expect(h.delegateCalls[0].context).toBe(context);
  });

  it("oddaje odpowiedź delegata bez modyfikacji", async () => {
    h.response = new Response('{"ok":true}', { status: 200 });

    const response = await anyHandler(p.route)({ request: request(p.sciezka, p.metoda) });

    expect(response).toBe(h.response);
  });

  it("przekazuje domyślny eksport @/lib/mcp/index z bramką auth", async () => {
    // Świeżo zbudowana albo pusta definicja przeszłaby test o samych opcjach
    // i jednocześnie zdjęła uwierzytelnianie z publicznego endpointu.
    await anyHandler(p.route)({ request: request(p.sciezka, p.metoda) });
    const { default: mcp } = await import("@/lib/mcp/index");

    expect(lastFactoryCall().mcp).toBe(mcp);
    expect(mcp.auth).toBeDefined();
  });

  // Handler budowany PER ŻĄDANIE - cena granicy czasu żądania i gwarancja, że
  // między żądaniami nie zostaje stan zbudowany na poprzednim `X-Forwarded-Host`.
  it("każde żądanie buduje handler od nowa", async () => {
    const handler = anyHandler(p.route);

    await handler({ request: request(p.sciezka, p.metoda) });
    await handler({ request: request(p.sciezka, p.metoda) });

    expect(h.factoryCalls).toHaveLength(2);
    expect(h.delegateCalls).toHaveLength(2);
  });
});

describe("jedna tożsamość zasobu OAuth na wszystkich powierzchniach MCP", () => {
  it("/mcp i metadane podają IDENTYCZNE opcje i tę samą instancję definicji", async () => {
    await anyHandler(McpRoute as AnyRoute)({ request: request("/mcp") });
    await anyHandler(MetadataRoute as AnyRoute)({
      request: request("/.well-known/oauth-protected-resource", "GET"),
    });

    expect(h.factoryCalls.map((c) => c.fabryka)).toEqual(["mcp", "metadata"]);
    expect(h.factoryCalls[1].options).toEqual(h.factoryCalls[0].options);
    expect(h.factoryCalls[1].mcp).toBe(h.factoryCalls[0].mcp);
  });

  it("opcje wejść są identyczne z opcjami trasy [.mcp]/list-tools", async () => {
    // Trzecia strona tej samej umowy: wyliczanie narzędzi musi wskazywać ten
    // sam zasób, co protokół i metadane.
    await anyHandler(ListToolsRoute as AnyRoute)({ request: request("/.mcp/list-tools") });
    await anyHandler(McpRoute as AnyRoute)({ request: request("/mcp") });
    await anyHandler(MetadataRoute as AnyRoute)({
      request: request("/.well-known/oauth-protected-resource", "GET"),
    });

    const [listTools, mcp, metadata] = h.factoryCalls;
    expect(mcp.options).toEqual(listTools.options);
    expect(metadata.options).toEqual(listTools.options);
    expect(metadata.mcp).toBe(listTools.mcp);
  });
});

describe("źródło tras: adres publiczny i granica ładowania", () => {
  const zrodla = [
    {
      plik: "src/routes/mcp.ts",
      sciezka: "/mcp",
      fabryka: "createTanStackMcpHandler",
    },
    {
      plik: "src/routes/[.well-known]/oauth-protected-resource.ts",
      sciezka: "/.well-known/oauth-protected-resource",
      fabryka: "createTanStackOAuthProtectedResourceMetadataHandler",
    },
  ] as const;

  /** Zależności pliku trasy pogrupowane według CHWILI, w której się ładują. */
  interface ZaleznosciTrasy {
    /** Statyczny graf modułu - ładuje się razem z drzewem tras SSR. */
    readonly statyczne: string[];
    /** `import(...)` wewnątrz handlera `ANY` - ładuje się dopiero w czasie żądania. */
    readonly wHandlerze: string[];
    /** `import(...)` poza handlerem (np. `await import` w zasięgu modułu) - też przy imporcie. */
    readonly pozaHandlerem: string[];
  }

  /** Nazwa właściwości obiektu albo metody; `undefined` dla nazw liczonych. */
  function nazwa(name: ts.PropertyName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
  }

  /** Czy węzeł leży w ciele handlera `ANY` (`ANY: async () => ...`, `ANY() {...}`). */
  function wHandlerzeAny(node: ts.Node): boolean {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isMethodDeclaration(n) && nazwa(n.name) === "ANY") return true;
      if (
        ts.isFunctionLike(n) &&
        ts.isPropertyAssignment(n.parent) &&
        nazwa(n.parent.name) === "ANY"
      )
        return true;
    }
    return false;
  }

  // Parser TypeScriptu zamiast wyrażenia regularnego. Regex na `import ... from`
  // nie widział gołego `import "pakiet";` (import dla efektu ubocznego) ani
  // `export ... from` - oba wciągają pakiet do grafu SSR tak samo jak import
  // z nazwami, a test i tak przechodził. AST widzi każdą deklarację wprost.
  function zaleznosciTrasy(plik: string, source: string): ZaleznosciTrasy {
    const sf = ts.createSourceFile(plik, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    // Specyfikator niebędący literałem (np. zmienna) zostaje widoczny w porażce.
    const specyfikator = (node: ts.Node | undefined): string =>
      node && ts.isStringLiteralLike(node) ? node.text : `<wyrażenie: ${node?.getText(sf)}>`;
    const statyczne: string[] = [];
    const wHandlerze: string[] = [];
    const pozaHandlerem: string[] = [];

    for (const st of sf.statements) {
      // `import type` / `export type` kompilator wymazuje w całości - do grafu nie trafiają.
      if (ts.isImportDeclaration(st)) {
        if (!st.importClause?.isTypeOnly) statyczne.push(specyfikator(st.moduleSpecifier));
      } else if (ts.isExportDeclaration(st)) {
        if (st.moduleSpecifier && !st.isTypeOnly) statyczne.push(specyfikator(st.moduleSpecifier));
      } else if (
        ts.isImportEqualsDeclaration(st) &&
        ts.isExternalModuleReference(st.moduleReference)
      ) {
        if (!st.isTypeOnly) statyczne.push(specyfikator(st.moduleReference.expression));
      }
    }

    const odwiedz = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        (wHandlerzeAny(node) ? wHandlerze : pozaHandlerem).push(specyfikator(node.arguments[0]));
      }
      ts.forEachChild(node, odwiedz);
    };
    odwiedz(sf);

    return { statyczne, wHandlerze, pozaHandlerem };
  }

  for (const { plik, sciezka, fabryka } of zrodla) {
    // Adresu nie da się odczytać z obiektu `Route` - `id`/`path` doklepuje
    // dopiero generator drzewa, więc w teście są `undefined`. Adres jest
    // kontraktem PUBLICZNYM (klienci MCP i OAuth mają go zapisanego).
    it(`${plik} rejestruje adres ${sciezka} i handler ANY`, () => {
      const source = readFileSync(plik, "utf8");

      // Bez literału `createFileRoute("…` w źródle TESTU: bramka
      // `staticAssetShadowing` skanuje `src/routes/**` (poza plikami z `-`)
      // i brała szablon `${sciezka}` za trasę przesłanianą przez `public/`.
      expect(source).toContain(`createFileRoute(${JSON.stringify(sciezka)})`);
      expect(source).toContain("ANY:");
    });

    // Drzewo tras SSR importuje KAŻDY plik trasy przy każdym żądaniu. Import
    // górny wciągnąłby SDK (i definicję) do tego grafu, więc awaria
    // inicjalizacji pakietu położyłaby całą witrynę, a nie tylko /mcp.
    it(`${plik} ładuje pakiet i definicję MCP TYLKO przez await import w handlerze`, () => {
      const source = readFileSync(plik, "utf8");
      const { statyczne, wHandlerze, pozaHandlerem } = zaleznosciTrasy(plik, source);

      expect(statyczne).toEqual(["@tanstack/react-router"]);
      // `await import` w zasięgu modułu ładuje pakiet przy imporcie pliku tak
      // samo jak import statyczny - granica liczy się tylko wewnątrz handlera.
      expect(pozaHandlerem).toEqual([]);
      expect(wHandlerze).toEqual([
        "@lovable.dev/mcp-js/stacks/tanstack",
        expect.stringMatching(/^(\.\.\/)+lib\/mcp\/index$/),
      ]);
      expect(source).toContain(fabryka);
    });
  }
});
