// Droplista tematów: grupowanie katalogu, wybór wielokrotny, portal, zakładki grup.
//
// CO TEN PLIK DOWODZI. `TopicsDroplist.tsx` to JEDNO źródło prawdy dla wyboru
// tematów we WSZYSTKICH widgetach newslettera („Dołącz do nas", widget
// „Newsletter", popup zapisu). Stał na 32% linii przy 131 niepokrytych. Cztery
// reguły, których złamanie widzi zapisujący się, nie administrator:
//
//   1. GRUPOWANIE PO OBSZARZE RODZICA. Kategoria-dziecko idzie pod etykietę
//      rodzica („Region" → Afryka), top-level pod „Obszary", tagi pod „Tematy".
//      Zła przynależność zamienia listę w płaski worek pięćdziesięciu pozycji.
//   2. PUSTY KATALOG NIE RENDERUJE PUSTEJ RAMKI. Widget bez tematów w bazie
//      pokazywałby nagłówek i przycisk otwierający puste okno.
//   3. ZAWĘŻENIE LISTY PRZEZ `interestSlugs`. Konfiguracja widgetu ogranicza
//      wybór do wskazanych slugów; slug nieistniejący w katalogu musi po prostu
//      wypaść, a nie wyzerować całej listy.
//   4. POPUP JEST PORTALOWANY I ZAMYKA SIĘ NA `Escape` ORAZ KLIKNIĘCIU OBOK.
//      Bez portalu okno przycina pierwszy kontener z `overflow: hidden` - a to
//      jest karta widgetu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - ROZMIARÓW Z BUDOWNICZEGO: `joinUsWidgetSizes.test.tsx` dowodzi, że
//   `labelSize`/`placeholderSize` docierają do DOM i wygrywają z kaskadą.
// - ETYKIET I PODPISÓW: `lib/newsletter/newsletterFieldLabels` ma własne testy;
//   tutaj asertujemy przez `topicLabel`/`topicsTriggerText`, żeby test nie padał
//   przy pierwszej korekcie tłumaczenia.
// - WARSTWY DANYCH KATALOGU: `useInterestCatalog` ma tabelę przypadków
//   w `src/hooks/__tests__/useInterests.test.tsx`.
//
// CZEGO W TYM KOMPONENCIE NIE MA - i dlatego tego nie testujemy: POLA
// WYSZUKIWANIA, NAWIGACJI STRZAŁKAMI ANI LIMITU LICZBY WYBORÓW. Droplista
// tematów ma zakładki grup i przewijanie; wyszukiwanie z diakrytykami i obsługa
// strzałek żyją w `CountryCombobox` (własny plik testowy). Limit wyborów nie
// istnieje w żadnym z tych komponentów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  categories: [] as Record<string, unknown>[],
  tags: [] as Record<string, unknown>[],
}));

vi.mock("@/integrations/supabase/client", () => {
  interface Chain {
    select: () => Chain;
    order: () => Chain;
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => unknown;
  }
  const makeChain = (table: string): Chain => {
    const chain: Chain = {
      select: () => chain,
      order: () => chain,
      then: (resolve) =>
        resolve({ data: table === "categories" ? h.categories : h.tags, error: null }),
    };
    return chain;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      channel: () => channel,
      removeChannel: () => Promise.resolve("ok"),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import {
  TopicsDroplist,
  GroupTabs,
  useInterestGroups,
} from "@/components/interests/TopicsDroplist";
import type { InterestItem } from "@/hooks/useInterests";
import { topicLabel, topicsTriggerText } from "@/lib/newsletter/newsletterFieldLabels";
import { axeViolations, summarize } from "@/test/axe";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Pozycja katalogu w kształcie, jaki daje `useInterestCatalog`. */
function item(patch: Partial<InterestItem> & Pick<InterestItem, "id">): InterestItem {
  return {
    type: "category",
    label: patch.id,
    slug: patch.id,
    parentId: null,
    parentLabel: null,
    parentSlug: null,
    ...patch,
  };
}

const AFRYKA = item({
  id: "afryka",
  label: "Afryka",
  parentId: "region",
  parentLabel: "Region",
  parentSlug: "region",
});
const AZJA = item({
  id: "azja",
  label: "Azja",
  parentId: "region",
  parentLabel: "Region",
  parentSlug: "region",
});
const HANDEL = item({ id: "handel", label: "Handel", type: "tag" });

const GROUPS = [
  { key: "root:region", title: "Region", items: [AFRYKA, AZJA], parentSlug: "region" },
  { key: "tags", title: "Tematy", items: [HANDEL], parentSlug: null },
];

function mountDroplist(
  props: Partial<React.ComponentProps<typeof TopicsDroplist>> = {},
  picked: string[] = [],
) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  const utils = render(
    <TopicsDroplist
      lang="pl"
      allItems={[AFRYKA, AZJA, HANDEL]}
      groups={GROUPS}
      picked={new Set(picked)}
      onToggle={onToggle}
      onClear={onClear}
      {...props}
    />,
  );
  return { ...utils, onToggle, onClear };
}

const trigger = () => screen.getByRole("button", { expanded: false, hidden: true });
async function openDroplist() {
  fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(0, "pl") }));
  await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
}

beforeEach(() => {
  h.categories = [];
  h.tags = [];
});

afterEach(() => cleanup());

describe("useInterestGroups - grupowanie katalogu", () => {
  it("kategoria-dziecko idzie pod etykietę RODZICA, nie pod „Obszary”", async () => {
    // Bez tego „Afryka" i „Dyplomacja" siedziałyby w jednym worku i lista
    // przestałaby mieć strukturę widoczną dla wybierającego.
    h.categories = [
      { id: "region", slug: "region", name_pl: "Region", name_en: "Region", parent_id: null },
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: "Africa", parent_id: "region" },
    ];
    const { result } = renderHook(() => useInterestGroups("pl"), { wrapper });
    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0));
    const region = result.current.groups.find((g) => g.key === "root:region");
    expect(region?.title).toBe("Region");
    expect(region?.items.map((i) => i.id)).toEqual(["afryka"]);
  });

  it("kategoria top-level ląduje w grupie „Obszary”", async () => {
    h.categories = [
      { id: "obszar", slug: "obszar", name_pl: "Obszar", name_en: "Area", parent_id: null },
    ];
    const { result } = renderHook(() => useInterestGroups("pl"), { wrapper });
    await waitFor(() => expect(result.current.groups.length).toBe(1));
    expect(result.current.groups[0]).toMatchObject({
      key: "top",
      title: topicLabel("areas", "pl"),
    });
  });

  it("tagi jadą na KONIEC, we własnej grupie „Tematy”", async () => {
    h.categories = [
      { id: "obszar", slug: "obszar", name_pl: "Obszar", name_en: null, parent_id: null },
    ];
    h.tags = [{ id: "handel", slug: "handel", name: "Handel" }];
    const { result } = renderHook(() => useInterestGroups("pl"), { wrapper });
    await waitFor(() => expect(result.current.groups).toHaveLength(2));
    expect(result.current.groups.at(-1)).toMatchObject({
      key: "tags",
      title: topicLabel("topics", "pl"),
    });
  });

  it("hierarchia głębsza niż dwa poziomy wchodzi pod KORZEŃ, nie pod bezpośredniego rodzica", async () => {
    // Trzeci poziom katalogu istnieje w bazie; grupowanie po bezpośrednim
    // rodzicu rozsypałoby listę na dziesiątki jednoelementowych grup.
    h.categories = [
      { id: "region", slug: "region", name_pl: "Region", name_en: null, parent_id: null },
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: "region" },
      { id: "sahel", slug: "sahel", name_pl: "Sahel", name_en: null, parent_id: "afryka" },
    ];
    const { result } = renderHook(() => useInterestGroups("pl"), { wrapper });
    await waitFor(() => expect(result.current.groups.length).toBeGreaterThan(0));
    const region = result.current.groups.find((g) => g.key === "root:region");
    expect(region?.items.map((i) => i.id).sort()).toEqual(["afryka", "sahel"]);
  });

  it("`interestSlugs` zawęża listę do wskazanych pozycji", async () => {
    h.categories = [
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: null },
      { id: "azja", slug: "azja", name_pl: "Azja", name_en: null, parent_id: null },
    ];
    const { result } = renderHook(() => useInterestGroups("pl", ["  AFRYKA  "]), { wrapper });
    // Porównanie bez wielkości znaków i po obcięciu spacji: slugi wpisuje
    // administrator w panelu widgetu, ręcznie.
    await waitFor(() => expect(result.current.allItems.map((i) => i.id)).toEqual(["afryka"]));
  });

  it("`interestSlugs` z samymi nieznanymi slugami daje PUSTĄ listę, nie całą", async () => {
    // Odwrotne zachowanie („nie znam żadnego, więc pokaż wszystko") zamieniłoby
    // literówkę w konfiguracji w pełną listę pięćdziesięciu tematów.
    h.categories = [
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: null },
    ];
    const { result } = renderHook(() => useInterestGroups("pl", ["nie-ma-takiego"]), { wrapper });
    await waitFor(() => expect(result.current.catalog.data).toBeTruthy());
    expect(result.current.allItems).toEqual([]);
    expect(result.current.groups).toEqual([]);
  });

  it("pusta lista `interestSlugs` znaczy „bez zawężenia”", async () => {
    h.categories = [
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: null },
    ];
    const { result } = renderHook(() => useInterestGroups("pl", []), { wrapper });
    await waitFor(() => expect(result.current.allItems).toHaveLength(1));
  });

  it("grupa bez pozycji po zawężeniu nie trafia do wyniku", async () => {
    h.categories = [
      { id: "region", slug: "region", name_pl: "Region", name_en: null, parent_id: null },
      { id: "afryka", slug: "afryka", name_pl: "Afryka", name_en: null, parent_id: "region" },
    ];
    h.tags = [{ id: "handel", slug: "handel", name: "Handel" }];
    const { result } = renderHook(() => useInterestGroups("pl", ["afryka"]), { wrapper });
    await waitFor(() => expect(result.current.groups).toHaveLength(1));
    // Grupa „Tematy" nie powstaje, bo po zawężeniu nie ma ani jednego tagu.
    expect(result.current.groups[0].key).toBe("root:region");
  });
});

describe("TopicsDroplist - tryb droplisty", () => {
  it("PUSTY katalog nie renderuje NICZEGO - ani nagłówka, ani przycisku", () => {
    const { container } = render(
      <TopicsDroplist
        lang="pl"
        allItems={[]}
        groups={[]}
        picked={new Set()}
        onToggle={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("przycisk pokazuje placeholder, gdy nic nie wybrano", () => {
    mountDroplist();
    expect(screen.getByRole("button", { name: topicsTriggerText(0, "pl") })).toBeTruthy();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("przycisk pokazuje LICZNIK wybranych", () => {
    mountDroplist({}, ["afryka", "handel"]);
    expect(screen.getByRole("button", { name: topicsTriggerText(2, "pl") })).toBeTruthy();
  });

  it("wybrane pozycje mają pigułkę z przyciskiem odznaczenia", () => {
    const { onToggle } = mountDroplist({}, ["afryka"]);
    const remove = screen.getByRole("button", { name: "Usuń Afryka" });
    fireEvent.click(remove);
    expect(onToggle).toHaveBeenCalledWith("afryka");
  });

  it("etykieta odznaczenia jest w języku interfejsu", () => {
    mountDroplist({ lang: "en" }, ["afryka"]);
    expect(screen.getByRole("button", { name: "Remove Afryka" })).toBeTruthy();
  });

  it("bez wyboru NIE renderuje pustego wiersza pigułek", () => {
    const { container } = mountDroplist();
    expect(container.querySelectorAll(".flex.flex-wrap.gap-1\\.5")).toHaveLength(0);
  });

  it("nagłówek sekcji można nadpisać z konfiguracji widgetu", () => {
    mountDroplist({ heading: "Twoje obszary" });
    expect(screen.getByText("Twoje obszary")).toBeTruthy();
  });

  it("nadpisanie samymi spacjami cofa się do etykiety domyślnej", () => {
    mountDroplist({ heading: "   " });
    expect(screen.getByText(topicLabel("heading", "pl"))).toBeTruthy();
  });

  it("otwarcie renderuje okno PRZEZ PORTAL, poza drzewem komponentu", async () => {
    // Bez portalu okno przycina pierwszy kontener z `overflow: hidden` -
    // a to jest karta widgetu.
    const { container } = mountDroplist();
    await openDroplist();
    expect(container.querySelector('[data-testid="topics-popup"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="topics-popup"]')).toBeTruthy();
  });

  it("okno jest listą wielokrotnego wyboru i wystawia każdą pozycję jako opcję", async () => {
    mountDroplist();
    await openDroplist();
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("kliknięcie opcji zgłasza JEJ identyfikator", async () => {
    const { onToggle } = mountDroplist();
    await openDroplist();
    fireEvent.click(screen.getByRole("option", { name: "Azja" }));
    expect(onToggle).toHaveBeenCalledWith("azja");
  });

  it("wybrana opcja jest oznaczona `aria-selected`", async () => {
    mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getByRole("option", { name: "Afryka" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("option", { name: "Azja" }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("licznik grupy pokazuje „wybrane/wszystkie” tylko wtedy, gdy coś wybrano", async () => {
    // Zapytanie zawężone do NAGŁÓWKA sekcji: ten sam napis („2") pojawia się też
    // w zakładkach grup, a przedmiotem dowodu jest licznik przy nagłówku.
    const counterOf = (groupKey: string) =>
      document.querySelector(`[id$="-drop-grp-${groupKey}"] header span:last-child`)?.textContent;

    mountDroplist();
    await openDroplist();
    // Bez wyboru: sama liczba pozycji.
    expect(counterOf("root:region")).toBe("2");
    cleanup();

    mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(counterOf("root:region")).toBe("1/2"));
  });

  it("stopka pokazuje „Wyczyść” WYŁĄCZNIE przy niepustym wyborze", async () => {
    mountDroplist();
    await openDroplist();
    expect(screen.queryByText(topicLabel("clear", "pl"))).toBeNull();
    cleanup();

    const { onClear } = mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(screen.getByText(topicLabel("clear", "pl"))).toBeTruthy());
    fireEvent.click(screen.getByText(topicLabel("clear", "pl")));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("stopka bez wyboru mówi „nic nie wybrano”, nie zostaje pusta", async () => {
    mountDroplist();
    await openDroplist();
    expect(screen.getByText(topicLabel("empty", "pl"))).toBeTruthy();
  });

  it("„Gotowe” zamyka okno", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.click(screen.getByText(topicLabel("done", "pl")));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("`Escape` zamyka okno", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("inny klawisz NIE zamyka okna", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("kliknięcie POZA droplistą zamyka okno", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("kliknięcie WEWNĄTRZ okna NIE zamyka go - inaczej nie da się wybrać dwóch tematów", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("kliknięcie w sam przycisk otwierający też nie zamyka okna zdarzeniem dokumentu", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.mouseDown(screen.getByRole("button", { name: topicsTriggerText(0, "pl") }));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("ponowne kliknięcie przycisku zamyka okno", async () => {
    mountDroplist();
    await openDroplist();
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(0, "pl") }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("zakładki grup pojawiają się tylko przy WIĘCEJ NIŻ jednej grupie", async () => {
    mountDroplist({ groups: [GROUPS[0]] });
    await openDroplist();
    expect(screen.queryByRole("tablist")).toBeNull();
    cleanup();

    mountDroplist();
    await openDroplist();
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("okno przy krawędzi dolnej otwiera się DO GÓRY", async () => {
    // Okno wychodzące poza dolną krawędź jest nieużywalne na telefonie:
    // użytkownik widzi nagłówek grupy i nic więcej.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 10, width: 300, top: 700, bottom: 740 } as DOMRect);
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 760, configurable: true });

    mountDroplist();
    await openDroplist();
    const popup = screen.getByTestId("topics-popup");
    expect(popup.style.bottom).not.toBe("");
    expect(popup.style.top).toBe("");

    Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
    rect.mockRestore();
  });

  it("przeliczenie pozycji jedzie przy przewijaniu i zmianie rozmiaru okna", async () => {
    mountDroplist();
    await openDroplist();
    const before = screen.getByTestId("topics-popup").style.left;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 123, width: 300, top: 10, bottom: 50 } as DOMRect);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByTestId("topics-popup").style.left).toBe("123px"));
    expect(screen.getByTestId("topics-popup").style.left).not.toBe(before);
    fireEvent(window, new Event("resize"));
    rect.mockRestore();
  });

  it("otwarte okno droplisty NIE MA naruszeń dostępności", async () => {
    // NAPRAWIONE. Okno łamało trzy reguły ARIA:
    //   - `aria-required-children`: `role="listbox"` siedziało na POWŁOCE okna,
    //     więc obejmowało pasek zakładek grup (`role="tablist"`), sekcje
    //     z nagłówkami i stopkę z przyciskami. Lista wyboru może zawierać
    //     wyłącznie opcje i grupy, więc czytnik ekranu nie ogłaszał liczby opcji
    //     i część z nich w ogóle pomijał.
    //   - `aria-input-field-name` i `nested-interactive`: w każdej opcji stał
    //     `Checkbox` z Radiksa - pole wyboru BEZ NAZWY, zagnieżdżone w przycisku
    //     opcji. `aria-hidden` i `tabIndex={-1}` tego nie naprawiały, bo Radix
    //     i tak renderował `role="checkbox"`, czyli kontrolkę w kontrolce.
    //
    // Poprawka: rola listy przeniesiona na kontener przewijany (zawiera SAME
    // grupy), sekcje grup dostały `role="group"` z nazwą, opakowania układu
    // `role="presentation"`, a kwadracik zaznaczenia jest już tylko obrazkiem -
    // stan niesie `aria-selected` na samej opcji.
    //
    // Wybór tematów jest głównym krokiem zapisu do newslettera na czterech
    // powierzchniach, więc to nie była kosmetyka.
    mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(await axeViolations(document.body).then(summarize)).toBe("");
  });

  it("grupy są OGŁASZANE jako grupy z nazwą, a opcje należą do nich", async () => {
    // To jest treść poprawki widziana przez czytnik ekranu: „Region, grupa,
    // 2 elementy" zamiast płaskiej listy pięćdziesięciu przycisków.
    mountDroplist();
    await openDroplist();
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Region", "Tematy"]);
    expect(within(groups[0]).getAllByRole("option")).toHaveLength(2);
    expect(within(groups[1]).getAllByRole("option")).toHaveLength(1);
  });

  it("lista wyboru ma NAZWĘ - czytnik mówi, czego dotyczy", async () => {
    mountDroplist();
    await openDroplist();
    expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe(
      topicLabel("heading", "pl"),
    );
  });

  it("w opcji nie ma DRUGIEJ kontrolki - kwadracik zaznaczenia jest obrazkiem", async () => {
    mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    const option = screen.getByRole("option", { name: "Afryka" });
    expect(option.querySelector('[role="checkbox"]')).toBeNull();
    expect(within(option).queryAllByRole("button")).toHaveLength(0);
    // Stan zaznaczenia niesie sama opcja.
    expect(option.getAttribute("aria-selected")).toBe("true");
  });

  it("pasek zakładek grup stoi POZA listą wyboru", async () => {
    // Zakładki nawigują po liście, ale nie są jej elementami - wewnątrz listy
    // łamałyby regułę dozwolonych dzieci.
    mountDroplist();
    await openDroplist();
    expect(screen.getByRole("listbox").querySelector('[role="tablist"]')).toBeNull();
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("stopka z „Wyczyść” i „Gotowe” też stoi poza listą wyboru", async () => {
    mountDroplist({}, ["afryka"]);
    fireEvent.click(screen.getByRole("button", { name: topicsTriggerText(1, "pl") }));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).not.toContain(topicLabel("done", "pl"));
    expect(screen.getByText(topicLabel("done", "pl"))).toBeTruthy();
  });
});

describe("TopicsDroplist - nadpisania z buildera", () => {
  // Rozmiary i znaczniki edycji nie są kosmetyką: operator CMS klika element na
  // canvasie i oczekuje, że otworzy mu się edytor TEGO pola. Brak znacznika
  // otwiera edytor rodzica i zmiana „nie działa".
  it("rozmiar etykiety dociera do nagłówka sekcji", () => {
    const { container } = mountDroplist({ labelSize: 20 });
    expect(container.querySelector("p")?.style.fontSize).toBe("20px");
  });

  it("bez nadpisania nagłówek ma rozmiar bazowy, nie zero", () => {
    const { container } = mountDroplist();
    expect(container.querySelector("p")?.style.fontSize).toBe("12px");
  });

  it("rozmiar placeholdera dociera do przycisku otwierającego", () => {
    mountDroplist({ placeholderSize: 17 });
    expect(screen.getByRole("button", { name: topicsTriggerText(0, "pl") }).style.fontSize).toBe(
      "17px",
    );
  });

  it("rozmiar etykiety dociera do pigułki wybranego tematu", () => {
    mountDroplist({ labelSize: 15 }, ["afryka"]);
    const pill = screen.getByText("Afryka").closest("span");
    expect(pill?.style.fontSize).toBe("15px");
  });

  it("znaczniki edycji pojawiają się WYŁĄCZNIE na życzenie buildera", () => {
    const withTargets = mountDroplist({ editTargets: true });
    expect(withTargets.container.querySelector('[data-edit-target="labelSize"]')).toBeTruthy();
    expect(
      withTargets.container.querySelector('[data-edit-target="placeholderSize"]'),
    ).toBeTruthy();
    cleanup();

    const plain = mountDroplist();
    expect(plain.container.querySelector("[data-edit-target]")).toBeNull();
  });

  it("styl i znaczniki ikony przychodzą z rodzica", () => {
    const { container } = mountDroplist({
      iconStyle: { width: "2em", height: "2em" },
      iconTargetProps: { "data-jus-icon": true },
    });
    const icon = container.querySelector("svg[data-jus-icon]");
    expect(icon).toBeTruthy();
    expect((icon as SVGElement).style.width).toBe("2em");
  });
});

describe("TopicsDroplist - tryb chipsów", () => {
  it("renderuje wszystkie pozycje od razu, bez okna", () => {
    mountDroplist({ display: "chips" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Afryka" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Handel" })).toBeTruthy();
  });

  it("stan wyboru jedzie przez `aria-pressed`, nie przez sam kolor", () => {
    mountDroplist({ display: "chips" }, ["afryka"]);
    expect(screen.getByRole("button", { name: "Afryka" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Azja" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("kliknięcie chipsa zgłasza identyfikator", () => {
    const { onToggle } = mountDroplist({ display: "chips" });
    fireEvent.click(screen.getByRole("button", { name: "Handel" }));
    expect(onToggle).toHaveBeenCalledWith("handel");
  });

  it("nagłówek grupy niesie liczbę pozycji", () => {
    mountDroplist({ display: "chips" });
    expect(screen.getByText("(2)")).toBeTruthy();
    expect(screen.getByText("(1)")).toBeTruthy();
  });

  it("rozmiar etykiety z buildera dociera do chipsa", () => {
    mountDroplist({ display: "chips", labelSize: 18 });
    expect(screen.getByRole("button", { name: "Afryka" }).style.fontSize).toBe("18px");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = mountDroplist({ display: "chips" }, ["handel"]);
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});

describe("GroupTabs - pasek zakładek grup", () => {
  const TAB_GROUPS = [
    { key: "a", title: "Region", items: [1, 2] },
    { key: "b", title: "Tematy", items: [3] },
  ];

  function mountTabs(picked?: Record<string, number>) {
    return render(
      <div>
        <GroupTabs
          groups={TAB_GROUPS}
          jusId="uid"
          scrollContainerId="scroll"
          ariaLabel="Przejdź do grupy"
          pickedByGroup={picked}
        />
        <div id="scroll">
          <section id="uid-drop-grp-a" />
          <section id="uid-drop-grp-b" />
        </div>
      </div>,
    );
  }

  it("każda grupa dostaje zakładkę, pierwsza jest aktywna", () => {
    mountTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("data-tab-key"))).toEqual(["a", "b"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("kliknięcie zakładki przenosi aktywność - inaczej pasek kłamie o pozycji", () => {
    mountTabs();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("false");
  });

  it("licznik zakładki pokazuje „wybrane/wszystkie”, gdy w grupie coś wybrano", () => {
    mountTabs({ a: 1, b: 0 });
    expect(screen.getByText("1/2")).toBeTruthy();
    // Grupa bez wyboru pokazuje samą liczbę pozycji.
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("bez mapy wyborów licznik pokazuje same rozmiary grup", () => {
    mountTabs();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("pasek jest listą zakładek z nazwą - czytnik ogłasza, po czym nawiguje", () => {
    mountTabs();
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Przejdź do grupy");
  });

  it("strzałki przewijania są wyłączone z kolejności tabulacji", () => {
    // Pasek nawiguje się zakładkami; strzałki to pomoc dla myszki, a dodatkowe
    // dwa przystanki tabulacji na każdą grupę zamieniłyby klawiaturę w mękę.
    mountTabs();
    for (const nudge of document.querySelectorAll("[data-tab-nudge]")) {
      expect(nudge.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("przewijanie paska strzałką woła `scrollBy`", () => {
    mountTabs();
    const bar = screen.getByRole("tablist");
    const scrollBy = vi.fn();
    Object.defineProperty(bar, "scrollBy", { value: scrollBy, configurable: true });
    fireEvent.click(screen.getByLabelText("scroll right"));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("scroll left"));
    expect(scrollBy).toHaveBeenCalledTimes(2);
  });

  it("przeciąganie paska przewija go, a nie klika zakładki", () => {
    // Pasek przewija się palcem i myszką; bez tłumienia kliknięcia po
    // przeciągnięciu każde przesunięcie kończyłoby się skokiem do innej grupy.
    mountTabs();
    const bar = screen.getByRole("tablist");
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 40, pointerId: 1 });
    // Przeciągnięcie w LEWO o 60 px przewija pasek w PRAWO o 60 px.
    expect(bar.scrollLeft).toBe(60);
    fireEvent.pointerUp(bar, { clientX: 40, pointerId: 1 });
    // Kliknięcie zaraz po przeciągnięciu jest tłumione.
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("przeciąganie startujące na strzałce jest ignorowane", () => {
    mountTabs();
    const bar = screen.getByRole("tablist");
    fireEvent.pointerDown(screen.getByLabelText("scroll right"), { clientX: 10, pointerId: 2 });
    fireEvent.pointerMove(bar, { clientX: 200, pointerId: 2 });
    fireEvent.pointerUp(bar, { clientX: 200, pointerId: 2 });
    // Kliknięcie po takim „przeciągnięciu" nie jest tłumione.
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("ruch bez przeciągnięcia (poniżej progu) nie tłumi kliknięcia", () => {
    mountTabs();
    const bar = screen.getByRole("tablist");
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 3 });
    fireEvent.pointerMove(bar, { clientX: 101, pointerId: 3 });
    fireEvent.pointerUp(bar, { clientX: 101, pointerId: 3 });
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("anulowanie wskaźnika (np. gest systemowy) kończy przeciąganie", () => {
    mountTabs();
    const bar = screen.getByRole("tablist");
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 4 });
    fireEvent.pointerCancel(bar, { clientX: 100, pointerId: 4 });
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("PRZEWINIĘCIE LISTY przenosi aktywną zakładkę - pasek pokazuje, gdzie jesteś", () => {
    // Aktywna zakładka jedzie z `IntersectionObserver` nad sekcjami grup.
    // Bez tego pasek pokazuje pierwszą grupę także wtedy, gdy użytkownik
    // przewinął listę na koniec - czyli kłamie o pozycji.
    const observers: ((entries: unknown[]) => void)[] = [];
    const original = window.IntersectionObserver;
    class Stub {
      constructor(callback: (entries: unknown[]) => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    Object.defineProperty(window, "IntersectionObserver", { value: Stub, configurable: true });

    mountTabs();
    expect(observers.length).toBeGreaterThan(0);
    // `act`, bo callback obserwatora biegnie poza cyklem Reacta.
    act(() => {
      observers[0]([
        { isIntersecting: true, intersectionRatio: 0.9, target: { id: "uid-drop-grp-b" } },
        { isIntersecting: false, intersectionRatio: 0, target: { id: "uid-drop-grp-a" } },
      ]);
    });
    expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true");

    Object.defineProperty(window, "IntersectionObserver", {
      value: original,
      configurable: true,
    });
  });

  it("pusta lista grup nie renderuje ani jednej zakładki", () => {
    render(<GroupTabs groups={[]} jusId="uid" scrollContainerId="brak" ariaLabel="Grupy" />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = mountTabs({ a: 2 });
    expect(await axeViolations(container).then(summarize)).toBe("");
  });
});
