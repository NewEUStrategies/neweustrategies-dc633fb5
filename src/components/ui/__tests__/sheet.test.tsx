// Sheet to wysuwany panel zbudowany na Radix Dialog. Kontrakt: rola `dialog`
// z nazwą i opisem, zamknięcie klawiszem Escape i przyciskiem z nazwą dla
// czytnika, a strona wysunięcia (`side`) wybiera krawędź, ramkę i animację -
// każdy z czterech wariantów i domyślny `right`. Tło idzie z tokenu
// `bg-background`, wspólnego dla jasnego i ciemnego motywu.
//
// Moduł nie eksportuje wyzwalacza, a konsumenci sterują panelem przez `open`,
// więc test robi dokładnie to samo.
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../sheet";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

type Side = "top" | "bottom" | "left" | "right";

function Controlled({
  side,
  onOpenChange,
}: {
  side?: Side;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Filtry
      </button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
      >
        <SheetContent side={side}>
          <SheetHeader data-testid="naglowek">
            <SheetTitle>Filtry listy</SheetTitle>
            <SheetDescription>Zawęź wyniki.</SheetDescription>
          </SheetHeader>
          <input aria-label="Szukaj" />
        </SheetContent>
      </Sheet>
    </>
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "Filtry" }));
  return screen.getByRole("dialog");
}

const SIDES: ReadonlyArray<readonly [Side, readonly string[]]> = [
  ["top", ["inset-x-0", "top-0", "border-b", "data-[state=open]:slide-in-from-top"]],
  ["bottom", ["inset-x-0", "bottom-0", "border-t", "data-[state=open]:slide-in-from-bottom"]],
  ["left", ["inset-y-0", "left-0", "border-r", "w-3/4", "data-[state=open]:slide-in-from-left"]],
  ["right", ["inset-y-0", "right-0", "border-l", "w-3/4", "data-[state=open]:slide-in-from-right"]],
];

describe("Sheet", () => {
  it("otwiera panel z rolą dialog, nazwą z tytułu i opisem", () => {
    render(<Controlled />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const sheet = openSheet();
    expect(sheet).toHaveAccessibleName("Filtry listy");
    expect(sheet).toHaveAccessibleDescription("Zawęź wyniki.");
    expect(sheet).toHaveAttribute("data-state", "open");
  });

  it("bez wskazanej strony wysuwa panel z prawej krawędzi", () => {
    render(<Controlled />);
    const sheet = openSheet();
    expect(sheet).toHaveClass("right-0", "border-l", "bg-background", "shadow-lg");
    expect(sheet).not.toHaveClass("left-0");
  });

  it.each(SIDES)("strona %s wybiera krawędź, ramkę i animację wysunięcia", (side, classes) => {
    render(<Controlled side={side} />);
    expect(openSheet()).toHaveClass("fixed", "z-50", "bg-background", ...classes);
  });

  it("przenosi ognisko do panelu po otwarciu", async () => {
    render(<Controlled />);
    const sheet = openSheet();
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });

  it("zamyka panel klawiszem Escape i zgłasza zmianę stanu", async () => {
    const onOpenChange = vi.fn();
    render(<Controlled onOpenChange={onOpenChange} />);
    const sheet = openSheet();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("zamyka panel przyciskiem zamknięcia z nazwą dla czytnika ekranu", async () => {
    render(<Controlled />);
    const sheet = openSheet();
    const close = screen.getByRole("button", { name: "Close" });
    expect(sheet.firstElementChild).toBe(close);
    expect(close).toHaveClass("absolute", "right-4", "top-4", "focus:ring-2");
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("zamyka panel kliknięciem w półprzezroczystą nakładkę", async () => {
    render(<Controlled />);
    const sheet = openSheet();
    const overlay = sheet.previousElementSibling as HTMLElement;
    expect(overlay).toHaveClass("fixed", "inset-0", "bg-black/80");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stylizuje nagłówek, tytuł i opis tokenami motywu oraz scala klasy wywołującego", () => {
    const content = createRef<HTMLDivElement>();
    const title = createRef<HTMLHeadingElement>();
    const description = createRef<HTMLParagraphElement>();
    render(
      <Sheet defaultOpen>
        <SheetContent ref={content} side="left" className="w-full">
          <SheetHeader className="border-b">
            <SheetTitle ref={title} className="text-base">
              Tytuł
            </SheetTitle>
            <SheetDescription ref={description} className="text-xs">
              Opis
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    expect(content.current).toBe(screen.getByRole("dialog"));
    expect(content.current).toHaveClass("w-full", "left-0");
    expect(content.current).not.toHaveClass("w-3/4");
    expect(title.current).toHaveClass("text-base", "font-semibold", "text-foreground");
    expect(title.current).not.toHaveClass("text-lg");
    expect(description.current).toHaveClass("text-xs", "text-muted-foreground");
    expect(screen.getByText("Tytuł").parentElement).toHaveClass("flex", "flex-col", "border-b");
  });

  it("przechodzi audyt dostępności axe w stanie otwartym", async () => {
    render(<Controlled />);
    const sheet = openSheet();
    expect(screen.getByTestId("naglowek")).toHaveClass("space-y-2", "sm:text-left");
    expect(await axeViolations(sheet)).toEqual([]);
  });
});
