// PO CO TEN PLIK. `status.functions.ts` odpowiada na jedno pytanie panelu
// /admin/analytics: CO JEST PODŁĄCZONE. Wchodzi tu z zerem pokrycia
// (0 z 47 linii), a jest to jedyne miejsce w repozytorium, które czyta KOMPLET
// sekretów analityki (Service Account, para OAuth, refresh token, sekret
// Measurement Protocol, dwa klucze bramki GSC) i buduje z nich odpowiedź
// wysyłaną do PRZEGLĄDARKI. Nagłówek pliku produkcyjnego obiecuje wprost:
// „Never returns secret values". Tej obietnicy nie miał kto sprawdzić.
//
// Cztery klasy defektów, których nikt tu dotąd nie łapał:
//
//  1) WYCIEK SEKRETU DO PRZEGLĄDARKI. Odpowiedź świadomie oddaje część
//     konfiguracji wprost (property id, measurement id, adres embeda, e-mail
//     Service Accountu) - i to jest w porządku. Granica między „to wolno
//     pokazać" a „to jest materiał uwierzytelniający" jest w tym pliku
//     pilnowana WYŁĄCZNIE dyscypliną autora: dopisanie jednego pola
//     diagnostycznego (`saEmail` obok `parsed.private_key`, „żeby było widać
//     czy klucz się parsuje") wysyła klucz prywatny do każdego admina
//     dowolnego najemcy. Testy niżej przepuszczają PEŁNĄ, poprawną
//     konfigurację i sprawdzają, że w zserializowanej odpowiedzi nie ma ANI
//     JEDNEGO z sześciu sekretów.
//
//  2) TRYB AKTYWNY USTALONY ŹLE. `activeMode` decyduje, czym panel spróbuje
//     ciągnąć raporty. Kolejność (Service Account -> OAuth -> embed -> MP) jest
//     kontraktem, bo dwa pierwsze tryby czytają Data API, a dwa pozostałe NIE
//     UMIEJĄ tego wcale. Pomyłka nie wywala niczego - po prostu dashboard
//     obiecuje liczby, których nie potrafi pobrać.
//
//  3) KILL SWITCH, KTÓRY NIE WYŁĄCZA. `ga4_enabled === false` to jawne
//     „Odłącz" klikane przez admina W UI TEGO NAJEMCY. Musi zerować
//     `activeMode` i `configured` NAWET przy komplecie sekretów, inaczej
//     odłączenie jest wyłącznie kosmetyczne.
//
//  4) STAN „NIESKONFIGUROWANE" JAKO AWARIA. Świeża instalacja nie ma ani
//     jednego z tych sekretów i nie ma wiersza `analytics` w `site_settings`.
//     Kontrakt: pełna, sensowna odpowiedź z samymi `false` i podpowiedziami
//     w `missingSecrets` - nie rzut, nie 500-ka na panelu.
//
// IZOLACJA NAJEMCÓW. Sekrety są GLOBALNE (środowisko workera), ale property id
// i measurement id mogą pochodzić z `site_settings` KONKRETNEGO najemcy -
// czytanych klientem wołającego, więc przez RLS. Testy dowodzą, że dwóch
// adminów dwóch najemców dostaje swoje property, a stara rola admina z obcego
// najemcy nie otwiera bramki (i nie kosztuje ani jednego odczytu).
//
// DEFEKT PINOWANY NIŻEJ (`it.fails`): pusty sekret przesłania konfigurację
// zapisaną przez workspace - patrz komentarz przy przypadku.
//
// CZEGO TU NIE MA. Middleware `requireSupabaseAuth` nie jest uruchamiane
// (`serverFnStubModule` go nie wykonuje), więc zieleń tego pliku mówi „handler
// liczy dobrze", a nie „obcy się nie dostanie". Kompletu bramek pilnuje
// osobna bramka statyczna.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callServerFn, type ServerFnContext } from "@/test/serverFnHarness";
import type { AnalyticsStatus } from "../status.functions";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

const { getAnalyticsStatus } = await import("../status.functions");

// ---------------------------------------------------------------------------
// Środowisko
// ---------------------------------------------------------------------------

/** Wszystko, co moduł czyta ze środowiska - czyszczone przed KAŻDYM przypadkiem. */
const KLUCZE_ENV = [
  "LOVABLE_API_KEY",
  "GOOGLE_SEARCH_CONSOLE_API_KEY",
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_OAUTH_CLIENT_ID",
  "GA4_OAUTH_CLIENT_SECRET",
  "GA4_OAUTH_REFRESH_TOKEN",
  "GA4_MEASUREMENT_ID",
  "GA4_API_SECRET",
  "GA4_EMBED_URL",
  "GA4_PROPERTY_ID",
] as const;

// Jawnie testowe napisy. Klucz prywatny NIE jest materiałem kryptograficznym -
// moduł go wyłącznie parsuje i sprawdza obecność, więc para RSA byłaby tu
// kosztem bez dowodu. Adresy wyłącznie z example.com.
const SA_EMAIL = "ga4-reader@example.com";
const SA_KLUCZ = "-----BEGIN PRIVATE KEY-----NIE-JEST-KLUCZEM-----END PRIVATE KEY-----";
const OAUTH_CLIENT_ID = "client-id-testowy.apps.example.com";
const OAUTH_CLIENT_SECRET = "sekret-klienta-tylko-do-testu";
const OAUTH_REFRESH_TOKEN = "refresh-token-tylko-do-testu";
const MP_API_SECRET = "sekret-mp-tylko-do-testu";
const LOVABLE_KEY = "klucz-lovable-tylko-do-testu";
const GSC_KEY = "klucz-gsc-tylko-do-testu";
const EMBED_URL = "https://lookerstudio.example.com/embed/raport";

/** Komplet sekretów, których odpowiedź NIE MA PRAWA zawierać. */
const SEKRETY = [
  SA_KLUCZ,
  OAUTH_CLIENT_SECRET,
  OAUTH_REFRESH_TOKEN,
  MP_API_SECRET,
  LOVABLE_KEY,
  GSC_KEY,
] as const;

function saJson(over: Record<string, string> = {}): string {
  return JSON.stringify({ client_email: SA_EMAIL, private_key: SA_KLUCZ, ...over });
}

function ustawServiceAccount(json: string = saJson()): void {
  vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", json);
}

function ustawOauth(): void {
  vi.stubEnv("GA4_OAUTH_CLIENT_ID", OAUTH_CLIENT_ID);
  vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", OAUTH_CLIENT_SECRET);
  vi.stubEnv("GA4_OAUTH_REFRESH_TOKEN", OAUTH_REFRESH_TOKEN);
}

function ustawMeasurementProtocol(id = "G-TESTOWY"): void {
  vi.stubEnv("GA4_MEASUREMENT_ID", id);
  vi.stubEnv("GA4_API_SECRET", MP_API_SECRET);
}

// ---------------------------------------------------------------------------
// Klienci najemców
// ---------------------------------------------------------------------------

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ADMIN_A = "33333333-3333-4333-8333-333333333333";
const ADMIN_B = "44444444-4444-4444-8444-444444444444";
const REDAKTOR_A = "55555555-5555-4555-8555-555555555555";

/** Kto jest adminem i W KTÓRYM najemcy - odpowiednik filtra `current_tenant_id()`. */
const ROLA_ADMINA: Record<string, string> = { [ADMIN_A]: TENANT_A, [ADMIN_B]: TENANT_B };

interface StoredAnalytics {
  ga4_enabled?: boolean;
  ga4_property_id?: string;
  ga4_measurement_id?: string;
}

interface OpcjeNajemcy {
  readonly settings?: StoredAnalytics | null;
  /** Surowa odpowiedź `data` - do przypadków zdeformowanego odczytu. */
  readonly rawData?: unknown;
  readonly settingsError?: string;
  readonly settingsThrows?: boolean;
  readonly hasRoleError?: string;
}

interface Najemca {
  readonly ctx: ServerFnContext;
  readonly odczyty: Array<{ table: string; columns: string; filtr: [string, string] }>;
  readonly rpcCalls: string[];
}

function najemca(tenant: string, userId: string, opcje: OpcjeNajemcy = {}): Najemca {
  const odczyty: Najemca["odczyty"] = [];
  const rpcCalls: string[] = [];

  const supabase = {
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
      rpcCalls.push(fn);
      if (opcje.hasRoleError) {
        return Promise.resolve({ data: null, error: { message: opcje.hasRoleError } });
      }
      return Promise.resolve({
        data: ROLA_ADMINA[String(args._user_id)] === tenant && args._role === "admin",
        error: null,
      });
    },
  };

  return { ctx: { supabase, userId }, odczyty, rpcCalls };
}

function status(n: Najemca): Promise<AnalyticsStatus> {
  return callServerFn<AnalyticsStatus>(getAnalyticsStatus, { context: n.ctx });
}

/** Skrót dla przypadków, które nie badają najemcy - admin A bez ustawień. */
function statusAdmina(settings?: StoredAnalytics | null): Promise<AnalyticsStatus> {
  return status(najemca(TENANT_A, ADMIN_A, { settings }));
}

async function przechwycBlad(promise: Promise<unknown>): Promise<Error> {
  const wynik = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(wynik, "oczekiwano wyjątku, a wywołanie się powiodło").toBeInstanceOf(Error);
  return wynik as Error;
}

beforeEach(() => {
  for (const klucz of KLUCZE_ENV) vi.stubEnv(klucz, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
describe("bramka roli", () => {
  it("użytkownik bez roli admina nie dostaje statusu integracji", async () => {
    const redaktor = najemca(TENANT_A, REDAKTOR_A);

    const blad = await przechwycBlad(status(redaktor));

    expect(blad.message).toBe("Forbidden: admin role required");
  });

  it("odmowa następuje PRZED jakimkolwiek odczytem ustawień", async () => {
    const redaktor = najemca(TENANT_A, REDAKTOR_A, { settings: { ga4_property_id: "100000001" } });

    await przechwycBlad(status(redaktor));

    expect(redaktor.odczyty).toEqual([]);
    expect(redaktor.rpcCalls).toEqual(["has_role"]);
  });

  it("błąd bazy przy sprawdzaniu roli zamyka bramkę zamiast otwierać", async () => {
    const zepsuty = najemca(TENANT_A, ADMIN_A, { hasRoleError: "JWT expired" });

    const blad = await przechwycBlad(status(zepsuty));

    expect(blad.message).toBe("JWT expired");
  });

  it("admin OBCEGO najemcy nie przechodzi bramki tego najemcy", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");
    const obcy = najemca(TENANT_A, ADMIN_B);

    const blad = await przechwycBlad(status(obcy));

    expect(blad.message).toBe("Forbidden: admin role required");
    expect(obcy.odczyty).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("instalacja bez konfiguracji", () => {
  it("brak wszystkich sekretów oddaje pełny status, a nie wyjątek", async () => {
    const wynik = await statusAdmina();

    expect(wynik).toEqual({
      gsc: { configured: false },
      ga4: {
        configured: false,
        enabled: true,
        activeMode: null,
        hasServiceAccount: false,
        hasPropertyId: false,
        hasOauthRefresh: false,
        hasOauthClient: false,
        hasMeasurementProtocol: false,
        hasMeasurementId: false,
        hasEmbedUrl: false,
        serviceAccountEmail: null,
        propertyId: null,
        measurementId: null,
        embedUrl: null,
        missingSecrets: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"],
      },
      vitals: { configured: true },
    });
  });

  it("Web Vitals są zawsze skonfigurowane - to zbiórka własna, bez sekretu", async () => {
    ustawServiceAccount();
    const wynik = await statusAdmina();

    expect(wynik.vitals).toEqual({ configured: true });
  });

  it("błąd odczytu ustawień degraduje do stanu domyślnego zamiast wywracać panel", async () => {
    const zepsuty = najemca(TENANT_A, ADMIN_A, { settingsError: "permission denied" });

    const wynik = await status(zepsuty);

    expect(wynik.ga4.enabled).toBe(true);
    expect(wynik.ga4.propertyId).toBeNull();
  });

  it("odczyt bez wierszy (data null) też daje stan domyślny, nie wyjątek", async () => {
    // PostgREST przy braku dopasowania oddaje `null`, nie pustą tablicę -
    // gałąź `res.data ?? []` istnieje właśnie po to i bez niej `rows[0]`
    // wywaliłoby cały panel na instalacji bez wiersza `analytics`.
    const pusty = najemca(TENANT_A, ADMIN_A, { rawData: null });

    const wynik = await status(pusty);

    expect(wynik.ga4.enabled).toBe(true);
    expect(wynik.ga4.propertyId).toBeNull();
  });

  it("wyjątek klienta przy odczycie ustawień też nie wywraca panelu", async () => {
    const zepsuty = najemca(TENANT_A, ADMIN_A, { settingsThrows: true });

    await expect(status(zepsuty)).resolves.toMatchObject({ ga4: { enabled: true } });
  });
});

// ---------------------------------------------------------------------------
describe("Search Console", () => {
  it("wymaga OBU kluczy bramki - sam LOVABLE_API_KEY to nie konfiguracja", async () => {
    vi.stubEnv("LOVABLE_API_KEY", LOVABLE_KEY);

    await expect(statusAdmina()).resolves.toMatchObject({ gsc: { configured: false } });
  });

  it("sam klucz konektora GSC bez klucza bramki też nie wystarcza", async () => {
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", GSC_KEY);

    await expect(statusAdmina()).resolves.toMatchObject({ gsc: { configured: false } });
  });

  it("komplet dwóch kluczy oznacza skonfigurowane", async () => {
    vi.stubEnv("LOVABLE_API_KEY", LOVABLE_KEY);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", GSC_KEY);

    await expect(statusAdmina()).resolves.toMatchObject({ gsc: { configured: true } });
  });
});

// ---------------------------------------------------------------------------
describe("Service Account", () => {
  it("poprawny JSON z property daje tryb service_account i gotowość do czytania", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4).toMatchObject({
      configured: true,
      activeMode: "service_account",
      hasServiceAccount: true,
      hasPropertyId: true,
      serviceAccountEmail: SA_EMAIL,
      propertyId: "100000001",
      missingSecrets: [],
    });
  });

  it("Service Account BEZ property nie jest gotowy do czytania raportów", async () => {
    ustawServiceAccount();

    const wynik = await statusAdmina();

    expect(wynik.ga4.configured).toBe(false);
    expect(wynik.ga4.activeMode).toBeNull();
    expect(wynik.ga4.missingSecrets).toEqual(["GA4_PROPERTY_ID"]);
  });

  it("zdeformowany JSON sekretu nie wywraca panelu - tryb po prostu nieaktywny", async () => {
    ustawServiceAccount('{"client_email": "ga4-reader@example.com",');
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasServiceAccount).toBe(false);
    expect(wynik.ga4.serviceAccountEmail).toBeNull();
    expect(wynik.ga4.missingSecrets).toEqual(["GA4_SERVICE_ACCOUNT_JSON"]);
  });

  it("JSON bez private_key to NIE jest Service Account", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", JSON.stringify({ client_email: SA_EMAIL }));
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasServiceAccount).toBe(false);
    expect(wynik.ga4.serviceAccountEmail).toBeNull();
  });

  it("JSON bez client_email to NIE jest Service Account", async () => {
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", JSON.stringify({ private_key: SA_KLUCZ }));
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasServiceAccount).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("OAuth refresh token", () => {
  it("komplet OAuth z property daje tryb oauth_refresh", async () => {
    ustawOauth();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4).toMatchObject({
      configured: true,
      activeMode: "oauth_refresh",
      hasOauthClient: true,
      hasOauthRefresh: true,
      hasServiceAccount: false,
      missingSecrets: [],
    });
  });

  it("sam klient OAuth bez refresh tokenu nie czyta niczego", async () => {
    vi.stubEnv("GA4_OAUTH_CLIENT_ID", OAUTH_CLIENT_ID);
    vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", OAUTH_CLIENT_SECRET);
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasOauthClient).toBe(true);
    expect(wynik.ga4.hasOauthRefresh).toBe(false);
    expect(wynik.ga4.configured).toBe(false);
    expect(wynik.ga4.missingSecrets).toEqual(["GA4_SERVICE_ACCOUNT_JSON"]);
  });

  it("sam refresh token bez pary klienta nie czyta niczego", async () => {
    vi.stubEnv("GA4_OAUTH_REFRESH_TOKEN", OAUTH_REFRESH_TOKEN);
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasOauthRefresh).toBe(true);
    expect(wynik.ga4.configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("kolejność trybów", () => {
  it("Service Account wygrywa z OAuth, embedem i Measurement Protocol", async () => {
    ustawServiceAccount();
    ustawOauth();
    ustawMeasurementProtocol();
    vi.stubEnv("GA4_EMBED_URL", EMBED_URL);
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.activeMode).toBe("service_account");
  });

  it("OAuth wygrywa z embedem, gdy nie ma Service Accountu", async () => {
    ustawOauth();
    vi.stubEnv("GA4_EMBED_URL", EMBED_URL);
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    expect(wynik.ga4.activeMode).toBe("oauth_refresh");
  });

  it("embed jest trybem AWARYJNYM - widoczny, ale nie oznacza gotowości do czytania", async () => {
    vi.stubEnv("GA4_EMBED_URL", EMBED_URL);

    const wynik = await statusAdmina();

    expect(wynik.ga4.activeMode).toBe("embed");
    expect(wynik.ga4.hasEmbedUrl).toBe(true);
    expect(wynik.ga4.embedUrl).toBe(EMBED_URL);
    // Embed to iframe - Data API nadal nie ma czym pytać.
    expect(wynik.ga4.configured).toBe(false);
  });

  it("Measurement Protocol jest ostatni - to kanał WYSYŁKI, nie odczytu", async () => {
    ustawMeasurementProtocol();

    const wynik = await statusAdmina();

    expect(wynik.ga4.activeMode).toBe("measurement_protocol");
    expect(wynik.ga4.hasMeasurementProtocol).toBe(true);
    expect(wynik.ga4.configured).toBe(false);
  });

  it("embed wyprzedza Measurement Protocol, gdy oba są ustawione", async () => {
    ustawMeasurementProtocol();
    vi.stubEnv("GA4_EMBED_URL", EMBED_URL);

    await expect(statusAdmina()).resolves.toMatchObject({ ga4: { activeMode: "embed" } });
  });

  it("sam Measurement ID bez sekretu API to nie jest kanał wysyłki", async () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", "G-TESTOWY");

    const wynik = await statusAdmina();

    expect(wynik.ga4.hasMeasurementId).toBe(true);
    expect(wynik.ga4.hasMeasurementProtocol).toBe(false);
    expect(wynik.ga4.activeMode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("kill switch najemcy", () => {
  it("ga4_enabled=false zeruje tryb i gotowość MIMO kompletu sekretów", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina({ ga4_enabled: false });

    expect(wynik.ga4.enabled).toBe(false);
    expect(wynik.ga4.activeMode).toBeNull();
    expect(wynik.ga4.configured).toBe(false);
    // Odłączenie nie kasuje diagnostyki - admin musi widzieć, co ma podpięte.
    expect(wynik.ga4.hasServiceAccount).toBe(true);
    expect(wynik.ga4.hasPropertyId).toBe(true);
  });

  it("ga4_enabled=true nie zmienia niczego wobec braku wpisu", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wlaczone = await statusAdmina({ ga4_enabled: true });
    const bezWpisu = await statusAdmina();

    expect(wlaczone).toEqual(bezWpisu);
  });

  it("kill switch jednego najemcy nie wyłącza GA4 drugiemu", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");
    const a = najemca(TENANT_A, ADMIN_A, { settings: { ga4_enabled: false } });
    const b = najemca(TENANT_B, ADMIN_B, { settings: { ga4_enabled: true } });

    expect((await status(a)).ga4.enabled).toBe(false);
    expect((await status(b)).ga4.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("konfiguracja z bazy najemcy", () => {
  it("property z ustawień workspace'u działa bez sekretu GA4_PROPERTY_ID", async () => {
    ustawServiceAccount();

    const wynik = await statusAdmina({ ga4_property_id: "100000001" });

    expect(wynik.ga4.propertyId).toBe("100000001");
    expect(wynik.ga4.hasPropertyId).toBe(true);
    expect(wynik.ga4.configured).toBe(true);
  });

  it("sekret GA4_PROPERTY_ID ma pierwszeństwo nad wpisem w bazie", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "900000009");

    const wynik = await statusAdmina({ ga4_property_id: "100000001" });

    expect(wynik.ga4.propertyId).toBe("900000009");
  });

  it("białe znaki w zapisanym property to BRAK property, nie property ze spacji", async () => {
    const wynik = await statusAdmina({ ga4_property_id: "   " });

    expect(wynik.ga4.propertyId).toBeNull();
    expect(wynik.ga4.hasPropertyId).toBe(false);
  });

  it("measurement id z ustawień workspace'u wystarcza do kanału wysyłki", async () => {
    vi.stubEnv("GA4_API_SECRET", MP_API_SECRET);

    const wynik = await statusAdmina({ ga4_measurement_id: "G-NAJEMCA-A" });

    expect(wynik.ga4.measurementId).toBe("G-NAJEMCA-A");
    expect(wynik.ga4.hasMeasurementProtocol).toBe(true);
    expect(wynik.ga4.activeMode).toBe("measurement_protocol");
  });

  it("KAŻDY najemca widzi WŁASNE property - odczyt idzie klientem wołającego", async () => {
    ustawServiceAccount();
    const a = najemca(TENANT_A, ADMIN_A, { settings: { ga4_property_id: "100000001" } });
    const b = najemca(TENANT_B, ADMIN_B, { settings: { ga4_property_id: "100000002" } });

    const statusA = await status(a);
    const statusB = await status(b);

    expect(statusA.ga4.propertyId).toBe("100000001");
    expect(statusB.ga4.propertyId).toBe("100000002");
    expect(a.odczyty).toEqual([
      { table: "site_settings", columns: "value", filtr: ["key", "analytics"] },
    ]);
    // Klient najemcy A nie posłużył do odczytu najemcy B.
    expect(b.odczyty).toHaveLength(1);
  });

  it.fails(
    "pusty sekret musi znaczyć BRAK sekretu, a nie skasowanie konfiguracji workspace'u",
    async () => {
      // DEFEKT. `process.env.GA4_PROPERTY_ID ?? (stored.ga4_property_id?.trim() || null)`
      // używa `??`, które łapie wyłącznie null/undefined - a zadeklarowana, pusta
      // zmienna środowiskowa to PUSTY STRING. Skutek: wpis `GA4_PROPERTY_ID=`
      // w .env albo sekret wyczyszczony bez usunięcia klucza (typowe przy
      // rotacji) przesłania property, które admin zapisał w UI, i panel melduje
      // „GA4 nieskonfigurowane" KAŻDEMU najemcy, który ma poprawną konfigurację
      // w bazie. To samo dotyczy Measurement ID w linijce obok.
      //
      // Że to błąd, a nie decyzja, widać po trzech rzeczach: (1) druga strona
      // tego samego wyrażenia (`trim() || null`) traktuje pusty wpis jak brak;
      // (2) siostrzany kod dla tego samego sekretu w `ga4.functions.ts`
      // (`process.env.GA4_MEASUREMENT_ID?.trim() || stored...`) używa `||`,
      // więc przy `GA4_MEASUREMENT_ID=` panel powie „nieskonfigurowane", a
      // `sendGa4Event` mimo to wyśle event zapisanym w bazie identyfikatorem -
      // dwie funkcje tego samego modułu przeczą sobie co do tej samej wartości;
      // (3) `ga4.server.ts` ma dokładnie tę samą pomyłkę w `resolveGa4PropertyId`
      // i jest ona pinowana osobno w `__tests__/ga4Server.test.ts`.
      vi.stubEnv("GA4_PROPERTY_ID", "");
      vi.stubEnv("GA4_MEASUREMENT_ID", "");
      ustawServiceAccount();

      const wynik = await statusAdmina({
        ga4_property_id: "100000001",
        ga4_measurement_id: "G-NAJEMCA-A",
      });

      expect(wynik.ga4.propertyId).toBe("100000001");
      expect(wynik.ga4.measurementId).toBe("G-NAJEMCA-A");
    },
  );
});

// ---------------------------------------------------------------------------
describe("sekrety nie opuszczają serwera", () => {
  it("PEŁNA konfiguracja nie przemyca do odpowiedzi ani jednego sekretu", async () => {
    ustawServiceAccount();
    ustawOauth();
    ustawMeasurementProtocol();
    vi.stubEnv("GA4_EMBED_URL", EMBED_URL);
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");
    vi.stubEnv("LOVABLE_API_KEY", LOVABLE_KEY);
    vi.stubEnv("GOOGLE_SEARCH_CONSOLE_API_KEY", GSC_KEY);

    const wynik = await statusAdmina();
    const zserializowany = JSON.stringify(wynik);

    // Dowód, że konfiguracja NAPRAWDĘ była kompletna - inaczej brak sekretu
    // w odpowiedzi nie znaczyłby nic.
    expect(wynik.ga4.configured).toBe(true);
    expect(wynik.gsc.configured).toBe(true);
    for (const sekret of SEKRETY) {
      expect(zserializowany, `sekret wyciekł do odpowiedzi: ${sekret}`).not.toContain(sekret);
    }
  });

  it("e-mail Service Accountu jest jawny z premedytacją - to adres do udostępnienia property", async () => {
    ustawServiceAccount();
    vi.stubEnv("GA4_PROPERTY_ID", "100000001");

    const wynik = await statusAdmina();

    // Bez tego adresu admin nie ma jak nadać dostępu w GA4 - to podpowiedź UX,
    // nie materiał uwierzytelniający. Klucz prywatny z tego samego JSON-a
    // pozostaje po stronie serwera (przypadek wyżej).
    expect(wynik.ga4.serviceAccountEmail).toBe(SA_EMAIL);
    expect(JSON.stringify(wynik)).not.toContain(SA_KLUCZ);
  });

  it("missingSecrets to NAZWY zmiennych, nigdy ich wartości", async () => {
    const wynik = await statusAdmina();

    expect(wynik.ga4.missingSecrets).toEqual(["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"]);
  });
});
