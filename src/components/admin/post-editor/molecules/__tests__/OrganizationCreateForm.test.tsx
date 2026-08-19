// Formularz zakładania organizacji w CRM (tryb „create” dialogu wyboru).
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. MIGAWKA POCHODZI Z BAZY, NIE Z FORMULARZA. `create_company_self_service`
//     jest IDEMPOTENTNE po (tenant_id, name_norm): gdy firma o tej nazwie już
//     istnieje, RPC oddaje JEJ id i NIE nadpisuje pól. Zaufanie temu, co
//     redakcja wpisała, dałoby wpis z adresem, którego w CRM nie ma - dwa
//     źródła prawdy o jednej organizacji i podpis pod artykułem niezgodny
//     z rekordem, na który wskazuje `organization_id`.
//
//  2. BŁĄD DRUGIEGO KROKU NIE MOŻE BYĆ ZJEDZONY. Zapis to utworzenie firmy plus
//     odczyt kanonicznego wiersza; osobno pilnujemy, że nieudany zapis kończy
//     się KOMUNIKATEM (nie cichym „utworzono”) i że `onCreated` wtedy nie leci -
//     inaczej dialog zamyka się z fałszywym sukcesem, a wpis zostaje bez
//     organizacji. Ta klasa defektu była już naprawiana w profilu.
//
//  3. KAŻDE POLE MA ETYKIETĘ POWIĄZANĄ Z KONTROLKĄ (`htmlFor` -> `id`). Bez tego
//     czytnik ekranu czyta dziewięć nieopisanych pól, a klik w etykietę nie
//     ustawia kursora.
//
//  4. LOGO IDZIE JEDYNĄ DOZWOLONĄ ŚCIEŻKĄ UPLOADU (walidacja MIME -> storage ->
//     rejestr, ze sprzątaniem obiektu przy odrzuceniu) i JAWNĄ allowlistą bez
//     SVG. Ręcznie składany upload zostawiał odrzucone SVG żywe pod publicznym
//     URL-em = stored XSS.
//
// Asercje idą po KLUCZACH i18n - copy pilnują osobne bramki parytetu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";
import { IMAGE_MIME } from "@/lib/media/upload";
import type { OrganizationSelection } from "../organizationDirectory";

const ORG_ID = "550e8400-e29b-41d4-a716-446655440000";

const h = vi.hoisted(() => ({
  auth: {
    current: { user: { id: "user-me" } as { id: string } | null, tenantId: "t" as string | null },
  },
  rpc: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  toast: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args) },
}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

// Funkcja serwerowa rejestrująca plik w bibliotece mediów - w teście liczy się
// tylko to, że TA funkcja jest przekazana do wspólnej ścieżki uploadu.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.register,
}));

vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: { __serverFn: true } }));

// Allowlisty i atrybut `accept` zostają PRAWDZIWE (są przedmiotem asercji),
// podmieniamy tylko sam przepływ wgrywania - happy-dom nie ma storage.
vi.mock("@/lib/media/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/upload")>()),
  uploadAndRegisterMedia: (args: unknown) => h.upload(args),
}));

import { OrganizationCreateForm } from "../OrganizationCreateForm";

type ToastStub = ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;
const toasts = () => h.toast as ToastStub;

/** Wiersz `search_companies_public` - odczyt kanoniczny po zapisie. */
function catalogRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORG_ID,
    name: "ACME Europe",
    website: "https://acme.example",
    logo_url: "https://cdn.example/acme.png",
    country: "Belgia",
    city: "Bruksela",
    branch: "Energia",
    ...overrides,
  };
}

/** Domyślne zachowanie RPC: zapis się udaje, odczyt kanoniczny zwraca wiersz. */
function happyRpc(rowOverrides: Record<string, unknown> = {}) {
  h.rpc.mockImplementation((fn: string) => {
    if (fn === "create_company_self_service") return Promise.resolve({ data: ORG_ID, error: null });
    return Promise.resolve({ data: [catalogRow(rowOverrides)], error: null });
  });
}

function renderForm(initialName = "ACME Europe") {
  const onBack = vi.fn();
  const onCancel = vi.fn();
  const onCreated = vi.fn<(selection: OrganizationSelection) => void>();
  const view = renderWithQueryClient(
    <OrganizationCreateForm
      initialName={initialName}
      onBack={onBack}
      onCancel={onCancel}
      onCreated={onCreated}
    />,
  );
  return { onBack, onCancel, onCreated, ...view };
}

function field(key: string): HTMLInputElement {
  return screen.getByLabelText(`adminPostPanes.organization.fields.${key}`) as HTMLInputElement;
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function formEl(): HTMLFormElement {
  return document.querySelector("form") as HTMLFormElement;
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /adminPostPanes\.organization\.save/ });
}

/** Argumenty pierwszego wywołania RPC zakładającego firmę. */
function createArgs(): Record<string, unknown> {
  const call = h.rpc.mock.calls.find((c) => c[0] === "create_company_self_service");
  return (call?.[1] ?? {}) as Record<string, unknown>;
}

async function submitForm() {
  await act(async () => {
    fireEvent.submit(formEl());
  });
}

/** Podaje plik do ukrytego inputa (happy-dom nie pozwala pisać po `files`). */
async function pickLogo(file = new File(["x"], "logo.png", { type: "image/png" })) {
  const input = fileInput();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
  return file;
}

beforeEach(() => {
  h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: EDITOR_IDS.tenant };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.upload.mockReset();
  h.upload.mockResolvedValue({
    mediaId: "media-1",
    storagePath: "t/u/organizations/logo.png",
    publicUrl: "https://cdn.example/wgrane.png",
  });
  h.register.mockReset();
  const toast = toasts();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("dostępność i kształt formularza", () => {
  it("każde pole ma etykietę POWIĄZANĄ z kontrolką", () => {
    // Dziewięć pól bez `htmlFor` to dziewięć nieopisanych kontrolek dla czytnika
    // ekranu i etykiety, których klik nie ustawia kursora.
    renderForm();
    for (const key of [
      "name",
      "website",
      "domain",
      "branch",
      "country",
      "city",
      "postalCode",
      "address",
      "phone",
    ]) {
      const control = field(key);
      expect(control.tagName).toBe("INPUT");
      expect(control.id).toBeTruthy();
    }
  });

  it("startuje z nazwą podpowiedzianą z wyszukiwania", () => {
    renderForm("Nowa Fundacja");
    expect(field("name")).toHaveValue("Nowa Fundacja");
  });

  it("adres www i telefon mają typy semantyczne (klawiatura na telefonie)", () => {
    renderForm();
    expect(field("website")).toHaveAttribute("type", "url");
    expect(field("phone")).toHaveAttribute("type", "tel");
  });

  it("wybór pliku ma JAWNĄ allowlistę obrazów, bez SVG", () => {
    // Bucket `media` jest publiczny i serwuje bajty wprost, więc SVG z osadzonym
    // `<script>` byłoby stored XSS. `image/*` w `accept` zaprosiłoby do wgrania
    // typu, który platforma i tak odrzuca.
    renderForm();
    const accept = fileInput().getAttribute("accept") ?? "";
    expect(accept).toContain("image/png");
    expect(accept).toContain("image/webp");
    expect(accept).not.toContain("svg");
    expect(accept).not.toContain("image/*");
  });
});

describe("walidacja nazwy", () => {
  it("zapis jest wyłączony, dopóki nazwa jest pusta", () => {
    renderForm("");
    expect(saveButton()).toBeDisabled();
  });

  it("nazwa z samych białych znaków nie włącza zapisu", () => {
    renderForm("   ");
    expect(saveButton()).toBeDisabled();
  });

  it("wpisanie nazwy włącza zapis", () => {
    renderForm("");
    fireEvent.change(field("name"), { target: { value: "ACME" } });
    expect(saveButton()).toBeEnabled();
  });

  it("wysłanie formularza bez nazwy mówi o brakującym polu i NIE woła bazy", async () => {
    // Enter w polu tekstowym wysyła formularz nawet przy wyłączonym przycisku,
    // więc walidacja musi siedzieć w `submit`, nie tylko w atrybucie `disabled`.
    renderForm("   ");
    await submitForm();

    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.nameRequired");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("zapis firmy", () => {
  it("wysyła wypełnione pola, a puste POMIJA (nie jako pusty napis)", async () => {
    // RPC odczytuje brak parametru inaczej niż pusty napis: „” wpisałoby do
    // kolumn CRM puste teksty, które potem wyglądają jak wypełnione dane.
    happyRpc();
    renderForm("  ACME Europe  ");
    fireEvent.change(field("website"), { target: { value: "  https://acme.example  " } });
    fireEvent.change(field("city"), { target: { value: "Bruksela" } });
    await submitForm();

    await waitFor(() => expect(createArgs()._name).toBe("ACME Europe"));
    expect(createArgs()._website).toBe("https://acme.example");
    expect(createArgs()._city).toBe("Bruksela");
    expect(createArgs()._country).toBeUndefined();
    expect(createArgs()._phone).toBeUndefined();
    expect(createArgs()._domain).toBeUndefined();
    expect(createArgs()._address).toBeUndefined();
    expect(createArgs()._postal_code).toBeUndefined();
    expect(createArgs()._branch).toBeUndefined();
    expect(createArgs()._logo_url).toBeUndefined();
  });

  it("przekazuje wszystkie dziewięć pól, gdy redakcja je wypełni", async () => {
    happyRpc();
    renderForm("ACME Europe");
    fireEvent.change(field("website"), { target: { value: "https://acme.example" } });
    fireEvent.change(field("domain"), { target: { value: "acme.example" } });
    fireEvent.change(field("branch"), { target: { value: "Energia" } });
    fireEvent.change(field("country"), { target: { value: "Belgia" } });
    fireEvent.change(field("city"), { target: { value: "Bruksela" } });
    fireEvent.change(field("postalCode"), { target: { value: "1000" } });
    fireEvent.change(field("address"), { target: { value: "Rue de la Loi 1" } });
    fireEvent.change(field("phone"), { target: { value: "+32 2 000 00 00" } });
    await submitForm();

    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(createArgs()).toMatchObject({
      _name: "ACME Europe",
      _website: "https://acme.example",
      _domain: "acme.example",
      _branch: "Energia",
      _country: "Belgia",
      _city: "Bruksela",
      _postal_code: "1000",
      _address: "Rue de la Loi 1",
      _phone: "+32 2 000 00 00",
    });
  });

  it("unieważnia cache katalogu organizacji ORAZ listy firm w CRM", async () => {
    // Bez drugiego unieważnienia /admin/companies pokazywałoby stan sprzed
    // dodania, aż ktoś odświeży stronę - i redakcja założyłaby firmę dwa razy.
    happyRpc();
    const view = renderForm();
    const spy = vi.spyOn(view.queryClient, "invalidateQueries");
    await submitForm();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["post-organizations-search"]));
    expect(keys).toContain(JSON.stringify(["admin", "crm-companies"]));
  });

  it("oddaje MIGAWKĘ Z BAZY, a nie to, co redakcja wpisała", async () => {
    // Reguła 1 nagłówka: RPC jest idempotentne, więc przy istniejącej firmie
    // zwraca JEJ dane - i te muszą trafić na wpis.
    happyRpc({ name: "  ACME Europe SA  ", website: "  https://acme.example/eu  " });
    const { onCreated } = renderForm("ACME Europe");
    fireEvent.change(field("website"), { target: { value: "https://wpisane-przez-redakcje" } });
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith({
      id: ORG_ID,
      name: "ACME Europe SA",
      logoUrl: "https://cdn.example/acme.png",
      website: "https://acme.example/eu",
    });
    expect(toasts().success).toHaveBeenCalledWith("adminPostPanes.organization.created");
  });

  it("puste pola kanonicznego wiersza schodzą na NULL, nie na pusty napis", async () => {
    happyRpc({ logo_url: "   ", website: null });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: null, website: null }),
    );
  });

  it("gdy odczytu kanonicznego nie da się wykonać, przypisanie i tak działa", async () => {
    // Przypisanie organizacji nie może się wywrócić z powodu dodatkowego,
    // kosmetycznego odczytu - fallback bierze dane z formularza.
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: ORG_ID, error: null });
      return Promise.resolve({ data: null, error: new Error("rpc down") });
    });
    const { onCreated } = renderForm("  ACME Europe  ");
    fireEvent.change(field("website"), { target: { value: "https://acme.example" } });
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith({
      id: ORG_ID,
      name: "ACME Europe",
      logoUrl: null,
      website: "https://acme.example",
    });
  });

  it("kanoniczny wiersz o złym KSZTAŁCIE też schodzi na dane z formularza", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: ORG_ID, error: null });
      return Promise.resolve({ data: [{ id: "nie-uuid" }], error: null });
    });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORG_ID, name: "ACME Europe", website: null }),
    );
  });

  it("odczyt kanoniczny BEZ danych (null) schodzi na dane z formularza", async () => {
    // `data: null` bez błędu to poprawna, pusta odpowiedź funkcji - nie może
    // wywrócić przypisania świeżo utworzonej organizacji.
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: ORG_ID, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORG_ID, name: "ACME Europe" }),
    );
  });

  it("wynik bez naszego id schodzi na dane z formularza", async () => {
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service")
        return Promise.resolve({ data: ORG_ID, error: null });
      return Promise.resolve({
        data: [catalogRow({ id: "660e8400-e29b-41d4-a716-446655440001" })],
        error: null,
      });
    });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: ORG_ID }));
  });

  it("szuka kanonicznego wiersza po nazwie, z limitem odczytu", async () => {
    happyRpc();
    renderForm("ACME Europe");
    await submitForm();

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("search_companies_public", {
        _query: "ACME Europe",
        _limit: 100,
      }),
    );
  });
});

describe("obsługa błędu zapisu", () => {
  it("błąd RPC jest POKAZANY z treścią serwera i nie zamyka dialogu sukcesem", async () => {
    const error = new Error("duplicate key");
    error.name = "PostgrestError";
    h.rpc.mockResolvedValue({ data: null, error });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    const message = String(toasts().error.mock.calls[0][0]);
    expect(message).toContain("adminPostPanes.organization.createFailed");
    expect(message).toContain("duplicate key");
    expect(onCreated).not.toHaveBeenCalled();
    expect(toasts().success).not.toHaveBeenCalled();
  });

  it("pusta odpowiedź RPC to BŁĄD, nie cichy sukces", async () => {
    // Brak id znaczy, że firma nie powstała. Zamknięcie dialogu „sukcesem"
    // zostawiłoby wpis bez organizacji i bez śladu, że coś się nie udało.
    h.rpc.mockResolvedValue({ data: null, error: null });
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    expect(String(toasts().error.mock.calls[0][0])).toContain("empty_response");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("awaria niebędąca wyjątkiem nadal daje czytelny komunikat", async () => {
    // `catch` w TS dostaje dowolną rzuconą wartość - komunikat nie może wyjść
    // jako „[object Object]".
    h.rpc.mockRejectedValue("zerwane połączenie");
    const { onCreated } = renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    const message = String(toasts().error.mock.calls[0][0]);
    expect(message).toContain("adminPostPanes.organization.createFailed");
    expect(message).not.toContain("object Object");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("nieudany zapis pozwala spróbować ponownie (formularz nie zostaje zablokowany)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("chwilowo") });
    renderForm("ACME Europe");
    await submitForm();

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    expect(saveButton()).toBeEnabled();
  });

  it("nie zapisuje dwa razy przy podwójnym wysłaniu formularza", async () => {
    // Dwa równoległe zapisy dałyby dwa toasty i dwa `onCreated` - a przy
    // idempotentnym RPC także dwa odczyty kanoniczne bez powodu.
    let release: (v: { data: unknown; error: unknown }) => void = () => {};
    h.rpc.mockImplementation((fn: string) => {
      if (fn === "create_company_self_service") {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve({ data: [catalogRow()], error: null });
    });
    renderForm("ACME Europe");

    await submitForm();
    await submitForm();
    expect(saveButton()).toBeDisabled();

    await act(async () => {
      release({ data: ORG_ID, error: null });
    });
    expect(h.rpc.mock.calls.filter((c) => c[0] === "create_company_self_service")).toHaveLength(1);
  });
});

describe("logo organizacji", () => {
  it("przycisk „wgraj” otwiera ukryty wybór pliku", () => {
    const clicks = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    renderForm();

    fireEvent.click(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.logoUpload/ }),
    );

    expect(clicks).toHaveBeenCalled();
    clicks.mockRestore();
  });

  it("wgrywa JEDYNĄ dozwoloną ścieżką: allowlista obrazów, katalog organizacji, prefiks najemcy", async () => {
    // Ręczne składanie kroków zostawiało odrzucone pliki żywe w publicznym
    // buckecie (stored XSS). Ta funkcja sprząta obiekt przy odrzuconej
    // rejestracji - dlatego wywołanie MUSI iść przez nią.
    renderForm();
    const file = await pickLogo();

    expect(h.upload).toHaveBeenCalledTimes(1);
    const args = h.upload.mock.calls[0][0] as Record<string, unknown>;
    expect(args.file).toBe(file);
    expect(args.tenantId).toBe(EDITOR_IDS.tenant);
    expect(args.userId).toBe(EDITOR_IDS.user);
    expect(args.subfolder).toBe("organizations");
    expect(args.allowedMime).toEqual(IMAGE_MIME);
    expect(args.registerMedia).toBe(h.register);
  });

  it("wgrane logo pokazuje podgląd i zmienia etykietę na „podmień”", async () => {
    renderForm();
    await pickLogo();

    const preview = screen.getByRole("img", { name: "adminPostPanes.organization.logoAlt" });
    expect(preview).toHaveAttribute("src", "https://cdn.example/wgrane.png");
    expect(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.logoReplace/ }),
    ).toBeInTheDocument();
  });

  it("wgrane logo jedzie do RPC jako `_logo_url`", async () => {
    happyRpc();
    renderForm("ACME Europe");
    await pickLogo();
    await submitForm();

    await waitFor(() => expect(createArgs()._logo_url).toBe("https://cdn.example/wgrane.png"));
  });

  it("usunięcie logo czyści podgląd i nie wysyła adresu", async () => {
    happyRpc();
    renderForm("ACME Europe");
    await pickLogo();

    fireEvent.click(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.logoRemove/ }),
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await submitForm();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
    expect(createArgs()._logo_url).toBeUndefined();
  });

  it("odrzucony plik daje komunikat z powodem i NIE ustawia logo", async () => {
    h.upload.mockRejectedValue(new Error("Disallowed mime type"));
    renderForm();

    await pickLogo(new File(["<svg/>"], "zle.svg", { type: "image/svg+xml" }));

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    const message = String(toasts().error.mock.calls[0][0]);
    expect(message).toContain("adminPostPanes.organization.logoFailed");
    expect(message).toContain("Disallowed mime type");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("po nieudanym uploadzie można wybrać plik ponownie", async () => {
    // Formularz nie może zostać w stanie „wgrywanie" - zablokowałby zapis.
    h.upload.mockRejectedValue(new Error("padło"));
    renderForm();
    await pickLogo();

    await waitFor(() => expect(toasts().error).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.logoUpload/ }),
    ).toBeEnabled();
  });

  // SWIADEK DEFEKTU (D1, patrz raport). Brak tenanta/użytkownika w kontekście
  // powstrzymuje upload - i to jest poprawne, bo prefiks ścieżki w storage jest
  // budowany z tenanta, a plik bez niego wylądowałby poza przestrzenią najemcy.
  // NIEPOPRAWNE jest to, że wyjście jest CICHE: redaktor wybiera plik, nie
  // dostaje ani wskaźnika, ani komunikatu, i widzi formularz bez logo. Stan jest
  // osiągalny realnie (profil bez `tenant_id` = `tenantId` na stałe `null`),
  // nie tylko w wyścigu przy starcie. Testy opisują stan OBECNY.
  it("bez kontekstu najemcy upload nie startuje - i nic o tym nie mówi", async () => {
    h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: null };
    renderForm();
    await pickLogo();
    expect(h.upload).not.toHaveBeenCalled();
    expect(toasts().error).not.toHaveBeenCalled();
  });

  it("bez zalogowanego użytkownika upload nie startuje - i nic o tym nie mówi", async () => {
    h.auth.current = { user: null, tenantId: EDITOR_IDS.tenant };
    renderForm();
    await pickLogo();
    expect(h.upload).not.toHaveBeenCalled();
    expect(toasts().error).not.toHaveBeenCalled();
  });

  it("puste zdarzenie wyboru pliku nie odpala uploadu", async () => {
    // Anulowanie okna wyboru zgłasza `change` z pustą listą plików.
    renderForm();
    const input = fileInput();
    Object.defineProperty(input, "files", { value: [], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("w trakcie wgrywania formularz jest zamknięty na zapis i nawigację", async () => {
    // Zapis w połowie uploadu utworzyłby firmę BEZ logo, a redaktor widziałby
    // kręcący się wskaźnik i myślał, że logo się doda.
    h.upload.mockReturnValue(new Promise(() => {}));
    renderForm("ACME Europe");
    await pickLogo();

    expect(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.logoUploading/ }),
    ).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.back/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled();

    await submitForm();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("nawigacja formularza", () => {
  it("„wróć” prowadzi do listy wyszukiwania, nie zamyka dialogu", () => {
    const { onBack, onCancel } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /adminPostPanes\.organization\.back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("„anuluj” zamyka cały dialog", () => {
    const { onBack, onCancel } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu nie da się wyjść z formularza", async () => {
    h.rpc.mockReturnValue(new Promise(() => {}));
    renderForm("ACME Europe");
    await submitForm();

    expect(
      screen.getByRole("button", { name: /adminPostPanes\.organization\.back/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled();
  });
});
