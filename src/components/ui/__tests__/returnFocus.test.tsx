// `useReturnFocus` - powrót ogniska po zamknięciu okna modalnego.
//
// CO TEN PLIK DOWODZI. Okno sterowane propem `open` (bez `Trigger` Radiksa)
// oddaje po zamknięciu ognisko elementowi, który miał je w chwili otwarcia -
// dawniej ognisko lądowało na <body> (WCAG 2.4.3). Dotyczy to wszystkich trzech
// prymitywów modalnych: Dialog, Sheet (moduł w ogóle nie eksportuje
// `SheetTrigger`) i AlertDialog (hosty globalnych potwierdzeń). Wywołujący
// z własnym `onCloseAutoFocus` i `preventDefault()` zachowuje pierwszeństwo,
// a element odpięty od DOM nie jest celem.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

type Okno = (props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) => ReactNode;

const DIALOG: Okno = ({ open, onOpenChange, onCloseAutoFocus }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>Okno</DialogTitle>
      <DialogDescription>Opis</DialogDescription>
    </DialogContent>
  </Dialog>
);

const ARKUSZ: Okno = ({ open, onOpenChange, onCloseAutoFocus }) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent onCloseAutoFocus={onCloseAutoFocus}>
      <SheetTitle>Okno</SheetTitle>
      <SheetDescription>Opis</SheetDescription>
    </SheetContent>
  </Sheet>
);

const POTWIERDZENIE: Okno = ({ open, onOpenChange, onCloseAutoFocus }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>Okno</AlertDialogTitle>
      <AlertDialogDescription>Opis</AlertDialogDescription>
      <AlertDialogCancel>Anuluj</AlertDialogCancel>
    </AlertDialogContent>
  </AlertDialog>
);

function Strona({
  Okno,
  onCloseAutoFocus,
  ukryjOtwierajacy = false,
}: {
  Okno: Okno;
  onCloseAutoFocus?: (event: Event) => void;
  ukryjOtwierajacy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">Wcześniej</button>
      {ukryjOtwierajacy && open ? null : (
        <button type="button" onClick={() => setOpen(true)}>
          Otwórz
        </button>
      )}
      <Okno open={open} onOpenChange={setOpen} onCloseAutoFocus={onCloseAutoFocus} />
    </>
  );
}

const okno = () => screen.queryByRole("dialog") ?? screen.queryByRole("alertdialog");

/** Radix oddaje ognisko w `setTimeout(0)` po odmontowaniu zakresu ogniska. */
async function otworzIZamknij() {
  const otworz = screen.getByRole("button", { name: "Otwórz" });
  act(() => otworz.focus());
  fireEvent.click(otworz);
  expect(okno()?.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
  expect(okno()).toBeNull();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

describe.each([
  ["Dialog", DIALOG],
  ["Sheet", ARKUSZ],
  ["AlertDialog", POTWIERDZENIE],
])("%s sterowany propem `open`", (_nazwa, Okno) => {
  it("po zamknięciu oddaje ognisko elementowi, który otworzył okno", async () => {
    render(<Strona Okno={Okno} />);
    await otworzIZamknij();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Otwórz" }));
  });

  it("własne `onCloseAutoFocus` z `preventDefault` ma pierwszeństwo", async () => {
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      screen.getByRole("button", { name: "Wcześniej" }).focus();
    });
    render(<Strona Okno={Okno} onCloseAutoFocus={onCloseAutoFocus} />);
    await otworzIZamknij();
    expect(onCloseAutoFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Wcześniej" }));
  });

  it("własne `onCloseAutoFocus` bez `preventDefault` jest wołane, a ognisko i tak wraca", async () => {
    const onCloseAutoFocus = vi.fn();
    render(<Strona Okno={Okno} onCloseAutoFocus={onCloseAutoFocus} />);
    await otworzIZamknij();
    expect(onCloseAutoFocus).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Otwórz" }));
  });

  it("element odpięty od DOM nie dostaje ogniska, a zamknięcie nie rzuca", async () => {
    render(<Strona Okno={Okno} ukryjOtwierajacy />);
    await otworzIZamknij();
    expect(document.activeElement?.textContent).not.toBe("Otwórz");
  });
});

describe("Dialog z własnym `onOpenAutoFocus`", () => {
  it("woła handler wywołującego przy otwarciu", () => {
    const onOpenAutoFocus = vi.fn();
    render(
      <Dialog open>
        <DialogContent onOpenAutoFocus={onOpenAutoFocus}>
          <DialogTitle>Okno</DialogTitle>
          <DialogDescription>Opis</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(onOpenAutoFocus).toHaveBeenCalledOnce();
  });
});
