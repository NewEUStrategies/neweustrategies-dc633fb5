// PANEL DOSTĘPU DO TREŚCI (`AccessSettingsPane`) - paywall wpisu/strony:
// tryb dostępu, plany, próg warstwy, metering, zajawka i hasło.
//
// CO TEN PLIK PRZYPINA (a czego montaż bez interakcji nie dowodzi):
//   1. TRYB DOSTĘPU DECYDUJE, KTÓRE POLA W OGÓLE ISTNIEJĄ. `public` nie ma
//      nawet zajawki; `members` dokłada próg warstwy i metering; `paid` jeszcze
//      plany i cenę jednorazową; `password` - hasło z podpowiedziami. Panel
//      renderuje pięć rozłącznych zestawów pól i test musi wejść w każdy,
//      bo inaczej „0 wywołanych funkcji" zostaje mimo zielonego montażu.
//   2. HASŁO NIGDY NIE JEDZIE W UPSERCIE. Jawne hasło idzie WYŁĄCZNIE przez
//      RPC `admin_set_content_password` (bcrypt po stronie serwera), a upsert
//      nosi tylko podpowiedzi - i to tylko w trybie `password`. Wyjście z tego
//      trybu MUSI wywołać `admin_clear_content_password`, żeby stary hash nie
//      dał się później użyć.
//   3. PODPOWIEDZI HASŁA CZYTA SIĘ RPC-em, nie kolumną. Kolumny
//      `password_hint_*` są odebrane rolom klienckim (REVOKE), więc panel woła
//      `get_password_hint(...).maybeSingle()` - i to jest ogniwo, na którym
//      wcześniej wywracał się cały panel pod atrapą bez `maybeSingle`.
//   4. PRÓG WARSTWY TO DRABINKA SPRZEDAŻOWA: warstwy o randze 0 („Konto
//      bezpłatne") NIE są progiem dostępu i nie mają prawa trafić na listę.
//   5. GLOBALNIE WYŁĄCZONY METERING dokłada ostrzeżenie do podpowiedzi - bez
//      niego redaktor ustawia „licznik" na wpisie, który i tak nie liczy.
//   6. NIEUDANY ODCZYT TO NIE „BRAK REGUŁY". Błąd KTÓREGOKOLWIEK z czterech
//      odczytów zostawia panel bez formularza i bez przycisku zapisu (z
//      komunikatem i ponowieniem) - wcześniej odmowa odczytu wyglądała jak
//      tryb publiczny i pierwszy zapis zdejmował paywall.
//   7. ZAPIS ODPOWIADA TEMU, CO PANEL PRZECZYTAŁ. Brak reguły -> INSERT (cudza
//      reguła kończy się 23505, a nie nadpisaniem), reguła była -> UPDATE po
//      (typ, byt) z `select("id")`, a zero dotkniętych wierszy to NIE sukces.
//      Zmiana bytu na tej samej instancji panelu czyta od zera.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   - `normalizeMeteringPolicy`, `tierName` i `convertToDisplayCurrency` są
//     PRAWDZIWE (mają własne testy); tutaj dowodzę, że panel je woła z tym,
//     co widać na ekranie.
//   - `t` jest echem klucza - asercje mierzą KLUCZ i18n, nie polską kopię.
//
// UWAGA, TEN PLIK MUSI ATRAPOWAĆ KURS WALUT. `@/lib/billing/fxRate` przy
// IMPORCIE modułu w środowisku z `window` odpala `void ensureFxRateLoaded()`,
// czyli PRAWDZIWY fetch do `api.nbp.pl`. Panel dochodzi tam przez
// `convertToDisplayCurrency`, więc bez tej atrapy każdy przebieg tego pliku
// wychodził do sieci (w logu: `OPTIONS https://api.nbp.pl/... 403`) i zależał
// od zapory runnera. Atrapa daje jednocześnie STAŁY kurs, więc asercja na
// przelicznik EUR nie zależy od kotwicy NBP w kodzie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  mountSettingsPane,
  paneToastSpies,
  selectWithOption,
  type SettingsPaneSupabase,
} from "@/test/admin/settingsPaneHarness";
import { fail, ok, type RecordedChain, type TableResponder } from "@/test/supabase";
import type { AccessPlan, ContentAccessRule } from "@/hooks/useContentAccess";

const stubs = vi.hoisted(() => ({
  supabase: null as unknown,
  toasts: null as unknown,
  language: "pl",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => stubs.language),
);

// Nakładka słownikowa panelu jest importem SIDE-EFFECTOWYM (`addResourceBundle`
// na prawdziwej instancji i18n) - pod atrapą `react-i18next` nie ma czego
// zasilać, a wciągnięcie `@/lib/i18n` ciągnęłoby cały runtime języka.
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/integrations/supabase/client", async () => {
  const { settingsPaneSupabase: make } = await import("@/test/admin/settingsPaneHarness");
  const sb = make();
  stubs.supabase = sb;
  return { supabase: sb.client };
});

async function sharedToasts(): Promise<ReturnType<typeof paneToastSpies>> {
  if (!stubs.toasts) {
    const { paneToastSpies: make } = await import("@/test/admin/settingsPaneHarness");
    stubs.toasts = make();
  }
  return stubs.toasts as ReturnType<typeof paneToastSpies>;
}

vi.mock("sonner", async () => (await sharedToasts()).sonner());

vi.mock("@/lib/toastError", async () => (await sharedToasts()).toastErrorModule());

// Warstwy i metering czytają `useAuth` (klucze cache per użytkownik).
vi.mock("@/hooks/useAuth", async () =>
  (await import("@/test/admin/settingsPaneHarness")).requiredTenantStub(
    "tenant-nes",
    "user-redaktor",
  ),
);

// Kurs EUR/PLN: JEDNA liczba, zero sieci (patrz nagłówek pliku).
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
}));

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const { radixSelectStub } = await import("@/test/reactStubs");
  return radixSelectStub(react);
});

vi.mock("@/components/ui/switch", async () => {
  const react = await import("react");
  const { radixSwitchStub } = await import("@/test/reactStubs");
  return radixSwitchStub(react);
});

import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";

const sb = () => stubs.supabase as SettingsPaneSupabase;
const toasts = () => stubs.toasts as ReturnType<typeof paneToastSpies>;

/** Warstwa członkostwa w zakresie, w jakim czyta ją panel. */
interface TierFixture {
  id: string;
  rank: number;
  name_pl: string;
  name_en: string;
}

const TIERS: TierFixture[] = [
  { id: "tier-free", rank: 0, name_pl: "Konto bezpłatne", name_en: "Free account" },
  { id: "tier-pro", rank: 20, name_pl: "Analityczny Pro", name_en: "Analytical Pro" },
  { id: "tier-plus", rank: 10, name_pl: "Czytelnik Plus", name_en: "Reader Plus" },
];

function plan(overrides: Partial<AccessPlan> & Pick<AccessPlan, "id">): AccessPlan {
  return {
    name_pl: "Plan miesięczny",
    name_en: "Monthly plan",
    description_pl: null,
    description_en: null,
    price_cents: 4900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 1,
    features_pl: [],
    features_en: [],
    badge_pl: null,
    badge_en: null,
    highlighted: false,
    trial_days: 0,
    ...overrides,
  };
}

const PLANS: AccessPlan[] = [
  plan({ id: "plan-pln", name_pl: "Prenumerata PL", price_cents: 4900, currency: "PLN" }),
  plan({
    id: "plan-eur",
    name_pl: "",
    name_en: "EU quarterly",
    price_cents: 2500,
    currency: "eur",
    interval: "quarter",
  }),
];

/** Wiersz reguły tak, jak oddaje go baza: z wersją (`updated_at`). */
type StoredRule = ContentAccessRule & { updated_at: string };

/** Wersja wiersza w chwili odczytu przez panel. */
const READ_VERSION = "2026-10-02T08:00:00.000001+00:00";

function rule(overrides: Partial<StoredRule> = {}): StoredRule {
  return {
    id: "rule-1",
    entity_type: "post",
    entity_id: "post-42",
    mode: "public",
    plan_ids: [],
    one_time_price_cents: null,
    one_time_currency: "PLN",
    teaser_pl: null,
    teaser_en: null,
    min_tier_rank: 0,
    metering_policy: "inherit",
    updated_at: READ_VERSION,
    ...overrides,
  };
}

interface MountOptions {
  entityId?: string | null;
  rule?: StoredRule | null;
  plans?: AccessPlan[];
  hasPassword?: boolean;
  hints?: { hint_pl: string | null; hint_en: string | null } | null;
  meteringEnabled?: boolean;
  /** Woła się PO zaplanowaniu odczytów, a PRZED montażem - tu psuje się odczyt. */
  afterSeed?: () => void;
}

const isWriteChain = (chain: RecordedChain) =>
  ["insert", "update", "upsert", "delete"].some((method) => chain.has(method));

/** Wartość filtra `.eq(kolumna, ...)` z łańcucha (np. który byt czytano). */
const eqValue = (chain: RecordedChain, column: string): unknown =>
  chain.calls.find((call) => call.method === "eq" && call.args[0] === column)?.args[1];

/**
 * `content_access` w kształcie bazy, Z WERSJĄ WIERSZA jak w Postgresie:
 *   - odczyt oddaje wiersz (albo `null`), `select("updated_at")` - samą wersję;
 *   - UPDATE trafia WYŁĄCZNIE w wiersz o wersji z `.eq("updated_at", ...)` i
 *     oddaje nową (trigger trg_content_access_updated), inaczej zero wierszy;
 *   - INSERT na istniejący wiersz to 23505 (UNIQUE (entity_type, entity_id));
 *   - `touch()` to UPDATE spoza zapisu panelu: RPC hasła albo druga karta.
 * Bez wersji atrapa nie odróżniłaby zapisu względem PRZECZYTANEJ reguły od
 * zapisu względem nieaktualnej - a to jest cała treść optimistic-locka.
 */
function contentAccessDb(initial: StoredRule | null) {
  let row = initial;
  let bumps = 0;
  const nextVersion = () => `2026-10-02T09:00:${String(++bumps).padStart(2, "0")}.000001+00:00`;
  const responder: TableResponder = (chain) => {
    if (chain.has("update")) {
      if (!row || eqValue(chain, "updated_at") !== row.updated_at) return ok([]);
      const patch = chain.argsOf("update")?.[0] as Partial<StoredRule>;
      row = { ...row, ...patch, updated_at: nextVersion() };
      return ok([{ updated_at: row.updated_at }]);
    }
    if (chain.has("insert")) {
      if (row) return fail("duplicate key value violates unique constraint", "23505");
      const payload = chain.argsOf("insert")?.[0] as Partial<StoredRule>;
      row = { ...rule(), ...payload, updated_at: nextVersion() };
      return ok([{ updated_at: row.updated_at }]);
    }
    if (isWriteChain(chain)) return ok(null);
    if (chain.argsOf("select")?.[0] === "updated_at") {
      return ok(row ? { updated_at: row.updated_at } : null);
    }
    return ok(row);
  };
  return {
    responder,
    /** UPDATE spoza zapisu panelu: nowa wersja wiersza (i ewentualnie nowe pola). */
    touch(patch: Partial<StoredRule> = {}) {
      if (row) row = { ...row, ...patch, updated_at: nextVersion() };
      return ok(null);
    },
    current: () => row,
  };
}

type ContentAccessDb = ReturnType<typeof contentAccessDb>;

/** Sam responder - dla testów, które nie zaglądają w stan „bazy". */
const contentAccessTable = (stored: StoredRule | null): TableResponder =>
  contentAccessDb(stored).responder;

/** Plan czterech odczytów panelu + odczytów warstw i meteringu. */
function seedReads(options: MountOptions = {}): ContentAccessDb {
  const table = contentAccessDb(options.rule === undefined ? null : options.rule);
  sb().setTable("access_plans", options.plans ?? PLANS);
  sb().setTableResponder("content_access", table.responder);
  sb().setTable("membership_tiers", TIERS);
  sb().setTable("metering_settings", {
    enabled: options.meteringEnabled ?? true,
    member_monthly_limit: 5,
    anon_monthly_limit: 0,
    meter_paid: true,
    meter_members: true,
    show_counter: true,
  });
  sb().rpc.setData("content_access_has_password", options.hasPassword ?? false);
  sb().rpc.setData("get_password_hint", options.hints ?? null);
  // RPC-e hasła robią w bazie UPDATE wiersza (`updated_at = now()`) - atrapa
  // też podbija wersję, inaczej test nie zobaczy fałszywego konfliktu z
  // własną zmianą hasła.
  sb().rpc.setResponse("admin_set_content_password", () => table.touch());
  sb().rpc.setResponse("admin_clear_content_password", () => table.touch());
  return table;
}

/** Montaż + oczekiwanie na koniec fazy ładowania (cztery odczyty naraz). */
async function mountPane(options: MountOptions = {}) {
  const entityId = options.entityId === undefined ? "post-42" : options.entityId;
  const table = seedReads(options);
  options.afterSeed?.();
  const view = mountSettingsPane(<AccessSettingsPane entityType="post" entityId={entityId} />);
  await waitFor(() => expect(screen.queryByText("adminPostPanes.access.loading")).toBeNull());
  return { ...view, table };
}

const modeSelect = (container: HTMLElement) => selectWithOption(container, "password");
const meteringSelect = (container: HTMLElement) => selectWithOption(container, "metered");
const tierSelect = (container: HTMLElement) => selectWithOption(container, "20");

const saveButton = () => screen.getByRole("button", { name: "adminPostPanes.access.saveAccess" });

/** KAŻDY zapis do `content_access`, niezależnie od rodzaju (insert/update/upsert/delete). */
const allWrites = () => sb().chainsFor("content_access").filter(isWriteChain);

/** Doczytanie SAMEJ wersji wiersza (po RPC hasła) - to nie jest odczyt reguły. */
const isVersionRead = (chain: RecordedChain) =>
  !isWriteChain(chain) && chain.argsOf("select")?.[0] === "updated_at";

/** Łańcuchy ODCZYTU reguły - ile razy panel czytał ją z bazy. */
const ruleReads = () =>
  sb()
    .chainsFor("content_access")
    .filter((chain) => !isWriteChain(chain) && !isVersionRead(chain));

const planSwitches = (container: HTMLElement): HTMLInputElement[] => [
  ...container.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
];

const textareas = (container: HTMLElement): HTMLTextAreaElement[] => [
  ...container.querySelectorAll<HTMLTextAreaElement>("textarea"),
];

const passwordInput = (container: HTMLElement): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>('input[type="password"]');

beforeEach(() => {
  sb().reset();
  toasts().reset();
  stubs.language = "pl";
});

afterEach(() => {
  cleanup();
});

describe("AccessSettingsPane - wczytanie", () => {
  it("bez reguły w bazie panel stoi na dostępie publicznym i nie rysuje pól paywalla", async () => {
    const { container } = await mountPane({ rule: null });

    expect(modeSelect(container).value).toBe("public");
    // `public` to jedyny tryb bez zajawki, progu i meteringu.
    expect(textareas(container)).toHaveLength(0);
    expect(planSwitches(container)).toHaveLength(0);
    expect(passwordInput(container)).toBeNull();
    expect(screen.queryByText("adminPostPanes.access.minTier")).toBeNull();
    expect(screen.queryByText("adminPostPanes.access.metering")).toBeNull();
  });

  it("odczyt zawęża się do TEGO bytu i pyta o hasło osobnymi RPC-ami", async () => {
    await mountPane({ rule: null });

    const read = sb().db.lastChain("content_access");
    expect(read?.calls.map((call) => call.method)).toEqual(["select", "eq", "eq", "maybeSingle"]);
    const filters = read?.calls.filter((call) => call.method === "eq").map((call) => call.args);
    expect(filters).toEqual([
      ["entity_type", "post"],
      ["entity_id", "post-42"],
    ]);
    // Wersja wiersza jedzie z odczytem - to ona warunkuje późniejszy UPDATE.
    expect(String(read?.argsOf("select")?.[0]).split(", ")).toContain("updated_at");
    expect(sb().rpc.names()).toEqual(
      expect.arrayContaining(["content_access_has_password", "get_password_hint"]),
    );
    expect(sb().rpc.lastCall("get_password_hint")?.args).toEqual({
      _entity_type: "post",
      _entity_id: "post-42",
    });
    // Plany są czytane zawsze - lista aktywnych, w kolejności sprzedażowej.
    const plansRead = sb().db.lastChain("access_plans");
    expect(plansRead?.argsOf("eq")).toEqual(["active", true]);
    expect(plansRead?.argsOf("order")).toEqual(["sort_order"]);
  });

  it("zapisana reguła płatna wraca do formularza w KAŻDYM polu", async () => {
    const { container } = await mountPane({
      rule: rule({
        mode: "paid",
        plan_ids: ["plan-eur"],
        one_time_price_cents: 1900,
        one_time_currency: "EUR",
        teaser_pl: "Zajawka dla czytelnika",
        teaser_en: "Teaser for the reader",
        min_tier_rank: 10,
        metering_policy: "exempt",
      }),
    });

    expect(modeSelect(container).value).toBe("paid");
    expect(planSwitches(container).map((node) => node.checked)).toEqual([false, true]);
    expect(screen.getByDisplayValue("1900")).toBeInTheDocument();
    expect(screen.getByDisplayValue("EUR")).toBeInTheDocument();
    expect(tierSelect(container).value).toBe("10");
    expect(meteringSelect(container).value).toBe("exempt");
    expect(textareas(container).map((node) => node.value)).toEqual([
      "Zajawka dla czytelnika",
      "Teaser for the reader",
    ]);
  });

  it("reguła z hasłem pokazuje podpowiedzi z RPC i przycisk usunięcia hasła", async () => {
    const { container } = await mountPane({
      rule: rule({ mode: "password" }),
      hasPassword: true,
      hints: { hint_pl: "Nazwisko prelegenta", hint_en: "Speaker surname" },
    });

    expect(screen.getByText("adminPostPanes.access.passwordSet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "adminPostPanes.access.removePassword" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Nazwisko prelegenta")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Speaker surname")).toBeInTheDocument();
    expect(passwordInput(container)?.value).toBe("");
    expect(passwordInput(container)?.getAttribute("autocomplete")).toBe("new-password");
  });

  it("nowa treść (brak entityId) nie pyta bazy o regułę ani o hasło", async () => {
    const { container } = await mountPane({ entityId: null });

    expect(sb().db.chainsFor("content_access")).toHaveLength(0);
    expect(sb().rpc.calls).toHaveLength(0);
    expect(modeSelect(container).value).toBe("public");

    fireEvent.click(saveButton());

    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.saveContentFirst");
    expect(allWrites()).toHaveLength(0);
  });
});

// REGRESJA (rejestr, krytyczny): faza ładowania IGNOROWAŁA `error` z każdego
// z czterech odczytów - destrukturyzowane było WYŁĄCZNIE `data`. Panel nie
// odróżniał więc „reguły nie ma" od „nie udało się jej przeczytać": w obu
// przypadkach formularz stawał na trybie PUBLICZNYM, a pierwsze „Zapisz dostęp"
// upsertowało `mode: "public"` na istniejącą regułę - czyli zdejmowało paywall
// z płatnego materiału bez jednego komunikatu.
//
// Każdy z czterech odczytów zasila pole, które wraca w zapisie (tryb, plany,
// flaga hasła - wyjście z trybu hasła kasuje hash - i podpowiedzi NULL-owane
// przy pustym polu), więc błąd KAŻDEGO z nich ma zablokować formularz.
//
// ZAKRES (bez przeceniania): `.error` łapie odmowę uprawnień (42501), błąd
// PostgREST i sieć. Wiersza ukrytego przez RLS (`{ data: null, error: null }`)
// odczyt nie odróżni od braku reguły - tę połowę domyka ścieżka zapisu: brak
// reguły to INSERT, który na istniejący wiersz kończy się 23505 zamiast
// nadpisania (patrz „zapis" niżej).
const READ_FAILURES: ReadonlyArray<[string, () => void]> = [
  [
    "reguły (`content_access`, 42501)",
    () => sb().failRead("content_access", "permission denied for table content_access", "42501"),
  ],
  ["planów (`access_plans`)", () => sb().failRead("access_plans", "JWT expired", "PGRST301")],
  [
    "flagi hasła (RPC)",
    () => sb().rpc.setError("content_access_has_password", "canceling statement", "57014"),
  ],
  [
    "podpowiedzi hasła (RPC)",
    () => sb().rpc.setError("get_password_hint", "permission denied", "42501"),
  ],
];

describe("AccessSettingsPane - nieudany odczyt", () => {
  it.each(READ_FAILURES)(
    "błąd odczytu %s: komunikat, brak formularza i ZERO zapisów",
    async (_source, breakRead) => {
      const { container } = await mountPane({
        rule: rule({ mode: "paid", plan_ids: ["plan-pln"] }),
        afterSeed: breakRead,
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("adminPostPanes.access.loadError");
      expect(alert.textContent).toContain("adminPostPanes.access.loadErrorHelper");
      // Błąd idzie kanałem mapującym kod (uprawnienia / sieć) na kopię.
      expect(toasts().toastError).toHaveBeenCalledTimes(1);
      expect(toasts().toastError.mock.calls[0][1]).toBe("load");
      // Nie ma CZEGO zapisać: ani trybu na ekranie, ani przycisku zapisu.
      expect(container.querySelectorAll("select")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "adminPostPanes.access.saveAccess" })).toBeNull();
      expect(allWrites()).toHaveLength(0);
      expect(sb().rpc.names()).not.toContain("admin_clear_content_password");
    },
  );

  it("„Spróbuj ponownie” czyta od nowa, a zapis po udanym odczycie niesie PRAWDZIWĄ regułę", async () => {
    const healthy = contentAccessTable(
      rule({ mode: "paid", plan_ids: ["plan-pln"], min_tier_rank: 10 }),
    );
    let reads = 0;
    const { container } = await mountPane({
      afterSeed: () =>
        sb().setTableResponder("content_access", (chain) => {
          if (isWriteChain(chain)) return healthy(chain);
          reads += 1;
          return reads === 1 ? fail("Failed to fetch") : healthy(chain);
        }),
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "adminPostPanes.access.retry" }));

    await waitFor(() => expect(modeSelect(container).value).toBe("paid"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(reads).toBe(2);

    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    // Reguła BYŁA, więc zapis to UPDATE z trybem płatnym - nie upsert `public`.
    expect(sb().lastWrite("content_access", "update")).toMatchObject({
      mode: "paid",
      plan_ids: ["plan-pln"],
      min_tier_rank: 10,
    });
    expect(sb().writes("content_access", "insert")).toHaveLength(0);
    expect(sb().writes("content_access", "upsert")).toHaveLength(0);
  });

  it("ponowienie, które znowu pada, zostaje w stanie błędu", async () => {
    await mountPane({
      afterSeed: () => sb().failRead("content_access", "permission denied", "42501"),
    });

    fireEvent.click(screen.getByRole("button", { name: "adminPostPanes.access.retry" }));

    await waitFor(() => expect(toasts().toastError).toHaveBeenCalledTimes(2));
    expect(ruleReads()).toHaveLength(2);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "adminPostPanes.access.saveAccess" })).toBeNull();
  });
});

describe("AccessSettingsPane - zmiana bytu", () => {
  it("byt bez reguły po bycie płatnym dostaje formularz DOMYŚLNY, a zapis trafia pod nowy byt", async () => {
    seedReads();
    const rules: Record<string, StoredRule | null> = {
      "post-42": rule({ mode: "paid", plan_ids: ["plan-eur"] }),
      "post-43": null,
    };
    sb().setTableResponder("content_access", (chain) =>
      contentAccessTable(rules[String(eqValue(chain, "entity_id"))] ?? null)(chain),
    );
    const view = mountSettingsPane(<AccessSettingsPane entityType="post" entityId="post-42" />);
    await waitFor(() => expect(modeSelect(view.container).value).toBe("paid"));

    view.rerenderPane(<AccessSettingsPane entityType="post" entityId="post-43" />);

    // Wcześniej `if (r)` pomijało pusty odczyt i na ekranie ZOSTAWAŁA reguła
    // poprzedniego bytu - a zapis wysyłał ją pod nowe `entity_id`.
    await waitFor(() => expect(modeSelect(view.container).value).toBe("public"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(sb().lastWrite("content_access", "insert")).toMatchObject({
      entity_id: "post-43",
      mode: "public",
      plan_ids: [],
    });
  });

  it("spóźniona odpowiedź poprzedniego bytu nie nadpisuje formularza nowego", async () => {
    seedReads();
    const late: { release: (() => void) | null } = { release: null };
    sb().setTableResponder("content_access", (chain) => {
      if (eqValue(chain, "entity_id") === "post-42") {
        return new Promise((resolve) => {
          late.release = () => resolve(ok(rule({ mode: "paid" })));
        });
      }
      return ok(rule({ id: "rule-43", entity_id: "post-43", mode: "members" }));
    });
    const view = mountSettingsPane(<AccessSettingsPane entityType="post" entityId="post-42" />);
    view.rerenderPane(<AccessSettingsPane entityType="post" entityId="post-43" />);
    await waitFor(() => expect(modeSelect(view.container).value).toBe("members"));

    late.release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(modeSelect(view.container).value).toBe("members");
  });
});

describe("AccessSettingsPane - tryby dostępu", () => {
  it("przełączenie na `members` dokłada próg warstwy, metering i zajawki", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "members" } });

    expect(screen.getByText("adminPostPanes.access.minTier")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.access.metering")).toBeInTheDocument();
    expect(textareas(container)).toHaveLength(2);
    // Plany i cena jednorazowa są WYŁĄCZNIE dla trybu płatnego.
    expect(planSwitches(container)).toHaveLength(0);
    expect(screen.queryByText("adminPostPanes.access.oneTimePrice")).toBeNull();
  });

  it("tryb `paid` rysuje plany z ceną, walutą i przelicznikiem EUR dla PLN", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "paid" } });

    const labels = [...container.querySelectorAll("label")].filter((node) =>
      node.querySelector('input[role="switch"]'),
    );
    expect(labels).toHaveLength(2);
    expect(labels[0].textContent).toContain("Prenumerata PL · 49.00 PLN / month");
    // 4900 gr / 4,00 PLN za EUR = 12,25 EUR - liczy `convertToDisplayCurrency`.
    expect(labels[0].textContent).toContain("(EN: 12.25 EUR)");
    // Plan bez nazwy PL spada na angielską, a cena w EUR nie ma przelicznika.
    expect(labels[1].textContent).toContain("EU quarterly · 25.00 eur / quarter");
    expect(labels[1].textContent).not.toContain("EN:");
    expect(screen.getByText("adminPostPanes.access.oneTimePrice")).toBeInTheDocument();
  });

  it("brak aktywnych planów w bazie mówi to wprost, zamiast pustej listy", async () => {
    const { container } = await mountPane({ rule: null, plans: [] });

    fireEvent.change(modeSelect(container), { target: { value: "paid" } });

    expect(screen.getByText("adminPostPanes.access.noPlans")).toBeInTheDocument();
    expect(planSwitches(container)).toHaveLength(0);
  });

  it("tryb `password` zdejmuje pola płatne i pokazuje hasło z podpowiedziami", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "paid" }) });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });

    expect(passwordInput(container)).not.toBeNull();
    expect(screen.getByText("adminPostPanes.access.passwordSetLabel")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.access.hintPl")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.access.hintEn")).toBeInTheDocument();
    expect(planSwitches(container)).toHaveLength(0);
    expect(screen.queryByText("adminPostPanes.access.minTier")).toBeNull();
    // Hasło bez ustawionego hasła nie ma czego usuwać.
    expect(
      screen.queryByRole("button", { name: "adminPostPanes.access.removePassword" }),
    ).toBeNull();
  });

  it("lista progów pomija warstwy darmowe i idzie rangą rosnąco", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "members" }) });

    const options = [...tierSelect(container).options];
    expect(options.map((option) => option.value)).toEqual(["0", "10", "20"]);
    expect(options.map((option) => option.textContent)).toEqual([
      "adminPostPanes.access.minTierNone",
      "Czytelnik Plus",
      "Analityczny Pro",
    ]);
    expect(screen.queryByText("Konto bezpłatne")).toBeNull();
  });

  it("po angielsku progi mają angielskie nazwy warstw", async () => {
    stubs.language = "en";
    const { container } = await mountPane({ rule: rule({ mode: "members" }) });

    expect([...tierSelect(container).options].map((option) => option.textContent)).toEqual([
      "adminPostPanes.access.minTierNone",
      "Reader Plus",
      "Analytical Pro",
    ]);
  });

  it("globalnie wyłączony metering dokłada ostrzeżenie do podpowiedzi", async () => {
    await mountPane({ rule: rule({ mode: "members" }), meteringEnabled: false });

    await waitFor(() =>
      expect(screen.getByText(/adminPostPanes\.access\.meteringDisabledHint/)).toBeInTheDocument(),
    );
  });

  it("włączony metering nie straszy ostrzeżeniem", async () => {
    await mountPane({ rule: rule({ mode: "members" }), meteringEnabled: true });

    await waitFor(() =>
      expect(screen.getByText(/adminPostPanes\.access\.meteringHelper/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/adminPostPanes\.access\.meteringDisabledHint/)).toBeNull();
  });
});

describe("AccessSettingsPane - zapis", () => {
  it("zapis trybu członkowskiego wysyła komplet z progiem, meteringiem i zajawkami", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.change(tierSelect(container), { target: { value: "20" } });
    fireEvent.change(meteringSelect(container), { target: { value: "metered" } });
    fireEvent.change(textareas(container)[0], { target: { value: "Trzy akapity wstępu" } });
    fireEvent.change(textareas(container)[1], { target: { value: "Three intro paragraphs" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(toasts().success).toHaveBeenCalledWith("adminPostPanes.access.accessSaved");
    expect(sb().lastWrite("content_access", "insert")).toEqual({
      entity_type: "post",
      entity_id: "post-42",
      mode: "members",
      plan_ids: [],
      one_time_price_cents: null,
      one_time_currency: "PLN",
      teaser_pl: "Trzy akapity wstępu",
      teaser_en: "Three intro paragraphs",
      min_tier_rank: 20,
      metering_policy: "metered",
      password_hint_pl: null,
      password_hint_en: null,
    });
    // Reguły nie było, więc INSERT - nigdy upsert, który nadpisałby regułę
    // utworzoną w międzyczasie (inna karta) albo niewidoczną dla odczytu.
    expect(sb().writes("content_access", "upsert")).toHaveLength(0);
    expect(sb().writes("content_access", "update")).toHaveLength(0);
    // Bez trybu hasła panel nie dotyka RPC-ów hasła.
    expect(sb().rpc.names()).not.toContain("admin_set_content_password");
    expect(sb().rpc.names()).not.toContain("admin_clear_content_password");
  });

  it("przełączniki planów dokładają i zdejmują identyfikatory z ładunku", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "paid" }) });

    fireEvent.click(planSwitches(container)[0]);
    fireEvent.click(planSwitches(container)[1]);
    expect(planSwitches(container).map((node) => node.checked)).toEqual([true, true]);
    // Zdjęcie pierwszego planu musi ZOSTAWIĆ drugi.
    fireEvent.click(planSwitches(container)[0]);
    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "2500" } });
    fireEvent.change(screen.getByDisplayValue("PLN"), { target: { value: "" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(sb().lastWrite("content_access", "update")).toMatchObject({
      mode: "paid",
      plan_ids: ["plan-eur"],
      one_time_price_cents: 2500,
      // Wyczyszczona waluta wraca do PLN, a nie do pustego stringa.
      one_time_currency: "PLN",
    });
  });

  it("nieznana polityka meteringu z bazy jest normalizowana przy zapisie", async () => {
    const { container } = await mountPane({
      rule: rule({ mode: "members", metering_policy: "wartosc-z-przyszlosci" }),
    });

    expect(meteringSelect(container).value).toBe("inherit");
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(sb().lastWrite("content_access", "update")).toMatchObject({
      metering_policy: "inherit",
    });
  });

  it("odmowa bazy idzie kanałem `toastError` z kategorią zapisu, a panel zostaje na ekranie", async () => {
    const { container } = await mountPane({ rule: null });
    sb().failWrite("content_access", "permission denied for table content_access", "42501");

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().toastError).toHaveBeenCalledTimes(1));
    const [error, kind] = toasts().toastError.mock.calls[0];
    expect((error as Error).message).toBe("permission denied for table content_access");
    expect(kind).toBe("save");
    expect(toasts().success).not.toHaveBeenCalled();
    // Przycisk wraca do stanu gotowego - inaczej redaktor nie ma jak powtórzyć.
    expect(saveButton()).toBeEnabled();
    expect(modeSelect(container).value).toBe("members");
  });

  it("w trakcie zapisu przycisk jest zablokowany", async () => {
    const { container } = await mountPane({ rule: null });
    const deferred: { release: (() => void) | null } = { release: null };
    sb().setTableResponder("content_access", (chain) => {
      if (!chain.has("insert")) return { data: null, error: null };
      return new Promise((resolve) => {
        deferred.release = () => resolve(ok([{ updated_at: READ_VERSION }]));
      });
    });

    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    deferred.release?.();
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(saveButton()).toBeEnabled();
    expect(modeSelect(container).value).toBe("public");
  });

  it("istniejąca reguła idzie UPDATE-em po (typ, byt, WERSJA), bez kluczy w ładunku i z kontrolą wierszy", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "paid", plan_ids: ["plan-pln"] }) });

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    const write = sb().db.lastChain("content_access");
    expect(write?.calls.map((call) => call.method)).toEqual(["update", "eq", "eq", "eq", "select"]);
    expect(eqValue(write as RecordedChain, "entity_type")).toBe("post");
    expect(eqValue(write as RecordedChain, "entity_id")).toBe("post-42");
    // Warunek wersji: UPDATE trafia tylko w wiersz, który panel PRZECZYTAŁ.
    expect(eqValue(write as RecordedChain, "updated_at")).toBe(READ_VERSION);
    // `select("updated_at")` to dowód, że UPDATE czegokolwiek dotknął, i nowa
    // baza dla kolejnego zapisu.
    expect(write?.argsOf("select")).toEqual(["updated_at"]);
    const payload = sb().lastWrite("content_access", "update") as Record<string, unknown>;
    expect(payload.mode).toBe("members");
    expect(Object.keys(payload)).not.toContain("entity_type");
    expect(Object.keys(payload)).not.toContain("entity_id");
    expect(sb().writes("content_access", "insert")).toHaveLength(0);
  });

  it("drugi zapis po INSERT idzie UPDATE-em względem wersji z INSERT-u - bez fałszywego konfliktu", async () => {
    const { container, table } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    const insertedVersion = table.current()?.updated_at;
    fireEvent.change(textareas(container)[0], { target: { value: "Druga zmiana" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(2));

    expect(sb().writes("content_access", "insert")).toHaveLength(1);
    const updates = sb()
      .db.chainsFor("content_access")
      .filter((chain) => chain.has("update"));
    expect(updates.map((chain) => eqValue(chain, "updated_at"))).toEqual([insertedVersion]);
    expect(table.current()).toMatchObject({ mode: "members", teaser_pl: "Druga zmiana" });
    expect(toasts().error).not.toHaveBeenCalled();
  });

  // REGRESJA (ta sama klasa co D5, ścieżka współbieżna): UPDATE po (typ, byt)
  // BEZ warunku wersji nadpisywał regułę, którą w międzyczasie zmienił ktoś
  // inny - karta otwarta na „członkowie" zdejmowała paywall ustawiony chwilę
  // wcześniej w drugiej karcie, bo wysyłała CAŁY formularz z nieaktualnym trybem.
  it("reguła zmieniona w innej karcie: zapis NIE nadpisuje paywalla, panel pokazuje stan bazy", async () => {
    const { container, table } = await mountPane({ rule: rule({ mode: "members" }) });
    // Druga karta: ta sama reguła, już płatna (nowa wersja wiersza).
    table.touch({ mode: "paid", plan_ids: ["plan-pln"] });

    fireEvent.change(modeSelect(container), { target: { value: "public" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.staleRule"),
    );
    expect(toasts().success).not.toHaveBeenCalled();
    // UPDATE poszedł względem PRZECZYTANEJ wersji i w nic nie trafił.
    const updates = sb()
      .db.chainsFor("content_access")
      .filter((chain) => chain.has("update"));
    expect(updates.map((chain) => eqValue(chain, "updated_at"))).toEqual([READ_VERSION]);
    expect(table.current()).toMatchObject({ mode: "paid", plan_ids: ["plan-pln"] });
    // Panel czyta regułę od nowa i pokazuje paywall z bazy, nie swój szkic.
    await waitFor(() => expect(modeSelect(container).value).toBe("paid"));
    expect(ruleReads()).toHaveLength(2);
  });

  it("UPDATE bez dotkniętych wierszy NIE jest sukcesem: komunikat i ponowny odczyt reguły", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "paid" }) });
    // Reguła zniknęła w międzyczasie (albo RLS odciął zapis BEZ błędu).
    sb().setTableResponder("content_access", (chain) => (chain.has("update") ? ok([]) : ok(null)));

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.staleRule"),
    );
    expect(toasts().success).not.toHaveBeenCalled();
    // Panel czyta regułę OD NOWA i pokazuje stan bazy, a nie swój szkic.
    await waitFor(() => expect(ruleReads()).toHaveLength(2));
    await waitFor(() => expect(modeSelect(container).value).toBe("public"));
  });

  it("INSERT na regułę utworzoną w międzyczasie (23505) nie nadpisuje jej i czyta ją od nowa", async () => {
    const { container } = await mountPane({ rule: null });
    sb().failWrite("content_access", "duplicate key value violates unique constraint", "23505");

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.staleRule"),
    );
    expect(toasts().success).not.toHaveBeenCalled();
    expect(toasts().toastError).not.toHaveBeenCalled();
    expect(sb().writes("content_access", "upsert")).toHaveLength(0);
    await waitFor(() => expect(ruleReads()).toHaveLength(2));
  });

  it("zapis unieważnia podsumowanie dostępu z zakładki „Ogólne”", async () => {
    const view = await mountPane({ rule: null });
    const summaryKey = ["content_access", "post", "post-42"];
    view.queryClient.setQueryData(summaryKey, { mode: "public", has_password: false });

    fireEvent.change(modeSelect(view.container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(view.queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
  });
});

describe("AccessSettingsPane - hasło", () => {
  it("tryb hasła bez hasła nie zapisuje niczego i mówi dlaczego", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    fireEvent.click(saveButton());

    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.setPasswordForMode");
    expect(allWrites()).toHaveLength(0);
    expect(sb().rpc.names()).not.toContain("admin_set_content_password");
  });

  it("jawne hasło jedzie WYŁĄCZNIE RPC-em, a zapis reguły nosi same podpowiedzi", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "Konferencja-2026" } });
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Rok wydarzenia" } });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "Event year" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    const payload = sb().lastWrite("content_access", "insert") as Record<string, unknown>;
    expect(payload.mode).toBe("password");
    expect(payload.password_hint_pl).toBe("Rok wydarzenia");
    expect(payload.password_hint_en).toBe("Event year");
    expect(Object.keys(payload)).not.toContain("password");
    expect(sb().rpc.lastCall("admin_set_content_password")?.args).toEqual({
      _entity_type: "post",
      _entity_id: "post-42",
      _password: "Konferencja-2026",
      _hint_pl: "Rok wydarzenia",
      _hint_en: "Event year",
    });
    // Po zapisie pole jawnego hasła jest czyste, a panel wie, że hasło JEST.
    expect(passwordInput(container)?.value).toBe("");
    expect(screen.getByText("adminPostPanes.access.passwordSet")).toBeInTheDocument();
  });

  // RPC hasła samo robi UPDATE wiersza (`updated_at = now()`). Bez doczytania
  // wersji po nim KOLEJNY zapis szedłby względem wersji sprzed RPC, nie
  // trafiałby w nic i panel meldowałby „reguła zmieniła się w międzyczasie"
  // po własnej zmianie hasła.
  it("po ustawieniu hasła kolejny zapis idzie względem wersji PO RPC - bez fałszywego konfliktu", async () => {
    const { container, table } = await mountPane({ rule: rule({ mode: "password" }) });
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "Konferencja-2026" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    const afterRpc = table.current()?.updated_at;
    expect(afterRpc).not.toBe(READ_VERSION);

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Nowa podpowiedź" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(2));
    expect(toasts().error).not.toHaveBeenCalled();
    const updates = sb()
      .db.chainsFor("content_access")
      .filter((chain) => chain.has("update"));
    expect(updates.map((chain) => eqValue(chain, "updated_at"))).toEqual([READ_VERSION, afterRpc]);
    expect(table.current()).toMatchObject({ password_hint_pl: "Nowa podpowiedź" });
  });

  it("gdy doczytanie wersji po RPC hasła pada, panel czyta wszystko od nowa zamiast zgadywać", async () => {
    const { container, table } = await mountPane({
      rule: rule({ mode: "password" }),
      hasPassword: true,
    });
    sb().setTableResponder("content_access", (chain) =>
      isVersionRead(chain) ? fail("Failed to fetch") : table.responder(chain),
    );
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "Konferencja-2026" } });
    fireEvent.click(saveButton());

    // Zapis i hasło przeszły - ale wersji panel już nie zna, więc nie zostawia
    // formularza, który zapisałby się względem nieaktualnej.
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ruleReads()).toHaveLength(2));
    await waitFor(() => expect(modeSelect(container).value).toBe("password"));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Po odczycie" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(2));
    expect(toasts().error).not.toHaveBeenCalled();
  });

  it("odmowa RPC hasła nie melduje sukcesu", async () => {
    const { container } = await mountPane({ rule: null });
    sb().rpc.setError("admin_set_content_password", "bcrypt: role not permitted", "42501");

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "tajne-haslo" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().toastError).toHaveBeenCalledTimes(1));
    expect(toasts().toastError.mock.calls[0][1]).toBe("save");
    expect(toasts().success).not.toHaveBeenCalled();
    // Zapis reguły JUŻ przeszedł - to jest cena rozbicia zapisu na dwa kroki.
    expect(sb().writes("content_access", "insert")).toHaveLength(1);
    expect(saveButton()).toBeEnabled();
  });

  it("wyjście z trybu hasła kasuje hash w bazie", async () => {
    const { container } = await mountPane({
      rule: rule({ mode: "password" }),
      hasPassword: true,
      hints: { hint_pl: "Podpowiedź", hint_en: "Hint" },
    });

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(sb().rpc.lastCall("admin_clear_content_password")?.args).toEqual({
      _entity_type: "post",
      _entity_id: "post-42",
    });
    // Podpowiedzi są NULL-owane, żeby nie zostały przy trybie bez hasła.
    expect(sb().lastWrite("content_access", "update")).toMatchObject({
      mode: "members",
      password_hint_pl: null,
      password_hint_en: null,
    });
  });

  it("odmowa kasowania hasła przy wyjściu z trybu hasła NIE melduje sukcesu", async () => {
    const { container } = await mountPane({ rule: rule({ mode: "password" }), hasPassword: true });
    sb().rpc.setError("admin_clear_content_password", "permission denied", "42501");

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    // Wcześniej wynik RPC był połykany: „Zapisano dostęp", a hash zostawał.
    await waitFor(() => expect(toasts().toastError).toHaveBeenCalledTimes(1));
    expect(toasts().toastError.mock.calls[0][1]).toBe("save");
    expect(toasts().success).not.toHaveBeenCalled();
    // Panel wie, że hasło WCIĄŻ jest - powrót do trybu hasła to pokazuje.
    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    expect(screen.getByText("adminPostPanes.access.passwordSet")).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("osobny przycisk usuwa hasło i podpowiedzi bez zapisu reguły", async () => {
    const { container } = await mountPane({
      rule: rule({ mode: "password" }),
      hasPassword: true,
      hints: { hint_pl: "Nazwisko prelegenta", hint_en: "Speaker surname" },
    });

    fireEvent.click(screen.getByRole("button", { name: "adminPostPanes.access.removePassword" }));

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(toasts().success).toHaveBeenCalledWith("adminPostPanes.access.passwordRemoved");
    expect(sb().rpc.callsFor("admin_clear_content_password")).toHaveLength(1);
    expect(allWrites()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "adminPostPanes.access.removePassword" }),
    ).toBeNull();
    expect(screen.getByText("adminPostPanes.access.passwordSetLabel")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nazwisko prelegenta")).toBeNull();
    expect(passwordInput(container)).not.toBeNull();
  });

  it("po usunięciu hasła przyciskiem zapis reguły nie zgłasza fałszywego konfliktu", async () => {
    const { container, table } = await mountPane({
      rule: rule({ mode: "password" }),
      hasPassword: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "adminPostPanes.access.removePassword" }));
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));

    fireEvent.change(modeSelect(container), { target: { value: "members" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(2));
    expect(toasts().error).not.toHaveBeenCalled();
    expect(table.current()).toMatchObject({ mode: "members" });
  });

  it("odmowa kasowania hasła idzie kanałem `toastError` z kategorią usuwania", async () => {
    await mountPane({ rule: rule({ mode: "password" }), hasPassword: true });
    sb().rpc.setError("admin_clear_content_password", "permission denied", "42501");

    fireEvent.click(screen.getByRole("button", { name: "adminPostPanes.access.removePassword" }));

    await waitFor(() => expect(toasts().toastError).toHaveBeenCalledTimes(1));
    expect(toasts().toastError.mock.calls[0][1]).toBe("delete");
    expect(toasts().success).not.toHaveBeenCalled();
    // Stan hasła zostaje - inaczej panel kłamałby, że hasła nie ma.
    expect(
      screen.getByRole("button", { name: "adminPostPanes.access.removePassword" }),
    ).toBeInTheDocument();
  });

  it("nowa treść bez identyfikatora nie woła RPC kasowania hasła", async () => {
    const { container } = await mountPane({ entityId: null });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "cokolwiek" } });
    fireEvent.click(saveButton());

    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.saveContentFirst");
    expect(sb().rpc.calls).toHaveLength(0);
  });
});
