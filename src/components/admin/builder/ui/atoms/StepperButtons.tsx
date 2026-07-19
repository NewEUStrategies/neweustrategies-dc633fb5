import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface StepperButtonsProps {
  onIncrement: () => void;
  onDecrement: () => void;
}

export function StepperButtons({ onIncrement, onDecrement }: StepperButtonsProps) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-0 top-0 h-8 w-5 flex flex-col border-l border-input">
      <button
        type="button"
        aria-label={t("builder.stepper.increase")}
        onClick={onIncrement}
        className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-tr-md transition-colors"
        tabIndex={-1}
      >
        <ChevronUp className="h-3 w-3" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label={t("builder.stepper.decrease")}
        onClick={onDecrement}
        className="flex-1 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-br-md border-t border-input transition-colors"
        tabIndex={-1}
      >
        <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
