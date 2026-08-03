// Kontrakt trasy /.well-known/gpc.json.
//
// Ta trasa JEST oświadczeniem prawnym w formie maszynowej: spec Global Privacy
// Control wymaga, żeby serwis honorujący sygnał wystawił pod tą ścieżką dokument
// `{"gpc": true, "lastUpdate": "YYYY-MM-DD"}`. Bez niej honorowanie sygnału jest
// z zewnątrz niewykrywalne, a przy złym Content-Type albo dodatkowym polu
// walidatory (i rozszerzenia prywatnościowe) uznają deklarację za nieważną -
// dlatego test sprawdza kształt DOKŁADNY, nie „zawiera".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Route } from "./[.well-known]/gpc[.]json";
import { GPC_DECLARATION_LAST_UPDATE, GPC_WELL_KNOWN_PATH } from "@/lib/consent/gpc";
import { PUBLIC_DOCUMENT_DENY_PREFIXES } from "@/lib/http/documentCache";

const ROUTE_FILE = "src/routes/[.well-known]/gpc[.]json.ts";
const ROUTE_TREE = "src/routeTree.gen.ts";

/** Handler GET zarejestrowany przez `createFileRoute`. */
function getHandler(): () => Response {
  const options = Route.options as {
    server?: { handlers?: { GET?: () => Response } };
  };
  const handler = options.server?.handlers?.GET;
  if (!handler) throw new Error("trasa /.well-known/gpc.json nie rejestruje handlera GET");
  return handler;
}

describe("/.well-known/gpc.json", () => {
  // `Route.id` jest wstrzykiwane transformem pluginu routera, więc w teście
  // jednostkowym go nie ma. Ścieżkę sprawdzamy więc u ŹRÓDŁA (deklaracja w
  // pliku trasy) i w wygenerowanym drzewie tras - jeśli plik zostanie
  // przemianowany albo drzewo nie zostanie odświeżone, deklaracja przestanie
  // być pod adresem wymaganym przez spec i bramka to złapie.
  it("is registered under the exact path required by the spec", () => {
    const source = readFileSync(ROUTE_FILE, "utf8");
    expect(source).toContain(`createFileRoute("${GPC_WELL_KNOWN_PATH}")`);
    expect(readFileSync(ROUTE_TREE, "utf8")).toContain(`'${GPC_WELL_KNOWN_PATH}'`);
  });

  it("returns 200 with application/json", () => {
    const response = getHandler()();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("emits exactly {gpc, lastUpdate} - no extra fields", async () => {
    const body = (await getHandler()().json()) as Record<string, unknown>;
    expect(body).toEqual({ gpc: true, lastUpdate: GPC_DECLARATION_LAST_UPDATE });
    expect(Object.keys(body).sort()).toEqual(["gpc", "lastUpdate"]);
  });

  it("declares gpc as a boolean true, not a truthy string", async () => {
    const body = (await getHandler()().json()) as { gpc: unknown };
    expect(body.gpc).toBe(true);
    expect(typeof body.gpc).toBe("boolean");
  });

  it("is shared-cacheable (the declaration is identical for every visitor)", () => {
    const cacheControl = getHandler()().headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).toMatch(/s-maxage=\d+/);
    expect(cacheControl).not.toContain("no-store");
  });

  it("stays outside the NES Edge Cache (not a navigational document)", () => {
    expect(PUBLIC_DOCUMENT_DENY_PREFIXES).toContain("/.well-known");
  });
});
