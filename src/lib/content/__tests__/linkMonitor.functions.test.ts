// CIAŁO handlera server fn `runLinkScanNow` (`src/lib/content/linkMonitor.functions.ts`) -
// przycisk „skanuj teraz" w panelu `admin.link-monitor`. Do tej pory ani jedno
// wywołanie tej funkcji nie przeszło przez test (0/2 funkcji, 0/4 gałęzi),
// choć to ona rozstrzyga, ILE wpisów pociągnie ręczny skan i CZYIM klientem.
//
// CO DOWODZI TEN PLIK:
//   * KONTRAKT WEJŚCIA (walidator zod): `posts` to liczba CAŁKOWITA z zakresu
//     1..20, domyślnie 10. Górna granica nie jest kosmetyką - każdy wpis to
//     do pięćdziesięciu sond HTTP z timeoutem 6 s, więc porcja spoza zakresu
//     zamieniłaby kliknięcie w panelu w wielominutowe odpytywanie obcych
//     serwerów. Odrzucenie następuje PRZED limiterem i PRZED skanem (asercja
//     na zerowej liczbie wywołań obu atrap);
//   * ODMOWĘ LIMITERA jako twardy koniec pracy: `link-monitor.scan`, max 6,
//     podmiot z kontekstu - a przy odmowie skaner NIE rusza;
//   * KLIENTA, którym idzie skan: `supabaseAdmin` (service role), nie klient
//     użytkownika z kontekstu. Skaner czyta kolumny treści (`content_pl`,
//     `blocks_data`), które dla klienta użytkownika są odcięte, więc pomyłka
//     w tym argumencie dałaby ciche „0 wpisów do sprawdzenia";
//   * PRZEŹROCZYSTOŚĆ wyniku: handler oddaje obiekt `runLinkCheckBatch`
//     bez przepakowania, a wyjątek skanera wychodzi do wywołującego.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * AUTORYZACJI. Atrapa `createServerFn` (`src/test/serverFn.ts`) NIE
//     wykonuje middleware. Jedyna asercja o autoryzacji to `serverFnMeta()`:
//     funkcja DEKLARUJE `requireStaff` i metodę POST; że brama trzyma na żywym
//     SSR, pilnuje `check:authz-snapshot`. Zieleń tego pliku wolno czytać jako
//     „logika handlera jest poprawna", nigdy jako „obcy się nie dostanie";
//   * SAMEGO SKANU. Rotacja wpisów, wyciąganie URL-i, sondy, migawki Wayback
//     i próg alertu mają własny plik `src/lib/server/__tests__/linkCheckBatch.test.ts` -
//     tutaj `runLinkCheckBatch` jest atrapą, bo to ona sięgałaby do sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  runLinkCheckBatch: vi.fn(),
  /** Znacznik pozwala odróżnić klienta service role od klienta użytkownika. */
  supabaseAdmin: { __client: "service-role" } as const,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: h.supabaseAdmin }));
vi.mock("@/lib/server/linkCheck.server", () => ({ runLinkCheckBatch: h.runLinkCheckBatch }));

import { requireStaff } from "@/integrations/supabase/require-staff";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { runLinkScanNow } from "@/lib/content/linkMonitor.functions";

const USER = "11111111-1111-4111-8111-111111111111";
/** Klient użytkownika z kontekstu - NIE ten, którym ma iść skan. */
const userScoped = { __client: "user-scoped" } as const;

const BATCH = { postsScanned: 3, linksChecked: 41, broken: 2, archived: 1, alerted: 0 };

beforeEach(() => {
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.runLinkCheckBatch.mockReset().mockResolvedValue(BATCH);
  setServerFnContext({ supabase: userScoped, userId: USER });
});

afterEach(() => {
  resetServerFnContext();
});

describe("obudowa server fn", () => {
  it("runLinkScanNow to POST z middleware requireStaff I walidatorem wejścia", () => {
    const meta = serverFnMeta(runLinkScanNow);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toContain(requireStaff);
    expect(meta?.hasValidator).toBe(true);
  });
});

describe("walidator porcji", () => {
  it("BEZ wejścia skanuje domyślne dziesięć wpisów", async () => {
    await runLinkScanNow();
    expect(h.runLinkCheckBatch).toHaveBeenCalledWith(h.supabaseAdmin, 10);
  });

  it("pusty obiekt to to samo co brak wejścia - nadal dziesięć wpisów", async () => {
    await runLinkScanNow({ data: {} });
    expect(h.runLinkCheckBatch).toHaveBeenCalledWith(h.supabaseAdmin, 10);
  });

  it("przyjmuje dolną granicę jednego wpisu i górną dwudziestu", async () => {
    await runLinkScanNow({ data: { posts: 1 } });
    expect(h.runLinkCheckBatch).toHaveBeenLastCalledWith(h.supabaseAdmin, 1);
    await runLinkScanNow({ data: { posts: 20 } });
    expect(h.runLinkCheckBatch).toHaveBeenLastCalledWith(h.supabaseAdmin, 20);
  });

  it("ODRZUCA zero wpisów, NIE pytając limitera ani skanera", async () => {
    await expect(runLinkScanNow({ data: { posts: 0 } })).rejects.toThrow();
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.runLinkCheckBatch).not.toHaveBeenCalled();
  });

  it("ODRZUCA dwudziesty pierwszy wpis - porcja ma sufit", async () => {
    await expect(runLinkScanNow({ data: { posts: 21 } })).rejects.toThrow();
    expect(h.runLinkCheckBatch).not.toHaveBeenCalled();
  });

  it("ODRZUCA liczbę niecałkowitą", async () => {
    await expect(runLinkScanNow({ data: { posts: 3.5 } })).rejects.toThrow();
    expect(h.runLinkCheckBatch).not.toHaveBeenCalled();
  });

  it("ODRZUCA porcję podaną tekstem - walidator nie rzutuje „10” na liczbę", async () => {
    await expect(runLinkScanNow({ data: { posts: "10" } })).rejects.toThrow();
    expect(h.runLinkCheckBatch).not.toHaveBeenCalled();
  });
});

describe("limit tempa", () => {
  it("odmowa limitera KOŃCZY żądanie i skan NIE rusza", async () => {
    h.rateLimit.mockResolvedValue(false);
    await expect(runLinkScanNow({ data: { posts: 5 } })).rejects.toThrow(
      "Rate limit exceeded - please slow down",
    );
    expect(h.runLinkCheckBatch).not.toHaveBeenCalled();
  });

  it("limiter liczy zakres link-monitor.scan na wywołującego z sufitem sześciu", async () => {
    await runLinkScanNow({ data: { posts: 4 } });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "link-monitor.scan",
      subjectId: USER,
      max: 6,
    });
  });
});

describe("uruchomienie skanu", () => {
  it("skan idzie klientem service role, a NIE klientem użytkownika z kontekstu", async () => {
    await runLinkScanNow({ data: { posts: 2 } });
    const [client] = h.runLinkCheckBatch.mock.calls[0];
    expect(client).toBe(h.supabaseAdmin);
    expect(client).not.toBe(userScoped);
  });

  it("oddaje wynik porcji BEZ przepakowania", async () => {
    const result = await runLinkScanNow({ data: { posts: 3 } });
    expect(result).toBe(BATCH);
    expect(result).toEqual({
      postsScanned: 3,
      linksChecked: 41,
      broken: 2,
      archived: 1,
      alerted: 0,
    });
  });

  it("błąd skanera wychodzi do wywołującego, a nie kończy się cichym zerem", async () => {
    h.runLinkCheckBatch.mockRejectedValue(new Error("posts select failed"));
    await expect(runLinkScanNow({ data: { posts: 2 } })).rejects.toThrow("posts select failed");
  });
});
