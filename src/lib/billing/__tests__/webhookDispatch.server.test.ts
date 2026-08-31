// Rdzeń obsługi zdarzeń operatora płatności - GAŁĘZIE ODMOWY (49% gałęzi,
// 46 niepokrytych linii do 31.08.2026).
//
// SKĄD LUKA. Jedyny test dotykający dotąd tego modułu (`-webhook.test.ts`)
// jedzie SZCZĘŚLIWĄ ŚCIEŻKĄ trasy HTTP: zdarzenie poprawne, ładunek pełny,
// baza odpowiada bez błędu. Poza zasięgiem został cały ruch, którym system
// odmawia: spóźniona i powtórzona dostawa, zdarzenie nieznanego typu,
// uszkodzony ładunek, zamówienie z INNEGO ŚRODOWISKA, korekty rozliczeniowe
// (zwroty i spory) oraz błędy bazy w strażniku kolejności.
//
// DLACZEGO TO JEST RYZYKO, A NIE POKRYCIE DLA POKRYCIA. Ten plik jest jedynym
// miejscem, przez które pieniądze zamieniają się w uprawnienia. Każda gałąź
// odmowy pilnuje innego pieniężnego błędu:
//   * POWTÓRKA. Operator ponawia dostarczenie tego samego zdarzenia, a panel
//     admina potrafi je odtworzyć ręcznie. Drugi przebieg NIE MOŻE zdublować
//     skutku ani cofnąć nowszego stanu (strażnik `last_event_at`).
//   * CUDZE ZAMÓWIENIE. Webhook sandboxa nie ma prawa zrealizować zamówienia
//     ze środowiska produkcyjnego (karta testowa -> prawdziwy bilet).
//   * USZKODZONY ŁADUNEK. Ma polec GŁOŚNO (dziennik zapisze `failed`), a nie
//     zapisać połowę skutku.
//   * NIEZNANY TYP. Ma być `skipped` bez ANI JEDNEGO zapytania do bazy -
//     operator wysyła dziesiątki typów, których integracja nie obsługuje.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (`client.server`) i SDK
// operatora (`stripe.server`). Sąsiedzi z `@/lib/billing/*` i
// `@/lib/organizations/*` biegną PRAWDZIWYM kodem - inaczej test dowodziłby
// tylko tego, że dispatch woła własne atrapy. Żadne żądanie nie wychodzi do
// sieci: klient operatora jest atrapą, a warstwa mailowa nie ma w teście
// klienta serwisowego (`sendTxEmail` kończy się `supabase_unavailable`).
//
// RODO: wszystkie adresy są syntetyczne (`example.com`), identyfikatory
// operatora zmyślone.
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
  type TableResponder,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { SubscriptionData, TransactionData } from "@/lib/billing/webhookDispatch.server";

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => rpc.rpc(name, args),
  },
}));

// Granica operatora. Atrapa jest tu BEZPIECZNIKIEM: gdyby któraś ścieżka
// (np. zwrot za nadkomplet miejsc) sięgnęła po klienta Stripe, test ma polec
// z jawnym komunikatem, a nie wyjść do sieci z kluczem ze środowiska.
vi.mock("@/lib/stripe.server", () => ({
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  createStripeClient: () => {
    throw new Error("test: żaden przypadek nie ma prawa wołać operatora");
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "sandbox",
  verifyWebhook: () => {
    throw new Error("test: weryfikacja podpisu nie należy do tej warstwy");
  },
}));

const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

/** Tabele, których dotyka rozgałęziona obsługa - domyślnie „pusto, bez błędu". */
const TABLES = [
  "subscriptions",
  "user_subscriptions",
  "access_plans",
  "payment_orders",
  "billing_documents",
  "billing_profiles",
  "donations",
  "notifications",
  "crm_leads",
  "profiles",
  "newsletter_subscribers",
  "member_organizations",
  "event_rsvps",
  "membership_grants",
] as const;

const OCCURRED_AT = "2026-08-30T10:00:00.000Z";
const LATER = "2026-08-30T11:00:00.000Z";

/**
 * Zdarzenie subskrypcji w kształcie, jaki dostaje dispatch PO normalizacji
 * (`stripeEvents.server`): `externalId` ceny to `lookup_key`, a produktu -
 * `metadata.lovable_external_id`. Domyślnie plan spoza cennika zespołowego,
 * żeby przypadek nie wciągał ścieżki miejsc organizacji.
 */
function subscriptionEvent(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: "sub_atrapa_1",
    customerId: "cus_atrapa_1",
    status: "active",
    customData: { userId: "user-kupujacy" },
    currentBillingPeriod: {
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
    },
    items: [
      {
        quantity: 1,
        price: { id: "pri_atrapa", externalId: "pro_monthly" },
        product: { id: "prod_atrapa", externalId: "plan_pro" },
      },
    ],
    ...overrides,
  };
}

/** Transakcja (faktura / sesja) w kształcie po normalizacji. */
function transactionEvent(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    id: "txn_atrapa_1",
    subscriptionId: "sub_atrapa_1",
    customerId: "cus_atrapa_1",
    paymentIntentId: "pi_atrapa_1",
    currencyCode: "PLN",
    customData: null,
    customer: { email: "kupujacy@example.com" },
    details: { totals: { grandTotal: "4900" } },
    ...overrides,
  };
}

interface SubscriptionsPlan {
  /** Czy warunkowy UPDATE strażnika zajął zdarzenie (zwrócił wiersz). */
  claimed?: boolean;
  /** Wiersz oddawany przez `maybeSingle()` (odczyt istniejącej subskrypcji). */
  row?: Record<string, unknown> | null;
  claimError?: string;
  lookupError?: string;
  writeError?: string;
}

/**
 * Jeden responder na tabelę `subscriptions` rozróżnia TRZY różne zapytania,
 * które robi ta ścieżka: warunkowy UPDATE strażnika kolejności
 * (`update(...).select("id")` - zwraca wiersze), odczyt stanu (`maybeSingle`)
 * i zwykły zapis (`update` / `upsert`).
 */
function subscriptionsResponder(plan: SubscriptionsPlan): TableResponder {
  return (chain: RecordedChain) => {
    if (chain.has("update") && chain.has("select")) {
      if (plan.claimError) return fail(plan.claimError);
      return ok(plan.claimed === false ? [] : [{ id: "row_dziennika" }]);
    }
    if (chain.has("maybeSingle")) {
      if (plan.lookupError) return fail(plan.lookupError);
      return ok(plan.row ?? null);
    }
    if (chain.has("update") || chain.has("upsert")) {
      return plan.writeError ? fail(plan.writeError) : ok(null);
    }
    return ok(null);
  };
}

/** Zapytania (ogniwa łańcucha) wykonane na tabeli - do asercji „nic nie tknęło". */
const writesOn = (table: string): RecordedChain[] =>
  db
    .chainsFor(table)
    .filter((c) => c.has("insert") || c.has("update") || c.has("upsert") || c.has("delete"));

/** Ładunek zapisu (pierwszy argument `update`/`insert`/`upsert`) z tabeli. */
function writePayload(table: string, method: "update" | "insert" | "upsert"): unknown {
  return db
    .chainsFor(table)
    .find((c) => c.has(method))
    ?.argsOf(method)?.[0];
}

beforeEach(() => {
  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  for (const table of TABLES) db.setResponse(table, ok(null));
});

describe("zdarzenie spoza zakresu integracji", () => {
  it("nieznany typ zdarzenia jest POMIJANY bez jednego zapytania do bazy", async () => {
    // Operator wysyła dziesiątki typów, których nie obsługujemy
    // (`payout.*`, `checkout.session.expired`, ...). Każde takie zdarzenie ma
    // dostać ACK bez śladu w bazie - inaczej integracja płaciłaby zapytaniem
    // za każdy szum z konta operatora, a dziennik pokazywałby ruch, którego
    // nie ma.
    const outcome = await dispatchWebhookEvent({
      eventType: "payout.created",
      data: { id: "po_atrapa", kwota: 1000 },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
  });

  it("nieznany typ ze ŚMIECIOWYM ładunkiem też jest tylko pominięty", async () => {
    // Kolejność ma znaczenie: rozpoznanie typu MUSI iść przed dotknięciem
    // ładunku. Gdyby dispatch zaglądał do danych przed `switch`em, zdarzenie
    // spoza zakresu z pustym ładunkiem wywracałoby obsługę i operator
    // ponawiałby je przez trzy doby.
    const outcome = await dispatchWebhookEvent({
      eventType: "nieznany.typ",
      data: null,
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(db.chains).toHaveLength(0);
  });

  it("uszkodzony ładunek zdarzenia subskrypcji pada GŁOŚNO i nic nie zapisuje", async () => {
    // Ładunek `null` przy typie, który obsługujemy, znaczy „normalizacja albo
    // dziennik są zepsute". Odmowa musi być wyjątkiem, bo tylko wtedy trasa
    // zapisze zdarzenie jako `failed` i pokaże je w panelu. Cichy `skipped`
    // udawałby zdarzenie spoza zakresu i sprawa zniknęłaby z oczu.
    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: null,
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow();

    expect(db.chains).toHaveLength(0);
  });
});

describe("strażnik kolejności zdarzeń subskrypcji (idempotencja)", () => {
  it("pierwsza dostawa: zdarzenie zajmuje wiersz i przenosi stan na subskrypcję", async () => {
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        // Subskrypcja bez właściciela: skutki uprawnień mają własne testy,
        // tutaj interesuje nas SAM strażnik i zapis stanu.
        row: { user_id: null, price_id: "pro_monthly", status: "active", current_period_end: null },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.past_due",
      data: subscriptionEvent({ status: "past_due" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    const claim = db.chainsFor("subscriptions")[0];
    expect(claim?.argsOf("update")?.[0]).toEqual({ last_event_at: OCCURRED_AT });
    // Warunek atomowy: zajmujemy wyłącznie wiersz starszy niż zdarzenie.
    expect(claim?.argsOf("or")?.[0]).toBe(`last_event_at.is.null,last_event_at.lt.${OCCURRED_AT}`);
    expect(writePayload("subscriptions", "update")).toMatchObject({ last_event_at: OCCURRED_AT });
    const stateWrite = db
      .chainsFor("subscriptions")
      .find((c) => c.has("update") && !c.has("select"));
    expect(stateWrite?.argsOf("update")?.[0]).toMatchObject({ status: "past_due" });
  });

  it("POWTÓRZONA dostawa tego samego zdarzenia nie dubluje skutku", async () => {
    // Idempotencja stoi na warunku `last_event_at < occurredAt`: przy DRUGIM
    // przebiegu tego samego zdarzenia znacznik jest już równy, więc warunkowy
    // UPDATE nie zajmuje wiersza. Bez tej gałęzi ponowna dostawa (albo
    // ponowienie z panelu admina) przeliczałaby uprawnienia i CRM po raz drugi.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: false,
        row: { id: "sub-baza-1" },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    // Dwa zapytania: próba zajęcia + sprawdzenie, czy wiersz w ogóle istnieje.
    expect(db.chainsFor("subscriptions")).toHaveLength(2);
    // ŻADNEGO zapisu stanu poza samą próbą zajęcia.
    const stateWrites = db
      .chainsFor("subscriptions")
      .filter((c) => c.has("update") && !c.has("select"));
    expect(stateWrites).toHaveLength(0);
    expect(writesOn("user_subscriptions")).toHaveLength(0);
    expect(writesOn("crm_leads")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("SPÓŹNIONA rezygnacja nie cofa nowszego stanu subskrypcji", async () => {
    // `subscription.canceled` sprzed godziny dostarczone PO wznowieniu
    // skasowałoby dostęp klientowi, który właśnie zapłacił. Ta sama bramka co
    // wyżej, ale osobna gałąź w `switch` - i osobne pieniądze.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: false, row: { id: "sub-baza-1" } }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled" }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    const cancelWrites = db
      .chainsFor("subscriptions")
      .filter((c) => c.has("update") && !c.has("select"));
    expect(cancelWrites).toHaveLength(0);
  });

  it("zdarzenie, które wyprzedziło `created`, NIE jest pomijane - zakłada wiersz", async () => {
    // Zero zajętych wierszy ma dwa znaczenia: „stan jest nowszy" (pomijamy)
    // albo „subskrypcji jeszcze nie ma" (zakładamy ją). Rozróżnia je dopiero
    // odczyt istnienia - bez niego pierwszy zakup przepadałby po cichu, gdyby
    // operator dostarczył `activated` przed `created`.
    db.setResponse("subscriptions", subscriptionsResponder({ claimed: false, row: null }));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.activated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("subscriptions", "upsert")).toMatchObject({
      user_id: "user-kupujacy",
      provider_subscription_id: "sub_atrapa_1",
      price_id: "pro_monthly",
      status: "active",
      last_event_at: OCCURRED_AT,
    });
  });

  it("zdarzenie bez wiarygodnego czasu nie blokuje aktualizacji ISTNIEJĄCEJ subskrypcji", async () => {
    // Uszkodzony `occurredAt` nie może zatrzymać obsługi - inaczej ponowienie
    // z panelu admina na wierszu dziennika bez czasu nigdy by nie ruszyło.
    // Strażnik przepuszcza wtedy zdarzenie BEZ zajmowania wiersza (nie ma
    // czym porównać kolejności), a stan i tak trafia do subskrypcji.
    //
    // Zdarzenie jest dodatkowo BEZ pozycji cennika, a wiersz w bazie bez
    // zapisanej ceny - to najuboższy możliwy stan (pauza subskrypcji sprzed
    // migracji cennika). Obsługa ma wtedy zapisać sam stan i nie próbować
    // przeliczać uprawnień z ceny, której nie zna.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        row: { user_id: null, status: "active", current_period_end: null },
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent({
        status: "paused",
        items: [{ quantity: 1, price: { id: "pri_atrapa", externalId: null }, product: null }],
      }),
      environment: "live",
      occurredAt: "nie-data",
    });

    expect(outcome).toBe("processed");
    // Pominięty strażnik: pierwsze zapytanie to od razu odczyt stanu, a nie
    // warunkowy `update(...).select("id")`.
    expect(db.chainsFor("subscriptions")[0]?.has("update")).toBe(false);
    expect(writePayload("subscriptions", "update")).toMatchObject({ status: "paused" });
  });

  // DEFEKT NAPRAWIONY 31.08.2026 (kod produkcyjny).
  //
  // CO BYŁO ZŁE. `claimSubscriptionEvent` miał JAWNĄ decyzję projektową dla
  // zdarzenia bez wiarygodnego czasu: „brak wiarygodnego czasu - nie
  // blokujemy" i przepuszczał je dalej. Trzy kroki niżej ta sama wartość
  // trafiała bez żadnej osłony do `new Date(occurredAt).toISOString()`
  // w `handleCreated` i wywalała `RangeError: Invalid time value`. Moduł sam
  // sobie przeczył: najpierw obiecywał tolerancję, a potem padał na dokładnie
  // tej wartości, którą przepuścił. Trafiała w to WYŁĄCZNIE ścieżka
  // „zdarzenie stanu wyprzedziło `created`" - czyli ta, która istnieje po to,
  // żeby zakup nie przepadł, gdy operator dostarczy zdarzenia w złej
  // kolejności.
  //
  // JAKIE TO BYŁO RYZYKO. Skutkiem był wyjątek zamiast zapisu: trasa zwracała
  // 500, dziennik zapisywał `failed`, operator ponawiał dostawę przez trzy
  // doby (a każda próba padała tak samo), a klient przez ten czas nie miał
  // uprawnienia, za które zapłacił. Ponowienie z panelu admina też nie
  // pomagało, bo idzie tą samą funkcją.
  //
  // JAK NAPRAWIONE. Rozstrzygnięcie czasu zdarzenia zamieszkało w jednej
  // funkcji `eventStamp` (`webhookDispatch.server.ts`): strażnik kolejności
  // i `handleCreated` czytają ją tak samo, a czas nie do odczytania znaczy
  // teraz „bez `last_event_at`", a nie „wyjątek".
  it("zdarzenie bez wiarygodnego czasu zakłada brakującą subskrypcję", async () => {
    db.setResponse("subscriptions", subscriptionsResponder({ claimed: false, row: null }));

    // Obsługa domyka się, zamiast wywalać na dacie, którą strażnik świadomie
    // przepuścił.
    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.activated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: "nie-data",
      }),
    ).resolves.toBe("processed");
  });

  it("błąd bazy w strażniku przerywa obsługę zamiast zgadywać kolejność", async () => {
    // Gdyby błąd zajęcia był traktowany jak „nie zajęto", zdarzenie zostałoby
    // pominięte i klient nie dostałby uprawnienia mimo obciążenia. Wyjątek
    // wraca do trasy, ta zapisuje `failed`, a operator ponawia dostawę.
    db.setResponse("subscriptions", subscriptionsResponder({ claimError: "deadlock detected" }));

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription event claim failed: deadlock detected");
  });

  it("błąd bazy przy sprawdzaniu istnienia subskrypcji też przerywa obsługę", async () => {
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: false, lookupError: "connection reset" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.updated",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscription lookup failed: connection reset");
  });
});

describe("aktualizacja stanu subskrypcji - odmowy i przypadki brzegowe", () => {
  it("nieudany zapis stanu przerywa obsługę zamiast udawać sukces", async () => {
    // Zapis stanu jest tu jedynym śladem zdarzenia. Połknięty błąd oznacza
    // dziennik z `processed` przy subskrypcji, która w bazie ma stary status -
    // czyli panel admina kłamie o tym, za co klient płaci.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        row: { user_id: null, price_id: "pro_monthly", status: "active", current_period_end: null },
        writeError: "column does not exist",
      }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.paused",
        data: subscriptionEvent({ status: "paused" }),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions update failed: column does not exist");
  });

  it("cena bez odpowiednika w cenniku nie wywraca obsługi zdarzenia", async () => {
    // Plan wycofany z `access_plans` (albo jeszcze nie wdrożony) zostawia
    // subskrypcję z ceną, dla której nie ma planu. Uprawnienia nie da się
    // wtedy przeliczyć - ale zdarzenie MUSI się domknąć, bo inaczej operator
    // ponawiałby je w kółko za każdą zmianę stanu takiej subskrypcji.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        // Wiersz bez `status`: poprzedni stan jest nieznany, co samo w sobie
        // jest osobną gałęzią (`previousStatus: null`).
        row: { user_id: "user-kupujacy", price_id: "pro_monthly", current_period_end: null },
      }),
    );
    db.setResponse("access_plans", ok(null));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    // Bez planu nie ruszamy warstwy dostępu - lepiej brak zmiany niż
    // uprawnienie bez planu, którego panel nie umie pokazać.
    expect(writesOn("user_subscriptions")).toHaveLength(0);
  });

  it("podniesienie planu przenosi uprawnienie i zawiadamia klienta", async () => {
    // Ścieżka zmiany planu (`plus` -> `pro`) jest jedyną, w której zdarzenie
    // zmienia WARSTWĘ dostępu, a nie tylko datę. Bez niej klient płaciłby za
    // wyższy plan, mając uprawnienia niższego.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({
        claimed: true,
        row: {
          user_id: "user-kupujacy",
          price_id: "plus_monthly",
          status: "active",
          current_period_end: "2026-09-01T00:00:00.000Z",
        },
      }),
    );
    db.setResponse(
      "access_plans",
      ok({ id: "plan-pro-m", tenant_id: "tenant-alfa", price_cents: 9900, currency: "PLN" }),
    );
    db.setResponse("user_subscriptions", (chain: RecordedChain) =>
      chain.has("maybeSingle") ? ok(null) : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("subscriptions", "update")).toMatchObject({ last_event_at: OCCURRED_AT });
    // Uprawnienie zakłada się na NOWYM planie.
    expect(writePayload("user_subscriptions", "insert")).toMatchObject({
      user_id: "user-kupujacy",
      plan_id: "plan-pro-m",
    });
    // Dzwonek o zmianie planu - klient ma zobaczyć, że dopłata coś dała.
    expect(writePayload("notifications", "insert")).toMatchObject({ user_id: "user-kupujacy" });
  });
});

describe("rezygnacja z subskrypcji", () => {
  it("rezygnacja subskrypcji nieznanej w bazie nie odbiera niczyich uprawnień", async () => {
    // `subscription.canceled` dla wiersza, którego u nas nie ma (inne
    // środowisko, subskrypcja sprzed migracji), nie ma komu odebrać dostępu.
    // Brak właściciela MUSI kończyć obsługę, zanim ruszy warstwa uprawnień.
    db.setResponse("subscriptions", subscriptionsResponder({ claimed: true, row: null }));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      data: subscriptionEvent({ status: "canceled", currentBillingPeriod: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("user_subscriptions")).toHaveLength(0);
    expect(writesOn("crm_leads")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("nieudany zapis rezygnacji przerywa obsługę", async () => {
    // Cicha porażka tutaj zostawiłaby subskrypcję jako aktywną po rezygnacji -
    // czyli obietnicę dostępu, za który nikt już nie płaci.
    db.setResponse(
      "subscriptions",
      subscriptionsResponder({ claimed: true, row: null, writeError: "permission denied" }),
    );

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.canceled",
        data: subscriptionEvent({ status: "canceled" }),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions cancel failed: permission denied");
  });
});

describe("zakładanie subskrypcji - odmowy", () => {
  it("brak `customData.userId` nie zakłada subskrypcji-sieroty", async () => {
    // Bez właściciela wiersz `subscriptions` byłby nie do powiązania z kontem:
    // klient płaci, panel pokazuje subskrypcję bez użytkownika, a uprawnienia
    // nie ma. Lepiej nie zapisać nic i zostawić ślad w logu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({ customData: {} }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("brak identyfikatorów cennika (lookup_key / metadata) nie zapisuje niczego", async () => {
    // `price.externalId` i `product.externalId` to JEDYNE powiązanie ceny
    // operatora z planem w aplikacji. Zapis bez nich dałby subskrypcję, której
    // nie da się przełożyć na warstwę dostępu ani na zmianę planu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({
        items: [{ quantity: 1, price: { id: "pri_atrapa", externalId: null }, product: null }],
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("zdarzenie bez okresu rozliczeniowego zapisuje puste daty, a nie zgadywane", async () => {
    // `subscription.created` bez okresu (import subskrypcji, plan bez cyklu)
    // nie może wymyślić daty końca dostępu. Zgadnięta data to albo dostęp
    // gratis, albo odcięcie płacącego klienta - obie pomyłki kosztują.
    db.setResponse("subscriptions", subscriptionsResponder({ row: null }));

    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.created",
      data: subscriptionEvent({ currentBillingPeriod: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("subscriptions", "upsert")).toMatchObject({
      current_period_start: null,
      current_period_end: null,
      trial_ends_at: null,
    });
  });

  it("nieudany zapis subskrypcji jest błędem, nie cichym „przetworzono”", async () => {
    // Gdyby ten błąd był połykany, dziennik pokazałby `processed` przy
    // subskrypcji, której w bazie nie ma - czyli najgorszy możliwy stan:
    // pieniądze pobrane, ślad zgubiony, operator nie ponowi.
    db.setResponse("subscriptions", subscriptionsResponder({ writeError: "unique violation" }));

    await expect(
      dispatchWebhookEvent({
        eventType: "subscription.created",
        data: subscriptionEvent(),
        environment: "live",
        occurredAt: OCCURRED_AT,
      }),
    ).rejects.toThrow("subscriptions upsert failed: unique violation");
  });
});

describe("subskrypcja darowizny - poza ścieżką uprawnień", () => {
  it("darowizna cykliczna idzie do rejestru wpłat, nie do `subscriptions`", async () => {
    // Darowizna nie jest planem dostępu: nie ma odpowiednika w cenniku i nie
    // nadaje żadnej warstwy. Wpuszczenie jej w zwykłą ścieżkę subskrypcji
    // dałoby wpłacającemu uprawnienia płatnego planu.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: subscriptionEvent({
        status: "active",
        customData: { purpose: "donation", donationId: "don-1" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chainsFor("subscriptions")).toHaveLength(0);
    expect(writePayload("donations", "update")).toMatchObject({
      provider_subscription_id: "sub_atrapa_1",
      recurring: true,
    });
  });

  it("rezygnacja z darowizny cyklicznej zamyka ją statusem `canceled`", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.canceled",
      data: subscriptionEvent({
        status: "active",
        customData: { purpose: "donation", donationId: "don-1" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    // Status bierzemy z TYPU zdarzenia, nie z pola `status` ładunku - operator
    // zostawia w nim czasem ostatni znany stan subskrypcji.
    expect(writePayload("donations", "update")).toMatchObject({ status: "canceled" });
  });

  it("darowizna bez identyfikatora wpłaty i bez statusu nie zapisuje nic na ślepo", async () => {
    // Bez `donationId` nie wiadomo, KTÓRĄ wpłatę oznaczyć, a stan inny niż
    // końcowy nie daje podstawy do masowej aktualizacji po samym
    // identyfikatorze subskrypcji. Wybór jest świadomy: lepiej nie ruszyć
    // rejestru wpłat, niż podpiąć cudzą darowiznę pod tę subskrypcję.
    // Ładunek podany LITERAŁEM (a nie fabryką), bo modeluje zdarzenie operatora
    // BEZ pola `status` - typ `SubscriptionData` wymaga tego pola, a obsługa i
    // tak ma na nie zapasowe „active". Wejście `dispatchWebhookEvent` przyjmuje
    // `unknown`, więc żadne rzutowanie nie jest tu potrzebne.
    const outcome = await dispatchWebhookEvent({
      eventType: "subscription.updated",
      data: { id: "sub_atrapa_1", customerId: "cus_atrapa_1", customData: { purpose: "donation" } },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("donations")).toHaveLength(0);
  });
});

describe("windykacja - nieudane i odzyskane obciążenie", () => {
  it("nieudane obciążenie nieznanej subskrypcji nic nie zapisuje", async () => {
    // Zdarzenie o subskrypcji, której u nas nie ma (inne środowisko, konto
    // sprzed migracji), nie może wygenerować windykacji „w powietrze":
    // licznika nie ma czego podbić, a mail poszedłby do nikogo.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("DRUGIE zdarzenie o tej samej nieudanej transakcji nie podbija licznika", async () => {
    // Operator opisuje jedno odrzucone obciążenie DWOMA zdarzeniami
    // (`payment_failed` i `past_due`). Bez deduplikacji po identyfikatorze
    // transakcji klient dostałby dwa maile i licznik prób skoczyłby o dwa,
    // czyli windykacja skróciłaby się o cały krok.
    db.setResponse(
      "subscriptions",
      ok({
        user_id: "user-kupujacy",
        tenant_id: "tenant-alfa",
        price_id: "pro_monthly",
        current_period_end: "2026-09-01T00:00:00.000Z",
        payment_failure_count: 1,
        last_dunning_transaction_id: "txn_atrapa_1",
      }),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.past_due",
      data: transactionEvent(),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(writesOn("notifications")).toHaveLength(0);
  });

  it("odzyskana płatność nieznanej subskrypcji też nic nie zapisuje", async () => {
    // Ta sama odmowa po stronie sukcesu: `transaction.completed` bez wiersza
    // subskrypcji nie ma czego wyzerować. Przy okazji ładunek jest tu
    // NIEPEŁNY (kwota nieliczbowa, brak waluty) - windykacja ma to przeżyć,
    // bo pola kwotowe służą jej wyłącznie do treści maila.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        currencyCode: null,
        details: { totals: { grandTotal: "nie-liczba" } },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
  });

  it("odnowienie darowizny cyklicznej księguje wpłatę, a nie windykację", async () => {
    // Darowizna cykliczna nie ma planu, uprawnień ani windykacji - każda
    // opłacona faktura to osobna WPŁATA. Wpuszczenie jej w ścieżkę windykacji
    // podbijałoby licznik nieudanych płatności nieistniejącej subskrypcji.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        // Minimalny ładunek: bez identyfikatora wpłaty, waluty i danych
        // darczyńcy - rejestr ma sobie z tym poradzić.
        currencyCode: null,
        customer: null,
        customData: { purpose: "donation" },
      }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("subscriptions")).toHaveLength(0);
    expect(db.chainsFor("donations").length).toBeGreaterThan(0);
  });

  it("nieudana rata darowizny NIE uruchamia windykacji planu", async () => {
    // Nieudana rata darowizny nie ma czego windykować: nie ma dostępu do
    // odebrania ani planu do przypomnienia. Mail „Twoja subskrypcja wygasa"
    // wysłany darczyńcy byłby zwykłą pomyłką wizerunkową.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ customData: { purpose: "donation", donationId: "don-1" } }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });
});

describe("płatność jednorazowa - odmowy realizacji", () => {
  it("odrzucona płatność jednorazowa oznacza zgłoszenie jako NIEOPŁACONE", async () => {
    // Zgłoszenie na wydarzenie zostaje (uczestnik może dopłacić), ale musi być
    // widoczne jako nieopłacone - inaczej organizator wpuściłby na salę osobę,
    // której karta nie przeszła.
    rpc.setData("payments_apply_event_ticket_outcome", { ok: true });

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ subscriptionId: null, customData: { orderId: "order-1" } }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(rpc.lastCall("payments_apply_event_ticket_outcome")?.args).toMatchObject({
      p_order_id: "order-1",
      p_outcome: "unpaid",
    });
  });

  it("odrzucona płatność bez identyfikatora zamówienia nie rusza żadnego zgłoszenia", async () => {
    // Bez `orderId` nie wiadomo, KTÓRE zgłoszenie miałoby zostać oznaczone -
    // zgadywanie po e-mailu albo kwocie skasowałoby cudzy bilet. Brak całego
    // `custom_data` (transakcja spoza naszego checkoutu) ma dać ten sam skutek
    // co brak samego identyfikatora: nic.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.payment_failed",
      data: transactionEvent({ subscriptionId: null, customData: null }),
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(rpc.calls).toHaveLength(0);
    expect(db.chains).toHaveLength(0);
  });

  it("zdarzenie SANDBOXA nie realizuje zamówienia ze środowiska produkcyjnego", async () => {
    // Izolacja środowisk (P0): bez niej płatność kartą testową odblokowałaby
    // prawdziwy bilet albo treść premium. Zamówienie zostaje nietknięte.
    db.setResponse("payment_orders", (chain) =>
      chain.has("maybeSingle")
        ? ok({
            id: "order-1",
            user_id: "user-kupujacy",
            tenant_id: "tenant-alfa",
            plan_id: null,
            kind: "event_ticket",
            entity_type: "event",
            entity_id: "event-1",
            amount_cents: 4900,
            currency: "PLN",
            metadata: {},
            environment: "live",
          })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: transactionEvent({
        subscriptionId: null,
        customData: { orderId: "order-1", purpose: "ticket" },
      }),
      environment: "sandbox",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("payment_orders")).toHaveLength(0);
    expect(writesOn("event_rsvps")).toHaveLength(0);
    expect(rpc.calls).toHaveLength(0);
  });

  it("opłacona transakcja bez rozpoznanego `custom_data` nie zakłada niczego", async () => {
    // Płatność spoza naszego checkoutu (ktoś opłacił link wystawiony ręcznie
    // w panelu operatora) nie ma jak zostać przypisana - i nie wolno jej
    // przypisać na oko. Ładunek jest tu GOŁY (bez kwoty, waluty, klienta
    // i danych własnych), bo dokładnie tak wygląda transakcja spoza naszego
    // przepływu - a odczyt każdego z tych pól musi mieć wartość zapasową.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.completed",
      data: { id: "txn_obcy_1" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("payment_orders")).toHaveLength(0);
    expect(writesOn("membership_grants")).toHaveLength(0);
  });
});

describe("korekty rozliczeniowe (zwroty i spory)", () => {
  it("kredyt (`credit`) nie odbiera dostępu", async () => {
    // Nota kredytowa to korekta księgowa, nie zwrot pieniędzy za dostęp.
    // Odebranie po niej uprawnień skasowałoby dostęp klientowi, który nic nie
    // dostał z powrotem.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_1",
        action: "credit",
        status: "approved",
        transactionId: "txn_atrapa_1",
        totals: { total: "4900", currencyCode: "PLN" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("korekta bez transakcji i bez subskrypcji nie odbiera niczego na ślepo", async () => {
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.updated",
      data: { id: "adj_2", action: "refund", status: "approved" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("zwrot CZĘŚCIOWY zapisuje kwotę, ale nie oznacza zamówienia jako zwrócone", async () => {
    // Kwoty korekty czytamy z luźnego ładunku operatora (`totals.total` to
    // NARASTAJĄCA suma zwrotów, `totals.captured` - kwota pierwotna). Pomyłka
    // w tym odczycie zamienia korektę ceny w pełny zwrot, czyli odbiera
    // dostęp komuś, kto dostał z powrotem 30 z 300 złotych.
    db.setResponse("payment_orders", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok([
            {
              id: "order-1",
              user_id: "user-kupujacy",
              tenant_id: "tenant-alfa",
              plan_id: null,
              kind: "content",
              entity_type: null,
              entity_id: null,
              metadata: {},
              amount_cents: 30000,
              refunded_amount_cents: 0,
            },
          ]),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_3",
        action: "refund",
        status: "approved",
        transactionId: "txn_atrapa_1",
        totals: { total: "3000", captured: "30000", currencyCode: "PLN" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    const patch = writePayload("payment_orders", "update");
    expect(patch).toMatchObject({ refunded_amount_cents: 3000 });
    expect(patch).not.toHaveProperty("status");
  });

  it("korekta bez identyfikatora i bez nazwanej akcji nie odbiera dostępu", async () => {
    // Ładunek korekty jest LUŹNY - SDK operatora nie daje dla niego stabilnego
    // typu, więc każde pole może nie dojechać. Nierozpoznana akcja ma spaść do
    // `other`, czyli do gałęzi, która NICZEGO nie odbiera: zgadywanie „to
    // pewnie zwrot" kasowałoby dostęp na podstawie nieznanego zdarzenia.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: { transactionId: "txn_atrapa_1", totals: { total: "4900" } },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });

  it("identyfikator transakcji spoza kształtu operatora jest ODRZUCANY", async () => {
    // Identyfikator wchodzi do filtra `or(...)` jako tekst. Przecinek albo
    // nawias w nim rozszerzyłby zapytanie na cudze zamówienia - dlatego
    // dopuszczamy wyłącznie znaki identyfikatora operatora.
    const outcome = await dispatchWebhookEvent({
      eventType: "adjustment.created",
      data: {
        id: "adj_4",
        action: "refund",
        status: "approved",
        transactionId: "txn_1,id.eq.order-cudzy",
        totals: { total: "4900" },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(db.chains).toHaveLength(0);
  });
});

describe("dane klienta z portalu operatora", () => {
  it("zmiana danych nieznanego klienta nie tworzy profilu rozliczeniowego", async () => {
    // Profil bez zgody użytkownika nie ma prawa powstać z webhooka - a klient
    // operatora, którego nie ma w `subscriptions`, to najczęściej inne
    // środowisko albo konto sprzed migracji.
    const outcome = await dispatchWebhookEvent({
      eventType: "customer.updated",
      data: { id: "cus_obcy", email: "ktos@example.org", name: "Firma Testowa" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("processed");
    expect(writesOn("billing_profiles")).toHaveLength(0);
    // Powiązanie klienta z użytkownikiem jest zawężone do ŚRODOWISKA - bez
    // tego filtra sandboxowy klient podmieniłby adres na koncie produkcyjnym.
    expect(db.lastChain("subscriptions")?.argsOf("eq")).toEqual([
      "provider_customer_id",
      "cus_obcy",
    ]);
    expect(
      db
        .lastChain("subscriptions")
        ?.calls.filter((c) => c.method === "eq")
        .at(1)?.args,
    ).toEqual(["environment", "live"]);
  });

  it("zmiana adresu rozliczeniowego trafia do profilu z kodem kraju wersalikami", async () => {
    // Kraj rozstrzyga o stawce podatku na fakturze - „pl" i „PL" to dla
    // porównań w bazie dwie różne wartości.
    // Powiązanie klienta z kontem niesie TAKŻE najemcę: profil rozliczeniowy
    // jest jeden na parę (użytkownik, najemca), więc zapis z webhooka bez
    // `tenant_id` nie miałby jak trafić tylko w ten właściwy.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_profiles", ok([{ id: "bp-1" }]));

    await dispatchWebhookEvent({
      eventType: "address.updated",
      data: {
        customerId: "cus_atrapa_1",
        firstLine: "ul. Testowa 1",
        city: "Warszawa",
        postalCode: "00-001",
        countryCode: "pl",
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writePayload("billing_profiles", "update")).toMatchObject({
      address_line1: "ul. Testowa 1",
      city: "Warszawa",
      postal_code: "00-001",
      country_code: "PL",
    });
  });

  it("dane firmy przestawiają profil na fakturę B2B", async () => {
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_profiles", ok([{ id: "bp-1" }]));

    await dispatchWebhookEvent({
      eventType: "business.updated",
      data: { customerId: "cus_atrapa_1", name: "Firma Testowa", taxIdentifier: "PL0000000000" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writePayload("billing_profiles", "update")).toMatchObject({
      company: "Firma Testowa",
      is_company: true,
      tax_id: "PL0000000000",
    });
  });

  it("puste pola w ładunku nie kasują zapisanych danych profilu", async () => {
    // Operator wysyła `customer.updated` także przy zmianie pola, którego nie
    // trzymamy. Nadpisanie profilu pustką skasowałoby adres do faktury.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));

    await dispatchWebhookEvent({
      eventType: "customer.updated",
      data: { id: "cus_atrapa_1", email: "   ", name: null },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(writesOn("billing_profiles")).toHaveLength(0);
  });
});

describe("dokument rozliczeniowy (`transaction.updated`)", () => {
  it("zdarzenie bez identyfikatora transakcji jest POMIJANE", async () => {
    // `transaction.updated` przychodzi też przy zmianach, które nie dotyczą
    // faktury. Bez identyfikatora nie ma czego zapisać, a `skipped` w
    // dzienniku mówi wprost: zdarzenie odebrane, dokumentu nie było.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: { subscriptionId: "sub_atrapa_1" },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });

  it("transakcja BEZ WŁAŚCICIELA w naszej bazie nie zakłada dokumentu", async () => {
    // Płatność gościa (albo transakcja z cudzego środowiska) nie ma najemcy
    // ani użytkownika, do którego dokument miałby trafić. Wstawienie go „na
    // sztywno" pokazałoby cudzą fakturę w panelu przypadkowego konta.
    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });

  it("numer faktury nadany osobnym zdarzeniem uzupełnia istniejący dokument", async () => {
    // Operator nadaje numer PO `transaction.completed`. Bez tej gałęzi
    // dokument zostawałby w panelu klienta bez numeru, czyli bezużyteczny
    // księgowo.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_documents", (chain: RecordedChain) =>
      chain.has("maybeSingle")
        ? ok({ id: "doc-1", number: null, amount_cents: 4900, status: "paid" })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: LATER,
    });

    expect(outcome).toBe("processed");
    expect(writePayload("billing_documents", "update")).toMatchObject({
      number: "FV/2026/08/0001",
    });
  });

  it("POWTÓRZONE zdarzenie o niezmienionym dokumencie nie zapisuje nic drugi raz", async () => {
    // Idempotencja po stronie dokumentów: ten sam numer, kwota i status to
    // zdarzenie bez treści. Zapis „na wszelki wypadek" podbijałby `updated_at`
    // i mieszał w audycie księgowym.
    db.setResponse("subscriptions", ok({ user_id: "user-kupujacy", tenant_id: "tenant-alfa" }));
    db.setResponse("billing_documents", (chain: RecordedChain) =>
      chain.has("maybeSingle")
        ? ok({ id: "doc-1", number: "FV/2026/08/0001", amount_cents: 4900, status: "paid" })
        : ok(null),
    );

    const outcome = await dispatchWebhookEvent({
      eventType: "transaction.updated",
      data: {
        id: "txn_atrapa_1",
        subscriptionId: "sub_atrapa_1",
        invoiceNumber: "FV/2026/08/0001",
        currencyCode: "PLN",
        status: "completed",
        details: { totals: { grandTotal: "4900" } },
      },
      environment: "live",
      occurredAt: LATER,
    });

    expect(outcome).toBe("skipped");
    expect(writesOn("billing_documents")).toHaveLength(0);
  });
});
