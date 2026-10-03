// Command to paleta poleceń (cmdk) w oknie dialogowym. Kontrakt dostępności:
// pole wyszukiwania ma rolę `combobox` sterującą listą `listbox`, pozycje mają
// rolę `option` z `aria-selected` i `aria-disabled`, grupy są nazwane
// nagłówkiem, separator ma rolę `separator`. Klawiatura: strzałki przenoszą
// zaznaczenie z pominięciem pozycji wyłączonych, Home/End skaczą na skraje,
// Enter uruchamia zaznaczoną pozycję, Escape zamyka okno. Wpisywanie filtruje
// listę, a przy braku trafień pojawia się stan pusty. Zaznaczenie rysuje token
// `accent`, tło okna token `popover` - oba wspólne dla jasnego i ciemnego motywu.
//
// Moduł eksportuje tylko `CommandDialog` (korzeń `Command` jest wewnętrzny),
// więc każdy test idzie przez okno - tak jak jedyny konsument, paleta wyszukiwania.
//
// Okno ma nazwę dostępną z wymaganego propa `label` (niewidoczny tytuł) -
// dawniej axe zgłaszał tu `aria-dialog-name`.
//
// CZEGO TU ŚWIADOMIE NIE MA: pełnego audytu axe. Zgłasza on jeszcze jeden
// realny defekt, odnotowany osobno, a nie przykryty asercją: separator z rolą
// `separator` wewnątrz `listbox` (`aria-required-children`) - to struktura
// cmdk. Nie asertuję też `aria-activedescendant` przed pierwszym ruchem
// klawiatury: cmdk ustawia go dopiero po zmianie zaznaczenia.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../command";

afterEach(cleanup);

function Sample({
  open = true,
  onSelect,
  onOpenChange,
}: {
  open?: boolean;
  onSelect?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label="Paleta poleceń">
      <CommandInput placeholder="Szukaj w serwisie" />
      <CommandList>
        <CommandEmpty>Brak wyników</CommandEmpty>
        <CommandGroup heading="Strony">
          <CommandItem onSelect={onSelect}>Analizy</CommandItem>
          <CommandItem disabled onSelect={onSelect}>
            Archiwum
          </CommandItem>
          <CommandItem onSelect={onSelect}>Kontakt</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Konto">
          <CommandItem onSelect={onSelect}>Wyloguj</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

const input = () => screen.getByRole("combobox");
const option = (name: string) => screen.getByRole("option", { name });

/** Wciska klawisz w polu wyszukiwania i domyka asynchroniczne przeliczenie cmdk. */
async function press(key: string) {
  fireEvent.keyDown(input(), { key });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

async function type(value: string) {
  fireEvent.change(input(), { target: { value } });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe("Command", () => {
  it("zamknięta paleta nie renderuje niczego, otwarta pokazuje okno z polem i listą", () => {
    const { rerender } = render(<Sample open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Sample open />);
    const dialog = screen.getByRole("dialog", { name: "Paleta poleceń" });
    expect(dialog).toHaveClass("overflow-hidden", "p-0");
    expect(screen.getByText("Paleta poleceń")).toHaveClass("sr-only");
    expect(dialog).toContainElement(input());
    expect(dialog).toContainElement(screen.getByRole("listbox"));
  });

  it("pole wyszukiwania steruje listą jako combobox z autouzupełnianiem listy", () => {
    render(<Sample />);
    const field = input();
    expect(field).toHaveAttribute("placeholder", "Szukaj w serwisie");
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(field).toHaveAttribute("aria-autocomplete", "list");
    expect(field).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    const wrapper = field.parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute("cmdk-input-wrapper", "");
    expect(wrapper).toHaveClass("flex", "items-center", "border-b");
    expect(wrapper.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("przenosi ognisko do pola wyszukiwania po otwarciu", async () => {
    render(<Sample />);
    await waitFor(() => expect(input()).toHaveFocus());
  });

  it("zaznacza na starcie pierwszą pozycję tokenem akcentu", async () => {
    render(<Sample />);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const first = option("Analizy");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("data-selected", "true");
    expect(first).toHaveClass(
      "data-[selected=true]:bg-accent",
      "data-[selected=true]:text-accent-foreground",
    );
    expect(option("Kontakt")).toHaveAttribute("aria-selected", "false");
  });

  it("przenosi zaznaczenie strzałkami z pominięciem pozycji wyłączonej", async () => {
    render(<Sample />);
    await press("ArrowDown");
    expect(option("Kontakt")).toHaveAttribute("aria-selected", "true");
    expect(option("Archiwum")).toHaveAttribute("aria-disabled", "true");
    expect(option("Archiwum")).toHaveAttribute("aria-selected", "false");
    await press("ArrowDown");
    expect(option("Wyloguj")).toHaveAttribute("aria-selected", "true");
    expect(input()).toHaveAttribute("aria-activedescendant", option("Wyloguj").id);
    await press("ArrowUp");
    expect(option("Kontakt")).toHaveAttribute("aria-selected", "true");
  });

  it("skacze na skraje listy klawiszami Home i End", async () => {
    render(<Sample />);
    await press("End");
    expect(option("Wyloguj")).toHaveAttribute("aria-selected", "true");
    await press("Home");
    expect(option("Analizy")).toHaveAttribute("aria-selected", "true");
  });

  it("uruchamia zaznaczoną pozycję klawiszem Enter i przekazuje jej wartość", async () => {
    const onSelect = vi.fn();
    render(<Sample onSelect={onSelect} />);
    await press("ArrowDown");
    await press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("Kontakt");
  });

  it("uruchamia pozycję kliknięciem, ale ignoruje kliknięcie pozycji wyłączonej", async () => {
    const onSelect = vi.fn();
    render(<Sample onSelect={onSelect} />);
    fireEvent.click(option("Archiwum"));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(option("Wyloguj"));
    expect(onSelect).toHaveBeenCalledWith("Wyloguj");
  });

  it("filtruje pozycje po wpisanym tekście i zaznacza pierwsze trafienie", async () => {
    render(<Sample />);
    await type("kon");
    expect(screen.getAllByRole("option").map((el) => el.textContent)).toEqual(["Kontakt"]);
    expect(option("Kontakt")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Brak wyników")).toBeNull();
  });

  it("pokazuje stan pusty, gdy nic nie pasuje do zapytania", async () => {
    render(<Sample />);
    expect(screen.queryByText("Brak wyników")).toBeNull();
    await type("zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    const empty = screen.getByText("Brak wyników");
    expect(empty).toHaveClass("py-6", "text-center", "text-sm");
  });

  it("nazywa grupy ich nagłówkami i oddziela je separatorem", () => {
    render(<Sample />);
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Strony" })).toContainElement(option("Kontakt"));
    expect(screen.getByRole("group", { name: "Konto" })).toContainElement(option("Wyloguj"));
    const separator = screen.getByRole("separator");
    expect(separator).toHaveClass("-mx-1", "h-px", "bg-border");
  });

  it("zamyka paletę klawiszem Escape", async () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("rysuje paletę tokenami motywu i scala klasy wywołującego na każdym elemencie", () => {
    const inputRef = createRef<HTMLInputElement>();
    const listRef = createRef<HTMLDivElement>();
    const groupRef = createRef<HTMLDivElement>();
    const itemRef = createRef<HTMLDivElement>();
    const separatorRef = createRef<HTMLDivElement>();
    const emptyRef = createRef<HTMLDivElement>();
    render(
      <CommandDialog open label="Paleta poleceń">
        <CommandInput ref={inputRef} className="h-12" />
        <CommandList ref={listRef} className="max-h-96">
          <CommandEmpty ref={emptyRef} className="sr-only">
            Pusto
          </CommandEmpty>
          <CommandGroup ref={groupRef} heading="G" className="p-2">
            <CommandItem ref={itemRef} className="gap-4">
              Pozycja
            </CommandItem>
          </CommandGroup>
          <CommandSeparator ref={separatorRef} className="my-2" />
        </CommandList>
      </CommandDialog>,
    );
    const root = document.querySelector("[cmdk-root]");
    expect(root).toHaveClass("bg-popover", "text-popover-foreground", "rounded-md");
    expect(inputRef.current).toBe(input());
    expect(inputRef.current).toHaveClass(
      "h-12",
      "bg-transparent",
      "placeholder:text-muted-foreground",
    );
    expect(inputRef.current).not.toHaveClass("h-10");
    expect(listRef.current).toBe(screen.getByRole("listbox"));
    expect(listRef.current).toHaveClass("max-h-96", "overflow-y-auto");
    expect(listRef.current).not.toHaveClass("max-h-[300px]");
    expect(groupRef.current).toHaveClass("p-2", "text-foreground");
    expect(groupRef.current).not.toHaveClass("p-1");
    expect(itemRef.current).toBe(option("Pozycja"));
    expect(itemRef.current).toHaveClass("gap-4", "rounded-sm");
    expect(itemRef.current).not.toHaveClass("gap-2");
    expect(separatorRef.current).toHaveClass("my-2", "bg-border");
    expect(emptyRef.current).toBeNull();
  });

  it("stan pusty przyjmuje klasę wywołującego w miejsce domyślnej, np. ukrycie wizualne", async () => {
    render(
      <CommandDialog open label="Paleta poleceń">
        <CommandInput />
        <CommandList>
          <CommandEmpty className="sr-only">Nic nie znaleziono</CommandEmpty>
        </CommandList>
      </CommandDialog>,
    );
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const empty = screen.getByText("Nic nie znaleziono");
    expect(empty).toHaveClass("sr-only");
    expect(empty).not.toHaveClass("py-6");
  });
});
