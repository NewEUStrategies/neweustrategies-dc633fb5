// Trasa `/admin/settings/analytics` ZAMONTOWANA - panel, który decyduje, CZY
// i JAK serwis mierzy ruch, i którego zapis zasila wstrzykiwacz skryptów
// bramkowany zgodą (`ConsentScriptInjector`).
//
// PO CO TEN PLIK - KLASY DEFEKTU, KTÓRE ŁAPIE.
//
//   1. WSKAŹNIK POŁĄCZENIA, KTÓRY KŁAMIE. Operator patrzący na ten panel
//      podejmuje jedną z czterech RÓŻNYCH decyzji: „działa, nie ruszam",
//      „nie skonfigurowano - wpisuję identyfikatory", „padło - idę po sekrety
//      albo po uprawnienia", „jeszcze sprawdzam - czekam". Zlanie dwóch z tych
//      stanów w jeden napis nie jest kosmetyką: operator, który nie odróżnia
//      „nie skonfigurowano" od „odmowa/awaria diagnostyki", NIE MA CO ZROBIĆ.
//      Dlatego stany są tu asertowane po NAPISIE ZE SŁOWNIKA, osobno dla GA4,
//      Search Console i Plausible, i dodatkowo sprawdzamy, że te napisy są
//      parami różne w obu językach.
//   2. IZOLACJA WARSZTATU. Panel czyta i zapisuje `site_settings` - jeden
//      wiersz jsonb na klucz W OBRĘBIE NAJEMCY. Wyciek w tę stronę oznaczałby
//      cudzy Measurement ID w naszym `gtag.js`, czyli wysyłanie ruchu naszych
//      czytelników do obcej usługi GA4. Warstwa danych jest tu PRAWDZIWA
//      (`useSettings` nad atrapą klienta Supabase), a nad nią stoją dwa
//      warsztaty z rozłącznymi wartościami.
//   3. SZKIC, KTÓRY GINIE PO NIEUDANYM ZAPISIE. Panel trzyma wersję roboczą
//      poza cache zapytania (`useDraft`). Nieudany zapis, który czyści szkic,
//      każe wpisywać dziewięciocyfrowe identyfikatory od nowa - i to zwykle
//      po tym, jak operator już zamknął zakładkę z konsoli Google.
//   4. BRAMA ZGODY (RODO). Ten panel EDYTUJE własne skrypty, ale nie ma prawa
//      ich URUCHOMIĆ: wykonanie fragmentu z pola „custom head" w samym panelu
//      to załadowanie kodu pomiarowego bez pytania kogokolwiek o zgodę - na
//      trasie, która nawet nie pokazuje banera.
//   5. DWUJĘZYCZNOŚĆ MIERZONA SŁOWNIKIEM. Napisy asertujemy przez `realT`, więc
//      zniknięcie klucza oblewa test, a nie przechodzi jako „wyrenderowało się".
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SERWEROWEJ DIAGNOSTYKI (`src/lib/analytics/status.functions.ts`): tryby
//   GA4, brakujące sekrety i bramka `has_role` mają własny, pełny plik. Tutaj
//   jest atrapą, bo przedmiotem dowodu jest to, CO PANEL ROBI z jej odpowiedzią.
// - SILNIKA USTAWIEŃ: głębokie scalanie przy odczycie i zapisie, ponowny odczyt
//   przed zapisem i unieważnienia cache mają `src/lib/admin/__tests__/useSettings.test.tsx`.
//   Bierzemy go tu PRAWDZIWEGO wyłącznie dlatego, że dowód izolacji warsztatu
//   bez prawdziwej warstwy danych byłby dowodem o atrapie.
// - MECHANIKI OKNA ŁĄCZENIA GA4 (wartości startowe, obcinanie spacji, pytanie
//   przed rozłączeniem) - to ma `src/routes/__tests__/adminSettingsRoutes.test.tsx`.
// - SAMEGO WSTRZYKIWACZA (`src/components/ConsentScriptInjector.tsx`): to on
//   sprawdza `useEffectiveConsent()` przed wstawieniem `<script>`. Tutaj
//   dowodzimy tylko, że PANEL nie robi tego zamiast niego.
// - AUTORYTETU DOSTĘPU. Test komponentu montuje LIŚĆ drzewa tras, więc nie
//   przechodzi przez wspólny layout `/admin` (`isStaff` -> `/login`) ani przez
//   middleware serwerowe (`requireSupabaseAuth` + `has_role`). Nie może więc
//   dowieść, że osoba bez roli personelu panelu nie zobaczy - i nie udaje, że
//   dowodzi. Tę warstwę pilnują: `src/routes/admin.tsx` z bramką layoutu,
//   `src/routes/__tests__/adminRouteAuthority.gate.test.ts`, migawka
//   `check:authz-snapshot` oraz RLS/pgTAP na `site_settings`. To, co da się
//   dowieść TUTAJ i co jest tu dowodzone, to dwie rzeczy: że trasa nie ma
//   własnej bramki (czyli jej bezpieczeństwo w całości zależy od layoutu) i że
//   ODMOWA z serwera nie zamienia się w panelu w odznakę „Połączono".
//
// DEFEKT ZGŁOSZONY, KTÓREGO NIE DA SIĘ TU PRZYPIĄĆ `it.fails`.
// `admin.settings.analytics.tsx:501` podaje paskowi zapisu
// `onSave={() => void persist(draft)}`, a `persist` czeka na `save.mutateAsync`.
// Nieudany zapis (odmowa RLS) odrzuca więc obietnicę, której NIKT nie łapie:
// `void` gasi wartość, nie odrzucenie. Operator widzi komunikat (toast leci
// z `onError` w `useSettings`), ale przeglądarka notuje nieobsłużone
// odrzucenie przy KAŻDYM nieudanym zapisie - a zewnętrzny reporter błędów
// widzi je jako awarię aplikacji. Że autor chciał je złapać, widać o dwie
// funkcje wyżej: `submitGa4Connect` i `disconnectGa4` mają własne `try/catch`.
// ZMIERZONE (przebieg próbny na tym HEAD): test klikający pasek zapisu przy
// `writeError` przechodzi, a vitest raportuje „Unhandled Rejection:
// PostgrestError" i kończy przebieg z błędem. Taki test nie oblewa się
// asercją, tylko wywraca CAŁY plik - więc zamiast `it.fails` defekt jest
// zgłoszony tutaj, a dowód „nieudany zapis nie czyści szkicu" idzie ścieżką
// okna łączenia GA4, która ma `catch`. Naprawa to jedna linia: `onSave` musi
// łapać (`void persist(draft).catch(() => undefined)` albo `catch` z toastem).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import type { AnalyticsStatus } from "@/lib/analytics/status.functions";
import type { RecordedChain, SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  /** Atrapa łańcucha PostgREST - podstawiona pod klienta Supabase. */
  db: null as SupabaseFromStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  /** Ile razy silnik ustawień rozgłosił zmianę do podglądu na żywo. */
  liveSyncEmits: 0,
  /** Ile razy panel zapytał serwer o stan połączeń (dowód odświeżenia). */
  statusCalls: 0,
  /** Odpowiedź serwerowej diagnostyki dla bieżącego testu. */
  statusImpl: null as null | (() => Promise<AnalyticsStatus>),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/builder/siteSettingsLiveSync", () => ({
  emitSiteSettingsInvalidate: () => {
    h.liveSyncEmits += 1;
  },
}));
// `useServerFn` staje się tożsamością - wywołanie idzie prosto do atrapy
// diagnostyki. Mock CZĘŚCIOWY, bo `@/lib/i18n` ciągnie z tego samego pakietu
// `createIsomorphicFn`, a pełna atrapa wywróciłaby inicjalizację słownika.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
// Serwerowa diagnostyka ma własny plik testowy (patrz nagłówek) - tu liczy się
// wyłącznie jej ODPOWIEDŹ i to, ile razy panel po nią sięgnął.
vi.mock("@/lib/analytics/status.functions", () => ({
  getAnalyticsStatus: () => {
    h.statusCalls += 1;
    if (!h.statusImpl) throw new Error("test: atrapa diagnostyki nieustawiona");
    return h.statusImpl();
  },
}));
// Radix Dialog nie działa pod happy-dom bez pełnego pointer API. Okno łączenia
// GA4 jest tu potrzebne do JEDNEGO dowodu (nieudany zapis zostawia szkic),
// więc podmieniamy je na natywne odpowiedniki - mechanika biblioteki nie jest
// przedmiotem dowodu.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h4>{children}</h4>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
}));

// `react-i18next` NIE JEST atrapowany: napisy mają przyjść ZE SŁOWNIKA, a język
// przestawia się przez `i18n.changeLanguage`. Skrót
// `vi.mock("react-i18next", () => reactI18nextMock())` zakleszcza test - fabryka
// sięgnęłaby po `@/lib/i18n`, który importuje właśnie atrapowany moduł
// (patrz nagłówek `src/test/i18nReal.ts`).
import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as AnalyticsRoute } from "@/routes/admin.settings.analytics";

const PATH = "/admin/settings/analytics";

// ---------------------------------------------------------------------------
// Dwa warsztaty. Wartości są rozłączne w KAŻDYM polu, żeby jakikolwiek wyciek
// dał się zobaczyć jednym `toContain` na treści dokumentu.
// ---------------------------------------------------------------------------

type Workspace = "alfa" | "beta";

const ALFA: AnalyticsConfig = {
  ga4_enabled: true,
  ga4_property_id: "111111111",
  ga4_measurement_id: "G-ALFA1111",
  gtm_container_id: "GTM-ALFA11",
  plausible_domain: "alfa.example.com",
  plausible_script_url: "https://plausible.example.com/js/alfa.js",
  custom_head_html: "<!-- alfa head -->",
  custom_body_html: "<!-- alfa body -->",
};
const BETA: AnalyticsConfig = {
  ga4_enabled: true,
  ga4_property_id: "999999999",
  ga4_measurement_id: "G-BETA9999",
  gtm_container_id: "GTM-BETA99",
  plausible_domain: "beta.example.org",
  plausible_script_url: "https://plausible.example.org/js/beta.js",
  custom_head_html: "<!-- beta head -->",
  custom_body_html: "<!-- beta body -->",
};

/** Wszystkie znaczniki drugiego warsztatu - lista do asercji „nie ma go tu". */
const BETA_MARKERS: readonly string[] = [
  BETA.ga4_property_id,
  BETA.ga4_measurement_id,
  BETA.gtm_container_id,
  BETA.plausible_domain,
  BETA.plausible_script_url,
  BETA.custom_head_html,
  BETA.custom_body_html,
];

/** Warsztat, do którego RLS przypisałoby bieżące zapytanie. */
let active: Workspace = "alfa";
/** Zawartość `site_settings` per warsztat, per klucz sekcji. */
let rows: Record<Workspace, Record<string, unknown>> = { alfa: {}, beta: {} };
/** Zapisy, które przeszły przez atrapę - z warsztatem, w którym wylądowały. */
let upserts: { workspace: Workspace; key: string; value: unknown; options: unknown }[] = [];
/**
 * Gdy nie jest `null`, UPSERT pada tym komunikatem. Pusty łańcuch jest osobnym,
 * sensownym przypadkiem (błąd bez treści), więc rozróżnienie idzie przez
 * `!== null`, a nie przez prawdziwość.
 */
let writeError: string | null = null;
/**
 * Gdy nie jest `null`, warstwa danych rzuca TĄ wartością - i celowo NIE jest to
 * `Error`. Odrzucenie nie-błędem przychodzi w praktyce z dolnych warstw
 * (transport, obcy SDK), a panel ma na to osobne ramię (`String(e)`).
 */
let writeRawThrow: unknown = null;

/** STRAŻNIK, nie rzutowanie: ładunek upsertu musi mieć kształt wiersza. */
function isSettingsRow(value: unknown): value is { key: string; value: unknown } {
  return typeof value === "object" && value !== null && "key" in value && "value" in value;
}

function wireDb(): void {
  h.db?.setResponse("site_settings", (chain: RecordedChain) => {
    if (chain.has("upsert")) {
      if (writeRawThrow !== null) throw writeRawThrow;
      if (writeError !== null) return fail(writeError, "42501");
      const payload = chain.argsOf("upsert")?.[0];
      const options = chain.argsOf("upsert")?.[1];
      if (isSettingsRow(payload)) {
        upserts.push({
          workspace: active,
          key: payload.key,
          value: payload.value,
          options,
        });
        rows[active][payload.key] = payload.value;
      }
      return ok(null);
    }
    // Odczyt widzi WYŁĄCZNIE wiersze bieżącego warsztatu - dokładnie to robi
    // `current_tenant_id()` w polityce RLS.
    const key = String(chain.argsOf("eq")?.[1] ?? "");
    const row = rows[active];
    return ok(key in row ? { value: row[key] } : null);
  });
}

// ---------------------------------------------------------------------------
// Diagnostyka połączeń w kształcie, jaki oddaje serwer.
// ---------------------------------------------------------------------------

interface StatusOverrides {
  ga4?: Partial<AnalyticsStatus["ga4"]>;
  gsc?: Partial<AnalyticsStatus["gsc"]>;
}

function status(overrides: StatusOverrides = {}): AnalyticsStatus {
  return {
    gsc: { configured: false, ...overrides.gsc },
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
      missingSecrets: [],
      ...overrides.ga4,
    },
    vitals: { configured: true },
  };
}

/** Diagnostyka odpowiada podanym stanem. */
function serverSays(st: AnalyticsStatus): void {
  h.statusImpl = () => Promise.resolve(st);
}
/** Diagnostyka ODMAWIA - tak wygląda brak roli admina po stronie serwera. */
function serverRefuses(message = "Forbidden: admin role required"): void {
  h.statusImpl = () => Promise.reject(new Error(message));
}
/** Diagnostyka NIE ODPOWIADA - stan „sprawdzanie" w trakcie. */
function serverHangs(): void {
  h.statusImpl = () => new Promise<AnalyticsStatus>(() => undefined);
}

// ---------------------------------------------------------------------------
// Dostęp do interfejsu
// ---------------------------------------------------------------------------

/** Pasek zapisu - jedyny przycisk panelu z napisem zaszytym w `fields.tsx`. */
function saveBar(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Zapisz zmiany" || button.textContent === "Zapisywanie…",
  );
}

async function mountPanel(): Promise<Awaited<ReturnType<typeof renderRoute>>> {
  const view = await renderRoute({ route: AnalyticsRoute, path: PATH, initialEntry: PATH });
  // Panel do czasu wczytania wiersza pokazuje wyłącznie `admin.loading`.
  await waitFor(() => expect(saveBar()).toBeTruthy());
  return view;
}

/** Nagłówek karty sekcji o danym tytule (GA4 / Search Console / Plausible). */
function sectionHeader(title: string): HTMLElement {
  const heading = Array.from(document.querySelectorAll("h3")).find(
    (element) => element.textContent === title,
  );
  const header = heading?.closest("header");
  if (!(header instanceof HTMLElement)) throw new Error(`test: brak karty „${title}"`);
  return header;
}

/** Napis odznaki stanu w karcie danej sekcji - to, co czyta operator. */
function badge(title: string): string {
  const element = sectionHeader(title).querySelector('span[class*="uppercase"]');
  if (!element) throw new Error(`test: karta „${title}" nie ma odznaki stanu`);
  return (element.textContent ?? "").trim();
}

function inputByPlaceholder(placeholder: string): HTMLInputElement {
  const element = document.querySelector(`input[placeholder="${placeholder}"]`);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`test: brak pola z podpowiedzią „${placeholder}"`);
  }
  return element;
}

function textareas(): HTMLTextAreaElement[] {
  return Array.from(document.querySelectorAll("textarea"));
}

function buttonWithText(text: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll("button")).find(
    (button) => (button.textContent ?? "").trim() === text,
  );
  if (!element) throw new Error(`test: brak przycisku „${text}"`);
  return element;
}

/** Ostatni zapis sekcji `analytics` - przedmiot dowodu zamiast DOM. */
function lastSaved(): Record<string, unknown> | undefined {
  const entry = upserts.filter((save) => save.key === "analytics").at(-1);
  return entry && typeof entry.value === "object" && entry.value !== null
    ? (entry.value as Record<string, unknown>)
    : undefined;
}

beforeEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  h.db = supabaseFromStub();
  h.liveSyncEmits = 0;
  h.statusCalls = 0;
  h.statusImpl = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  active = "alfa";
  rows = { alfa: { analytics: { ...ALFA } }, beta: { analytics: { ...BETA } } };
  upserts = [];
  writeError = null;
  writeRawThrow = null;
  wireDb();
  serverSays(status());
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// 1. Dostęp: co ten plik dowodzi, a czego nie
// ---------------------------------------------------------------------------

describe("dostęp do panelu analityki", () => {
  it("trasa NIE MA własnej bramki roli - cała ochrona siedzi w layoucie `/admin`", () => {
    // TO JEST CAŁA TREŚĆ TEGO TESTU i granica tego, co test komponentu potrafi
    // powiedzieć o autoryzacji. Brak `beforeLoad`/`loader` znaczy, że nic po
    // stronie tej trasy nie pyta o rolę: osoba bez `isStaff` nie zobaczy panelu
    // WYŁĄCZNIE dzięki przekierowaniu we wspólnym layoucie `/admin`, a dane
    // wrażliwe chroni middleware serwerowe. Gdyby ktoś kiedyś dołożył tu
    // własną bramkę, ta asercja ma zgasnąć i kazać przeczytać nagłówek pliku -
    // bo wtedy panel ma DWA autorytety i trzeba wiedzieć, który wygrywa.
    expect(AnalyticsRoute.options.beforeLoad).toBeUndefined();
    expect(AnalyticsRoute.options.loader).toBeUndefined();
  });

  it("ODMOWA serwera nie zamienia się w odznakę „Połączono” ani nie wycieka na ekran", async () => {
    // Diagnostyka wymaga roli admina (`has_role` po stronie serwera). Jej
    // odmowa musi zostawić wskaźniki BEZ potwierdzenia połączenia - inaczej
    // panel potwierdzałby pomiar, którego nie zdołał sprawdzić. Surowy
    // komunikat też nie ma prawa trafić na ekran: mówi, jaka rola jest
    // wymagana, komu jej brakuje i przez którą bramkę leci żądanie.
    const t = realT("pl");
    serverRefuses();
    await mountPanel();

    await waitFor(() => expect(h.statusCalls).toBeGreaterThan(0));
    expect(badge(t("admin.analyticsSettings.ga4.title"))).not.toBe(
      t("admin.analyticsSettings.status.connected"),
    );
    expect(badge(t("admin.analyticsSettings.gsc.title"))).not.toBe(
      t("admin.analyticsSettings.status.connected"),
    );
    expect(document.body.textContent ?? "").not.toContain("Forbidden");
    expect(document.body.textContent ?? "").not.toContain("admin role required");
  });

  it("panel jest `noindex` - adres z historii przeglądarki nie ma prawa się zaindeksować", async () => {
    const meta = await routeMeta(AnalyticsRoute);
    const robots = meta.find((entry) => entry.name === "robots");
    expect(robots?.content).toContain("noindex");
    expect(meta.some((entry) => typeof entry.title === "string" && entry.title.length > 0)).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Izolacja warsztatu
// ---------------------------------------------------------------------------

describe("izolacja warsztatu - konfiguracja pomiaru", () => {
  it("panel pokazuje wiersz WŁASNEGO warsztatu, a wartości drugiego nie ma NIGDZIE", async () => {
    // Cudzy Measurement ID w tym formularzu to nie literówka, a wysyłanie
    // ruchu naszych czytelników do obcej usługi GA4 - z naszej domeny i po
    // naszej zgodzie na analitykę.
    await mountPanel();

    expect(inputByPlaceholder("123456789").value).toBe(ALFA.ga4_property_id);
    expect(inputByPlaceholder("G-XXXXXXXXXX").value).toBe(ALFA.ga4_measurement_id);
    expect(inputByPlaceholder("GTM-XXXXXXX").value).toBe(ALFA.gtm_container_id);
    expect(inputByPlaceholder("example.com").value).toBe(ALFA.plausible_domain);
    expect(textareas()[0].value).toBe(ALFA.custom_head_html);

    const seen = `${document.body.textContent ?? ""} ${Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
    )
      .map((field) => field.value)
      .join(" ")}`;
    for (const marker of BETA_MARKERS) {
      expect(seen, `wyciek warsztatu beta: ${marker}`).not.toContain(marker);
    }
  });

  it("ten sam panel w drugim warsztacie czyta JEGO wiersz, nie zapamiętany poprzedni", async () => {
    await mountPanel();
    expect(inputByPlaceholder("123456789").value).toBe(ALFA.ga4_property_id);

    cleanup();
    active = "beta";
    await mountPanel();

    expect(inputByPlaceholder("123456789").value).toBe(BETA.ga4_property_id);
    expect(inputByPlaceholder("example.com").value).toBe(BETA.plausible_domain);
    const seen = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .map((field) => field.value)
      .join(" ");
    expect(seen).not.toContain(ALFA.ga4_property_id);
    expect(seen).not.toContain(ALFA.plausible_domain);
  });

  it("zapis z panelu ląduje WYŁĄCZNIE w wierszu bieżącego warsztatu", async () => {
    // Kluczem konfliktu jest para `(tenant_id, key)`, a nie sam `key` - bez
    // tego jeden upsert nadpisywałby konfigurację pomiaru CAŁEJ instancji.
    const betaBefore = JSON.stringify(rows.beta.analytics);
    await mountPanel();

    fireEvent.change(inputByPlaceholder("123456789"), { target: { value: "222222222" } });
    fireEvent.click(saveBar() as HTMLButtonElement);

    await waitFor(() => expect(lastSaved()).toBeTruthy());
    expect(upserts.every((save) => save.workspace === "alfa")).toBe(true);
    expect(lastSaved()?.ga4_property_id).toBe("222222222");
    expect(JSON.stringify(rows.beta.analytics)).toBe(betaBefore);
    expect(upserts.at(-1)?.options).toMatchObject({ onConflict: "tenant_id,key" });
  });
});

// ---------------------------------------------------------------------------
// 3. Cztery stany połączenia
// ---------------------------------------------------------------------------

describe("stany połączenia są rozróżnialne", () => {
  it("napisy czterech stanów są PARAMI RÓŻNE w PL i w EN", async () => {
    // Bramka na słowniku, nie na renderze: gdyby dwa stany dostały ten sam
    // napis, każdy test niżej nadal przechodziłby, a operator patrzyłby na
    // wskaźnik bez informacji.
    for (const lang of ["pl", "en"] as const) {
      const t = realT(lang);
      const labels = [
        t("admin.analyticsSettings.status.connected"),
        t("admin.analyticsSettings.status.notConfigured"),
        t("admin.analyticsSettings.status.partial"),
        t("admin.analyticsSettings.status.checking"),
        t("admin.analyticsSettings.ga4.disabled"),
      ];
      expect(new Set(labels).size, `${lang}: napisy stanów się powtarzają`).toBe(labels.length);
      for (const label of labels) expect(label.length).toBeGreaterThan(0);
    }
  });

  it("POŁĄCZONO: serwer potwierdza odczyt raportów przy włączonym pomiarze", async () => {
    const t = realT("pl");
    serverSays(status({ ga4: { configured: true, activeMode: "service_account" } }));
    await mountPanel();
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
        t("admin.analyticsSettings.status.connected"),
      ),
    );
  });

  it("NIE SKONFIGUROWANO: nic nie jest ustawione ani u nas, ani po stronie sekretów", async () => {
    const t = realT("pl");
    rows.alfa.analytics = { ...ALFA, ga4_measurement_id: "   ", ga4_property_id: "" };
    serverSays(status());
    await mountPanel();
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
        t("admin.analyticsSettings.status.notConfigured"),
      ),
    );
  });

  it("CZĘŚCIOWO: identyfikator jest, ale serwer go nie potwierdza - to trzeci stan, nie „nie skonfigurowano”", async () => {
    // Ten stan jest sensem całego wskaźnika: „nie skonfigurowano" kazałoby
    // wpisywać wszystko od nowa, „połączono" byłoby kłamstwem.
    const t = realT("pl");
    serverSays(status({ ga4: { configured: false, hasMeasurementId: true } }));
    await mountPanel();
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
        t("admin.analyticsSettings.status.partial"),
      ),
    );
  });

  it("SPRAWDZANIE: dopóki diagnostyka nie wróciła, panel nie ogłasza żadnego wyniku", async () => {
    const t = realT("pl");
    serverHangs();
    await mountPanel();
    expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
      t("admin.analyticsSettings.status.checking"),
    );
    expect(badge(t("admin.analyticsSettings.gsc.title"))).toBe(
      t("admin.analyticsSettings.status.checking"),
    );
  });

  it("WYŁĄCZONE: świadome odłączenie ma własny napis, różny od awarii i od braku konfiguracji", async () => {
    // „Odłączone" to decyzja administratora, nie brak konfiguracji: sekrety
    // i identyfikatory zostają na miejscu, ma tylko przestać mierzyć.
    const t = realT("pl");
    rows.alfa.analytics = { ...ALFA, ga4_enabled: false };
    serverSays(status({ ga4: { configured: true, enabled: false } }));
    await mountPanel();
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
        t("admin.analyticsSettings.ga4.disabled"),
      ),
    );
  });

  it("Search Console ma stan NIEZALEŻNY od GA4 - wspólny wskaźnik kłamałby o obu", async () => {
    const t = realT("pl");
    serverSays(status({ gsc: { configured: true }, ga4: { configured: false } }));
    await mountPanel();
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.gsc.title"))).toBe(
        t("admin.analyticsSettings.status.connected"),
      ),
    );
    expect(badge(t("admin.analyticsSettings.ga4.title"))).not.toBe(
      t("admin.analyticsSettings.status.connected"),
    );
    expect(document.body.textContent).toContain(t("admin.analyticsSettings.gsc.managed"));
  });

  it("Plausible wynika WYŁĄCZNIE ze szkicu - nie czeka na diagnostykę, bo nie ma na co", async () => {
    // Plausible nie wymaga sekretu po naszej stronie: sama domena wystarcza.
    // Wskaźnik zależny od diagnostyki pokazywałby „sprawdzanie" na zawsze.
    const t = realT("pl");
    serverHangs();
    await mountPanel();
    expect(badge(t("admin.analyticsSettings.plausible.title"))).toBe(
      t("admin.analyticsSettings.status.connected"),
    );

    fireEvent.change(inputByPlaceholder("example.com"), { target: { value: "   " } });
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.plausible.title"))).toBe(
        t("admin.analyticsSettings.status.notConfigured"),
      ),
    );
  });

  it.fails(
    "DEFEKT: AWARIA diagnostyki jest nieodróżnialna od trwającego sprawdzania - operator nie ma czego naprawić",
    async () => {
      // ZMIERZONE. `admin.settings.analytics.tsx:123-134` i `:278`: jedynym
      // wejściem do wskaźnika jest `statusQ.data`. Odrzucone zapytanie zostawia
      // `data === undefined`, więc `ga4Kind(undefined, ...)` oddaje `"loading"`,
      // a `gscK` też `"loading"` - czyli DOKŁADNIE ten sam napis
      // („Sprawdzanie…"), który panel pokazuje w trakcie sprawdzania. `statusQ`
      // ma `isError`, ale panel go nie czyta, a `StatusKind` nie ma wcale
      // ramienia awarii; słownik nie ma nawet klucza
      // `admin.analyticsSettings.status.*` na błąd.
      //
      // KONSEKWENCJA DLA OPERATORA. Trzy różne przyczyny - brak roli admina
      // (`Forbidden: admin role required` z `requireAdmin`), padnięta bramka
      // Google, zerwana sieć - dają wskaźnik nieodróżnialny od „jeszcze
      // sprawdzam". Zachowanie: czekać. Właściwe zachowanie: iść po
      // uprawnienia albo po sekrety. Odświeżenie też nie pomaga, bo po nim
      // wskaźnik wygląda identycznie.
      //
      // NAPRAWA (nie robimy jej tutaj - zakresem zadania są testy): dołożyć
      // `StatusKind = "error"` z własną odznaką i klucz
      // `admin.analyticsSettings.status.error`, a `ga4Kind`/`gscK` karmić
      // również `statusQ.isError`.
      const t = realT("pl");
      serverRefuses("bad gateway");
      await mountPanel();
      await waitFor(() => expect(h.statusCalls).toBeGreaterThan(0));

      const checking = t("admin.analyticsSettings.status.checking");
      expect(badge(t("admin.analyticsSettings.ga4.title"))).not.toBe(checking);
      expect(badge(t("admin.analyticsSettings.gsc.title"))).not.toBe(checking);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Szkic i zapis
// ---------------------------------------------------------------------------

describe("wersja robocza i cykl zapisu", () => {
  it("edycja pola zmienia SZKIC, nie wiersz w bazie - dopóki nikt nie kliknął zapisu", async () => {
    // Ten panel nie ma znacznika „niezapisane zmiany" (pasek zapisu jest
    // aktywny zawsze, patrz `SaveBar` w `fields.tsx`), więc „brudny formularz"
    // dowodzi się jedynym sprawdzalnym sposobem: szkic ROZJECHAŁ SIĘ z bazą,
    // a baza jest nietknięta.
    await mountPanel();

    fireEvent.change(inputByPlaceholder("G-XXXXXXXXXX"), { target: { value: "G-NOWE1234" } });
    expect(inputByPlaceholder("G-XXXXXXXXXX").value).toBe("G-NOWE1234");
    expect(upserts).toEqual([]);
    expect(rows.alfa.analytics).toMatchObject({ ga4_measurement_id: ALFA.ga4_measurement_id });
  });

  it("zapis wysyła do mutacji WARTOŚĆ ZE SZKICU, nie tę wczytaną z bazy", async () => {
    await mountPanel();

    fireEvent.change(inputByPlaceholder("G-XXXXXXXXXX"), { target: { value: "G-NOWE1234" } });
    fireEvent.change(textareas()[1], { target: { value: "<!-- stopka pomiaru -->" } });
    fireEvent.click(saveBar() as HTMLButtonElement);

    await waitFor(() => expect(lastSaved()).toBeTruthy());
    expect(lastSaved()).toMatchObject({
      ga4_measurement_id: "G-NOWE1234",
      custom_body_html: "<!-- stopka pomiaru -->",
      ga4_property_id: ALFA.ga4_property_id,
    });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // Zmiana konfiguracji rozgłasza się do podglądu na żywo - inaczej front
    // trzymałby stary skrypt do najbliższego przeładowania.
    expect(h.liveSyncEmits).toBeGreaterThan(0);
  });

  it("KAŻDA kontrolka panelu dojeżdża do ładunku zapisu - żadne pole nie jest martwe", async () => {
    // Pole, które się renderuje, ale którego `onChange` nie dochodzi do
    // szkicu, jest najcichszym defektem panelu konfiguracji: operator wpisuje,
    // zapisuje, dostaje „Zapisano" i po odświeżeniu widzi starą wartość. Siedem
    // kontrolek, jeden zapis, asercja na CAŁYM ładunku.
    await mountPanel();

    fireEvent.change(inputByPlaceholder("123456789"), { target: { value: "777777777" } });
    fireEvent.change(inputByPlaceholder("G-XXXXXXXXXX"), { target: { value: "G-NOWE7777" } });
    fireEvent.change(inputByPlaceholder("GTM-XXXXXXX"), { target: { value: "GTM-NOWE77" } });
    fireEvent.change(inputByPlaceholder("example.com"), { target: { value: "nowa.example.org" } });
    fireEvent.change(inputByPlaceholder("https://plausible.io/js/script.js"), {
      target: { value: "https://plausible.example.org/js/nowy.js" },
    });
    fireEvent.change(textareas()[0], { target: { value: "<!-- nowy head -->" } });
    fireEvent.change(textareas()[1], { target: { value: "<!-- nowy body -->" } });
    fireEvent.click(saveBar() as HTMLButtonElement);

    await waitFor(() => expect(lastSaved()).toBeTruthy());
    expect(lastSaved()).toMatchObject({
      ga4_property_id: "777777777",
      ga4_measurement_id: "G-NOWE7777",
      gtm_container_id: "GTM-NOWE77",
      plausible_domain: "nowa.example.org",
      plausible_script_url: "https://plausible.example.org/js/nowy.js",
      custom_head_html: "<!-- nowy head -->",
      custom_body_html: "<!-- nowy body -->",
      // Wyłącznik pomiaru nie jest kontrolką tego formularza - zapis nie ma
      // prawa go po cichu przestawić.
      ga4_enabled: true,
    });
  });

  it("nieudany zapis POKAZUJE BŁĄD i NIE CZYŚCI szkicu - da się poprawić i powtórzyć", async () => {
    // Odmowa RLS (42501) to najczęstszy realny błąd zapisu w tym panelu:
    // redaktor dopuszczony do `/admin` widzi formularz, ale nie ma prawa
    // zapisu. Szkic wyczyszczony przy takiej odmowie każe przepisywać
    // dziewięciocyfrowe identyfikatory z konsoli Google od nowa.
    writeError = "new row violates row-level security policy";
    await mountPanel();

    // Warsztat „alfa" ma wpisany Measurement ID, więc stan jest CZĘŚCIOWY -
    // panel oferuje wtedy ponowną autoryzację, nie pierwsze łączenie.
    const dialogOpener = buttonWithText(realT("pl")("admin.analyticsSettings.ga4.reconnect"));
    fireEvent.click(dialogOpener);
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeTruthy());

    const dialog = screen.getByTestId("dialog");
    const dialogInputs = Array.from(
      dialog.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    );
    expect(dialogInputs).toHaveLength(2);
    fireEvent.change(dialogInputs[0], { target: { value: "333333333" } });
    fireEvent.change(dialogInputs[1], { target: { value: "G-NOWE3333" } });
    const submit = Array.from(dialog.querySelectorAll("button")).filter(
      (button) =>
        (button.textContent ?? "").trim() !== realT("pl")("admin.analyticsSettings.ga4.cancel"),
    );
    fireEvent.click(submit[submit.length - 1]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
    // SZKIC ZOSTAJE: wpisane identyfikatory są w formularzu panelu, a okno
    // nadal otwarte, więc próbę da się powtórzyć bez przepisywania niczego.
    expect(screen.queryByTestId("dialog")).toBeTruthy();
    expect(inputByPlaceholder("GTM-XXXXXXX").value).toBe(ALFA.gtm_container_id);
    const panelValues = Array.from(document.querySelectorAll<HTMLInputElement>("input"))
      .map((field) => field.value)
      .join(" ");
    expect(panelValues).toContain("333333333");
    expect(panelValues).toContain("G-NOWE3333");
    // I nic nie wylądowało w bazie - ani u nas, ani u nikogo innego.
    expect(rows.alfa.analytics).toMatchObject({ ga4_property_id: ALFA.ga4_property_id });
    expect(rows.beta.analytics).toMatchObject({ ga4_property_id: BETA.ga4_property_id });
  });

  it("odrzucenie NIE-BŁĘDEM też daje czytelny komunikat, nie „[object Object]”", async () => {
    // `e instanceof Error ? e.message : String(e)` istnieje dokładnie na to:
    // dolne warstwy (transport, obcy SDK) potrafią odrzucić łańcuchem albo
    // obiektem. Komunikat „[object Object]" jest gorszy od braku komunikatu, bo
    // wygląda jak awaria panelu, a nie jak odmowa zapisu.
    const t = realT("pl");
    writeRawThrow = "gateway_timeout";
    await mountPanel();

    fireEvent.click(buttonWithText(t("admin.analyticsSettings.ga4.reconnect")));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeTruthy());
    const dialog = screen.getByTestId("dialog");
    const submit = Array.from(dialog.querySelectorAll("button")).filter(
      (button) => (button.textContent ?? "").trim() !== t("admin.analyticsSettings.ga4.cancel"),
    );
    fireEvent.click(submit[submit.length - 1]);

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const shown = h.toastError.mock.calls.flat().join(" ");
    expect(shown).toContain("gateway_timeout");
    expect(shown).not.toContain("[object Object]");
  });

  it.fails(
    "DEFEKT: pasek zapisu jest po polsku także w EN - napis zaszyty w `fields.tsx`, poza słownikiem",
    async () => {
      // ZMIERZONE. `src/components/admin/settings/fields.tsx` -> `SaveBar`
      // renderuje literały „Zapisz zmiany" i „Zapisywanie…" bez `t()`, więc na
      // angielskim panelu jedyny przycisk, który cokolwiek utrwala, jest po
      // polsku. Panel analityki jest w EN kompletny (tytuł, opisy, stany, okno
      // łączenia) - łamie się dokładnie na akcji końcowej, wspólnej dla
      // dwunastu paneli `admin.settings.*`.
      await i18n.changeLanguage("en");
      await mountPanel();
      expect(saveBar()?.textContent).not.toBe("Zapisz zmiany");
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Wyłącznik pomiaru - ten sam wiersz czyta wstrzykiwacz
// ---------------------------------------------------------------------------

describe("wyłącznik pomiaru GA4", () => {
  it("POŁĄCZENIE z okna zapisuje identyfikatory i WŁĄCZA pomiar w wierszu własnego warsztatu", async () => {
    // `ga4_enabled` czyta ten sam wiersz `site_settings["analytics"]`, z którego
    // korzysta `ConsentScriptInjector` - więc „połącz" musi wylądować w bazie,
    // a nie tylko w szkicu, i to w bazie WŁAŚCIWEGO warsztatu.
    const t = realT("pl");
    rows.alfa.analytics = { ...ALFA, ga4_enabled: false, ga4_measurement_id: "" };
    await mountPanel();

    fireEvent.click(buttonWithText(t("admin.analyticsSettings.ga4.connect")));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeTruthy());
    const dialog = screen.getByTestId("dialog");
    const fields = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    fireEvent.change(fields[0], { target: { value: "666666666" } });
    fireEvent.change(fields[1], { target: { value: "G-NOWE6666" } });
    const submit = Array.from(dialog.querySelectorAll("button")).filter(
      (button) => (button.textContent ?? "").trim() !== t("admin.analyticsSettings.ga4.cancel"),
    );
    fireEvent.click(submit[submit.length - 1]);

    await waitFor(() => expect(lastSaved()).toBeTruthy());
    expect(lastSaved()).toMatchObject({
      ga4_property_id: "666666666",
      ga4_measurement_id: "G-NOWE6666",
      ga4_enabled: true,
    });
    expect(upserts.every((save) => save.workspace === "alfa")).toBe(true);
    expect(rows.beta.analytics).toMatchObject({ ga4_property_id: BETA.ga4_property_id });
    // Okno się zamyka, a stan idzie do ponownego sprawdzenia.
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
    await waitFor(() => expect(h.statusCalls).toBe(2));
  });

  it("PORZUCONE okno nie przecieka do szkicu panelu - anulowanie nic nie zmienia", async () => {
    // Okno łączenia ma WŁASNY stan lokalny; wspólny stan ze szkicem panelu
    // znaczyłby, że przerwane w połowie łączenie zostawia w formularzu
    // identyfikator, którego nikt nie zatwierdził - i najbliższy „Zapisz
    // zmiany" utrwaliłby go bez wiedzy operatora.
    const t = realT("pl");
    await mountPanel();

    fireEvent.click(buttonWithText(t("admin.analyticsSettings.ga4.reconnect")));
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeTruthy());
    const dialog = screen.getByTestId("dialog");
    const fields = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    fireEvent.change(fields[0], { target: { value: "888888888" } });
    fireEvent.click(buttonWithText(t("admin.analyticsSettings.ga4.cancel")));

    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull());
    expect(inputByPlaceholder("123456789").value).toBe(ALFA.ga4_property_id);
    expect(upserts).toEqual([]);
  });

  it("ODŁĄCZENIE utrwala `ga4_enabled: false`, zachowując identyfikatory", async () => {
    // To jest wyłącznik awaryjny pomiaru: dopóki `false` nie wyląduje
    // w wierszu, wstrzykiwacz na froncie dalej ładuje `gtag.js` po zgodzie na
    // analitykę. Identyfikatory zostają, bo odłączenie jest odwracalne.
    const t = realT("pl");
    serverSays(status({ ga4: { configured: true, activeMode: "service_account" } }));
    await mountPanel();

    const original = window.confirm;
    Reflect.set(window, "confirm", () => true);
    try {
      fireEvent.click(buttonWithText(t("admin.analyticsSettings.ga4.disconnect")));
      await waitFor(() => expect(lastSaved()).toBeTruthy());
    } finally {
      Reflect.set(window, "confirm", original);
    }

    expect(lastSaved()).toMatchObject({
      ga4_enabled: false,
      ga4_property_id: ALFA.ga4_property_id,
      ga4_measurement_id: ALFA.ga4_measurement_id,
    });
    expect(rows.alfa.analytics).toMatchObject({ ga4_enabled: false });
    expect(rows.beta.analytics).toMatchObject({ ga4_enabled: true });
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// 6. Odświeżenie diagnostyki
// ---------------------------------------------------------------------------

describe("odświeżenie stanu połączeń", () => {
  it("odświeżenie PONOWNIE pyta serwer, a nowa odpowiedź zmienia wskaźnik", async () => {
    // Bez ponownego zapytania panel pokazywałby stan z pierwszego wejścia
    // (`staleTime: 30 s`) - a właśnie po dołożeniu sekretu operator chce
    // sprawdzić, czy to już działa.
    const t = realT("pl");
    serverSays(status({ ga4: { configured: false } }));
    await mountPanel();
    await waitFor(() => expect(h.statusCalls).toBe(1));
    expect(badge(t("admin.analyticsSettings.ga4.title"))).not.toBe(
      t("admin.analyticsSettings.status.connected"),
    );

    serverSays(status({ ga4: { configured: true, activeMode: "service_account" } }));
    fireEvent.click(buttonWithText(t("admin.analyticsSettings.status.checking")));

    await waitFor(() => expect(h.statusCalls).toBe(2));
    await waitFor(() =>
      expect(badge(t("admin.analyticsSettings.ga4.title"))).toBe(
        t("admin.analyticsSettings.status.connected"),
      ),
    );
  });

  it("zapis konfiguracji sam wywołuje ponowne sprawdzenie - wskaźnik nie zostaje w tyle", async () => {
    // Zapis zmienia to, CO diagnostyka ma sprawdzać. Bez unieważnienia
    // operator zapisuje identyfikator i przez pół minuty patrzy na „nie
    // skonfigurowano".
    await mountPanel();
    await waitFor(() => expect(h.statusCalls).toBe(1));

    fireEvent.change(inputByPlaceholder("123456789"), { target: { value: "444444444" } });
    fireEvent.click(saveBar() as HTMLButtonElement);

    await waitFor(() => expect(lastSaved()).toBeTruthy());
    await waitFor(() => expect(h.statusCalls).toBe(2));
  });

  it.fails(
    "DEFEKT: przycisk odświeżenia nosi napis STANU („Sprawdzanie…”), nie nazwę akcji",
    async () => {
      // ZMIERZONE. `admin.settings.analytics.tsx:337` wstawia w przycisk
      // `tStatus.loading`, czyli ten sam napis, którym odznaki opisują trwające
      // sprawdzanie. Skutki są dwa i oba realne: (1) przycisk wygląda na
      // wskaźnik, więc nikt go nie klika, a to jedyna droga do ponownego
      // sprawdzenia; (2) po odmowie diagnostyki (patrz defekt wyżej) na ekranie
      // stoją TRZY napisy „Sprawdzanie…" i żaden z nich nie jest akcją.
      // Słownik nie ma klucza na tę akcję - naprawa to `status.refresh` w PL/EN.
      const t = realT("pl");
      serverSays(status());
      await mountPanel();
      const refresh = buttonWithText(t("admin.analyticsSettings.status.checking"));
      expect((refresh.textContent ?? "").trim()).not.toBe(
        t("admin.analyticsSettings.status.checking"),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// 7. Brama zgody (RODO)
// ---------------------------------------------------------------------------

describe("brama zgody - panel jest edytorem, nie wstrzykiwaczem", () => {
  it("fragment ze `script` z pola „custom head” NIE WYKONUJE SIĘ w panelu", async () => {
    // RODO. Skrypty analityczne wolno załadować wyłącznie po zgodzie na
    // kategorię „Analityczne" - i robi to `ConsentScriptInjector`, po
    // sprawdzeniu `useEffectiveConsent()`. Panel administracyjny nie pyta o
    // zgodę nikogo (baner na trasach panelu nie stoi), więc wykonanie tu
    // fragmentu byłoby wstrzyknięciem pomiaru bez podstawy prawnej - na dodatek
    // z pominięciem całej bramki.
    const probe = "__rodoProbeAnalyticsPanel";
    rows.alfa.analytics = {
      ...ALFA,
      custom_head_html: `<script>window.${probe} = 1;</script>`,
      custom_body_html: '<img src="https://pixel.example.org/p.gif" alt="">',
    };
    await mountPanel();

    // Wartość jest widoczna jako TEKST w polu edycji - i tylko tam.
    expect(textareas()[0].value).toContain("<script>");
    expect(Reflect.get(window, probe)).toBeUndefined();
    expect(document.querySelectorAll(`script[src*="${probe}"]`)).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll("script")).some((element) =>
        (element.textContent ?? "").includes(probe),
      ),
    ).toBe(false);
    // Znacznik wstrzykiwacza (`data-consent-owner`) nie ma prawa się pojawić:
    // to on odróżnia węzły dodane PO zgodzie od reszty dokumentu.
    expect(document.querySelectorAll("[data-consent-owner]")).toHaveLength(0);
    expect(document.querySelectorAll('img[src^="https://pixel.example.org"]')).toHaveLength(0);
  });

  it("panel MÓWI, że skrypty czekają na zgodę - w PL i w EN", async () => {
    // Warunek zgody jest częścią umowy z operatorem: to on wkleja tu fragment
    // i musi wiedzieć, kiedy się uruchomi. Napis idzie ze słownika, więc jego
    // zniknięcie oblewa ten test.
    for (const lang of ["pl", "en"] as const) {
      const t = realT(lang);
      expect(t("admin.analyticsSettings.subtitle").length).toBeGreaterThan(0);
      expect(t("admin.analyticsSettings.custom.desc").length).toBeGreaterThan(0);
    }
    expect(realT("pl")("admin.analyticsSettings.custom.desc")).toContain("zgodzie");
    expect(realT("en")("admin.analyticsSettings.custom.desc")).toContain("consent");

    await mountPanel();
    const t = realT("pl");
    expect(document.body.textContent).toContain(t("admin.analyticsSettings.subtitle"));
    expect(document.body.textContent).toContain(t("admin.analyticsSettings.custom.desc"));
  });
});

// ---------------------------------------------------------------------------
// 8. Dwujęzyczność
// ---------------------------------------------------------------------------

describe("dwujęzyczność panelu", () => {
  it("po polsku wszystkie sekcje mają napisy ze SŁOWNIKA, nie klucze", async () => {
    const t = realT("pl");
    serverSays(status({ ga4: { configured: true, activeMode: "service_account" } }));
    await mountPanel();

    const body = document.body.textContent ?? "";
    for (const key of [
      "admin.analyticsSettings.title",
      "admin.analyticsSettings.ga4.title",
      "admin.analyticsSettings.ga4.propertyIdHint",
      "admin.analyticsSettings.gsc.title",
      "admin.analyticsSettings.gsc.openDashboard",
      "admin.analyticsSettings.plausible.title",
      "admin.analyticsSettings.custom.head",
      "admin.analyticsSettings.ga4.modes.service_account",
    ]) {
      expect(body, `brak napisu dla ${key}`).toContain(t(key));
      expect(body, `na ekranie stoi surowy klucz ${key}`).not.toContain(key);
    }
  });

  it("przełączenie na EN podmienia napisy panelu i nie zostawia polskich", async () => {
    serverSays(status({ ga4: { configured: true, activeMode: "service_account" } }));
    const view = await mountPanel();
    expect(view.container.textContent).toContain(realT("pl")("admin.analyticsSettings.ga4.desc"));

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    const en = realT("en");
    const body = document.body.textContent ?? "";
    expect(body).toContain(en("admin.analyticsSettings.title"));
    expect(body).toContain(en("admin.analyticsSettings.ga4.desc"));
    expect(body).toContain(en("admin.analyticsSettings.ga4.modes.service_account"));
    expect(body).not.toContain(realT("pl")("admin.analyticsSettings.ga4.desc"));
  });

  it("BRAK trybu aktywnego degraduje do etykiety „brak”, nie do surowego klucza", async () => {
    // `modeKey(mode) = mode ?? "none"` - bez tego klucz tłumaczenia kończy się
    // kropką i i18n wypisuje go na ekran.
    const t = realT("pl");
    serverSays(status({ ga4: { configured: true, activeMode: null } }));
    await mountPanel();
    await waitFor(() =>
      expect(document.body.textContent).toContain(t("admin.analyticsSettings.ga4.modes.none")),
    );
    expect(document.body.textContent).not.toContain("admin.analyticsSettings.ga4.modes.");
  });

  it("konto usługi i identyfikator z serwera są POKAZANE - diagnostyka ma od czego zacząć", async () => {
    serverSays(
      status({
        ga4: {
          configured: true,
          activeMode: "service_account",
          serviceAccountEmail: "pomiar@example.org",
          propertyId: "111111111",
        },
      }),
    );
    await mountPanel();
    await waitFor(() => expect(document.body.textContent).toContain("pomiar@example.org"));
    expect(document.body.textContent).toContain("properties/111111111");
  });
});
