// AlertDialog to okno potwierdzenia nieodwracalnej akcji. Różni się od
// zwykłego okna trzema rzeczami, które test pilnuje: rolą `alertdialog`,
// ogniskiem startującym na przycisku ANULUJ (bezpieczny wybór domyślny) i tym,
// że kliknięcie w tło NIE zamyka okna - trzeba świadomie wybrać akcję.
// Przyciski biorą warianty z `buttonVariants` (Akcja: podstawowy, Anuluj:
// obrysowy), więc kolory idą z tokenów wspólnych dla jasnego i ciemnego motywu.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../alert-dialog";
import { axeViolations } from "@/test/axe";

afterEach(cleanup);

function Sample({
  onAction,
  onOpenChange,
}: {
  onAction?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange}>
      <AlertDialogTrigger>Usuń wpis</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader data-testid="naglowek">
          <AlertDialogTitle>Usunąć wpis?</AlertDialogTitle>
          <AlertDialogDescription>Tej operacji nie można cofnąć.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter data-testid="stopka">
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>Usuń</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function open() {
  const trigger = screen.getByRole("button", { name: "Usuń wpis" });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("alertdialog") };
}

describe("AlertDialog", () => {
  it("otwiera okno z rolą alertdialog, nazwą z tytułu i opisem z opisu", () => {
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Usuń wpis" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const { dialog } = open();
    expect(dialog).toHaveAccessibleName("Usunąć wpis?");
    expect(dialog).toHaveAccessibleDescription("Tej operacji nie można cofnąć.");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("ustawia ognisko na przycisku Anuluj jako bezpiecznym wyborze domyślnym", async () => {
    render(<Sample />);
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus());
  });

  it("nie zamyka okna kliknięciem w tło", async () => {
    const onOpenChange = vi.fn();
    render(<Sample onOpenChange={onOpenChange} />);
    const { dialog } = open();
    const overlay = dialog.previousElementSibling as HTMLElement;
    // Radix podpina nasłuch „kliknięcia na zewnątrz" dopiero w następnym takcie.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("zamyka okno klawiszem Escape i oddaje ognisko wyzwalaczowi", async () => {
    render(<Sample />);
    const { trigger, dialog } = open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("Anuluj zamyka okno bez wykonania akcji", async () => {
    const onAction = vi.fn();
    render(<Sample onAction={onAction} />);
    const { trigger } = open();
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onAction).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("akcja wykonuje się i zamyka okno", async () => {
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(<Sample onAction={onAction} onOpenChange={onOpenChange} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("stylizuje akcję wariantem podstawowym, a Anuluj wariantem obrysowym", () => {
    render(<Sample />);
    open();
    const action = screen.getByRole("button", { name: "Usuń" });
    expect(action).toHaveClass("bg-primary", "text-primary-foreground", "h-8");
    const cancel = screen.getByRole("button", { name: "Anuluj" });
    expect(cancel).toHaveClass("border", "border-input", "bg-background", "mt-2", "sm:mt-0");
    expect(cancel).not.toHaveClass("bg-primary");
  });

  it("rysuje nakładkę i treść w kolorach tokenów motywu", () => {
    render(<Sample />);
    const { dialog } = open();
    expect(dialog).toHaveClass("bg-background", "border", "shadow-lg", "max-w-lg");
    const overlay = dialog.previousElementSibling as HTMLElement;
    expect(overlay).toHaveClass("fixed", "inset-0", "bg-black/80");
    expect(screen.getByTestId("naglowek")).toHaveClass("flex", "flex-col", "space-y-2");
    expect(screen.getByTestId("stopka")).toHaveClass("flex-col-reverse", "sm:flex-row");
    expect(screen.getByText("Usunąć wpis?")).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText("Tej operacji nie można cofnąć.")).toHaveClass(
      "text-sm",
      "text-muted-foreground",
    );
  });

  it("przekazuje ref i scala klasy wywołującego na każdym elemencie", () => {
    const content = createRef<HTMLDivElement>();
    const title = createRef<HTMLHeadingElement>();
    const description = createRef<HTMLParagraphElement>();
    const action = createRef<HTMLButtonElement>();
    const cancel = createRef<HTMLButtonElement>();
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent ref={content} className="max-w-sm">
          <AlertDialogHeader className="gap-3">
            <AlertDialogTitle ref={title} className="text-base">
              T
            </AlertDialogTitle>
            <AlertDialogDescription ref={description} className="text-xs">
              D
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-2">
            <AlertDialogCancel ref={cancel} className="mt-0">
              Nie
            </AlertDialogCancel>
            <AlertDialogAction ref={action} className="bg-destructive">
              Tak
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(content.current).toBe(screen.getByRole("alertdialog"));
    expect(content.current).toHaveClass("max-w-sm");
    expect(content.current).not.toHaveClass("max-w-lg");
    expect(title.current).toHaveClass("text-base");
    expect(description.current).toHaveClass("text-xs");
    expect(action.current).toHaveClass("bg-destructive");
    expect(action.current).not.toHaveClass("bg-primary");
    expect(cancel.current).toHaveClass("mt-0");
    expect(cancel.current).not.toHaveClass("mt-2");
    expect(screen.getByText("T").parentElement).toHaveClass("gap-3");
    expect(screen.getByText("Nie").parentElement).toHaveClass("pt-2");
  });

  it("przechodzi audyt dostępności axe w stanie otwartym", async () => {
    render(<Sample />);
    const { dialog } = open();
    expect(await axeViolations(dialog)).toEqual([]);
  });
});
