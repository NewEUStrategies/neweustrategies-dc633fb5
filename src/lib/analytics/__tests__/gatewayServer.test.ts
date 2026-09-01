// PO CO TEN PLIK. `src/lib/analytics/gateway.server.ts` to WSPÓLNA bramka całej
// warstwy danych panelu BI - wchodzi tu z zerem pokrycia (0 z 9 linii), a
// przechodzi przez nią każde wywołanie GA4 (`runGa4Report`, `sendGa4Event`)
// i warstwa semantyczna (`snapshot.functions.ts`). Plik powstał właśnie dlatego,
// że kopia `requireAdmin` żyła w kilku modułach i utwardzenie jednej nie
// propagowało się na resztę - ale sam nigdy nie był dotknięty testem, więc
// „jedno miejsce" było jednym miejscem BEZ ŚWIADKA.
//
// Trzy klasy defektów, których nikt tu dotąd nie łapał:
//
//  1) BRAMKA, KTÓRA WPUSZCZA. `has_role` oddaje `data` i `error`. Trzy sposoby
//     na otwarcie bramki bez zmiany ani jednej linijki logiki biznesowej:
//     potraktowanie `error` jak „nie wiem, przepuść", uznanie `null` (brak
//     wiersza roli) za prawdę, albo zapytanie o CUDZĄ tożsamość zamiast
//     `context.userId`. Każdy z tych błędów przechodzi przez `tsc`, bo `data`
//     jest typowane jako `unknown`.
//
//  2) IZOLACJA NAJEMCÓW OPARTA NA KLIENCIE, NIE NA PARAMETRZE. `has_role()`
//     filtruje `user_roles` po `current_tenant_id()`, czyli po JWT klienta
//     wołającego - tenant NIE jest argumentem. Cała izolacja stoi więc na tym,
//     że RPC leci przez `context.supabase` (klient najemcy), a nie przez klienta
//     service role. Ta sama zasada rządzi odczytem `site_settings`: gdyby ktoś
//     podmienił tu klienta na uprzywilejowany, najemca A dostałby property GA4
//     najemcy B - i nic by nie zaprotestowało. Testy niżej przepuszczają przez
//     bramkę DWÓCH różnych adminów na DWÓCH klientach i sprawdzają, że stara
//     rola z obcego najemcy nie otwiera niczego.
//
//  3) DEGRADACJA ZAMIAST WYWROTKI PRZY ODCZYCIE USTAWIEŃ. Kontrakt
//     `readStoredAnalyticsSettings` mówi wprost: brak ustawień to
//     nieskonfigurowane, a nie awaria. Instalacja bez wiersza `analytics`
//     w `site_settings` (albo najemca, któremu RLS ten wiersz chowa) musi
//     dostać `{}`, nie 500-kę na całym panelu. Odwrócenie tej reguły jest
//     niewidoczne u dewelopera, który ten wiersz ma.
//
// CZEGO TU NIE MA. Middleware `requireSupabaseAuth` (bramka uwierzytelnienia)
// nie jest tu w ogóle uruchamiane - ten moduł to zwykłe funkcje, a kompletu
// middleware każdej server fn pilnuje osobna bramka statyczna. Tutaj dowodzimy
// AUTORYZACJI ROLI i kontraktu odczytu, nie tego, czy ktoś w ogóle wejdzie.
import { describe, expect, it } from "vitest";

import {
  readStoredAnalyticsSettings,
  requireAnalyticsAdmin,
  type AnalyticsGatewayCtx,
  type StoredAnalyticsSettings,
} from "../gateway.server";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const REDAKTOR_A = "55555555-5555-4555-8555-555555555555";

/**
 * Katalog ról: kto jest adminem i W KTÓRYM najemcy. Modeluje to, co robi
 * `has_role()` w bazie - dopasowanie roli do `current_tenant_id()` wynikającego
 * z JWT klienta, a nie z argumentu wywołania.
 */
const ROLA_ADMINA: Record<string, string> = {
  [ADMIN_A]: TENANT_A,
  [ADMIN_B]: TENANT_B,
};

interface WywolanieRpc {
  readonly fn: string;
  readonly args: Record<string, unknown>;
}

interface OdczytTabeli {
  readonly table: string;
  readonly columns: string;
  readonly filtr: readonly [string, string];
}

interface OpcjeKlienta {
  /** Wiersz `site_settings.value` widziany przez TEGO najemcę. */
  readonly settings?: StoredAnalyticsSettings | null;
  /** Surowa odpowiedź `data` - do przypadków zdeformowanego odczytu. */
  readonly rawData?: unknown;
  readonly settingsError?: string;
  /** Klient rzuca zamiast oddać wynik (brak tabeli, zerwana sieć). */
  readonly settingsThrows?: boolean;
  readonly hasRoleError?: string;
}

interface Klient {
  readonly ctx: AnalyticsGatewayCtx;
  readonly rpcCalls: WywolanieRpc[];
  readonly odczyty: OdczytTabeli[];
}

/**
 * Klient JEDNEGO najemcy. Każdy najemca dostaje własną instancję, więc „nie
 * wyciekło" jest sprawdzalne pustką w rejestrze wywołań drugiego klienta,
 * a nie wiarą w to, że kod użył właściwego obiektu.
 */
function klient(tenant: string, userId: string, opcje: OpcjeKlienta = {}): Klient {
  const rpcCalls: WywolanieRpc[] = [];
  const odczyty: OdczytTabeli[] = [];

  const ctx: AnalyticsGatewayCtx = {
    userId,
    supabase: {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (column: string, value: string) => {
            odczyty.push({ table, columns, filtr: [column, value] });
            if (opcje.settingsThrows) throw new Error("relation site_settings does not exist");
            if (opcje.settingsError) {
              return Promise.resolve({ data: null, error: { message: opcje.settingsError } });
            }
            const data = "rawData" in opcje ? opcje.rawData : [{ value: opcje.settings ?? null }];
            return Promise.resolve({ data, error: null });
          },
        }),
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn !== "has_role") {
          return Promise.resolve({ data: null, error: { message: `test: obce RPC "${fn}"` } });
        }
        if (opcje.hasRoleError) {
          return Promise.resolve({ data: null, error: { message: opcje.hasRoleError } });
        }
        // Rola liczy się TYLKO w najemcy tego klienta - dokładnie jak w bazie.
        const pytanyUzytkownik = String(args._user_id);
        const rolaW = ROLA_ADMINA[pytanyUzytkownik];
        return Promise.resolve({
          data: rolaW === tenant && args._role === "admin",
          error: null,
        });
      },
    },
  };

  return { ctx, rpcCalls, odczyty };
}

async function przechwycBlad(promise: Promise<unknown>): Promise<Error> {
  const wynik = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(wynik, "oczekiwano wyjątku, a wywołanie się powiodło").toBeInstanceOf(Error);
  return wynik as Error;
}

// ---------------------------------------------------------------------------
describe("requireAnalyticsAdmin - bramka roli", () => {
  it("pyta has_role o TOŻSAMOŚĆ WOŁAJĄCEGO i o rolę admin", async () => {
    const a = klient(TENANT_A, ADMIN_A);

    await requireAnalyticsAdmin(a.ctx);

    expect(a.rpcCalls).toHaveLength(1);
    expect(a.rpcCalls[0]).toEqual({
      fn: "has_role",
      args: { _user_id: ADMIN_A, _role: "admin" },
    });
  });

  it("admin swojego najemcy przechodzi bez rzutu", async () => {
    await expect(requireAnalyticsAdmin(klient(TENANT_A, ADMIN_A).ctx)).resolves.toBeUndefined();
  });

  it("użytkownik bez roli dostaje odmowę, a nie ciche przejście", async () => {
    const redaktor = klient(TENANT_A, REDAKTOR_A);

    const blad = await przechwycBlad(requireAnalyticsAdmin(redaktor.ctx));

    expect(blad.message).toBe("Forbidden: admin role required");
  });

  it("błąd bazy przy sprawdzaniu roli ZAMYKA bramkę i przenosi komunikat", async () => {
    const zepsuty = klient(TENANT_A, ADMIN_A, {
      hasRoleError: "permission denied for schema public",
    });

    const blad = await przechwycBlad(requireAnalyticsAdmin(zepsuty.ctx));

    expect(blad.message).toBe("permission denied for schema public");
  });

  it("bramka nie dotyka żadnej tabeli - odmowa nie może kosztować odczytu", async () => {
    const redaktor = klient(TENANT_A, REDAKTOR_A);

    await przechwycBlad(requireAnalyticsAdmin(redaktor.ctx));

    expect(redaktor.odczyty).toEqual([]);
  });

  it("rola admina w OBCYM najemcy nie otwiera bramki tego najemcy", async () => {
    // Ten sam człowiek, dwa klienty: u siebie admin, u sąsiada nikt.
    const uSiebie = klient(TENANT_B, ADMIN_B);
    const uSasiada = klient(TENANT_A, ADMIN_B);

    await expect(requireAnalyticsAdmin(uSiebie.ctx)).resolves.toBeUndefined();
    const blad = await przechwycBlad(requireAnalyticsAdmin(uSasiada.ctx));

    expect(blad.message).toBe("Forbidden: admin role required");
    // Dowód, że pytanie poszło klientem najemcy A (jego JWT wyznacza tenant),
    // a nie klientem, na którym rola faktycznie istnieje.
    expect(uSasiada.rpcCalls.map((c) => c.fn)).toEqual(["has_role"]);
  });

  it("bramka nie przekazuje tenanta jako argumentu - tenant bierze się z klienta", async () => {
    const a = klient(TENANT_A, ADMIN_A);

    await requireAnalyticsAdmin(a.ctx);

    expect(Object.keys(a.rpcCalls[0].args).sort()).toEqual(["_role", "_user_id"]);
  });
});

// ---------------------------------------------------------------------------
describe("readStoredAnalyticsSettings - odczyt ustawień najemcy", () => {
  it("czyta wiersz analytics z site_settings przez klienta WOŁAJĄCEGO", async () => {
    const a = klient(TENANT_A, ADMIN_A, { settings: { ga4_property_id: "100000001" } });

    await readStoredAnalyticsSettings(a.ctx);

    expect(a.odczyty).toEqual([
      { table: "site_settings", columns: "value", filtr: ["key", "analytics"] },
    ]);
  });

  it("oddaje zapisane ustawienia najemcy", async () => {
    const a = klient(TENANT_A, ADMIN_A, {
      settings: { ga4_enabled: true, ga4_property_id: "100000001", ga4_measurement_id: "G-AAA" },
    });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({
      ga4_enabled: true,
      ga4_property_id: "100000001",
      ga4_measurement_id: "G-AAA",
    });
  });

  it("każdy najemca dostaje WŁASNE property - żaden nie widzi cudzego", async () => {
    const a = klient(TENANT_A, ADMIN_A, { settings: { ga4_property_id: "100000001" } });
    const b = klient(TENANT_B, ADMIN_B, { settings: { ga4_property_id: "100000002" } });

    const ustawieniaA = await readStoredAnalyticsSettings(a.ctx);
    const ustawieniaB = await readStoredAnalyticsSettings(b.ctx);

    expect(ustawieniaA.ga4_property_id).toBe("100000001");
    expect(ustawieniaB.ga4_property_id).toBe("100000002");
    // Klient najemcy A nie został użyty do odczytu najemcy B (i odwrotnie).
    expect(a.odczyty).toHaveLength(1);
    expect(b.odczyty).toHaveLength(1);
  });

  it("błąd odczytu degraduje do pustych ustawień, a nie do wyjątku", async () => {
    const a = klient(TENANT_A, ADMIN_A, {
      settingsError: "permission denied for table site_settings",
    });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({});
  });

  it("wyjątek klienta (brak tabeli, zerwana sieć) też degraduje do pustych ustawień", async () => {
    const a = klient(TENANT_A, ADMIN_A, { settingsThrows: true });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({});
  });

  it("brak wiersza analytics znaczy nieskonfigurowane, a nie awaria", async () => {
    const a = klient(TENANT_A, ADMIN_A, { rawData: [] });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({});
  });

  it("data null (PostgREST bez wierszy) oddaje puste ustawienia", async () => {
    const a = klient(TENANT_A, ADMIN_A, { rawData: null });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({});
  });

  it("wiersz z value NULL oddaje puste ustawienia, a nie null", async () => {
    const a = klient(TENANT_A, ADMIN_A, { settings: null });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({});
  });

  it("czyta PIERWSZY wiersz - drugi wpis pod tym samym kluczem nie nadpisuje konfiguracji", async () => {
    const a = klient(TENANT_A, ADMIN_A, {
      rawData: [{ value: { ga4_property_id: "100000001" } }, { value: { ga4_property_id: "999" } }],
    });

    await expect(readStoredAnalyticsSettings(a.ctx)).resolves.toEqual({
      ga4_property_id: "100000001",
    });
  });
});
