// Powierzchnia HTTP drenu kolejek pocztowych: POST /platform/email/queue/process.
//
// Trasa stała na 0%, a jest to JEDYNE wejście, którym środowisko z własnym
// harmonogramem (zewnętrzny cron, ręczne wypchnięcie kolejki przy diagnostyce)
// każe platformie wysłać zaległą pocztę. Trzy pomyłki są tu kosztowne i po
// cichu:
//   * przepuszczenie żądania bez ważnego sekretu - obcy drenuje kolejkę
//     platformy i widzi w odpowiedzi jej stan (ile maili czeka, ile odbiło),
//   * uruchomienie drenu bez klucza service_role - dren dostałby klienta bez
//     uprawnień i „opróżnił" kolejkę zerem wysłanych wiadomości,
//   * zgubienie budżetu albo deadline'u w wywołaniu drenu - przebieg
//     przekroczyłby timeout runtime'u i wywrócił się w połowie porcji,
//     zostawiając wiadomości z wygasającym VT.
// Dlatego testy pilnują kodu odpowiedzi dla KAŻDEJ odmowy, tego że przy
// odmowie dren nie jest w ogóle wołany, oraz kompletu parametrów przebiegu.
//
// Handler jest wołany wprost przez `Route.options.server.handlers.POST` -
// nie trzeba do tego runtime'u routera ani zmian w kodzie produkcyjnym.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeServerHandlers } from "@/test/routeHarness";
import type { DrainResult } from "@/lib/email/queueDrain.server";

const SERVICE_KEY = "service-role-klucz-0123456789";
/** Stała chwila bazowa - deadline przebiegu liczy się od `Date.now()`. */
const NOW = new Date("2026-08-22T09:00:00.000Z");

const h = vi.hoisted(() => ({
  secretsEqual: vi.fn(),
  drainEmailQueues: vi.fn(),
  // Znacznik tożsamości: dowodzi, że dren dostaje klienta service_role, a nie
  // dowolny obiekt zbudowany w trasie.
  supabaseAdmin: { __client: "service-role" },
}));

// Sekret porównujemy wspólnym helperem timing-safe; atrapa zapisuje argumenty,
// żeby dało się dowieść, co dokładnie trafia do porównania.
vi.mock("@/lib/server/jobsTick.server", () => ({ secretsEqual: h.secretsEqual }));
// Dren i klient service_role to kod server-only (dostawca poczty, klucze) -
// w teście trasy liczy się WYWOŁANIE, nie praca kolejki.
vi.mock("@/lib/email/queueDrain.server", () => ({ drainEmailQueues: h.drainEmailQueues }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.supabaseAdmin }));

import { Route } from "@/routes/platform/email/queue/process";

function drainResult(over: Partial<DrainResult> = {}): DrainResult {
  return { sent: 3, failed: 1, suppressed: 2, dlq: 1, duplicates: 4, stopped: null, ...over };
}

function post(authorization?: string): Promise<Response> {
  const handlers = routeServerHandlers(Route);
  return handlers.POST({
    request: new Request("https://nes.test/platform/email/queue/process", {
      method: "POST",
      headers: authorization === undefined ? {} : { Authorization: authorization },
    }),
  });
}

let savedKey: string | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;

  h.secretsEqual.mockResolvedValue(true);
  h.drainEmailQueues.mockResolvedValue(drainResult());
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  vi.useRealTimers();
  errorSpy.mockRestore();
});

describe("odmowy - konfiguracja", () => {
  it("bez klucza service_role kończy się 500, a kolejka zostaje nietknięta", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await post(`Bearer ${SERVICE_KEY}`);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Server configuration error" });
    // Dren bez klucza „opróżniłby" kolejkę zerem wysłanych wiadomości i
    // zameldował sukces - lepiej nie zaczynać przebiegu wcale.
    expect(h.drainEmailQueues).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("odmowy - autoryzacja", () => {
  it("żądanie bez nagłówka Authorization nie drenuje kolejki", async () => {
    const res = await post();

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(h.secretsEqual).not.toHaveBeenCalled();
    expect(h.drainEmailQueues).not.toHaveBeenCalled();
  });

  it("nagłówek bez prefiksu `Bearer ` jest odrzucany, a nie doklejany do sekretu", async () => {
    const res = await post(SERVICE_KEY);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(h.secretsEqual).not.toHaveBeenCalled();
  });

  it("zły sekret dostaje 403 i nie dosięga kolejki", async () => {
    h.secretsEqual.mockResolvedValue(false);

    const res = await post("Bearer zly-token");

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
    // Do porównania idzie GOŁY token, nie nagłówek z prefiksem.
    expect(h.secretsEqual).toHaveBeenCalledWith("zly-token", SERVICE_KEY);
    expect(h.drainEmailQueues).not.toHaveBeenCalled();
  });

  it("białe znaki wokół tokenu nie zamieniają dobrego sekretu w odmowę", async () => {
    const res = await post(`Bearer   ${SERVICE_KEY}  `);

    expect(res.status).toBe(200);
    expect(h.secretsEqual).toHaveBeenCalledWith(SERVICE_KEY, SERVICE_KEY);
  });
});

describe("przebieg drenu", () => {
  it("dostaje klienta service_role, budżet 100 wiadomości i deadline poniżej timeoutu", async () => {
    const res = await post(`Bearer ${SERVICE_KEY}`);

    expect(res.status).toBe(200);
    expect(h.drainEmailQueues).toHaveBeenCalledTimes(1);
    expect(h.drainEmailQueues).toHaveBeenCalledWith(h.supabaseAdmin, {
      maxMessages: 100,
      deadlineAt: NOW.getTime() + 20_000,
    });
  });

  it("odpowiedź niesie KOMPLET liczników przebiegu, nie samo `processed`", async () => {
    h.drainEmailQueues.mockResolvedValue(
      drainResult({ sent: 7, failed: 2, suppressed: 1, dlq: 3, duplicates: 5, stopped: "budget" }),
    );

    const res = await post(`Bearer ${SERVICE_KEY}`);

    // Bez `stopped` wywołujący nie odróżni „kolejki puste" od „budżet zjedzony,
    // wróć po resztę" - i zaległość rosłaby przy zielonej odpowiedzi.
    await expect(res.json()).resolves.toEqual({
      processed: 7,
      sent: 7,
      failed: 2,
      suppressed: 1,
      dlq: 3,
      duplicates: 5,
      stopped: "budget",
    });
  });

  it("`processed` mówi o WYSŁANYCH, a nie o wszystkich ruszonych wiadomościach", async () => {
    h.drainEmailQueues.mockResolvedValue(
      drainResult({ sent: 0, failed: 4, suppressed: 6, dlq: 2, duplicates: 1 }),
    );

    const res = await post(`Bearer ${SERVICE_KEY}`);
    const body: unknown = await res.json();

    expect(body).toMatchObject({ processed: 0, suppressed: 6, dlq: 2 });
  });

  it("wynik przebiegu nie trafia do żadnego cache po drodze", async () => {
    const res = await post(`Bearer ${SERVICE_KEY}`);

    // Zbuforowana odpowiedź drenu to przy kolejnym pukaniu crona przebieg,
    // który się nie odbył - a raport mówiłby, że pocztę wysłano.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
