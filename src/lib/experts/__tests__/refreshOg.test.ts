// Server function „odśwież og:image" profilu autora.
//
// 64 linie, zero wykonanych - ostatni plik `lib/experts` bez testu. Nie
// generuje obrazka (avatar wgrywa użytkownik); bumpuje `profiles.updated_at`,
// bo to z niego bierze się wersja doklejana do og:image (`?v=<epoch>`). Cała
// jego wartość to więc trzy rzeczy, których nie widać w typach:
//
//   1. WERSJA rośnie razem z `updated_at` - gdyby handler zwracał `Date.now()`
//      zamiast czasu z bazy, adres w podglądzie i adres na stronie
//      rozjeżdżałyby się i scraper dostawałby wciąż stary obrazek;
//   2. adresy do sprawdzenia budowane są z ORIGINU ŻĄDANIA, nie ze stałej -
//      inaczej autor na środowisku testowym wysyłałby Facebooka pod produkcję;
//   3. profil bez sluga NIE dostaje adresów - link do nieistniejącej strony
//      w panelu wygląda jak awaria, a nie jak „uzupełnij profil".
//
// PUŁAPKA HARNESSU: `createServerFn` z `@tanstack/react-start` buduje obiekt z
// `.middleware().handler()`. W teście podmieniamy go tak, żeby `.handler(fn)`
// oddawał samą funkcję - dzięki temu wołamy PRAWDZIWY handler z podstawionym
// kontekstem, zamiast testować atrapę własnego wymyślenia.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ requestUrl: "https://neweuropeanstrategies.com/author/anna" }));

vi.mock("@tanstack/react-start", () => {
  const api = {
    middleware: () => api,
    handler: (fn: unknown) => fn,
  };
  return { createServerFn: () => api };
});

vi.mock("@tanstack/react-start/server", () => ({
  getRequestUrl: () => h.requestUrl,
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { refreshAuthorOgImage } = await import("@/lib/experts/refreshOg.functions");

const USER = "11111111-1111-4111-8111-111111111111";

type Handler = (input: {
  context: { supabase: unknown; userId: string };
}) => Promise<import("@/lib/experts/refreshOg.functions").RefreshOgResult>;

const run = refreshAuthorOgImage as unknown as Handler;

let db: ReturnType<typeof supabaseFromStub>;

function client() {
  return { from: db.from };
}

beforeEach(() => {
  db = supabaseFromStub();
  h.requestUrl = "https://neweuropeanstrategies.com/author/anna";
});

describe("refreshAuthorOgImage - bump wersji", () => {
  it("aktualizuje WYŁĄCZNIE wiersz wołającego", async () => {
    // Bez `.eq("id", userId)` polegalibyśmy na samym RLS. To by nawet
    // zadziałało, ale każdy błąd polityki zamieniałby „odśwież mój podgląd"
    // w masowy UPDATE po tabeli profili.
    db.setResponse("profiles", ok({ slug: "anna", updated_at: "2026-08-19T10:00:00.000Z" }));
    await run({ context: { supabase: client(), userId: USER } });

    const chain = db.lastChain("profiles")!;
    expect(chain.argsOf("eq")).toEqual(["id", USER]);
    expect(chain.has("update")).toBe(true);
  });

  it("wersja pochodzi z `updated_at` W BAZIE, nie z zegara procesu", async () => {
    db.setResponse("profiles", ok({ slug: "anna", updated_at: "2026-08-19T10:00:00.000Z" }));
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.version).toBe(Date.parse("2026-08-19T10:00:00.000Z"));
  });

  it("brak `updated_at` nie wywala odpowiedzi - wersja spada na zegar", async () => {
    db.setResponse("profiles", ok({ slug: "anna", updated_at: null }));
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.ok).toBe(true);
    expect(result.version).toBeGreaterThan(0);
  });

  it("zapisywany znacznik czasu jest w ISO - kolumna jest timestamptz", async () => {
    db.setResponse("profiles", ok({ slug: "anna", updated_at: "2026-08-19T10:00:00.000Z" }));
    await run({ context: { supabase: client(), userId: USER } });
    const [patch] = db.lastChain("profiles")!.argsOf("update") as [{ updated_at: string }];
    expect(patch.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });
});

describe("refreshAuthorOgImage - adresy do sprawdzenia", () => {
  beforeEach(() => {
    db.setResponse("profiles", ok({ slug: "anna", updated_at: "2026-08-19T10:00:00.000Z" }));
  });

  it("wersja polska idzie bez prefiksu, angielska z `/en`", async () => {
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.urls).toEqual({
      pl: "https://neweuropeanstrategies.com/author/anna",
      en: "https://neweuropeanstrategies.com/en/author/anna",
    });
  });

  it("origin bierze się z ŻĄDANIA - podgląd nie wysyła scraperów na produkcję", async () => {
    h.requestUrl = "https://staging.example.dev/author/anna?x=1";
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.urls?.pl).toBe("https://staging.example.dev/author/anna");
  });

  it("bez kontekstu żądania spada na adres produkcyjny", async () => {
    // Wywołanie spoza cyklu żądania (np. z kolejki) nie może zbudować
    // adresu `undefined/author/...` i wysłać go do Post Debuggera.
    h.requestUrl = "";
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.urls?.pl).toBe("https://neweuropeanstrategies.com/author/anna");
  });

  it("adresy debuggerów niosą ZAKODOWANY adres strony", async () => {
    const result = await run({ context: { supabase: client(), userId: USER } });
    const encoded = encodeURIComponent("https://neweuropeanstrategies.com/author/anna");
    expect(result.debuggers?.facebook).toContain(encoded);
    expect(result.debuggers?.linkedin).toContain(encoded);
    expect(result.debuggers?.twitter).toContain(encoded);
  });

  it("debuggery wskazują trzy serwisy, w których profil bywa udostępniany", async () => {
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.debuggers?.facebook).toContain("developers.facebook.com");
    expect(result.debuggers?.linkedin).toContain("linkedin.com/post-inspector");
    expect(result.debuggers?.twitter).toContain("cards-dev.twitter.com");
  });

  it("slug ze znakami specjalnymi jest zakodowany w adresie debuggera", async () => {
    db.setResponse("profiles", ok({ slug: "anna kowalska", updated_at: null }));
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result.debuggers?.facebook).toContain("anna%20kowalska");
  });
});

describe("refreshAuthorOgImage - stany brzegowe", () => {
  it("profil BEZ sluga potwierdza bump, ale nie obiecuje adresów", async () => {
    // Autor bez sluga nie ma jeszcze publicznej strony; link do niej w panelu
    // wyglądałby jak nasza awaria.
    db.setResponse("profiles", ok({ slug: null, updated_at: "2026-08-19T10:00:00.000Z" }));
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result).toEqual({ ok: true, version: 0, urls: null, debuggers: null });
  });

  it("brak wiersza to odpowiedź NIEUDANA, a nie cicha zgoda", async () => {
    // RLS może odciąć UPDATE bez błędu (zero zaktualizowanych wierszy).
    // Zwrócenie `ok: true` mówiłoby autorowi, że odświeżył coś, czego nie ma.
    db.setResponse("profiles", ok(null));
    const result = await run({ context: { supabase: client(), userId: USER } });
    expect(result).toEqual({ ok: false, version: 0, urls: null, debuggers: null });
  });

  it("błąd bazy leci wyżej z ORYGINALNYM komunikatem", async () => {
    db.setResponse("profiles", fail("permission denied for table profiles", "42501"));
    await expect(run({ context: { supabase: client(), userId: USER } })).rejects.toThrow(
      "permission denied for table profiles",
    );
  });
});
