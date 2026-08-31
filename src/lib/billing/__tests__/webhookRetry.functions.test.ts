// Ponowne przetworzenie zdarzenia operatora z panelu admina - 36 linii,
// 0 z 4 funkcji pokrytych do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. To jest przycisk „napraw to teraz" na
// /admin/billing. Uruchamia się go w jednej sytuacji: klient zapłacił,
// zdarzenie dotarło, a obsługa poległa (chwilowy błąd bazy, brak planu
// w katalogu w chwili zakupu, niedostępna poczta). Operator ponawia dostawę
// najwyżej przez trzy doby - po tym czasie ten przycisk jest JEDYNĄ drogą do
// nadania opłaconego uprawnienia. Cała ta ścieżka stała na zerze.
//
// CZTERY REGUŁY, KTÓRYCH PILNUJE TEN PLIK:
//   1. BRAMKA ROLI. Wejście ma `requireSupabaseAuth`, ale to za mało -
//      uwierzytelniony NIE ZNACZY admin. `assertAdmin` przepuszcza wyłącznie
//      `has_role() === true`; `null` z RPC (brak wiersza, brak grantu) MUSI
//      być odmową, bo inaczej dowolny zalogowany odtwarzałby zdarzenia
//      płatnicze.
//   2. ŁADUNEK POCHODZI Z DZIENNIKA, NIE OD KLIENTA. Dlatego ta ścieżka nie
//      weryfikuje podpisu - i dlatego funkcja przyjmuje WYŁĄCZNIE identyfikator
//      wiersza. Gdyby dało się podstawić ładunek z przeglądarki, brak
//      weryfikacji podpisu zamieniłby panel w darmowy generator uprawnień.
//   3. LICZNIK PRÓB I ŚLAD AUTORA. Każde ponowienie ma zostawić `retry_count`,
//      `last_retried_at`, `retried_by` i czas obsługi - bez tego nie da się
//      odróżnić zdarzenia naprawionego od klikanego w kółko.
//   4. PORAŻKA MA BYĆ WIDOCZNA. Wyjątek z obsługi nie może wywrócić server fn
//      (admin zostałby bez odpowiedzi), ale MUSI wylądować w dzienniku jako
//      `failed` z komunikatem.
//
// Middleware NIE jest tu wykonywane (patrz `src/test/serverFnHarness.ts`):
// zestawu `requireSupabaseAuth` pilnuje bramka `check:authz-snapshot`. Ten
// plik odpowiada na pytanie „czy logika jest poprawna", nie „czy ktoś obcy
// dostanie się do trasy".
//
// Atrapy stoją na GRANICACH: klient Supabase (serwisowy i użytkownika) oraz
// SDK operatora. `dispatchWebhookEvent` biegnie PRAWDZIWY - inaczej test
// dowodziłby wyłącznie tego, że ponowienie woła własną atrapę.
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { callServerFn } from "@/test/serverFn";

/** Klient SERWISOWY (dziennik + skutki obsługi). */
let db: SupabaseFromStub;
let adminRpc: SupabaseRpcStub;
/** Klient UŻYTKOWNIKA z kontekstu server fn - na nim sprawdzana jest rola. */
let userRpc: SupabaseRpcStub;

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => adminRpc.rpc(name, args),
  },
}));
// Bezpiecznik granicy operatora: żaden przypadek nie ma prawa wyjść do sieci.
vi.mock("@/lib/stripe.server", () => ({
  getConnectionApiKey: () => "test_klucz_atrapy",
  getWebhookSecret: () => "test_sekret_atrapy",
  createStripeClient: () => {
    throw new Error("test: ponowienie nie ma prawa wołać operatora");
  },
  getStripeErrorMessage: (error: unknown) => String(error),
  resolveEnvironment: () => "sandbox",
  verifyWebhook: () => {
    throw new Error("test: ponowienie NIE weryfikuje podpisu - ładunek jest z dziennika");
  },
}));

const { retryWebhookEvent, readWebhookEventPayload } =
  await import("@/lib/billing/webhookRetry.functions");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ROW_ID = "22222222-2222-4222-8222-222222222222";
const OCCURRED_AT = "2026-08-30T10:00:00.000Z";

/** Wiersz dziennika `payment_webhook_events` w kształcie czytanym przez handler. */
function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ROW_ID,
    event_id: "evt_atrapa_1",
    event_type: "customer.updated",
    environment: "live",
    occurred_at: OCCURRED_AT,
    // Kształt zapisywany przez ścieżkę uzgadniania (`reconcile.server`):
    // całe zdarzenie po normalizacji, czyli `{ eventType, data }`.
    payload: { eventType: "customer.updated", data: { id: "cus_z_dziennika" } },
    retry_count: 0,
    ...overrides,
  };
}

/** Odpowiedź dziennika: odczyt wiersza (`maybeSingle`) kontra zapis wyniku. */
function logResponder(row: Record<string, unknown> | null, readError?: string) {
  return (chain: RecordedChain) => {
    if (chain.has("maybeSingle")) return readError ? fail(readError) : ok(row);
    return ok(null);
  };
}

/** Wywołanie server fn z kontekstem, jaki wstrzyknęłoby middleware. */
function callRetry(data: unknown, userId: string = ADMIN_ID) {
  return callServerFn<{
    id: string;
    eventType: string;
    status: string;
    durationMs: number;
    retryCount: number;
    error: string | null;
  }>(retryWebhookEvent, data, { supabase: { rpc: userRpc.rpc }, userId });
}

/** Ładunek zapisu wyniku ponowienia (UPDATE na dzienniku). */
function retryPatch(): Record<string, unknown> | undefined {
  const chain = db.chainsFor("payment_webhook_events").find((c) => c.has("update"));
  const args = chain?.argsOf("update")?.[0];
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined;
}

beforeEach(() => {
  db = supabaseFromStub();
  adminRpc = supabaseRpcStub();
  userRpc = supabaseRpcStub();
  userRpc.setData("has_role", true);
  db.setResponse("payment_webhook_events", logResponder(logRow()));
  db.setResponse("subscriptions", ok(null));
  db.setResponse("billing_profiles", ok(null));
});

describe("retryWebhookEvent - bramka dostępu", () => {
  it("zalogowany BEZ roli admina nie dotyka dziennika w ogóle", async () => {
    // Kolejność ma tu znaczenie pieniężne: sprawdzenie roli idzie PRZED
    // odczytem wiersza. Inaczej zwykły użytkownik mógłby po komunikacie błędu
    // wnioskować o istnieniu zdarzeń płatniczych (i o ich identyfikatorach).
    userRpc.setData("has_role", false);

    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow("forbidden");
    expect(db.chains).toHaveLength(0);
    expect(userRpc.lastCall("has_role")?.args).toEqual({
      _user_id: ADMIN_ID,
      _role: "admin",
    });
  });

  it("`null` z kontroli roli to ODMOWA, nie „pewnie admin”", async () => {
    // RPC `has_role` oddaje `null`, gdy nie ma wiersza roli albo brakuje
    // grantu na funkcję. Potraktowanie tego jak zgody otwierałoby panel
    // płatności przy pierwszym błędzie konfiguracji uprawnień w bazie.
    userRpc.setData("has_role", null);

    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow("forbidden");
    expect(db.chains).toHaveLength(0);
  });

  it("identyfikator spoza kształtu UUID jest odrzucany przez schemat wejścia", async () => {
    // Wejście idzie prosto do filtra `.eq("id", ...)`. Schemat jest tu
    // pierwszą (i najtańszą) bramką - bez niego panel dostawałby odmowę
    // z warstwy bazy zamiast zrozumiałego komunikatu.
    await expect(callRetry({ id: "evt_1" })).rejects.toThrow();
    await expect(callRetry({})).rejects.toThrow();
    expect(db.chains).toHaveLength(0);
  });

  it("klient NIE MOŻE podstawić ładunku - ponowienie bierze go z dziennika", async () => {
    // To jest powód, dla którego ta ścieżka nie weryfikuje podpisu: ładunek
    // pochodzi z NASZEJ bazy, a nie z sieci. Gdyby schemat przepuszczał pole
    // `payload` z przeglądarki, brak weryfikacji podpisu zamieniłby panel
    // w generator dowolnych zdarzeń płatniczych (nadanie uprawnienia bez
    // zapłaty). Schemat `z.object` zdejmuje nadmiarowe klucze - dowodem jest
    // to, że obsługa poszła po kliencie Z DZIENNIKA, a nie z podstawionego
    // ładunku.
    const result = await callRetry({
      id: EVENT_ROW_ID,
      payload: { eventType: "customer.updated", data: { id: "cus_podstawiony" } },
      eventType: "subscription.created",
    });

    expect(result.status).toBe("processed");
    expect(db.lastChain("subscriptions")?.argsOf("eq")).toEqual([
      "provider_customer_id",
      "cus_z_dziennika",
    ]);
  });
});

describe("retryWebhookEvent - odczyt wiersza dziennika", () => {
  it("nieistniejące zdarzenie kończy się jasnym komunikatem, a nie pustym wynikiem", async () => {
    db.setResponse("payment_webhook_events", logResponder(null));

    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow("Zdarzenie nie istnieje.");
  });

  it("błąd odczytu dziennika nie udaje braku zdarzenia", async () => {
    // Rozróżnienie jest operacyjne: „nie ma takiego zdarzenia" znaczy pomyłkę
    // w identyfikatorze, a „nie udało się odczytać" - awarię bazy. Sklejenie
    // obu komunikatów wysyłałoby dyżurnego w złą stronę.
    db.setResponse("payment_webhook_events", logResponder(null, "connection reset"));

    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow(
      "nie udało się odczytać zdarzenia: connection reset",
    );
  });

  it("pusty zapisany ładunek zatrzymuje ponowienie zamiast wysyłać pustkę w obsługę", async () => {
    // Bez ładunku nie ma czego odtwarzać. Puszczenie takiego wiersza dalej
    // dałoby wpis `processed` przy zdarzeniu, które nic nie zrobiło - czyli
    // fałszywe „naprawione" w panelu.
    db.setResponse(
      "payment_webhook_events",
      logResponder(logRow({ payload: { eventType: "customer.updated", data: null } })),
    );

    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow(
      "Zapisany ładunek jest pusty - nie ma czego ponowić.",
    );
  });

  // DEFEKT (nie naprawiam - zakres zadania to testy, nie kod produkcyjny).
  //
  // CO JEST ZŁE. Strażnik z linii 57 nazywa swój przypadek wprost: „Zapisany
  // ładunek jest pusty - nie ma czego ponowić". Nie łapie jednak ładunku
  // NAJBARDZIEJ pustego z możliwych: kolumna `payload` jest typu `Json`, więc
  // może trzymać jsonowy `null`, a linia 55 zamienia go na `{}`. Pusty obiekt
  // jest prawdziwy (`typeof {} === "object"`), więc przechodzi przez warunek
  // i leci do obsługi jako dane zdarzenia.
  //
  // DLACZEGO TO RYZYKO. Skutek jest taki sam jak przy defekcie kształtu
  // ładunku niżej: obsługa nie ma na czym pracować, nie robi nic, a panel
  // pokazuje „przetworzono" i podbija licznik prób. Fałszywy sukces zamyka
  // zgłoszenie klienta, który nadal nie ma opłaconego uprawnienia. Poprawka to
  // sprawdzenie, czy obiekt ma jakiekolwiek klucze - ale to zmiana KODU
  // PRODUKCYJNEGO.
  it.fails("pusty ładunek zapisany jako `null` też zatrzymuje ponowienie", async () => {
    db.setResponse("payment_webhook_events", logResponder(logRow({ payload: null })));

    // ASERCJA DOCELOWA: taki sam komunikat jak dla `{ data: null }` - obie
    // wartości znaczą to samo, czyli „nie ma czego ponowić".
    await expect(callRetry({ id: EVENT_ROW_ID })).rejects.toThrow(
      "Zapisany ładunek jest pusty - nie ma czego ponowić.",
    );
  });

  it("starszy wiersz zapisany SAMYM obiektem danych też daje się ponowić", async () => {
    // Dziennik historyczny bywa zapisany bez opakowania `{ eventType, data }`.
    // Odrzucenie takich wierszy odcięłoby ponowienie dokładnie tam, gdzie jest
    // najbardziej potrzebne - przy starych, niedomkniętych zdarzeniach.
    db.setResponse(
      "payment_webhook_events",
      logResponder(logRow({ payload: { id: "cus_stary_wiersz" } })),
    );

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.status).toBe("processed");
    expect(db.lastChain("subscriptions")?.argsOf("eq")).toEqual([
      "provider_customer_id",
      "cus_stary_wiersz",
    ]);
  });
});

describe("retryWebhookEvent - przebieg ponowienia", () => {
  it("PIERWSZA próba: licznik rusza od jedynki i zostawia ślad autora", async () => {
    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result).toMatchObject({
      id: EVENT_ROW_ID,
      eventType: "customer.updated",
      status: "processed",
      retryCount: 1,
      error: null,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const patch = retryPatch();
    expect(patch).toMatchObject({
      status: "processed",
      error: null,
      retry_count: 1,
      retried_by: ADMIN_ID,
    });
    expect(patch?.["last_retried_at"]).toEqual(expect.any(String));
    expect(patch?.["processed_at"]).toEqual(expect.any(String));
    expect(db.chainsFor("payment_webhook_events").at(-1)?.argsOf("eq")).toEqual([
      "id",
      EVENT_ROW_ID,
    ]);
  });

  it("KOLEJNA próba podbija licznik zapisany przy wierszu, a nie zaczyna od zera", async () => {
    // Licznik jest jedyną liczbą, po której widać zdarzenie „klikane w kółko".
    // Zerowanie go przy każdym ponowieniu ukryłoby zapętloną awarię.
    db.setResponse("payment_webhook_events", logResponder(logRow({ retry_count: 3 })));

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.retryCount).toBe(4);
    expect(retryPatch()).toMatchObject({ retry_count: 4 });
  });

  it("pusty licznik w wierszu jest traktowany jak zero", async () => {
    // Kolumna jest NOT NULL, ale wygenerowany typ dopuszcza `null` - warstwa
    // ma to przeżyć bez `NaN` w liczniku prób.
    db.setResponse("payment_webhook_events", logResponder(logRow({ retry_count: null })));

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.retryCount).toBe(1);
  });

  it("BRAK sufitu prób: czterdziesta pierwsza próba przechodzi tak samo jak pierwsza", async () => {
    // Świadomie dokumentujemy stan faktyczny: ponowienie z panelu NIE MA
    // limitu ani backoffu - to ręczna akcja admina, a nie automat. Ryzyko
    // z tego wynikające jest realne (zapętlone klikanie przy trwałej awarii
    // odtwarza obsługę bez ograniczeń), ale jest to decyzja projektowa, nie
    // usterka: sufit ma automat operatora (~3 doby ponowień), a tu odpowiada
    // człowiek z rolą admina. Ten test pilnuje, żeby ewentualne wprowadzenie
    // limitu było ŚWIADOMĄ zmianą kontraktu, a nie efektem ubocznym.
    db.setResponse("payment_webhook_events", logResponder(logRow({ retry_count: 40 })));

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.status).toBe("processed");
    expect(result.retryCount).toBe(41);
  });

  it("zdarzenie spoza zakresu integracji kończy się statusem `skipped`", async () => {
    // `skipped` w dzienniku znaczy „odebrane, nie dotyczy nas". Zapisanie tu
    // `processed` sugerowałoby wykonaną pracę i chowało zdarzenia, których
    // integracja w ogóle nie obsługuje.
    db.setResponse(
      "payment_webhook_events",
      logResponder(
        logRow({
          event_type: "payout.created",
          payload: { eventType: "payout.created", data: { id: "po_1" } },
        }),
      ),
    );

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.status).toBe("skipped");
    expect(retryPatch()).toMatchObject({ status: "skipped", error: null });
  });

  it("porażka obsługi NIE wywraca server fn, tylko ląduje w dzienniku jako `failed`", async () => {
    // Admin ma zobaczyć komunikat błędu w panelu, a nie 500 bez treści.
    // Jednocześnie wiersz musi zostać oznaczony `failed` z powodem - inaczej
    // kolejny dyżurny zaczyna diagnozę od zera.
    db.setResponse(
      "payment_webhook_events",
      logResponder(
        logRow({
          event_type: "subscription.updated",
          payload: {
            eventType: "subscription.updated",
            data: { id: "sub_atrapa_1", status: "active", items: [] },
          },
        }),
      ),
    );
    db.setResponse("subscriptions", (chain: RecordedChain) =>
      chain.has("update") && chain.has("select") ? fail("deadlock detected") : ok(null),
    );

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("subscription event claim failed: deadlock detected");
    expect(retryPatch()).toMatchObject({ status: "failed" });
    expect(String(retryPatch()?.["error"])).toContain("deadlock detected");
  });

  it("środowisko inne niż `live` schodzi do sandboxa - nigdy odwrotnie", async () => {
    // Wartość spoza słownika (wiersz sprzed migracji, literówka w imporcie)
    // NIE MOŻE zostać uznana za produkcję: ponowienie ruszyłoby wtedy realne
    // uprawnienia na podstawie zdarzenia z konta testowego.
    db.setResponse("payment_webhook_events", logResponder(logRow({ environment: "testowe" })));

    await callRetry({ id: EVENT_ROW_ID });

    const filters = db.lastChain("subscriptions")?.calls.filter((c) => c.method === "eq") ?? [];
    expect(filters.at(1)?.args).toEqual(["environment", "sandbox"]);
  });

  it("środowisko `live` z wiersza jedzie do obsługi jako produkcyjne", async () => {
    await callRetry({ id: EVENT_ROW_ID });

    const filters = db.lastChain("subscriptions")?.calls.filter((c) => c.method === "eq") ?? [];
    expect(filters.at(1)?.args).toEqual(["environment", "live"]);
  });

  it("wiersz bez znacznika czasu zdarzenia daje się ponowić „na teraz”", async () => {
    // Brak `occurred_at` nie może blokować naprawy - obsługa dostaje wtedy
    // bieżący czas, a nie `null`, na którym wywracałby się strażnik kolejności.
    db.setResponse("payment_webhook_events", logResponder(logRow({ occurred_at: null })));

    const result = await callRetry({ id: EVENT_ROW_ID });

    expect(result.status).toBe("processed");
  });

  // DEFEKT (nie naprawiam - zakres zadania to testy, nie kod produkcyjny).
  //
  // CO JEST ZŁE. Dziennik zdarzeń ma DWÓCH piszących i DWA różne kształty
  // wiersza, a ponowienie rozumie tylko jeden z nich:
  //   * trasa `/api/public/payments/webhook` zapisuje `event_type` PO
  //     normalizacji ("subscription.updated"), ale `payload` SUROWY, prosto od
  //     operatora (`{ id, type: "customer.subscription.updated", created,
  //     data: { object: { ... } } }`) - webhook.ts:50 (`payload: verified`),
  //   * uzgadnianie (`reconcile.server.ts:275`) zapisuje `payload` już
  //     znormalizowany (`{ eventType, data }`).
  // `retryWebhookEvent` bierze `payload.data` i podaje je jako dane zdarzenia.
  // Dla wiersza z TRASY (czyli dla każdego zwykłego webhooka) `payload.data` to
  // `{ object: { ... } }` - opakowanie Stripe'a, a nie model domenowy, którego
  // oczekuje `dispatchWebhookEvent`. Skutek: identyfikator subskrypcji jest
  // `undefined`, filtry trafiają w pustkę, obsługa nie robi NIC - i kończy się
  // statusem `processed`.
  //
  // DLACZEGO TO RYZYKO. To jest dokładne zaprzeczenie celu tego modułu.
  // Ponowienie uruchamia się wtedy, gdy klient zapłacił, a uprawnienia nie ma;
  // operator przestaje ponawiać po ~3 dobach, więc ten przycisk bywa OSTATNIĄ
  // szansą na naprawę. Dziś klika się go, panel zapala „przetworzono", licznik
  // prób rośnie - a uprawnienie dalej nie powstaje. Fałszywy sukces jest przy
  // tym gorszy od jawnej porażki: zamyka zgłoszenie, zamiast eskalować.
  //
  // Poprawka jest po stronie KODU PRODUKCYJNEGO (jeden z dwóch wyborów:
  // trasa zapisuje ładunek znormalizowany, albo ponowienie przepuszcza surowy
  // ładunek przez `normalizeStripeEvent` i używa `payload.eventType`), więc
  // zostaje tutaj jako `it.fails` - test zaświeci na zielono dopiero, gdy ktoś
  // ją zrobi, i wtedy trzeba zdjąć `.fails`.
  it.fails("ponowienie wiersza zapisanego przez TRASĘ trafia we właściwą subskrypcję", async () => {
    db.setResponse(
      "payment_webhook_events",
      logResponder(
        logRow({
          event_type: "subscription.updated",
          // Kształt 1:1 z `verifyWebhook` (surowe zdarzenie Stripe).
          payload: {
            id: "evt_atrapa_1",
            type: "customer.subscription.updated",
            created: 1_788_000_000,
            data: {
              object: {
                id: "sub_stripe_1",
                customer: "cus_stripe_1",
                status: "active",
                metadata: { userId: "user-kupujacy" },
                items: { data: [] },
              },
            },
          },
        }),
      ),
    );
    db.setResponse("subscriptions", (chain: RecordedChain) =>
      chain.has("update") && chain.has("select") ? ok([{ id: "wiersz_1" }]) : ok(null),
    );

    await callRetry({ id: EVENT_ROW_ID });

    // ASERCJA DOCELOWA: obsługa ma pracować na subskrypcji z ładunku, a nie
    // na `undefined`.
    expect(db.chainsFor("subscriptions")[0]?.argsOf("eq")).toEqual([
      "provider_subscription_id",
      "sub_stripe_1",
    ]);
  });
});

describe("readWebhookEventPayload - podgląd ładunku", () => {
  it("podgląd też jest tylko dla admina", async () => {
    // Ładunek zdarzenia zawiera dane rozliczeniowe klienta (adres, e-mail,
    // kwoty). Ta funkcja nie zmienia niczego, ale CZYTA najbardziej wrażliwy
    // fragment dziennika - bramka roli jest tu równie obowiązkowa.
    userRpc.setData("has_role", false);

    await expect(
      callServerFn(
        readWebhookEventPayload,
        { id: EVENT_ROW_ID },
        {
          supabase: { rpc: userRpc.rpc },
          userId: ADMIN_ID,
        },
      ),
    ).rejects.toThrow("forbidden");
    expect(db.chains).toHaveLength(0);
  });

  it("brak wiersza to jasny komunikat, nie `null` do wyrenderowania", async () => {
    db.setResponse("payment_webhook_events", logResponder(null));

    await expect(
      callServerFn(
        readWebhookEventPayload,
        { id: EVENT_ROW_ID },
        {
          supabase: { rpc: userRpc.rpc },
          userId: ADMIN_ID,
        },
      ),
    ).rejects.toThrow("Zdarzenie nie istnieje.");
  });

  it("oddaje wiersz z ładunkiem i kolumnami diagnostycznymi", async () => {
    // Panel diagnozuje z tego wiersza: status, błąd, czas obsługi i licznik
    // prób. Braki w liście kolumn nie wywalają zapytania - po cichu gaszą
    // połowę ekranu diagnostycznego, dlatego lista jest asercją.
    const row = logRow({ status: "failed", error: "boom", duration_ms: 120 });
    db.setResponse("payment_webhook_events", logResponder(row));

    const result = await callServerFn(
      readWebhookEventPayload,
      { id: EVENT_ROW_ID },
      {
        supabase: { rpc: userRpc.rpc },
        userId: ADMIN_ID,
      },
    );

    expect(result).toEqual(row);
    const selected = String(db.lastChain("payment_webhook_events")?.argsOf("select")?.[0] ?? "");
    for (const column of ["status", "error", "duration_ms", "retry_count", "payload"]) {
      expect(selected).toContain(column);
    }
  });

  it("identyfikator spoza kształtu UUID jest odrzucany również w podglądzie", async () => {
    await expect(
      callServerFn(
        readWebhookEventPayload,
        { id: "nie-uuid" },
        {
          supabase: { rpc: userRpc.rpc },
          userId: ADMIN_ID,
        },
      ),
    ).rejects.toThrow();
    expect(db.chains).toHaveLength(0);
  });
});
