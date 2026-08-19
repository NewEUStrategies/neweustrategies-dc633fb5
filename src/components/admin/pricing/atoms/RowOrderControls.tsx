// Atom: sterowanie porządkiem i usunięciem wiersza listy redakcyjnej.
//
// Ten sam trójkąt przycisków (w górę / w dół / usuń) istniał TRZY RAZY w pliku
// trasy `/admin/pricing`: dla segmentów, dla pytań FAQ i dla powodów
// rezygnacji. Kopie różniły się tylko kluczem tłumaczenia i tym, co robi
// „usuń", a wyłączanie skrajnych strzałek było w każdej z nich przepisane
// ręcznie - czyli trzy miejsca, w których można było się pomylić o jeden.
//
// Kontrakt dostępności: to przyciski BEZ tekstu, więc każdy dostaje nazwę przez
// `aria-label` (a `title` zostaje dla myszki). Ikony są `aria-hidden`, żeby
// czytnik nie ogłaszał ich dwa razy.
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface RowOrderLabels {
  moveUp: string;
  moveDown: string;
  delete: string;
}

export function RowOrderControls({
  labels,
  canMoveUp,
  canMoveDown,
  pending = false,
  deletePending = false,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  labels: RowOrderLabels;
  /** `false` dla pierwszego wiersza - strzałka w górę jest wyłączona. */
  canMoveUp: boolean;
  /** `false` dla ostatniego wiersza - strzałka w dół jest wyłączona. */
  canMoveDown: boolean;
  /** Trwa zapis kolejności: obie strzałki wyłączone, żeby nie nałożyć zapisów. */
  pending?: boolean;
  /** Trwa usuwanie: wyłączony wyłącznie kosz. */
  deletePending?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="flex items-center gap-0.5">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onMoveUp}
        disabled={!canMoveUp || pending}
        aria-label={labels.moveUp}
        title={labels.moveUp}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onMoveDown}
        disabled={!canMoveDown || pending}
        aria-label={labels.moveDown}
        title={labels.moveDown}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        disabled={deletePending}
        aria-label={labels.delete}
        title={labels.delete}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </span>
  );
}
