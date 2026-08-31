// Zdrowie webhooków operatora płatności - warstwa odczytu metryki (31 linii,
// 0 z 5 funkcji pokrytych do 31.08.2026).
//
// PO CO TEN PLIK ISTNIEJE. `WebhookHealthPanel` to jedyny ekran, na którym
// widać, czy pieniądze wpadają do systemu: ile zdarzeń przyszło, ile zaległo
// (`pending`), ile poległo i jak długo trwa obsługa. Panel MA własny test, ale
// atrapuje w nim `fetchWebhookHealth` - czyli cała warstwa mapowania odpowiedzi
// RPC na model widoku nie była dotknięta niczym. Ryzyko nie jest kosmetyczne:
// ta funkcja czyta LUŹNY `jsonb` (RPC zwraca `jsonb_build_object`, więc typ nie
// pilnuje niczego), a każdy błąd odczytu daje ZIELONY panel przy zepsutej
// integracji - a to gorsze niż brak panelu, bo wyklucza webhooki z listy
// podejrzanych podczas awarii.
//
// TRZY REGUŁY PILNOWANE NAJMOCNIEJ:
//   1. BRAK POMIARU TO `null`, NIE ZERO (`avg/p95/lag`). SQL liczy `avg()` po
//      pustym zbiorze i oddaje NULL; zamiana tego na 0 byłaby zdaniem
//      „webhooki chodzą błyskawicznie" o systemie, który nie dostał ani
//      jednego zdarzenia.
//   2. ODMOWA RPC MUSI WYJŚĆ NA WIERZCH. Funkcja bazy rzuca
//      `forbidden: admin role required` dla nie-admina i `invalid_payload`
//      dla złego środowiska - to ma dolecieć do wołającego, a nie zamienić się
//      w wyzerowaną metrykę.
//   3. USZKODZONY KSZTAŁT ODPOWIEDZI = BŁĄD, NIE PUSTE ZERA
//      (`invalid_response`).
//
// Atrapa wchodzi na GRANICY (klient Supabase). Żadne zapytanie nie wychodzi
// do sieci, żaden sekret nie jest tu potrzebny - RPC jest w całości atrapą.
import { describe, expect, it, vi, beforeEach } from "vitest";

import { pgError, type PostgrestErrorLike } from "@/test/supabase/chain";

/** Wynik `supabase.rpc(...)` w kształcie, w jakim czyta go warstwa danych. */
interface RpcResult {
  data: unknown;
  error: PostgrestErrorLike | null;
}

const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcResult: RpcResult = { data: null, error: null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

const { fetchWebhookHealth } = await import("@/lib/billing/webhookHealthApi");

/**
 * Odpowiedź RPC `admin_payment_webhook_health` w kształcie 1:1 z migracją
 * 20260828063423 (`jsonb_build_object`): klucze w `snake_case`, agregaty
 * czasowe jako `numeric` (mogą przyjść i liczbą, i tekstem), listy zawsze
 * obecne jako tablice. Wartości SYNTETYCZNE - żadnych danych osobowych.
 */
function healthPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: "live",
    since: "2026-08-24T10:00:00+00:00",
    total: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    pending: 0,
    retries: 0,
    failure_rate: 0,
    avg_duration_ms: null,
    p95_duration_ms: null,
    avg_lag_seconds: null,
    by_type: [],
    recent_failures: [],
    ...overrides,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult = { data: healthPayload(), error: null };
});

describe("fetchWebhookHealth - zapytanie do bazy", () => {
  it("pyta RPC, a nie tabelę - z jawnym środowiskiem i oknem czasu", async () => {
    // Dziennik zdarzeń jest zamknięty (RLS + brak grantów odczytu), a metryka
    // to agregat po CAŁEJ tabeli z ładunkami płatności. Zejście z RPC na
    // zapytanie z przeglądarki oznaczałoby otwarcie tych wierszy - dlatego
    // kontrakt wywołania jest tu asercją bezpieczeństwa, nie stylu.
    await fetchWebhookHealth("sandbox", 24);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe("admin_payment_webhook_health");
    expect(rpcCalls[0]?.args).toEqual({
      p_payload: { environment: "sandbox", since_hours: 24 },
    });
  });

  it("odmowa roli z bazy leci dalej, zamiast zamienić się w zerową metrykę", async () => {
    // `admin_payment_webhook_health` rzuca `forbidden: admin role required`,
    // gdy woła ją ktoś bez roli admina. Gdyby warstwa danych połknęła ten błąd
    // i oddała same zera, panel pokazałby „zero zdarzeń, zero awarii" - czyli
    // ZDROWĄ integrację - komuś, kto w ogóle nie ma prawa jej widzieć.
    rpcResult = { data: null, error: pgError("forbidden: admin role required", "P0001") };

    await expect(fetchWebhookHealth("live", 168)).rejects.toThrow("forbidden");
    expect(rpcCalls).toHaveLength(1);
  });

  it("odmowa złego środowiska (invalid_payload) też jest błędem, nie ciszą", async () => {
    rpcResult = {
      data: null,
      error: pgError("invalid_payload: environment must be sandbox or live", "P0001"),
    };

    await expect(fetchWebhookHealth("live", 168)).rejects.toThrow("invalid_payload");
  });

  it("odpowiedź spoza kształtu obiektu jest błędem (invalid_response)", async () => {
    // `data: null` przychodzi np. przy zerwanym połączeniu albo podmienionej
    // funkcji bazy. Zwrócenie wtedy „pustego zdrowia" byłoby fałszywym
    // zielonym - lepiej głośna porażka odczytu.
    rpcResult = { data: null, error: null };
    await expect(fetchWebhookHealth("live", 168)).rejects.toThrow("invalid_response");

    // Tablica NIE jest obiektem metryki - `jsonb_agg` zamiast
    // `jsonb_build_object` (czyli podmieniona wersja funkcji) ma polec tak samo.
    rpcResult = { data: [], error: null };
    await expect(fetchWebhookHealth("live", 168)).rejects.toThrow("invalid_response");

    rpcResult = { data: "ok", error: null };
    await expect(fetchWebhookHealth("live", 168)).rejects.toThrow("invalid_response");
  });
});

describe("fetchWebhookHealth - brak zdarzeń", () => {
  it("pusty dziennik to zera i BRAK pomiarów czasu (null, nie 0)", async () => {
    // Panel rysuje myślnik dla `null` i konkretną liczbę dla 0 ms. To nie
    // kosmetyka: „0 ms" czyta się jako zmierzoną błyskawiczną obsługę, a tu
    // nie ma czego mierzyć.
    const health = await fetchWebhookHealth("live", 168);

    expect(health).toEqual({
      environment: "live",
      since: "2026-08-24T10:00:00+00:00",
      total: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      pending: 0,
      retries: 0,
      failureRate: 0,
      avgDurationMs: null,
      p95DurationMs: null,
      avgLagSeconds: null,
      byType: [],
      recentFailures: [],
    });
  });

  it("środowisko w wyniku pochodzi z ARGUMENTU, nie z odpowiedzi bazy", async () => {
    // Gdyby brać je z ładunku, pomyłka w funkcji bazy (albo odpowiedź z cache
    // innego środowiska) podpisałaby metrykę sandboxa jako produkcyjną.
    rpcResult = { data: healthPayload({ environment: "sandbox" }), error: null };

    const health = await fetchWebhookHealth("live", 168);
    expect(health.environment).toBe("live");
  });

  it("brak znacznika `since` nie wywraca odczytu - zostaje null", async () => {
    rpcResult = { data: healthPayload({ since: "   " }), error: null };
    const health = await fetchWebhookHealth("live", 168);
    expect(health.since).toBeNull();
  });
});

describe("fetchWebhookHealth - zdarzenia zalegające", () => {
  it("zalegające (`pending`) są liczone osobno od przetworzonych", async () => {
    // `pending` to wiersze w stanie innym niż processed/skipped/failed, czyli
    // zdarzenia PRZYJĘTE i nigdy nie domknięte (padł worker w trakcie).
    // Zsumowanie ich z `processed` ukryłoby najgorszy stan integracji: klient
    // zapłacił, zdarzenie przyszło, a uprawnienie nie powstało.
    rpcResult = {
      data: healthPayload({
        total: 10,
        processed: 6,
        skipped: 1,
        failed: 0,
        pending: 3,
        retries: 4,
        avg_duration_ms: 812.5,
        p95_duration_ms: 2400,
        avg_lag_seconds: 15.25,
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.pending).toBe(3);
    expect(health.processed).toBe(6);
    expect(health.retries).toBe(4);
    expect(health.avgDurationMs).toBe(812.5);
    expect(health.p95DurationMs).toBe(2400);
    expect(health.avgLagSeconds).toBe(15.25);
  });

  it("agregaty `numeric` podane TEKSTEM są liczbą, a nie zerem", async () => {
    // Kolumny `numeric` potrafią dojechać przez PostgREST jako napis (typ
    // dowolnej precyzji nie mieści się w JSON number). Zamiana takiej wartości
    // na 0 zaniżyłaby czas obsługi i wyciszyła alarm o ślimaczącym się
    // webhooku - dlatego pola pomiarowe czyta `maybeNum`, a nie `num`.
    rpcResult = {
      data: healthPayload({
        total: 4,
        failed: 1,
        failure_rate: "0.2500",
        avg_duration_ms: "1234.5",
        p95_duration_ms: "9000.0",
        avg_lag_seconds: "42.75",
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.failureRate).toBe(0.25);
    expect(health.avgDurationMs).toBe(1234.5);
    expect(health.p95DurationMs).toBe(9000);
    expect(health.avgLagSeconds).toBe(42.75);
  });

  it("nieliczbowe śmieci w licznikach dają 0, a w pomiarach null", async () => {
    // Rozdział jest celowy: licznik zdarzeń MUSI być liczbą (0 to prawda
    // o zbiorze), a pomiar czasu bez wartości to „nie wiem" - i tak ma zostać.
    rpcResult = {
      data: healthPayload({
        total: "dużo",
        processed: null,
        failure_rate: "brak",
        avg_duration_ms: "nie-liczba",
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.total).toBe(0);
    expect(health.processed).toBe(0);
    expect(health.failureRate).toBe(0);
    expect(health.avgDurationMs).toBeNull();
  });
});

describe("fetchWebhookHealth - zdarzenia nieudane i rozkład typów", () => {
  it("ostatnie awarie trafiają do listy z typem, błędem i licznikiem prób", async () => {
    // To jest lista robocza dyżurnego: bez `retry_count` i treści błędu nie da
    // się odróżnić jednorazowego timeoutu od zdarzenia, które pada w kółko.
    rpcResult = {
      data: healthPayload({
        total: 3,
        failed: 2,
        failure_rate: 0.6667,
        recent_failures: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            event_type: "subscription.updated",
            status: "failed",
            error: "subscriptions update failed: deadlock detected",
            occurred_at: "2026-08-30T09:00:00+00:00",
            retry_count: 3,
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            event_type: "transaction.completed",
            status: "failed",
            error: null,
            occurred_at: null,
            retry_count: 0,
          },
        ],
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.failed).toBe(2);
    expect(health.failureRate).toBeCloseTo(0.6667, 4);
    expect(health.recentFailures).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        eventType: "subscription.updated",
        error: "subscriptions update failed: deadlock detected",
        occurredAt: "2026-08-30T09:00:00+00:00",
        retryCount: 3,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        eventType: "transaction.completed",
        error: null,
        occurredAt: null,
        retryCount: 0,
      },
    ]);
  });

  it("awaria bez identyfikatora jest POMIJANA, a bez typu dostaje `unknown`", async () => {
    // Wiersz bez `id` nie da się ponowić z panelu (przycisk ponowienia bierze
    // dokładnie ten identyfikator), więc jego pokazanie obiecywałoby akcję,
    // której nie ma. Brak typu zdarzenia jest inny: wiersz nadal jest sygnałem
    // awarii, więc zostaje z etykietą `unknown`.
    rpcResult = {
      data: healthPayload({
        recent_failures: [
          { event_type: "subscription.updated", error: "bez id" },
          "nie-obiekt",
          null,
          { id: "33333333-3333-4333-8333-333333333333", error: "bez typu" },
        ],
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.recentFailures).toHaveLength(1);
    expect(health.recentFailures[0]?.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(health.recentFailures[0]?.eventType).toBe("unknown");
  });

  it("rozkład po typach zdarzeń mapuje liczby i pomija wiersze bez typu", async () => {
    rpcResult = {
      data: healthPayload({
        total: 12,
        by_type: [
          { event_type: "subscription.updated", total: 8, failed: 1, avg_duration_ms: "120.0" },
          { event_type: "  ", total: 3, failed: 0, avg_duration_ms: 50 },
          { total: 1, failed: 1, avg_duration_ms: null },
          42,
        ],
      }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.byType).toEqual([
      { eventType: "subscription.updated", total: 8, failed: 1, avgDurationMs: 120 },
    ]);
  });

  it("listy podane czymś innym niż tablica dają puste listy, nie wyjątek", async () => {
    // Panel ma wtedy pokazać metryki liczbowe (te są wiarygodne) i puste
    // sekcje szczegółów - a nie wywalić się na całości odczytu.
    rpcResult = {
      data: healthPayload({ total: 5, by_type: null, recent_failures: { id: "x" } }),
      error: null,
    };

    const health = await fetchWebhookHealth("live", 168);

    expect(health.total).toBe(5);
    expect(health.byType).toEqual([]);
    expect(health.recentFailures).toEqual([]);
  });
});
