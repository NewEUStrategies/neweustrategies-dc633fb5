// Organizm: proces rekrutacji - cztery kroki w porządku chronologicznym.
// Oś czasu: na desktopie kroki łączy pozioma linia (widoczna w przerwach
// między kartami), każdy krok niesie realny czas trwania z procesu.
import { useTranslation } from "react-i18next";
import { FileText, PhoneCall, ClipboardCheck, Handshake, Clock3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { CareerReveal } from "../atoms/CareerReveal";

const STEPS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "apply", icon: FileText },
  { key: "screening", icon: PhoneCall },
  { key: "task", icon: ClipboardCheck },
  { key: "decision", icon: Handshake },
];

export function CareersProcess() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="careers-process" className="mt-14">
      <h2
        id="careers-process"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.process.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.process.subtitle")}
      </p>

      <ol className="relative mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-[2.55rem] hidden h-px bg-gradient-to-r from-primary/60 via-border to-border xl:block"
        />
        {STEPS.map((step, index) => (
          <li key={step.key} className="h-full">
            <CareerReveal index={index} className="h-full">
              <div
                className={cn(
                  "group relative h-full rounded-[6px] border border-border/70 bg-card p-5",
                  "transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/45",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                    <step.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold leading-snug text-foreground">
                  {t(`careers.process.items.${step.key}.title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`careers.process.items.${step.key}.body`)}
                </p>
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  <Clock3 className="h-3 w-3 text-primary" aria-hidden />
                  {t(`careers.process.items.${step.key}.duration`)}
                </p>
              </div>
            </CareerReveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
