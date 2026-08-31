// Pobranie materiału z biblioteki członkowskiej - 0 z 2 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `downloadMemberResource` to jedyna droga do plików
// w PRYWATNYM kubełku `member-resources` - klient nie ma do niego odczytu.
// Handler robi dwie rzeczy i obie są bramkami:
//
//   1. PYTA BAZĘ O ZGODĘ. `authorize_resource_download` (SECURITY DEFINER,
//      wykonywane JAKO użytkownik) sprawdza publikację i rangę warstwy oraz
//      zapisuje wiersz pobrania. Dopiero jego odpowiedź niesie ścieżkę pliku.
//   2. PODPISUJE URL ROLĄ SERWISOWĄ. To jest moment, w którym plik naprawdę
//      staje się dostępny - podpis powstaje kluczem serwisowym, więc omija RLS.
//
// Z tego układu wynika NAJWAŻNIEJSZA asercja tego pliku, powtórzona przy
// KAŻDEJ odmowie: przy braku zgody bazy NIE MOŻE powstać żaden podpisany
// adres. Odwrócenie kolejności albo „podpiszmy, i tak sprawdzimy potem"
// oznacza wyciek pliku dla warstwy, która za niego nie zapłaciła - a podpisany
// URL działa dalej także po zamknięciu konta.
//
// Druga pilnowana rzecz to MAPOWANIE KOMUNIKATÓW bazy na stabilne kody
// (`tier_required` / `not_found` / `auth_required` / `failed`). Interfejs
// pokazuje po nich różne komunikaty i18n; regresja w mapowaniu zamienia
// „wykup wyższy plan" w „coś poszło nie tak", czyli gasi ścieżkę sprzedaży.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI PRZEZ MIDDLEWARE - harness
// (`src/test/serverFnHarness.ts`) go nie uruchamia. Deklarację
// `requireSupabaseAuth` przybijamy strukturalnie; prawdziwej bramki rangi
// pilnuje baza (pgTAP na `authorize_resource_download`).
//
// GRANICE, KTÓRE ATRAPUJEMY: klient Supabase użytkownika (RPC) i dynamiczny
// import klienta serwisowego (podpis URL). Zero sieci, zero kluczy.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseRpcStub } from "@/test/supabase";
import { asServerFn, callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  /** Kubełki, o które poproszono klienta serwisowego. */
  buckets: [] as string[],
  /** Argumenty podpisu: ścieżka, czas życia, opcje. */
  signArgs: [] as Array<[string, number, Record<string, unknown> | undefined]>,
  signed: { signedUrl: "https://podpisany.example.com/plik.pdf" } as
    | { signedUrl?: string }
    | null,
  signError: null as { message: string } | null,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => {
        h.buckets.push(bucket);
        return {
          createSignedUrl: (
            path: string,
            ttl: number,
            options?: Record<string, unknown>,
          ) => {
            h.signArgs.push([path, ttl, options]);
            return Promise.resolve({ data: h.signed, error: h.signError });
          },
        };
      },
    },
  },
}));

const { downloadMemberResource } = await import("@/lib/billing/resources.functions");

const RPC = "authorize_resource_download";
/** Identyfikator materiału - losowy UUID testowy, bez związku z produkcją. */
const MATERIAL = "11111111-2222-4333-8444-555555555555";

const rpc = supabaseRpcStub();

/** Kontekst, jaki middleware uwierzytelniające wstrzykuje handlerowi. */
const KONTEKST = { supabase: { rpc: rpc.rpc }, userId: "user-czlonek" };

/** Wiersz zgody z RPC - ścieżka i nazwa pliku do podpisu. */
function zgoda(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file_path: "2026/analiza-cee.pdf",
    file_name: "analiza-cee.pdf",
    mime_type: "application/pdf",
    ...over,
  };
}

function waliduj(input: unknown): unknown {
  const spec = asServerFn(downloadMemberResource);
  if (!spec.validator) throw new Error("test: funkcja bez walidatora");
  return spec.validator(input);
}

beforeEach(() => {
  vi.restoreAllMocks();
  rpc.reset();
  h.buckets.length = 0;
  h.signArgs.length = 0;
  h.signed = { signedUrl: "https://podpisany.example.com/plik.pdf" };
  h.signError = null;
  rpc.setResponse(RPC, ok([zgoda()]));
});

describe("obudowa - bramka i metoda", () => {
  it("wymaga uwierzytelnionej sesji", () => {
    // Dowód STRUKTURALNY - harness nie uruchamia middleware. Gdyby ta
    // deklaracja zniknęła, RPC pobiegłoby bez tożsamości, a bramka rangi
    // w bazie nie miałaby kogo sprawdzić.
    expect(serverFnMiddlewareNames(downloadMemberResource)).toEqual(["requireSupabaseAuth"]);
  });

  it("jest operacją zapisu (POST) - pobranie zostawia ślad w historii", () => {
    // RPC zapisuje wiersz do `resource_downloads` (licznik + historia
    // uczestnictwa), więc GET byłby kłamstwem o skutkach ubocznych i dałby się
    // wyzwolić prefetchem przeglądarki.
    expect(asServerFn(downloadMemberResource).method).toBe("POST");
  });
});

describe("walidator wejścia", () => {
  it("przyjmuje poprawny identyfikator materiału", () => {
    expect(waliduj({ resourceId: MATERIAL })).toEqual({ resourceId: MATERIAL });
  });

  it("odrzuca brak pola", () => {
    expect(() => waliduj({})).toThrow();
    expect(() => waliduj(undefined)).toThrow();
    expect(() => waliduj(null)).toThrow();
  });

  it("odrzuca pusty napis", () => {
    expect(() => waliduj({ resourceId: "" })).toThrow();
  });

  it("odrzuca napis, który nie jest UUID", () => {
    // Identyfikator idzie do RPC jako parametr `uuid`; napis spoza formatu
    // kończyłby się błędem bazy zamiast czytelną odmową na wejściu.
    expect(() => waliduj({ resourceId: "materialy/../../etc/passwd" })).toThrow();
    expect(() => waliduj({ resourceId: "12345" })).toThrow();
  });

  it("odrzuca UUID otoczony białymi znakami", () => {
    // Brak przycinania jest tu świadomy: to nie jest pole tekstowe
    // wypełniane ręcznie, tylko identyfikator z interfejsu.
    expect(() => waliduj({ resourceId: ` ${MATERIAL} ` })).toThrow();
  });

  it("odrzuca typ inny niż napis", () => {
    expect(() => waliduj({ resourceId: 42 })).toThrow();
    expect(() => waliduj({ resourceId: { id: MATERIAL } })).toThrow();
    expect(() => waliduj({ resourceId: [MATERIAL] })).toThrow();
    expect(() => waliduj({ resourceId: null })).toThrow();
  });

  it("obce pola są odcinane", () => {
    expect(waliduj({ resourceId: MATERIAL, filePath: "prywatny/klucz.pem" })).toEqual({
      resourceId: MATERIAL,
    });
  });
});

describe("ścieżka przejścia", () => {
  it("pyta bazę o zgodę identyfikatorem z ładunku i podpisuje wskazany plik", async () => {
    const wynik = await callServerFn(downloadMemberResource, {
      data: { resourceId: MATERIAL },
      context: KONTEKST,
    });

    expect(rpc.lastCall(RPC)?.args).toEqual({ p_resource: MATERIAL });
    expect(h.buckets).toEqual(["member-resources"]);
    expect(wynik).toEqual({
      ok: true,
      url: "https://podpisany.example.com/plik.pdf",
      fileName: "analiza-cee.pdf",
    });
  });

  it("podpis jest KRÓTKOTRWAŁY i wymusza pobranie pod nazwą pliku", async () => {
    // Czas życia to jedyne ograniczenie po wydaniu adresu: podpisany URL
    // działa dalej bez sesji, więc długi TTL zamienia jednorazową zgodę
    // w link do dowolnego przekazania.
    await callServerFn(downloadMemberResource, {
      data: { resourceId: MATERIAL },
      context: KONTEKST,
    });

    expect(h.signArgs).toEqual([
      ["2026/analiza-cee.pdf", 120, { download: "analiza-cee.pdf" }],
    ]);
  });

  it("odpowiedź RPC w postaci pojedynczego wiersza (nie tablicy) też działa", async () => {
    // Funkcja `RETURNS TABLE` oddaje tablicę, ale klient potrafi zwrócić sam
    // obiekt (`.single()` po stronie definicji). Obsługa obu kształtów jest
    // w kodzie - test pilnuje, że nie jest martwa.
    rpc.setResponse(RPC, ok(zgoda({ file_name: "raport.pdf" })));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({
      ok: true,
      url: "https://podpisany.example.com/plik.pdf",
      fileName: "raport.pdf",
    });
  });
});

describe("odmowy bazy - żaden podpis nie powstaje", () => {
  it("brak rangi warstwy daje kod `tier_required`", async () => {
    // To jest ścieżka SPRZEDAŻOWA: interfejs pokazuje po tym kodzie zaproszenie
    // do wyższego planu. Zamiana na ogólne „failed" gasi ją bez śladu.
    rpc.setResponse(RPC, fail("resources: tier required"));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "tier_required" });
    expect(h.signArgs).toEqual([]);
  });

  it("materiał nieopublikowany lub nieistniejący daje `not_found`", async () => {
    rpc.setResponse(RPC, fail("resources: not found"));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(h.signArgs).toEqual([]);
  });

  it("brak tożsamości w bazie daje `auth_required`", async () => {
    rpc.setResponse(RPC, fail("resources: authentication required"));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "auth_required" });
    expect(h.signArgs).toEqual([]);
  });

  it("nieznany błąd bazy daje `failed` i wpis do dziennika", async () => {
    // Nieznany komunikat NIE MOŻE degradować się do „brak dostępu" ani do
    // sukcesu - musi zostawić ślad, bo to jedyny sygnał o awarii RPC.
    const dziennik = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.setResponse(RPC, fail("deadlock detected", "40P01"));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "failed" });
    expect(dziennik).toHaveBeenCalled();
    expect(h.signArgs).toEqual([]);
  });

  it("błąd z pustym komunikatem też daje `failed`", async () => {
    // `error.message || ""` - gałąź pustego komunikatu istnieje w kodzie
    // i musi kończyć się odmową, a nie wpadnięciem w mapowanie „not found".
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.setResponse(RPC, fail(""));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "failed" });
  });

  it("zgoda bez ścieżki pliku daje `not_found`, nie podpis pustej ścieżki", async () => {
    // Podpisanie `undefined` skończyłoby się adresem do korzenia kubełka.
    rpc.setResponse(RPC, ok([zgoda({ file_path: null })]));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(h.signArgs).toEqual([]);
  });

  it("pusta odpowiedź RPC daje `not_found`", async () => {
    rpc.setResponse(RPC, ok([]));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(h.signArgs).toEqual([]);
  });

  it("odpowiedź RPC `null` daje `not_found`", async () => {
    rpc.setResponse(RPC, ok(null));

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "not_found" });
    expect(h.signArgs).toEqual([]);
  });
});

describe("awaria podpisu", () => {
  it("błąd magazynu daje `failed` i wpis do dziennika", async () => {
    // Zgoda już zapadła (wiersz pobrania zapisany), więc cisza w tym miejscu
    // dałaby użytkownikowi „nic się nie dzieje" przy zużytym limicie pobrań.
    const dziennik = vi.spyOn(console, "error").mockImplementation(() => {});
    h.signError = { message: "storage: object not found" };
    h.signed = null;

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "failed" });
    expect(dziennik).toHaveBeenCalled();
  });

  it("odpowiedź magazynu bez adresu daje `failed`", async () => {
    // Magazyn potrafi oddać `{ data: {}, error: null }`; bez tej gałęzi
    // interfejs dostałby `url: undefined` i pusty przycisk pobierania.
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.signed = {};

    await expect(
      callServerFn(downloadMemberResource, {
        data: { resourceId: MATERIAL },
        context: KONTEKST,
      }),
    ).resolves.toEqual({ ok: false, error: "failed" });
  });
});
