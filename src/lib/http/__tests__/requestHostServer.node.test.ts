// @vitest-environment node
//
// SZEW IZOLACJI NAJEMCY - serwerowa połowa płaszczyzny host -> tenant
// (punkt B4 zlecenia `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`).
//
// DLACZEGO TE PLIKI MIAŁY ZERO, I DLACZEGO TO NIE BYŁO LENISTWO. `vitest.config.ts`
// ustawia `environment: "happy-dom"`, więc w domyślnym środowisku `window`
// ISTNIEJE, a `import.meta.env.SSR` jest fałszywe. Obie funkcje wejściowe
// (`currentTenantHost`, `currentTenantAssertion`) wracają wtedy z gałęzi
// PRZEGLĄDARKOWEJ - `requestHost.ts:63` oddaje `window.location.host` i
// dynamiczny import `./requestHost.server` NIGDY się nie wykonuje. Gałąź
// serwerowa była więc nieosiągalna Z DEFINICJI, a nie nieprzetestowana:
// `requestHost.server.ts` 0/16 linii i 0/4 funkcji, `tenantAssertionCookie.server.ts`
// 1/16 linii i 0/2 funkcji. Dyrektywa `// @vitest-environment node` w pierwszej
// linii jest jedyną poprawną drogą (wzorzec obecny w repozytorium 14 razy);
// zmiana globalnego `environment` przewróciłaby 2 218 plików zakładających DOM.
//
// CO STOI NA TYM SZWIE. Klucz cache'u dokumentów jest PREFIKSOWANY HOSTEM
// (`documentCache.ts:179-180`) i to jest cała izolacja NES Edge Cache między
// najemcami. Sama funkcja klucza jest przetestowana wzorowo (43/43 linii),
// ale WARTOŚĆ `host` bierze się stąd. Do tego `@/lib/http/requestHost` jest
// podmieniany na atrapę w 26 plikach testowych całego repozytorium - czyli
// jest to szew, który cała platforma zastępuje stubem, a którego w prawdziwej
// postaci nie sprawdzał nikt.
//
// GAŁĄŹ O KONSEKWENCJI BEZPIECZEŃSTWA, dziś pokryta w przypadku „zejście
// dynamicznego importu": gdy warstwa katalogu jest niedostępna,
// `trustedPublicHost` MUSI wrócić `requestPublicHost(request)` (surowy
// nagłówek), a nie `null`. Ta różnica decyduje, czy nieznany host dostanie
// „brak wskazówki tenanta", czy wartość z nagłówka - i jest jedyną rzeczą,
// która w tym module wygląda jak drobiazg, a nią nie jest.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctl = vi.hoisted(() => ({
  /** Co oddaje `getRequest()`; `throws` wymusza brak kontekstu żądania. */
  request: null as Request | null,
  getRequestThrows: false,
  /** Wynik walidacji hosta wobec `tenants.domain`. */
  trustedHost: null as string | null,
  trustedThrows: false,
  /** Wynik podpisu poświadczenia krawędzi. */
  assertion: null as string | null,
  mintThrows: false,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (ctl.getRequestThrows) throw new Error("No request context available");
    return ctl.request;
  },
}));

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTrustedRequestHost: async () => {
    if (ctl.trustedThrows) throw new Error("tenant directory unavailable");
    return ctl.trustedHost;
  },
}));

vi.mock("@/lib/server/tenantAssertion.server", () => ({
  mintTenantHostAssertion: async () => {
    if (ctl.mintThrows) throw new Error("assertion key missing");
    return ctl.assertion;
  },
}));

/**
 * AWARIA CAŁEGO MODUŁU SERWEROWEGO jako sterowane wejście.
 *
 * `vi.doMock` (nie `vi.mock`) i `vi.resetModules()` PRZED nim - to jest tu
 * istotne, a nie stylistyczne. Fabryka `vi.mock` jest wynoszona i rozwiązywana
 * RAZ na plik, więc flaga czytana w jej wnętrzu nie zmienia nic po pierwszym
 * imporcie: pierwsza wersja tego pliku „zdawała" zejście, mierząc w istocie
 * ścieżkę SUKCESU z `trustedHost === null`. `doMock` rejestruje atrapę dla
 * NASTĘPNYCH importów, a reset rejestru wymusza ponowne wykonanie.
 *
 * Fabryka, która RZUCA, sprawia, że `await import("./requestHost.server")`
 * odrzuca - dokładnie to, co dzieje się w produkcji, gdy warstwa katalogu jest
 * niedostępna (rozgrzewka, brak grafu serwerowego).
 */
async function importWithBrokenServerModule(): Promise<typeof import("../requestHost")> {
  vi.resetModules();
  vi.doMock("../requestHost.server", () => {
    throw new Error("server graph unavailable");
  });
  return await import("../requestHost");
}

function req(host = "nes.example", forwarded?: string): Request {
  const headers = new Headers({ host });
  if (forwarded) headers.set("x-forwarded-host", forwarded);
  return new Request("https://nes.example/en", { headers });
}

beforeEach(() => {
  ctl.request = null;
  ctl.getRequestThrows = false;
  ctl.trustedHost = null;
  ctl.trustedThrows = false;
  ctl.assertion = null;
  ctl.mintThrows = false;
  vi.doUnmock("../requestHost.server");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("../requestHost.server");
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// requestHost.server.ts - cztery funkcje, wszystkie do tej pory bez wywołania
// ---------------------------------------------------------------------------

describe("currentServerHost", () => {
  it("oddaje host ZWALIDOWANY wobec katalogu tenantów, nie surowy nagłówek", async () => {
    const { currentServerHost } = await import("../requestHost.server");
    ctl.request = req("b.example");
    ctl.trustedHost = "b.example";
    await expect(currentServerHost()).resolves.toBe("b.example");
  });

  it("null, gdy `getRequest()` oddaje nic (praca w tle poza żądaniem)", async () => {
    const { currentServerHost } = await import("../requestHost.server");
    ctl.request = null;
    ctl.trustedHost = "b.example";
    await expect(currentServerHost()).resolves.toBeNull();
  });

  it("null, gdy NIE MA kontekstu żądania - `getRequest()` RZUCA", async () => {
    // Gałąź `catch` (`requestHost.server.ts:17-19`). Poza zasięgiem żądania
    // h3 prawdziwy `getRequest` rzuca, a ten moduł nie ma prawa rzucić dalej:
    // wołają go scope'y cache'u i atrybucja `tenant_id`.
    const { currentServerHost } = await import("../requestHost.server");
    ctl.getRequestThrows = true;
    await expect(currentServerHost()).resolves.toBeNull();
  });

  it("null, gdy warstwa katalogu RZUCA - nigdy nie przepuszcza wyjątku", async () => {
    const { currentServerHost } = await import("../requestHost.server");
    ctl.request = req();
    ctl.trustedThrows = true;
    await expect(currentServerHost()).resolves.toBeNull();
  });
});

describe("currentServerAssertion", () => {
  it("podpisuje host już zwalidowany", async () => {
    const { currentServerAssertion } = await import("../requestHost.server");
    ctl.request = req("b.example");
    ctl.trustedHost = "b.example";
    ctl.assertion = "kid.sig";
    await expect(currentServerAssertion()).resolves.toBe("kid.sig");
  });

  it("null BEZ hosta - sfałszowany nagłówek nie zostanie poświadczony", async () => {
    // To jest sedno kontraktu: poświadczenie powstaje WYŁĄCZNIE dla hosta,
    // który przeszedł walidację wobec `tenants.domain`.
    const { currentServerAssertion } = await import("../requestHost.server");
    ctl.request = req("cudza.example");
    ctl.trustedHost = null;
    ctl.assertion = "kid.sig";
    await expect(currentServerAssertion()).resolves.toBeNull();
  });

  it("null, gdy podpisywanie RZUCA (brak klucza wdrożenia)", async () => {
    const { currentServerAssertion } = await import("../requestHost.server");
    ctl.request = req();
    ctl.trustedHost = "nes.example";
    ctl.mintThrows = true;
    await expect(currentServerAssertion()).resolves.toBeNull();
  });
});

describe("assertionForRequest", () => {
  it("podpisuje host JAWNEGO Requestu (middleware, trasy serwerowe)", async () => {
    const { assertionForRequest } = await import("../requestHost.server");
    ctl.trustedHost = "b.example";
    ctl.assertion = "kid.sig-b";
    await expect(assertionForRequest(req("b.example"))).resolves.toBe("kid.sig-b");
  });

  it("null przy braku hosta i null, gdy podpis RZUCA", async () => {
    const { assertionForRequest } = await import("../requestHost.server");
    ctl.trustedHost = null;
    await expect(assertionForRequest(req())).resolves.toBeNull();

    ctl.trustedHost = "nes.example";
    ctl.mintThrows = true;
    await expect(assertionForRequest(req())).resolves.toBeNull();
  });
});

describe("trustedHostFromRequest", () => {
  it("jest cienkim przejściem do walidacji katalogu", async () => {
    const { trustedHostFromRequest } = await import("../requestHost.server");
    ctl.trustedHost = "b.example";
    await expect(trustedHostFromRequest(req("b.example"))).resolves.toBe("b.example");
  });
});

// ---------------------------------------------------------------------------
// requestHost.ts - gałąź SSR obu funkcji wejściowych plus ZEJŚCIE
// ---------------------------------------------------------------------------

describe("trustedPublicHost - gałąź SSR i jej zejście", () => {
  it("na SSR idzie przez moduł serwerowy i oddaje host zwalidowany", async () => {
    const { trustedPublicHost } = await import("../requestHost");
    ctl.trustedHost = "b.example";
    await expect(trustedPublicHost(req("b.example"))).resolves.toBe("b.example");
  });

  it("ZEJŚCIE: gdy moduł serwerowy nie wstaje, oddaje SUROWY nagłówek, nie null", async () => {
    // Gałąź `requestHost.ts:47-51` - o konsekwencji bezpieczeństwa i do
    // 2026-09-12 niesprawdzona. `null` znaczyłoby „brak wskazówki tenanta"
    // i zlałby scope'y cache'u do jednego kubełka; `requestPublicHost`
    // zachowuje wskazówkę, a walidacja wobec `tenants.domain` dzieje się
    // wtedy po stronie bazy. Różnica jest w KTÓRĄ stronę degradujemy.
    // Kontrola: gdyby moduł serwerowy jednak wstał, wynikiem byłby `null`
    // (`ctl.trustedHost`), więc ta asercja odróżnia zejście od sukcesu.
    ctl.trustedHost = null;
    const { trustedPublicHost } = await importWithBrokenServerModule();
    await expect(trustedPublicHost(req("raw.example"))).resolves.toBe("raw.example");
  });

  it("ZEJŚCIE honoruje X-Forwarded-Host przed Host - tak jak `requestPublicHost`", async () => {
    ctl.trustedHost = null;
    const { trustedPublicHost } = await importWithBrokenServerModule();
    await expect(trustedPublicHost(req("origin.internal", "public.example"))).resolves.toBe(
      "public.example",
    );
  });
});

describe("currentTenantHost / currentTenantAssertion - gałąź SSR", () => {
  it("bez `window` schodzi do modułu serwerowego", async () => {
    const mod = await import("../requestHost");
    ctl.request = req("b.example");
    ctl.trustedHost = "b.example";
    ctl.assertion = "kid.sig-b";
    await expect(mod.currentTenantHost()).resolves.toBe("b.example");
    await expect(mod.currentTenantAssertion()).resolves.toBe("kid.sig-b");
  });

  it("null, gdy modułu serwerowego nie da się zaimportować (rozgrzewka, testy)", async () => {
    // Tu kontrolą jest odwrotność: moduł serwerowy, gdyby wstał, oddałby
    // `b.example` i `kid.sig`, więc `null` dowodzi gałęzi `catch`.
    ctl.request = req("b.example");
    ctl.trustedHost = "b.example";
    ctl.assertion = "kid.sig";
    const mod = await importWithBrokenServerModule();
    await expect(mod.currentTenantHost()).resolves.toBeNull();
    await expect(mod.currentTenantAssertion()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tenantAssertionCookie.server.ts - middleware transportu poświadczenia
// ---------------------------------------------------------------------------

type MiddlewareRun = (args: {
  request: Request;
  next: () => Promise<{ response: Response }>;
}) => Promise<{ response: Response }>;

async function runCookieMiddleware(
  request: Request,
  response: Response,
): Promise<{ response: Response }> {
  const { tenantAssertionMiddleware } = await import("../tenantAssertionCookie.server");
  const options = (tenantAssertionMiddleware as unknown as { options: { server: MiddlewareRun } })
    .options;
  return options.server({ request, next: async () => ({ response }) });
}

function htmlResponse(): Response {
  return new Response("<!doctype html><html></html>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("tenantAssertionMiddleware", () => {
  it("dokłada `Set-Cookie` do dokumentu HTML, gdy poświadczenie jest", async () => {
    ctl.trustedHost = "nes.example";
    ctl.assertion = "kid.sig";
    const out = await runCookieMiddleware(req(), htmlResponse());
    const cookie = out.response.headers.get("set-cookie");
    expect(cookie).toContain("nes_tenant_assert=");
  });

  it("NIE dotyka odpowiedzi, która nie jest dokumentem HTML", async () => {
    ctl.trustedHost = "nes.example";
    ctl.assertion = "kid.sig";
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const out = await runCookieMiddleware(req(), json);
    expect(out.response.headers.get("set-cookie")).toBeNull();
    // Ta sama Response, nie kopia: middleware ma być no-opem na tej gałęzi.
    expect(out.response).toBe(json);
  });

  it("NIE psuje dokumentu, gdy moduł podpisujący nie wstaje", async () => {
    // Gałąź `catch` (`tenantAssertionCookie.server.ts:42-46`): brak klucza albo
    // brak kontekstu żądania oznacza dokument BEZ cookie, a nie awarię.
    ctl.trustedHost = "nes.example";
    ctl.assertion = "kid.sig";
    vi.resetModules();
    vi.doMock("../requestHost.server", () => {
      throw new Error("server graph unavailable");
    });
    const html = htmlResponse();
    const out = await runCookieMiddleware(req(), html);
    expect(out.response).toBe(html);
    expect(out.response.headers.get("set-cookie")).toBeNull();
  });

  it("brak poświadczenia = brak cookie, ale dokument wychodzi nietknięty", async () => {
    ctl.trustedHost = null;
    ctl.assertion = null;
    const html = htmlResponse();
    const out = await runCookieMiddleware(req(), html);
    expect(out.response.headers.get("set-cookie")).toBeNull();
    expect(await out.response.text()).toContain("<html>");
  });
});
