// Molekuła: potwierdzenie wysłania aplikacji renderowane w miejscu formularza.
// Zamiast tostu: trwały panel z dalszą drogą zgłoszenia (spójną z sekcją
// "Proces rekrutacji") i możliwością wysłania kolejnego zgłoszenia.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { MailCheck, UserRound, Timer, PhoneCall } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

const POINTS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "review", icon: UserRound },
  { key: "reply", icon: Timer },
  { key: "call", icon: PhoneCall },
];

export function CareerFormSuccess({ email, onReset }: { email: string; onReset: () => void }) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Panel montuje się po świadomej akcji (submit) - przenosimy fokus, żeby
  // czytnik ekranu ogłosił wynik, a klawiatura nie została w usuniętym DOM.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div role="status" className="crs-success mt-6">
      <span className="crs-success__badge" aria-hidden>
        <MailCheck className="h-6 w-6" aria-hidden />
      </span>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-xl font-bold tracking-tight text-foreground outline-none sm:text-2xl"
      >
        {t("careers.form.success.title")}
      </h3>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.form.success.body", { email })}
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {POINTS.map((point) => (
          <li
            key={point.key}
            className="flex gap-2.5 rounded-[6px] border border-border/70 bg-background/60 p-3.5 text-sm leading-relaxed text-muted-foreground"
          >
            <point.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span>{t(`careers.form.success.points.${point.key}`)}</span>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="mt-6" onClick={onReset}>
        {t("careers.form.success.again")}
      </Button>
    </div>
  );
}
