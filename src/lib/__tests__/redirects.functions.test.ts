// Server functions menedżera przekierowań (`/admin/redirects`).
//
// CO TO DOWODZI. Reguła przekierowania jest bronią obosieczną: dobrze
// napisana ratuje ranking po migracji, źle napisana wyłącza adres albo staje
// się OTWARTYM PRZEKIEROWANIEM na obcy host (gotowy nośnik phishingu pod
// naszą domeną). Plik miał 0% pokrycia przy czterech warstwach kontraktu,
// z których każda broni przed czymś innym:
//   1. `requireStaff` - kto może pisać reguły;
//   2. walidacja Zod - co wolno wpisać;
//   3. limit na użytkownika - ile razy (import CSV to 10 wywołań na okno);
//   4. wpis do `audit_log` - kto to zrobił, gdy trzeba będzie odtworzyć.
// Każda jest tu sprawdzona OSOBNO, bo każda może zniknąć osobno.
//
// TEST PARYTETU. Normalizacja ścieżek ma JEDNĄ implementację w
// `@/lib/seo/redirects` i muszą ją rozumieć identycznie trzy strony: panel
// admina, import CSV i middleware serwujące. Dlatego parytet jest tu
// sprawdzony przez PORÓWNANIE tego, co handler zapisał, z tym, co dla tego
// samego wejścia zwraca współdzielony helper - a nie przez powtórzenie tabeli
// normalizacji. Rozjazd oznaczałby regułę, która w panelu wygląda inaczej niż
// przy serwowaniu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `normalizeSourcePath`, `normalizeTargetPath`, `matchRedirect`,
//     `parseRedirectsCsv` mają wyczerpujące testy w
//     `src/lib/seo/__tests__/redirects.test.ts` (87% instrukcji), w tym
//     strażnik otwartego przekierowania, pętle, 410 i wieloznaczniki. Tutaj
//     interesuje nas WYŁĄCZNIE to, że handlery ich UŻYWAJĄ;
//   * autoryzacji. Atrapa `createServerFn` świadomie NIE URUCHAMIA middleware
//     (patrz nagłówek `src/test/serverFn.ts`), więc zieleń tego pliku mówi „co
//     robi handler", nie „kto się dostanie". Deklarację `requireStaff`
//     sprawdzamy strukturalnie przez `serverFnMeta()`, a jej egzekwowanie
//     pilnuje bramka `check:authz-snapshot` i RLS pokryty pgTAP-em.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asSpec, callServerFn } from "@/test/serverFn";
import { ok, supabaseFromStub } from "@/test/supabaseChain";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

/** Znacznik middleware - atrapa go nie uruchamia, tylko zapisuje. */
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: { id: "requireStaff" } }));

const harness = vi.hoisted(() => ({
  /** Czy limit przepuszcza. `false` = przekroczony. */
  rateLimitOk: true,
  rateLimitCalls: [] as Array<{ scope: string; subjectId: string; max: number }>,
  audits: [] as Array<Record<string, unknown>>,
  /** Domeny najemców - lista dozwolonych hostów celu. */
  domains: ["neweuropeanstrategies.com"] as string[],
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: (args: { scope: string; subjectId: string; max: number }) => {
    harness.rateLimitCalls.push(args);
    return Promise.resolve(harness.rateLimitOk);
  },
}));

vi.mock("@/lib/server/audit.server", () => ({
  recordAudit: (_client: unknown, entry: Record<string, unknown>) => {
    harness.audits.push(entry);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/server/tenant.server", () => ({
  getTenantDirectory: () =>
    Promise.resolve({ byDomain: new Map(harness.domains.map((d) => [d, { id: "t1" }])) }),
}));

import { normalizeSourcePath, normalizeTargetPath } from "@/lib/seo/redirects";
import {
  deleteRedirects,
  dismissSeo404,
  importRedirectsCsv,
  toggleRedirects,
  upsertRedirect,
} from "../redirects.functions";

const stub = supabaseFromStub();
const USER = "11111111-1111-4111-8111-111111111111";
const REDIRECT_ID = "22222222-2222-4222-8222-222222222222";

/** Domyślny stan: profil zwraca tenanta, zapisy się udają. */
function seedHappyPath(): void {
  stub.setResponse("profiles", ok({ tenant_id: "t1" }));
  // Responder ZALEŻNY OD ŁAŃCUCHA: ścieżka tworzenia kończy się `.single()`
  // i czyta `inserted.id`, a ścieżka aktualizacji czyta DŁUGOŚĆ tablicy
  // z `.select("id")`. Jedna sztywna odpowiedź obsłużyłaby tylko jedną z nich
  // i druga „przechodziłaby" na `undefined`.
  stub.setResponse("redirects", (chain) =>
    chain.has("single") ? ok({ id: REDIRECT_ID }) : ok([{ id: REDIRECT_ID }]),
  );
  stub.setResponse("seo_404_hits", ok(null));
}

function fields(over: Record<string, unknown> = {}) {
  return {
    source_path: "/stary-adres",
    target_path: "/nowy-adres",
    status_code: 301,
    is_enabled: true,
    ...over,
  };
}

/** Kontekst, jaki middleware wstrzyknęłoby handlerowi w produkcji. */
function ctx() {
  return { supabase: { from: (t: string) => stub.from(t) }, userId: USER };
}

beforeEach(() => {
  stub.reset();
  harness.rateLimitOk = true;
  harness.rateLimitCalls = [];
  harness.audits = [];
  harness.domains = ["neweuropeanstrategies.com"];
  seedHappyPath();
});

describe("warstwa 1: deklaracja middleware", () => {
  const FUNKCJE = [
    { nazwa: "upsertRedirect", fn: upsertRedirect },
    { nazwa: "toggleRedirects", fn: toggleRedirects },
    { nazwa: "deleteRedirects", fn: deleteRedirects },
    { nazwa: "importRedirectsCsv", fn: importRedirectsCsv },
    { nazwa: "dismissSeo404", fn: dismissSeo404 },
  ] as const;

  it("bramka widzi wszystkie funkcje - kanarek zasięgu", () => {
    // Bez tego asercje niżej mogłyby przejść na pustej liście.
    expect(FUNKCJE).toHaveLength(5);
  });

  it.each(FUNKCJE)("$nazwa deklaruje `requireStaff` i walidator, metodą POST", ({ fn }) => {
    // Atrapa NIE uruchamia middleware, więc to jest asercja STRUKTURALNA:
    // dowodzi deklaracji, nie egzekwowania (egzekwowanie: check:authz-snapshot).
    const spec = asSpec(fn);
    expect(spec.method).toBe("POST");
    expect(typeof spec.validator).toBe("function");
    expect(spec.middleware).toEqual([{ id: "requireStaff" }]);
  });
});

describe("warstwa 2: walidacja Zod", () => {
  it.each([
    { nazwa: "puste źródło", input: { fields: fields({ source_path: "" }) } },
    {
      nazwa: "źródło ponad 2048 znaków",
      input: { fields: fields({ source_path: "/".padEnd(2049, "a") }) },
    },
    {
      nazwa: "cel ponad 2048 znaków",
      input: { fields: fields({ target_path: "/".padEnd(2049, "a") }) },
    },
    { nazwa: "status niecałkowity", input: { fields: fields({ status_code: 301.5 }) } },
    { nazwa: "status jako tekst", input: { fields: fields({ status_code: "301" }) } },
    { nazwa: "identyfikator nie-UUID", input: { id: "nie-uuid", fields: fields() } },
    { nazwa: "notatka ponad 500 znaków", input: { fields: fields({ note: "x".repeat(501) }) } },
    { nazwa: "brak pola fields", input: {} },
  ])("upsertRedirect odrzuca: $nazwa", async ({ input }) => {
    await expect(callServerFn(upsertRedirect, input, ctx())).rejects.toThrow();
    // Odrzucenie MUSI nastąpić przed jakimkolwiek zapytaniem.
    expect(stub.chains).toEqual([]);
  });

  it.each([
    { nazwa: "pusta lista identyfikatorów", input: { ids: [], is_enabled: true } },
    {
      nazwa: "ponad 500 identyfikatorów",
      input: { ids: Array(501).fill(REDIRECT_ID), is_enabled: true },
    },
    { nazwa: "identyfikator nie-UUID", input: { ids: ["abc"], is_enabled: true } },
    { nazwa: "brak flagi", input: { ids: [REDIRECT_ID] } },
  ])("toggleRedirects odrzuca: $nazwa", async ({ input }) => {
    await expect(callServerFn(toggleRedirects, input, ctx())).rejects.toThrow();
    expect(stub.chains).toEqual([]);
  });

  it("importRedirectsCsv odrzuca pusty i przerośnięty wsad", async () => {
    await expect(callServerFn(importRedirectsCsv, { csv: "" }, ctx())).rejects.toThrow();
    await expect(
      callServerFn(importRedirectsCsv, { csv: "a".repeat(2_000_001) }, ctx()),
    ).rejects.toThrow();
    expect(stub.chains).toEqual([]);
  });

  it("wartości domyślne walidatora są stosowane", async () => {
    // `target_path` domyślnie "/", `is_enabled` domyślnie true - reguła bez
    // tych pól musi się zapisać, a nie wywalić.
    await callServerFn(
      upsertRedirect,
      {
        fields: { source_path: "/stary", status_code: 301 },
      },
      ctx(),
    );
    const zapis = stub.lastChain("redirects");
    expect(zapis?.argsOf("upsert")?.[0]).toMatchObject({ target_path: "/", is_enabled: true });
  });
});

describe("warstwa 3: limit na użytkownika", () => {
  it.each([
    {
      nazwa: "upsertRedirect",
      scope: "redirect.upsert",
      max: 120,
      call: () => callServerFn(upsertRedirect, { fields: fields() }, ctx()),
    },
    {
      nazwa: "toggleRedirects",
      scope: "redirect.toggle",
      max: 60,
      call: () => callServerFn(toggleRedirects, { ids: [REDIRECT_ID], is_enabled: false }, ctx()),
    },
    {
      nazwa: "deleteRedirects",
      scope: "redirect.delete",
      max: 60,
      call: () => callServerFn(deleteRedirects, { ids: [REDIRECT_ID] }, ctx()),
    },
    {
      nazwa: "importRedirectsCsv",
      scope: "redirect.import",
      max: 10,
      call: () => callServerFn(importRedirectsCsv, { csv: "/a,/b,301\n" }, ctx()),
    },
    {
      nazwa: "dismissSeo404",
      scope: "redirect.dismiss404",
      max: 60,
      call: () => callServerFn(dismissSeo404, { paths: ["/x"] }, ctx()),
    },
  ])("$nazwa pyta o limit w zakresie $scope z progiem $max", async ({ scope, max, call }) => {
    await call();
    expect(harness.rateLimitCalls).toContainEqual({ scope, subjectId: USER, max });
  });

  it("przekroczony limit przerywa PRZED rozwiązaniem tenanta", async () => {
    // To jest sedno: limit ma chronić bazę, więc nie może się liczyć PO tym,
    // jak zapytania już poszły.
    harness.rateLimitOk = false;
    await expect(callServerFn(upsertRedirect, { fields: fields() }, ctx())).rejects.toThrow(
      /Rate limit exceeded/,
    );
    expect(stub.chains).toEqual([]);
    expect(harness.audits).toEqual([]);
  });

  it("limit jest liczony per UŻYTKOWNIK, nie globalnie", async () => {
    await callServerFn(upsertRedirect, { fields: fields() }, ctx());
    expect(harness.rateLimitCalls[0].subjectId).toBe(USER);
  });
});

describe("warstwa 4: wpis do audit_log", () => {
  it("utworzenie reguły zapisuje `redirect.create` ze ścieżką źródłową", async () => {
    await callServerFn(upsertRedirect, { fields: fields() }, ctx());
    expect(harness.audits).toEqual([
      {
        tenantId: "t1",
        action: "redirect.create",
        entityType: "redirect",
        entityId: REDIRECT_ID,
        metadata: { source_path: "/stary-adres" },
      },
    ]);
  });

  it("aktualizacja zapisuje `redirect.update` z identyfikatorem reguły", async () => {
    await callServerFn(upsertRedirect, { id: REDIRECT_ID, fields: fields() }, ctx());
    expect(harness.audits[0]).toMatchObject({
      action: "redirect.update",
      entityId: REDIRECT_ID,
    });
  });

  it("przełączenie hurtowe zapisuje listę identyfikatorów i nowy stan", async () => {
    await callServerFn(toggleRedirects, { ids: [REDIRECT_ID], is_enabled: false }, ctx());
    expect(harness.audits[0]).toMatchObject({
      action: "redirect.update",
      entityId: null,
      metadata: { ids: [REDIRECT_ID], is_enabled: false },
    });
  });

  it("usunięcie zapisuje LICZBĘ reguł", async () => {
    await callServerFn(deleteRedirects, { ids: [REDIRECT_ID, REDIRECT_ID] }, ctx());
    expect(harness.audits[0]).toMatchObject({
      action: "redirect.delete",
      metadata: { count: 2 },
    });
  });

  it("import zapisuje liczbę wpisów i liczbę problemów", async () => {
    await callServerFn(importRedirectsCsv, { csv: "/a,/b,301\n/c,/d,302\n" }, ctx());
    expect(harness.audits[0]).toMatchObject({
      action: "redirect.import",
      metadata: { imported: 2, issues: 0 },
    });
  });

  it("odrzucony zapis NIE zostawia wpisu w audycie", async () => {
    // Audyt kłamiący o zmianie, której nie było, jest gorszy niż brak audytu.
    stub.setResponse("redirects", { data: null, error: new Error("odmowa RLS") });
    await expect(callServerFn(upsertRedirect, { fields: fields() }, ctx())).rejects.toThrow();
    expect(harness.audits).toEqual([]);
  });

  it("`dismissSeo404` świadomie NIE audytuje - to porządkowanie, nie zmiana reguł", async () => {
    // Przypięte jako stan faktyczny: monitor 404 to lista zgłoszeń, a nie
    // konfiguracja, więc jej czyszczenie nie trafia do audytu.
    await callServerFn(dismissSeo404, { paths: ["/x"] }, ctx());
    expect(harness.audits).toEqual([]);
  });
});

describe("parytet z współdzielonym rdzeniem normalizacji", () => {
  const WEJSCIA = [
    { source: "/Stary-Adres/", target: "/Nowy-Adres/" },
    { source: "/a//b", target: "b/c" },
    { source: "/szukaj?q=1", target: "/wyniki" },
    { source: "/dzial/*", target: "/nowy-dzial" },
    { source: "/śledztwa", target: "/analizy" },
    { source: "/x", target: "https://neweuropeanstrategies.com/y" },
  ] as const;

  it.each(WEJSCIA)(
    "handler zapisuje DOKŁADNIE to, co zwraca wspólny helper ($source -> $target)",
    async ({ source, target }) => {
      // Rozjazd tutaj znaczy, że panel zapisuje regułę w innej postaci, niż
      // rozumie ją middleware serwujące - reguła wygląda poprawnie i nie działa.
      await callServerFn(
        upsertRedirect,
        {
          fields: fields({ source_path: source, target_path: target }),
        },
        ctx(),
      );
      const zapis = stub.lastChain("redirects")?.argsOf("upsert")?.[0];
      expect(zapis).toMatchObject({
        source_path: normalizeSourcePath(source),
        target_path: normalizeTargetPath(target, harness.domains),
      });
    },
  );

  it("import CSV normalizuje ścieżki tą samą regułą co panel", async () => {
    // Trzecia strona parytetu: to samo wejście przez import musi dać ten sam
    // wiersz co przez panel.
    await callServerFn(importRedirectsCsv, { csv: "/Stary-Adres/,/Nowy-Adres/,301\n" }, ctx());
    const wsad = stub.lastChain("redirects")?.argsOf("upsert")?.[0];
    expect(Array.isArray(wsad) ? wsad[0] : wsad).toMatchObject({
      source_path: normalizeSourcePath("/Stary-Adres/"),
      target_path: normalizeTargetPath("/Nowy-Adres/", harness.domains),
    });
  });

  it("cel na OBCYM hoście jest odrzucony - strażnik otwartego przekierowania", async () => {
    // Reguła przekierowania nie może stać się nośnikiem phishingu pod naszą
    // domeną. Dowód szczegółowy jest w testach helpera; tu dowodzimy, że
    // handler ten helper respektuje.
    await expect(
      callServerFn(
        upsertRedirect,
        {
          fields: fields({ target_path: "https://zlodziej.example/phish" }),
        },
        ctx(),
      ),
    ).rejects.toThrow(/Invalid target path/);
    expect(stub.chainsFor("redirects")).toEqual([]);
  });

  it("niepoprawne źródło jest odrzucone przed zapisem", async () => {
    await expect(
      callServerFn(upsertRedirect, { fields: fields({ source_path: "/a/*/b" }) }, ctx()),
    ).rejects.toThrow(/Invalid source path/);
    expect(stub.chainsFor("redirects")).toEqual([]);
  });
});

describe("reguły domenowe zapisu", () => {
  it.each([301, 302, 307, 308, 410])("status %s jest przyjmowany", async (status_code) => {
    await callServerFn(upsertRedirect, { fields: fields({ status_code }) }, ctx());
    expect(stub.lastChain("redirects")?.argsOf("upsert")?.[0]).toMatchObject({ status_code });
  });

  it.each([200, 404, 500, 0, -301, 999])("status %s jest odrzucany", async (status_code) => {
    await expect(
      callServerFn(upsertRedirect, { fields: fields({ status_code }) }, ctx()),
    ).rejects.toThrow(/Invalid status code/);
    expect(stub.chainsFor("redirects")).toEqual([]);
  });

  it("410 Gone dostaje zastępczy cel `/` - nie potrzebuje sensownego celu", async () => {
    await callServerFn(
      upsertRedirect,
      {
        fields: { source_path: "/usuniete", target_path: "", status_code: 410 },
      },
      ctx(),
    );
    expect(stub.lastChain("redirects")?.argsOf("upsert")?.[0]).toMatchObject({
      status_code: 410,
      target_path: "/",
    });
  });

  it("PRZEKIEROWANIE NA SIEBIE SAMEGO jest odrzucone", async () => {
    // Reguła `/a -> /a` to nieskończona pętla w przeglądarce i u crawlera.
    await expect(
      callServerFn(
        upsertRedirect,
        {
          fields: fields({ source_path: "/petla", target_path: "/petla" }),
        },
        ctx(),
      ),
    ).rejects.toThrow(/cannot point at itself/);
    expect(stub.chainsFor("redirects")).toEqual([]);
  });

  it("pętla na siebie jest wykrywana PO normalizacji, nie przed", async () => {
    // `/Petla/` i `/petla` to ta sama ścieżka po normalizacji - porównanie
    // surowych napisów przepuściłoby tę pętlę.
    await expect(
      callServerFn(
        upsertRedirect,
        {
          fields: fields({ source_path: "/Petla/", target_path: "/petla" }),
        },
        ctx(),
      ),
    ).rejects.toThrow(/cannot point at itself/);
  });

  it("notatka jest obcinana, a puste białe znaki zapisywane jako null", async () => {
    await callServerFn(upsertRedirect, { fields: fields({ note: "   " }) }, ctx());
    expect(stub.lastChain("redirects")?.argsOf("upsert")?.[0]).toMatchObject({ note: null });
  });

  it("aktualizacja zawęża zapis do tenanta ORAZ identyfikatora", async () => {
    // Bez filtru najemcy edycja mogłaby ruszyć regułę innego serwisu.
    await callServerFn(upsertRedirect, { id: REDIRECT_ID, fields: fields() }, ctx());
    const chain = stub.lastChain("redirects");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", REDIRECT_ID],
      ["tenant_id", "t1"],
    ]);
  });

  it("aktualizacja nieistniejącej reguły daje jawny błąd, nie ciche `ok`", async () => {
    // Puste `updated` znaczy „nie ma takiej reguły ALBO nie twój tenant".
    // Ciche powodzenie zostawiłoby operatora z przekonaniem, że zapisał.
    stub.setResponse("redirects", ok([]));
    await expect(
      callServerFn(upsertRedirect, { id: REDIRECT_ID, fields: fields() }, ctx()),
    ).rejects.toThrow(/not found or access denied/);
    expect(harness.audits).toEqual([]);
  });

  it.each([
    {
      nazwa: "toggleRedirects",
      call: () => callServerFn(toggleRedirects, { ids: [REDIRECT_ID], is_enabled: true }, ctx()),
    },
    {
      nazwa: "deleteRedirects",
      call: () => callServerFn(deleteRedirects, { ids: [REDIRECT_ID] }, ctx()),
    },
    { nazwa: "dismissSeo404", call: () => callServerFn(dismissSeo404, { paths: ["/x"] }, ctx()) },
  ])("$nazwa zawęża operację do tenanta", async ({ call }) => {
    await call();
    const chain = stub.chains[stub.chains.length - 1];
    expect(chain.calls.some((c) => c.method === "eq" && c.args[0] === "tenant_id")).toBe(true);
  });

  it("brak tenanta u użytkownika przerywa PRZED zapisem", async () => {
    stub.setResponse("profiles", ok(null));
    await expect(callServerFn(upsertRedirect, { fields: fields() }, ctx())).rejects.toThrow(
      /No tenant for current user/,
    );
    expect(stub.chainsFor("redirects")).toEqual([]);
    expect(harness.audits).toEqual([]);
  });

  it("błąd odczytu profilu przerywa PRZED zapisem", async () => {
    stub.setResponse("profiles", { data: null, error: new Error("odmowa") });
    await expect(callServerFn(upsertRedirect, { fields: fields() }, ctx())).rejects.toThrow(
      /No tenant for current user/,
    );
    expect(stub.chainsFor("redirects")).toEqual([]);
  });
});

describe("import CSV", () => {
  it("wsad bez ani jednego poprawnego wiersza NIE dotyka bazy", async () => {
    const wynik = await callServerFn<{ imported: number; issues: unknown[] }>(
      importRedirectsCsv,
      {
        csv: "to,nie,jest,przekierowanie\n",
      },
      ctx(),
    );
    expect(wynik.imported).toBe(0);
    expect(stub.chainsFor("redirects")).toEqual([]);
    // Brak wpisu w audycie: nic się nie zmieniło.
    expect(harness.audits).toEqual([]);
  });

  it("zwraca listę problemów obok liczby zaimportowanych", async () => {
    // Operator musi wiedzieć, KTÓRE wiersze wypadły - inaczej import „się udał",
    // a połowa reguł nie istnieje.
    const wynik = await callServerFn<{ imported: number; issues: unknown[] }>(
      importRedirectsCsv,
      {
        csv: "/a,/b,301\n,,\n/c,https://zlodziej.example/x,301\n",
      },
      ctx(),
    );
    expect(wynik.imported).toBeGreaterThan(0);
    expect(wynik.issues.length).toBeGreaterThan(0);
  });

  it("dzieli wsad na paczki po 500 wierszy", async () => {
    // Jedno zapytanie z 1200 wierszami przekracza rozsądny rozmiar statementu.
    const csv = Array.from({ length: 1_200 }, (_, i) => `/stary-${i},/nowy-${i},301`).join("\n");
    const wynik = await callServerFn<{ imported: number }>(importRedirectsCsv, { csv }, ctx());
    expect(wynik.imported).toBe(1_200);
    expect(stub.chainsFor("redirects")).toHaveLength(3);
  });

  it("błąd w PIERWSZEJ paczce przerywa import i nie audytuje", async () => {
    stub.setResponse("redirects", { data: null, error: new Error("naruszenie ograniczenia") });
    await expect(callServerFn(importRedirectsCsv, { csv: "/a,/b,301\n" }, ctx())).rejects.toThrow(
      /naruszenie ograniczenia/,
    );
    expect(harness.audits).toEqual([]);
  });

  it("wiersze wchodzą jako `csv_import` z autorem - do odróżnienia od ręcznych", async () => {
    await callServerFn(importRedirectsCsv, { csv: "/a,/b,301\n" }, ctx());
    const wsad = stub.lastChain("redirects")?.argsOf("upsert")?.[0];
    expect(Array.isArray(wsad) ? wsad[0] : wsad).toMatchObject({
      source: "csv_import",
      created_by: USER,
      tenant_id: "t1",
      is_enabled: true,
    });
  });

  it("konflikt rozstrzygany po parze (tenant, ścieżka źródłowa)", async () => {
    // Bez tego powtórny import tworzyłby duplikaty reguł dla tego samego adresu.
    await callServerFn(importRedirectsCsv, { csv: "/a,/b,301\n" }, ctx());
    expect(stub.lastChain("redirects")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "tenant_id,source_path",
    });
  });
});
