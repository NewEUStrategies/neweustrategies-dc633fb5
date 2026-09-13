// REGRESJA: PODMIOT KUBEŁKA BRUTE-FORCE NIE MOŻE POCHODZIĆ Z NAGŁÓWKA,
// KTÓRY KLIENT SAM SOBIE USTAWIA.
//
// Dwie dziury zamknięte jedną poprawką, obie dawały ten sam skutek - bramkę
// logowania bez progu:
//
//   1. ROTACJA. `clientIpFromHeaders` brało PIERWSZY wpis `x-forwarded-for`.
//      Za Cloudflare klient dopisuje własny prefiks, a edge dokleja adres
//      połączenia na KOŃCU - pierwszy wpis jest więc deklaracją klienta.
//      Kubełek `auth_login_ip` (15/5 min) rotował się jednym nagłówkiem, więc
//      po ataku zostawał wyłącznie limit per e-mail (8/15 min), a atak
//      rozproszony po kontach przechodził bez progu.
//   2. PUSTY NAGŁÓWEK. `x-forwarded-for: " "` dawało pusty string -> "unknown"
//      -> `currentIpHash()` zwracało `null` -> `if (ipHash)` POMIJAŁO kubełek
//      IP w całości. Prostsze od rotacji: jeden nagłówek, zero kubełka.
//
// Test patrzy na `_subject`, który FAKTYCZNIE idzie do RPC `rate_limit_hit` -
// to mocniejsza asercja niż wywołanie funkcji pomocniczej, bo dowodzi, co
// ląduje w bazie. Adresy z zakresów dokumentacyjnych (RFC 5737).
import { describe, it, expect, vi, beforeEach } from "vitest";

import { callServerFn } from "@/test/serverFn";

const CF_IP = "203.0.113.7";
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
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

// Harness server fn nie stubuje `@tanstack/react-start/server`, a to stamtąd
// pochodzi `getRequest()` - jedyne źródło nagłówków dla podmiotu kubełka.
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => (h.headers ? { headers: h.headers } : {}),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (name: string, args: unknown) => h.rpc(name, args) },
}));

const { preAuthGuard } = await import("@/lib/auth/bruteforce.functions");

/** `_subject` kubełka IP dla podanego zestawu nagłówków. */
async function ipSubject(headers: Headers | null): Promise<string | undefined> {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1 }], error: null });
  h.headers = headers;
  await callServerFn(preAuthGuard, { kind: "login", email: EMAIL }, { supabase: null });
  return h.rpc.mock.calls
    .filter(([name]) => name === "rate_limit_hit")
    .map(([, args]) => args as RpcArgs)
    .find((args) => args._scope === "auth_login_ip")?._subject;
}

beforeEach(() => {
  h.headers = null;
  h.rpc.mockReset();
});

describe("podmiot kubełka `auth_login_ip`", () => {
  it("ten sam `cf-connecting-ip` i RÓŻNE `x-forwarded-for` => TEN SAM kubełek", async () => {
    const pierwszy = await ipSubject(
      new Headers({ "cf-connecting-ip": CF_IP, "x-forwarded-for": "1.2.3.4" }),
    );
    const drugi = await ipSubject(
      new Headers({ "cf-connecting-ip": CF_IP, "x-forwarded-for": "8.8.8.8, 9.9.9.9, 10.0.0.1" }),
    );

    expect(pierwszy).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(drugi).toBe(pierwszy);
  });

  it("seria podrobionych prefiksów XFF nie rozsypuje prób po kubełkach", async () => {
    const podmioty: Array<string | undefined> = [];
    for (const prefiks of ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"]) {
      podmioty.push(
        await ipSubject(
          new Headers({ "cf-connecting-ip": CF_IP, "x-forwarded-for": `${prefiks}, 5.5.5.5` }),
        ),
      );
    }

    // Gdyby podmiot brał się z pierwszego wpisu, byłyby CZTERY kubełki po
    // 15 prób każdy zamiast jednego - czyli limit nie do wyczerpania.
    expect(new Set(podmioty).size).toBe(1);
  });

  it('`x-forwarded-for: " "` bez Cloudflare NIE pomija kubełka - wpada do `ip:unknown`', async () => {
    const puste = await ipSubject(new Headers({ "x-forwarded-for": " " }));
    const brakNaglowkow = await ipSubject(new Headers());

    expect(puste).toBeDefined();
    expect(puste).toMatch(/^ip:[0-9a-f]{32}$/);
    // Ten sam WSPÓLNY kubełek co żądanie bez żadnych nagłówków - „nie wiadomo
    // od kogo" ma jeden podmiot, a nie żaden.
    expect(puste).toBe(brakNaglowkow);
  });

  it("wspólny kubełek `ip:unknown` jest INNY niż kubełek rozpoznanego adresu", async () => {
    // Inaczej pusty nagłówek zjadałby limit prawdziwemu klientowi (albo odwrotnie).
    const unknown = await ipSubject(new Headers({ "x-forwarded-for": " , " }));
    const rozpoznany = await ipSubject(new Headers({ "cf-connecting-ip": CF_IP }));

    expect(unknown).not.toBe(rozpoznany);
  });

  it("surowy adres NIE trafia do `_subject` - w `rate_limits` leży skrót", async () => {
    const subject = await ipSubject(new Headers({ "cf-connecting-ip": CF_IP }));

    expect(subject).not.toContain(CF_IP);
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("brak kontekstu nagłówków też daje kubełek, a nie jego brak", async () => {
    // `preAuthGuard` jest fail-CLOSED: podmiot musi istnieć ZAWSZE, bo inaczej
    // wywołanie spoza kontekstu HTTP omijałoby bramkę.
    const subject = await ipSubject(null);

    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });
});
