// NAPRAWCZA PARTIA AUTOMATYCZNYCH ODZNAK (krok crona społeczności).
//
// CO TU JEST STAWKĄ. Odznaki profilowe nadają triggery zaraz po aktywności,
// a ta funkcja domyka to, czego trigger nie widzi: zdarzenia zależne od CZASU
// i importy wstawiane hurtem. Jeśli przebieg cichnie - RPC odmawia, a funkcja
// oddaje „granted: 0" jak przy pustej kolejce - odznaki po prostu przestają
// być nadawane. Nikt tego nie zgłosi, bo brak odznaki wygląda dokładnie tak
// samo jak brak zasług. Dlatego dwa kontrakty mają tu osobne asercje:
//   1. BŁĄD RPC MUSI LECIEĆ DALEJ (cron zapisuje nieudany przebieg),
//   2. `p_limit` musi być liczbą PRZYCIĘTĄ do [1, 1000] - to jedyna bariera
//      między pomyłką wywołującego a skanem całej tabeli profili.
//
// CO JEST ATRAPOWANE I DLACZEGO. Wyłącznie `@/integrations/supabase/client.server`,
// bo to granica procesu (klucz serwisowy, omijanie RLS). Atrapa zapisuje nazwę
// RPC i argumenty - i to samo w sobie jest dowodem, że funkcja sięga po klienta
// SERWEROWEGO: gdyby użyła klienta anonimowego, atrapa nie zostałaby wywołana
// i asercje na argumentach padłyby.
//
// GRANICA DOWODU. Sama logika nadawania odznak („komu i za co") mieszka
// w `reconcile_due_profile_badges` i jej dowodem są migracje
// (`20260803113000_profile_badge_domain_sync.sql`) oraz testy pgTAP
// (`supabase/tests/community_reputation_test.sql`). Tutaj dowodzimy WYŁĄCZNIE
// obudowy wywołania. Wiązania tej funkcji z trasą crona dowodzi
// `src/routes/api/public/-community-cron.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  result: { data: null, error: null } as SupabaseResult,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: unknown) => {
      h.calls.push({ fn, args });
      return Promise.resolve(h.result);
    },
  },
}));

import { reconcileReputationBadges } from "./reputationBadges.server";

/** Argumenty jedynego wywołania RPC - z kontrolą, że w ogóle nastąpiło. */
function rpcArgs(): Record<string, unknown> {
  expect(h.calls).toHaveLength(1);
  const args = h.calls[0].args;
  if (typeof args !== "object" || args === null) throw new Error("RPC bez argumentów");
  return { ...args } as Record<string, unknown>;
}

beforeEach(() => {
  h.calls.length = 0;
  h.result = { data: null, error: null };
});

describe("wywołanie RPC - co naprawdę idzie do bazy", () => {
  it("woła reconcile_due_profile_badges z domyślnym limitem 250", async () => {
    h.result = ok(3);

    const out = await reconcileReputationBadges();

    expect(h.calls[0].fn).toBe("reconcile_due_profile_badges");
    expect(rpcArgs()).toEqual({ p_limit: 250 });
    expect(out.scannedLimit).toBe(250);
  });

  it("przekazuje jawny limit bez zmiany, gdy mieści się w zakresie", async () => {
    h.result = ok(0);

    const out = await reconcileReputationBadges(42);

    expect(rpcArgs()).toEqual({ p_limit: 42 });
    expect(out.scannedLimit).toBe(42);
  });
});

describe("przycięcie limitu do [1, 1000] - argument RPC i zwrotka są zgodne", () => {
  // Tabela przypadków wokół obu krańców. Limit poniżej 1 zamieniony na 0 albo
  // liczbę ujemną to przebieg, który NIE SKANUJE NICZEGO i nadal melduje
  // sukces; limit bez górnego przycięcia to skan całej tabeli profili
  // w jednym wywołaniu crona.
  it.each<[string, number, number]>([
    ["zero nie może wyłączyć skanu", 0, 1],
    ["liczba ujemna", -5, 1],
    ["dokładnie dolny kraniec", 1, 1],
    ["ułamek poniżej 1 (Math.trunc, potem dolny kraniec)", 0.9, 1],
    ["ułamek 1.9 obcięty do 1, nie zaokrąglony do 2", 1.9, 1],
    ["ułamek 250.7 obcięty w dół", 250.7, 250],
    ["dokładnie górny kraniec", 1000, 1000],
    ["górny kraniec + 1", 1001, 1000],
    ["grubo ponad górnym krańcem", 5000, 1000],
    ["ułamek ponad górnym krańcem", 1000.9, 1000],
  ])("%s: %d -> %d", async (_label, given, expected) => {
    h.result = ok(0);

    const out = await reconcileReputationBadges(given);

    expect(rpcArgs()).toEqual({ p_limit: expected });
    // Zwrotka raportuje TĘ SAMĄ liczbę, którą dostała baza - inaczej wpis
    // w logu crona opisywałby przebieg, którego nie było.
    expect(out.scannedLimit).toBe(expected);
  });
});

describe("wynik przebiegu", () => {
  it("granted bierze się z odpowiedzi RPC", async () => {
    h.result = ok(7);

    await expect(reconcileReputationBadges(10)).resolves.toEqual({
      scannedLimit: 10,
      granted: 7,
    });
  });

  it("brak zwrotki (null) to zero nadanych odznak, nie undefined w logu", async () => {
    h.result = ok(null);

    await expect(reconcileReputationBadges(10)).resolves.toEqual({
      scannedLimit: 10,
      granted: 0,
    });
  });

  it("zero nadanych odznak to poprawny wynik pustej kolejki", async () => {
    h.result = ok(0);

    await expect(reconcileReputationBadges(10)).resolves.toMatchObject({ granted: 0 });
  });
});

describe("awaria RPC", () => {
  it("BŁĄD LECI DALEJ - cichy sukces zamaskowałby, że odznaki nie są nadawane", async () => {
    h.result = fail("permission denied for function reconcile_due_profile_badges", "42501");

    await expect(reconcileReputationBadges(50)).rejects.toThrow(
      "permission denied for function reconcile_due_profile_badges",
    );
  });

  it("kontrola dodatnia: to samo wywołanie bez błędu kończy się wynikiem", async () => {
    // Dowód, że asercja wyżej mierzy PROPAGACJĘ BŁĘDU, a nie to, że wywołanie
    // w ogóle nie dochodzi do skutku.
    h.result = ok(1);

    await expect(reconcileReputationBadges(50)).resolves.toEqual({
      scannedLimit: 50,
      granted: 1,
    });
  });
});
