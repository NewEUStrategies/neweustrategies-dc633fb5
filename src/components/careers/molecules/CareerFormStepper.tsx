// Molekuła: nagłówek kreatora aplikacji - trzy kroki + animowany pasek postępu.
// Powrót jest dozwolony wyłącznie do kroków już odwiedzonych; kroki przyszłe
// są wyłączone (walidacja idzie przez przycisk "Dalej", nie przez skoki).
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const CAREER_FORM_STEPS = ["about", "fit", "message"] as const;
export type CareerFormStepKey = (typeof CAREER_FORM_STEPS)[number];

export function CareerFormStepper({
  current,
  maxVisited,
  onStepSelect,
}: {
  current: number;
  maxVisited: number;
  onStepSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const total = CAREER_FORM_STEPS.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ol className="flex items-center gap-3 sm:gap-5">
          {CAREER_FORM_STEPS.map((key, index) => {
            const done = index < current;
            const isCurrent = index === current;
            const reachable = index <= maxVisited && !isCurrent;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => onStepSelect(index)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "group flex items-center gap-2 rounded-[6px] px-1 py-0.5 text-left",
                    reachable ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border text-xs font-bold tabular-nums transition-colors duration-300",
                      done && "border-primary bg-primary text-primary-foreground",
                      isCurrent && "border-primary bg-primary/10 text-primary",
                      !done && !isCurrent && "border-border/80 text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                  </span>
                  <span className="hidden min-w-0 flex-col sm:flex">
                    <span
                      className={cn(
                        "text-xs font-semibold leading-tight",
                        isCurrent || done ? "text-foreground" : "text-muted-foreground",
                        reachable && "group-hover:text-primary",
                      )}
                    >
                      {t(`careers.form.steps.${key}.title`)}
                    </span>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      {t(`careers.form.steps.${key}.hint`)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-xs font-medium tabular-nums text-muted-foreground">
          {t("careers.form.stepLabel", { current: current + 1, total })}
        </p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-[6px] bg-border/60" aria-hidden>
        <div
          className="crs-progress h-full rounded-[6px]"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
