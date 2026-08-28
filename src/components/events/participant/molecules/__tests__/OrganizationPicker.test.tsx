// WYBÓR ORGANIZACJI w profilu uczestnika - jedyna droga do własnej firmy dla
// kogoś, kto nie ma i nie ma mieć dostępu do panelu admina.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. KATALOG ODPYTUJEMY DOPIERO OD DWÓCH ZNAKÓW. `useCompanySearch` ma
//     `enabled: key.length >= 2`; zgubienie tego warunku znaczy jedno zapytanie
//     RPC na każdy naciśnięty klawisz, a przy pierwszej literze - listę całego
//     katalogu firm najemcy.
//
//  2. TRZY RÓŻNE ODPOWIEDZI KATALOGU MAJĄ TRZY RÓŻNE ZDANIA: trwa szukanie,
//     nic nie znaleziono, oto wyniki. Zlanie ich w jedno („brak wyników"
//     w trakcie zapytania) uczy uczestnika, że wyszukiwarka nie działa, i pcha
//     go do zakładania duplikatu istniejącej kartoteki.
//
//  3. WYBÓR Z LISTY ODDAJE IDENTYFIKATOR KARTOTEKI, WPISANIE TEKSTU GO CZYŚCI.
//     `company_id` bez zgodnego `company_text` to profil wskazujący na firmę,
//     której nazwa mówi co innego - a identyfikator jedzie do zapisu profilu.
//
//  4. ZAKŁADANIE ORGANIZACJI ZAPISUJE TO, CO WIDAĆ, PO OBCIĘCIU BIAŁYCH ZNAKÓW,
//     i BIERZE MIGAWKĘ Z BAZY, nie z formularza: `crm_company_create_self` jest
//     idempotentne po nazwie, więc przy istniejącej firmie oddaje JEJ wiersz.
//     Zaufanie własnemu formularzowi dałoby w profilu nazwę, której w CRM nie ma.
//
//  5. NIEUDANY ZAPIS NIE MOŻE ZJEŚĆ PRACY. Okno zostaje otwarte z wpisanymi
//     polami, a trwający zapis odcina przycisk - drugie kliknięcie to druga
//     kartoteka tej samej organizacji.
//
// Asercje idą po KLUCZACH i18n (parytetu PL/EN pilnują osobne bramki
// słownikowe). Radixowy Dialog jest podmieniony na natywny odpowiednik -
// happy-dom nie ma pełnego pointer API, którego wymaga portal Radixa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  auth: {
    current: { user: { id: "u-1" } as { id: string } | null, tenantId: "t-1" as string | null },
  },
  rpc: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

// Nakładka słownikowa dociąga cały stos i18next; w teście liczy się wyłącznie
// to, że komponent umie ją wywołać.
vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth.current }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => h.rpc(fn, args) },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.register }));

vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: { __serverFn: true } }));

// Allowlisty i atrybut `accept` zostają PRAWDZIWE - podmieniamy wyłącznie samo
// wgrywanie, bo happy-dom nie ma storage.
vi.mock("@/lib/media/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/upload")>()),
  uploadAndRegisterMedia: (args: unknown) => h.upload(args),
}));

vi.mock("@/components/ui/dialog", () => {
  const stan = { open: false };
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => {
      stan.open = open;
      return <div>{children}</div>;
    },
    DialogContent: ({ children }: { children?: ReactNode }) =>
      stan.open ? <div role="dialog">{children}</div> : null,
    DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  };
});

const { OrganizationPicker } =
  await import("@/components/events/participant/molecules/OrganizationPicker");

const ORG = "550e8400-e29b-41d4-a716-446655440000";
const INNA_ORG = "660e8400-e29b-41d4-a716-446655440001";
const ETYKIETA = "eventMe.fields.company";
const BAZA = "eventMe.organization";

/** Wiersz `crm_company_search` w kształcie, który parsuje `parseCompanyOption`. */
function firma(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORG,
    name: "ACME Europe",
    logo_url: "https://cdn.example/acme.png",
    city: "Bruksela",
    country: "Belgia",
    branch: "Energia",
    website: "https://acme.example",
    ...over,
  };
}

/** Odpowiedzi RPC per nazwa funkcji - jeden klient obsługuje trzy zapytania. */
function rpcMap(map: Record<string, unknown>) {
  h.rpc.mockImplementation((fn: string) => {
    const value = map[fn];
    if (value instanceof Promise) return value;
    if (typeof value === "function") return (value as () => unknown)();
    return Promise.resolve(value ?? { data: null, error: null });
  });
}

/**
 * Rodzic trzyma stan wyboru, tak jak `MyEventProfileForm` - inaczej wpisany
 * tekst nigdy nie wróciłby do pola i połowa gałęzi byłaby nieosiągalna.
 */
function Harness({
  initialName = "",
  initialId = null,
  onPick,
}: {
  initialName?: string;
  initialId?: string | null;
  onPick?: (company: { id: string | null; name: string }) => void;
}) {
  const [wybor, setWybor] = useState<{ id: string | null; name: string }>({
    id: initialId,
    name: initialName,
  });
  return (
    <OrganizationPicker
      label={ETYKIETA}
      value={wybor.name}
      companyId={wybor.id}
      onChange={(company) => {
        setWybor(company);
        onPick?.(company);
      }}
    />
  );
}

function renderPicker(props: Parameters<typeof Harness>[0] = {}) {
  const onPick = vi.fn<(company: { id: string | null; name: string }) => void>();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness {...props} onPick={onPick} />
    </QueryClientProvider>,
  );
  return { ...view, onPick };
}

const pole = () => screen.getByLabelText(ETYKIETA) as HTMLInputElement;
const lista = () => screen.queryByRole("listbox");
const dodaj = () => screen.getByRole("button", { name: `${BAZA}.add` });
const zapisz = () => screen.getByRole("button", { name: new RegExp(`${BAZA}\\.(save|saving)`) });
const polePopupu = (klucz: string) =>
  screen.getByLabelText(`${BAZA}.fields.${klucz}`) as HTMLInputElement;
const plikLogo = () => screen.getByLabelText(`${BAZA}.logoUpload`) as HTMLInputElement;
// Strefa upuszczania logo nie ma roli dostępnej i mieć jej nie musi: dostępną
// ścieżką jest przycisk wyboru pliku obok, a przeciąganie to skrót dla myszy.
// Dlatego wyjątkowo szukamy jej po kreskowanej ramce, która ją wyróżnia.
const strefaLogo = () => document.querySelector('[class*="border-dashed"]') as HTMLElement;

/** Wpisuje frazę i przepuszcza mikrozadania react-query. */
async function wpisz(value: string) {
  await act(async () => {
    fireEvent.change(pole(), { target: { value } });
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function nigdy(): Promise<never> {
  return new Promise<never>(() => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.current = { user: { id: "u-1" }, tenantId: "t-1" };
  rpcMap({});
});

describe("OrganizationPicker - kiedy podpowiedzi w ogóle się pokazują", () => {
  it("pole BEZ FOKUSU nie pokazuje listy podpowiedzi", () => {
    // Lista wisząca nad formularzem od pierwszego renderu zasłania kolejne pole.
    renderPicker({ initialName: "ACME Europe", initialId: ORG });
    expect(lista()).not.toBeInTheDocument();
  });

  it("JEDEN ZNAK nie odpytuje katalogu i nie otwiera listy", async () => {
    // `enabled: key.length >= 2` jest jedynym hamulcem między pisaniem
    // a wywołaniem RPC na każdy klawisz.
    renderPicker();
    await wpisz("A");
    expect(lista()).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_search", expect.anything());
  });

  it("SAME SPACJE nie są frazą - lista zostaje zamknięta", async () => {
    renderPicker();
    await wpisz("   ");
    expect(lista()).not.toBeInTheDocument();
  });

  it("DWA ZNAKI otwierają listę i pytają katalog o wpisany fragment", async () => {
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    renderPicker();
    await wpisz("AC");

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("crm_company_search", { p_query: "AC", p_limit: 10 });
  });

  it("POWRÓT do pola odsłania podpowiedzi bez ponownego pisania", async () => {
    // Uczestnik, który kliknął obok i wrócił, nie może zostać z pustym polem
    // podpowiedzi - inaczej zaczyna pisać od nowa i gubi wybraną firmę.
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    const { onPick } = renderPicker();
    await wpisz("ACME");
    fireEvent.blur(pole());
    await waitFor(() => expect(lista()).not.toBeInTheDocument());

    fireEvent.focus(pole());
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    // Sam fokus niczego nie wybiera - to tylko odsłonięcie podpowiedzi.
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("opuszczenie pola ZAMYKA listę, żeby nie zasłaniała reszty formularza", async () => {
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    renderPicker();
    await wpisz("AC");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    fireEvent.blur(pole());
    await waitFor(() => expect(lista()).not.toBeInTheDocument());
  });
});

describe("OrganizationPicker - trzy odpowiedzi katalogu, trzy różne zdania", () => {
  it("W TRAKCIE zapytania widać stan szukania, a nie brak wyników", async () => {
    // Komunikat „nic nie znaleziono" pokazany zanim baza odpowie pcha
    // uczestnika do zakładania duplikatu istniejącej kartoteki.
    rpcMap({ crm_company_search: () => nigdy() });
    renderPicker();
    await wpisz("AC");

    expect(await screen.findByText(`${BAZA}.searching`)).toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.noResults`)).not.toBeInTheDocument();
  });

  it("PUSTA odpowiedź katalogu mówi wprost, że nic nie znaleziono", async () => {
    rpcMap({ crm_company_search: { data: [], error: null } });
    renderPicker();
    await wpisz("Zzz");

    expect(await screen.findByText(`${BAZA}.noResults`)).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("BŁĄD zapytania nie zostawia wiszącego stanu szukania", async () => {
    // Odmowa RPC (brak sesji, brak najemcy) kończy zapytanie; ekran nie może
    // zostać z kręcącym się kółkiem, bo uczestnik czekałby bez końca.
    rpcMap({ crm_company_search: { data: null, error: { message: "forbidden" } } });
    renderPicker();
    await wpisz("AC");

    await waitFor(() => expect(screen.queryByText(`${BAZA}.searching`)).not.toBeInTheDocument());
    expect(screen.getByText(`${BAZA}.noResults`)).toBeInTheDocument();
  });

  it("WYNIKI pokazują nazwę i podpis złożony z miasta, kraju i branży", async () => {
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    renderPicker();
    await wpisz("AC");

    const opcja = await screen.findByRole("option");
    expect(within(opcja).getByText("ACME Europe")).toBeInTheDocument();
    expect(within(opcja).getByText("Bruksela · Belgia · Energia")).toBeInTheDocument();
    expect(screen.queryByText(`${BAZA}.noResults`)).not.toBeInTheDocument();
  });

  it("firma BEZ miasta, kraju i branży nie rysuje pustego podpisu", async () => {
    // Bez warunku na pusty podpis karta dostawałaby drugą, pustą linię -
    // i dwie firmy o tej samej nazwie wyglądałyby na różne.
    rpcMap({
      crm_company_search: {
        data: [firma({ city: null, country: null, branch: null })],
        error: null,
      },
    });
    renderPicker();
    await wpisz("AC");

    const opcja = await screen.findByRole("option");
    expect(within(opcja).getByText("ACME Europe")).toBeInTheDocument();
    expect(within(opcja).queryByText(/·/)).not.toBeInTheDocument();
  });

  it("firma BEZ logotypu dostaje ikonę zastępczą, a nie pękniętego obrazka", async () => {
    rpcMap({ crm_company_search: { data: [firma({ logo_url: null })], error: null } });
    renderPicker();
    await wpisz("AC");

    const opcja = await screen.findByRole("option");
    expect(opcja.querySelector("img")).toBeNull();
  });

  it("firma Z logotypem pokazuje go przy nazwie", async () => {
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    renderPicker();
    await wpisz("AC");

    const opcja = await screen.findByRole("option");
    expect(opcja.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/acme.png");
  });

  it("AKTUALNY wybór jest oznaczony na liście, pozostałe pozycje nie", async () => {
    // Bez tego uczestnik z już wybraną firmą nie widzi, którą ma, i klika
    // w pierwszą z brzegu. Rodzic w tym teście TRZYMA identyfikator mimo
    // pisania - to jego decyzja i molekuła ma ją uszanować.
    rpcMap({
      crm_company_search: {
        data: [firma(), firma({ id: INNA_ORG, name: "ACME Polska" })],
        error: null,
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function StalyWybor() {
      const [nazwa, setNazwa] = useState("");
      return (
        <OrganizationPicker
          label={ETYKIETA}
          value={nazwa}
          companyId={ORG}
          onChange={(company) => setNazwa(company.name)}
        />
      );
    }
    render(
      <QueryClientProvider client={client}>
        <StalyWybor />
      </QueryClientProvider>,
    );
    await wpisz("ACME");

    const opcje = await screen.findAllByRole("option");
    expect(opcje[0]).toHaveAttribute("aria-selected", "true");
    expect(opcje[1]).toHaveAttribute("aria-selected", "false");
  });
});

describe("OrganizationPicker - wybór i jego czyszczenie", () => {
  it("WYBÓR Z LISTY oddaje identyfikator i nazwę z KARTOTEKI, nie wpisany tekst", async () => {
    // Zapisujemy `company_id` razem z `company_text`; wzięcie nazwy z pola
    // dałoby profil wskazujący na kartotekę o innej nazwie niż widoczna.
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    const { onPick } = renderPicker();
    await wpisz("AC");
    const opcja = await screen.findByRole("option");
    // Wciśnięcie myszy na pozycji NIE MOŻE zabrać fokusu polu: `onBlur` zamyka
    // listę po 150 ms, więc bez `preventDefault` kliknięcie lądowałoby w pustce.
    const wcisniecie = fireEvent.mouseDown(opcja);
    expect(wcisniecie).toBe(false);
    fireEvent.click(opcja);

    expect(onPick).toHaveBeenLastCalledWith({ id: ORG, name: "ACME Europe" });
    expect(pole().value).toBe("ACME Europe");
  });

  it("po wyborze lista SIĘ ZAMYKA i fraza wyszukiwania jest kasowana", async () => {
    // Zostawiona fraza otworzyłaby listę ponownie przy następnym fokusie
    // i podpowiadała firmy do wpisu, który już został rozstrzygnięty.
    rpcMap({ crm_company_search: { data: [firma()], error: null } });
    renderPicker();
    await wpisz("AC");
    fireEvent.click(await screen.findByRole("option"));

    await waitFor(() => expect(lista()).not.toBeInTheDocument());
    fireEvent.focus(pole());
    expect(lista()).not.toBeInTheDocument();
  });

  it("WPISANIE TEKSTU po wyborze CZYŚCI identyfikator kartoteki", async () => {
    // Zostawiony `company_id` znaczyłby: profil wskazuje na ACME, a podpisuje
    // się nazwą, którą uczestnik właśnie przepisał.
    rpcMap({ crm_company_search: { data: [], error: null } });
    const { onPick } = renderPicker({ initialName: "ACME Europe", initialId: ORG });
    await wpisz("Fundacja X");

    expect(onPick).toHaveBeenLastCalledWith({ id: null, name: "Fundacja X" });
  });

  it("SKASOWANIE pola oddaje pustą nazwę i brak identyfikatora", async () => {
    rpcMap({ crm_company_search: { data: [], error: null } });
    const { onPick } = renderPicker({ initialName: "ACME Europe", initialId: ORG });
    await wpisz("");

    expect(onPick).toHaveBeenLastCalledWith({ id: null, name: "" });
    expect(lista()).not.toBeInTheDocument();
  });
});

describe("OrganizationPicker - logotyp wybranej firmy z CRM", () => {
  it("logotyp z kartoteki widać obok pola, gdy CRM go zna", async () => {
    rpcMap({
      crm_company_brand: {
        data: { id: ORG, name: "ACME Europe", logo_url: "https://cdn.example/acme.png" },
        error: null,
      },
    });
    renderPicker({ initialName: "ACME Europe", initialId: ORG });

    const logo = await screen.findByAltText("ACME Europe");
    expect(logo.getAttribute("src")).toBe("https://cdn.example/acme.png");
  });

  it("firma BEZ kartoteki brandowej nie rysuje pustego obrazka", async () => {
    rpcMap({ crm_company_brand: { data: null, error: null } });
    renderPicker({ initialName: "Firma bez CRM" });

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("crm_company_brand", { p_name: "Firma bez CRM" }),
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("pusta nazwa firmy NIE odpytuje CRM o brand", () => {
    // Zapytanie o brand pustej nazwy to jedno wywołanie RPC na każdy profil
    // bez organizacji - czyli na większość świeżych zgłoszeń.
    renderPicker();
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_brand", expect.anything());
  });
});

describe("OrganizationPicker - zakładanie brakującej organizacji", () => {
  it("okno startuje z nazwą przepisaną z pola, po obcięciu białych znaków", async () => {
    // „Mojej firmy nie ma na liście" jest dosłownie kontynuacją tego, co
    // uczestnik właśnie wpisał; puste pole nazwy kazałoby mu pisać drugi raz.
    rpcMap({ crm_company_search: { data: [], error: null } });
    renderPicker();
    await wpisz("  Fundacja Wschód  ");
    fireEvent.click(dodaj());

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(polePopupu("name").value).toBe("Fundacja Wschód");
  });

  it("PUSTA nazwa nie woła bazy - mówi, czego brakuje", () => {
    renderPicker();
    fireEvent.click(dodaj());
    fireEvent.click(zapisz());

    expect(h.error).toHaveBeenCalledWith(`${BAZA}.nameRequired`);
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_create_self", expect.anything());
  });

  it("SAME SPACJE to nadal brak nazwy", () => {
    // Bez obcięcia białych znaków w CRM powstałaby kartoteka o nazwie „   ",
    // której nikt później nie wyszuka.
    renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "    " } });
    fireEvent.click(zapisz());

    expect(h.error).toHaveBeenCalledWith(`${BAZA}.nameRequired`);
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_create_self", expect.anything());
  });

  it("ZAPIS wysyła wszystkie dziewięć pól po obcięciu białych znaków", async () => {
    rpcMap({
      crm_company_create_self: { data: [firma({ name: "Fundacja Wschód" })], error: null },
    });
    renderPicker();
    fireEvent.click(dodaj());

    const dane: Record<string, string> = {
      name: "  Fundacja Wschód  ",
      branch: "  Kultura  ",
      address: "  Krucza 1  ",
      city: "  Warszawa  ",
      postalCode: "  00-001  ",
      country: "  Polska  ",
      phone: "  +48 22 000 00 00  ",
      email: "  biuro@fundacja.example  ",
      website: "  https://fundacja.example  ",
    };
    for (const [klucz, wartosc] of Object.entries(dane)) {
      fireEvent.change(polePopupu(klucz), { target: { value: wartosc } });
    }
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith("crm_company_create_self", {
        p_name: "Fundacja Wschód",
        p_logo_url: "",
        p_address: "Krucza 1",
        p_city: "Warszawa",
        p_postal_code: "00-001",
        p_country: "Polska",
        p_phone: "+48 22 000 00 00",
        p_email: "biuro@fundacja.example",
        p_website: "https://fundacja.example",
        p_branch: "Kultura",
      }),
    );
  });

  it("MIGAWKA po zapisie pochodzi Z BAZY, nie z formularza", async () => {
    // RPC jest idempotentne po nazwie: przy istniejącej firmie oddaje JEJ
    // wiersz i NIE nadpisuje pól. Zaufanie formularzowi dałoby w profilu nazwę,
    // której w CRM nie ma.
    rpcMap({
      crm_company_create_self: {
        data: [firma({ id: INNA_ORG, name: "ACME Europe" })],
        error: null,
      },
    });
    const { onPick } = renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "acme europe" } });
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(onPick).toHaveBeenLastCalledWith({ id: INNA_ORG, name: "ACME Europe" }),
    );
    expect(h.success).toHaveBeenCalledWith(`${BAZA}.created`);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("gdy baza NIE ODDA wiersza, zostaje wpisana nazwa i brak identyfikatora", async () => {
    // Pusta odpowiedź RPC nie może skasować pracy uczestnika - nazwa zostaje
    // w profilu jako wolny tekst, a `company_id` pozostaje pusty.
    rpcMap({ crm_company_create_self: { data: [], error: null } });
    const { onPick } = renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "  Fundacja Wschód  " } });
    fireEvent.click(zapisz());

    await waitFor(() =>
      expect(onPick).toHaveBeenLastCalledWith({ id: null, name: "Fundacja Wschód" }),
    );
  });

  it("BŁĄD zapisu zostawia okno otwarte z wpisanymi danymi", async () => {
    // Zamknięte okno po błędzie znaczy „utworzono" - a wpis zostaje bez
    // organizacji i bez śladu, co poszło nie tak.
    rpcMap({
      crm_company_create_self: { data: null, error: { message: "duplicate name" } },
    });
    const { onPick } = renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "Fundacja Wschód" } });
    fireEvent.change(polePopupu("city"), { target: { value: "Warszawa" } });
    fireEvent.click(zapisz());

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(`${BAZA}.createError duplicate name`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(polePopupu("name").value).toBe("Fundacja Wschód");
    expect(polePopupu("city").value).toBe("Warszawa");
    expect(onPick).not.toHaveBeenCalled();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("TRWAJĄCY zapis odcina przycisk - drugie kliknięcie to druga kartoteka", async () => {
    rpcMap({ crm_company_create_self: () => nigdy() });
    renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "Fundacja Wschód" } });
    fireEvent.click(zapisz());

    await waitFor(() => expect(zapisz()).toBeDisabled());
    expect(screen.getByRole("button", { name: `${BAZA}.saving` })).toBeInTheDocument();
    fireEvent.click(zapisz());
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("ANULOWANIE zamyka okno bez jednego zapytania do bazy", () => {
    renderPicker();
    fireEvent.click(dodaj());
    fireEvent.change(polePopupu("name"), { target: { value: "Fundacja Wschód" } });
    fireEvent.click(screen.getByRole("button", { name: `${BAZA}.cancel` }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalledWith("crm_company_create_self", expect.anything());
  });
});

describe("OrganizationPicker - logotyp zakładanej organizacji", () => {
  /** Podaje plik ukrytemu inputowi (happy-dom nie pozwala pisać po `files`). */
  async function podajLogo(file = new File(["x"], "logo.png", { type: "image/png" })) {
    const input = plikLogo();
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });
    return file;
  }

  it("wgrywanie BEZ najemcy w kontekście kończy się komunikatem, nie ciszą", async () => {
    // Bez `tenantId` plik trafiłby w nieokreślone miejsce w storage; cicha
    // porażka zostawiłaby uczestnika z kafelkiem, który nigdy się nie wypełnia.
    h.auth.current = { user: { id: "u-1" }, tenantId: null };
    renderPicker();
    fireEvent.click(dodaj());
    await podajLogo();

    expect(h.error).toHaveBeenCalledWith(`${BAZA}.logoFailed`);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("wgrywanie BEZ zalogowanego użytkownika też się zatrzymuje", async () => {
    h.auth.current = { user: null, tenantId: "t-1" };
    renderPicker();
    fireEvent.click(dodaj());
    await podajLogo();

    expect(h.error).toHaveBeenCalledWith(`${BAZA}.logoFailed`);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("wgrane logo pojawia się w oknie i JEDZIE do bazy razem z resztą pól", async () => {
    h.upload.mockResolvedValue({ publicUrl: "https://cdn.example/nowe.png" });
    rpcMap({ crm_company_create_self: { data: [firma()], error: null } });
    renderPicker();
    fireEvent.click(dodaj());
    await podajLogo();

    expect(await screen.findByAltText(`${BAZA}.logoAlt`)).toHaveAttribute(
      "src",
      "https://cdn.example/nowe.png",
    );
    // Plik idzie JEDYNĄ dozwoloną ścieżką: walidacja MIME, katalog firm CRM.
    expect(h.upload).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t-1", userId: "u-1", subfolder: "crm-companies" }),
    );

    fireEvent.change(polePopupu("name"), { target: { value: "Fundacja Wschód" } });
    fireEvent.click(zapisz());
    await waitFor(() =>
      expect(h.rpc).toHaveBeenCalledWith(
        "crm_company_create_self",
        expect.objectContaining({ p_logo_url: "https://cdn.example/nowe.png" }),
      ),
    );
  });

  it("USUNIĘCIE logo wraca do ikony zastępczej", async () => {
    h.upload.mockResolvedValue({ publicUrl: "https://cdn.example/nowe.png" });
    renderPicker();
    fireEvent.click(dodaj());
    await podajLogo();
    expect(await screen.findByAltText(`${BAZA}.logoAlt`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `${BAZA}.logoRemove` }));
    expect(screen.queryByAltText(`${BAZA}.logoAlt`)).not.toBeInTheDocument();
  });

  it("NIEUDANE wgranie mówi, co się stało, i nie podmienia kafelka", async () => {
    h.upload.mockRejectedValue(new Error("plik za duży"));
    renderPicker();
    fireEvent.click(dodaj());
    await podajLogo();

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(`${BAZA}.logoFailed plik za duży`));
    expect(screen.queryByAltText(`${BAZA}.logoAlt`)).not.toBeInTheDocument();
  });

  it("ANULOWANY wybór pliku (pusta lista) nie uruchamia wgrywania", async () => {
    renderPicker();
    fireEvent.click(dodaj());
    const input = plikLogo();
    Object.defineProperty(input, "files", { value: [], configurable: true });
    await act(async () => {
      fireEvent.change(input);
    });

    expect(h.upload).not.toHaveBeenCalled();
  });

  it("UPUSZCZENIE pliku na kafelek idzie tą samą ścieżką co wybór z dysku", async () => {
    h.upload.mockResolvedValue({ publicUrl: "https://cdn.example/drop.png" });
    renderPicker();
    fireEvent.click(dodaj());
    expect(screen.queryByAltText(`${BAZA}.logoAlt`)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.dragOver(strefaLogo());
      fireEvent.drop(strefaLogo(), {
        dataTransfer: { files: [new File(["x"], "drop.png", { type: "image/png" })] },
      });
    });

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText(`${BAZA}.logoAlt`)).toHaveAttribute(
      "src",
      "https://cdn.example/drop.png",
    );
  });

  it("upuszczenie BEZ pliku (samo przeciągnięcie tekstu) niczego nie wgrywa", async () => {
    // `dataTransfer.files[0] === undefined` to zwykły przypadek: przeciągnięty
    // zaznaczony tekst albo odnośnik. Bez warunku poszłoby wgrywanie `undefined`.
    renderPicker();
    fireEvent.click(dodaj());
    await act(async () => {
      fireEvent.dragOver(strefaLogo());
      fireEvent.dragLeave(strefaLogo());
      fireEvent.drop(strefaLogo(), { dataTransfer: { files: [] } });
    });

    expect(h.upload).not.toHaveBeenCalled();
  });

  it("przycisk wgrywania OTWIERA wybór pliku i jest odcięty w trakcie wgrywania", async () => {
    h.upload.mockImplementation(() => nigdy());
    renderPicker();
    fireEvent.click(dodaj());

    const otworz = screen.getByRole("button", { name: `${BAZA}.logoUpload` });
    const klik = vi.spyOn(plikLogo(), "click");
    fireEvent.click(otworz);
    expect(klik).toHaveBeenCalledTimes(1);

    await podajLogo();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: `${BAZA}.logoUpload` })).toBeDisabled(),
    );
  });
});
