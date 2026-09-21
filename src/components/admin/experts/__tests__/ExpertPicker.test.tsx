// Kontrolka wyboru osoby z bazy wewnętrznej ekspertów (`ExpertPicker`).
//
// CO DOWODZI TEN PLIK.
//  1. WYBÓR EMITUJE CAŁY WPIS, KTÓRY STOI PRZY KLIKNIĘTEJ POZYCJI. Lista
//     powstaje w `shown.map()` z domknięciem w JSX-ie, więc przestawiona para
//     „wiersz -> wpis" nie wychodzi ani na typach (każda pozycja ma ten sam
//     typ), ani wzrokowo. KONSEKWENCJA defektu: redakcja wskazuje w panelu
//     Zofię, a wpis dostaje `user_id` Bartosza - podpis pod artykułem wskazuje
//     nie tę osobę, a nikt tego nie widzi do publikacji.
//  2. ZAWĘŻANIE MA STAN PUSTY. Fraza bez dopasowań musi powiedzieć wprost
//     „brak dopasowań", a nie pokazać puste pudło - inaczej redakcja czyta to
//     jako awarię bazy i wpisuje dane ręcznie, czyli traci to, po co ta
//     kontrolka istnieje (identyfikację wewnętrznego zasobu).
//  3. FRAZA NIE PRZECIEKA MIĘDZY OTWARCIAMI. `onOpenChange` zeruje `q` przy
//     zamknięciu; bez tego druga próba wyboru startuje z niewidocznym filtrem
//     z poprzedniej próby i „brakująca osoba" wygląda na brak w bazie.
//  4. STOPKA PODAJE REALNĄ WIELKOŚĆ BAZY, z polską odmianą liczebnika. To był
//     cel tej kontrolki (patrz nagłówek produkcji): `<select>` nie mówił NIC
//     o tym, kogo zawiera. Zła odmiana albo zła liczba to jedyny sygnał,
//     po którym redakcja poznaje, że widzi bazę ograniczoną.
//  5. WIDOK OGRANICZONY JEST POWIEDZIANY WPROST. Staff bez roli admina dostaje
//     wynik `restricted` - komunikat musi być na ekranie, bo inaczej lista
//     krótsza od rzeczywistości czyta się jako pełna baza.
//  6. STANY ZAPYTANIA NIE WYWALAJĄ PANELU: w locie, pusto i awaria dają trzy
//     różne, czytelne ekrany.
//  7. KLAWIATURA I CZYTNIK: wyzwalacz i każda pozycja są NATYWNYMI przyciskami
//     `type="button"` (Enter/Spacja za darmo, zero przypadkowego submitu
//     formularza edytora), pole szukania ma etykietę, a zaznaczenie jest
//     ogłaszane przez `aria-selected` na właściwej pozycji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - Reguł filtra `filterInternalExperts` (dopasowanie po nazwisku, stanowisku,
//    organizacji i slugu) - ma dowód w `src/components/admin/builder/__tests__/
//    authorProfileCardParity.test.tsx`. Atrapa modułu ZOSTAWIA prawdziwy filtr,
//    więc tutaj sprawdzamy wyłącznie, że kontrolka go woła i respektuje wynik.
//  - Warstwy danych `internalExpertBaseQueryOptions` (cztery zapytania + RPC
//    `admin_list_users`, degradacja do widoku publicznego) - ma dowód
//    w `src/lib/experts/__tests__/expertDataLayer.test.ts`. Tutaj zapytanie jest
//    wyłącznie źródłem czterech stanów: w locie, pełne, puste, awaria.
//  - Etykiet wstrzykiwanych przez wołających (`ExpertLinkPanel`,
//    `PostContextBlocks`) - `noneLabel` jest tu sprawdzone jako KONTRAKT
//    (przesłania placeholder w dwóch miejscach), a nie jako konkretny napis.
//
// CZEGO TU NIE MA I DLACZEGO. Kontrolka jest JEDNOKROTNA - nie ma wyboru
// wielokrotnego ani limitu liczby zaznaczeń, więc nie ma czego blokować.
// Zamiast fikcyjnego testu limitu stoi niżej dowód na kontrakt jednokrotności:
// wybór kolejnej osoby ZASTĘPUJE poprzednią i nie dorzuca drugiej pozycji.
//
// UWAGA NARZĘDZIOWA: `@testing-library/user-event` NIE jest zależnością tego
// repozytorium (nie ma go w `package.json` ani w `node_modules`), a instalacja
// jest w tej sesji zablokowana. Interakcje idą więc przez `fireEvent`, tak jak
// w każdym innym teście kontrolek tego repo (wzór: `clubPickers.test.tsx`).
// RODO: wszystkie nazwiska są zmyślone, zdjęcia wskazują na `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { InternalExpertBase, InternalExpertEntry } from "@/lib/experts/internalBase";

const h = vi.hoisted(() => ({
  /** Odpowiedź warstwy danych - przestawialna w każdym teście. */
  base: null as InternalExpertBase | null,
  /** Zatrzask odpowiedzi: bez rozwiązania widać stan „zapytanie w locie". */
  gate: null as Promise<void> | null,
  /** Awaria zapytania: `data === undefined` przy `isLoading === false`. */
  fail: false,
}));

// Klient bazy jest tu nieosiągalny i niepotrzebny: atrapa poniżej podmienia
// całe `queryOptions`, ale `importOriginal` ładuje prawdziwy moduł (po
// `filterInternalExperts`), a ten importuje klienta w czasie wczytywania.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({}), in: () => ({}) }) }),
    rpc: async () => ({ data: [], error: null }),
  },
}));

// Atrapa TYLKO na wejście do bazy. `filterInternalExperts` zostaje prawdziwy,
// bo to jego wynik decyduje o tym, co widzi redakcja - podmieniony filtr
// zamieniłby ten plik w test atrapy.
vi.mock("@/lib/experts/internalBase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experts/internalBase")>();
  return {
    ...actual,
    internalExpertBaseQueryOptions: () => ({
      queryKey: ["test", "internal-expert-base"] as const,
      retry: false,
      queryFn: async (): Promise<InternalExpertBase> => {
        if (h.gate) await h.gate;
        if (h.fail) throw new Error("admin_list_users: brak uprawnień");
        if (!h.base) throw new Error("test nie ustawił bazy");
        return h.base;
      },
    }),
  };
});

/**
 * Atrapa Radixowego Popovera. Radix pod happy-dom nie otwiera warstwy (wymaga
 * pełnego API wskaźnika i pomiarów układu), a otwarcie jest tu treścią
 * zachowania: dopóki warstwa jest zamknięta, NIE DA SIĘ nic wybrać, przeszukać
 * ani odczytać wielkości bazy. `ExpertPicker` używa wyłącznie trybu
 * STEROWANEGO (`open` + `onOpenChange`) i `PopoverTrigger asChild` z przyciskiem
 * bez własnego `onClick`, więc dopisanie wyzwalacza niczego nie nadpisuje -
 * Radix robi w tym miejscu dokładnie to samo.
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
    }) => (
      <Ctx.Provider value={{ open: open === true, setOpen: (next) => onOpenChange?.(next) }}>
        {children}
      </Ctx.Provider>
    ),
    PopoverTrigger: ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      const toggle = () => ctx.setOpen(!ctx.open);
      if (asChild === true && react.isValidElement<{ onClick?: () => void }>(children)) {
        return react.cloneElement(children, { onClick: toggle });
      }
      return (
        <button type="button" onClick={toggle}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => {
      const ctx = react.useContext(Ctx);
      return ctx.open ? <div data-testid="popover-content">{children}</div> : null;
    },
  };
});

import { ExpertPicker } from "@/components/admin/experts/ExpertPicker";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

// --- Fixtures (RODO: osoby zmyślone, zdjęcia na example.com) -----------------

/** Pełny wpis: zdjęcie, stanowisko + organizacja, odznaka, profil publiczny. */
const zofia: InternalExpertEntry = {
  id: "u-1",
  name: "Zofia Wiatrak",
  slug: "zofia-wiatrak",
  avatarUrl: "https://cdn.example.com/avatars/zofia-wiatrak.webp",
  jobTitle: "Dyrektorka programowa",
  company: "Instytut Spraw Nadmorskich",
  isExpert: true,
  isPublic: true,
};

/** Bez zdjęcia, tylko stanowisko (podtytuł BEZ separatora), profil niepubliczny. */
const bartosz: InternalExpertEntry = {
  id: "u-2",
  name: "Bartosz Nieradka",
  slug: "bartosz-nieradka",
  avatarUrl: null,
  jobTitle: "Analityk energetyczny",
  company: null,
  isExpert: false,
  isPublic: false,
};

/** Organizacja z samych spacji: predykat `v.trim().length > 0` musi ją odsiać. */
const hanna: InternalExpertEntry = {
  id: "u-3",
  name: "Hanna Zabłocka",
  slug: null,
  avatarUrl: null,
  jobTitle: null,
  company: "   ",
  isExpert: false,
  isPublic: true,
};

const TRIO = [zofia, bartosz, hanna];

function baseOf(
  entries: readonly InternalExpertEntry[],
  over: Partial<InternalExpertBase> = {},
): InternalExpertBase {
  return {
    entries: [...entries],
    total: entries.length,
    expertCount: entries.filter((e) => e.isExpert).length,
    publicCount: entries.filter((e) => e.isPublic).length,
    restricted: false,
    ...over,
  };
}

/** Baza o zadanej wielkości - do sprawdzania odmiany liczebnika w stopce. */
function crowd(n: number): InternalExpertEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u-gen-${i}`,
    name: `Osoba Testowa ${String(i + 1).padStart(2, "0")}`,
    slug: `osoba-testowa-${i + 1}`,
    avatarUrl: null,
    jobTitle: null,
    company: null,
    isExpert: i === 0,
    isPublic: true,
  }));
}

const PL_PLACEHOLDER = "Wybierz osobę z bazy";
const PL_SEARCH = "Szukaj: nazwisko, stanowisko, organizacja…";
const PL_EMPTY = "Brak dopasowań w bazie wewnętrznej.";
const PL_LOADING = "Wczytywanie bazy…";
const PL_RESTRICTED = "Widok ograniczony do profili publicznych - pełną bazę widzi administrator.";

beforeEach(() => {
  h.base = baseOf(TRIO);
  h.gate = null;
  h.fail = false;
});

afterEach(cleanup);

/** Otwarcie warstwy i odczekanie, aż zapytanie się rozwiąże (albo padnie). */
async function open(): Promise<void> {
  fireEvent.click(screen.getAllByRole("button")[0]);
  await screen.findByTestId("popover-content");
}

function options(): HTMLElement[] {
  return screen.getAllByRole("option");
}

function search(): HTMLElement {
  return screen.getByLabelText(PL_SEARCH);
}

describe("ExpertPicker - wyzwalacz zamkniętej kontrolki", () => {
  it("bez wyboru pokazuje etykietę zastępczą i NIE ujawnia listy", () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.textContent).toContain(PL_PLACEHOLDER);
    // Gdyby to padło, panel ogłaszałby czytnikowi otwartą warstwę, której nie ma.
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("`noneLabel` przesłania etykietę zastępczą na wyzwalaczu", () => {
    renderWithQueryClient(
      <ExpertPicker
        lang="pl"
        value=""
        onSelect={vi.fn()}
        onClear={vi.fn()}
        noneLabel="- Brak (dane ręczne) -"
      />,
    );
    // KONSEKWENCJA: bez tego pole autora wpisu mówi „wybierz osobę", choć
    // domyślnie autorem jest autor bieżącego wpisu - inny stan produktu.
    expect(screen.getAllByRole("button")[0].textContent).toContain("- Brak (dane ręczne) -");
    expect(screen.getAllByRole("button")[0].textContent).not.toContain(PL_PLACEHOLDER);
  });

  it("wybrana osoba pokazuje zdjęcie, nazwisko i podtytuł ze separatorem", async () => {
    const { container } = renderWithQueryClient(
      <ExpertPicker lang="pl" value="u-1" onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByText("Zofia Wiatrak").length).toBeGreaterThan(0));
    const img = container.querySelector<HTMLImageElement>("img");
    expect(img?.getAttribute("src")).toBe(zofia.avatarUrl);
    // Zdjęcie jest dekoracją obok nazwiska - `alt` MUSI zostać puste, inaczej
    // czytnik czyta nazwisko dwa razy.
    expect(img?.getAttribute("alt")).toBe("");
    expect(screen.getAllByRole("button")[0].textContent).toContain(
      "Dyrektorka programowa · Instytut Spraw Nadmorskich",
    );
  });

  it("osoba bez zdjęcia dostaje zastępczą ikonę oznaczoną jako dekoracja", async () => {
    const { container } = renderWithQueryClient(
      <ExpertPicker lang="pl" value="u-2" onSelect={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByText("Bartosz Nieradka").length).toBe(1));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[aria-hidden] svg")).not.toBeNull();
    // Jedno pole = brak separatora „·"; z separatorem czytałoby się jak dwa.
    const label = screen.getAllByRole("button")[0].textContent ?? "";
    expect(label).toContain("Analityk energetyczny");
    expect(label).not.toContain("·");
  });

  it("stanowisko puste i organizacja z samych spacji NIE dają podtytułu", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="u-3" onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByText("Hanna Zabłocka").length).toBe(1));
    // KONSEKWENCJA: bez `trim()` na wyzwalaczu wisiałby goły dywiz „ - ".
    expect(screen.getAllByRole("button")[0].textContent).not.toContain(" - ");
  });

  it("`value` spoza bazy nie wywala wyzwalacza - schodzi na etykietę zastępczą", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="u-usuniety" onSelect={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button")[0].textContent).toContain(PL_PLACEHOLDER),
    );
    // KONSEKWENCJA: osoba usunięta z bazy zostawia w dokumencie martwe id;
    // rzut wyjątku tutaj zabiłby cały panel właściwości widgetu.
    expect(screen.queryByText("Zofia Wiatrak")).toBeNull();
  });

  it("`className` dojeżdża do klasy wyzwalacza", () => {
    renderWithQueryClient(
      <ExpertPicker lang="pl" value="" onSelect={vi.fn()} className="nes-test-marker" />,
    );
    expect(screen.getAllByRole("button")[0].className).toContain("nes-test-marker");
  });

  it("`disabled` REALNIE odcina otwarcie warstwy, nie tylko przygasza przycisk", () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} disabled />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    // KONSEKWENCJA: w trakcie zapisu (`busy`) redakcja mogłaby podmienić autora
    // pod trwającą mutacją - panel wysłałby dwie sprzeczne wartości.
    expect(screen.queryByTestId("popover-content")).toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ExpertPicker - zawężanie listy", () => {
  it("wpisanie frazy zostawia tylko dopasowania", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(search(), { target: { value: "energet" } });
    const shown = options();
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toContain("Bartosz Nieradka");
    expect(screen.queryByText("Zofia Wiatrak")).toBeNull();
  });

  it("fraza bez dopasowań daje STAN PUSTY, a nie puste pudło", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(search(), { target: { value: "nieistniejaca-fraza" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // KONSEKWENCJA: bez komunikatu redakcja czyta pustkę jako awarię bazy
    // i przepisuje dane ręcznie - dokładnie to, co ta kontrolka miała skończyć.
    expect(screen.getByText(PL_EMPTY)).toBeTruthy();
    // Stopka nadal podaje PEŁNĄ wielkość bazy - zawężenie widoku nie jest
    // zmniejszeniem bazy.
    expect(screen.getByText(/Baza wewnętrzna: 3 osoby/)).toBeTruthy();
  });

  it("pusta baza daje ten sam stan pusty, ze stopką liczącą zero", async () => {
    h.base = baseOf([]);
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(screen.getByText(PL_EMPTY)).toBeTruthy());
    expect(screen.getByText('Baza wewnętrzna: 0 osób · 0 z odznaką „ekspert"')).toBeTruthy();
  });

  it("fraza z samych spacji NIE filtruje - trymowanie należy do biblioteki", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(search(), { target: { value: "   " } });
    // KONSEKWENCJA: gdyby kontrolka filtrowała sama, spacja z klawiatury
    // czyściłaby listę i wyglądałoby to na pustą bazę.
    expect(options()).toHaveLength(3);
  });

  it("zamknięcie warstwy zeruje frazę - kolejne otwarcie startuje z pełną bazą", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(search(), { target: { value: "energet" } });
    expect(options()).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button")[0]); // zamknięcie
    expect(screen.queryByTestId("popover-content")).toBeNull();
    await open();
    // KONSEKWENCJA: bez zerowania druga próba wyboru pracuje z niewidocznym
    // filtrem z poprzedniej i „brakująca osoba" wygląda na brak w bazie.
    expect((search() as HTMLInputElement).value).toBe("");
    expect(options()).toHaveLength(3);
  });
});

describe("ExpertPicker - wybór, ponowny wybór i czyszczenie", () => {
  it("wybór pozycji emituje CAŁY wpis stojący w tym wierszu i zamyka warstwę", async () => {
    const onSelect = vi.fn();
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={onSelect} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    const row = options().find((o) => o.textContent?.includes("Bartosz Nieradka"));
    fireEvent.click(row as HTMLElement);
    // KONSEKWENCJA przestawionej pary: wpis dostaje `user_id` innej osoby,
    // a podpis pod artykułem wskazuje nie tę osobę, którą wybrała redakcja.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(bartosz);
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("kontrolka jest JEDNOKROTNA: wybór kolejnej osoby zastępuje poprzednią", async () => {
    const onSelect = vi.fn();
    renderWithQueryClient(<ExpertPicker lang="pl" value="u-1" onSelect={onSelect} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    // Zaznaczona osoba jest DOKŁADNIE jedna - nie ma listy zaznaczeń,
    // więc nie ma też limitu, który dałoby się przekroczyć.
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    fireEvent.click(options().find((o) => o.textContent?.includes("Hanna")) as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(hanna);
  });

  it("ponowny wybór już zaznaczonej osoby nie duplikuje pozycji ani emisji", async () => {
    const onSelect = vi.fn();
    renderWithQueryClient(<ExpertPicker lang="pl" value="u-1" onSelect={onSelect} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    const selected = options().filter((o) => o.textContent?.includes("Zofia Wiatrak"));
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(selected[0]);
    // KONSEKWENCJA: emisja z tym samym id musi zostać jedna - druga rozpoczyna
    // kolejną mutację panelu i miga stanem „niezapisane".
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(zofia);
    // Po zamknięciu i ponownym otwarciu lista ma tyle samo pozycji.
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
  });

  it("pozycja czyszcząca istnieje TYLKO wtedy, gdy wołający podał `onClear`", async () => {
    const { unmount } = renderWithQueryClient(
      <ExpertPicker lang="pl" value="" onSelect={vi.fn()} />,
    );
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    // KONSEKWENCJA: panel nie może OFEROWAĆ akcji, której wołający nie obsłuży -
    // kliknięcie „brak" bez `onClear` byłoby przyciskiem, który nic nie robi.
    // (Sam wyzwalacz nadal pokazuje etykietę zastępczą - to inne miejsce.)
    expect(options().some((o) => o.textContent?.includes(PL_PLACEHOLDER))).toBe(false);
    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Zofia Wiatrak"),
      expect.stringContaining("Bartosz Nieradka"),
      expect.stringContaining("Hanna Zabłocka"),
    ]);
    unmount();

    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} onClear={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    expect(options()[0].textContent).toContain(PL_PLACEHOLDER);
  });

  it("czyszczenie woła `onClear`, zamyka warstwę i nie emituje wyboru", async () => {
    const onClear = vi.fn();
    const onSelect = vi.fn();
    renderWithQueryClient(
      <ExpertPicker
        lang="pl"
        value="u-1"
        onSelect={onSelect}
        onClear={onClear}
        noneLabel="- Brak (dane ręczne) -"
      />,
    );
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    fireEvent.click(options()[0]);
    expect(onClear).toHaveBeenCalledTimes(1);
    // KONSEKWENCJA: gdyby czyszczenie emitowało też `onSelect`, „brak autora"
    // zapisywałby się jako wybór losowej osoby z góry listy.
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("popover-content")).toBeNull();
  });

  it("zaznaczenie jest ogłaszane czytnikowi na WŁAŚCIWEJ pozycji", async () => {
    const { unmount } = renderWithQueryClient(
      <ExpertPicker lang="pl" value="" onSelect={vi.fn()} onClear={vi.fn()} />,
    );
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    // Brak wyboru = zaznaczona jest pozycja „brak", nie pierwsza osoba.
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(
      options()
        .slice(1)
        .map((o) => o.getAttribute("aria-selected")),
    ).toEqual(["false", "false", "false"]);
    unmount();

    renderWithQueryClient(
      <ExpertPicker lang="pl" value="u-2" onSelect={vi.fn()} onClear={vi.fn()} />,
    );
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    const flags = options().map((o) => o.getAttribute("aria-selected"));
    // KONSEKWENCJA: przestawiona flaga mówi czytnikowi, że wybrany jest ktoś
    // inny niż ten, kogo panel zapisze.
    expect(flags).toEqual(["false", "false", "true", "false"]);
    const row = options()[2];
    expect(row.textContent).toContain("Bartosz Nieradka");
    expect(row.className).toContain("bg-muted/60");
  });
});

describe("ExpertPicker - odznaki i stopka bazy", () => {
  it("odznaki stoją przy właściwych osobach, a nie przy wszystkich", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(3));
    const byName = (n: string) => options().find((o) => o.textContent?.includes(n)) as HTMLElement;
    // KONSEKWENCJA: to jest cały sens tej kontrolki - redakcja musi widzieć,
    // czyj profil czeka jeszcze na publikację, zanim podepnie go pod wpis.
    expect(byName("Zofia").textContent).toContain("ekspert");
    expect(byName("Zofia").textContent).not.toContain("profil niepubliczny");
    expect(byName("Bartosz").textContent).toContain("profil niepubliczny");
    expect(byName("Bartosz").textContent).not.toContain("ekspert");
    expect(byName("Hanna").textContent).not.toContain("ekspert");
    expect(byName("Hanna").textContent).not.toContain("profil niepubliczny");
  });

  it.each([
    [1, "osoba"],
    [3, "osoby"],
    [5, "osób"],
    [11, "osób"],
    [13, "osób"],
    [22, "osoby"],
  ])("stopka odmienia liczebnik: %i -> %s", async (total, form) => {
    h.base = baseOf(crowd(total));
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    // KONSEKWENCJA: zła odmiana w stopce jest jedynym miejscem, w którym
    // redakcja widzi wielkość bazy - błąd tutaj czyta się jak błąd danych.
    // Sam wyjątek 12-14 („osób", nie „osoby") jest tu przypięty osobno.
    await waitFor(() =>
      expect(
        screen.getByText(`Baza wewnętrzna: ${total} ${form} · 1 z odznaką „ekspert"`),
      ).toBeTruthy(),
    );
  });

  it("stopka po angielsku odmienia „person/people” i nie miesza języków", async () => {
    h.base = baseOf([zofia]);
    const { unmount } = renderWithQueryClient(
      <ExpertPicker lang="en" value="" onSelect={vi.fn()} />,
    );
    await open();
    await waitFor(() =>
      expect(screen.getByText("Internal base: 1 person · 1 with the “expert” badge")).toBeTruthy(),
    );
    expect(screen.getByLabelText("Search: name, job title, organisation…")).toBeTruthy();
    unmount();

    h.base = baseOf([zofia, bartosz]);
    renderWithQueryClient(<ExpertPicker lang="en" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() =>
      expect(screen.getByText("Internal base: 2 people · 1 with the “expert” badge")).toBeTruthy(),
    );
  });

  it("angielski stan pusty i etykieta zastępcza nie zostają po polsku", async () => {
    h.base = baseOf([]);
    renderWithQueryClient(<ExpertPicker lang="en" value="" onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")[0].textContent).toContain("Pick a person from the base");
    await open();
    await waitFor(() => expect(screen.getByText("No matches in the internal base.")).toBeTruthy());
    expect(screen.queryByText(PL_EMPTY)).toBeNull();
  });

  it("widok OGRANICZONY jest powiedziany wprost, a pełny nie straszy komunikatem", async () => {
    h.base = baseOf(TRIO, { restricted: true });
    const { unmount } = renderWithQueryClient(
      <ExpertPicker lang="pl" value="" onSelect={vi.fn()} />,
    );
    await open();
    // KONSEKWENCJA: bez tego zdania staff bez roli admina czyta skróconą listę
    // jako pełną bazę i uznaje, że osoby po prostu w niej nie ma.
    await waitFor(() => expect(screen.getByText(PL_RESTRICTED)).toBeTruthy());
    unmount();

    h.base = baseOf(TRIO);
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() => expect(screen.getByText(/Baza wewnętrzna: 3 osoby/)).toBeTruthy());
    expect(screen.queryByText(PL_RESTRICTED)).toBeNull();
  });

  it("po angielsku komunikat o ograniczeniu też jest po angielsku", async () => {
    h.base = baseOf(TRIO, { restricted: true });
    renderWithQueryClient(<ExpertPicker lang="en" value="" onSelect={vi.fn()} />);
    await open();
    await waitFor(() =>
      expect(
        screen.getByText("Limited to published profiles - an administrator sees the full base."),
      ).toBeTruthy(),
    );
  });
});

describe("ExpertPicker - stany zapytania", () => {
  it("w locie: lista i stopka mówią o wczytywaniu, a nie o pustej bazie", async () => {
    let release = () => undefined as void;
    h.gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    // KONSEKWENCJA: gdyby w locie pokazywał się stan pusty, redakcja przy
    // wolnej sieci widziałaby „brak dopasowań" i porzucała kontrolkę.
    expect(screen.getAllByText(PL_LOADING).length).toBe(2); // lista + stopka
    expect(screen.queryByText(PL_EMPTY)).toBeNull();
    release();
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(screen.queryByText(PL_LOADING)).toBeNull();
  });

  it("awaria zapytania nie wywala kontrolki: stan pusty na liście, wczytywanie w stopce", async () => {
    h.fail = true;
    renderWithQueryClient(<ExpertPicker lang="pl" value="u-1" onSelect={vi.fn()} />);
    await open();
    // KONSEKWENCJA: rzut przy błędzie RPC zabiłby cały panel właściwości
    // widgetu, nie tylko tę kontrolkę.
    await waitFor(() => expect(screen.getByText(PL_EMPTY)).toBeTruthy());
    expect(screen.getAllByText(PL_LOADING)).toHaveLength(1); // sama stopka
    expect(screen.getAllByRole("button")[0].textContent).toContain(PL_PLACEHOLDER);
  });
});

describe("ExpertPicker - klawiatura i dostępność", () => {
  it("wyzwalacz i każda pozycja są NATYWNYMI przyciskami `type=button`", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} onClear={vi.fn()} />);
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    const clickable = [screen.getAllByRole("button")[0], ...options()];
    for (const el of clickable) {
      // KONSEKWENCJA: `div` z `onClick` nie reaguje na Enter ani Spację -
      // kontrolka byłaby nieosiągalna z klawiatury. A brak `type="button"`
      // wysyła formularz edytora przy pierwszym Enterze.
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
  });

  it("po otwarciu ognisko siedzi w polu szukania - pisze się bez myszy", async () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    await open();
    // KONSEKWENCJA: bez tego redakcja po otwarciu musi trafić myszą w pole,
    // a przy 40+ profilach lista bez zawężenia jest bezużyteczna.
    expect(document.activeElement).toBe(search());
  });

  // NAPRAWIONE W PRODUKCJI 2026-09-02 (jedna linia + dwa napisy w słowniku `T`):
  // `div role="listbox"` nie miał nazwy dostępnej, co axe zgłasza jako
  // `aria-input-field-name` (WCAG 2.1 A, 4.1.2, waga „serious"). KONSEKWENCJA:
  // czytnik ekranu ogłaszał w panelu właściwości gołe „listbox" - nierozróżnialne
  // od dowolnej innej listy na tym samym ekranie, więc redakcja niewidząca
  // nie wiedziała, czy stoi w liście osób, czy w liście widgetów. Naprawa
  // (`aria-label={t.listbox}` + klucz `listbox` w T.pl i T.en) jest lokalna,
  // nie zmienia zachowania i nie dotyka żadnego wołającego. Dlatego ten test
  // NIE wyłącza reguły - zostaje pełną bramką na resztę drzewa.
  it("nie wnosi naruszeń dostępności ani zamknięta, ani otwarta", async () => {
    const { container } = renderWithQueryClient(
      <ExpertPicker
        lang="pl"
        value="u-1"
        onSelect={vi.fn()}
        onClear={vi.fn()}
        noneLabel="- Brak (dane ręczne) -"
      />,
    );
    // Czekamy na rozwiązanie zapytania PRZED pomiarem: inaczej stan spływa
    // w trakcie przebiegu axe i React słusznie krzyczy o `act(...)`.
    await waitFor(() => expect(screen.getAllByText("Zofia Wiatrak").length).toBe(1));
    const closed = await axeViolations(container);
    expect(closed, summarize(closed)).toEqual([]);
    await open();
    await waitFor(() => expect(options()).toHaveLength(4));
    const opened = await axeViolations(container);
    expect(opened, summarize(opened)).toEqual([]);
  });
});

describe("kontrola narzędzia testowego", () => {
  it("atrapa Popovera faktycznie odcina warstwę - inaczej testy stanu pustego kłamią", () => {
    renderWithQueryClient(<ExpertPicker lang="pl" value="" onSelect={vi.fn()} />);
    // Zamknięta warstwa NIE renderuje ani pola szukania, ani stopki: gdyby
    // atrapa pokazywała treść zawsze, wszystkie asercje „po otwarciu"
    // przechodziłyby także bez kliknięcia i nie dowodziłyby niczego.
    expect(screen.queryByTestId("popover-content")).toBeNull();
    expect(screen.queryByLabelText(PL_SEARCH)).toBeNull();
    expect(screen.queryByText(PL_LOADING)).toBeNull();
  });
});
