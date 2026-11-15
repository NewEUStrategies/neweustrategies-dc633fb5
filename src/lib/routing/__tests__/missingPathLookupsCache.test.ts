// @vitest-environment node
//
// Odczyty zapasowe adresu bez treści a PAMIĘĆ IZOLATU.
//
// CO TO DOWODZI. `missingPathLookups.test.ts` obok sprawdza, które zapytania
// idą i jak składa się wynik - na przezroczystym cache'u. Tu magazyn jest
// PRAWDZIWY (`edgeTtlCache`, środowisko node = gałąź serwerowa), bo przedmiotem
// dowodu jest to, co w nim zostaje po 404:
//   * powtórzone 404 tego samego adresu w tym samym izolacie nie idzie do bazy
//     (dotąd każde powtórzenie płaciło dwa zapytania o taksonomię);
//   * błąd bazy NIE jest zapamiętywany jako „nie znaleziono";
//   * po TTL odpowiedź negatywna nie jest oddawana „od ręki" - adres
//     opublikowany w międzyczasie przestaje być 404 najpóźniej po TTL;
//   * wpis jest JEDEN na adres i należy do hosta żądania.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const stub = supabaseFromStub();

const harness = vi.hoisted(() => ({
  host: "przyklad.test" as string | null,
  legacyPath: null as string | null,
  legacyError: null as Error | null,
  legacySlugs: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(harness.host),
}));

vi.mock("../legacyPostPath", () => ({
  fetchLegacyPostPath: async (slug: string) => {
    harness.legacySlugs.push(slug);
    if (harness.legacyError) throw harness.legacyError;
    return harness.legacyPath;
  },
}));

import { clearEdgeTtlCache } from "@/lib/ssrCache";

import { lookupMissingPath, MISSING_PATH_TTL_MS } from "../missingPathLookups";

const NIC = { categorySlug: null, tagSlug: null, legacyPostPath: null };

/** Liczba round-tripów fali: zapytania o taksonomię plus odczyt starego adresu. */
function roundTrips(): number {
  return stub.chains.length + harness.legacySlugs.length;
}

beforeEach(() => {
  clearEdgeTtlCache();
  stub.reset();
  harness.host = "przyklad.test";
  harness.legacyPath = null;
  harness.legacyError = null;
  harness.legacySlugs = [];
  stub.setResponse("categories", ok(null));
  stub.setResponse("tags", ok(null));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("lookupMissingPath - pamięć izolatu", () => {
  it("powtórzone 404 tego samego adresu nie kosztuje ani jednego zapytania", async () => {
    await expect(lookupMissingPath(["nie-ma"])).resolves.toEqual(NIC);
    expect(roundTrips()).toBe(3);
    await expect(lookupMissingPath(["nie-ma"])).resolves.toEqual(NIC);
    await expect(lookupMissingPath(["nie-ma"])).resolves.toEqual(NIC);
    expect(roundTrips()).toBe(3);
  });

  it("równoległe żądania tego samego adresu dzielą jedną falę", async () => {
    const [a, b] = await Promise.all([
      lookupMissingPath(["nie-ma"]),
      lookupMissingPath(["nie-ma"]),
    ]);
    expect(a).toEqual(NIC);
    expect(b).toEqual(NIC);
    expect(roundTrips()).toBe(3);
  });

  it("adresy wielosegmentowe z tym samym ostatnim segmentem dzielą jeden wpis, goły slug ma osobny", async () => {
    await lookupMissingPath(["stara-sekcja", "atom"]);
    await lookupMissingPath(["inna-sekcja", "atom"]);
    // Tylko odczyt wpisu, raz - bez taksonomii.
    expect(stub.chains).toEqual([]);
    expect(harness.legacySlugs).toEqual(["atom"]);
    // Goły slug pyta DODATKOWO o archiwa, więc nie może odziedziczyć wpisu
    // fali bez taksonomii (zgubiłby przekierowanie na kategorię).
    stub.setResponse("categories", ok({ slug: "atom" }));
    await expect(lookupMissingPath(["atom"])).resolves.toEqual({
      categorySlug: "atom",
      tagSlug: null,
      legacyPostPath: null,
    });
  });

  it("błędu bazy NIE zapamiętuje: następne żądanie pyta ponownie i dostaje prawdziwy wynik", async () => {
    stub.setResponse("tags", fail("połączenie zerwane", "PGRST000"));
    await expect(lookupMissingPath(["atom"])).resolves.toEqual(NIC);
    expect(roundTrips()).toBe(3);

    // Baza wróciła - ten sam izolat, ten sam adres, bez czekania na TTL.
    stub.setResponse("tags", ok({ slug: "atom" }));
    await expect(lookupMissingPath(["atom"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: "atom",
      legacyPostPath: null,
    });
    expect(roundTrips()).toBe(6);
  });

  it("błędu odczytu starego adresu wpisu też nie zapamiętuje", async () => {
    harness.legacyError = new Error("statement timeout");
    await expect(lookupMissingPath(["sekcja", "atom"])).resolves.toEqual(NIC);
    harness.legacyError = null;
    harness.legacyPath = "analizy/atom";
    await expect(lookupMissingPath(["sekcja", "atom"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: null,
      legacyPostPath: "analizy/atom",
    });
  });

  it("po TTL nie oddaje starej odpowiedzi negatywnej: adres opublikowany w międzyczasie przestaje być 404", async () => {
    vi.useFakeTimers();
    await expect(lookupMissingPath(["nowy-wpis"])).resolves.toEqual(NIC);

    // Publikacja wpisu pod tym slugiem - w izolacie wciąż leży „nie ma".
    harness.legacyPath = "analizy/nowy-wpis";
    vi.advanceTimersByTime(MISSING_PATH_TTL_MS - 1);
    await expect(lookupMissingPath(["nowy-wpis"])).resolves.toEqual(NIC);

    // Minął TTL: żadnego serve-stale, pierwsze żądanie po nim widzi wpis.
    vi.advanceTimersByTime(1);
    await expect(lookupMissingPath(["nowy-wpis"])).resolves.toEqual({
      categorySlug: null,
      tagSlug: null,
      legacyPostPath: "analizy/nowy-wpis",
    });
  });

  it("wynik należy do hosta żądania: ten sam slug na innym hoście pyta własną bazę", async () => {
    harness.host = "a.example";
    stub.setResponse("categories", ok({ slug: "energia" }));
    await expect(lookupMissingPath(["energia"])).resolves.toMatchObject({
      categorySlug: "energia",
    });

    harness.host = "b.example";
    stub.setResponse("categories", ok(null));
    await expect(lookupMissingPath(["energia"])).resolves.toEqual(NIC);

    harness.host = "a.example";
    await expect(lookupMissingPath(["energia"])).resolves.toMatchObject({
      categorySlug: "energia",
    });
    // Dwie fale (po jednej na host), trzecie wywołanie z pamięci hosta A.
    expect(roundTrips()).toBe(6);
  });
});
