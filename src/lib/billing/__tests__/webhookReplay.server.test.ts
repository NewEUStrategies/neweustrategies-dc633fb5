// @vitest-environment node
//
// WSPÓLNY RDZEŃ WYKONANIA ZDARZEŃ OPERATORA + AUTOMATYCZNA ZAMIATARKA
// (`webhookReplay.server`).
//
// JAKIE RYZYKO PILNUJE TEN PLIK. Zdarzenie od operatora, którego obsługa
// padła (`failed`) albo zginęła z workerem (`received`), to klient, który
// zapłacił i nie dostał dostępu. Operator ponawia dostawę tylko ~3 doby,
// a zdarzenia z naprawy (`reconcile_*`) nie ponawia nikt - do tej pory na
// takie wiersze czekał człowiek z rolą `super_admin`. Zamiatarka ponawia je
// sama, więc pomyłka w KTÓRĄKOLWIEK stronę kosztuje:
//   * za mało: zdarzenie wisi, klient bez uprawnienia, nikt nie wie,
//   * za dużo: zamiatarka przejmuje wiersz, który właśnie obsługuje żywa
//     dostawa (drugi bilet, drugi mail), albo mieli w kółko zdarzenie,
//     które pada zawsze (mail „płatność nieudana" co pięć minut).
// Dlatego dowodzimy: przejęcia tym samym porównaj-i-zamień co trasa, odstępu
// wykładniczego, sufitu prób, horyzontu, terminu przebiegu, izolacji wierszy
// i tego, że przebieg NIGDY nie rzuca.
//
// GRANICE ATRAP: klient roli serwisowej Supabase i SDK operatora (bezpiecznik
// - żaden przypadek nie ma prawa wyjść do sieci). PRAWDZIWE biegną: dziennik
// (`webhookLog.server` - przejęcie i domknięcie), normalizacja zdarzeń
// Stripe'a, dyspozytor i synchronizacja profilu klienta (`customer.updated`).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type RecordedChain } from "@/test/supabase/chain";
import { FIXED_NOW_ISO, FIXED_NOW_MS, MINUTA, freezeClock, relativeIso } from "@/test/time";

const h = vi.hoisted(() => ({
  db: { current: null as { from: (table: string) => unknown } | null },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
  },
}));
// Bezpiecznik granicy operatora; czyste funkcje modułu zostają prawdziwe.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  getStripeClient: () => {
    throw new Error("test: zamiatarka nie ma prawa wołać operatora w tym scenariuszu");
  },
}));

import { STUCK_AFTER_MS } from "@/lib/billing/webhookLog.server";
import {
  EMPTY_PAYLOAD_ERROR,
  WEBHOOK_SWEEP_BACKOFF_BASE_MS,
  WEBHOOK_SWEEP_BATCH,
  WEBHOOK_SWEEP_HORIZON_MS,
  WEBHOOK_SWEEP_MAX_ATTEMPTS,
  isDueForSweep,
  loggedWebhookEvent,
  processClaimedWebhookEvent,
  sweepWebhookEvents,
  type WebhookSweepRow,
} from "@/lib/billing/webhookReplay.server";

freezeClock();

const LOG = "payment_webhook_events";
const db = supabaseFromStub();

/** Surowe zdarzenie Stripe - dokładnie to, co trasa zapisuje w `payload`. */
function rawCustomerUpdated(eventId: string, customer = "cus_sweep_1") {
  return {
    id: eventId,
    type: "customer.updated",
    created: Math.floor(FIXED_NOW_MS / 1000) - 3600,
    data: {
      object: { id: customer, object: "customer", email: "anna@example.com", name: "Anna" },
    },
  };
}

/** Wiersz kandydata zamiatarki. */
function row(overrides: Partial<WebhookSweepRow> = {}): WebhookSweepRow {
  return {
    id: "row-1",
    event_id: "evt_sweep_1",
    event_type: "customer.updated",
    environment: "live",
    occurred_at: relativeIso(-60 * MINUTA),
    status: "failed",
    created_at: relativeIso(-60 * MINUTA),
    last_retried_at: null,
    processed_at: relativeIso(-15 * MINUTA),
    retry_count: 1,
    ...overrides,
  };
}

interface Plan {
  candidates?: WebhookSweepRow[] | "error";
  /** Wynik warunkowego przejęcia per `id` wiersza; domyślnie wygrane. */
  reclaim?: (rowId: string) => ReturnType<typeof ok> | ReturnType<typeof fail>;
  /** Ładunek per `id` wiersza; domyślnie surowe `customer.updated`. */
  payload?: (rowId: string) => unknown;
}

const eqValue = (chain: RecordedChain, column: string): unknown =>
  chain.calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];

function plan(p: Plan = {}) {
  db.setResponse(LOG, (chain: RecordedChain) => {
    // Odczyt kandydatów: filtr statusów + kolejność.
    if (chain.has("in") && chain.has("order")) {
      return p.candidates === "error"
        ? fail("canceling statement due to statement timeout", "57014")
        : ok(p.candidates ?? []);
    }
    // Warunkowe przejęcie (UPDATE ... RETURNING id).
    if (chain.has("update") && chain.has("select")) {
      const rowId = String(eqValue(chain, "id"));
      return p.reclaim ? p.reclaim(rowId) : ok([{ id: rowId }]);
    }
    // Odczyt ładunku przejętego wiersza.
    if (chain.has("select") && chain.has("maybeSingle")) {
      const rowId = String(eqValue(chain, "id"));
      const payload = p.payload ? p.payload(rowId) : rawCustomerUpdated(`evt_${rowId}`);
      return ok({ payload });
    }
    // Domknięcie wiersza.
    if (chain.has("update")) return ok(null);
    return fail(`test: nieoczekiwany łańcuch na ${LOG}`);
  });
  // `customer.updated` -> właściciel klienta (subskrypcja) -> profil rozliczeniowy.
  db.setResponse("subscriptions", ok({ user_id: "user-me", tenant_id: "tenant-alfa" }));
  db.setResponse("billing_profiles", ok([{ id: "profile-1" }]));
}

const claims = () => db.chainsFor(LOG).filter((c) => c.has("update") && c.has("select"));
const finishes = () => db.chainsFor(LOG).filter((c) => c.has("update") && !c.has("select"));
const eqFilters = (chain: RecordedChain) =>
  chain.calls.filter((c) => c.method === "eq").map((c) => c.args);

beforeEach(() => {
  db.reset();
  h.db.current = db;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sweepWebhookEvents - ponowienie wierszy `failed` i porzuconych `received`", () => {
  // KRYTERIUM PAY-08: zamiatarka przetwarza wiersz `failed`.
  it("wiersz `failed` po odstępie jest ponawiany i kończy jako `processed`", async () => {
    plan({ candidates: [row()] });

    const result = await sweepWebhookEvents();

    expect(result).toEqual({
      scanned: 1,
      due: 1,
      processed: 1,
      skipped: 0,
      failed: 0,
      busy: 0,
      errors: 0,
      deferred: 0,
    });
    // Przejęcie tym samym porównaj-i-zamień co trasa webhooka.
    expect(claims()).toHaveLength(1);
    expect(eqFilters(claims()[0]!)).toEqual([
      ["id", "row-1"],
      ["status", "failed"],
      ["retry_count", 1],
    ]);
    expect(claims()[0]!.argsOf("update")?.[0]).toEqual({
      status: "received",
      error: null,
      processed_at: null,
      retry_count: 2,
      last_retried_at: FIXED_NOW_ISO,
    });
    // Obsługa naprawdę się wykonała: profil klienta dostał dane z ładunku.
    expect(db.lastChain("billing_profiles")?.argsOf("update")?.[0]).toMatchObject({
      email: "anna@example.com",
      full_name: "Anna",
    });
    // Domknięcie wiersza statusem końcowym, po kluczu zdarzenia.
    expect(finishes()).toHaveLength(1);
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "processed",
      error: null,
    });
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_sweep_1"],
      ["environment", "live"],
    ]);
  });

  it("porzucone `received` (ostatnie przejęcie ponad 5 min temu) jest przejmowane i domykane", async () => {
    plan({
      candidates: [
        row({
          status: "received",
          last_retried_at: relativeIso(-6 * MINUTA),
          processed_at: null,
          retry_count: 1,
        }),
      ],
    });

    const result = await sweepWebhookEvents();

    expect(result.processed).toBe(1);
    expect(eqFilters(claims()[0]!)).toEqual([
      ["id", "row-1"],
      ["status", "received"],
      ["retry_count", 1],
    ]);
  });

  it("`received` ŚWIEŻO przejęte (minutę temu) nie jest ruszane - obsługuje je ktoś inny", async () => {
    // Wiersz stary (godzina), ale przejęty minutę temu. Wiek od `created_at`
    // uznałby go za porzucony i zamiatarka weszłaby w trwającą obsługę.
    plan({
      candidates: [
        row({ status: "received", last_retried_at: relativeIso(-MINUTA), processed_at: null }),
      ],
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ scanned: 1, due: 0, processed: 0 });
    expect(claims()).toHaveLength(0);
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("przegrany wyścig o przejęcie (żywa dostawa była pierwsza) - `busy`, bez obsługi", async () => {
    plan({ candidates: [row()], reclaim: () => ok([]) });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 1, busy: 1, processed: 0 });
    expect(finishes()).toHaveLength(0);
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
  });

  it("awaria jednego wiersza nie zatrzymuje pozostałych (izolacja per wiersz)", async () => {
    plan({
      candidates: [
        row({ id: "row-broken", event_id: "evt_a" }),
        row({ id: "row-ok", event_id: "evt_b" }),
      ],
      reclaim: (rowId) =>
        rowId === "row-broken" ? fail("could not serialize access") : ok([{ id: rowId }]),
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 2, errors: 1, processed: 1 });
    expect(console.error).toHaveBeenCalledWith(
      "[payments] webhook sweep: row failed",
      "evt_a",
      expect.objectContaining({
        message: "webhook log reclaim failed: could not serialize access",
      }),
    );
  });

  it("obsługa, która znowu pada, domyka wiersz jako `failed` - wróci po dłuższym odstępie", async () => {
    // Profil klienta: odczyt właściciela subskrypcji rzuca wyjątkiem transportu.
    plan({ candidates: [row()] });
    db.setResponse("subscriptions", () => {
      throw new Error("fetch failed");
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ failed: 1, processed: 0 });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: "fetch failed",
    });
  });

  it("pusty ładunek: wiersz domknięty jako `failed` z powodem, dyspozytor nie rusza", async () => {
    plan({ candidates: [row()], payload: () => ({ eventType: "customer.updated", data: null }) });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ failed: 1 });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: EMPTY_PAYLOAD_ERROR,
    });
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
  });

  it("wiersz z naprawy (`{ eventType, data }`) też jest odtwarzany", async () => {
    plan({
      candidates: [row({ event_id: "reconcile_sub_1_active_1700000000" })],
      payload: () => ({
        eventType: "customer.updated",
        data: { id: "cus_sweep_1", email: "anna@example.com" },
      }),
    });

    const result = await sweepWebhookEvents();

    expect(result.processed).toBe(1);
    expect(eqFilters(finishes()[0]!)).toContainEqual([
      "event_id",
      "reconcile_sub_1_active_1700000000",
    ]);
  });

  it("odczyt kandydatów padł: wynik z `error`, NIE wyjątek - tick i cron jadą dalej", async () => {
    plan({ candidates: "error" });

    const result = await sweepWebhookEvents();

    expect(result.error).toBe(
      "webhook sweep read failed: canceling statement due to statement timeout",
    );
    expect(result.processed).toBe(0);
    expect(claims()).toHaveLength(0);
  });

  it("zapytanie o kandydatów: `failed`+`received`, poniżej sufitu prób, w horyzoncie 3 dób, starsze niż okno, najstarsze najpierw", async () => {
    plan({ candidates: [] });

    await sweepWebhookEvents();

    const query = db.chainsFor(LOG)[0]!;
    expect(query.argsOf("in")).toEqual(["status", ["failed", "received"]]);
    const lt = query.calls.filter((c) => c.method === "lt").map((c) => c.args);
    expect(lt).toEqual([
      ["retry_count", WEBHOOK_SWEEP_MAX_ATTEMPTS],
      ["created_at", new Date(FIXED_NOW_MS - STUCK_AFTER_MS).toISOString()],
    ]);
    expect(query.argsOf("gte")).toEqual([
      "created_at",
      new Date(FIXED_NOW_MS - WEBHOOK_SWEEP_HORIZON_MS).toISOString(),
    ]);
    expect(query.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    // Ładunków NIE czytamy hurtem - tylko dla wiersza, który faktycznie odtwarzamy.
    expect(String(query.argsOf("select")?.[0])).not.toContain("payload");
  });

  it("partia: domyślnie najwyżej 20 wykonań na przebieg, reszta czeka", async () => {
    const many = Array.from({ length: WEBHOOK_SWEEP_BATCH + 5 }, (_, i) =>
      row({ id: `row-${i}`, event_id: `evt_${i}` }),
    );
    plan({ candidates: many });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 25, processed: WEBHOOK_SWEEP_BATCH, deferred: 0 });
    expect(claims()).toHaveLength(WEBHOOK_SWEEP_BATCH);
  });

  it("termin przebiegu: po jego upływie kolejne wiersze czekają (`deferred`)", async () => {
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" }), row({ id: "row-c" })] });
    // Termin już minął po pierwszym wierszu: zegar stoi, więc termin = teraz.
    let first = true;
    db.setResponse("billing_profiles", () => {
      if (first) {
        first = false;
        vi.setSystemTime(FIXED_NOW_MS + 10_000);
      }
      return ok([{ id: "profile-1" }]);
    });

    const result = await sweepWebhookEvents({ deadlineAt: FIXED_NOW_MS + 5_000 });

    expect(result).toMatchObject({ due: 3, processed: 1, deferred: 2 });
    expect(claims()).toHaveLength(1);
  });
});

describe("isDueForSweep - odstęp wykładniczy, sufit prób, okno porzucenia", () => {
  const now = FIXED_NOW_MS;

  it("`failed`: odstęp 5 min x 2^próby liczony od ostatniej porażki", () => {
    // retry_count 3 -> 40 min od ostatniej próby.
    const failedAgo = (min: number) =>
      row({ retry_count: 3, processed_at: relativeIso(-min * MINUTA) });

    expect(WEBHOOK_SWEEP_BACKOFF_BASE_MS).toBe(5 * MINUTA);
    expect(isDueForSweep(failedAgo(39), now)).toBe(false);
    expect(isDueForSweep(failedAgo(40), now)).toBe(true);
    // Pierwsza porażka (0 prób ponowienia): 5 min.
    expect(
      isDueForSweep(row({ retry_count: 0, processed_at: relativeIso(-4 * MINUTA) }), now),
    ).toBe(false);
    expect(
      isDueForSweep(row({ retry_count: 0, processed_at: relativeIso(-5 * MINUTA) }), now),
    ).toBe(true);
  });

  it("sufit prób: po ośmiu próbach automat oddaje zdarzenie człowiekowi", () => {
    expect(WEBHOOK_SWEEP_MAX_ATTEMPTS).toBe(8);
    expect(
      isDueForSweep(
        row({ retry_count: 8, processed_at: relativeIso(-30 * 24 * 60 * MINUTA) }),
        now,
      ),
    ).toBe(false);
    expect(
      isDueForSweep(row({ retry_count: 8, status: "received", last_retried_at: null }), now),
    ).toBe(false);
  });

  it("`received`: wyłącznie po oknie liczonym od OSTATNIEGO przejęcia", () => {
    const received = (claimedMinAgo: number) =>
      row({
        status: "received",
        processed_at: null,
        last_retried_at: relativeIso(-claimedMinAgo * MINUTA),
      });

    expect(isDueForSweep(received(5), now)).toBe(false);
    expect(isDueForSweep(received(6), now)).toBe(true);
  });

  it("statusy końcowe nigdy nie są do zamiatania", () => {
    expect(isDueForSweep(row({ status: "processed" }), now)).toBe(false);
    expect(isDueForSweep(row({ status: "skipped" }), now)).toBe(false);
  });
});

describe("processClaimedWebhookEvent - wspólny rdzeń wykonania", () => {
  it("awaria obsługi wraca jako `failed` z komunikatem i domknięciem - nigdy wyjątkiem", async () => {
    plan();
    db.setResponse("subscriptions", () => {
      throw new Error("connection reset");
    });

    const outcome = await processClaimedWebhookEvent({
      eventId: "evt_core_1",
      environment: "live",
      occurredAt: FIXED_NOW_ISO,
      normalized: { eventType: "customer.updated", data: { id: "cus_1" } },
    });

    expect(outcome).toMatchObject({ status: "failed", error: "connection reset" });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: "connection reset",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[payments] webhook error",
      "evt_core_1",
      expect.any(Error),
    );
  });

  it("zdarzenie spoza integracji (`normalized: null`) domyka się jako `skipped` bez dyspozytora", async () => {
    plan();

    const outcome = await processClaimedWebhookEvent({
      eventId: "evt_core_2",
      environment: "sandbox",
      occurredAt: FIXED_NOW_ISO,
      normalized: null,
    });

    expect(outcome.status).toBe("skipped");
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({ status: "skipped" });
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
  });

  it("zakres najemcy zawęża domknięcie (ponowienie w imieniu admina)", async () => {
    plan();

    await processClaimedWebhookEvent({
      eventId: "evt_core_3",
      environment: "live",
      occurredAt: FIXED_NOW_ISO,
      normalized: null,
      tenantId: "tenant-alfa",
    });

    expect(eqFilters(finishes()[0]!)).toContainEqual(["tenant_id", "tenant-alfa"]);
  });
});

describe("loggedWebhookEvent - trzy kształty ładunku w dzienniku", () => {
  it("surowe zdarzenie operatora przechodzi przez normalizację", async () => {
    await expect(
      loggedWebhookEvent({ event_type: "customer.updated", payload: rawCustomerUpdated("evt_1") }),
    ).resolves.toEqual({
      normalized: {
        eventType: "customer.updated",
        data: { id: "cus_sweep_1", object: "customer", email: "anna@example.com", name: "Anna" },
      },
    });
  });

  it("surowe zdarzenie typu spoza integracji: kompletne, ale `normalized: null` (domknięcie `skipped`)", async () => {
    await expect(
      loggedWebhookEvent({
        event_type: "payout.created",
        payload: {
          id: "evt_2",
          type: "payout.created",
          created: 1,
          data: { object: { id: "po_1" } },
        },
      }),
    ).resolves.toEqual({ normalized: null });
  });

  it("`{ eventType, data }` z naprawy: typ Z ŁADUNKU, nie surowy z kolumny", async () => {
    await expect(
      loggedWebhookEvent({
        event_type: "customer.subscription.updated",
        payload: { eventType: "subscription.updated", data: { id: "sub_1" } },
      }),
    ).resolves.toEqual({
      normalized: { eventType: "subscription.updated", data: { id: "sub_1" } },
    });
  });

  it("sam obiekt danych (wiersz historyczny): typ z kolumny", async () => {
    await expect(
      loggedWebhookEvent({ event_type: "customer.updated", payload: { id: "cus_1" } }),
    ).resolves.toEqual({ normalized: { eventType: "customer.updated", data: { id: "cus_1" } } });
  });

  it.each([
    ["null w kolumnie", null],
    ["pusty obiekt", {}],
    ["`{ data: null }`", { eventType: "customer.updated", data: null }],
    ["tablica", []],
  ])("pusty ładunek (%s) to `null` - nie ma czego odtwarzać", async (_label, payload) => {
    await expect(
      loggedWebhookEvent({ event_type: "customer.updated", payload }),
    ).resolves.toBeNull();
  });
});
