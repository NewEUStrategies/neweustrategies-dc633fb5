// OCHRONA PRZED BRUTE FORCE - 11,1% linii i 0 z 9 funkcji do 19.08.2026.
//
// To jedyna zapora między formularzem logowania a upychaniem wykradzionych
// haseł (credential stuffing). Stała nietknięta testem, choć decyduje o dwóch
// rzeczach naraz:
//   * czy atak w ogóle zostanie zatrzymany (dwa niezależne kubełki: per IP
//     i per e-mail, plus zachowanie FAIL-CLOSED przy awarii bazy),
//   * czy zatrzymując go, nie złamiemy RODO - `rate_limits` nie może
//     przechowywać surowego IP ani e-maila, bo wyciek tej tabeli pozwoliłby
//     enumerować konta.
//
// Funkcje `hashSubject`, `currentIpHash` i `hitBucket` nie są eksportowane,
// więc testujemy je PRZEZ handlery server fn - obserwując `_subject`, który
// faktycznie trafia do RPC. To mocniejsza asercja niż wywołanie skrótu wprost:
// dowodzi, co naprawdę ląduje w bazie, a nie co zwraca funkcja pomocnicza.
//
// Adresy IP są z zakresów dokumentacyjnych (TEST-NET-2/3, RFC 5737), e-maile
// z domeny .test - żaden prawdziwy identyfikator nie trafia do logów testu.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { callServerFn } from "@/test/serverFn";

const IP_A = "203.0.113.7";
const IP_B = "198.51.100.42";
const EMAIL = "ofiara@example.test";

interface RpcArgs {
  _scope: string;
  _subject: string;
  _max: number;
  _window_minutes: number;
}

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  headers: null as Headers | null,
  requestThrows: false,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

// Harness server fn nie stubuje `@tanstack/react-start/server`, a to stamtąd
// pochodzi `getRequest()` - jedyne źródło nagłówków dla `currentIpHash`.
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.requestThrows) throw new Error("brak kontekstu żądania");
    return h.headers ? { headers: h.headers } : {};
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

const { preAuthGuard, unlockContentPassword } = await import("@/lib/auth/bruteforce.functions");

/** Wywołania `rate_limit_hit` w kolejności, w jakiej poszły do bazy. */
function buckets(): RpcArgs[] {
  return h.rpc.mock.calls
    .filter(([name]) => name === "rate_limit_hit")
    .map(([, args]) => args as RpcArgs);
}

function bucketFor(scope: string): RpcArgs | undefined {
  return buckets().find((b) => b._scope === scope);
}

/** Przechwytuje odrzucenie i oddaje je jako tagowany błąd walidatora. */
async function captureError(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise;
    throw new Error("test: oczekiwano odrzucenia, a wywołanie przeszło");
  } catch (e) {
    return e as Error & { code?: string };
  }
}

function withIp(ip: string) {
  h.headers = new Headers({ "x-forwarded-for": ip });
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1 }], error: null });
  h.requestThrows = false;
  withIp(IP_A);
});

describe("preAuthGuard - dwa kubełki na każdą próbę", () => {
  it("pierwsze podejście przechodzi i uderza w OBA kubełki", async () => {
    const res = await callServerFn(
      preAuthGuard,
      { kind: "login", email: EMAIL },
      {
        supabase: null,
      },
    );

    expect(res).toEqual({ ok: true });
    expect(buckets().map((b) => b._scope)).toEqual(["auth_login_ip", "auth_login_email"]);
  });

  it("przekroczony kubełek IP zatrzymuje próbę PRZED sprawdzeniem e-maila", async () => {
    // Kolejność ma znaczenie: jeśli IP jest już odcięte, nie ma powodu
    // dokładać ruchu do kubełka e-maila.
    h.rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 16 }], error: null });

    await expect(
      callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null }),
    ).rejects.toThrow("auth: rate_limited");
    expect(bucketFor("auth_login_email")).toBeUndefined();
  });

  it("przekroczony kubełek E-MAILA zatrzymuje próbę mimo czystego IP", async () => {
    // Atak rozproszony: każdy strzał z innego adresu, wszystkie w jedno konto.
    h.rpc
      .mockResolvedValueOnce({ data: [{ allowed: true, hits: 1 }], error: null })
      .mockResolvedValueOnce({ data: [{ allowed: false, hits: 9 }], error: null });

    await expect(
      callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null }),
    ).rejects.toThrow("auth: rate_limited");
    expect(bucketFor("auth_login_email")).toBeDefined();
  });

  it("DWA różne adresy IP nie dzielą kubełka", async () => {
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const first = bucketFor("auth_login_ip")!._subject;

    h.rpc.mockClear();
    withIp(IP_B);
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")!._subject).not.toBe(first);
    expect(first).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("ten sam adres z RÓŻNYMI loginami dzieli kubełek IP, ale nie kubełek e-maila", async () => {
    // Tak wygląda upychanie haseł: jeden adres, tysiąc loginów. Kubełek IP musi
    // je zliczyć razem, inaczej limit per e-mail nigdy nie zadziała.
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const ipFirst = bucketFor("auth_login_ip")!._subject;
    const emailFirst = bucketFor("auth_login_email")!._subject;

    h.rpc.mockClear();
    await callServerFn(
      preAuthGuard,
      { kind: "login", email: "inny@example.test" },
      { supabase: null },
    );

    expect(bucketFor("auth_login_ip")!._subject).toBe(ipFirst);
    expect(bucketFor("auth_login_email")!._subject).not.toBe(emailFirst);
  });

  it("logowanie ma OSTRZEJSZE limity niż reset hasła", async () => {
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const loginIp = bucketFor("auth_login_ip")!;
    const loginEmail = bucketFor("auth_login_email")!;

    h.rpc.mockClear();
    await callServerFn(preAuthGuard, { kind: "reset", email: EMAIL }, { supabase: null });

    expect([loginIp._max, loginIp._window_minutes]).toEqual([15, 5]);
    expect([loginEmail._max, loginEmail._window_minutes]).toEqual([8, 15]);
    expect([bucketFor("auth_reset_ip")!._max, bucketFor("auth_reset_ip")!._window_minutes]).toEqual(
      [10, 15],
    );
    expect([
      bucketFor("auth_reset_email")!._max,
      bucketFor("auth_reset_email")!._window_minutes,
    ]).toEqual([5, 30]);
  });

  it("alias `signin` jest mapowany na `login` po stronie SERWERA", async () => {
    // LoginPopup i /login używają nazwy „signin"; gdyby serwer jej nie znał,
    // logowanie z popupu chodziłoby po luźniejszych limitach rejestracji.
    await callServerFn(preAuthGuard, { kind: "signin", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")).toBeDefined();
    expect(bucketFor("auth_login_ip")!._max).toBe(15);
  });

  it("BŁĄD bazy zamyka bramę, a nie ją otwiera (fail-closed)", async () => {
    // Awaria RPC nie może zdejmować limitu - inaczej wystarczy przeciążyć bazę,
    // żeby wyłączyć całą ochronę.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    await expect(
      callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null }),
    ).rejects.toThrow("auth: rate_limited");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("odpowiedź RPC bez wiersza też zamyka bramę", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null }),
    ).rejects.toThrow("auth: rate_limited");
    expect(buckets()).toHaveLength(1);
  });

  it("wejście, które nie jest obiektem, też daje `invalid_input`", async () => {
    // Ścieżka błędu jest wtedy pusta - komunikat nie może się wywalić na
    // sklejaniu nieistniejącej ścieżki pola.
    const err = await captureError(callServerFn(preAuthGuard, null, { supabase: null }));

    expect(err.code).toBe("invalid_input");
    expect(err.message).toBe("auth: invalid_input");
  });

  it("złe wejście daje tagowany błąd `invalid_input`, nie surowy ZodError", async () => {
    // Klient ma dostać przewidywalny kod, nie JSON-a w toastcie.
    const err = await captureError(
      callServerFn(
        preAuthGuard,
        { kind: "login", email: "to-nie-jest-email" },
        {
          supabase: null,
        },
      ),
    );

    expect(err.code).toBe("invalid_input");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("preAuthGuard - RODO: co ląduje w rate_limits", () => {
  it("kubełek NIE zawiera adresu IP w postaci jawnej", async () => {
    // To jest treść tej zapory, nie szczegół implementacyjny: wyciek
    // `rate_limits` nie może ujawnić, kto się logował.
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    const subject = bucketFor("auth_login_ip")!._subject;
    expect(subject).not.toContain(IP_A);
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("kubełek NIE zawiera adresu e-mail w postaci jawnej", async () => {
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    const subject = bucketFor("auth_login_email")!._subject;
    expect(subject).not.toContain(EMAIL);
    expect(subject).not.toContain("example.test");
    expect(subject).toMatch(/^email:login:[0-9a-f]{32}$/);
  });

  it("skrót jest STABILNY - to samo wejście daje ten sam kubełek", async () => {
    // Bez stabilności licznik zerowałby się przy każdej próbie i limit nigdy
    // by nie zadziałał.
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const first = bucketFor("auth_login_email")!._subject;

    h.rpc.mockClear();
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_email")!._subject).toBe(first);
  });

  it("e-mail jest normalizowany - wielkość liter nie omija limitu", async () => {
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const lower = bucketFor("auth_login_email")!._subject;

    h.rpc.mockClear();
    await callServerFn(
      preAuthGuard,
      { kind: "login", email: "  OFIARA@Example.TEST  " },
      { supabase: null },
    );

    expect(bucketFor("auth_login_email")!._subject).toBe(lower);
  });

  it("ten sam e-mail w RÓŻNYCH trybach ma osobne kubełki", async () => {
    // Inaczej nieudane resety zjadałyby limit logowania temu samemu userowi.
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const login = bucketFor("auth_login_email")!._subject;

    h.rpc.mockClear();
    await callServerFn(preAuthGuard, { kind: "reset", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_reset_email")!._subject).not.toBe(login);
  });
});

describe("preAuthGuard - żądanie bez rozpoznawalnego adresu", () => {
  it("czyta adres z `x-real-ip`, gdy nie ma `x-forwarded-for`", async () => {
    h.headers = new Headers({ "x-real-ip": IP_B });

    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")).toBeDefined();
  });

  it("bierze PIERWSZY adres z łańcucha `x-forwarded-for`", async () => {
    h.headers = new Headers({ "x-forwarded-for": `${IP_A}, ${IP_B}` });
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
    const chained = bucketFor("auth_login_ip")!._subject;

    h.rpc.mockClear();
    withIp(IP_A);
    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")!._subject).toBe(chained);
  });

  it("STAN FAKTYCZNY: brak nagłówka IP znosi kubełek per adres", async () => {
    // UWAGA - to jest utrwalenie DEFEKTU, nie potwierdzenie poprawności.
    // Gdy nagłówków nie ma, `currentIpHash()` zwraca null, a handler pomija
    // kubełek IP i zostaje sam limit per e-mail. Żądanie „nie wiadomo od kogo"
    // powinno trafiać do wspólnego kubełka `ip:unknown`, a nie wymykać się
    // limitowi. Naprawa idzie osobnym commitem, żeby ta zmiana zachowania była
    // widoczna w historii.
    h.headers = new Headers();

    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")).toBeUndefined();
    expect(buckets().map((b) => b._scope)).toEqual(["auth_login_email"]);
  });

  it("STAN FAKTYCZNY: żądanie BEZ nagłówków w ogóle znosi kubełek per adres", async () => {
    // Wariant inny niż pusty zestaw nagłówków: obiekt żądania bez pola
    // `headers` (tak wygląda wywołanie spoza kontekstu HTTP).
    h.headers = null;

    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")).toBeUndefined();
    expect(buckets()).toHaveLength(1);
  });

  it("STAN FAKTYCZNY: brak kontekstu żądania też znosi kubełek per adres", async () => {
    h.requestThrows = true;

    await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });

    expect(bucketFor("auth_login_ip")).toBeUndefined();
    expect(buckets()).toHaveLength(1);
  });

  it("limit per e-mail działa dalej, gdy adresu nie da się ustalić", async () => {
    // Zapora jest osłabiona, ale nie zniknięta - to jedyny powód, dla którego
    // defekt wyżej nie jest krytyczny.
    h.headers = new Headers();
    h.rpc.mockResolvedValue({ data: [{ allowed: false, hits: 9 }], error: null });

    await expect(
      callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null }),
    ).rejects.toThrow("auth: rate_limited");
    expect(bucketFor("auth_login_email")).toBeDefined();
  });
});

describe("unlockContentPassword - paywall", () => {
  const UNLOCK = {
    entityType: "post" as const,
    entityId: "55555555-5555-4555-8555-555555555555",
    password: "tajne-haslo",
  };

  beforeEach(() => {
    h.rpc.mockReset();
    withIp(IP_A);
  });

  it("przekazuje SKRÓT adresu, nie adres - limit liczy baza", async () => {
    h.rpc.mockResolvedValue({
      data: [{ ok: true, content_pl: "treść", content_en: null }],
      error: null,
    });

    await callServerFn(unlockContentPassword, UNLOCK, { supabase: null });

    const args = h.rpc.mock.calls[0]![1] as { _ip_hash?: string };
    expect(args._ip_hash).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(args._ip_hash).not.toContain(IP_A);
  });

  it("poprawne hasło zwraca treść w obu językach", async () => {
    h.rpc.mockResolvedValue({
      data: [{ ok: true, content_pl: "treść", content_en: "body", builder_data: { a: 1 } }],
      error: null,
    });

    const res = await callServerFn<{ ok: boolean; content_pl: string; builder_data: unknown }>(
      unlockContentPassword,
      UNLOCK,
      { supabase: null },
    );

    expect(res.ok).toBe(true);
    expect(res.content_pl).toBe("treść");
    expect(res.builder_data).toEqual({ a: 1 });
  });

  it("ZŁE hasło nie przecieka treścią - wszystkie pola puste", async () => {
    h.rpc.mockResolvedValue({ data: [{ ok: false }], error: null });

    const res = await callServerFn<Record<string, unknown>>(unlockContentPassword, UNLOCK, {
      supabase: null,
    });

    expect(res.ok).toBe(false);
    expect(res.content_pl).toBeNull();
    expect(res.content_en).toBeNull();
  });

  it("brak wiersza z bazy też nie przecieka treścią", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });

    const res = await callServerFn<Record<string, unknown>>(unlockContentPassword, UNLOCK, {
      supabase: null,
    });

    expect(res.ok).toBe(false);
    expect(res.builder_data).toBeNull();
  });

  it("limit bazy jest tłumaczony na osobny kod błędu", async () => {
    // UI rozróżnia „złe hasło" od „za dużo prób" - drugi komunikat ma
    // powiedzieć, żeby poczekać, a nie żeby zgadywać dalej.
    h.rpc.mockResolvedValue({ data: null, error: { message: "too many attempts" } });

    await expect(callServerFn(unlockContentPassword, UNLOCK, { supabase: null })).rejects.toThrow(
      "content_password: rate_limited",
    );
  });

  it("inny błąd bazy nie ujawnia swojej treści klientowi", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'relation "posts" does not exist' } });

    await expect(callServerFn(unlockContentPassword, UNLOCK, { supabase: null })).rejects.toThrow(
      "content_password: failed",
    );
  });

  it("bez rozpoznanego adresu przekazuje `undefined`, a nie pusty skrót", async () => {
    // `null` w tym miejscu wywaliłby RPC na typie; baza ma dostać brak
    // wartości i policzyć wyłącznie limit per encja.
    h.headers = new Headers();
    h.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });

    await callServerFn(unlockContentPassword, UNLOCK, { supabase: null });

    const args = h.rpc.mock.calls[0]![1] as { _ip_hash?: string };
    expect(args._ip_hash).toBeUndefined();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("odpowiedź RPC, która nie jest tablicą, nie przecieka treścią", async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, content_pl: "treść" }, error: null });

    const res = await callServerFn<Record<string, unknown>>(unlockContentPassword, UNLOCK, {
      supabase: null,
    });

    expect(res.ok).toBe(false);
    expect(res.content_pl).toBeNull();
  });

  it("brakujące pola treści schodzą na `null`, nie na `undefined`", async () => {
    // `undefined` po serializacji znika z odpowiedzi i klient dostaje obiekt
    // o innym kształcie niż deklarowany.
    h.rpc.mockResolvedValue({ data: [{ ok: true }], error: null });

    const res = await callServerFn<Record<string, unknown>>(unlockContentPassword, UNLOCK, {
      supabase: null,
    });

    expect(res.ok).toBe(true);
    expect(res.content_pl).toBeNull();
    expect(res.content_en).toBeNull();
    expect(res.blocks_data).toBeNull();
  });

  it("walidator odrzuca puste hasło - bez dotykania bazy", async () => {
    await expect(
      callServerFn(unlockContentPassword, { ...UNLOCK, password: "" }, { supabase: null }),
    ).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
