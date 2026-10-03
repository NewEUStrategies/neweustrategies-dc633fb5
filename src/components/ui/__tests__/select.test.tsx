// Select to Radiksowy wzorzec „combobox + listbox". Kontrakt dostępności:
// wyzwalacz ma rolę `combobox` z `aria-expanded` i `aria-controls`, lista ma
// rolę `listbox`, pozycje `option`, wybrana pozycja jest zaznaczona
// (`data-state="checked"` i znacznik), klawiatura otwiera listę, przenosi
// ognisko po pozycjach, wybiera Enterem, a Escape zamyka i oddaje ognisko
// wyzwalaczowi. Pozycja `popper` (domyślna) i `item-aligned` to dwie gałęzie
// opakowania. Kolory z tokenów `popover`/`accent`, wspólnych dla motywów.
//
// Listę otwieram klawiaturą: to droga, którą Radix obsługuje bez pomiaru
// geometrii, a jednocześnie ta, której używa osoba bez myszy.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({
  defaultValue,
  onValueChange,
  position,
  name,
}: {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  position?: "popper" | "item-aligned";
  name?: string;
}) {
  return (
    <Select defaultValue={defaultValue} onValueChange={onValueChange} name={name}>
      <SelectTrigger aria-label="Język">
        <SelectValue placeholder="Wybierz język" />
      </SelectTrigger>
      <SelectContent position={position}>
        <SelectItem value="pl">Polski</SelectItem>
        <SelectItem value="en">Angielski</SelectItem>
        <SelectItem value="de" disabled>
          Niemiecki
        </SelectItem>
        <SelectItem value="uk">Ukraiński</SelectItem>
      </SelectContent>
    </Select>
  );
}

const trigger = () => screen.getByRole("combobox", { name: "Język" });
const option = (name: string) => screen.getByRole("option", { name });

/** Klawisz w otwartej liście. Radix przenosi ognisko w `setTimeout`, więc takt opróżniam w `act`. */
async function press(element: HTMLElement, key: string) {
  fireEvent.keyDown(element, { key });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe("Select", () => {
  it("wyzwalacz ma rolę combobox, pokazuje podpowiedź i jest zwinięty", () => {
    render(<Sample />);
    const combobox = trigger();
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(combobox).toHaveAttribute("aria-autocomplete", "none");
    expect(combobox).toHaveAttribute("data-placeholder", "");
    expect(combobox).toHaveTextContent("Wybierz język");
    expect(combobox).toHaveAttribute("data-slot", "select-trigger");
    expect(combobox).toHaveClass(
      "border-border",
      "bg-background",
      "data-[placeholder]:text-muted-foreground",
      "focus:ring-2",
    );
    expect(combobox.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("otwiera listę klawiszem Enter i wiąże ją z wyzwalaczem", async () => {
    render(<Sample />);
    const combobox = trigger();
    await press(combobox, "Enter");
    const listbox = screen.getByRole("listbox");
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(combobox).toHaveAttribute("aria-controls", listbox.id);
    // Lista jest modalna: reszta strony znika z drzewa dostępności.
    expect(screen.queryByRole("combobox", { name: "Język" })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(listbox).toHaveAttribute("data-slot", "select-content");
    expect(listbox).toHaveClass("bg-popover", "text-popover-foreground", "border-border");
  });

  it("otwiera listę strzałką i ustawia ognisko na wybranej pozycji ze znacznikiem", async () => {
    render(<Sample defaultValue="en" />);
    expect(trigger()).toHaveTextContent("Angielski");
    expect(trigger()).not.toHaveAttribute("data-placeholder");
    await press(trigger(), "ArrowDown");
    const selected = option("Angielski");
    await waitFor(() => expect(selected).toHaveFocus());
    expect(selected).toHaveAttribute("data-state", "checked");
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected.querySelector("svg")).not.toBeNull();
    expect(option("Polski")).toHaveAttribute("data-state", "unchecked");
    expect(option("Polski").querySelector("svg")).toBeNull();
  });

  it("przenosi ognisko strzałkami z pominięciem pozycji wyłączonej i wybiera Enterem", async () => {
    const onValueChange = vi.fn();
    render(<Sample defaultValue="en" onValueChange={onValueChange} />);
    await press(trigger(), "Enter");
    await waitFor(() => expect(option("Angielski")).toHaveFocus());
    await press(option("Angielski"), "ArrowDown");
    expect(option("Ukraiński")).toHaveFocus();
    expect(option("Niemiecki")).toHaveAttribute("aria-disabled", "true");
    expect(option("Niemiecki")).toHaveAttribute("data-disabled", "");
    await press(option("Ukraiński"), "Enter");
    expect(onValueChange).toHaveBeenCalledWith("uk");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger()).toHaveTextContent("Ukraiński");
    expect(trigger()).toHaveFocus();
  });

  it("zamyka listę klawiszem Escape bez zmiany wartości i oddaje ognisko wyzwalaczowi", async () => {
    const onValueChange = vi.fn();
    render(<Sample defaultValue="pl" onValueChange={onValueChange} />);
    await press(trigger(), "Enter");
    const listbox = screen.getByRole("listbox");
    await press(listbox, "Escape");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent("Polski");
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("wybiera pozycję kliknięciem", async () => {
    const onValueChange = vi.fn();
    render(<Sample onValueChange={onValueChange} />);
    await press(trigger(), "Enter");
    fireEvent.click(option("Polski"));
    expect(onValueChange).toHaveBeenCalledWith("pl");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(trigger()).toHaveTextContent("Polski");
  });

  it("w pozycji popper dopasowuje okno listy do wymiarów wyzwalacza", async () => {
    render(<Sample />);
    await press(trigger(), "Enter");
    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveClass("data-[side=bottom]:translate-y-1");
    const viewport = listbox.querySelector("[data-radix-select-viewport]");
    expect(viewport).toHaveClass("p-1", "h-[var(--radix-select-trigger-height)]");
  });

  it("w pozycji item-aligned nie dokłada przesunięć popper", async () => {
    render(<Sample defaultValue="pl" position="item-aligned" />);
    await press(trigger(), "Enter");
    const listbox = screen.getByRole("listbox");
    expect(listbox).not.toHaveClass("data-[side=bottom]:translate-y-1");
    const viewport = listbox.querySelector("[data-radix-select-viewport]");
    expect(viewport).toHaveClass("p-1");
    expect(viewport).not.toHaveClass("h-[var(--radix-select-trigger-height)]");
    expect(option("Polski")).toHaveAttribute("data-state", "checked");
  });

  it("w formularzu oddaje wybraną wartość przez ukryte pole natywne", () => {
    const { container } = render(
      <form aria-label="Preferencje">
        <Sample defaultValue="en" name="jezyk" />
      </form>,
    );
    const native = container.querySelector('select[name="jezyk"]') as HTMLSelectElement | null;
    expect(native).not.toBeNull();
    expect(native?.value).toBe("en");
    expect(native).toHaveAttribute("aria-hidden", "true");
  });

  it("scala klasy wywołującego i przekazuje ref wyzwalacza, listy i pozycji", async () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const contentRef = createRef<HTMLDivElement>();
    const itemRef = createRef<HTMLDivElement>();
    render(
      <Select>
        <SelectTrigger ref={triggerRef} aria-label="Rozmiar" className="h-8 w-40">
          <SelectValue placeholder="-" />
        </SelectTrigger>
        <SelectContent ref={contentRef} className="min-w-[12rem]">
          <SelectItem ref={itemRef} value="s" className="py-2">
            Mały
          </SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(triggerRef.current).toHaveClass("h-8", "w-40");
    expect(triggerRef.current).not.toHaveClass("h-10");
    await press(triggerRef.current as HTMLElement, "Enter");
    expect(contentRef.current).toBe(screen.getByRole("listbox"));
    expect(contentRef.current).toHaveClass("min-w-[12rem]");
    expect(contentRef.current).not.toHaveClass("min-w-[8rem]");
    expect(itemRef.current).toBe(screen.getByRole("option", { name: "Mały" }));
    expect(itemRef.current).toHaveAttribute("data-slot", "select-item");
    expect(itemRef.current).toHaveClass("py-2", "focus:bg-accent", "focus:text-accent-foreground");
    expect(itemRef.current).not.toHaveClass("py-1.5");
  });

  it("przechodzi audyt dostępności axe w stanie zamkniętym i otwartym", async () => {
    const { container } = render(<Sample defaultValue="pl" />);
    expect(await axeViolations(container)).toEqual([]);
    await press(trigger(), "Enter");
    expect(await axeViolations(screen.getByRole("listbox"))).toEqual([]);
  });
});
