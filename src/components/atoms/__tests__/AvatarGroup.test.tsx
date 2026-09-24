// `AvatarGroup` - wspólny stos obecności ("kto tu jest").
//
// CO TEN PLIK DOWODZI.
//  (1) KOLEJNOŚĆ PRZYJŚCIA JEST STABILNA: nowa osoba dołącza na końcu, nawet
//      gdy dane wołającego wstawiają ją na początek; pozostali nie zmieniają
//      slotów.
//  (2) WYCHODZĄCY KAFEL GAŚNIE, a nie znika w pół klatki: zostaje w DOM jako
//      `data-leaving` + `inert` na czas wyjścia i dopiero potem odchodzi.
//      Przy `prefers-reduced-motion` znika od razu.
//  (3) WEJŚCIE GRA TYLKO PO ZAMONTOWANIU: kafle z pierwszego renderu (SSR,
//      hydratacja) nie dostają `data-enter`, dołączający później - tak.
//  (4) "+N" LICZY `total ?? items.length`, ma limit wyświetlania, pełny tekst
//      dla czytnika ekranu, a jako przycisk oddaje osoby spoza stosu.
//  (5) TRYB OZDOBNY: stos `aria-hidden`, WSZYSTKIE nazwiska w `sr-only`,
//      `title` na każdej twarzy, żadnego przystanku tabulatora.
//  (6) OGŁOSZENIE `aria-live` jest odroczone i nie gra przy zamontowaniu.
//  (7) PROMIEŃ 6 PX na ramce i liczniku; zdjęcie po błędzie ustępuje
//      inicjałom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AvatarGroup, avatarInitials, type AvatarGroupItem } from "@/components/atoms/AvatarGroup";

function person(id: string, name = `Osoba ${id}`, extra: Partial<AvatarGroupItem> = {}) {
  return { id, name, ...extra } satisfies AvatarGroupItem;
}

/** Kafle osób (bez licznika) w kolejności DOM. */
function tiles(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("li.avg-slot")).filter(
    (li) => li.querySelector(".avg-chip") === null,
  );
}

function slotX(li: HTMLElement | undefined): string | undefined {
  return li?.style.getPropertyValue("--avg-x");
}

function chip(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".avg-chip");
}

describe("AvatarGroup - kolejność przyjścia", () => {
  it("pierwszy render trzyma kolejność danych, a pierwszy kafel leży na wierzchu", () => {
    const { container } = render(
      <AvatarGroup items={[person("a"), person("b"), person("c")]} label="Tu są" />,
    );
    const li = tiles(container);
    expect(li.map((el) => el.querySelector("[aria-label]")?.getAttribute("aria-label"))).toEqual([
      "Osoba a",
      "Osoba b",
      "Osoba c",
    ]);
    expect(Number(li[0]?.style.zIndex)).toBeGreaterThan(Number(li[1]?.style.zIndex));
    expect(slotX(li[0])).toBe("0px");
  });

  it("nowa osoba wstawiona NA POCZĄTEK danych dołącza na KOŃCU stosu", () => {
    const { container, rerender } = render(
      <AvatarGroup items={[person("a"), person("b")]} label="Tu są" size="sm" />,
    );
    const before = tiles(container).map(slotX);
    rerender(
      <AvatarGroup items={[person("z"), person("a"), person("b")]} label="Tu są" size="sm" />,
    );
    const li = tiles(container);
    // `sm` = 32 px, nakładka 10 px -> krok 22 px.
    expect(li.map(slotX)).toEqual([...before, "44px"]);
    expect(li[2]?.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("Osoba z");
  });
});

describe("AvatarGroup - wejście i wyjście", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("kafle z pierwszego renderu nie grają wejścia, dołączający - tak", () => {
    const { container, rerender } = render(<AvatarGroup items={[person("a")]} label="Tu są" />);
    expect(tiles(container)[0]).not.toHaveAttribute("data-enter");
    rerender(<AvatarGroup items={[person("a"), person("b")]} label="Tu są" />);
    const li = tiles(container);
    expect(li[0]).not.toHaveAttribute("data-enter");
    expect(li[1]).toHaveAttribute("data-enter");
  });

  it("wychodzący zostaje na czas gaśnięcia jako `inert`, reszta od razu zsuwa się w lewo", () => {
    const { container, rerender } = render(
      <AvatarGroup items={[person("a"), person("b"), person("c")]} label="Tu są" />,
    );
    rerender(<AvatarGroup items={[person("b"), person("c")]} label="Tu są" />);

    const leaving = container.querySelector<HTMLElement>("li[data-leaving]");
    expect(leaving).not.toBeNull();
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving?.hasAttribute("inert")).toBe(true);
    // Gaśnie w SWOIM slocie, a następcy już jadą na jego miejsce.
    expect(slotX(leaving ?? undefined)).toBe("0px");
    const staying = tiles(container).filter((li) => !li.hasAttribute("data-leaving"));
    expect(staying.map(slotX)).toEqual(["0px", "22px"]);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector("li[data-leaving]")).toBeNull();
    expect(tiles(container)).toHaveLength(2);
  });

  it("osoba, która wraca w trakcie gaśnięcia, przestaje wychodzić i wraca na swoje miejsce", () => {
    const { container, rerender } = render(
      <AvatarGroup items={[person("a"), person("b")]} label="Tu są" />,
    );
    rerender(<AvatarGroup items={[person("b")]} label="Tu są" />);
    expect(container.querySelector("li[data-leaving]")).not.toBeNull();
    rerender(<AvatarGroup items={[person("b"), person("a")]} label="Tu są" />);
    expect(container.querySelector("li[data-leaving]")).toBeNull();
    // Numer przyjścia nie jest zwalniany: "a" była pierwsza i pierwsza zostaje.
    expect(tiles(container).map(slotX)).toEqual(["0px", "22px"]);
    expect(tiles(container)[0]?.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
      "Osoba a",
    );
  });

  it("przy `prefers-reduced-motion` wychodzący znika od razu", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const { container, rerender } = render(
      <AvatarGroup items={[person("a"), person("b")]} label="Tu są" />,
    );
    rerender(<AvatarGroup items={[person("b")]} label="Tu są" />);
    expect(container.querySelector("li[data-leaving]")).toBeNull();
    expect(tiles(container)).toHaveLength(1);
  });

  it("licznik „+N” przy spadku do zera gaśnie z OSTATNIĄ liczbą, a nie z zerem", () => {
    const { container, rerender } = render(
      <AvatarGroup items={[person("a"), person("b"), person("c")]} maxVisible={2} label="Tu są" />,
    );
    expect(chip(container)).toHaveTextContent("+1");
    rerender(<AvatarGroup items={[person("a"), person("b")]} maxVisible={2} label="Tu są" />);
    expect(chip(container)?.closest("li")).toHaveAttribute("data-leaving");
    expect(chip(container)).toHaveTextContent("+1");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(chip(container)).toBeNull();
  });
});

describe("AvatarGroup - licznik „+N”", () => {
  it.each([
    { count: 3, max: 3, total: undefined, badge: null },
    { count: 4, max: 3, total: undefined, badge: "+1" },
    { count: 2, max: 5, total: 9, badge: "+7" },
    { count: 2, max: 1, total: 0, badge: null },
    { count: 3, max: 1, total: 400, badge: "+99" },
  ])("$count osób, limit $max, total $total -> $badge", ({ count, max, total, badge }) => {
    const items = Array.from({ length: count }, (_, i) => person(String(i)));
    const { container } = render(
      <AvatarGroup items={items} maxVisible={max} total={total} label="Tu są" />,
    );
    if (badge === null) expect(chip(container)).toBeNull();
    else expect(chip(container)).toHaveTextContent(badge);
  });

  it("pełny tekst licznika idzie do czytnika ekranu i do dymka, a nie tylko „+N”", () => {
    render(
      <AvatarGroup
        items={[person("a"), person("b"), person("c")]}
        maxVisible={1}
        label="Tu są"
        overflowLabel={(n) => `i ${n} inne osoby`}
      />,
    );
    const text = screen.getByText("i 2 inne osoby");
    expect(text).toHaveClass("sr-only");
    expect(text.parentElement).toHaveAttribute("title", "i 2 inne osoby");
  });

  it("licznik-przycisk oddaje osoby spoza stosu w kolejności przyjścia", () => {
    const onOverflowSelect = vi.fn();
    render(
      <AvatarGroup
        items={[person("a"), person("b"), person("c")]}
        maxVisible={1}
        label="Tu są"
        overflowLabel={(n) => `pokaż ${n}`}
        onOverflowSelect={onOverflowSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pokaż 2" }));
    expect(onOverflowSelect).toHaveBeenCalledWith([person("b"), person("c")]);
  });
});

describe("AvatarGroup - dostępność", () => {
  it("tryb interaktywny: link do profilu z nazwą i rolą, karta po najechaniu", () => {
    render(
      <AvatarGroup
        items={[person("a", "Anna Nowak", { designation: "Analityczka", href: "/people/anna" })]}
        label="Zareagowali"
      />,
    );
    expect(screen.getByRole("list", { name: "Zareagowali" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Anna Nowak - Analityczka" });
    expect(link).toHaveAttribute("href", "/people/anna");
    const card = screen.getByRole("tooltip", { hidden: true });
    expect(card).toHaveAttribute("aria-hidden", "true");
    fireEvent.mouseEnter(link.closest("li") as HTMLElement);
    expect(card).toHaveAttribute("aria-hidden", "false");
  });

  it("tryb ozdobny: stos ukryty, wszystkie nazwiska w `sr-only`, zero przystanków tabulatora", () => {
    const { container } = render(
      <AvatarGroup
        items={[person("a", "Anna"), person("b", "Jan"), person("c", "Ewa")]}
        maxVisible={1}
        interactive={false}
        label="Idą"
      />,
    );
    expect(container.querySelector("ul")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("group", { name: "Idą" })).toBeInTheDocument();
    expect(container.querySelector(".sr-only")?.textContent).toBe("Anna, Jan, Ewa");
    expect(container.querySelectorAll("[tabindex], a, button")).toHaveLength(0);
    expect(tiles(container)[0]).toHaveAttribute("title", "Anna");
  });

  it("ogłoszenie `aria-live` nie gra przy zamontowaniu i jest odroczone przy zmianie", () => {
    vi.useFakeTimers();
    const announce = (names: readonly string[]) => `Tu teraz: ${names.join(", ")}`;
    const { rerender } = render(
      <AvatarGroup items={[person("a", "Anna")]} label="Tu są" announce={announce} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Tu teraz: Anna");
    rerender(
      <AvatarGroup
        items={[person("a", "Anna"), person("b", "Jan")]}
        label="Tu są"
        announce={announce}
      />,
    );
    expect(status).toHaveTextContent("Tu teraz: Anna");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(status).toHaveTextContent("Tu teraz: Anna, Jan");
    vi.useRealTimers();
  });
});

describe("AvatarGroup - kafel", () => {
  it("ramka i licznik mają promień 6 px, wnętrze - koncentryczny", () => {
    const { container } = render(
      <AvatarGroup items={[person("a"), person("b")]} maxVisible={1} size="md" label="Tu są" />,
    );
    const frame = container.querySelector<HTMLElement>(".avg-frame");
    expect(frame?.style.borderRadius).toBe("6px");
    expect(frame?.style.width).toBe("40px");
    // `md` ma ramkę 3 px, więc wnętrze dostaje 6 - 3 = 3 px.
    expect(container.querySelector<HTMLElement>(".avg-well")?.style.borderRadius).toBe("3px");
    expect(chip(container)?.style.borderRadius).toBe("6px");
  });

  it("bok w px daje własną nakładkę (~30%) i szerokość szyny", () => {
    const { container } = render(
      <AvatarGroup items={[person("a"), person("b")]} size={20} label="Tu są" />,
    );
    // 20 px, nakładka 6 px -> krok 14 px; szyna = krok + bok.
    expect(tiles(container).map(slotX)).toEqual(["0px", "14px"]);
    expect(container.querySelector("ul")?.style.getPropertyValue("--avg-w")).toBe("34px");
  });

  it("zdjęcie, które się nie wczytało, ustępuje inicjałom", () => {
    const { container } = render(
      <AvatarGroup
        items={[person("a", "Anna Nowak", { image: "https://example.org/a.jpg" })]}
        label="Tu są"
      />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AN")).toBeInTheDocument();
  });

  it("nowy adres zdjęcia po błędzie poprzedniego znów dostaje `<img>`", () => {
    const withImage = (image: string) => [person("a", "Anna Nowak", { image })];
    const { container, rerender } = render(
      <AvatarGroup items={withImage("https://example.org/zly.jpg")} label="Tu są" />,
    );
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    rerender(<AvatarGroup items={withImage("https://example.org/nowy.jpg")} label="Tu są" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://example.org/nowy.jpg");
  });

  it("tożsamość ukryta dostaje neutralny znacznik zamiast inicjałów", () => {
    render(<AvatarGroup items={[person("x", "Uczestnik", { anonymous: true })]} label="Tu są" />);
    expect(screen.getByText("···")).toBeInTheDocument();
    expect(screen.queryByText("U")).not.toBeInTheDocument();
  });

  it.each([
    ["Anna Nowak", "AN"],
    ["  jan  ", "J"],
    ["Łukasz Żak-Ćwik", "ŁĆ"],
    ["!!!", "?"],
  ])("inicjały z %j to %j", (name, expected) => {
    expect(avatarInitials(name)).toBe(expected);
  });
});
