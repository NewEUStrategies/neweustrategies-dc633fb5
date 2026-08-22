// Trasa `/admin/login-settings` ZAMONTOWANA - powłoka panelu, który decyduje
// o wejściu na serwis.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
// Reguły tego panelu (odczyt wiersza, spójność kombinacji, prawo zapisu,
// mapowanie błędu bazy) są czystymi funkcjami z własną tabelą przypadków
// w `src/lib/__tests__/authSettingsRules.test.ts`, a warstwa danych ma asercje
// w `src/hooks/__tests__/useAuthSettings.test.tsx`. Ten plik pokrywa to, czego
// tamte dwa nie mogą - SKLEJENIE:
//
//   1. WŁASNA BRAMKA `isSuperAdmin`. Layout `/admin` przepuszcza też redaktora
//      i autora, a ustawieniami logowania zarządza wyłącznie super_admin.
//      Ukrycie pozycji w nawigacji niczego nie chroni - adres wpisuje się z ręki.
//   2. AWARIA ODCZYTU NIE UDAJE PUSTKI. Panel po nieudanym odczycie pokazujący
//      domyślne zaprasza administratora do zapisania ich NA WIERZCH wartości,
//      których nie zdołał przeczytać. To zapis nieodwracalny i to jest jedyny
//      powód, dla którego `useAuthSettingsQuery` istnieje osobno.
//   3. ODMOWA ZOSTAWIA WERSJĘ ROBOCZĄ BEZ ZMIAN i nie puka do bazy. Zapis
//      odrzucony przed zapytaniem nie może wyglądać jak wykonany.
//   4. PAYLOAD ZAPISU, nie DOM. Asercja idzie na obiekcie przekazanym do
//      mutacji - napis w interfejsie może się zmienić przy każdej korekcie
//      tłumaczenia, kształt zapisywanego wiersza nie.
//   5. BŁĄD BAZY JEDZIE KLUCZEM i18n. Surowy komunikat Postgresa w toaście
//      wystawia nazwy tabel i polityk osobie, która właśnie NIE MIAŁA do nich
//      prawa - stąd asercja na kluczu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DWUDZIESTU CZTERECH PÓL PANELU: jedna interakcja na sekcję (przełącznik,
//   para PL/EN, obraz, wybór położenia) dowodzi, że wersja robocza jedzie do
//   payloadu. Klikanie każdego pola po kolei dla procentu byłoby dokładnie tą
//   farmą, o której mówi `adminRouteAuthority.gate.test.ts`.
// - ZACHOWANIA ATOMÓW I MOLEKUŁ: `SettingToggleCard`, `BilingualTextField`,
//   `ImageUrlField` i `AuthSettingsIssueList` mają własne asercje
//   w `src/components/admin/auth/__tests__/authAdminComponents.test.tsx`.
// - AUTORYTETU ZAPISU: prawo do `site_settings` egzekwuje RLS (pgTAP), a dostęp
//   do tras panelu pilnuje `adminRouteAuthority.gate.test.ts`.
// - SEKCJI PÓL REJESTRACJI: `RegistrationFieldsSection` edytuje INNY wiersz
//   ustawień (`newsletter_settings.popup_fields`) i ma testy przy popupie
//   rejestracji; tutaj stoi jako atrapa-marker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthSettings } from "@/lib/authSettings";

const h = vi.hoisted(() => ({
  isSuperAdmin: true,
  authLoading: false,
  /** Stan odczytu ustawień widziany przez panel. */
  query: {
    settings: null as AuthSettings | null,
    isPending: false,
    isError: false,
    isConfigured: true,
  },
  /** Ustawienia przekazane do mutacji - przedmiot dowodu zamiast DOM. */
  savePayloads: [] as AuthSettings[],
  /** Błąd, którym mutacja ma odpowiedzieć (`null` = sukces). */
  saveError: null as unknown,
  savePending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  adminSaved: vi.fn(() => "adminToast.saved"),
  /** Aktywna zakładka widziana przez atrapę `Tabs`. */
  activeTab: "page",
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-login-settings", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-admin-popup-signup", () => ({ ensureI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/adminToasts", () => ({ adminToast: { saved: () => h.adminSaved() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isSuperAdmin: h.isSuperAdmin,
    isAdmin: h.isSuperAdmin,
    isStaff: true,
    loading: h.authLoading,
    session: {},
  }),
}));
vi.mock("@/hooks/useAuthSettings", async () => {
  const { AUTH_DEFAULTS } = await import("@/lib/authSettings");
  return {
    useAuthSettingsQuery: () => ({
      settings: h.query.settings ?? AUTH_DEFAULTS,
      isPending: h.query.isPending,
      isError: h.query.isError,
      isConfigured: h.query.isConfigured,
    }),
    useSaveAuthSettings: () => ({
      mutateAsync: (value: AuthSettings) => {
        h.savePayloads.push(value);
        return h.saveError === null ? Promise.resolve() : Promise.reject(h.saveError);
      },
      isPending: h.savePending,
    }),
  };
});
// Sekcja pól rejestracji edytuje INNY wiersz ustawień i ciągnie za sobą całą
// warstwę newslettera - atrapa-marker trzyma granicę przedmiotu dowodu.
vi.mock("@/components/admin/auth/RegistrationFieldsSection", () => ({
  RegistrationFieldsSection: () => <div data-testid="RegistrationFieldsSection" />,
}));
// Biblioteka mediów sięga do `media.functions` i wymaga tenanta; sam wybór
// obrazu ma asercje przy organizmie `ImageUrlField`.
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));
// Radix Tabs nie działa pod happy-dom bez pełnego pointer API. Podmiana na
// natywne odpowiedniki: przedmiotem dowodu jest zawartość zakładek i to, co
// panel robi ze zmianą, a nie mechanika biblioteki.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: ReactNode }) => <div data-testid="tabs">{children}</div>,
  TabsList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => (
    <button type="button" data-tab-trigger={value} onClick={() => (h.activeTab = value)}>
      {children}
    </button>
  ),
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-tab-content={value}>{children}</div>
  ),
}));
// Radix Switch też potrzebuje pointer API - natywny checkbox oddaje kontrakt
// (stan + wywołanie z nową wartością), a to jest to, co panel czyta.
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as LoginSettingsRoute } from "@/routes/admin.login-settings";
import { AUTH_DEFAULTS } from "@/lib/authSettings";

const PATH = "/admin/login-settings";

async function mount() {
  return renderRoute({ route: LoginSettingsRoute, path: PATH, initialEntry: PATH });
}

/** Ostatni payload zapisu - `undefined`, gdy panel nie zawołał mutacji. */
const lastPayload = () => h.savePayloads.at(-1);

/** Przełącznik po etykiecie wiersza ustawień (atom `SettingToggleCard`). */
function switchNear(labelKey: string): HTMLElement {
  const label = screen.getByText(labelKey);
  const row = label.closest("div.flex.items-center.justify-between");
  if (!row) throw new Error(`test: nie znaleziono wiersza ustawienia dla "${labelKey}"`);
  const control = row.querySelector('[role="switch"]');
  if (!(control instanceof HTMLElement)) {
    throw new Error(`test: wiersz "${labelKey}" nie ma przełącznika`);
  }
  return control;
}

const saveButton = () => screen.getByText("adminLoginSettings.saveChanges");

beforeEach(() => {
  vi.clearAllMocks();
  h.isSuperAdmin = true;
  h.authLoading = false;
  h.query = { settings: null, isPending: false, isError: false, isConfigured: true };
  h.savePayloads = [];
  h.saveError = null;
  h.savePending = false;
  h.activeTab = "page";
});

afterEach(() => cleanup());

describe("dostęp do panelu", () => {
  it("bez roli super_admina panel przenosi do /admin i nie renderuje pól", async () => {
    h.isSuperAdmin = false;
    const view = await mount();
    await waitFor(() => expect(view.currentPath()).toBe("/admin"));
    expect(screen.queryByText("adminLoginSettings.pageTitle")).toBeNull();
  });

  it("dopóki rola się nie rozstrzygnęła, panel nie renderuje niczego", async () => {
    // Render „bez uprawnień" w trakcie ładowania roli mrugnąłby przekierowaniem
    // na /admin każdemu super_adminowi wchodzącemu z zimnego startu.
    h.authLoading = true;
    h.isSuperAdmin = false;
    const view = await mount();
    expect(view.currentPath()).toBe(PATH);
    expect(screen.queryByText("adminLoginSettings.pageTitle")).toBeNull();
  });

  it("super_admin widzi panel i wszystkie trzy zakładki", async () => {
    await mount();
    expect(screen.getByText("adminLoginSettings.pageTitle")).toBeTruthy();
    expect(document.querySelector('[data-tab-trigger="page"]')).toBeTruthy();
    expect(document.querySelector('[data-tab-trigger="popup"]')).toBeTruthy();
    expect(document.querySelector('[data-tab-trigger="signup"]')).toBeTruthy();
  });

  it("panel jest zakładką przeglądarki z tytułem albo bez nagłówka - nie zgaduje", async () => {
    // Panel jest `noindex` z definicji; sprawdzamy tylko kontrakt: albo `head()`
    // niesie tytuł, albo go nie ma - nigdy pusty wpis udający tytuł.
    const meta = await routeMeta(LoginSettingsRoute);
    for (const entry of meta) {
      if ("title" in entry) expect(entry.title).not.toBe("");
    }
  });
});

describe("awaria odczytu kontra brak ustawień", () => {
  it("awaria odczytu pokazuje komunikat i UKRYWA formularz", async () => {
    h.query = { settings: null, isPending: false, isError: true, isConfigured: false };
    await mount();
    expect(screen.getByRole("alert").textContent).toBe("adminLoginSettings.loadFailed");
    // To jest cała treść tego testu: nie ma czym zapisać, więc nie ma przycisku.
    expect(screen.queryByText("adminLoginSettings.saveChanges")).toBeNull();
  });

  it("oczekiwanie na odczyt nie renderuje formularza wypełnionego domyślnymi", async () => {
    h.query = { settings: null, isPending: true, isError: false, isConfigured: false };
    await mount();
    expect(screen.queryByText("adminLoginSettings.saveChanges")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("brak ustawień w bazie renderuje formularz z domyślnymi - to nie awaria", async () => {
    h.query = { settings: null, isPending: false, isError: false, isConfigured: false };
    await mount();
    expect(saveButton()).toBeTruthy();
    expect(screen.queryByText("adminLoginSettings.loadFailed")).toBeNull();
  });
});

describe("zapis: odmowa przed zapytaniem", () => {
  it("kombinacja blokująca odrzuca zapis, pokazuje klucz i NIE puka do bazy", async () => {
    h.query = {
      settings: { ...AUTH_DEFAULTS, logged_in_redirect_url: "/login" },
      isPending: false,
      isError: false,
      isConfigured: true,
    };
    await mount();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminLoginSettings.errInconsistent"),
    );
    expect(h.savePayloads).toEqual([]);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("odrzucony zapis zostawia wersję roboczą BEZ ZMIAN", async () => {
    // Odrzucenie, po którym pole wraca do wartości z bazy, wygląda jak zapis.
    h.query = {
      settings: { ...AUTH_DEFAULTS, logged_in_redirect_url: "/login" },
      isPending: false,
      isError: false,
      isConfigured: true,
    };
    await mount();
    const input = screen.getAllByPlaceholderText("/")[0];
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect((input as HTMLInputElement).value).toBe(AUTH_DEFAULTS.logout_redirect_url);
    // Zastrzeżenie zostaje na ekranie - administrator ma widzieć, CO blokuje.
    expect(document.querySelector('[data-issue-id="loggedInRedirectLoopsToLogin"]')).toBeTruthy();
  });

  it("blokada pokazuje się od razu po wpisaniu wartości, nie po próbie zapisu", async () => {
    await mount();
    expect(document.querySelector("[data-issue-id]")).toBeNull();
    const input = screen.getAllByPlaceholderText("/")[0];
    fireEvent.change(input, { target: { value: "//evil.example" } });
    await waitFor(() =>
      expect(document.querySelector('[data-issue-id="logoutRedirectIgnored"]')).toBeTruthy(),
    );
  });
});

describe("zapis: droga szczęśliwa i błąd bazy", () => {
  it("zapisuje wersję roboczą i potwierdza toastem panelu", async () => {
    await mount();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()).toEqual(AUTH_DEFAULTS);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToast.saved");
  });

  it("zmiana przełącznika trafia do PAYLOADU, nie tylko do DOM", async () => {
    await mount();
    fireEvent.click(switchNear("adminLoginSettings.publicSignupTitle"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.allow_public_signup).toBe(false);
  });

  it("zmiana pola tekstowego trafia do payloadu", async () => {
    await mount();
    const input = screen.getByPlaceholderText("#0a0a0a");
    fireEvent.change(input, { target: { value: "oklch(0.2 0 0)" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.login_bg_color).toBe("oklch(0.2 0 0)");
  });

  it("zmiana położenia formularza trafia do payloadu jako wartość z enuma", async () => {
    await mount();
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "center" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.login_position).toBe("center");
  });

  it("wartość położenia spoza enuma NIE trafia do payloadu", async () => {
    // Strażnik zamiast rzutowania: `<select>` w DOM da się ustawić na dowolny
    // ciąg (rozszerzenie przeglądarki, autofill, test), a `as` wpuściłby go
    // prosto do zapisanego wiersza - i `AuthPortal` dostałby wartość, której
    // nie rozumie.
    await mount();
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "top" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()?.login_position).toBe(AUTH_DEFAULTS.login_position);
  });

  it("para PL/EN zapisuje OBA języki niezależnie", async () => {
    await mount();
    const pl = screen.getByLabelText("adminLoginSettings.heroTitle (PL)");
    const en = screen.getByLabelText("adminLoginSettings.heroTitle (EN)");
    fireEvent.change(pl, { target: { value: "Wejdź" } });
    fireEvent.change(en, { target: { value: "Enter" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.savePayloads).toHaveLength(1));
    expect(lastPayload()).toMatchObject({ hero_title_pl: "Wejdź", hero_title_en: "Enter" });
  });

  it("błąd bazy jedzie KLUCZEM i18n, nie surowym komunikatem Postgresa", async () => {
    const { pgError } = await import("@/test/supabaseChain");
    h.saveError = pgError(
      'new row violates row-level security policy for table "site_settings"',
      "42501",
    );
    await mount();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminLoginSettings.errNoPermission"),
    );
    const shown = h.toastError.mock.calls.flat().join(" ");
    expect(shown).not.toContain("site_settings");
    expect(shown).not.toContain("row-level");
  });

  it("kolizja równoległego zapisu ma własny komunikat", async () => {
    const { pgError } = await import("@/test/supabaseChain");
    h.saveError = pgError("duplicate key value", "23505");
    await mount();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminLoginSettings.errConflict"),
    );
  });

  it("nieudany zapis nie pokazuje potwierdzenia", async () => {
    h.saveError = new Error("brak sieci");
    await mount();
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminLoginSettings.errGeneric"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("zapis w locie blokuje przycisk i zmienia jego napis", async () => {
    h.savePending = true;
    await mount();
    const button = screen.getByText("adminLoginSettings.saving");
    expect(button.closest("button")?.disabled).toBe(true);
  });
});

describe("reset do domyślnych", () => {
  it("reset przywraca domyślne w wersji roboczej, bez zapisu", async () => {
    h.query = {
      settings: { ...AUTH_DEFAULTS, hero_title_pl: "Zapisane" },
      isPending: false,
      isError: false,
      isConfigured: true,
    };
    await mount();
    const pl = screen.getByLabelText("adminLoginSettings.heroTitle (PL)");
    expect((pl as HTMLInputElement).value).toBe("Zapisane");

    fireEvent.click(screen.getByText("adminLoginSettings.reset"));
    await waitFor(() => expect((pl as HTMLInputElement).value).toBe(AUTH_DEFAULTS.hero_title_pl));
    // Reset jest LOKALNY - dopóki nikt nie kliknął „Zapisz", baza jest nietknięta.
    expect(h.savePayloads).toEqual([]);
  });
});
