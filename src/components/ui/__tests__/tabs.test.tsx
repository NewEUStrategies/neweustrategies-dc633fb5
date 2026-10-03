// Tabs to wzorzec WAI-ARIA „Tabs": `tablist` z kartami `tab`, z których każda
// steruje panelem `tabpanel` (`aria-controls` / `aria-labelledby`). Kontrakt
// klawiatury: strzałki przenoszą ognisko między kartami (z zawijaniem), Home
// i End skaczą na skraje, a w trybie automatycznym ognisko od razu aktywuje
// kartę. Aktywna karta dostaje tło `bg-background` i pierścień z tokenów -
// wspólnych dla jasnego i ciemnego motywu.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../tabs";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({
  onValueChange,
  activationMode,
}: {
  onValueChange?: (value: string) => void;
  activationMode?: "automatic" | "manual";
}) {
  return (
    <Tabs defaultValue="opis" onValueChange={onValueChange} activationMode={activationMode}>
      <TabsList aria-label="Sekcje wydarzenia">
        <TabsTrigger value="opis">Opis</TabsTrigger>
        <TabsTrigger value="program">Program</TabsTrigger>
        <TabsTrigger value="archiwum" disabled>
          Archiwum
        </TabsTrigger>
        <TabsTrigger value="prelegenci">Prelegenci</TabsTrigger>
      </TabsList>
      <TabsContent value="opis">Treść opisu</TabsContent>
      <TabsContent value="program">Treść programu</TabsContent>
      <TabsContent value="archiwum">Treść archiwum</TabsContent>
      <TabsContent value="prelegenci">Lista prelegentów</TabsContent>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

/**
 * Wciska klawisz na karcie. Radix przenosi ognisko strzałkami w `setTimeout`
 * (obejście batchowania Reacta), więc ten takt opróżniam wewnątrz `act`.
 */
async function press(element: HTMLElement, key: string) {
  fireEvent.keyDown(element, { key });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe("Tabs", () => {
  it("wystawia listę kart z nazwą, kartę aktywną i powiązany z nią panel", () => {
    render(<Sample />);
    const list = screen.getByRole("tablist", { name: "Sekcje wydarzenia" });
    expect(list).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab("Opis")).toHaveAttribute("aria-selected", "true");
    expect(tab("Program")).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("Treść opisu");
    expect(tab("Opis")).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab("Opis").id);
    expect(panel).toHaveAccessibleName("Opis");
  });

  it("aktywuje kartę kliknięciem myszy i pokazuje jej panel", () => {
    const onValueChange = vi.fn();
    render(<Sample onValueChange={onValueChange} />);
    fireEvent.mouseDown(tab("Program"), { button: 0 });
    expect(onValueChange).toHaveBeenCalledWith("program");
    expect(tab("Program")).toHaveAttribute("aria-selected", "true");
    expect(tab("Opis")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Treść programu");
  });

  it("w trybie automatycznym strzałka przenosi ognisko i od razu aktywuje kartę, omijając wyłączoną", async () => {
    render(<Sample />);
    act(() => tab("Opis").focus());
    await press(tab("Opis"), "ArrowRight");
    expect(tab("Program")).toHaveFocus();
    expect(tab("Program")).toHaveAttribute("aria-selected", "true");
    await press(tab("Program"), "ArrowRight");
    expect(tab("Prelegenci")).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Lista prelegentów");
  });

  it("zawija ognisko strzałkami i skacze na skraje klawiszami Home i End", async () => {
    render(<Sample />);
    act(() => tab("Opis").focus());
    await press(tab("Opis"), "ArrowLeft");
    expect(tab("Prelegenci")).toHaveFocus();
    await press(tab("Prelegenci"), "Home");
    expect(tab("Opis")).toHaveFocus();
    await press(tab("Opis"), "End");
    expect(tab("Prelegenci")).toHaveFocus();
  });

  it("w trybie ręcznym strzałka tylko przenosi ognisko, a aktywuje dopiero Enter", async () => {
    render(<Sample activationMode="manual" />);
    act(() => tab("Opis").focus());
    await press(tab("Opis"), "ArrowRight");
    expect(tab("Program")).toHaveFocus();
    expect(tab("Program")).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(tab("Program"), { key: "Enter" });
    expect(tab("Program")).toHaveAttribute("aria-selected", "true");
  });

  it("wejście klawiaturą na listę kart ustawia ognisko na aktywnej karcie i tylko ją zostawia w kolejności tabulacji", () => {
    render(<Sample />);
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("tabindex", "0");
    fireEvent.focus(list);
    expect(tab("Opis")).toHaveFocus();
    expect(tab("Opis")).toHaveAttribute("tabindex", "0");
    expect(tab("Program")).toHaveAttribute("tabindex", "-1");
    expect(tab("Archiwum")).toBeDisabled();
    expect(tab("Archiwum")).toHaveAttribute("data-disabled", "");
  });

  it("wyróżnia aktywną kartę tokenami motywu, a pozostałe stonowanym kolorem", () => {
    render(<Sample />);
    expect(tab("Opis")).toHaveAttribute("data-state", "active");
    expect(tab("Program")).toHaveAttribute("data-state", "inactive");
    expect(tab("Opis")).toHaveClass(
      "data-[state=active]:bg-background",
      "data-[state=active]:text-brand-ink",
      "data-[state=active]:ring-border",
      "text-muted-foreground",
      "focus-visible:ring-2",
    );
    expect(screen.getByRole("tablist")).toHaveClass("tabs-scroller", "bg-muted", "rounded-[6px]");
    expect(screen.getByRole("tabpanel")).toHaveClass("mt-2", "focus-visible:ring-2");
  });

  it("scala klasy wywołującego i przekazuje ref na liście, karcie i panelu", () => {
    const list = createRef<HTMLDivElement>();
    const trigger = createRef<HTMLButtonElement>();
    const content = createRef<HTMLDivElement>();
    render(
      <Tabs defaultValue="a">
        <TabsList ref={list} className="h-11 w-auto">
          <TabsTrigger ref={trigger} value="a" className="px-5">
            A
          </TabsTrigger>
        </TabsList>
        <TabsContent ref={content} value="a" className="mt-6">
          Panel A
        </TabsContent>
      </Tabs>,
    );
    expect(list.current).toBe(screen.getByRole("tablist"));
    expect(list.current).toHaveClass("h-11", "w-auto");
    expect(list.current).not.toHaveClass("h-9");
    expect(trigger.current).toHaveClass("px-5");
    expect(trigger.current).not.toHaveClass("px-3");
    expect(content.current).toHaveClass("mt-6");
    expect(content.current).not.toHaveClass("mt-2");
  });

  it("przechodzi audyt dostępności axe", async () => {
    const { container } = render(<Sample />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
