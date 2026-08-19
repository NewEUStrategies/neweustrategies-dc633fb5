// Dialog wyboru organizacji dla wpisu (szukanie w katalogu CRM + przejście do
// zakładania brakującej firmy).
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. KATALOG CZYTAMY RPC-em, ZAWSZE ZAWĘŻONYM DO NAJEMCY. `crm_companies` ma
//     polityki staff-only, więc rola `author` zobaczyłaby przez zwykły select
//     ZERO firm - „wybierz z listy” nie działałoby dla połowy redakcji. Bez
//     tenanta w kontekście nie pytamy wcale, bo wpis w cache bez tenanta
//     obsługiwałby wszystkich najemców tym samym wynikiem.
//
//  2. WYBÓR ODDAJE MIGAWKĘ (id + nazwa + logo + www), NIE SAMO ID. Publiczny
//     render wpisu nie ma jak dołączyć `crm_companies`, więc brak migawki =
//     wpis bez podpisu organizacji u czytelnika.
//
//  3. DOKŁADNE TRAFIENIE BLOKUJE PROPOZYCJĘ ZAKŁADANIA. Gdyby „Utwórz «ACME»”
//     pokazywało się przy istniejącej „ACME”, redakcja robiłaby duplikaty firm
//     w CRM zamiast wybierać jedną - a duplikaty rozjeżdżają atrybucję wpisów
//     między dwa rekordy tej samej organizacji.
//
//  4. WYNIK O ZŁYM KSZTAŁCIE DAJE PUSTĄ LISTĘ, NIE AWARIĘ. RPC oddaje kolumny
//     wyliczone w SQL-u, których TypeScript nie sprawdza.
//
// Asercje idą po KLUCZACH i18n - copy pilnują osobne bramki parytetu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { EDITOR_IDS } from "@/test/post-editor/fixtures";
import type { OrganizationSelection } from "../organizationDirectory";

const ORG_A = "550e8400-e29b-41d4-a716-446655440000";
const ORG_B = "660e8400-e29b-41d4-a716-446655440001";

/** Migawka, którą oddaje atrapa formularza zakładania. */
const CREATED: OrganizationSelection = {
  id: ORG_B,
  name: "Nowa Fundacja",
  logoUrl: null,
  website: "https://nowa.example",
};

const h = vi.hoisted(() => ({
  auth: { current: { user: { id: "user-me" }, tenantId: "tenant" as string | null } },
  rpc: vi.fn(),
  createForm: { current: null as { initialName: string } | null },
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args) },
}));

// Formularz zakładania ma WŁASNY plik testowy (dziewięć pól, upload, zapis).
// Tutaj dowodzimy tylko KOMPOZYCJI: z jaką nazwą startuje i co dialog robi
// z jego trzema wyjściami (powrót / anulowanie / utworzono).
vi.mock("../OrganizationCreateForm", async () => {
  const React = await import("react");
  return {
    OrganizationCreateForm: (props: {
      initialName: string;
      onBack: () => void;
      onCancel: () => void;
      onCreated: (selection: OrganizationSelection) => void;
    }) => {
      h.createForm.current = { initialName: props.initialName };
      return React.createElement(
        "div",
        null,
        React.createElement("output", null, `nazwa-startowa:${props.initialName}`),
        React.createElement("button", { type: "button", onClick: props.onBack }, "atrapa-powrot"),
        React.createElement("button", { type: "button", onClick: props.onCancel }, "atrapa-anuluj"),
        React.createElement(
          "button",
          { type: "button", onClick: () => props.onCreated(CREATED) },
          "atrapa-utworzono",
        ),
      );
    },
  };
});

import { OrganizationPickerDialog } from "../OrganizationPickerDialog";

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

type DialogProps = React.ComponentProps<typeof OrganizationPickerDialog>;

function renderDialog(props: Partial<DialogProps> = {}) {
  const onSelect = props.onSelect ?? vi.fn();
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const full: DialogProps = {
    open: true,
    currentId: null,
    currentName: null,
    ...props,
    onSelect,
    onOpenChange,
  };
  const view = renderWithQueryClient(<OrganizationPickerDialog {...full} />);
  /** Ponowne osadzenie z tym samym klientem - do testów otwierania/zamykania. */
  const remount = (next: Partial<DialogProps>) =>
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <OrganizationPickerDialog {...full} {...next} />
      </QueryClientProvider>,
    );
  return { onSelect, onOpenChange, remount, ...view };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function searchField(): HTMLElement {
  return screen.getByLabelText("adminPostPanes.organization.searchPlaceholder");
}

async function typeQuery(value: string) {
  fireEvent.change(searchField(), { target: { value } });
  await settle();
}

function createSuggestion(): HTMLElement | null {
  return screen.queryByRole("button", { name: /adminPostPanes\.organization\.createNamed/ });
}

beforeEach(() => {
  h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: EDITOR_IDS.tenant };
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: [], error: null });
  h.createForm.current = null;
});

describe("bramki zapytania", () => {
  it("nie pyta o katalog, gdy dialog jest zamknięty", async () => {
    // Karta edytora trzyma dialog stale zamontowany - odpytywanie przy każdym
    // renderze wpisu byłoby zapytaniem na każde naciśnięcie klawisza w tytule.
    renderDialog({ open: false });
    await settle();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  // SWIADEK DEFEKTU (D2, patrz raport). Wstrzymanie zapytania bez tenanta jest
  // poprawne (wpis w cache bez tenanta obsługiwałby wszystkich najemców tym
  // samym wynikiem), ale KOMUNIKAT dla redakcji jest wtedy nieprawdziwy: dialog
  // mówi „wpisz frazę”/„brak wyników”, czyli „w CRM nic nie ma”, choć katalogu
  // po prostu NIE DA SIĘ odczytać. Stan jest osiągalny realnie: profil bez
  // `tenant_id` daje `tenantId === null` na stałe. Test opisuje stan OBECNY.
  it("nie pyta o katalog bez znanego najemcy - i pokazuje pusty stan zamiast błędu", async () => {
    h.auth.current = { user: { id: EDITOR_IDS.user }, tenantId: null };
    renderDialog();
    await typeQuery("ACME");

    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.getByText("adminPostPanes.organization.noMatches")).toBeInTheDocument();
    expect(screen.queryByText("adminPostPanes.organization.searchFailed")).not.toBeInTheDocument();
  });

  it("pyta dopiero po otwarciu dialogu", async () => {
    const { remount } = renderDialog({ open: false });
    await settle();
    remount({ open: true });
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
  });

  it("szuka przez `search_companies_public` z limitem listy w dialogu", async () => {
    renderDialog();
    await typeQuery("ACME");
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("search_companies_public", {
        _query: "ACME",
        _limit: 12,
      }),
    );
  });

  it("przycina frazę przed wysłaniem do bazy", async () => {
    renderDialog();
    await typeQuery("   ACME   ");
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("search_companies_public", {
        _query: "ACME",
        _limit: 12,
      }),
    );
  });
});

describe("otwarcie dialogu", () => {
  it("podpowiada nazwę już przypisanej firmy jako frazę wyszukiwania", async () => {
    // Redaktor otwiera dialog, żeby ZMIENIĆ firmę - startowanie od pustego pola
    // kazałoby mu przepisywać nazwę, którą wpis już ma.
    renderDialog({ currentName: "ACME Europe" });
    await settle();
    expect(searchField()).toHaveValue("ACME Europe");
  });

  it("bez przypisanej firmy pole startuje puste", async () => {
    renderDialog({ currentName: null });
    await settle();
    expect(searchField()).toHaveValue("");
  });

  it("ustawia kursor w polu wyszukiwania - można pisać bez klikania", async () => {
    renderDialog();
    await waitFor(() => expect(searchField()).toHaveFocus());
  });

  it("ponowne otwarcie wraca do trybu wyszukiwania, nie do formularza zakładania", async () => {
    // Inaczej dialog otwarty po nieudanym zakładaniu pokazywałby formularz
    // z poprzednią treścią, a nie listę firm.
    const { remount } = renderDialog();
    await typeQuery("Nowa Fundacja");
    await waitFor(() => expect(createSuggestion()).toBeInTheDocument());
    fireEvent.click(createSuggestion()!);
    expect(screen.getByText("nazwa-startowa:Nowa Fundacja")).toBeInTheDocument();

    remount({ open: false });
    remount({ open: true });

    await waitFor(() => expect(searchField()).toBeInTheDocument());
    expect(screen.queryByText("atrapa-powrot")).not.toBeInTheDocument();
  });
});

describe("stany listy wyników", () => {
  it("w trakcie ładowania NIE proponuje jeszcze zakładania firmy", async () => {
    // Reguła 3: propozycja przed wynikami zapraszałaby do duplikatu, bo nie
    // wiemy jeszcze, czy taka firma w CRM jest.
    h.rpc.mockReturnValue(new Promise(() => {}));
    renderDialog();
    await typeQuery("ACME");

    expect(createSuggestion()).not.toBeInTheDocument();
    expect(screen.queryByText("adminPostPanes.organization.noMatches")).not.toBeInTheDocument();
  });

  it("błąd zapytania jest POKAZANY, nie zjedzony jako „brak wyników”", async () => {
    // Cichy pusty stan kazałby redakcji zakładać duplikat firmy, która w CRM
    // jest - tylko właśnie nie dało się jej odczytać.
    h.rpc.mockResolvedValue({ data: null, error: new Error("rpc down") });
    renderDialog();
    await typeQuery("ACME");

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.searchFailed")).toBeInTheDocument(),
    );
    expect(screen.queryByText("adminPostPanes.organization.noMatches")).not.toBeInTheDocument();
  });

  it("puste pole zachęca do wpisania frazy, a nie mówi „brak wyników”", async () => {
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.startTyping")).toBeInTheDocument(),
    );
  });

  it("fraza bez trafień mówi „brak wyników”", async () => {
    renderDialog();
    await typeQuery("Nieistniejąca");
    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.noMatches")).toBeInTheDocument(),
    );
  });

  it("odpowiedź BEZ danych (null) to pusta lista, nie błąd", async () => {
    // PostgREST oddaje `data: null` dla zerowego wyniku funkcji - to poprawna
    // odpowiedź, więc redakcja ma dostać „brak wyników”, a nie komunikat awarii.
    h.rpc.mockResolvedValue({ data: null, error: null });
    renderDialog();
    await typeQuery("ACME");

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.noMatches")).toBeInTheDocument(),
    );
    expect(screen.queryByText("adminPostPanes.organization.searchFailed")).not.toBeInTheDocument();
  });

  it("odpowiedź o KSZTAŁCIE spoza schematu daje pustą listę, nie awarię dialogu", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpc.mockResolvedValue({ data: [{ id: "nie-uuid", name: "Zła firma" }], error: null });
    renderDialog();
    await typeQuery("Zła");

    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.noMatches")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Zła firma")).not.toBeInTheDocument();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("pokazuje metadane firmy jednym wierszem (miasto · kraj · branża)", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    renderDialog();
    await typeQuery("ACME");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    expect(screen.getByText("Bruksela · Belgia · Energia")).toBeInTheDocument();
  });

  it("pomija brakujące metadane, zamiast zostawiać puste separatory", async () => {
    h.rpc.mockResolvedValue({
      data: [catalogRow({ city: null, branch: null })],
      error: null,
    });
    renderDialog();
    await typeQuery("ACME");

    await waitFor(() => expect(screen.getByText("Belgia")).toBeInTheDocument());
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("firma bez żadnych metadanych pokazuje tylko nazwę", async () => {
    h.rpc.mockResolvedValue({
      data: [catalogRow({ city: null, country: null, branch: null })],
      error: null,
    });
    renderDialog();
    await typeQuery("ACME");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    const row = screen.getByText("ACME Europe").closest("button");
    expect(row).toHaveTextContent("ACME Europe");
    expect(row?.textContent).not.toContain("·");
  });

  it("logo firmy ma PUSTY tekst alternatywny - nazwa jest już w wierszu", async () => {
    // Alt z nazwą kazałby czytnikowi ekranu przeczytać firmę dwa razy.
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    const { container } = renderDialog();
    await typeQuery("ACME");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    const logo = container.ownerDocument.querySelector("img");
    expect(logo).toHaveAttribute("src", "https://cdn.example/acme.png");
    expect(logo).toHaveAttribute("alt", "");
  });

  it("firma bez logo dostaje ikonę zastępczą, nie zepsuty obrazek", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow({ logo_url: null })], error: null });
    const { container } = renderDialog();
    await typeQuery("ACME");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    expect(container.ownerDocument.querySelector("img")).toBeNull();
  });

  it("oznacza AKTUALNIE przypisaną firmę dla czytnika ekranu", async () => {
    h.rpc.mockResolvedValue({
      data: [catalogRow(), catalogRow({ id: ORG_B, name: "Beta Instytut" })],
      error: null,
    });
    renderDialog({ currentId: ORG_A, currentName: null });
    await typeQuery("a");

    await waitFor(() => expect(screen.getByText("Beta Instytut")).toBeInTheDocument());
    expect(screen.getByText("ACME Europe").closest("button")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("Beta Instytut").closest("button")).not.toHaveAttribute("aria-current");
  });
});

describe("wybór firmy z listy", () => {
  it("oddaje MIGAWKĘ danych prezentacyjnych i zamyka dialog", async () => {
    // Reguła 2 nagłówka: bez migawki publiczny render nie ma skąd wziąć nazwy.
    h.rpc.mockResolvedValue({ data: [catalogRow()], error: null });
    const { onSelect, onOpenChange } = renderDialog();
    await typeQuery("ACME");
    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());

    fireEvent.click(screen.getByText("ACME Europe"));

    expect(onSelect).toHaveBeenCalledWith({
      id: ORG_A,
      name: "ACME Europe",
      logoUrl: "https://cdn.example/acme.png",
      website: "https://acme.example",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("przycina wartości i zamienia puste pola CRM na NULL", async () => {
    h.rpc.mockResolvedValue({
      data: [catalogRow({ name: "  ACME Europe  ", logo_url: "   ", website: "" })],
      error: null,
    });
    const { onSelect } = renderDialog();
    await typeQuery("ACME");
    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());

    fireEvent.click(screen.getByText("ACME Europe"));

    expect(onSelect).toHaveBeenCalledWith({
      id: ORG_A,
      name: "ACME Europe",
      logoUrl: null,
      website: null,
    });
  });

  it("przycisk anulowania zamyka dialog bez wyboru", async () => {
    const { onSelect, onOpenChange } = renderDialog();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("propozycja założenia nowej firmy", () => {
  it("pojawia się, gdy fraza NIE pasuje do żadnej firmy - z nazwą w etykiecie", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow({ name: "Inna firma" })], error: null });
    renderDialog();
    await typeQuery("Nowa Fundacja");

    await waitFor(() => expect(createSuggestion()).toBeInTheDocument());
    // Klucz i18n dostaje nazwę parametrem - redaktor widzi, CO utworzy.
    expect(createSuggestion()?.textContent).toContain("Nowa Fundacja");
  });

  it("NIE pojawia się przy dokładnym trafieniu (reguła anty-duplikatowa)", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow({ name: "ACME Europe" })], error: null });
    renderDialog();
    await typeQuery("ACME Europe");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    expect(createSuggestion()).not.toBeInTheDocument();
  });

  it("dopasowanie ignoruje wielkość liter i białe znaki na brzegach", async () => {
    h.rpc.mockResolvedValue({ data: [catalogRow({ name: "  ACME Europe  " })], error: null });
    renderDialog();
    await typeQuery("  acme europe  ");

    await waitFor(() => expect(screen.getByText("ACME Europe")).toBeInTheDocument());
    expect(createSuggestion()).not.toBeInTheDocument();
  });

  it("NIE pojawia się przy pustej frazie - nie da się utworzyć firmy bez nazwy", async () => {
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("adminPostPanes.organization.startTyping")).toBeInTheDocument(),
    );
    expect(createSuggestion()).not.toBeInTheDocument();
  });

  it("nie pojawia się dla frazy z samych białych znaków", async () => {
    renderDialog();
    await typeQuery("    ");
    expect(createSuggestion()).not.toBeInTheDocument();
  });
});

describe("tryb zakładania firmy", () => {
  async function enterCreateMode(name = "Nowa Fundacja") {
    const view = renderDialog();
    await typeQuery(name);
    await waitFor(() => expect(createSuggestion()).toBeInTheDocument());
    fireEvent.click(createSuggestion()!);
    return view;
  }

  it("przekazuje formularzowi PRZYCIĘTĄ frazę jako nazwę startową", async () => {
    await enterCreateMode("  Nowa Fundacja  ");
    expect(h.createForm.current?.initialName).toBe("Nowa Fundacja");
  });

  it("podmienia tytuł i opis dialogu na wariant „zakładanie”", async () => {
    await enterCreateMode();
    expect(screen.getByText("adminPostPanes.organization.dialogCreateTitle")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.organization.dialogCreateDesc")).toBeInTheDocument();
    expect(
      screen.queryByText("adminPostPanes.organization.dialogPickTitle"),
    ).not.toBeInTheDocument();
  });

  it("tytuł i opis wariantu wyszukiwania wracają po powrocie z formularza", async () => {
    await enterCreateMode();
    fireEvent.click(screen.getByText("atrapa-powrot"));

    expect(screen.getByText("adminPostPanes.organization.dialogPickTitle")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.organization.dialogPickDesc")).toBeInTheDocument();
    // Fraza się nie gubi - redaktor wraca do tych samych wyników.
    expect(searchField()).toHaveValue("Nowa Fundacja");
  });

  it("anulowanie w formularzu zamyka CAŁY dialog, nie tylko formularz", async () => {
    const { onOpenChange } = await enterCreateMode();
    fireEvent.click(screen.getByText("atrapa-anuluj"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("utworzona firma zostaje od razu przypisana do wpisu i dialog się zamyka", async () => {
    // Dwa kroki (utworzenie w CRM + przypisanie do wpisu) muszą się domknąć bez
    // drugiego kliknięcia - inaczej redakcja zakłada firmę i zapomina ją wybrać.
    const { onSelect, onOpenChange } = await enterCreateMode();
    fireEvent.click(screen.getByText("atrapa-utworzono"));

    expect(onSelect).toHaveBeenCalledWith(CREATED);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
