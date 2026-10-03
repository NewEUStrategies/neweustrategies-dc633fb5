// Accordion to wzorzec WAI-ARIA „Accordion": każdy nagłówek to `h3`
// z przyciskiem `aria-expanded`, który przez `aria-controls` wskazuje panel
// `region` nazwany tym nagłówkiem. Kontrakt klawiatury: strzałki góra/dół
// przenoszą ognisko między nagłówkami (z zawijaniem), Home i End skaczą na
// skraje. Treść stonowana tokenem `text-muted-foreground`, wspólnym dla motywów.
//
// Stan zwinięcia sprawdzam na wyzwalaczu (`aria-expanded`, `data-state`): pod
// happy-dom animacje nie lecą, więc zamknięta treść znika z DOM od razu.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../accordion";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <Accordion type="single" collapsible defaultValue="a" onValueChange={onValueChange}>
      <AccordionItem value="a">
        <AccordionTrigger>Czym jest think tank?</AccordionTrigger>
        <AccordionContent>Ośrodek analiz.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Jak dołączyć?</AccordionTrigger>
        <AccordionContent>Przez formularz.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="c">
        <AccordionTrigger>Ile to kosztuje?</AccordionTrigger>
        <AccordionContent>Nic.</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

const trigger = (name: string) => screen.getByRole("button", { name });

describe("Accordion", () => {
  it("osadza każdy wyzwalacz w nagłówku i wiąże go z nazwanym panelem", () => {
    render(<Sample />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveClass("flex");
    const first = trigger("Czym jest think tank?");
    expect(headings[0]).toContainElement(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Czym jest think tank?" });
    expect(first).toHaveAttribute("aria-controls", region.id);
    expect(region).toHaveTextContent("Ośrodek analiz.");
    expect(trigger("Jak dołączyć?")).toHaveAttribute("aria-expanded", "false");
  });

  it("w trybie pojedynczym rozwinięcie jednej sekcji zwija poprzednią", () => {
    const onValueChange = vi.fn();
    render(<Sample onValueChange={onValueChange} />);
    fireEvent.click(trigger("Jak dołączyć?"));
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(trigger("Jak dołączyć?")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("Czym jest think tank?")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "Jak dołączyć?" })).toHaveTextContent(
      "Przez formularz.",
    );
    expect(screen.queryByText("Ośrodek analiz.")).toBeNull();
  });

  it("pozwala zwinąć otwartą sekcję, gdy akordeon jest zwijalny", () => {
    render(<Sample />);
    const first = trigger("Czym jest think tank?");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(first).toHaveAttribute("data-state", "closed");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("przenosi ognisko strzałkami z zawijaniem i skacze klawiszami Home i End", () => {
    render(<Sample />);
    const first = trigger("Czym jest think tank?");
    const last = trigger("Ile to kosztuje?");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(trigger("Jak dołączyć?")).toHaveFocus();
    fireEvent.keyDown(trigger("Jak dołączyć?"), { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
  });

  it("obraca szewron otwartej sekcji i ukrywa go przed czytnikiem", () => {
    render(<Sample />);
    const first = trigger("Czym jest think tank?");
    expect(first).toHaveClass("[&[data-state=open]>svg]:rotate-180", "hover:underline");
    const chevron = first.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("transition-transform");
  });

  it("stonowuje treść tokenem motywu, a klasę wywołującego kładzie na wewnętrznym bloku", () => {
    const item = createRef<HTMLDivElement>();
    const button = createRef<HTMLButtonElement>();
    const content = createRef<HTMLDivElement>();
    render(
      <Accordion type="multiple" defaultValue={["x"]}>
        <AccordionItem ref={item} value="x" className="border-0">
          <AccordionTrigger ref={button} className="py-2">
            X
          </AccordionTrigger>
          <AccordionContent ref={content} className="pb-2">
            Treść X
          </AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
    expect(item.current).toHaveClass("border-0");
    expect(item.current).not.toHaveClass("border-b");
    expect(button.current).toHaveClass("py-2");
    expect(button.current).not.toHaveClass("py-4");
    expect(content.current).toHaveAttribute("role", "region");
    expect(content.current).toHaveClass("overflow-hidden", "text-sm");
    const inner = screen.getByText("Treść X");
    expect(inner.parentElement).toBe(content.current);
    expect(inner).toHaveClass("pb-2", "pt-0", "text-muted-foreground");
    expect(inner).not.toHaveClass("pb-4");
  });

  it("przechodzi audyt dostępności axe", async () => {
    const { container } = render(<Sample />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
