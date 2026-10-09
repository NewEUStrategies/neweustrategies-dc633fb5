// MENU WIERSZA I KOLUMNY SIATKI - wstaw, przesuń, sortuj, wyróżnij, usuń.
//
// Do PR2 arkusz miał przy każdym wierszu i kolumnie wyłącznie kosz, a nowe
// wiersze i serie dało się dokładać tylko NA KOŃCU: brakujący rok między
// dwoma innymi wymagał przepisania połowy tabeli. Menu zbiera działania na
// jednym wierszu (kolumnie) w jednym miejscu.
//
// Przycisk menu ma `tabIndex={-1}`: Tab w siatce chodzi po komórkach, a nie
// po przyciskach przy każdej z nich. Z klawiatury menu otwiera klawisz menu
// kontekstowego albo Shift+F10 w komórce - dlatego `open` jest sterowany
// z zewnątrz. W otwartym menu strzałki chodzą po pozycjach, Escape zamyka.
import type { KeyboardEvent, ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface GridMenuItem {
  /** Stabilny klucz pozycji (klucz Reacta i atrybut testowy). */
  id: string;
  label: string;
  onSelect: () => void;
  /** Pozycja widoczna, ale nieaktywna (limit, krawędź siatki). */
  unavailable?: boolean;
  destructive?: boolean;
}

interface Props {
  /** Nazwa dostępna przycisku i menu („Działania na serii Eksport"). */
  label: string;
  items: readonly GridMenuItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Zawartość przycisku; domyślnie trzy kropki. */
  trigger?: ReactNode;
  triggerClassName?: string;
}

function pozycje(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
}

function strzalki(e: KeyboardEvent<HTMLDivElement>): void {
  const lista = pozycje(e.currentTarget);
  if (lista.length === 0) return;
  const i = lista.indexOf(document.activeElement as HTMLButtonElement);
  let next: HTMLButtonElement | undefined;
  if (e.key === "ArrowDown") next = lista[(i + 1) % lista.length];
  else if (e.key === "ArrowUp") next = lista[(i - 1 + lista.length) % lista.length];
  else if (e.key === "Home") next = lista[0];
  else if (e.key === "End") next = lista[lista.length - 1];
  if (next === undefined) return;
  e.preventDefault();
  next.focus();
}

export function GridMenu({ label, items, open, onOpenChange, trigger, triggerClassName }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={label}
          aria-haspopup="menu"
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
            triggerClassName,
          )}
        >
          {trigger ?? <MoreVertical className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={label}
        align="start"
        className="w-64 p-1"
        onKeyDown={strzalki}
        onOpenAutoFocus={(e) => {
          // Fokus na PIERWSZEJ pozycji, nie na kontenerze - menu otwarte
          // klawiszem ma od razu reagować na strzałki i Enter.
          e.preventDefault();
          const root = e.currentTarget as HTMLElement | null;
          if (root) pozycje(root)[0]?.focus();
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-menu-item={item.id}
            disabled={item.unavailable}
            className={cn(
              "flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus:bg-muted focus:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
              item.destructive && "text-destructive",
            )}
            onClick={() => {
              onOpenChange(false);
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
