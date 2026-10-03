// Popover to niemodalna warstwa w portalu. Kontrakt dostępności: wyzwalacz
// ogłasza `aria-haspopup="dialog"`, `aria-expanded` i `aria-controls`,
// treść ma rolę `dialog`, Escape zamyka i oddaje ognisko wyzwalaczowi.
// Domyślne wyrównanie (`center`) i odstęp (4 px) to gałęzie opakowania, więc
// test sprawdza i domyślne, i jawne wartości. Kolory z tokenów `popover`.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";

afterEach(cleanup);

function Sample({
  align,
  sideOffset,
  onOpenChange,
}: {
  align?: "start" | "center" | "end";
  sideOffset?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger>Udostępnij</PopoverTrigger>
      <PopoverContent align={align} sideOffset={sideOffset} aria-label="Opcje udostępniania">
        <button type="button">Kopiuj link</button>
      </PopoverContent>
    </Popover>
  );
}

function open() {
  const trigger = screen.getByRole("button", { name: "Udostępnij" });
  fireEvent.click(trigger);
  return { trigger, content: screen.getByRole("dialog", { name: "Opcje udostępniania" }) };
}

describe("Popover", () => {
  it("wyzwalacz ogłasza warstwę dialogową i wiąże się z jej treścią", () => {
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Udostępnij" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const { content } = open();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", content.id);
    expect(content).toHaveAttribute("data-state", "open");
  });

  it("domyślnie wyśrodkowuje treść względem wyzwalacza", async () => {
    render(<Sample />);
    const { content } = open();
    await waitFor(() => expect(content).toHaveAttribute("data-align", "center"));
    expect(content).toHaveClass(
      "z-50",
      "w-72",
      "rounded-md",
      "border",
      "bg-popover",
      "text-popover-foreground",
    );
  });

  it("przyjmuje jawne wyrównanie i odstęp od wyzwalacza", async () => {
    render(<Sample align="end" sideOffset={12} />);
    const { content } = open();
    await waitFor(() => expect(content).toHaveAttribute("data-align", "end"));
    expect(content).toHaveAttribute("data-side", "bottom");
  });

  it("przenosi ognisko do treści po otwarciu", async () => {
    render(<Sample />);
    const { content } = open();
    await waitFor(() => expect(content.contains(document.activeElement)).toBe(true));
  });

  it("zamyka treść klawiszem Escape i oddaje ognisko wyzwalaczowi", async () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    const { trigger, content } = open();
    fireEvent.keyDown(content, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("zamyka treść kliknięciem poza nią", async () => {
    render(
      <>
        <Sample />
        <p>Tło strony</p>
      </>,
    );
    open();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const outside = screen.getByText("Tło strony");
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("scala klasę wywołującego i przekazuje ref treści", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Popover defaultOpen>
        <PopoverTrigger>X</PopoverTrigger>
        <PopoverContent ref={ref} className="w-96 p-0" aria-label="Szeroka">
          Treść
        </PopoverContent>
      </Popover>,
    );
    expect(ref.current).toBe(screen.getByRole("dialog", { name: "Szeroka" }));
    expect(ref.current).toHaveClass("w-96", "p-0", "bg-popover");
    expect(ref.current).not.toHaveClass("w-72");
    expect(ref.current).not.toHaveClass("p-4");
  });
});
