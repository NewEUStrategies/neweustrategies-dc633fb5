// Picker członka tenanta - kontrakt wyszukiwania, wyboru i izolacji danych.
//
// PO CO TEN PLIK ISTNIEJE. `MemberPicker` jest jedynym wejściem do wskazania
// OSOBY w panelu administracyjnym: przyznanie odznaki, dopisanie prelegenta,
// nadanie uprawnień w klubie, wyciszenie w moderacji - siedem ekranów woła ten
// sam komponent i każdy z nich przekazuje dalej `user_id`, które on zwróci.
// Pomyłka tutaj nie jest kosmetyczna: `onChange` oddaje identyfikator, na
// którym wykona się operacja uprawnieniowa. Plik stał bez jednego testu
// (0/36 linii, 0/13 funkcji), więc do tej pory nic nie pilnowało ani progu
// zapytania, ani tego, KTÓRY identyfikator wychodzi z listy.
//
// PRZEDMIOT DOWODU:
//   1. PRÓG ZAPYTANIA. Jeden znak NIE odpytuje bazy (`shouldQueryMembers`),
//      a szybkie pisanie składa się w JEDNO zapytanie (debounce 250 ms).
//      To nie jest wygoda - to ochrona `profiles` przed skanem po każdym
//      naciśnięciu klawisza z panelu, który ma prawo czytać cały tenant.
//   2. KSZTAŁT ZAPYTANIA. `ilike` po `display_name` z `limit(10)`, a wklejony
//      UUID idzie ścieżką `.eq("id", ...)` - fallback dla „mam surowe id".
//   3. WYNIK -> `onChange` DOSTAJE ID TEJ KLIKNIĘTEJ POZYCJI, nie indeksu,
//      nie nazwy. Osobno: mapowanie pustej nazwy na slug/id (fixtures).
//   4. CZYSZCZENIE wyboru oddaje `""` i nie otwiera przy okazji warstwy.
//   5. DOSTĘPNOŚĆ: pole ma etykietę, wyniki mają semantykę listy, przycisk
//      czyszczenia ma nazwę - mierzone `axeViolations`, nie okiem.
//
// IZOLACJA TENANTA - CO TEN TEST DOWODZI, A CZEGO NIE. Zapytanie NIE niesie
// żadnego filtra `tenant_id`; ogranicza je polityka RLS na `public.profiles`
// (`tenant_id = current_tenant_id() AND is_staff()`), czyli warstwa bazy.
// Test na atrapie klienta NIE JEST w stanie tego dowieść - atrapa odda
// dokładnie te wiersze, które mu podłożę, choćby były z obcego tenanta.
// Co ten plik dowodzi UCZCIWIE: (a) komponent nie dokłada żadnego własnego
// filtra, który mógłby RLS obejść lub zdublować (asercja na zapisanym
// łańcuchu PostgREST), (b) czyta wyłącznie kolumny bez PII (`id`,
// `display_name`, `avatar_url`, `slug`, `verified_at`) - żadnego adresu
// e-mail ani telefonu, więc nawet błąd polityki nie wycieknie danymi
// kontaktowymi. Dowód, że polityka faktycznie tnie po tenancie, należy do
// testów RLS w `supabase/`, nie do tego pliku.
//
// CO JEST ATRAPOWANE I DLACZEGO:
//   * klient Supabase - granica sieci (żaden test nie wychodzi do sieci),
//     przez wspólny `supabaseFromStub`, który ZAPISUJE łańcuch wywołań;
//     bez zapisu nie dałoby się dowieść punktu 2 ani izolacji.
//   * Radixowy `Popover` - pod happy-dom nie otwiera warstwy (potrzebuje
//     realnego wskaźnika i pomiarów układu), a otwarcie jest tu treścią
//     zachowania: dopóki warstwa jest zamknięta, zapytanie w ogóle nie leci
//     (`enabled: open && ready`).
// PRAWDZIWE biegną: `@/lib/admin/memberSearch` (próg, UUID, mapowanie wiersza)
// i `ChatAvatar` - to sąsiedzi, wobec których komponent ma zdawać egzamin.
//
// RODO: wszystkie osoby w fixture'ach są zmyślone, domeny `example.com`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";
import { MemberPicker, type MemberPickerLabels } from "@/components/admin/community/MemberPicker";

const h = vi.hoisted(() => {
  const state: { from: (table: string) => unknown } = { from: () => ({}) };
  return { state };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => h.state.from(table),
  },
}));

/**
 * Atrapa Radixowego Popovera: sterowana `open`/`onOpenChange` dokładnie tak,
 * jak używa jej `MemberPicker`. Zawartość montuje się TYLKO gdy otwarta -
 * inaczej test „znajdowałby" pole wyszukiwania w zamkniętej warstwie i nie
 * dowiódłby bramki `enabled: open && ready`.
 */
vi.mock("@/components/ui/popover", async () => {
  const react = await import("react");
  const Ctx = react.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({
    open: false,
    setOpen: () => undefined,
  });
  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: ReactNode;
    }) => {
      const [internal, setInternal] = react.useState(false);
      const isOpen = open ?? internal;
      const setOpen = (next: boolean) => {
        if (open === undefined) setInternal(next);
        onOpenChange?.(next);
      };
      return react.createElement(Ctx.Provider, { value: { open: isOpen, setOpen } }, children);
    },
    PopoverTrigger: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      const toggle = () => ctx.setOpen(!ctx.open);
      // Produkcyjny wyzwalacz to `<button>` BEZ własnego `onClick`, więc
      // doklejenie wyzwalacza niczego nie nadpisuje - Radix robi to samo.
      if (asChild === true && react.isValidElement<{ onClick?: () => void }>(children)) {
        return react.cloneElement(children, { onClick: toggle });
      }
      return react.createElement("button", { type: "button", onClick: toggle }, children);
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? react.createElement("div", { "data-testid": "popover" }, children) : null;
    },
  };
});

const LABELS: MemberPickerLabels = {
  placeholder: "Wybierz członka…",
  search: "Szukaj po nazwisku…",
  hint: "Wpisz min. 2 znaki",
  loading: "Szukam…",
  empty: "Brak wyników",
  clear: "Wyczyść wybór",
};

const OLA = "11111111-1111-4111-8111-111111111111";
const JAN = "22222222-2222-4222-8222-222222222222";
const BEZ_NAZWY = "33333333-3333-4333-8333-333333333333";
const BEZ_NICZEGO = "44444444-4444-4444-8444-444444444444";

/** Wiersze `profiles` w kształcie, w jakim czyta je picker (bez PII). */
function profileRows() {
  return [
    {
      id: OLA,
      display_name: "Ola Przykładowa",
      avatar_url: "https://cdn.example.com/ola.png",
      slug: "ola-przykladowa",
      verified_at: "2026-01-02T10:00:00.000Z",
    },
    {
      id: JAN,
      display_name: "Jan Zmyślony",
      avatar_url: null,
      slug: "jan-zmyslony",
      verified_at: null,
    },
  ];
}

let chains = supabaseFromStub();

function renderPicker(props: { value?: string; disabled?: boolean } = {}) {
  const onChange = vi.fn<(userId: string) => void>();
  const view = renderWithQueryClient(
    <MemberPicker
      value={props.value ?? ""}
      onChange={onChange}
      labels={LABELS}
      disabled={props.disabled}
    />,
  );
  const setValue = (next: string) =>
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <MemberPicker value={next} onChange={onChange} labels={LABELS} />
      </QueryClientProvider>,
    );
  return { ...view, onChange, setValue };
}

/** Otwiera warstwę i zwraca pole wyszukiwania. */
function openPicker(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: LABELS.placeholder }));
  return screen.getByLabelText(LABELS.search);
}

/** Czeka DŁUŻEJ niż debounce (250 ms), żeby brak zapytania coś znaczył. */
function afterDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

beforeEach(() => {
  chains = supabaseFromStub();
  h.state.from = chains.from;
  chains.setResponse("profiles", ok(profileRows()));
});

describe("MemberPicker - próg i debounce zapytania", () => {
  it("jeden znak NIE odpytuje bazy - pokazuje podpowiedź o progu", async () => {
    renderPicker();
    const input = openPicker();

    fireEvent.change(input, { target: { value: "a" } });
    await afterDebounce();

    // Bramka `shouldQueryMembers` żyje w `@/lib/admin/memberSearch` i biegnie
    // tu PRAWDZIWA: skutkiem ma być zero łańcuchów na `profiles`.
    expect(chains.chainsFor("profiles")).toHaveLength(0);
    expect(screen.getByText(LABELS.hint)).toBeInTheDocument();
  });

  it("dwa znaki przekraczają próg i wysyłają dokładnie jedno zapytanie", async () => {
    renderPicker();
    const input = openPicker();

    fireEvent.change(input, { target: { value: "ol" } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    expect(chains.lastChain("profiles")?.argsOf("ilike")).toEqual(["display_name", "%ol%"]);
  });

  it("szybkie pisanie składa się w JEDNO zapytanie o ostatnią frazę", async () => {
    renderPicker();
    const input = openPicker();

    fireEvent.change(input, { target: { value: "ol" } });
    fireEvent.change(input, { target: { value: "ola" } });
    fireEvent.change(input, { target: { value: "ola p" } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    // Gdyby debounce nie działał, poszłyby trzy zapytania - a fraza pośrednia
    // („ol") i tak przekracza próg, więc test nie mierzy tu progu, tylko zegar.
    expect(chains.lastChain("profiles")?.argsOf("ilike")).toEqual(["display_name", "%ola p%"]);
    await afterDebounce();
    expect(chains.chainsFor("profiles")).toHaveLength(1);
  });

  it("zamknięta warstwa nie odpytuje bazy, choćby fraza była gotowa", async () => {
    const { container } = renderPicker();
    const input = openPicker();
    fireEvent.change(input, { target: { value: "ola" } });
    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));

    // Zamknięcie warstwy (klik w wyzwalacz) wstrzymuje odczyt: `enabled`
    // to KONIUNKCJA `open && ready`, nie samo `ready`.
    fireEvent.click(screen.getByRole("button", { name: LABELS.placeholder }));
    expect(within(container).queryByLabelText(LABELS.search)).not.toBeInTheDocument();
    await afterDebounce();
    expect(chains.chainsFor("profiles")).toHaveLength(1);
  });

  it("spacje wokół frazy nie liczą się do progu", async () => {
    renderPicker();
    const input = openPicker();

    fireEvent.change(input, { target: { value: "  a  " } });
    await afterDebounce();

    expect(chains.chainsFor("profiles")).toHaveLength(0);
  });
});

describe("MemberPicker - kształt zapytania i izolacja danych", () => {
  it("szuka po nazwie: ilike + sortowanie + limit 10, bez filtra tenanta", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    const chain = chains.lastChain("profiles");
    expect(chain?.argsOf("select")).toEqual(["id, display_name, avatar_url, slug, verified_at"]);
    expect(chain?.argsOf("order")).toEqual(["display_name", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([10]);
    // IZOLACJA TENANTA: klient NIE dokłada własnego `tenant_id` - tnie RLS
    // (`tenant_id = current_tenant_id() AND is_staff()`). Asercja pilnuje, żeby
    // nikt nie „poprawił" tego filtrem po stronie klienta, który dałby złudzenie
    // ochrony tam, gdzie chroni polityka, i rozjechałby się z nią przy zmianie.
    const filtered = chain?.calls.filter((c) => c.method === "eq" || c.method === "filter") ?? [];
    expect(filtered).toEqual([]);
  });

  it("czyta wyłącznie kolumny bez danych kontaktowych", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    const columns = String(chains.lastChain("profiles")?.argsOf("select")?.[0] ?? "")
      .split(",")
      .map((c) => c.trim());
    // Nawet przy błędzie polityki picker nie ma czym wyciec adresem ani
    // telefonem - te kolumny w ogóle nie są wybierane.
    expect(columns).toEqual(["id", "display_name", "avatar_url", "slug", "verified_at"]);
  });

  it("wklejony UUID idzie po kluczu głównym, a nie wzorcem po nazwie", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: OLA } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    const chain = chains.lastChain("profiles");
    expect(chain?.argsOf("eq")).toEqual(["id", OLA]);
    expect(chain?.has("ilike")).toBe(false);
    // Ścieżka UUID nie sortuje - jeden wiersz nie ma po czym.
    expect(chain?.has("order")).toBe(false);
  });

  it("UUID z wielkimi literami też trafia w klucz główny", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: OLA.toUpperCase() } });

    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    expect(chains.lastChain("profiles")?.argsOf("eq")).toEqual(["id", OLA.toUpperCase()]);
  });
});

describe("MemberPicker - wynik wyszukiwania", () => {
  it("wyniki mają semantykę listy i pokazują nazwę oraz uchwyt", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(list).getByRole("button", { name: /Ola Przykładowa/ })).toBeInTheDocument();
    expect(within(list).getByText("@jan-zmyslony")).toBeInTheDocument();
  });

  it("odpowiedź bez wierszy (data = null) też jest pustą listą, nie wysypką", async () => {
    // PostgREST przy filtrze bez trafień potrafi oddać `null` zamiast `[]`;
    // `.map` na `null` wywaliłby cały panel odznak, więc gałąź `data ?? []`
    // ma być zmierzona, a nie założona.
    chains.setResponse("profiles", ok(null));
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "nikt" } });

    await waitFor(() => expect(screen.getByText(LABELS.empty)).toBeInTheDocument());
  });

  it("pusty wynik mówi „brak wyników”, nie zostawia pustki", async () => {
    chains.setResponse("profiles", ok([]));
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "nikt" } });

    await waitFor(() => expect(screen.getByText(LABELS.empty)).toBeInTheDocument());
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("profil bez nazwy spada na slug, a bez slug na identyfikator", async () => {
    chains.setResponse(
      "profiles",
      ok([
        {
          id: BEZ_NAZWY,
          display_name: "   ",
          avatar_url: null,
          slug: "tylko-slug",
          verified_at: null,
        },
        {
          id: BEZ_NICZEGO,
          display_name: null,
          avatar_url: null,
          slug: null,
          verified_at: null,
        },
      ]),
    );
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "pusty" } });

    const list = await screen.findByRole("list");
    // Pusta nazwa NIE MOŻE dać pustego wiersza: staff musiałby zgadywać,
    // kogo klika, a klika uprawnienie.
    expect(within(list).getByRole("button", { name: /tylko-slug/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: new RegExp(BEZ_NICZEGO) })).toBeInTheDocument();
  });

  it.fails(
    "ODMOWA ODCZYTU NIE JEST „BRAKIEM WYNIKÓW” - błąd zapytania ma być widoczny",
    async () => {
      // ZNALEZISKO. `queryFn` rzuca błędem PostgREST, ale render czyta wyłącznie
      // `q.data ?? []`: odmowa RLS, wygasła sesja i literówka w kolumnie wyglądają
      // DOKŁADNIE tak samo jak „w tym tenancie nie ma takiej osoby". Staff, który
      // realnie nie ma prawa czytać `profiles`, dostaje komunikat sugerujący, że
      // szukana osoba nie istnieje - i zakłada konto duplikat albo eskaluje nie
      // tam, gdzie trzeba. Kontrola dodatnia: test „pusty wynik" wyżej dowodzi,
      // że ta sama ścieżka renderu dla PRAWDZIWIE pustej listy działa.
      chains.setResponse("profiles", fail("permission denied for table profiles", "42501"));
      renderPicker();
      fireEvent.change(openPicker(), { target: { value: "ola" } });

      await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    },
  );

  it("KONTROLA DODATNIA znaleziska: błędne zapytanie faktycznie dociera do bazy", async () => {
    chains.setResponse("profiles", fail("permission denied for table profiles", "42501"));
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    // Zapytanie POSZŁO i wróciło błędem - czyli poprzedni `it.fails` mierzy
    // brak PREZENTACJI błędu, a nie brak zapytania.
    await waitFor(() => expect(chains.chainsFor("profiles")).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(LABELS.empty)).toBeInTheDocument());
  });
});

describe("MemberPicker - wybór i czyszczenie", () => {
  it("klik w pozycję oddaje IDENTYFIKATOR tej pozycji i zamyka warstwę", async () => {
    const { onChange } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Jan Zmyślony/ }));

    // Skutek: rodzic dostaje user_id KLIKNIĘTEJ osoby (druga pozycja listy),
    // nie pierwszej i nie tej, na której stał kursor.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(JAN);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // Wyzwalacz pokazuje WYBRANĄ osobę. Szukamy jej po tekście, nie po nazwie
    // dostępnej: `aria-label` wyzwalacza jest przyklejony do `placeholder`
    // niezależnie od wyboru - opisuje to znalezisko niżej.
    const trigger = screen.getByRole("button", { name: LABELS.placeholder });
    expect(within(trigger).getByText("Jan Zmyślony")).toBeInTheDocument();
  });

  it("po wyborze fraza wraca do zera - następne otwarcie nie odpytuje bazy", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));

    fireEvent.click(screen.getByRole("button", { name: LABELS.placeholder }));
    expect(screen.getByLabelText(LABELS.search)).toHaveValue("");
    await afterDebounce();
    // Jedno zapytanie z pierwszego szukania - i żadnego nowego.
    expect(chains.chainsFor("profiles")).toHaveLength(1);
  });

  it("czyszczenie oddaje pusty identyfikator i NIE otwiera warstwy", async () => {
    const { onChange } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));
    onChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: LABELS.clear }));

    expect(onChange).toHaveBeenCalledWith("");
    // `stopPropagation` na krzyżyku: czyszczenie nie może przy okazji rozwijać
    // wyszukiwarki - operator dostałby warstwę, o którą nie prosił.
    expect(screen.queryByLabelText(LABELS.search)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: LABELS.placeholder })).toBeInTheDocument();
  });

  it("krzyżyk czyszczenia działa z klawiatury (Enter i spacja)", async () => {
    const { onChange } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));
    onChange.mockClear();

    const clearControl = screen.getByRole("button", { name: LABELS.clear });
    fireEvent.keyDown(clearControl, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("");

    // Spacja to drugi klawisz, którego czytniki ekranu używają na roli
    // `button` - obsłużone są OBA, więc oba są tu mierzone.
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const again = await screen.findByRole("list");
    fireEvent.click(within(again).getByRole("button", { name: /Ola Przykładowa/ }));
    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole("button", { name: LABELS.clear }), { key: " " });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("obojętny klawisz na krzyżyku NIE czyści wyboru", async () => {
    const { onChange } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));
    onChange.mockClear();

    // Tabulator przechodzi przez krzyżyk w drodze dalej - nie może po drodze
    // kasować odbiorcy uprawnienia.
    fireEvent.keyDown(screen.getByRole("button", { name: LABELS.clear }), { key: "Tab" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Ola Przykładowa")).toBeInTheDocument();
  });

  it("wyzerowanie wartości przez rodzica zdejmuje etykietę wyboru", async () => {
    const { setValue } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));
    // Rodzic jest kontrolowany: po `onChange` podnosi `value` do wybranego id.
    setValue(OLA);
    expect(screen.getByText("Ola Przykładowa")).toBeInTheDocument();

    setValue("");

    // Rodzic po udanym przyznaniu odznaki zeruje `value`; bez tego efektu
    // trigger pokazywałby osobę, której formularz już nie dotyczy.
    await waitFor(() => expect(screen.queryByText("Ola Przykładowa")).not.toBeInTheDocument());
    expect(screen.getByText(LABELS.placeholder)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LABELS.clear })).not.toBeInTheDocument();
  });

  it("zaznaczona pozycja jest wyróżniona po zgodności z `value`", async () => {
    renderPicker({ value: JAN });
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    const list = await screen.findByRole("list");
    expect(within(list).getByRole("button", { name: /Jan Zmyślony/ }).className).toContain(
      "bg-accent",
    );
    expect(within(list).getByRole("button", { name: /Ola Przykładowa/ }).className).not.toContain(
      "bg-accent",
    );
  });

  it("wyłączony picker nie otwiera warstwy", async () => {
    renderPicker({ disabled: true });
    const trigger = screen.getByRole("button", { name: LABELS.placeholder });

    expect(trigger).toBeDisabled();
    await afterDebounce();
    expect(chains.chainsFor("profiles")).toHaveLength(0);
  });
});

describe("MemberPicker - dostępność", () => {
  it("zamknięty picker nie ma naruszeń axe", async () => {
    const { container } = renderPicker();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("otwarta lista wyników nie ma naruszeń axe", async () => {
    const { container } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    await screen.findByRole("list");

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it.fails(
    "KRZYŻYK CZYSZCZENIA TO PRZYCISK W PRZYCISKU - czytnik nie ogłosi go jako akcji",
    async () => {
      // ZNALEZISKO (axe `nested-interactive`, WCAG 2.1 4.1.2, waga „serious").
      // Po wyborze członka wyzwalacz warstwy - natywny `<button>` - dostaje
      // w środku `<span role="button" tabIndex={0}>` do czyszczenia. Dla
      // czytnika ekranu wnętrze przycisku nie jest osobną kontrolką: element
      // ogłosi się jako JEDEN przycisk „Wybierz członka…", a operacja
      // „wyczyść wybór" znika z drzewa dostępności. Praktyczny skutek:
      // osoba korzystająca z czytnika nie ma jak cofnąć wyboru odbiorcy
      // odznaki inaczej niż przeładowaniem formularza. Naprawa (krzyżyk jako
      // RODZEŃSTWO wyzwalacza, nie jego dziecko) zmienia układ wiersza, więc
      // nie należy do tego pakietu - zgłoszone, nie łatane po cichu.
      // KONTROLA DODATNIA: dwa testy niżej/wyżej („zamknięty picker" oraz
      // „otwarta lista wyników") przechodzą na tym samym `axeViolations`,
      // czyli harness nie zgłasza szumu - zgłasza dokładnie ten stan.
      const { container } = renderPicker();
      fireEvent.change(openPicker(), { target: { value: "ola" } });
      const list = await screen.findByRole("list");
      fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));

      const violations = await axeViolations(container);
      expect(violations, summarize(violations)).toEqual([]);
    },
  );

  it("KONTROLA DODATNIA znaleziska: naruszenie dotyczy WYŁĄCZNIE zagnieżdżenia", async () => {
    const { container } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Ola Przykładowa/ }));

    // Ten sam stan, ta sama asercja - ale liczona co do reguły. Jeśli ktoś
    // naprawi zagnieżdżenie, ta lista zejdzie do pustej i test padnie razem
    // z `it.fails` wyżej, wymuszając sprzątnięcie znaleziska.
    const violations = await axeViolations(container);
    expect(
      violations.map((v) => v.id),
      summarize(violations),
    ).toEqual(["nested-interactive"]);
  });

  it.fails("NAZWA DOSTĘPNA WYZWALACZA NIE MÓWI, KTO JEST WYBRANY", async () => {
    // ZNALEZISKO. `aria-label={labels.placeholder}` stoi na wyzwalaczu
    // BEZWARUNKOWO i wygrywa z treścią, więc po wyborze osoby czytnik nadal
    // ogłasza „Wybierz członka…". Widzący operator widzi nazwisko, niewidomy
    // nie ma jak sprawdzić, komu za chwilę przyzna uprawnienie - a to jedyne
    // potwierdzenie przed zapisem. Poprawka to jedna linia (nazwa wybranej
    // osoby jako `aria-label`, placeholder tylko przy pustym wyborze), ale
    // to zmiana zachowania produkcyjnego, więc idzie do raportu.
    const { onChange } = renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Jan Zmyślony/ }));
    expect(onChange).toHaveBeenCalledWith(JAN);

    expect(screen.getByRole("button", { name: /Jan Zmyślony/ })).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA znaleziska: nazwisko JEST na ekranie, tylko nie w nazwie", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByRole("button", { name: /Jan Zmyślony/ }));

    // Dowód, że poprzedni `it.fails` mierzy nazwę DOSTĘPNĄ, a nie render:
    // tekst wybranej osoby stoi w wyzwalaczu, więc wzrokiem wybór widać.
    const trigger = screen.getByRole("button", { name: LABELS.placeholder });
    expect(within(trigger).getByText("Jan Zmyślony")).toBeInTheDocument();
  });

  it("każdy wynik jest natywnym przyciskiem - osiągalnym Tabem i Enterem", async () => {
    renderPicker();
    fireEvent.change(openPicker(), { target: { value: "ola" } });

    const list = await screen.findByRole("list");
    for (const item of within(list).getAllByRole("button")) {
      // Picker NIE MA nawigacji strzałkami (brak roving tabindex ani
      // `aria-activedescendant`) - dostępność klawiaturową niesie wyłącznie
      // natywna semantyka `<button type="button">`. Ten test pilnuje, żeby
      // nikt nie zamienił jej na `<div onClick>`, bo wtedy lista przestałaby
      // być obsługiwalna bez myszy w ogóle.
      expect(item.tagName).toBe("BUTTON");
      expect(item.getAttribute("type")).toBe("button");
    }
  });
});
