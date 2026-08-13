// Organizm: nagłówek strony kariery. Zawiera jedyny H1 strony.
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JoinStat } from "@/components/membership-join/atoms/JoinStat";

const STAT_KEYS = ["people", "countries", "remote", "growth"] as const;

export function CareersHero({
  onSeeRoles,
  onOpenApplication,
}: {
  onSeeRoles: () => void;
  onOpenApplication: () => void;
}) {
  const { t } = useTranslation();

  return (
    <header className="relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card/50 px-5 py-10 sm:px-8 sm:py-14">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_10%_-10%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_60%)]"
      />
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        {t("careers.eyebrow")}
      </p>
      <h1 className="mt-3 max-w-3xl text-balance text-3xl font-black leading-[1.1] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
        {t("careers.title")}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {t("careers.lead")}
      </p>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button size="lg" className="gap-2" onClick={onSeeRoles}>
          {t("careers.ctaPrimary")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="lg" variant="outline" onClick={onOpenApplication}>
          {t("careers.ctaSecondary")}
        </Button>
      </div>

      <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {t("careers.trust")}
      </p>

      <dl className="mt-9 grid grid-cols-2 gap-5 border-t border-border/60 pt-6 sm:grid-cols-4">
        {STAT_KEYS.map((key) => (
          <JoinStat
            key={key}
            value={t(`careers.stats.${key}.value`)}
            label={t(`careers.stats.${key}.label`)}
          />
        ))}
      </dl>
    </header>
  );
}
