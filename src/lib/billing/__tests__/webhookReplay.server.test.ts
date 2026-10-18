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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  /** Klient operatora dla przypadku, który MA go wołać; domyślnie brak. */
  stripe: null as null | { subscriptions: { retrieve: (id: string) => Promise<unknown> } },
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
    if (h.stripe) return h.stripe;
    throw new Error("test: zamiatarka nie ma prawa wołać operatora w tym scenariuszu");
  },
}));

import { STUCK_AFTER_MS } from "@/lib/billing/webhookLog.server";
import { STRIPE_MAX_NETWORK_RETRIES, STRIPE_REQUEST_TIMEOUT_MS } from "@/lib/stripe.server";
import {
  EMPTY_PAYLOAD_ERROR,
  REDACTED_PAYLOAD_ERROR,
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
  unreplayablePayloadError,
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
  /** Cały wynik odczytu ładunku (np. błąd bazy); ma pierwszeństwo przed `payload`. */
  payloadRead?: (rowId: string) => ReturnType<typeof ok> | ReturnType<typeof fail>;
  /**
   * Odczyt pokolenia przejęcia przez rdzeń, gdy wołający go nie podał (trasa,
   * uzgadnianie, panel). Domyślnie wiersza nie widać (`null`).
   */
  claimRead?: () => ReturnType<typeof ok> | ReturnType<typeof fail>;
}

const eqValue = (chain: RecordedChain, column: string): unknown =>
  chain.calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];

/** Przejęcie zawsze zapisuje `received`; domknięcie - status końcowy. */
const isClaim = (chain: RecordedChain): boolean =>
  chain.has("update") &&
  (chain.argsOf("update")?.[0] as { status?: string } | undefined)?.status === "received";

/** Odczyt pokolenia przejęcia (`claimedGeneration`) - kolumny decyzji, bez ładunku. */
const isGenerationRead = (chain: RecordedChain): boolean =>
  chain.table === LOG && chain.argsOf("select")?.[0] === "status, retry_count";

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
    if (isGenerationRead(chain)) return p.claimRead ? p.claimRead() : ok(null);
    // Odczyt ładunku przejętego wiersza.
    if (chain.has("select") && chain.has("maybeSingle")) {
      const rowId = String(eqValue(chain, "id"));
      if (p.payloadRead) return p.payloadRead(rowId);
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
  h.stripe = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("ładunek PO RETENCJI (`_redacted`, SUB-11): `failed` z przyczyną, dyspozytor nie rusza", async () => {
    // Zamknięcie konta pseudonimizuje dziennik OD RAZU (także świeże `failed`
    // w horyzoncie automatu). Baza pomija takie wiersze już na liście
    // kandydatów (pgTAP billing_ops_transport_test) - tu wyścig: retencja
    // zdążyła między odczytem kandydatów a przejęciem. Odtworzenie zapisałoby
    // w księgach wyzerowany e-mail i imię zamiast prawdziwych.
    const redacted = rawCustomerUpdated("evt_sweep_1");
    plan({
      candidates: [row()],
      payload: () => ({
        ...redacted,
        data: { object: { ...redacted.data.object, email: null, name: null } },
        _redacted: { at: FIXED_NOW_ISO, reason: "account_closure" },
      }),
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ failed: 1, processed: 0 });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: REDACTED_PAYLOAD_ERROR,
    });
    // Ani odczytu właściciela, ani zapisu profilu - obsługa nie wystartowała.
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
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

  // Strażnik kolejności subskrypcji porównuje czas ZDARZENIA z zapisanym
  // stanem i rozpoznaje powtórkę po identyfikatorze. Gdyby zamiatarka podała
  // chwilę ponowienia, zdarzenie sprzed godziny wyglądałoby na najnowsze
  // i nadpisało stan zapisany przez późniejsze zdarzenie.
  it("spóźnione zdarzenie subskrypcji: strażnik dostaje czas i identyfikator ZDARZENIA, nowszy stan zostaje", async () => {
    const storedAt = relativeIso(-20 * MINUTA);
    plan({
      candidates: [
        row({
          id: "row-sub",
          event_id: "evt_sub_old",
          event_type: "subscription.updated",
          occurred_at: relativeIso(-50 * MINUTA),
        }),
      ],
      payload: () => ({
        eventType: "subscription.updated",
        data: { id: "sub_1", customerId: "cus_sweep_1", status: "past_due" },
      }),
    });
    db.setResponse("subscriptions", (chain: RecordedChain) => {
      if (chain.has("update")) {
        // Warunek strażnika: zajmuje wyłącznie zdarzenie NOWSZE niż zapisane.
        const stamp = (chain.argsOf("update")?.[0] as { last_event_at: string }).last_event_at;
        return ok(Date.parse(stamp) > Date.parse(storedAt) ? [{ id: "sub-row-1" }] : []);
      }
      return ok({ last_event_at: storedAt, last_event_id: "evt_sub_newer" });
    });
    // Wyrównanie spóźnionego zdarzenia pyta operatora o stan; tu subskrypcji
    // już tam nie ma, więc nie ma czego stosować.
    h.stripe = {
      subscriptions: {
        retrieve: () =>
          Promise.reject(
            Object.assign(new Error("No such subscription"), { code: "resource_missing" }),
          ),
      },
    };

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 1, processed: 1, failed: 0 });
    const subscriptionWrites = db.chainsFor("subscriptions").filter((c) => c.has("update"));
    expect(subscriptionWrites).toHaveLength(1);
    expect(subscriptionWrites[0]!.argsOf("update")?.[0]).toEqual({
      last_event_at: relativeIso(-50 * MINUTA),
      last_event_id: "evt_sub_old",
    });
    expect(eqFilters(subscriptionWrites[0]!)).toEqual([
      ["provider_subscription_id", "sub_1"],
      ["environment", "live"],
    ]);
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({ status: "processed" });
  });

  // IZOLACJA ŚRODOWISK (PAY-05) przez zamiatarkę: wiersz piaskownicy musi
  // dojść do dyspozytora jako piaskownica - jako `live` nadałby na produkcji
  // realne skutki zdarzeniu z karty testowej - i domknąć się w swoim
  // środowisku, także porażką przed obsługą.
  it("wiersz piaskownicy: obsługa i domknięcie w środowisku WIERSZA - na produkcji bez skutków", async () => {
    vi.stubEnv("NODE_ENV", "production");
    plan({
      candidates: [
        row({ id: "row-sbx", event_id: "evt_sbx_1", environment: "sandbox" }),
        row({ id: "row-sbx-empty", event_id: "evt_sbx_2", environment: "sandbox" }),
      ],
      payload: (rowId) => (rowId === "row-sbx-empty" ? {} : rawCustomerUpdated("evt_sbx_1")),
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 2, skipped: 1, failed: 1, processed: 0 });
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
    expect(db.chainsFor("billing_profiles")).toHaveLength(0);
    expect(finishes().map((c) => [c.argsOf("update")?.[0], eqFilters(c)])).toEqual([
      [
        expect.objectContaining({ status: "skipped", error: null }),
        [
          ["event_id", "evt_sbx_1"],
          ["environment", "sandbox"],
          ["status", "received"],
          ["retry_count", 2],
        ],
      ],
      [
        expect.objectContaining({ status: "failed", error: EMPTY_PAYLOAD_ERROR }),
        [
          ["event_id", "evt_sbx_2"],
          ["environment", "sandbox"],
          ["status", "received"],
          ["retry_count", 2],
        ],
      ],
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

  it("wyjątek po przejęciu, który nie jest `Error` (odrzucenie napisem), też domyka wiersz z przyczyną", async () => {
    plan({ candidates: [row()] });
    db.setResponse(LOG, (chain: RecordedChain) => {
      if (isClaim(chain)) return ok([{ id: "row-1" }]);
      if (chain.has("maybeSingle")) throw "ECONNRESET";
      if (chain.has("update")) return ok([{ id: "row-1" }]);
      return fail("test: nieoczekiwany łańcuch");
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ failed: 1, errors: 0 });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: "webhook sweep replay crashed: ECONNRESET",
    });
  });

  // Błąd bazy przy odczycie ładunku wraca w WYNIKU zapytania (supabase-js nie
  // rzuca). Bez jego odczytu `data: null` wyglądałoby na pusty ładunek
  // i przyczyna w panelu kłamałaby („nie ma czego ponowić").
  it("odczyt ładunku po przejęciu padł: `failed` z przyczyną bazy, w pokoleniu przejęcia, bez obsługi", async () => {
    plan({
      candidates: [row({ id: "row-7", event_id: "evt_read_1", retry_count: 3 })],
      payloadRead: () => fail("permission denied for table payment_webhook_events"),
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 1, failed: 1, processed: 0, errors: 0 });
    // Ładunek czytany wyłącznie dla przejętego wiersza, po jego `id`.
    const payloadRead = db.chainsFor(LOG).find((c) => c.has("maybeSingle"))!;
    expect(payloadRead.argsOf("select")).toEqual(["payload"]);
    expect(eqFilters(payloadRead)).toEqual([["id", "row-7"]]);
    expect(finishes()).toHaveLength(1);
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error:
        "webhook sweep payload read failed: permission denied for table payment_webhook_events",
    });
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_read_1"],
      ["environment", "live"],
      ["status", "received"],
      ["retry_count", 4],
    ]);
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
  });

  it("zdarzenie, którego dyspozytor nie obsługuje, kończy jako `skipped` - nie jako fałszywe `processed`", async () => {
    // Wiersz z naprawy o typie spoza dyspozytora: kompletny ładunek, zero skutków.
    plan({
      candidates: [row({ event_type: "payout.created" })],
      payload: () => ({ eventType: "payout.created", data: { id: "po_1", amount: 1200 } }),
    });

    const result = await sweepWebhookEvents();

    expect(result).toMatchObject({ due: 1, skipped: 1, processed: 0, failed: 0 });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({ status: "skipped", error: null });
    expect(eqFilters(finishes()[0]!)).toContainEqual(["retry_count", 2]);
  });

  it("baza oddaje kandydatów jako `null` bez błędu: pusty przebieg, bez wyjątku i bez przejęć", async () => {
    plan();
    h.rpc.respond = () => ({ data: null, error: null });

    const result = await sweepWebhookEvents();

    expect(result).toEqual({
      scanned: 0,
      due: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      busy: 0,
      errors: 0,
      deferred: 0,
      timedOut: 0,
    });
    expect(db.chainsFor(LOG)).toHaveLength(0);
  });

  it.each([
    ["wyjątek transportu", new Error("fetch failed"), "fetch failed"],
    ["odrzucenie napisem", "socket closed", "socket closed"],
  ])(
    "odczyt kandydatów rzuca (%s): wynik z `error`, NIE wyjątek",
    async (_label, thrown, message) => {
      plan();
      h.rpc.respond = () => {
        throw thrown;
      };

      const result = await sweepWebhookEvents();

      expect(result).toMatchObject({
        scanned: 0,
        processed: 0,
        error: `webhook sweep read failed: ${message}`,
      });
      expect(claims()).toHaveLength(0);
    },
  );

  it("termin: wiersz domknięty przed terminem nie zostawia uzbrojonego licznika", async () => {
    // Licznik terminu żyje tyle co wiersz - inaczej każdy przebieg zostawiałby
    // w izolacie timery, które odpalą po odpowiedzi.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(FIXED_NOW_MS);
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" })] });

    const result = await sweepWebhookEvents({ deadlineAt: FIXED_NOW_MS + 60_000 });

    expect(result).toMatchObject({ processed: 2, timedOut: 0, deferred: 0 });
    expect(vi.getTimerCount()).toBe(0);
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

  it("termin: na wiersz, który kończy się PRZED terminem, przebieg czeka - także gdy obsługa trwa", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(FIXED_NOW_MS);
    plan({ candidates: [row({ id: "row-a" }), row({ id: "row-b" })] });
    // Zapis profilu klienta trwa 5 s - dwa wiersze mieszczą się w terminie.
    db.setResponse(
      "billing_profiles",
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(ok([{ id: "profile-1" }])), 5_000);
        }),
    );

    const pending = sweepWebhookEvents({ deadlineAt: FIXED_NOW_MS + WEBHOOK_SWEEP_ROW_BUDGET_MS });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result).toMatchObject({ processed: 2, timedOut: 0, deferred: 0 });
    // Czas obsługi w dzienniku (panel diagnostyczny) to czas TEGO wiersza.
    expect(finishes().map((c) => c.argsOf("update")?.[0])).toEqual([
      expect.objectContaining({ status: "processed", duration_ms: 5_000 }),
      expect.objectContaining({ status: "processed", duration_ms: 5_000 }),
    ]);
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
    // Granica domknięta jak `>= now() - horyzont` w bazie.
    expect(
      isWithinSweepHorizon(
        {
          event_id: "evt_3",
          occurred_at: relativeIso(-WEBHOOK_SWEEP_HORIZON_MS),
          created_at: FIXED_NOW_ISO,
        },
        now,
      ),
    ).toBe(true);
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

  // Ta sama kolejność co `COALESCE(processed_at, last_retried_at, created_at)`
  // w `payment_webhook_sweep_candidates`.
  it("`failed`: ostatnia próba z `processed_at`, bez niego z `last_retried_at`, potem z `created_at`", () => {
    const failed = (stamps: Partial<WebhookSweepRow>) =>
      row({ retry_count: 0, processed_at: null, last_retried_at: null, ...stamps });

    // `last_retried_at` sprzed 4 min, choć wiersz ma godzinę - jeszcze w odstępie.
    expect(isDueForSweep(failed({ last_retried_at: relativeIso(-4 * MINUTA) }), now)).toBe(false);
    expect(isDueForSweep(failed({ last_retried_at: relativeIso(-5 * MINUTA) }), now)).toBe(true);
    // Pierwsza próba bez żadnego przejęcia: od utworzenia wiersza.
    expect(isDueForSweep(failed({ created_at: relativeIso(-4 * MINUTA) }), now)).toBe(false);
    expect(isDueForSweep(failed({ created_at: relativeIso(-5 * MINUTA) }), now)).toBe(true);
    // Chwila porażki ma pierwszeństwo przed chwilą przejęcia: obsługa trwała
    // 6 min, więc odstęp liczy się od jej końca, nie od startu.
    expect(
      isDueForSweep(
        failed({
          processed_at: relativeIso(-4 * MINUTA),
          last_retried_at: relativeIso(-10 * MINUTA),
        }),
        now,
      ),
    ).toBe(false);
  });

  it("`failed` bez ŻADNEGO znacznika czasu jest do wzięcia od razu - sufit prób ogranicza powtórki", () => {
    const bare = row({ processed_at: null, last_retried_at: null, created_at: null });

    expect(isDueForSweep({ ...bare, retry_count: 7 }, now)).toBe(true);
    expect(isDueForSweep({ ...bare, retry_count: 8 }, now)).toBe(false);
  });

  it("porzucenia `received` bez znacznika przejęcia nie da się dowieść - nie jest do wzięcia", () => {
    expect(
      isDueForSweep(
        row({ status: "received", processed_at: null, last_retried_at: null, created_at: null }),
        now,
      ),
    ).toBe(false);
  });

  it("brak licznika prób to zero prób: odstęp 5 min, nie natychmiast", () => {
    const noCount = (minAgo: number) =>
      row({ retry_count: null, processed_at: relativeIso(-minAgo * MINUTA) });

    expect(isDueForSweep(noCount(4), now)).toBe(false);
    expect(isDueForSweep(noCount(5), now)).toBe(true);
  });

  it("horyzont bez czytelnego znacznika czasu: poza automatem (także naprawa bez `created_at`)", () => {
    expect(
      isWithinSweepHorizon({ event_id: "evt_4", occurred_at: null, created_at: null }, now),
    ).toBe(false);
    // Naprawa liczy wiek WYŁĄCZNIE od wiersza - świeże `occurred_at` jej nie ratuje.
    expect(
      isWithinSweepHorizon(
        { event_id: "reconcile_cs_2_4085000000", occurred_at: FIXED_NOW_ISO, created_at: null },
        now,
      ),
    ).toBe(false);
    expect(
      isWithinSweepHorizon({ event_id: "evt_5", occurred_at: "nie-data", created_at: null }, now),
    ).toBe(false);
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

  it("wyjątek obsługi, który nie jest `Error`, trafia do dziennika jako tekst", async () => {
    plan();
    db.setResponse("subscriptions", () => {
      throw "upstream reset";
    });

    const outcome = await processClaimedWebhookEvent({
      eventId: "evt_core_5",
      environment: "live",
      occurredAt: FIXED_NOW_ISO,
      normalized: { eventType: "customer.updated", data: { id: "cus_1" } },
      generation: 1,
    });

    expect(outcome).toMatchObject({ status: "failed", error: "upstream reset" });
    expect(finishes()[0]!.argsOf("update")?.[0]).toMatchObject({
      status: "failed",
      error: "upstream reset",
    });
  });
});

// PRZEGLĄD 3.4 dla wołających bez pokolenia (trasa webhooka, uzgadnianie,
// ponowienie z panelu). Bez strażnika ponowienie z panelu, które przeciągnęło
// się ponad okno porzucenia, nadpisywało wiersz przejęty w międzyczasie przez
// zamiatarkę.
describe("processClaimedWebhookEvent - pokolenie odczytane z wiersza tuż po przejęciu", () => {
  const event = {
    eventId: "evt_gen_1",
    environment: "live" as const,
    occurredAt: FIXED_NOW_ISO,
    normalized: {
      eventType: "customer.updated",
      data: { id: "cus_sweep_1", email: "anna@example.com" },
    },
  };

  it("wiersz `received` po przejęciu: jego licznik strzeże domknięcia, a odczyt pada PRZED obsługą", async () => {
    plan({ claimRead: () => ok({ status: "received", retry_count: 3 }) });

    const outcome = await processClaimedWebhookEvent(event);

    expect(outcome).toMatchObject({ status: "processed", error: null, finish: "finished" });
    const read = db.chains.find(isGenerationRead)!;
    expect(eqFilters(read)).toEqual([
      ["event_id", "evt_gen_1"],
      ["environment", "live"],
    ]);
    // Po obsłudze wiersz mógł już przejąć ktoś inny - pokolenie musi być
    // znane, zanim ruszy dyspozytor.
    expect(db.chains.indexOf(read)).toBeLessThan(
      db.chains.findIndex((c) => c.table === "subscriptions"),
    );
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_gen_1"],
      ["environment", "live"],
      ["status", "received"],
      ["retry_count", 3],
    ]);
  });

  it("nowy wiersz trasy (pokolenie 0) też dostaje strażnika - zero to nie „brak pokolenia”", async () => {
    plan({ claimRead: () => ok({ status: "received", retry_count: 0 }) });

    await processClaimedWebhookEvent({ ...event, normalized: null });

    expect(eqFilters(finishes()[0]!)).toContainEqual(["retry_count", 0]);
  });

  it("ponowienie w imieniu admina: odczyt pokolenia i domknięcie zawężone do najemcy", async () => {
    plan({ claimRead: () => ok({ status: "received", retry_count: 2 }) });

    await processClaimedWebhookEvent({ ...event, normalized: null, tenantId: "tenant-alfa" });

    expect(eqFilters(db.chains.find(isGenerationRead)!)).toEqual([
      ["event_id", "evt_gen_1"],
      ["environment", "live"],
      ["tenant_id", "tenant-alfa"],
    ]);
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_gen_1"],
      ["environment", "live"],
      ["tenant_id", "tenant-alfa"],
      ["status", "received"],
      ["retry_count", 2],
    ]);
  });

  // Pokolenie 0 to nowy wiersz z wstawienia (`claimWebhookEventWithGeneration`)
  // - pełnoprawne pokolenie, nie „brak pokolenia".
  it.each([5, 0])(
    "pokolenie %i podane przez wołającego - bez dodatkowego odczytu wiersza",
    async (generation) => {
      plan();

      await processClaimedWebhookEvent({ ...event, normalized: null, generation });

      expect(db.chains.filter(isGenerationRead)).toHaveLength(0);
      expect(eqFilters(finishes()[0]!)).toContainEqual(["retry_count", generation]);
    },
  );

  it("odczyt pokolenia padł: obsługa NIE jest blokowana, domknięcie wraca do zapisu po kluczu (z logiem)", async () => {
    plan({ claimRead: () => fail("canceling statement due to statement timeout") });

    const outcome = await processClaimedWebhookEvent(event);

    expect(outcome).toMatchObject({ status: "processed", finish: "finished" });
    expect(db.lastChain("billing_profiles")?.argsOf("update")?.[0]).toMatchObject({
      email: "anna@example.com",
    });
    expect(eqFilters(finishes()[0]!)).toEqual([
      ["event_id", "evt_gen_1"],
      ["environment", "live"],
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      "[payments] webhook claim generation unreadable",
      "evt_gen_1",
      expect.objectContaining({ message: "canceling statement due to statement timeout" }),
    );
  });

  it.each([
    ["wiersza nie widać", null, null],
    ["wiersz ma już status końcowy", { status: "processed", retry_count: 4 }, "processed"],
  ])(
    "%s: domknięcie po kluczu, ostrzeżenie ze stanem wiersza",
    async (_label, data, loggedStatus) => {
      plan({ claimRead: () => ok(data) });

      await processClaimedWebhookEvent({ ...event, normalized: null });

      expect(eqFilters(finishes()[0]!)).toEqual([
        ["event_id", "evt_gen_1"],
        ["environment", "live"],
      ]);
      expect(console.warn).toHaveBeenCalledWith(
        "[payments] webhook claim generation unknown - domknięcie bez strażnika pokolenia",
        "evt_gen_1",
        loggedStatus,
      );
    },
  );
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

  it("surowe zdarzenie z PUSTYM obiektem danych to `null` - normalizacja nie ma czego oddać", async () => {
    // `customer.updated` z `{ object: {} }` normalizuje się do `{}`: obsługa nie
    // zrobiłaby nic, a wpis `processed` udawałby, że coś się stało.
    const payload = { ...rawCustomerUpdated("evt_empty"), data: { object: {} } };

    await expect(
      loggedWebhookEvent({ event_type: "customer.updated", payload }),
    ).resolves.toBeNull();
    expect(unreplayablePayloadError(payload)).toBe(EMPTY_PAYLOAD_ERROR);
  });

  it.each([
    ["`data` bez `object`", { id: "cus_1", email: "anna@example.com" }],
    ["`data.object` jako tablica", { object: [], id: "cus_1" }],
  ])(
    "pola zdarzenia operatora, ale %s: to NIE surowe zdarzenie - dane idą wprost z typem z kolumny",
    async (_label, data) => {
      // Przez normalizację operatora poszłoby `object = {}` i odtworzenie
      // zgubiłoby cały zapisany obiekt.
      await expect(
        loggedWebhookEvent({
          event_type: "customer.updated",
          payload: { id: "evt_x", type: "customer.updated", created: 1, data },
        }),
      ).resolves.toEqual({ normalized: { eventType: "customer.updated", data } });
    },
  );

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
    expect(unreplayablePayloadError(payload)).toBe(EMPTY_PAYLOAD_ERROR);
  });

  // AUDYT SUB-11: retencja dopisuje `_redacted: { at, reason }` do KAŻDEGO
  // kształtu, a ładunek dalej wygląda na kompletny (identyfikatory, kwoty).
  // Bez tej odmowy zamiatarka i panel odtwarzałyby zdarzenie z wyzerowanym
  // e-mailem, imieniem i adresem.
  it.each([
    [
      "surowe zdarzenie operatora",
      {
        ...rawCustomerUpdated("evt_r1"),
        _redacted: { at: FIXED_NOW_ISO, reason: "retention" },
      },
    ],
    [
      "`{ eventType, data }` z naprawy",
      {
        eventType: "customer.updated",
        data: { id: "cus_1", email: null },
        _redacted: { at: FIXED_NOW_ISO, reason: "retention" },
      },
    ],
    [
      "sam obiekt danych",
      { id: "cus_1", email: null, _redacted: { at: FIXED_NOW_ISO, reason: "account_closure" } },
    ],
  ])("ładunek po retencji (%s) to `null` z przyczyną „zanonimizowany”", async (_label, payload) => {
    await expect(
      loggedWebhookEvent({ event_type: "customer.updated", payload }),
    ).resolves.toBeNull();
    expect(unreplayablePayloadError(payload)).toBe(REDACTED_PAYLOAD_ERROR);
    expect(REDACTED_PAYLOAD_ERROR).toMatch(/zanonimizowany/);
  });

  it("pole `_redacted` bez znacznika-obiektu nie blokuje odtworzenia (znacznik pisze tylko baza)", async () => {
    await expect(
      loggedWebhookEvent({
        event_type: "customer.updated",
        payload: { eventType: "customer.updated", data: { id: "cus_1" }, _redacted: null },
      }),
    ).resolves.toEqual({ normalized: { eventType: "customer.updated", data: { id: "cus_1" } } });
  });
});
