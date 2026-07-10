import { ChevronDown, ChevronUp } from "lucide-react";

interface StepperButtonsProps {
  onIncrement: () => void;
  onDecrement: () => void;
}

export function StepperButtons({ onIncrement, onDecrement }: StepperButtonsProps) {
  return (
    <div className="absolute right-0 top-0 h-8 w-5 flex flex-col border-l border-input">
      <button
        type="button"
        aria-label="Zwiększ"
        onClick={onIncrement}
        className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-tr-md transition-colors"
        tabIndex={-1}
      >
        <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label="Zmniejsz"
        onClick={onDecrement}
        className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-br-md border-t border-input transition-colors"
        tabIndex={-1}
      >
        <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
