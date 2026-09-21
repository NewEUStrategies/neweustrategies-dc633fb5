// Leniwy klient Supabase w `postViews.functions.ts` - jeden na izolat (N5).
//
// PO CO TEN PLIK ISTNIEJE. `recordPostView` jest wołane raz na odsłonę
// artykułu, a do tej zmiany budowało nowego klienta Supabase przy KAŻDYM
// wywołaniu. Hoist do leniwego singletona jest tani, ale w izolacie Workers,
// który obsługuje RÓWNOLEGLE żądania z różnych domen, współdzielony klient
// jest hipotezą o izolacji najemcy - a nie o wydajności. Ten plik tę hipotezę
// sprawdza, zamiast jej ufać:
//
//   1. KLIENT POWSTAJE RAZ. Dwa wywołania server fn to jedno `createClient`.
//      Ten przypadek jest CZERWONY na kodzie sprzed zmiany (dwa wywołania).
//   2. TENANT NADAL IDZIE PER ŻĄDANIE. Dwa żądania z RÓŻNYCH hostów dostają
//      RÓŻNE nagłówki `x-tenant-host` z TEGO SAMEGO egzemplarza klienta.
//      Ten przypadek jest zielony po obu stronach - i taki ma być: to jest
//      strażnik, który zapala się dopiero wtedy, gdy ktoś „zoptymalizuje"
//      rozwiązywanie hosta do chwili konstrukcji. Wtedy singleton przestaje
//      być bezpieczny, a panel jednego wydawcy zaczyna liczyć odsłony
//      drugiego.
//
// Nie testuję tu treści RPC ani mapowania wierszy - to robią pozostałe testy
// tego katalogu. Przedmiotem dowodu jest wyłącznie tożsamość klienta i droga,
// jaką nagłówek tenanta do niego trafia.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  created: 0,
  /** Host, jaki `currentTenantHost()` zwróci w danym momencie testu. */
  host: null as string | null,
  /** Nagłówki `x-tenant-host` zaobserwowane na kolejnych round-tripach. */
  seenHosts: [] as (string | null)[],
  /** Wrapper fetcha przekazany do `createClient` w opcjach globalnych. */
  globalFetch: null as ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null,
  /** Opcje, z jakimi zbudowano klienta - do asercji o braku stanu żądania. */
  globalOptions: null as Record<string, unknown> | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: { global?: Record<string, unknown> }) => {
    h.created += 1;
    h.globalOptions = options.global ?? {};
    h.globalFetch = options.global?.fetch as typeof h.globalFetch;
    return {
      // Każde RPC przechodzi PRZEZ wrapper fetcha z opcji globalnych - tylko
      // wtedy test mierzy prawdziwą drogę nagłówka, a nie własną atrapę.
      rpc: async () => {
        await h.globalFetch?.("https://db.example.test/rest/v1/rpc/record_post_view", {
          method: "POST",
        });
        return { data: null, error: null };
      },
      from: () => ({ select: () => ({}) }),
    };
  },
}));

// Prawdziwy `fetchWithTenantHost` - to on jest przedmiotem dowodu w punkcie 2.
vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => h.host,
  currentTenantAssertion: async () => null,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

import { recordPostView } from "../postViews.functions";
import type { ServerFnSpec } from "@/test/serverFnHarness";

const spec = recordPostView as unknown as ServerFnSpec<{ postId: string; viewerHash: string }>;
const POST_ID = "11111111-2222-3333-4444-555555555555";
const VIEWER = "0123456789abcdef0123456789abcdef";

async function call(host: string | null) {
  h.host = host;
  const data = spec.validator!({ postId: POST_ID, viewerHash: VIEWER });
  return spec.handler!({ data, context: { supabase: null } });
}

// `created` NIE jest zerowane między przypadkami i to jest celowe: singleton
// żyje na poziomie MODUŁU, więc zerowanie licznika kazałoby asercjom zależeć od
// kolejności bloków. Każdy przypadek mierzy zatem PRZYROST wobec stanu sprzed
// siebie - twierdzenie „to wywołanie (nie) zbudowało klienta" jest wtedy
// prawdziwe niezależnie od tego, co biegło wcześniej.
beforeEach(() => {
  h.seenHosts = [];
  h.host = null;
  process.env.SUPABASE_URL = "https://db.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-klucz-testowy";
  vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    h.seenHosts.push(headers.get("x-tenant-host"));
    return new Response(null, { status: 200 });
  });
});

describe("tożsamość klienta", () => {
  it("DWA wywołania budują JEDEN egzemplarz klienta", async () => {
    await call("pierwszy.example.test");
    const afterFirst = h.created;
    await call("drugi.example.test");

    // Pierwsze wywołanie w pliku buduje klienta - i to jedyny raz.
    expect(afterFirst).toBe(1);
    expect(h.created).toBe(1);
  });

  it("opcje globalne NIE niosą nagłówków - inaczej singleton zamroziłby tenanta", async () => {
    // To jest warunek, pod którym współdzielenie klienta jest w ogóle
    // dopuszczalne: gdyby `headers` było ustawione przy konstrukcji, pierwszy
    // host w izolacie obowiązywałby wszystkich następnych.
    await call("pierwszy.example.test");

    expect(h.globalOptions).not.toBeNull();
    expect(Object.keys(h.globalOptions!)).toEqual(["fetch"]);
  });
});

describe("izolacja najemcy przy współdzielonym kliencie", () => {
  it("dwa żądania z RÓŻNYCH hostów dostają RÓŻNE nagłówki tenanta z tego samego klienta", async () => {
    const before = h.created;
    await call("pierwszy.example.test");
    await call("drugi.example.test");

    // Zero DODATKOWYCH konstrukcji: oba żądania przeszły przez ten sam klient.
    expect(h.created).toBe(before);
    expect(h.seenHosts).toEqual(["pierwszy.example.test", "drugi.example.test"]);
  });

  it("brak hosta NIE dziedziczy hosta z poprzedniego żądania", async () => {
    // Zadanie w tle (bez kontekstu żądania) musi trafić na domyślnego tenanta,
    // a nie na tenanta ostatniego czytelnika, który przeszedł przez ten izolat.
    await call("pierwszy.example.test");
    await call(null);

    expect(h.seenHosts).toEqual(["pierwszy.example.test", null]);
  });
});
