// Karta „Organizacja” w kroku 1 edytora wpisu.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. WYBÓR FIRMY ZAPISUJE MIGAWKĘ, NIE SAMO ID. Publiczny render wpisu NIE MA
//     JAK dołączyć `crm_companies` - tę tabelę czyta wyłącznie staff CRM. Gdyby
//     karta zapisała tylko `organization_id`, czytelnik zobaczyłby wpis bez
//     nazwy i logo organizacji, a redakcja nie miałaby jak tego zauważyć
//     (w panelu, gdzie jest się staffem, wszystko wygląda dobrze).
//
//  2. PATCH JEST ATOMOWY. Cztery osobne `set()` dałyby cztery wpisy w historii
//     undo i cztery renderowania, z których każde może wpaść w debounce
//     autozapisu osobno - autozapis utrwaliłby stan pośredni (nowe id ze starą
//     nazwą), czyli wpis podpisany inną firmą, niż wybrał redaktor.
//
//  3. ODŚWIEŻENIE MIGAWKI NIGDY NIE KASUJE ATRYBUCJI. Firma usunięta z CRM albo
//     przemianowana nie może wyczyścić podpisu na OPUBLIKOWANYM wpisie -
//     migawka jest dowodem stanu z chwili publikacji. Nieudane odświeżenie ma
//     się skończyć komunikatem, nie utratą danych.
//
//  4. IZOLACJA NAJEMCY. Katalog czytamy przez `search_companies_public`
//     (SECURITY DEFINER zawężony do najemcy z profilu), nigdy zapytaniem na
//     `crm_companies`; bez tenanta w kontekście nie pytamy wcale.
//
// Asercje idą po KLUCZACH i18n - copy pilnują osobne bramki parytetu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EDITOR_IDS, postForm } from "@/test/post-editor/fixtures";
import type { PostForm } from "../../types";
import type { OrganizationSelection } from "../organizationDirectory";

/** Identyfikatory organizacji - kolumna `posts.organization_id` jest typu uuid. */
const ORG_A = "550e8400-e29b-41d4-a716-446655440000";
const ORG_B = "660e8400-e29b-41d4-a716-446655440001";

interface SelectProps {
  value?: string;
  onValueChange?: (next: string) => void;
}

interface DialogProps {
  open: boolean;
  currentId: string | null;
  currentName: string | null;
  onSelect: (selection: OrganizationSelection) => void;
  onOpenChange: (open: boolean) => void;
}

const h = vi.hoisted(() => ({
  auth: { current: { user: { id: "user-me" }, tenantId: "tenant" as string | null } },
  rpc: vi.fn(),
  toast: null as unknown,
  select: { current: null as SelectProps | null },
  dialog: { current: null as DialogProps | null },
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

// Radixowy <Select> nie daje się otworzyć w happy-dom (mierzy pozycję i używa
// pointer eventów), a testowana reguła siedzi w `onValueChange`, nie w Radiksie.
// Atrapa oddaje NATYWNY <select> z tymi samymi opcjami i zapisuje propsy, żeby
// dało się też odtworzyć wybór opcji, która zniknęła z odświeżonej listy.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({ value, onValueChange, children }: SelectProps & { children?: React.ReactNode }) => {
      h.select.current = { value, onValueChange };
      return React.createElement(
        "select",
        {
          value,
          onChange: (event: { target: { value: string } }) => onValueChange?.(event.target.value),
        },
        children as never,
      );
    },
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children as never),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) =>
      React.createElement("option", { value }, children as never),
  };
});

// Dialog wyboru ma WŁASNY plik testowy - tutaj liczy się tylko to, z czym jest
// wołany i co karta robi z jego wynikiem.
vi.mock("../OrganizationPickerDialog", async () => {
  const React = await import("react");
  return {
    OrganizationPickerDialog: (props: DialogProps) => {
      h.dialog.current = props;
      if (!props.open) return null;
      return React.createElement(
        "button",
        {
          type: "button",
          onClick: () =>
            props.onSelect({
              id: ORG_B,
              name: "Beta Instytut",
              logoUrl: "https://cdn.example/beta.png",
              website: "https://beta.example",
            }),
        },
        "atrapa-wybierz-z-dialogu",
      );
    },
  };
});

import { PostOrganizationPicker } from "../PostOrganizationPicker";

type ToastStub = ReturnType<typeof import("@/test/post-editor/fixtures").toastStub>;
const toasts = () => h.toast as ToastStub;

/** Wiersz `search_companies_public` w kształcie sprawdzanym przez schemat. */
function catalogRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORG_A,
    name: "ACME Europe",
    website: "https://acme.example",
    logo_url: "https://cdn.example/acme.png",
    country: "Belgia",
    city: "Bruksela",
    branch: "Energia",
    ...overrides,
  };
}

function renderPicker(overrides: Partial<PostForm> = {}) {
  const onPatch = vi.fn();
  const form = postForm(overrides);
  const view = renderWithQueryClient(
    <TooltipProvider>
      <PostOrganizationPicker form={form} onPatch={onPatch} />
    </TooltipProvider>,
  );
  return { onPatch, form, ...view };
}

/** Domyka mikrozadania `useQuery`, gdy test nie czeka na widoczny skutek. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: EDITOR_IDS.tenant };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.select.current = null;
  h.dialog.current = null;
  const toast = toasts();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("droplista katalogu", () => {
  it("nie odpytuje katalogu, dopóki nie znamy najemcy", async () => {
    // Zapytanie bez kontekstu najemcy nie miałoby czego zawęzić - RPC zawęża po
    // profilu, ale pusty tenant w kluczu cache zatruwałby wpis dla wszystkich.
    // (Cichy pusty katalog w tym stanie opisuje defekt D2 - patrz raport
    // i SWIADEK DEFEKTU w teście dialogu wyboru.)
    h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: null };
    renderPicker();
    await settle();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("czyta katalog przez RPC `search_companies_public` z limitem droplisty", async () => {
    // Nie `from('crm_companies')`: tę tabelę czyta wyłącznie staff CRM, więc
    // rola `author` dostałaby zero wierszy niezależnie od stanu bazy.
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "ACME Europe" })).toBeInTheDocument(),
    );
    expect(h.rpc).toHaveBeenCalledWith("search_companies_public", { _query: "", _limit: 50 });
  });

  it("odpowiedź o KSZTAŁCIE spoza schematu daje pustą listę, nie awarię karty", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: [{ id: "nie-uuid", name: "Zła firma" }], error: null });
    renderPicker();

    await settle();
    await waitFor(() => expect(err).toHaveBeenCalled());
    expect(screen.queryByRole("option", { name: "Zła firma" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "adminPostPanes.organization.none" }),
    ).toBeInTheDocument();
    err.mockRestore();
  });

  // SWIADEK DEFEKTU (D3, patrz raport). Poprawne jest to, że padnięte zapytanie
  // o listę NIE wygląda jak odpięcie firmy od wpisu (migawka zostaje w opcjach).
  // Niepoprawne jest to, że o samej awarii katalogu redakcja nie dowiaduje się
  // NICZEGO: droplista nie ma stanu błędu (dialog obok - ma), więc puste opcje
  // czyta się jako „w CRM nie ma firm”. Test opisuje stan OBECNY.
  it("błąd katalogu nie gubi przypisanej organizacji, ale też o niczym nie informuje", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc down") });
    renderPicker({ organization_id: ORG_A, organization_name: "ACME Europe" });

    await settle();
    expect(screen.getByRole("option", { name: "ACME Europe" })).toBeInTheDocument();
    expect(toasts().error).not.toHaveBeenCalled();
    expect(screen.queryByText("adminPostPanes.organization.searchFailed")).not.toBeInTheDocument();
  });

  it("odpowiedź BEZ danych (null) to pusty katalog, nie awaria", async () => {
    // PostgREST oddaje `data: null` przy zerowym wyniku funkcji - to nie błąd,
    // więc kontrolka ma się wyrenderować z samą opcją „brak organizacji”.
    h.rpc.mockResolvedValue({ data: null, error: null });
    renderPicker();
    await settle();

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(
      screen.getByRole("option", { name: "adminPostPanes.organization.none" }),
    ).toBeInTheDocument();
  });

  it("pokazuje opcję „brak organizacji” nawet przy pustym katalogu", async () => {
    renderPicker();
    await settle();
    expect(
      screen.getByRole("option", { name: "adminPostPanes.organization.none" }),
    ).toBeInTheDocument();
  });

  it("dokłada przypisaną organizację z MIGAWKI, gdy wypadła z katalogu", async () => {
    // Firma może być poza pierwszymi 50 wynikami albo już usunięta z CRM.
    // Pusta wartość w kontrolce wyglądałaby jak utrata danych i zapraszała do
    // „naprawy” przez ponowny wybór - czyli do nadpisania cudzej atrybucji.
    h.rpc.mockResolvedValue({
      data: [catalogRow({ id: ORG_B, name: "Beta Instytut" })],
      error: null,
    });
    renderPicker({ organization_id: ORG_A, organization_name: "ACME Europe" });

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "ACME Europe" })).toBeInTheDocument(),
    );
    expect(h.select.current?.value).toBe(ORG_A);
  });

  it("bez nazwy w migawce opcja pokazuje identyfikator, nie puste miejsce", async () => {
    renderPicker({ organization_id: ORG_A, organization_name: null });
    await settle();
    expect(screen.getByRole("option", { name: ORG_A })).toBeInTheDocument();
  });

  it("nie duplikuje opcji, gdy przypisana firma JEST w katalogu", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    renderPicker({ organization_id: ORG_A, organization_name: "ACME Europe" });

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getAllByRole("option", { name: "ACME Europe" })).toHaveLength(1);
  });

  it("bez przypisanej organizacji kontrolka stoi na wartości „brak”", async () => {
    renderPicker({ organization_id: null });
    await settle();
    expect(h.select.current?.value).toBe("__none__");
  });
});

describe("wybór organizacji", () => {
  it("zapisuje MIGAWKĘ (nazwa, logo, www), nie tylko identyfikator", async () => {
    // Reguła 1 nagłówka: publiczny render nie ma jak dołączyć `crm_companies`.
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    const { onPatch } = renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "ACME Europe" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ORG_A } });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_logo_url: "https://cdn.example/acme.png",
      organization_website: "https://acme.example",
    });
  });

  it("przycina białe znaki i zamienia puste pola CRM na NULL, nie pusty napis", async () => {
    // Pusty napis w `organization_website` wyrenderowałby czytelnikowi link
    // prowadzący w nikąd; NULL jest jednoznacznym „nie podano”.
    h.rpc.mockResolvedValue({
      data: [catalogRow({ name: "  ACME Europe  ", website: "   ", logo_url: "" })],
      error: null,
    });
    const { onPatch } = renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "ACME Europe" })).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: ORG_A } });

    expect(onPatch).toHaveBeenCalledWith({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_logo_url: null,
      organization_website: null,
    });
  });

  it("wybór „brak organizacji” czyści CAŁĄ migawkę jednym patchem", async () => {
    // Zostawienie nazwy przy wyzerowanym id dałoby wpis podpisany firmą, której
    // w atrybucji już nie ma - i której nikt nie umie usunąć z panelu.
    const { onPatch } = renderPicker({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_logo_url: "https://cdn.example/acme.png",
      organization_website: "https://acme.example",
    });
    await settle();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__none__" } });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({
      organization_id: null,
      organization_name: null,
      organization_logo_url: null,
      organization_website: null,
    });
  });

  it("wybór opcji nieobecnej w liście nie zapisuje NICZEGO", async () => {
    // Lista mogła się odświeżyć między otwarciem kontrolki a kliknięciem.
    // Zapisanie samego id (bez migawki) byłoby tu najgorszym wyjściem.
    const { onPatch } = renderPicker();
    await settle();

    act(() => {
      h.select.current?.onValueChange?.("770e8400-e29b-41d4-a716-446655440002");
    });

    expect(onPatch).not.toHaveBeenCalled();
  });
});

describe("karta przypisanej organizacji", () => {
  it("nie pokazuje się, dopóki wpis nie ma organizacji", async () => {
    renderPicker({ organization_id: null });
    await settle();
    expect(
      screen.queryByRole("button", { name: /adminPostPanes\.organization\.detach/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /adminPostPanes\.organization\.refreshSnapshot/ }),
    ).not.toBeInTheDocument();
  });

  it("pokazuje nazwę, adres www i logo z migawki (a nie z CRM)", async () => {
    renderPicker({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_website: "https://acme.example",
      organization_logo_url: "https://cdn.example/acme.png",
    });
    await settle();

    // Nazwa pada też w droplistie, więc pytamy o KARTĘ migawki (tę z odpięciem).
    const card = screen
      .getByRole("button", { name: /adminPostPanes\.organization\.detach/ })
      .closest("div");
    expect(card).toHaveTextContent("ACME Europe");
    expect(card).toHaveTextContent("https://acme.example");
    const logo = screen.getByRole("img", { name: "adminPostPanes.organization.logoAlt" });
    expect(logo).toHaveAttribute("src", "https://cdn.example/acme.png");
  });

  it("brak logo daje ikonę zastępczą, nie zepsuty obrazek", async () => {
    renderPicker({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_logo_url: null,
    });
    await settle();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("brak nazwy w migawce pokazuje kreskę zamiast pustego wiersza", async () => {
    renderPicker({ organization_id: ORG_A, organization_name: null });
    await settle();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("brak adresu www nie renderuje pustej linii", async () => {
    renderPicker({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_website: null,
    });
    await settle();
    expect(screen.queryByText("https://acme.example")).not.toBeInTheDocument();
  });

  it("odpięcie organizacji zeruje wszystkie cztery kolumny naraz", async () => {
    const { onPatch } = renderPicker({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
      organization_website: "https://acme.example",
    });
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /adminPostPanes\.organization\.detach/ }));

    expect(onPatch).toHaveBeenCalledWith({
      organization_id: null,
      organization_name: null,
      organization_logo_url: null,
      organization_website: null,
    });
  });
});

describe("odświeżenie migawki", () => {
  /** Ostatnie wywołanie RPC - pierwsze należy do droplisty. */
  function lastRpcArgs(): Record<string, unknown> {
    const calls = h.rpc.mock.calls;
    return calls[calls.length - 1][1] as Record<string, unknown>;
  }

  async function clickRefresh(overrides: Partial<PostForm>) {
    const view = renderPicker(overrides);
    await settle();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /adminPostPanes\.organization\.refreshSnapshot/ }),
      );
    });
    return view;
  }

  it("zawęża zapytanie NAZWĄ z migawki, żeby nie ciągnąć całego katalogu", async () => {
    // `search_companies_public` filtruje `name ILIKE '%…%'`, więc nazwa własnej
    // firmy oddaje garść wierszy zamiast pięciuset. Dopasowanie i tak idzie po
    // `id` - nazwa jest tylko zawężeniem i może być w CRM już zmieniona.
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    await clickRefresh({ organization_id: ORG_A, organization_name: "  ACME Europe  " });

    expect(lastRpcArgs()).toEqual({ _query: "ACME Europe", _limit: 100 });
  });

  it("bez nazwy w migawce pyta pustą frazą, zamiast wysyłać „null”", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    await clickRefresh({ organization_id: ORG_A, organization_name: null });

    expect(lastRpcArgs()).toEqual({ _query: "", _limit: 100 });
  });

  it("przepisuje AKTUALNE dane z CRM (nowa nazwa, nowe logo) jednym patchem", async () => {
    h.rpc.mockResolvedValue({
      data: [
        catalogRow({
          name: "  ACME Europe SA  ",
          logo_url: "  https://cdn.example/nowe.png  ",
          website: "  https://acme.example/new  ",
        }),
      ],
      error: null,
    });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({
      organization_id: ORG_A,
      organization_name: "ACME Europe SA",
      organization_logo_url: "https://cdn.example/nowe.png",
      organization_website: "https://acme.example/new",
    });
    expect(toasts().success).toHaveBeenCalledWith("adminPostPanes.organization.refreshed");
  });

  it("puste pola w CRM po odświeżeniu zapisuje jako NULL", async () => {
    h.rpc.mockResolvedValue({
      data: [catalogRow({ logo_url: "   ", website: null })],
      error: null,
    });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({ organization_logo_url: null, organization_website: null }),
    );
  });

  it("firma usunięta z CRM NIE kasuje atrybucji opublikowanego wpisu", async () => {
    // Reguła 3 nagłówka. Migawka jest dowodem stanu z chwili publikacji -
    // czytelnik zobaczył ten podpis, więc odświeżenie ma go zachować.
    h.rpc.mockResolvedValue({ data: [], error: null });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.searchFailed");
    expect(toasts().success).not.toHaveBeenCalled();
  });

  it("wynik z innym identyfikatorem nie podmienia firmy pod wpisem", async () => {
    // Nazwa mogła trafić w INNĄ firmę o podobnej nazwie - dopasowanie po `id`
    // jest jedynym bezpiecznym kryterium.
    h.rpc.mockResolvedValue({
      data: [catalogRow({ id: ORG_B, name: "ACME Europe" })],
      error: null,
    });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.searchFailed");
  });

  it("błąd RPC pokazuje komunikat, a nie ciszę ani utratę migawki", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc down") });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.searchFailed");
  });

  it("odpowiedź BEZ danych (null) traktuje jako brak trafienia, nie jako pustą firmę", async () => {
    // Zapisanie migawki z pustymi polami byłoby tu najgorszym wyjściem: wpis
    // straciłby nazwę organizacji, choć w CRM nic się nie zmieniło.
    h.rpc.mockResolvedValue({ data: null, error: null });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.searchFailed");
  });

  it("odpowiedź o złym kształcie nie kasuje migawki", async () => {
    h.rpc.mockResolvedValue({ data: [{ id: "nie-uuid" }], error: null });
    const { onPatch } = await clickRefresh({
      organization_id: ORG_A,
      organization_name: "ACME Europe",
    });

    expect(onPatch).not.toHaveBeenCalled();
    expect(toasts().error).toHaveBeenCalledWith("adminPostPanes.organization.searchFailed");
  });
});

describe("dialog wyboru", () => {
  it("startuje zamknięty i otwiera się przyciskiem wyboru", async () => {
    renderPicker();
    await settle();
    expect(h.dialog.current?.open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /adminPostPanes\.organization\.pick/ }));

    await waitFor(() => expect(h.dialog.current?.open).toBe(true));
    expect(screen.getByText("atrapa-wybierz-z-dialogu")).toBeInTheDocument();
  });

  it("dostaje aktualne id i nazwę - dialog ma zaznaczyć wybraną firmę i podpowiedzieć frazę", async () => {
    renderPicker({ organization_id: ORG_A, organization_name: "ACME Europe" });
    await settle();

    expect(h.dialog.current?.currentId).toBe(ORG_A);
    expect(h.dialog.current?.currentName).toBe("ACME Europe");
  });

  it("wybór w dialogu zapisuje migawkę TYM SAMYM atomowym patchem", async () => {
    const { onPatch } = renderPicker();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /adminPostPanes\.organization\.pick/ }));
    await waitFor(() => expect(screen.getByText("atrapa-wybierz-z-dialogu")).toBeInTheDocument());

    fireEvent.click(screen.getByText("atrapa-wybierz-z-dialogu"));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({
      organization_id: ORG_B,
      organization_name: "Beta Instytut",
      organization_logo_url: "https://cdn.example/beta.png",
      organization_website: "https://beta.example",
    });
  });
});

describe("opis powierzchni", () => {
  it("tytuł, podpowiedź i dymek o migawce są brane z i18n", async () => {
    // Dymek tłumaczy redakcji, DLACZEGO dane firmy są kopiowane na wpis - bez
    // tego „odśwież migawkę” wygląda na przycisk bez znaczenia.
    renderPicker();
    await settle();

    expect(screen.getByText("adminPostPanes.organization.title")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.organization.hint")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "adminPostPanes.organization.snapshotHint" }),
    ).toBeInTheDocument();
  });
});
