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
// wykładniczego (także dla porzuconych `received` - przegląd 3.1), sufitu
// prób, horyzontu od czasu zdarzenia (3.3), kandydatów liczonych w bazie
// (3.2 - sama starvacja na prawdziwym Postgresie: supabase/tests/
// billing_ops_transport_test.sql), terminu startu wiersza, który mieści jego
// budżet w oknie pracy „za odpowiedzią", i ograniczonego czekania (3.0),
// domknięcia własnym pokoleniem (3.4), izolacji wierszy i tego, że przebieg
// NIGDY nie rzuca.
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
  /** Odpowiedź RPC kandydatów + rejestr wywołań (nazwa, argumenty). */
  rpc: {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    respond: null as null | ((fn: string) => { data: unknown; error: unknown }),
  },
  /** Praca oddana „za odpowiedź" (`runAfterResponse`). */
  afterResponse: [] as Promise<unknown>[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db.current) throw new Error("test: atrapa bazy nieustawiona (beforeEach)");
      return h.db.current.from(table);
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpc.calls.push({ fn, args });
      if (!h.rpc.respond) throw new Error("test: RPC nieplanowane");
      return Promise.resolve(h.rpc.respond(fn));
    },
  },
}));
vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>) => {
    h.afterResponse.push(work);
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
import { STRIPE_MAX_NETWORK_RETRIES, STRIPE_REQUEST_TIMEOUT_MS } from "@/lib/stripe.server";
import {
  EMPTY_PAYLOAD_ERROR,
  WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS,
  WEBHOOK_SWEEP_BACKOFF_BASE_MS,
  WEBHOOK_SWEEP_BATCH,
  WEBHOOK_SWEEP_HORIZON_MS,
  WEBHOOK_SWEEP_MAX_ATTEMPTS,
  WEBHOOK_SWEEP_ROW_BUDGET_MS,
  isDueForSweep,
  isWithinSweepHorizon,
  loggedWebhookEvent,
  processClaimedWebhookEvent,
  sweepRowStartCutoff,
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

/** Przejęcie zawsze zapisuje `received`; domknięcie - status końcowy. */
const isClaim = (chain: RecordedChain): boolean =>
  chain.has("update") &&
  (chain.argsOf("update")?.[0] as { status?: string } | undefined)?.status === "received";

function plan(p: Plan = {}) {
  // Kandydaci: RPC liczące odstęp, sufit i horyzont w bazie (przegląd 3.2).
  h.rpc.respond = (fn) => {
    if (fn !== "payment_webhook_sweep_candidates") throw new Error(`test: RPC ${fn}`);
    return p.candidates === "error"
      ? { data: null, error: { message: "canceling statement due to statement timeout" } }
      : { data: p.candidates ?? [], error: null };
  };
  db.setResponse(LOG, (chain: RecordedChain) => {
    // Warunkowe przejęcie (UPDATE ... RETURNING id).
    if (isClaim(chain)) {
      const rowId = String(eqValue(chain, "id"));
      return p.reclaim ? p.reclaim(rowId) : ok([{ id: rowId }]);
    }
    // Odczyt ładunku przejętego wiersza.
    if (chain.has("select") && chain.has("maybeSingle")) {
      const rowId = String(eqValue(chain, "id"));
      const payload = p.payload ? p.payload(rowId) : rawCustomerUpdated(`evt_${rowId}`);
      return ok({ payload });
    }
    // Warunkowe domknięcie wiersza (UPDATE ... RETURNING id).
    if (chain.has("update")) return ok([{ id: "row-finished" }]);
    return fail(`test: nieoczekiwany łańcuch na ${LOG}`);
  });
  // `customer.updated` -> właściciel klienta (subskrypcja) -> profil rozliczeniowy.
  db.setResponse("subscriptions", ok({ user_id: "user-me", tenant_id: "tenant-alfa" }));
  db.setResponse("billing_profiles", ok([{ id: "profile-1" }]));
}

const claims = () => db.chainsFor(LOG).filter((c) => isClaim(c));
const finishes = () => db.chainsFor(LOG).filter((c) => c.has("update") && !isClaim(c));
const eqFilters = (chain: RecordedChain) =>
  chain.calls.filter((c) => c.method === "eq").map((c) => c.args);

beforeEach(() => {
  db.reset();
  h.db.current = db;
  h.rpc.calls.length = 0;
  h.rpc.respond = null;
  h.afterResponse.length = 0;
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
      timedOut: 0,
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
    // Domknięcie wiersza statusem końcowym, po kluczu zdarzenia - i WYŁĄCZNIE
    // w pokoleniu tego przejęcia (licznik 1 -> 2, przegląd 3.4).
    expect(finishes()).toHaveLength(1);
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "processed",
      error: null,
    });
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_sweep_1"],
      ["environment", "live"],
      ["status", "received"],
      ["retry_count", 2],
    ]);
    // Obsługa zarejestrowana „za odpowiedzią" - zerwane połączenie wołającego
    // nie ubija jej w połowie.
    expect(h.afterResponse).toHaveLength(1);
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

  it("`received` ŚWIEŻO przejęte (minutę temu) nie jest ruszane, nawet gdy baza by je zwróciła", async () => {
    // Wiersz stary (godzina), ale przejęty minutę temu. Wiek od `created_at`
    // uznałby go za porzucony i zamiatarka weszłaby w trwającą obsługę.
    // Baza go nie zwraca (odstęp), a gdyby jednak - bezpiecznikiem jest
    // test porzucenia w samym przejęciu.
    plan({
      candidates: [
        row({ status: "received", last_retried_at: relativeIso(-MINUTA), processed_at: null }),
      ],
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ scanned: 1, busy: 1, processed: 0 });
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

  // KRYTERIUM przeglądu 3.2. Dawniej: 100 NAJSTARSZYCH wierszy po `created_at`
  // i filtr odstępu w aplikacji - setka wierszy w odstępie zasłaniała nowszy
  // wiersz do wzięcia. Teraz o kandydatach decyduje baza, z regułami z tego
  // modułu (dowód na prawdziwym Postgresie: billing_ops_transport_test.sql).
  it("kandydaci: JEDNO wywołanie RPC liczącej odstęp, sufit, okno i horyzont w bazie - partia, nie setka", async () => {
    plan({ candidates: [] });

    await sweepWebhookEvents();

    expect(h.rpc.calls).toEqual([
      {
        fn: "payment_webhook_sweep_candidates",
        args: {
          p_limit: WEBHOOK_SWEEP_BATCH,
          p_max_attempts: WEBHOOK_SWEEP_MAX_ATTEMPTS,
          p_backoff_base_ms: WEBHOOK_SWEEP_BACKOFF_BASE_MS,
          p_stuck_after_ms: STUCK_AFTER_MS,
          p_horizon_ms: WEBHOOK_SWEEP_HORIZON_MS,
        },
      },
    ]);
    // Żadnego hurtowego odczytu tabeli (ani kandydatów, ani ładunków).
    expect(db.chainsFor(LOG)).toHaveLength(0);
  });

  it("każdy kandydat z bazy jest brany - aplikacja nie odsiewa go drugi raz zegarem z innej maszyny", async () => {
    // Wiersz, któremu odstęp minął o sekundę wg zegara bazy - zegar aplikacji
    // spóźniony o 2 s widziałby go jeszcze „w odstępie". Drugi filtr w JS
    // odkładałby takie wiersze w nieskończoność przy stałym rozjeździe.
    plan({
      candidates: [row({ retry_count: 0, processed_at: relativeIso(-5 * MINUTA + 2_000) })],
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 1, processed: 1 });
  });

  // KRYTERIUM przeglądu 3.1: porażka PO przejęciu nie zostawia wiersza `received`.
  it("wyjątek po przejęciu (np. normalizacja rzuca) domyka wiersz jako `failed` z przyczyną", async () => {
    plan({ candidates: [row()] });
    db.setResponse(LOG, (chain: RecordedChain) => {
      if (isClaim(chain)) return ok([{ id: "row-1" }]);
      if (chain.has("maybeSingle")) throw new Error("socket hang up");
      if (chain.has("update")) return ok([{ id: "row-1" }]);
      return fail("test: nieoczekiwany łańcuch");
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ failed: 1, errors: 0 });
    expect(finishes()).toHaveLength(1);
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: "webhook sweep replay crashed: socket hang up",
    });
    expect(eqFilters(finishes()[0]!)).toContainEqual(["retry_count", 2]);
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

  it("budżet wiersza = jedno żądanie do operatora z ponowieniem SDK (10 s x 2)", () => {
    expect(WEBHOOK_SWEEP_ROW_BUDGET_MS).toBe(
      STRIPE_REQUEST_TIMEOUT_MS * (STRIPE_MAX_NETWORK_RETRIES + 1),
    );
  });

  // KRYTERIUM przeglądu 3.0 i regresji po nim. Wiersz zaczęty przed terminem
  // nie ginie z zerwanym połączeniem wołającego: od startu jest zarejestrowany
  // „za odpowiedzią", a runtime daje takiej pracy 30 s - więcej niż budżet
  // wiersza. Bramka „pełny budżet wiersza PRZED terminem" była nadmiarowa
  // i głodziła tick zadań: zamiatarka ruszająca później niż ~3 s po starcie
  // ticku odkładała wszystko (`deferred`), a log przebiegów pokazywał `ok:true`.
  it("budżet wiersza mieści się w oknie pracy „za odpowiedzią” - wiersz zaczęty tuż przed terminem zdąży się domknąć", () => {
    expect(WEBHOOK_SWEEP_ROW_BUDGET_MS).toBeLessThanOrEqual(WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS);
    // Wiersz przeżywa wołającego tylko wtedy, gdy przebieg przestał na niego
    // czekać w chwili terminu - odpowiedź albo zerwanie połączenia przychodzą
    // więc NAJWCZEŚNIEJ w terminie, a okno pracy po nich liczy się od tej chwili.
    for (const deadline of [FIXED_NOW_MS + 1, FIXED_NOW_MS + 23_000, FIXED_NOW_MS + 58_000]) {
      const cutoff = sweepRowStartCutoff(deadline);
      expect(cutoff).toBeLessThanOrEqual(deadline);
      expect(cutoff + WEBHOOK_SWEEP_ROW_BUDGET_MS).toBeLessThanOrEqual(
        deadline + WEBHOOK_SWEEP_AFTER_RESPONSE_GRACE_MS,
      );
    }
  });

  it("termin: wiersz startuje aż do terminu, także bez pełnego budżetu przed nim", async () => {
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" })] });

    const result = await sweepWebhookEvents({
      deadlineAt: FIXED_NOW_MS + WEBHOOK_SWEEP_ROW_BUDGET_MS - 1,
    });

    expect(result).toMatchObject({ due: 2, processed: 2, deferred: 0, timedOut: 0 });
    expect(claims()).toHaveLength(2);
    // Każdy zaczęty wiersz od startu żyje „za odpowiedzią".
    expect(h.afterResponse).toHaveLength(2);
  });

  it("termin: po terminie żaden wiersz nie startuje (`deferred`, bez przejęcia)", async () => {
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" })] });

    const result = await sweepWebhookEvents({ deadlineAt: FIXED_NOW_MS });

    expect(result).toMatchObject({ due: 2, processed: 0, deferred: 2, timedOut: 0 });
    expect(claims()).toHaveLength(0);
    expect(h.afterResponse).toHaveLength(0);
  });

  it("termin: kolejne wiersze startują, dopóki termin nie minął", async () => {
    plan({
      candidates: [
        row({ id: "row-a" }),
        row({ id: "row-b" }),
        row({ id: "row-c" }),
        row({ id: "row-d" }),
      ],
    });
    // Każdy wiersz „trwa" 5 s (zegar przesuwa odczyt profilu klienta).
    db.setResponse("billing_profiles", () => {
      vi.setSystemTime(Date.now() + 5_000);
      return ok([{ id: "profile-1" }]);
    });

    const result = await sweepWebhookEvents({ deadlineAt: FIXED_NOW_MS + 12_000 });

    // Start 1: 12 s do terminu; start 2: 7 s; start 3: 2 s; przed 4.: termin minął.
    expect(result).toMatchObject({ due: 4, processed: 3, deferred: 1, timedOut: 0 });
    expect(claims()).toHaveLength(3);
  });

  it("termin: na wiersz, który go przekracza, przebieg NIE czeka - kończy się z `timedOut`", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(FIXED_NOW_MS);
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" })] });
    // Operator wisi: odczyt profilu nigdy się nie kończy.
    db.setResponse("billing_profiles", () => new Promise(() => {}));

    const pending = sweepWebhookEvents({
      deadlineAt: FIXED_NOW_MS + WEBHOOK_SWEEP_ROW_BUDGET_MS + 1_000,
    });
    await vi.advanceTimersByTimeAsync(WEBHOOK_SWEEP_ROW_BUDGET_MS + 1_000);
    const result = await pending;

    expect(result).toMatchObject({ processed: 0, timedOut: 1, deferred: 1 });
    // Drugi wiersz nie wystartował; pierwszy biegnie dalej „za odpowiedzią"
    // i domknie się sam swoim pokoleniem.
    expect(claims()).toHaveLength(1);
    expect(h.afterResponse).toHaveLength(1);
    expect(finishes()).toHaveLength(0);
  });
});

describe("isDueForSweep / isWithinSweepHorizon - odstęp wykładniczy, sufit prób, okno porzucenia, horyzont", () => {
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
        retry_count: 0,
      });

    expect(isDueForSweep(received(5), now)).toBe(false);
    expect(isDueForSweep(received(6), now)).toBe(true);
  });

  // KRYTERIUM przeglądu 3.1: porzucone `received` dostaje ten sam odstęp co
  // `failed`. Dawniej retry 7 sprzed 5 min 1 s było do wzięcia - obsługa
  // ginąca za każdym razem wyczerpywała 8 prób w ~40 min.
  it("porzucone `received` z wieloma próbami czeka na odstęp wykładniczy, nie tylko na okno", () => {
    const received = (retries: number, claimedMinAgo: number) =>
      row({
        status: "received",
        processed_at: null,
        last_retried_at: relativeIso(-claimedMinAgo * MINUTA - 1_000),
        retry_count: retries,
      });

    expect(isDueForSweep(received(7, 5), now)).toBe(false);
    expect(isDueForSweep(received(7, 639), now)).toBe(false);
    expect(isDueForSweep(received(7, 640), now)).toBe(true);
    expect(isDueForSweep(received(1, 9), now)).toBe(false);
    expect(isDueForSweep(received(1, 10), now)).toBe(true);
  });

  // KRYTERIUM przeglądu 3.3: horyzont od czasu ZDARZENIA.
  it("horyzont liczy się od `occurred_at`, a od utworzenia wiersza tylko bez niego", () => {
    // Odtworzenie PRAWDZIWEGO zdarzenia sprzed 20 dni (naprawa „zdarzenie"
    // z uzgadniania): wiersz świeży, zdarzenie stare - do człowieka.
    expect(
      isWithinSweepHorizon(
        {
          event_id: "evt_stary_1",
          occurred_at: relativeIso(-20 * 24 * 60 * MINUTA),
          created_at: relativeIso(-MINUTA),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isWithinSweepHorizon(
        { event_id: "evt_2", occurred_at: null, created_at: relativeIso(-2 * 24 * 60 * MINUTA) },
        now,
      ),
    ).toBe(true);
    expect(
      isWithinSweepHorizon(
        {
          event_id: "evt_3",
          occurred_at: relativeIso(-WEBHOOK_SWEEP_HORIZON_MS - 1),
          created_at: FIXED_NOW_ISO,
        },
        now,
      ),
    ).toBe(false);
    // Syntetyczna naprawa zamówienia: stan sesji odczytany TERAZ, `occurred_at`
    // = czas zakupu sprzed tygodnia (dla `paid_at`) - wiek liczy się od wiersza.
    expect(
      isWithinSweepHorizon(
        {
          event_id: "reconcile_cs_1_4085000000",
          occurred_at: relativeIso(-7 * 24 * 60 * MINUTA),
          created_at: relativeIso(-MINUTA),
        },
        now,
      ),
    ).toBe(true);
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

    expect(outcome).toMatchObject({
      status: "failed",
      error: "connection reset",
      finish: "finished",
    });
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

  it("pokolenie przejęcia zawęża domknięcie do TEGO przejęcia (przegląd 3.4)", async () => {
    plan();

    await processClaimedWebhookEvent({
      eventId: "evt_core_4",
      environment: "live",
      occurredAt: FIXED_NOW_ISO,
      normalized: null,
      generation: 6,
    });

    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_core_4"],
      ["environment", "live"],
      ["status", "received"],
      ["retry_count", 6],
    ]);
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
