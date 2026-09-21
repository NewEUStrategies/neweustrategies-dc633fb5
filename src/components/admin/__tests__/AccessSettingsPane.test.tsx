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

function rule(overrides: Partial<ContentAccessRule> = {}): ContentAccessRule {
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
    ...overrides,
  };
}

interface MountOptions {
  entityId?: string | null;
  rule?: ContentAccessRule | null;
  plans?: AccessPlan[];
  hasPassword?: boolean;
  hints?: { hint_pl: string | null; hint_en: string | null } | null;
  meteringEnabled?: boolean;
}

/** Montaż + oczekiwanie na koniec fazy ładowania (cztery odczyty naraz). */
async function mountPane(options: MountOptions = {}) {
  const entityId = options.entityId === undefined ? "post-42" : options.entityId;
  sb().setTable("access_plans", options.plans ?? PLANS);
  sb().setTable("content_access", options.rule === undefined ? null : options.rule);
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
  sb().rpc.setData("admin_set_content_password", null);
  sb().rpc.setData("admin_clear_content_password", null);

  const view = mountSettingsPane(<AccessSettingsPane entityType="post" entityId={entityId} />);
  await waitFor(() => expect(screen.queryByText("adminPostPanes.access.loading")).toBeNull());
  return view;
}

const modeSelect = (container: HTMLElement) => selectWithOption(container, "password");
const meteringSelect = (container: HTMLElement) => selectWithOption(container, "metered");
const tierSelect = (container: HTMLElement) => selectWithOption(container, "20");

const saveButton = () => screen.getByRole("button", { name: "adminPostPanes.access.saveAccess" });

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
    expect(sb().writes("content_access")).toHaveLength(0);
  });

  // DEFEKT PRODUKCYJNY (rejestr): faza ładowania IGNORUJE `error` z każdego
  // z czterech odczytów (AccessSettingsPane.tsx:76-117 - destrukturyzowane jest
  // WYŁĄCZNIE `data`). Panel nie odróżnia więc „reguły nie ma" od „nie udało się
  // jej przeczytać": w obu przypadkach `r` jest `null`, formularz staje na
  // trybie PUBLICZNYM, a pierwsze „Zapisz dostęp" upsertuje `mode: "public"` na
  // istniejącą regułę - czyli zdejmuje paywall z płatnego materiału bez jednego
  // komunikatu.
  //
  // ZAKRES DEFEKTU (bez przeceniania): sprawdzenie `.error` łapie odmowę
  // UPRAWNIEŃ do tabeli (SQLSTATE 42501, jak niżej), błąd PostgREST i awarię
  // sieci - supabase-js oddaje wtedy `{ data: null, error }`. NIE łapie samego
  // filtrowania wierszy przez RLS: polityka, która wiersz ukrywa, oddaje zero
  // wierszy, czyli `{ data: null, error: null }` z `maybeSingle()`, i taki
  // odczyt jest nieodróżnialny od „reguły jeszcze nie ma". To osobna, głębsza
  // dziura (panel nie wie, że czegoś nie widzi); tutaj przypinamy tę połowę,
  // którą widać po `error`.
  //
  // Oczekiwanie: nieudany odczyt melduje się przez `toastError(..., "load")`
  // ALBO blokuje zapis. Test dowodzi OBU połówek szkody - fałszywego stanu
  // „public" NA EKRANIE i ładunku `mode: "public"` W BAZIE - a czerwona jest
  // dopiero ostatnia asercja, czyli brakujący komunikat.
  it.fails(
    "DEFEKT: nieudany odczyt reguły udaje dostęp publiczny i pozwala go zapisać",
    async () => {
      sb().failRead("content_access", "permission denied for table content_access", "42501");
      const { container } = await mountPane({ rule: null });

      // POŁOWA PIERWSZA: odmowa odczytu wygląda jak „treść jest publiczna".
      expect(modeSelect(container).value).toBe("public");
      expect(screen.queryByText("adminPostPanes.access.teaserPl")).toBeNull();

      // POŁOWA DRUGA: ten fałszywy stan daje się ZAPISAĆ - upsert po parze
      // (typ, byt) nadpisuje regułę, której panel nawet nie przeczytał.
      fireEvent.click(saveButton());
      await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
      expect(sb().lastWrite("content_access")).toMatchObject({
        entity_type: "post",
        entity_id: "post-42",
        mode: "public",
      });
      expect(sb().db.lastChain("content_access")?.argsOf("upsert")?.[1]).toEqual({
        onConflict: "entity_type,entity_id",
      });

      // I ANI JEDNEGO KOMUNIKATU - to jest ta czerwona asercja.
      expect(toasts().toastError).toHaveBeenCalled();
    },
  );
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
    expect(sb().lastWrite("content_access")).toEqual({
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
    // Konflikt rozstrzyga PARA (typ, byt) - inaczej upsert dublowałby reguły.
    expect(sb().db.lastChain("content_access")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "entity_type,entity_id",
    });
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
    expect(sb().lastWrite("content_access")).toMatchObject({
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
    expect(sb().lastWrite("content_access")).toMatchObject({ metering_policy: "inherit" });
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
      if (!chain.has("upsert")) return { data: null, error: null };
      return new Promise((resolve) => {
        deferred.release = () => resolve({ data: null, error: null });
      });
    });

    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    deferred.release?.();
    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    expect(saveButton()).toBeEnabled();
    expect(modeSelect(container).value).toBe("public");
  });
});

describe("AccessSettingsPane - hasło", () => {
  it("tryb hasła bez hasła nie zapisuje niczego i mówi dlaczego", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    fireEvent.click(saveButton());

    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.access.setPasswordForMode");
    expect(sb().writes("content_access")).toHaveLength(0);
    expect(sb().rpc.names()).not.toContain("admin_set_content_password");
  });

  it("jawne hasło jedzie WYŁĄCZNIE RPC-em, a upsert nosi same podpowiedzi", async () => {
    const { container } = await mountPane({ rule: null });

    fireEvent.change(modeSelect(container), { target: { value: "password" } });
    const password = passwordInput(container);
    if (!password) throw new Error("test: brak pola hasła w trybie password");
    fireEvent.change(password, { target: { value: "Konferencja-2026" } });
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Rok wydarzenia" } });
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "Event year" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(toasts().success).toHaveBeenCalledTimes(1));
    const payload = sb().lastWrite("content_access") as Record<string, unknown>;
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
    // Upsert JUŻ przeszedł - to jest cena rozbicia zapisu na dwa kroki.
    expect(sb().writes("content_access")).toHaveLength(1);
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
    expect(sb().lastWrite("content_access")).toMatchObject({
      mode: "members",
      password_hint_pl: null,
      password_hint_en: null,
    });
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
    expect(sb().writes("content_access")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "adminPostPanes.access.removePassword" }),
    ).toBeNull();
    expect(screen.getByText("adminPostPanes.access.passwordSetLabel")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Nazwisko prelegenta")).toBeNull();
    expect(passwordInput(container)).not.toBeNull();
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
