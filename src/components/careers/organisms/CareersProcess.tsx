// Organizm: proces rekrutacji - cztery kroki w porządku chronologicznym.
import { useTranslation } from "react-i18next";
import { FileText, PhoneCall, ClipboardCheck, Handshake } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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

      <ol className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.key}
            className={cn(
              "group relative rounded-[6px] border border-border/70 bg-card p-5",
              "transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/45",
            )}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
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
          </li>
        ))}
      </ol>
    </section>
  );
}
