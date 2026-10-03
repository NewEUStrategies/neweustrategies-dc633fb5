// Dialog to modalne okno Radiksa w portalu. Kontrakt dostępności: rola
// `dialog` z nazwą z tytułu i opisem z `DialogDescription`, ognisko wchodzi do
// okna po otwarciu i wraca do wyzwalacza po zamknięciu (Escape albo przycisk
// zamknięcia), a przycisk zamknięcia ma nazwę dla czytnika. Tło i nakładka
// idą z tokenów (`bg-background`, `bg-black/80`), wspólnych dla motywów.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../dialog";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger>Edytuj profil</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader data-testid="naglowek">
          <DialogTitle>Edycja profilu</DialogTitle>
          <DialogDescription>Zmień dane widoczne publicznie.</DialogDescription>
        </DialogHeader>
        <input aria-label="Imię" />
        <DialogFooter data-testid="stopka">
          <button type="button">Zapisz</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function open() {
  const trigger = screen.getByRole("button", { name: "Edytuj profil" });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog") };
}

describe("Dialog", () => {
  it("wyzwalacz ogłasza, że otwiera okno, i odzwierciedla stan rozwinięcia", () => {
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Edytuj profil" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("dialog").id);
  });

  it("otwiera okno z nazwą z tytułu i opisem z opisu", () => {
    render(<Sample />);
    const { dialog } = open();
    expect(dialog).toHaveAccessibleName("Edycja profilu");
    expect(dialog).toHaveAccessibleDescription("Zmień dane widoczne publicznie.");
    expect(dialog).toHaveAttribute("data-state", "open");
    expect(screen.getByText("Edycja profilu").tagName).toBe("H2");
  });

  it("przenosi ognisko do okna po otwarciu", async () => {
    render(<Sample />);
    const { dialog } = open();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("zamyka okno klawiszem Escape i oddaje ognisko wyzwalaczowi", async () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    const { trigger, dialog } = open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("zamyka okno przyciskiem zamknięcia z nazwą dla czytnika ekranu", async () => {
    render(<Sample />);
    const { trigger } = open();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.querySelector("svg")).not.toBeNull();
    expect(close).toHaveClass("absolute", "right-4", "top-4", "focus:ring-2");
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("zamyka okno kliknięciem w tło", async () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    const { dialog } = open();
    const overlay = dialog.previousElementSibling as HTMLElement;
    // Radix podpina nasłuch „kliknięcia na zewnątrz" dopiero w następnym takcie.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("rysuje nakładkę i okno w kolorach tokenów motywu, scalając klasę wywołującego", () => {
    render(<Sample />);
    const { dialog } = open();
    expect(dialog).toHaveClass("bg-background", "border", "shadow-lg", "max-w-xl");
    expect(dialog).not.toHaveClass("max-w-lg");
    const overlay = dialog.previousElementSibling as HTMLElement;
    expect(overlay).toHaveClass("fixed", "inset-0", "bg-black/80");
    expect(overlay).toHaveAttribute("data-state", "open");
    expect(screen.getByTestId("naglowek")).toHaveClass("flex", "flex-col", "sm:text-left");
    expect(screen.getByTestId("stopka")).toHaveClass("flex-col-reverse", "sm:justify-end");
    expect(screen.getByText("Edycja profilu")).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText("Zmień dane widoczne publicznie.")).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("przekazuje ref treści, tytułu i opisu oraz klasy wywołującego", () => {
    const content = createRef<HTMLDivElement>();
    const title = createRef<HTMLHeadingElement>();
    const description = createRef<HTMLParagraphElement>();
    render(
      <Dialog defaultOpen>
        <DialogContent ref={content}>
          <DialogHeader className="gap-1">
            <DialogTitle ref={title} className="text-xl">
              Tytuł
            </DialogTitle>
            <DialogDescription ref={description} className="text-xs">
              Opis
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <span>Stopka</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(content.current).toBe(screen.getByRole("dialog"));
    expect(title.current).toHaveClass("text-xl");
    expect(title.current).not.toHaveClass("text-lg");
    expect(description.current).toHaveClass("text-xs");
    expect(screen.getByText("Tytuł").parentElement).toHaveClass("gap-1");
    expect(screen.getByText("Stopka").parentElement).toHaveClass("mt-4");
  });

  // Audyt obejmuje samo okno. Na całym dokumencie axe zgłasza `aria-hidden-focus`
  // dla strażników ogniska Radiksa i wyzwalacza schowanego pod `aria-hidden` - to
  // celowy mechanizm modalności biblioteki (ognisko i tak jest uwięzione w oknie),
  // nie właściwość tego opakowania.
  it("przechodzi audyt dostępności axe w stanie otwartym", async () => {
    render(<Sample />);
    const { dialog } = open();
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
