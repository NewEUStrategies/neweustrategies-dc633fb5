// ZAPIS UPRAWNIENIA ZE STANU OPERATORA (`syncEntitlementState`) - jedyny most
// między `subscriptions` (webhook) a `user_subscriptions`, które czyta
// `has_content_access()`. Mapowanie statusów przybija osobno
// `entitlementSync.server.test.ts`; ten plik przybija ZAPIS.
//
// JAKIE RYZYKA:
//   * DUPLIKAT UPRAWNIENIA. Kolejne zdarzenie tej samej subskrypcji ma
//     zaktualizować JEDEN wiersz po `external_ref`, a nie dopisać drugi -
//     także wtedy, gdy dwa zdarzenia ścigają się o wstawienie (indeks
//     unikalny `external_ref`, migracja `user_subscriptions_external_ref_unique`:
//     przegrany dostaje 23505).
//   * WSKRZESZENIE PO ZWROCIE. Uprawnienie odebrane po zwrocie jest
//     ostateczne - spóźnione zdarzenie nie przywraca płatnego dostępu.
//   * POZORNY SUKCES. Błąd odczytu albo zapisu MUSI polecieć wyjątkiem
//     (webhook zapisze `failed`, operator ponowi), zamiast udawać, że dostęp
//     został nadany lub odebrany.
//
// Atrapa stoi wyłącznie na kliencie roli serwisowej. Zegar zamrożony -
// `canceled_at` stempluje „teraz".
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntitlementSyncInput } from "@/lib/billing/entitlementSync.server";
import { BILLING_IDS } from "@/test/billing/fixtures";
// Atrapa kanoniczna (`@/test/supabase/chain`), nie zgodnościowy re-eksport:
// testy wyścigu odpowiadają obietnicą (tabela w pamięci), a tylko ten typ
// `TableResponder` ją dopuszcza.
import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabase/chain";
import { rowStore } from "@/test/billing/rowStore";
import { DZIEN, FIXED_NOW_ISO, freezeClock, relativeIso } from "@/test/time";

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const { syncEntitlementState, mayReviveRefunded } =
  await import("@/lib/billing/entitlementSync.server");

freezeClock();

const SUB = "sub_1SyntetyczneUprawnienie";

interface Plan {
  existing: { id: string; status: string; canceled_at?: string | null } | null;
  read?: SupabaseResult;
  update?: SupabaseResult;
  insert?: SupabaseResult;
}

function plan(p: Plan): void {
  db.setResponse("user_subscriptions", (chain: RecordedChain) => {
    if (chain.has("insert")) return p.insert ?? ok(null);
    if (chain.has("update")) return p.update ?? ok(null);
    return p.read ?? ok(p.existing);
  });
}

function input(overrides: Partial<EntitlementSyncInput> = {}): EntitlementSyncInput {
  return {
    userId: BILLING_IDS.me,
    tenantId: BILLING_IDS.tenant,
    planId: "plan-member-monthly",
    externalRef: SUB,
    status: "active",
    periodEnd: relativeIso(30 * DZIEN),
    ...overrides,
  };
}

function writeOf(method: "insert" | "update") {
  const chain = db.chainsFor("user_subscriptions").find((c) => c.has(method));
  return { chain, row: chain?.argsOf(method)?.[0] as Record<string, unknown> | undefined };
}

beforeEach(() => {
  db = supabaseFromStub();
});

describe("syncEntitlementState - zapis uprawnienia", () => {
  it("pierwsze zdarzenie subskrypcji zakłada wiersz z kluczem `external_ref`", async () => {
    plan({ existing: null });
    const periodEnd = relativeIso(30 * DZIEN);

    await syncEntitlementState(input({ periodEnd }));

    const read = db.chainsFor("user_subscriptions")[0];
    expect(read?.argsOf("eq")).toEqual(["external_ref", SUB]);
    // Klucz jest unikalny w bazie - obejście `order + limit 1` (dawniej chroniło
    // przed PGRST116 na duplikacie) nie jest już potrzebne.
    expect(read?.has("order")).toBe(false);
    expect(read?.has("maybeSingle")).toBe(true);

    expect(writeOf("insert").row).toEqual({
      user_id: BILLING_IDS.me,
      tenant_id: BILLING_IDS.tenant,
      plan_id: "plan-member-monthly",
      status: "active",
      external_ref: SUB,
      current_period_end: periodEnd,
      canceled_at: null,
    });
    expect(writeOf("update").chain).toBeUndefined();
  });

  it("kolejne zdarzenie aktualizuje TEN SAM wiersz, a pauza odbiera dostęp od razu", async () => {
    plan({ existing: { id: "us-1", status: "active" } });

    await syncEntitlementState(input({ status: "paused", planId: "plan-pro-monthly" }));

    const { chain, row } = writeOf("update");
    expect(chain?.argsOf("eq")).toEqual(["external_ref", SUB]);
    // „Zwrot jest ostateczny" stoi w SAMYM zapisie - trzyma także przy zwrocie,
    // który wpadnie między odczyt a aktualizację.
    expect(chain?.argsOf("neq")).toEqual(["status", "refunded"]);
    expect(row).toEqual({
      plan_id: "plan-pro-monthly",
      status: "canceled",
      current_period_end: input().periodEnd,
      canceled_at: FIXED_NOW_ISO,
    });
    expect(writeOf("insert").chain).toBeUndefined();
  });

  // Audyt SUB-14: `canceled_at` niesie „rezygnacja zaplanowana" dla panelu
  // klienta i lokalnego `resumeSubscription` - zdarzenie operatora nie może go
  // ani skasować, ani przestemplować na „teraz".
  describe("canceled_at - kontrakt zaplanowanej rezygnacji", () => {
    const localCancel = relativeIso(-3 * DZIEN);

    it("zaplanowana rezygnacja zachowuje datę lokalnego anulowania", async () => {
      plan({ existing: { id: "us-1", status: "active", canceled_at: localCancel } });

      await syncEntitlementState(input({ cancelAtPeriodEnd: true }));

      expect(writeOf("update").row).toMatchObject({ status: "active", canceled_at: localCancel });
    });

    it("stan końcowy też nie przestemplowuje zapisanej daty", async () => {
      plan({ existing: { id: "us-1", status: "active", canceled_at: localCancel } });

      await syncEntitlementState(input({ status: "canceled" }));

      expect(writeOf("update").row?.canceled_at).toBe(localCancel);
    });

    it("zaplanowana rezygnacja bez zapisanej daty dostaje „teraz”", async () => {
      plan({ existing: { id: "us-1", status: "active" } });

      await syncEntitlementState(input({ cancelAtPeriodEnd: true }));

      expect(writeOf("update").row?.canceled_at).toBe(FIXED_NOW_ISO);
    });

    it("jawny brak rezygnacji u operatora (wznowienie) czyści datę", async () => {
      plan({ existing: { id: "us-1", status: "active", canceled_at: localCancel } });

      await syncEntitlementState(input({ cancelAtPeriodEnd: false }));

      expect(writeOf("update").row?.canceled_at).toBeNull();
    });

    it("wołający bez wiedzy o stanie operatora zostawia datę bez zmian", async () => {
      plan({ existing: { id: "us-1", status: "active", canceled_at: localCancel } });

      await syncEntitlementState(input());

      expect(writeOf("update").row?.canceled_at).toBe(localCancel);
    });
  });

  it("uprawnienie odebrane po zwrocie jest ostateczne - spóźnione zdarzenie go nie wskrzesza", async () => {
    plan({ existing: { id: "us-1", status: "refunded" } });

    await syncEntitlementState(input({ status: "active" }));

    expect(writeOf("update").chain).toBeUndefined();
    expect(writeOf("insert").chain).toBeUndefined();
  });

  it.each([
    {
      krok: "odczyt",
      scena: { existing: null, read: fail("statement timeout", "57014") },
      komunikat: `entitlement sync: lookup failed (${SUB}): statement timeout`,
    },
    {
      krok: "aktualizacja",
      scena: { existing: { id: "us-1", status: "active" }, update: fail("permission denied") },
      komunikat: `entitlement sync: update failed (${SUB}): permission denied`,
    },
    {
      krok: "wstawienie",
      scena: { existing: null, insert: fail("violates foreign key constraint", "23503") },
      komunikat: `entitlement sync: insert failed (${SUB}): violates foreign key constraint`,
    },
  ] satisfies { krok: string; scena: Plan; komunikat: string }[])(
    "błąd na kroku „$krok” leci wyjątkiem z identyfikatorem subskrypcji - webhook ma ponowić",
    async ({ scena, komunikat }) => {
      plan(scena);

      await expect(syncEntitlementState(input())).rejects.toThrow(komunikat);
    },
  );

  it("przegrany wyścig o wstawienie (23505) aktualizuje TEN SAM klucz zamiast dopisać drugi wiersz", async () => {
    // Równoległe zdarzenie wstawiło uprawnienie między naszym odczytem
    // („brak") a wstawieniem. Indeks unikalny odrzuca drugi wiersz, a stan
    // tego zdarzenia trafia aktualizacją w wiersz zwycięzcy.
    plan({
      existing: null,
      insert: fail("duplicate key value violates unique constraint", "23505"),
    });

    await syncEntitlementState(input({ status: "past_due" }));

    const { chain, row } = writeOf("update");
    expect(chain?.argsOf("eq")).toEqual(["external_ref", SUB]);
    expect(chain?.argsOf("neq")).toEqual(["status", "refunded"]);
    expect(row).toMatchObject({ status: "active", plan_id: "plan-member-monthly" });
  });

  it("dwie równoległe synchronizacje bez wiersza: jedno uprawnienie (indeks unikalny)", async () => {
    // Najgorszy przeplot odtworzony deterministycznie: druga synchronizacja
    // biegnie w całości w chwili, gdy pierwsza właśnie przeczytała „brak".
    const store = rowStore({ unique: ["external_ref"] });
    let inner: Promise<void> | null = null;
    db.setResponse("user_subscriptions", async (chain) => {
      const result = await store.respond(chain);
      if (chain.has("maybeSingle") && inner === null) {
        inner = syncEntitlementState(input({ status: "trialing" }));
        await inner;
      }
      return result;
    });

    await syncEntitlementState(input({ status: "past_due" }));
    await inner;

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ external_ref: SUB, status: "active" });
  });

  it("wiersz odebrany po zwrocie nie wraca do życia także na ścieżce wyścigu", async () => {
    // Wstawienie przegrywa z wierszem, który w międzyczasie dostał `refunded`
    // (zwrot) - aktualizacja z warunkiem `status <> 'refunded'` go nie rusza.
    const store = rowStore({
      rows: [{ id: "us-1", external_ref: SUB, status: "refunded" }],
      unique: ["external_ref"],
    });
    let reads = 0;
    db.setResponse("user_subscriptions", (chain) => {
      // Odczyt sprzed zwrotu: „brak wiersza".
      if (chain.has("maybeSingle") && reads++ === 0) return ok(null);
      return store.respond(chain);
    });

    await syncEntitlementState(input({ status: "active" }));

    expect(store.rows).toEqual([{ id: "us-1", external_ref: SUB, status: "refunded" }]);
  });

  it("błąd odczytu nie prowadzi do zapisu „na ślepo”", async () => {
    plan({ existing: null, read: fail("statement timeout", "57014") });

    await expect(syncEntitlementState(input())).rejects.toThrow();

    expect(db.chainsFor("user_subscriptions")).toHaveLength(1);
  });
});

describe("S1: uprawnienie `refunded` (korekta BIEŻĄCEGO okresu) - kiedy stan operatora wraca", () => {
  // Zwrot ani spór nie anulują subskrypcji u operatora - kolejne odnowienia
  // są pobierane. Dawniej `refunded` był ostateczny dla `external_ref`: klient
  // płacił co miesiąc i nigdy nie odzyskiwał dostępu (2.1, 5.1, 6.1, 7.2).
  // Z drugiej strony ten sam okres nie może korekty cofać: zawieszenie sporu
  // statusem `canceled` cofało każde `subscription.updated`, także wywołane
  // przez samego klienta (2.2, 5.0, 6.0, 7.3).
  const CORRECTED_AT = relativeIso(-5 * DZIEN);

  it("2.1: NOWY opłacony okres (początek po korekcie) przywraca dostęp i czyści `canceled_at`", async () => {
    plan({ existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT } });
    const periodEnd = relativeIso(29 * DZIEN);

    await syncEntitlementState(
      input({ status: "active", periodStart: relativeIso(-1 * DZIEN), periodEnd }),
    );

    const { chain, row } = writeOf("update");
    expect(row).toEqual({
      plan_id: "plan-member-monthly",
      status: "active",
      current_period_end: periodEnd,
      canceled_at: null,
    });
    // Ożywiamy TĘ korektę, którą widział odczyt - nowsza (zwrot w międzyczasie)
    // nie zostanie nadpisana.
    expect(chain?.calls.filter((call) => call.method === "eq").map((call) => call.args)).toEqual([
      ["external_ref", SUB],
      ["status", "refunded"],
      ["canceled_at", CORRECTED_AT],
    ]);
    expect(chain?.has("neq")).toBe(false);
  });

  it.each([
    ["ten sam okres (początek PRZED korektą)", relativeIso(-20 * DZIEN)],
    ["początek równy chwili korekty", CORRECTED_AT],
    ["brak początku okresu (stare wywołanie)", undefined],
    ["początek nieczytelny", "nie-data"],
  ])(
    "2.2: %s - `subscription.updated` / synchronizacja klienta NIE cofa korekty",
    async (_label, periodStart) => {
      plan({ existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT } });

      await syncEntitlementState(input({ status: "active", periodStart }));

      expect(writeOf("update").chain).toBeUndefined();
      expect(writeOf("insert").chain).toBeUndefined();
    },
  );

  it("S2: `force` (wygrany spór, stan od operatora) przywraca dostęp niezależnie od okresu", async () => {
    plan({ existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT } });

    await syncEntitlementState(
      input({ status: "active", periodStart: relativeIso(-20 * DZIEN), force: true }),
    );

    expect(writeOf("update").row).toMatchObject({ status: "active", canceled_at: null });
  });

  it("`force` na korekcie bez `canceled_at` warunkuje zapis pustą kolumną, nie pomija warunku", async () => {
    plan({ existing: { id: "us-1", status: "refunded", canceled_at: null } });

    await syncEntitlementState(input({ status: "active", force: true }));

    const { chain } = writeOf("update");
    expect(chain?.calls).toContainEqual({ method: "is", args: ["canceled_at", null] });
    expect(chain?.calls).toContainEqual({ method: "eq", args: ["status", "refunded"] });
  });

  it("stan operatora `canceled` z minionym okresem zastępuje korektę stanem `canceled`, nie `active`", async () => {
    plan({ existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT } });

    await syncEntitlementState(
      input({ status: "canceled", periodEnd: relativeIso(-1 * DZIEN), force: true }),
    );

    expect(writeOf("update").row).toMatchObject({ status: "canceled", canceled_at: FIXED_NOW_ISO });
  });

  it("korekta NOWSZA niż odczyt (zwrot między odczytem a zapisem) nie zostaje ożywiona", async () => {
    // Odczyt widział korektę sprzed pięciu dni; zanim poszedł zapis, przyszła
    // kolejna (np. spór o nowe odnowienie). Warunek na `canceled_at` odczytu
    // nie trafia - nowa korekta zostaje.
    const store = rowStore({
      rows: [{ id: "us-1", external_ref: SUB, status: "refunded", canceled_at: FIXED_NOW_ISO }],
      unique: ["external_ref"],
      timestamps: ["canceled_at"],
    });
    db.setResponse("user_subscriptions", (chain) =>
      chain.has("maybeSingle")
        ? ok({ id: "us-1", status: "refunded", canceled_at: CORRECTED_AT })
        : store.respond(chain),
    );

    await syncEntitlementState(input({ status: "active", periodStart: relativeIso(-1 * DZIEN) }));

    expect(store.rows[0]).toMatchObject({ status: "refunded", canceled_at: FIXED_NOW_ISO });
  });

  it("23505: wiersz zwycięzcy z korektą bieżącego okresu zostaje, z korektą sprzed nowego okresu - wraca", async () => {
    const raced = (periodStart: string) => {
      const store = rowStore({
        rows: [{ id: "us-1", external_ref: SUB, status: "refunded", canceled_at: CORRECTED_AT }],
        unique: ["external_ref"],
        timestamps: ["canceled_at"],
      });
      let reads = 0;
      db.setResponse("user_subscriptions", (chain) => {
        if (chain.has("maybeSingle") && reads++ === 0) return ok(null);
        return store.respond(chain);
      });
      return { store, run: () => syncEntitlementState(input({ status: "active", periodStart })) };
    };

    const samePeriod = raced(relativeIso(-20 * DZIEN));
    await samePeriod.run();
    expect(samePeriod.store.rows[0]).toMatchObject({ status: "refunded" });

    db = supabaseFromStub();
    const newPeriod = raced(relativeIso(-1 * DZIEN));
    await newPeriod.run();
    expect(newPeriod.store.rows[0]).toMatchObject({ status: "active", canceled_at: null });
  });

  it("błąd ożywienia leci wyjątkiem z kluczem - webhook ponowi", async () => {
    plan({
      existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT },
      update: fail("permission denied"),
    });

    await expect(syncEntitlementState(input({ force: true }))).rejects.toThrow(
      `entitlement sync: revive failed (${SUB}): permission denied`,
    );
  });

  it("`mayReviveRefunded` - reguła w jednym miejscu", () => {
    expect(mayReviveRefunded({ status: "past_due", force: true }, null)).toBe(true);
    expect(
      mayReviveRefunded({ status: "active", periodStart: relativeIso(0) }, relativeIso(-1)),
    ).toBe(true);
    expect(mayReviveRefunded({ status: "active", periodStart: relativeIso(0) }, null)).toBe(false);
    expect(mayReviveRefunded({ status: "active", periodStart: null }, relativeIso(-1))).toBe(false);
    expect(mayReviveRefunded({ status: "active", periodStart: relativeIso(0) }, "nie-data")).toBe(
      false,
    );
  });

  // S1 x SUB-03 (scalenie z #495). Stripe przesuwa `current_period_start` przy
  // odnowieniu ZANIM obciąży kartę, a karencja płatności daje zaległości
  // dostęp do końca karencji. Nieudane odnowienie po zwrocie albo sporze
  // przychodziło więc jako „nowy okres" i ożywiało uprawnienie odebrane
  // korektą - klient, któremu zwróciliśmy pieniądze, dostawał dwa tygodnie
  // dostępu za kolejną nieudaną płatność.
  it.each([["past_due"], ["unpaid"], ["paused"], ["incomplete"], ["incomplete_expired"]])(
    "S1 x SUB-03: `%s` w NOWYM okresie nie ożywia korekty (karencja to nie zapłata)",
    async (status) => {
      plan({ existing: { id: "us-1", status: "refunded", canceled_at: CORRECTED_AT } });

      await syncEntitlementState(
        input({ status, periodStart: relativeIso(-1 * DZIEN), periodEnd: relativeIso(13 * DZIEN) }),
      );

      expect(writeOf("update").chain).toBeUndefined();
      expect(writeOf("insert").chain).toBeUndefined();
      expect(
        mayReviveRefunded({ status, periodStart: relativeIso(-1 * DZIEN) }, CORRECTED_AT),
      ).toBe(false);
    },
  );

  it.each([["active"], ["trialing"], ["canceled"]])(
    "S1: `%s` w NOWYM opłaconym okresie ożywia korektę",
    (status) => {
      expect(
        mayReviveRefunded({ status, periodStart: relativeIso(-1 * DZIEN) }, CORRECTED_AT),
      ).toBe(true);
    },
  );
});
