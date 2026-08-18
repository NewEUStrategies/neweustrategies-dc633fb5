// Autosuggest pod polem frazy na /search - test KOMPONENTU.
//
// Poprzedni plik o tej nazwie nie importował komponentu (patrz nagłówek
// `lib/search/__tests__/facetModelSuggestions.test.ts`), więc 19 funkcji tego
// pliku nie było wykonanych ani razu.
//
// ZAKRES. Komponent jest sterowany: rodzic (`routes/search.tsx`) trzyma frazę,
// `activeIndex` i obsługę klawiatury, a tu żyje render + lokalny stan zakładki.
// Dlatego NIE MA tu testów strzałek/Enter/Escape ani zamykania kliknięciem poza
// obszarem - tego kodu w tym pliku nie ma, a test „nawigacji klawiaturą" na
// komponencie bez nasłuchu klawiatury dowodziłby wyłącznie tego, że nic się nie
// dzieje. Sprawdzamy KONTRAKT z rodzicem: globalny indeks opcji przez kubełki,
// `aria-activedescendant`-owalne id-ki i wywołania zwrotne.
//
// i18n: PRAWDZIWY tłumacz (`@/test/i18nReal` + nakładka `@/lib/i18n-search`).
// Atrapa `defaultValue ?? key` mierzyłaby napis wpisany w kodzie komponentu,
// nie słownik - repo zdjęło już raz 47 takich asercji.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import type { AutosuggestItem } from "@/lib/queries/archives";
import { ok, supabaseFromStub } from "@/test/supabaseChain";

const stubs = vi.hoisted(() => ({ from: null as ReturnType<typeof supabaseFromStub> | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: make } = await import("@/test/supabaseChain");
  const from = make();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

// Rejestruje `search.*` w prawdziwej instancji i18next (efekt uboczny importu),
// a `i18nReal` domyka oba rdzenie (PL i EN) top-level awaitem.
import "@/test/i18nReal";
import "@/lib/i18n-search";
import { SearchAutosuggest, RecentSearchesList } from "../SearchAutosuggest";

const item = (p: Partial<AutosuggestItem>): AutosuggestItem => ({
  kind: "post",
  id: "id-1",
  slug: "slug-1",
  label_pl: "Etykieta PL",
  label_en: "Label EN",
  parentPageId: null,
  score: 0,
  ...p,
});

/** Po jednym wpisie na kubełek, w kolejności innej niż prezentacyjna - render
 *  MUSI je przestawić na titles → contentTypes → topics → peopleOrg. */
const oneOfEach = (): AutosuggestItem[] => [
  item({ kind: "author", id: "a-1", slug: "jan-kowalski", label_pl: "Jan Kowalski" }),
  item({ kind: "topic", id: "t-1", slug: "energia", label_pl: "Energia" }),
  item({ kind: "post", id: "p-1", slug: "raport", label_pl: "Raport roczny" }),
  item({ kind: "format", id: null, slug: "video", label_pl: "Wideo" }),
];

const noop = () => {};

beforeEach(() => {
  stubs.from?.reset();
  // Autor w podpowiedziach uruchamia dociąganie avatarów; domyślnie pusto.
  stubs.from?.setResponse("profiles_public", ok([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SearchAutosuggest - render pustego zbioru", () => {
  it("nie renderuje NICZEGO dla pustej listy (popover nie może mrugnąć pustą ramką)", () => {
    const { container } = render(
      <SearchAutosuggest items={[]} activeIndex={-1} lang="pl" onPick={noop} query="energia" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SearchAutosuggest - grupowanie i indeks globalny", () => {
  it("układa kubełki w kolejności tytuły → rodzaje treści → tematyka → osoby", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      expect.stringContaining("Raport roczny"),
      expect.stringContaining("Wideo"),
      expect.stringContaining("Energia"),
      expect.stringContaining("Jan Kowalski"),
    ]);
  });

  it("nadaje opcjom CIĄGŁY indeks przez granice kubełków - kontrakt z klawiaturą rodzica", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.id)).toEqual([
      "search-suggest-opt-0",
      "search-suggest-opt-1",
      "search-suggest-opt-2",
      "search-suggest-opt-3",
    ]);
    expect(screen.getByRole("listbox").id).toBe("search-autosuggest-listbox");
  });

  it("zaznacza DOKŁADNIE jedną opcję wskazaną przez activeIndex", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={2} lang="pl" onPick={noop} query="e" />,
    );
    const selected = screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("search-suggest-opt-2");
    expect(selected[0].textContent).toContain("Energia");
  });

  it("activeIndex poza zakresem nie zaznacza niczego (rodzic startuje od -1)", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    expect(
      screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true"),
    ).toHaveLength(0);
  });

  it("nagłówek grupy niesie etykietę kubełka i liczbę wpisów", () => {
    const items = [
      item({ kind: "post", id: "p-1", slug: "a", label_pl: "A" }),
      item({ kind: "post", id: "p-2", slug: "b", label_pl: "B" }),
    ];
    render(<SearchAutosuggest items={items} activeIndex={-1} lang="pl" onPick={noop} query="a" />);
    // "Tytuły" pada dwa razy: raz jako zakładka, raz jako nagłówek grupy.
    expect(screen.getAllByText("Tytuły")).toHaveLength(2);
    // Licznik grupy i licznik zakładki - oba pokazują 2.
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Osoby i organizacje")).not.toBeInTheDocument();
  });

  it("wiersz prowadzi pod adres z modelu i pokazuje rodzaj treści", () => {
    render(
      <SearchAutosuggest
        items={[item({ kind: "post", slug: "raport-roczny", label_pl: "Raport" })]}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="raport"
      />,
    );
    const option = screen.getByRole("option");
    expect(option).toHaveAttribute("href", "/post/raport-roczny");
    expect(option.textContent).toContain("Publikacja");
  });
});

describe("SearchAutosuggest - język", () => {
  it("po angielsku bierze label_en, po polsku label_pl", () => {
    const items = [item({ kind: "post", label_pl: "Polski tytuł", label_en: "English title" })];
    const { rerender } = render(
      <SearchAutosuggest items={items} activeIndex={-1} lang="pl" onPick={noop} query="x" />,
    );
    expect(screen.getByText("Polski tytuł")).toBeInTheDocument();
    rerender(
      <SearchAutosuggest items={items} activeIndex={-1} lang="en" onPick={noop} query="x" />,
    );
    expect(screen.getByText("English title")).toBeInTheDocument();
    expect(screen.getAllByText("Titles")).toHaveLength(2);
  });

  it("brak tłumaczenia etykiety spada na drugi język, nie na pusty wiersz", () => {
    const items = [item({ kind: "post", label_pl: "", label_en: "Only English" })];
    render(<SearchAutosuggest items={items} activeIndex={-1} lang="pl" onPick={noop} query="x" />);
    expect(screen.getByText("Only English")).toBeInTheDocument();
  });

  it("wpis bez jakiejkolwiek etykiety renderuje wiersz, a nie wywala listy", () => {
    const items = [item({ kind: "post", label_pl: "", label_en: "" })];
    render(<SearchAutosuggest items={items} activeIndex={-1} lang="pl" onPick={noop} query="x" />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});

describe("SearchAutosuggest - zakładki kubełków", () => {
  it("bez frazy NIE MA paska zakładek ani stopki (popover „ostatnie wyszukiwania”)", () => {
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="   "
        onSubmitPhrase={noop}
        onSetQuery={noop}
      />,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("Operatory")).not.toBeInTheDocument();
  });

  it("pokazuje zakładkę „Wszystko” i po jednej na NIEPUSTY kubełek", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    const names = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(names).toHaveLength(5);
    expect(names[0]).toContain("Wszystko");
    expect(names[0]).toContain("4");
  });

  it("pomija zakładkę kubełka bez wpisów", () => {
    render(
      <SearchAutosuggest
        items={[item({ kind: "post", label_pl: "Tylko tytuł" })]}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="e"
      />,
    );
    const names = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.includes("Osoby i organizacje"))).toBe(false);
  });

  it("wybór zakładki zawęża listę do jednego kubełka i przełącza aria-selected", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    const topics = screen.getByRole("tab", { name: /Tematyka/ });
    fireEvent.mouseDown(topics);
    expect(topics).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Wszystko/ })).toHaveAttribute("aria-selected", "false");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Energia");
  });

  it("zawężenie NIE PRZENUMEROWUJE opcji - indeks zostaje globalny", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Osoby i organizacje/ }));
    // Autor jest czwarty w porządku globalnym - po zawężeniu nadal ma indeks 3.
    expect(screen.getByRole("option").id).toBe("search-suggest-opt-3");
  });

  it("powrót na „Wszystko” przywraca komplet", () => {
    render(
      <SearchAutosuggest items={oneOfEach()} activeIndex={-1} lang="pl" onPick={noop} query="e" />,
    );
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Tematyka/ }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Wszystko/ }));
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });
});

describe("SearchAutosuggest - wybór wpisu", () => {
  it("mousedown oddaje wpis rodzicowi i BLOKUJE domyślną nawigację linku", () => {
    const onPick = vi.fn();
    const picked = item({ kind: "post", slug: "raport", label_pl: "Raport" });
    render(
      <SearchAutosuggest items={[picked]} activeIndex={-1} lang="pl" onPick={onPick} query="r" />,
    );
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("option").dispatchEvent(event);
    expect(onPick).toHaveBeenCalledWith(picked);
    // Bez preventDefault link zabrałby fokus z inputa i popover by się zamknął.
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("SearchAutosuggest - stopka frazy", () => {
  it("„zobacz wszystkie” oddaje PRZYCIĘTĄ frazę", () => {
    const onSubmitPhrase = vi.fn();
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="  energia  "
        onSubmitPhrase={onSubmitPhrase}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: /Zobacz wszystkie wyniki/ }));
    expect(onSubmitPhrase).toHaveBeenCalledWith("energia");
  });

  it("bez onSubmitPhrase nie ma wiersza „zobacz wszystkie”, ale stopka operatorów zostaje", () => {
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="energia"
        onSetQuery={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /Zobacz wszystkie wyniki/ })).not.toBeInTheDocument();
    expect(screen.getByText("Operatory")).toBeInTheDocument();
  });

  it("bez obu wywołań zwrotnych stopki nie ma wcale", () => {
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="energia"
      />,
    );
    expect(screen.queryByText("Operatory")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
  });

  it("link „zaawansowane” niesie bieżącą frazę", () => {
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="polityka energetyczna"
        onSetQuery={noop}
      />,
    );
    expect(screen.getByRole("link", { name: /Wyszukiwanie zaawansowane/ })).toHaveAttribute(
      "href",
      "/search?q=polityka%20energetyczna&adv=1",
    );
  });

  it("jawny advHref wygrywa z adresem wyliczonym z frazy", () => {
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="energia"
        onSetQuery={noop}
        advHref="/people?adv=1"
      />,
    );
    expect(screen.getByRole("link", { name: /Wyszukiwanie zaawansowane/ })).toHaveAttribute(
      "href",
      "/people?adv=1",
    );
  });
});

describe("SearchAutosuggest - wstawianie operatorów", () => {
  /** Input rodzica z ustawionym kursorem - operator wchodzi W MIEJSCE kursora. */
  function renderWithInput(query: string, selection: [number, number]) {
    const onSetQuery = vi.fn();
    const input = document.createElement("input");
    input.value = query;
    document.body.appendChild(input);
    input.setSelectionRange(selection[0], selection[1]);
    const ref = createRef<HTMLInputElement>();
    Object.defineProperty(ref, "current", { value: input, writable: true });
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query={query}
        inputRef={ref}
        onSetQuery={onSetQuery}
      />,
    );
    return { onSetQuery, input };
  }

  it("AND wchodzi w miejsce kursora, a kursor ląduje za operatorem", () => {
    const { onSetQuery } = renderWithInput("gaz ropa", [3, 3]);
    fireEvent.mouseDown(screen.getByRole("button", { name: "AND" }));
    expect(onSetQuery).toHaveBeenCalledWith("gaz AND  ropa", 8);
  });

  it("cudzysłów frazy stawia kursor MIĘDZY znakami, nie za nimi", () => {
    const { onSetQuery } = renderWithInput("gaz", [0, 0]);
    fireEvent.mouseDown(screen.getByRole("button", { name: '"fraza"' }));
    expect(onSetQuery).toHaveBeenCalledWith('"" gaz', 1);
  });

  it("operator zastępuje ZAZNACZONY fragment", () => {
    const { onSetQuery } = renderWithInput("gaz XXX ropa", [4, 7]);
    fireEvent.mouseDown(screen.getByRole("button", { name: "OR" }));
    expect(onSetQuery).toHaveBeenCalledWith("gaz  OR  ropa", 8);
  });

  it("przywraca fokus na input po wstawieniu (inaczej użytkownik pisze w próżnię)", async () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const { input } = renderWithInput("gaz", [3, 3]);
    fireEvent.mouseDown(screen.getByRole("button", { name: "NOT" }));
    await waitFor(() => expect(document.activeElement).toBe(input));
    raf.mockRestore();
  });

  it("bez refa inputa klik operatora jest bezpiecznym no-opem", () => {
    const onSetQuery = vi.fn();
    render(
      <SearchAutosuggest
        items={oneOfEach()}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="gaz"
        onSetQuery={onSetQuery}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "AND" }));
    expect(onSetQuery).not.toHaveBeenCalled();
  });

  it("operator wykluczenia bierze etykietę ze słownika", () => {
    const { onSetQuery } = renderWithInput("gaz", [3, 3]);
    fireEvent.mouseDown(screen.getByRole("button", { name: "-słowo" }));
    expect(onSetQuery).toHaveBeenCalledWith("gaz -", 5);
  });
});

describe("SearchAutosuggest - avatary autorów", () => {
  it("dociąga avatar autora i pokazuje go zamiast ikony", async () => {
    stubs.from?.setResponse("profiles_public", ok([{ id: "a-1", avatar_url: "/av/jan.webp" }]));
    const { container } = render(
      <SearchAutosuggest
        items={[item({ kind: "author", id: "a-1", slug: "jan", label_pl: "Jan" })]}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="jan"
      />,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", "/av/jan.webp");
    // Odpytujemy WYŁĄCZNIE o autorów z listy.
    expect(stubs.from?.lastChain("profiles_public")?.argsOf("in")).toEqual(["id", ["a-1"]]);
  });

  it("autor bez avatara zostaje przy ikonie - brak pustego <img>", async () => {
    stubs.from?.setResponse("profiles_public", ok([{ id: "a-1", avatar_url: null }]));
    const { container } = render(
      <SearchAutosuggest
        items={[item({ kind: "author", id: "a-1", slug: "jan", label_pl: "Jan" })]}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="jan"
      />,
    );
    await waitFor(() => expect(stubs.from?.chainsFor("profiles_public")).toHaveLength(1));
    expect(container.querySelector("img")).toBeNull();
  });

  it("lista bez autorów NIE odpytuje bazy", () => {
    render(
      <SearchAutosuggest
        items={[item({ kind: "post", label_pl: "Raport" })]}
        activeIndex={-1}
        lang="pl"
        onPick={noop}
        query="raport"
      />,
    );
    expect(stubs.from?.chainsFor("profiles_public")).toHaveLength(0);
  });
});

describe("RecentSearchesList", () => {
  it("pusta historia nie renderuje niczego", () => {
    const { container } = render(
      <RecentSearchesList items={[]} lang="pl" onPick={noop} onClear={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje terminy jako linki do wyników, z kodowaniem frazy", () => {
    render(
      <RecentSearchesList
        items={["polityka energetyczna", "NATO"]}
        lang="pl"
        onPick={noop}
        onClear={noop}
      />,
    );
    expect(screen.getByText("Ostatnie wyszukiwania")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /polityka energetyczna/ })).toHaveAttribute(
      "href",
      "/search?q=polityka%20energetyczna",
    );
  });

  it("po angielsku bierze angielskie etykiety", () => {
    render(<RecentSearchesList items={["NATO"]} lang="en" onPick={noop} onClear={noop} />);
    expect(screen.getByText("Recent searches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear history" })).toBeInTheDocument();
  });

  it("klik terminu oddaje frazę rodzicowi i blokuje nawigację", () => {
    const onPick = vi.fn();
    render(<RecentSearchesList items={["NATO"]} lang="pl" onPick={onPick} onClear={noop} />);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("option").dispatchEvent(event);
    expect(onPick).toHaveBeenCalledWith("NATO");
    expect(event.defaultPrevented).toBe(true);
  });

  it("„wyczyść historię” woła onClear", () => {
    const onClear = vi.fn();
    render(<RecentSearchesList items={["NATO"]} lang="pl" onPick={noop} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść historię" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
